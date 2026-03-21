import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Play, StopCircle, Settings, TrendingUp, TrendingDown, Zap, Shield, Target } from 'lucide-react';
import { toast } from 'sonner';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';

interface Signal {
  type: string;
  name: string;
  strength: number;
  symbol: string;
  detail: string;
  extra: string;
}

interface BotConfig {
  enabled: boolean;
  stake: number;
  martingaleMultiplier: number;
  martingaleMaxSteps: number;
  takeProfit: number;
  stopLoss: number;
  // Recovery settings
  recoveryOverTrades: number;
  recoveryUnderTrades: number;
  recoveryEvenTrades: number;
  recoveryOddTrades: number;
}

interface TradeLog {
  id: number;
  time: string;
  symbol: string;
  signalType: string;
  direction: string;
  stake: number;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
}

const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const TICK_DEPTH = 1000;

// Helper: compute digit frequencies
function computeDigitStats(ticks: number[], thresholdDigit: number) {
  if (!ticks || ticks.length < 100) return null;
  const recent = ticks.slice(-TICK_DEPTH);
  const freq = Array(10).fill(0);
  recent.forEach(d => { if (d >= 0 && d <= 9) freq[d]++; });

  let entries = freq.map((count, digit) => ({ digit, count }));
  entries.sort((a, b) => b.count - a.count);
  const mostAppearing = entries[0]?.digit ?? 0;
  const secondMost = entries[1]?.digit ?? mostAppearing;
  const leastAppearing = (() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].count > 0) return entries[i].digit;
    }
    return 0;
  })();

  let overCount = 0, underCount = 0;
  recent.forEach(d => { if (d > thresholdDigit) overCount++; else if (d < thresholdDigit) underCount++; });
  let oddCount = 0, evenCount = 0;
  recent.forEach(d => { if (d % 2 === 0) evenCount++; else oddCount++; });
  let riseCount = 0, fallCount = 0;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] > recent[i - 1]) riseCount++;
    else if (recent[i] < recent[i - 1]) fallCount++;
  }
  const totalComp = recent.length - 1 || 1;

  return {
    mostAppearing,
    secondMost,
    leastAppearing,
    overRate: overCount / recent.length,
    underRate: underCount / recent.length,
    oddRate: oddCount / recent.length,
    evenRate: evenCount / recent.length,
    riseRate: riseCount / totalComp,
    fallRate: fallCount / totalComp,
    totalTicks: recent.length
  };
}

// Wait for next tick
function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote });
      }
    });
  });
}

export function SignalForgeAutoBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Signal State
  const [contractType, setContractType] = useState<'overunder' | 'evenodd' | 'risefall'>('overunder');
  const [marketGroup, setMarketGroup] = useState<'all' | 'vol' | 'jump' | 'bull' | 'bear'>('all');
  const [topSignals, setTopSignals] = useState<Signal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectedMarkets, setConnectedMarkets] = useState(0);
  const [activeSignal, setActiveSignal] = useState<Signal | null>(null);

  // Bot State
  const [isRunning, setIsRunning] = useState(false);
  const [botConfig, setBotConfig] = useState<BotConfig>({
    enabled: true,
    stake: 0.5,
    martingaleMultiplier: 2,
    martingaleMaxSteps: 3,
    takeProfit: 10,
    stopLoss: 5,
    recoveryOverTrades: 3,
    recoveryUnderTrades: 8,
    recoveryEvenTrades: 3,
    recoveryOddTrades: 3,
  });
  
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [totalPnL, setTotalPnL] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [winCount, setWinCount] = useState(0);
  const [lossCount, setLossCount] = useState(0);
  const [currentStake, setCurrentStake] = useState(0.5);
  const [martingaleStep, setMartingaleStep] = useState(0);
  const [isInRecovery, setIsInRecovery] = useState(false);
  const [recoveryCounter, setRecoveryCounter] = useState(0);
  
  const runningRef = useRef(false);
  const ticksMapRef = useRef<Map<string, number[]>>(new Map());
  const activeDigitMapRef = useRef<Map<string, number>>(new Map());
  const wsConnectionsRef = useRef<Map<string, WebSocket>>(new Map());
  const logIdRef = useRef(0);

  // Core signal generation
  const computeGlobalSignals = useCallback(() => {
    const allCandidates: Signal[] = [];
    const ticksMap = ticksMapRef.current;
    
    for (const [symbol, ticks] of ticksMap.entries()) {
      if (!ticks || ticks.length < 200) continue;
      const thr = activeDigitMapRef.current.get(symbol) ?? 5;
      const stats = computeDigitStats(ticks, thr);
      if (!stats) continue;
      
      const { mostAppearing, secondMost, leastAppearing, overRate, underRate, oddRate, evenRate, riseRate, fallRate } = stats;
      
      // OVER/UNDER strategy
      let underOverSignal: string | null = null;
      let underOverStrength = 0.5;
      let underOverReason = "";
      let direction = "";
      
      if (mostAppearing <= 6) {
        underOverSignal = "📉 UNDER";
        underOverStrength = 0.68 + (underRate * 0.25);
        underOverReason = `Most digit ${mostAppearing} in 0-6 zone | Under rate ${(underRate * 100).toFixed(0)}%`;
        direction = "UNDER";
        if (secondMost <= 6) underOverStrength += 0.08;
        if (leastAppearing >= 5) underOverStrength -= 0.03;
      }
      if (mostAppearing >= 5) {
        underOverSignal = "📈 OVER";
        underOverStrength = 0.68 + (overRate * 0.25);
        underOverReason = `Most digit ${mostAppearing} in 5-9 zone | Over rate ${(overRate * 100).toFixed(0)}%`;
        direction = "OVER";
        if (secondMost >= 5) underOverStrength += 0.08;
        if (leastAppearing <= 4) underOverStrength -= 0.03;
      }
      underOverStrength = Math.min(0.96, Math.max(0.55, underOverStrength));
      
      // ODD/EVEN strategy
      let oddEvenSignal: string | null = null;
      let oddEvenStrength = 0.5;
      let oddEvenDirection = "";
      if (mostAppearing % 2 === 1) {
        oddEvenSignal = "🎲 ODD";
        oddEvenStrength = 0.65 + (oddRate * 0.25);
        oddEvenDirection = "ODD";
        if (secondMost % 2 === 1) oddEvenStrength += 0.07;
      } else {
        oddEvenSignal = "🎲 EVEN";
        oddEvenStrength = 0.65 + (evenRate * 0.25);
        oddEvenDirection = "EVEN";
        if (secondMost % 2 === 0) oddEvenStrength += 0.07;
      }
      oddEvenStrength = Math.min(0.94, Math.max(0.55, oddEvenStrength));
      
      // Build candidates based on selected contract type
      const candidates: Signal[] = [];
      
      if (contractType === 'overunder') {
        if (underOverSignal && underOverStrength > 0.58) {
          candidates.push({
            type: "Under/Over",
            name: underOverSignal,
            strength: underOverStrength,
            symbol: symbol,
            detail: underOverReason,
            extra: `Direction: ${direction} | Threshold ${thr}`
          });
        }
      }
      
      if (contractType === 'evenodd') {
        if (oddEvenSignal && oddEvenStrength > 0.58) {
          candidates.push({
            type: "Odd/Even",
            name: oddEvenSignal,
            strength: oddEvenStrength,
            symbol: symbol,
            detail: `${oddEvenDirection} signal based on most appearing digit ${mostAppearing}`,
            extra: `${oddEvenDirection} winrate: ${oddEvenDirection === "ODD" ? (oddRate * 100).toFixed(0) : (evenRate * 100).toFixed(0)}%`
          });
        }
      }
      
      if (contractType === 'risefall') {
        if (riseRate > fallRate && riseRate > 0.52) {
          candidates.push({
            type: "Rise/Fall",
            name: "⬆️ RISE",
            strength: 0.6 + riseRate * 0.3,
            symbol: symbol,
            detail: `Rise momentum ${(riseRate * 100).toFixed(0)}% vs Fall ${(fallRate * 100).toFixed(0)}%`,
            extra: `Direction: RISE`
          });
        } else if (fallRate > riseRate && fallRate > 0.52) {
          candidates.push({
            type: "Rise/Fall",
            name: "⬇️ FALL",
            strength: 0.6 + fallRate * 0.3,
            symbol: symbol,
            detail: `Fall momentum ${(fallRate * 100).toFixed(0)}% vs Rise ${(riseRate * 100).toFixed(0)}%`,
            extra: `Direction: FALL`
          });
        }
      }
      
      allCandidates.push(...candidates);
    }
    
    // Sort and get top signal
    allCandidates.sort((a, b) => b.strength - a.strength);
    const top = allCandidates[0] || null;
    setTopSignals(allCandidates.slice(0, 4));
    setActiveSignal(top);
    setConnectedMarkets(ticksMap.size);
    setIsLoading(false);
  }, [contractType]);

  // WebSocket connection for market data
  const connectMarket = useCallback((symbol: string) => {
    if (wsConnectionsRef.current.has(symbol)) return;
    
    const ws = new WebSocket("wss://ws.binaryws.com/websockets/v3?app_id=1089");
    const ticks: number[] = [];
    
    ws.onopen = () => {
      ws.send(JSON.stringify({ ticks_history: symbol, count: TICK_DEPTH, end: "latest", style: "ticks" }));
    };
    
    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.history && data.history.prices) {
        data.history.prices.forEach((p: string) => {
          const digit = parseInt(parseFloat(p).toFixed(2).slice(-1));
          if (!isNaN(digit)) ticks.push(digit);
        });
        while (ticks.length > 2500) ticks.shift();
        ticksMapRef.current.set(symbol, [...ticks]);
        ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        computeGlobalSignals();
      }
      if (data.tick && data.tick.quote) {
        const digit = parseInt(parseFloat(data.tick.quote).toFixed(2).slice(-1));
        if (!isNaN(digit)) {
          ticks.push(digit);
          if (ticks.length > 2500) ticks.shift();
          ticksMapRef.current.set(symbol, [...ticks]);
          computeGlobalSignals();
        }
      }
    };
    
    wsConnectionsRef.current.set(symbol, ws);
    if (!activeDigitMapRef.current.has(symbol)) {
      activeDigitMapRef.current.set(symbol, 5);
    }
  }, [computeGlobalSignals]);

  const loadGroup = useCallback((group: string) => {
    wsConnectionsRef.current.forEach((ws) => ws.close());
    wsConnectionsRef.current.clear();
    ticksMapRef.current.clear();
    
    let symbols: string[] = [];
    if (group === "all") {
      symbols = [...VOLATILITIES.vol, ...VOLATILITIES.jump, ...VOLATILITIES.bull, ...VOLATILITIES.bear];
    } else if (group === "vol") {
      symbols = VOLATILITIES.vol;
    } else if (group === "jump") {
      symbols = VOLATILITIES.jump;
    } else if (group === "bull") {
      symbols = VOLATILITIES.bull;
    } else if (group === "bear") {
      symbols = VOLATILITIES.bear;
    }
    
    setIsLoading(true);
    symbols.forEach(symbol => connectMarket(symbol));
    
    setTimeout(() => {
      if (ticksMapRef.current.size === 0) setIsLoading(false);
    }, 3000);
  }, [connectMarket]);

  // Execute a trade based on signal
  const executeTrade = useCallback(async (signal: Signal, stakeAmount: number) => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    
    // Determine contract type based on signal
    let contractTypeParam = '';
    let barrier = '';
    const direction = signal.extra.includes('OVER') ? 'OVER' : 
                      signal.extra.includes('UNDER') ? 'UNDER' :
                      signal.extra.includes('ODD') ? 'ODD' :
                      signal.extra.includes('EVEN') ? 'EVEN' : 'RISE';
    
    if (signal.type === "Under/Over") {
      if (direction === 'OVER') {
        contractTypeParam = 'DIGITOVER';
        barrier = '5';
      } else {
        contractTypeParam = 'DIGITUNDER';
        barrier = '5';
      }
    } else if (signal.type === "Odd/Even") {
      if (direction === 'ODD') {
        contractTypeParam = 'DIGITODD';
      } else {
        contractTypeParam = 'DIGITEVEN';
      }
    } else if (signal.type === "Rise/Fall") {
      contractTypeParam = 'DIGITOVER';
      barrier = direction === 'RISE' ? '5' : '4';
    }
    
    setTradeLogs(prev => [{
      id: logId,
      time: now,
      symbol: signal.symbol,
      signalType: signal.type,
      direction: direction,
      stake: stakeAmount,
      result: 'Pending',
      pnl: 0,
      balance: balance,
    }, ...prev].slice(0, 50));
    
    try {
      await waitForNextTick(signal.symbol as MarketSymbol);
      
      const buyParams: any = {
        contract_type: contractTypeParam,
        symbol: signal.symbol,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: stakeAmount,
      };
      if (contractTypeParam === 'DIGITOVER' || contractTypeParam === 'DIGITUNDER') {
        buyParams.barrier = barrier;
      }
      
      const { contractId } = await derivApi.buyContract(buyParams);
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      setTotalPnL(prev => prev + pnl);
      setTotalTrades(prev => prev + 1);
      if (won) {
        setWinCount(prev => prev + 1);
      } else {
        setLossCount(prev => prev + 1);
        if (activeAccount?.is_virtual) {
          recordLoss(stakeAmount, signal.symbol, 6000);
        }
      }
      
      setTradeLogs(prev => prev.map(log => 
        log.id === logId ? { ...log, result: won ? 'Win' : 'Loss', pnl, balance: balance + pnl } : log
      ));
      
      return { won, pnl };
    } catch (err: any) {
      setTradeLogs(prev => prev.map(log => 
        log.id === logId ? { ...log, result: 'Loss', pnl: -stakeAmount, balance: balance - stakeAmount } : log
      ));
      setTotalPnL(prev => prev - stakeAmount);
      setTotalTrades(prev => prev + 1);
      setLossCount(prev => prev + 1);
      return { won: false, pnl: -stakeAmount };
    }
  }, [balance, activeAccount, recordLoss]);

  // Auto-trading loop
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning || !activeSignal) return;
    if (balance < botConfig.stake) {
      toast.error('Insufficient balance');
      return;
    }
    
    setIsRunning(true);
    runningRef.current = true;
    setCurrentStake(botConfig.stake);
    setMartingaleStep(0);
    setIsInRecovery(false);
    setRecoveryCounter(0);
    
    let currentStakeAmount = botConfig.stake;
    let currentMartingaleStep = 0;
    let localPnL = 0;
    let consecutiveLosses = 0;
    
    while (runningRef.current) {
      // Check if we have a valid signal
      if (!activeSignal) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      // Determine if we should trade based on signal type and recovery settings
      let shouldTrade = true;
      let recoveryNeeded = false;
      
      if (consecutiveLosses > 0) {
        const direction = activeSignal.extra.includes('OVER') ? 'OVER' :
                          activeSignal.extra.includes('UNDER') ? 'UNDER' :
                          activeSignal.extra.includes('ODD') ? 'ODD' :
                          activeSignal.extra.includes('EVEN') ? 'EVEN' : 'RISE';
        
        if (direction === 'OVER') {
          recoveryNeeded = consecutiveLosses >= botConfig.recoveryOverTrades;
        } else if (direction === 'UNDER') {
          recoveryNeeded = consecutiveLosses >= botConfig.recoveryUnderTrades;
        } else if (direction === 'ODD') {
          recoveryNeeded = consecutiveLosses >= botConfig.recoveryOddTrades;
        } else if (direction === 'EVEN') {
          recoveryNeeded = consecutiveLosses >= botConfig.recoveryEvenTrades;
        } else {
          recoveryNeeded = consecutiveLosses >= 3;
        }
        
        if (recoveryNeeded && !isInRecovery) {
          setIsInRecovery(true);
          toast.warning(`🔄 Entering recovery mode after ${consecutiveLosses} losses`);
        }
      }
      
      // Execute trade
      const result = await executeTrade(activeSignal, currentStakeAmount);
      
      if (result.won) {
        consecutiveLosses = 0;
        if (isInRecovery) {
          setIsInRecovery(false);
          toast.success('✅ Recovery successful! Back to normal mode');
        }
        currentStakeAmount = botConfig.stake;
        currentMartingaleStep = 0;
        setCurrentStake(botConfig.stake);
        setMartingaleStep(0);
      } else {
        consecutiveLosses++;
        localPnL -= currentStakeAmount;
        
        if (botConfig.martingaleMultiplier > 1 && currentMartingaleStep < botConfig.martingaleMaxSteps) {
          currentStakeAmount = currentStakeAmount * botConfig.martingaleMultiplier;
          currentMartingaleStep++;
          setCurrentStake(currentStakeAmount);
          setMartingaleStep(currentMartingaleStep);
          toast.info(`📈 Martingale step ${currentMartingaleStep}: stake $${currentStakeAmount.toFixed(2)}`);
        }
      }
      
      // Check TP/SL
      if (totalPnL + localPnL >= botConfig.takeProfit) {
        toast.success(`🎯 Take Profit reached! +$${(totalPnL + localPnL).toFixed(2)}`);
        break;
      }
      if (totalPnL + localPnL <= -botConfig.stopLoss) {
        toast.error(`🛑 Stop Loss reached! $${(totalPnL + localPnL).toFixed(2)}`);
        break;
      }
      
      // Check balance
      if (balance + localPnL < currentStakeAmount) {
        toast.error('Insufficient balance');
        break;
      }
      
      // Wait before next trade
      await new Promise(r => setTimeout(r, 2000));
    }
    
    setIsRunning(false);
    runningRef.current = false;
    setIsInRecovery(false);
  }, [isAuthorized, isRunning, activeSignal, balance, botConfig, totalPnL, executeTrade]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    toast.info('Bot stopped');
  }, []);

  // Handle market group change
  useEffect(() => {
    loadGroup(marketGroup);
  }, [marketGroup, loadGroup]);

  // Handle contract type change
  useEffect(() => {
    computeGlobalSignals();
  }, [contractType, computeGlobalSignals]);

  // Cleanup
  useEffect(() => {
    return () => {
      wsConnectionsRef.current.forEach((ws) => ws.close());
      wsConnectionsRef.current.clear();
    };
  }, []);

  const winRate = totalTrades > 0 ? ((winCount / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="space-y-6 max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-orange-400 to-purple-400 bg-clip-text text-transparent">
            ⚡ SIGNAL FORGE • AUTO TRADING BOT
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time signals + Automated trading with recovery & martingale
          </p>
        </div>
        <div className="flex gap-3">
          <div className="flex items-center gap-2 bg-muted/30 rounded-full px-4 py-2">
            <span className="text-xs font-medium">📊 CONTRACT</span>
            <Select value={contractType} onValueChange={(v: any) => setContractType(v)}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="overunder">OVER / UNDER</SelectItem>
                <SelectItem value="evenodd">EVEN / ODD</SelectItem>
                <SelectItem value="risefall">RISE / FALL</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2 bg-muted/30 rounded-full px-4 py-2">
            <span className="text-xs font-medium">🌐 MARKET</span>
            <Select value={marketGroup} onValueChange={(v: any) => setMarketGroup(v)}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ALL Markets</SelectItem>
                <SelectItem value="vol">Volatility</SelectItem>
                <SelectItem value="jump">Jump</SelectItem>
                <SelectItem value="bull">RDBULL</SelectItem>
                <SelectItem value="bear">RDBEAR</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Active Signal Display */}
      {activeSignal && (
        <Alert className={`border-2 ${activeSignal.name.includes('OVER') || activeSignal.name.includes('RISE') || activeSignal.name.includes('ODD') ? 'border-green-500/50 bg-green-500/10' : 'border-red-500/50 bg-red-500/10'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeSignal.name.includes('OVER') || activeSignal.name.includes('RISE') || activeSignal.name.includes('ODD') ? 
                <TrendingUp className="w-8 h-8 text-green-500" /> : 
                <TrendingDown className="w-8 h-8 text-red-500" />
              }
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-orange-500 text-black">ACTIVE SIGNAL</Badge>
                  <span className="font-mono text-sm">{activeSignal.symbol}</span>
                </div>
                <p className="text-xl font-bold mt-1">{activeSignal.name}</p>
                <p className="text-xs text-muted-foreground">{activeSignal.detail}</p>
              </div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-yellow-500">{(activeSignal.strength * 100).toFixed(0)}%</div>
              <div className="text-xs text-muted-foreground">Confidence</div>
            </div>
          </div>
        </Alert>
      )}

      {/* Signal Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading && topSignals.length === 0 ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="bg-gradient-to-br from-gray-900/50 to-gray-800/50">
              <CardHeader className="pb-2">
                <div className="h-6 w-24 bg-gray-700 rounded animate-pulse" />
                <div className="h-8 w-32 bg-gray-700 rounded animate-pulse mt-2" />
              </CardHeader>
              <CardContent>
                <div className="h-16 bg-gray-700 rounded animate-pulse" />
                <div className="h-4 w-28 bg-gray-700 rounded animate-pulse mt-3" />
              </CardContent>
            </Card>
          ))
        ) : (
          topSignals.map((sig, idx) => {
            const strengthPercent = (sig.strength * 100).toFixed(0);
            const isBullish = sig.name.includes('OVER') || sig.name.includes('RISE') || sig.name.includes('ODD');
            return (
              <Card
                key={`${sig.symbol}_${sig.type}_${idx}`}
                className={`relative overflow-hidden transition-all duration-300 cursor-pointer hover:scale-[1.02] ${
                  activeSignal === sig ? 'ring-2 ring-orange-500' : ''
                } ${isBullish ? 'bg-gradient-to-br from-green-900/30 to-gray-900/80' : 'bg-gradient-to-br from-red-900/30 to-gray-900/80'}`}
                onClick={() => setActiveSignal(sig)}
              >
                <div className={`absolute top-0 left-0 right-0 h-1 ${isBullish ? 'bg-gradient-to-r from-green-500 to-yellow-500' : 'bg-gradient-to-r from-red-500 to-orange-500'}`} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-orange-500 text-black font-bold text-[10px]">
                      #{idx + 1} · {sig.type}
                    </Badge>
                    <span className="text-xs font-mono text-muted-foreground">{sig.symbol}</span>
                  </div>
                  <CardTitle className={`text-xl font-bold ${isBullish ? 'text-green-400' : 'text-red-400'}`}>
                    {sig.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-xs text-muted-foreground">{sig.detail}</div>
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-yellow-500">Confidence</span>
                      <span className="font-mono font-bold">{strengthPercent}%</span>
                    </div>
                    <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${isBullish ? 'bg-gradient-to-r from-green-500 to-yellow-500' : 'bg-gradient-to-r from-red-500 to-orange-500'}`}
                        style={{ width: `${strengthPercent}%` }}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Bot Control Panel */}
      <Tabs defaultValue="controls" className="mt-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="controls">⚙️ Bot Controls</TabsTrigger>
          <TabsTrigger value="settings">🎛️ Settings</TabsTrigger>
          <TabsTrigger value="logs">📋 Trade Logs</TabsTrigger>
        </TabsList>
        
        <TabsContent value="controls" className="space-y-4 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Target className="w-4 h-4" /> Signal Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                {activeSignal ? (
                  <div>
                    <p className="text-lg font-bold">{activeSignal.name}</p>
                    <p className="text-xs text-muted-foreground">{activeSignal.symbol}</p>
                    <div className="mt-2 flex gap-2">
                      <Badge variant="outline" className="text-[10px]">
                        Strength: {(activeSignal.strength * 100).toFixed(0)}%
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm">Waiting for signal...</p>
                )}
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield className="w-4 h-4" /> Bot Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <Badge variant={isRunning ? "default" : "secondary"} className={isRunning ? "bg-green-500" : ""}>
                      {isRunning ? "🟢 RUNNING" : "⚫ STOPPED"}
                    </Badge>
                    {isInRecovery && (
                      <Badge variant="outline" className="ml-2 text-yellow-500">RECOVERY MODE</Badge>
                    )}
                    {martingaleStep > 0 && (
                      <Badge variant="outline" className="ml-2">Martingale x{martingaleStep}</Badge>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Current Stake</p>
                    <p className="font-mono font-bold">${currentStake.toFixed(2)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Zap className="w-4 h-4" /> Performance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <p className="text-xs text-muted-foreground">Win Rate</p>
                    <p className="font-mono font-bold text-green-500">{winRate}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/L</p>
                    <p className={`font-mono font-bold ${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                      ${totalPnL.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Trades</p>
                    <p className="font-mono font-bold">{totalTrades}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          
          <div className="flex gap-3">
            <Button
              onClick={startBot}
              disabled={isRunning || !activeSignal || !isAuthorized}
              className="flex-1 h-12 bg-green-600 hover:bg-green-700"
            >
              <Play className="w-5 h-5 mr-2" /> START AUTO TRADING
            </Button>
            <Button
              onClick={stopBot}
              disabled={!isRunning}
              variant="destructive"
              className="flex-1 h-12"
            >
              <StopCircle className="w-5 h-5 mr-2" /> STOP BOT
            </Button>
          </div>
        </TabsContent>
        
        <TabsContent value="settings" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Trading Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Base Stake ($)</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.35"
                    value={botConfig.stake}
                    onChange={(e) => setBotConfig({ ...botConfig, stake: parseFloat(e.target.value) || 0.5 })}
                    disabled={isRunning}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Minimum: $0.35</p>
                </div>
                <div>
                  <label className="text-sm font-medium">Martingale Multiplier</label>
                  <Input
                    type="number"
                    step="0.1"
                    min="1"
                    value={botConfig.martingaleMultiplier}
                    onChange={(e) => setBotConfig({ ...botConfig, martingaleMultiplier: parseFloat(e.target.value) || 2 })}
                    disabled={isRunning}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Max Martingale Steps</label>
                  <Input
                    type="number"
                    min="1"
                    max="10"
                    value={botConfig.martingaleMaxSteps}
                    onChange={(e) => setBotConfig({ ...botConfig, martingaleMaxSteps: parseInt(e.target.value) || 3 })}
                    disabled={isRunning}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Take Profit ($)</label>
                  <Input
                    type="number"
                    value={botConfig.takeProfit}
                    onChange={(e) => setBotConfig({ ...botConfig, takeProfit: parseFloat(e.target.value) || 10 })}
                    disabled={isRunning}
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">Stop Loss ($)</label>
                  <Input
                    type="number"
                    value={botConfig.stopLoss}
                    onChange={(e) => setBotConfig({ ...botConfig, stopLoss: parseFloat(e.target.value) || 5 })}
                    disabled={isRunning}
                    className="mt-1"
                  />
                </div>
              </div>
              
              <div className="border-t pt-4 mt-2">
                <h4 className="text-sm font-medium mb-3">Recovery Settings (Consecutive Losses to Enter Recovery)</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="text-xs text-muted-foreground">OVER Signal</label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={botConfig.recoveryOverTrades}
                      onChange={(e) => setBotConfig({ ...botConfig, recoveryOverTrades: parseInt(e.target.value) || 3 })}
                      disabled={isRunning}
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">UNDER Signal</label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={botConfig.recoveryUnderTrades}
                      onChange={(e) => setBotConfig({ ...botConfig, recoveryUnderTrades: parseInt(e.target.value) || 8 })}
                      disabled={isRunning}
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">EVEN Signal</label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={botConfig.recoveryEvenTrades}
                      onChange={(e) => setBotConfig({ ...botConfig, recoveryEvenTrades: parseInt(e.target.value) || 3 })}
                      disabled={isRunning}
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">ODD Signal</label>
                    <Input
                      type="number"
                      min="1"
                      max="20"
                      value={botConfig.recoveryOddTrades}
                      onChange={(e) => setBotConfig({ ...botConfig, recoveryOddTrades: parseInt(e.target.value) || 3 })}
                      disabled={isRunning}
                      className="mt-1 h-8 text-sm"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  After the specified number of consecutive losses, bot enters recovery mode and continues trading with adjusted strategy
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Trade History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[400px] overflow-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background">
                    <tr className="border-b">
                      <th className="text-left p-2">Time</th>
                      <th className="text-left p-2">Symbol</th>
                      <th className="text-left p-2">Signal</th>
                      <th className="text-left p-2">Dir</th>
                      <th className="text-right p-2">Stake</th>
                      <th className="text-center p-2">Result</th>
                      <th className="text-right p-2">P/L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tradeLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-muted-foreground">
                          No trades yet. Start the bot to see history.
                        </td>
                      </tr>
                    ) : (
                      tradeLogs.map((log) => (
                        <tr key={log.id} className="border-b hover:bg-muted/30">
                          <td className="p-2 font-mono text-xs">{log.time}</td>
                          <td className="p-2 font-mono text-xs">{log.symbol}</td>
                          <td className="p-2 text-xs">{log.signalType}</td>
                          <td className="p-2 text-xs">{log.direction}</td>
                          <td className="p-2 text-right font-mono text-xs">${log.stake.toFixed(2)}</td>
                          <td className="p-2 text-center">
                            <Badge variant={log.result === 'Win' ? 'default' : log.result === 'Loss' ? 'destructive' : 'secondary'} 
                                   className={log.result === 'Win' ? "bg-green-500" : ""}>
                              {log.result}
                            </Badge>
                          </td>
                          <td className={`p-2 text-right font-mono text-xs ${log.pnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {log.pnl >= 0 ? '+' : ''}{log.pnl.toFixed(2)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Footer */}
      <div className="flex justify-between items-center text-xs text-muted-foreground border-t border-border pt-4">
        <div>
          ⚡ Strategy: Signal-based auto trading | Recovery mode after losses | Martingale risk management
        </div>
        <div>
          Live markets: {connectedMarkets} | Balance: ${balance.toFixed(2)}
        </div>
      </div>
    </div>
  );
}

export default SignalForgeAutoBot;
