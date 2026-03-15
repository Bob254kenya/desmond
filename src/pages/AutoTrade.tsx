import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Download, Play, StopCircle, Pause, TrendingUp, TrendingDown, Activity, RefreshCw, Trash2, DollarSign, Sparkles, AlertCircle, BarChart3, Target, Percent, Layers } from 'lucide-react';

// Register ChartJS components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

// ==================== TYPES ====================
interface DigitAnalysis {
  digit: number;
  count: number;
  percentage: number;
  type: 'odd' | 'even';
}

interface MarketAnalysis {
  symbol: string;
  digits: DigitAnalysis[];
  mostAppearing: DigitAnalysis;
  secondMost: DigitAnalysis;
  leastAppearing: DigitAnalysis;
  lastDigits: number[];
  pattern: 'over' | 'under' | 'even' | 'odd' | 'neutral';
  recommendedBots: string[];
  entryPoints: number[];
  probabilityScore: number;
  volatility: number;
}

interface BotConfig {
  id: string;
  name: string;
  type: 'over3' | 'under6' | 'even' | 'odd' | 'over2';
  condition: string;
  contractType: string;
  barrier?: number;
  color: string;
  icon: React.ReactNode;
  strategy: string;
}

interface BotState extends BotConfig {
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  selectedMarket?: string;
  marketCondition: boolean;
  status: 'idle' | 'analyzing' | 'waiting' | 'trading' | 'recovery';
  consecutiveLosses: number;
  recoveryStep: number;
  lastTradeResult?: 'win' | 'loss';
  entrySignal: boolean;
  currentRecoveryMultiplier: number;
  expectedProbability: number;
}

interface TradeLog {
  id: string;
  time: string;
  market: string;
  botName: string;
  botType: string;
  stake: number;
  result: 'Pending' | 'Win' | 'Loss';
  pnl: number;
  entryDigits: string[];
  exitDigit?: number;
  recoveryStep: number;
}

// ==================== CONSTANTS ====================
const VOLATILITY_INDICES = [
  // Standard Volatility
  { value: 'R_10', label: 'Volatility 10 (1s)', category: 'Standard' },
  { value: 'R_25', label: 'Volatility 25 (1s)', category: 'Standard' },
  { value: 'R_50', label: 'Volatility 50 (1s)', category: 'Standard' },
  { value: 'R_75', label: 'Volatility 75 (1s)', category: 'Standard' },
  { value: 'R_100', label: 'Volatility 100 (1s)', category: 'Standard' },
  // Jump Indices
  { value: 'JD10', label: 'Jump 10', category: 'Jump' },
  { value: 'JD25', label: 'Jump 25', category: 'Jump' },
  { value: 'JD50', label: 'Jump 50', category: 'Jump' },
  { value: 'JD75', label: 'Jump 75', category: 'Jump' },
  { value: 'JD100', label: 'Jump 100', category: 'Jump' },
  // Bear/Bull
  { value: 'RDBEAR', label: 'Bear Market', category: 'Trend' },
  { value: 'RDBULL', label: 'Bull Market', category: 'Trend' },
  // 1 Second Variants
  { value: '1HZ10V', label: '1HZ Volatility 10', category: '1HZ' },
  { value: '1HZ25V', label: '1HZ Volatility 25', category: '1HZ' },
  { value: '1HZ50V', label: '1HZ Volatility 50', category: '1HZ' },
  { value: '1HZ75V', label: '1HZ Volatility 75', category: '1HZ' },
  { value: '1HZ100V', label: '1HZ Volatility 100', category: '1HZ' },
];

const BOT_CONFIGS: BotConfig[] = [
  {
    id: 'over3',
    name: 'OVER 3 RECOVERY BOT',
    type: 'over3',
    condition: 'Last digit > 3',
    contractType: 'DIGITOVER',
    barrier: 3,
    color: 'blue',
    icon: <TrendingUp className="w-4 h-4" />,
    strategy: 'Trades when digit exceeds 3. Recovery: 2x multiplier on loss. Max 3 recovery steps.'
  },
  {
    id: 'under6',
    name: 'UNDER 6 RECOVERY BOT',
    type: 'under6',
    condition: 'Last digit < 6',
    contractType: 'DIGITUNDER',
    barrier: 6,
    color: 'orange',
    icon: <TrendingDown className="w-4 h-4" />,
    strategy: 'Trades when digit below 6. Recovery: 2x multiplier on loss. Max 3 recovery steps.'
  },
  {
    id: 'even',
    name: 'EVEN BOT (REVERSE STRATEGY)',
    type: 'even',
    condition: 'Even digits',
    contractType: 'DIGITEVEN',
    color: 'green',
    icon: <Activity className="w-4 h-4" />,
    strategy: 'Reverse strategy: Trades EVEN when last 3 digits are ODD. 500 tick analysis.'
  },
  {
    id: 'odd',
    name: 'ODD BOT (REVERSE STRATEGY)',
    type: 'odd',
    condition: 'Odd digits',
    contractType: 'DIGITODD',
    color: 'purple',
    icon: <Activity className="w-4 h-4" />,
    strategy: 'Reverse strategy: Trades ODD when last 3 digits are EVEN. 500 tick analysis.'
  },
  {
    id: 'over2',
    name: 'OVER 2 RECOVERY ODD/EVEN',
    type: 'over2',
    condition: 'Last digit > 2',
    contractType: 'DIGITOVER',
    barrier: 2,
    color: 'yellow',
    icon: <Target className="w-4 h-4" />,
    strategy: 'Trades when digit > 2 with odd/even pattern analysis over 500 ticks.'
  }
];

// ==================== UTILITIES ====================
const getDigit = (price: number): number => Math.floor(price) % 10;
const waitForTick = (symbol: string): Promise<number> => {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve(getDigit(data.tick.quote));
      }
    });
  });
};

// ==================== MAIN COMPONENT ====================
export default function AutoTradeSystem() {
  const { isAuthorized, balance } = useAuth();
  
  // State
  const [selectedMarket, setSelectedMarket] = useState<string>('R_10');
  const [marketData, setMarketData] = useState<Record<string, MarketAnalysis>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalSettings, setGlobalSettings] = useState({
    baseStake: 0.5,
    recoveryMultiplier: 2,
    maxRecoverySteps: 3,
    duration: 1,
  });
  const [recoveryMode, setRecoveryMode] = useState(true);
  const [autoSelectMarket, setAutoSelectMarket] = useState(true);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [showChart, setShowChart] = useState(true);
  
  // Refs
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();

  // Bots state
  const [bots, setBots] = useState<BotState[]>(() => 
    BOT_CONFIGS.map(config => ({
      ...config,
      isRunning: false,
      isPaused: false,
      currentStake: globalSettings.baseStake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      marketCondition: false,
      status: 'idle',
      consecutiveLosses: 0,
      recoveryStep: 0,
      entrySignal: false,
      currentRecoveryMultiplier: 1,
      expectedProbability: 0
    }))
  );

  // ==================== MARKET ANALYSIS ====================
  const analyzeDigits = useCallback((digits: number[]): DigitAnalysis[] => {
    const counts: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) counts[i] = 0;
    digits.forEach(d => counts[d]++);
    
    return Object.entries(counts).map(([digit, count]) => ({
      digit: parseInt(digit),
      count,
      percentage: (count / digits.length) * 100,
      type: parseInt(digit) % 2 === 0 ? 'even' : 'odd'
    })).sort((a, b) => b.count - a.count);
  }, []);

  const analyzeMarket = useCallback((symbol: string, digits: number[]): MarketAnalysis => {
    if (digits.length < 100) {
      return {
        symbol,
        digits: [],
        mostAppearing: { digit: 0, count: 0, percentage: 0, type: 'even' },
        secondMost: { digit: 0, count: 0, percentage: 0, type: 'even' },
        leastAppearing: { digit: 0, count: 0, percentage: 0, type: 'even' },
        lastDigits: digits.slice(-10),
        pattern: 'neutral',
        recommendedBots: [],
        entryPoints: [],
        probabilityScore: 0,
        volatility: 0
      };
    }

    const analysis = analyzeDigits(digits);
    const lastDigits = digits.slice(-10);
    const volatility = Math.sqrt(digits.map(d => Math.pow(d - 4.5, 2)).reduce((a, b) => a + b) / digits.length);
    
    // Determine pattern
    const lastThree = digits.slice(-3);
    const pattern = lastThree.every(d => d > 4) ? 'over' :
                    lastThree.every(d => d < 5) ? 'under' :
                    lastThree.every(d => d % 2 === 0) ? 'even' :
                    lastThree.every(d => d % 2 === 1) ? 'odd' : 'neutral';

    // Recommend bots based on analysis
    const recommendedBots: string[] = [];
    const mostType = analysis[0].type;
    const leastType = analysis[analysis.length - 1].type;
    
    if (analysis[0].percentage > 12) {
      if (mostType === 'odd') recommendedBots.push('odd');
      if (mostType === 'even') recommendedBots.push('even');
    }
    
    if (analysis[0].digit > 6 && analysis[0].percentage > 11) recommendedBots.push('over3', 'over2');
    if (analysis[analysis.length - 1].digit < 3 && analysis[analysis.length - 1].percentage < 9) recommendedBots.push('under6');

    // Calculate entry points based on patterns
    const entryPoints = digits.slice(-5).filter((_, i, arr) => 
      i > 0 && Math.abs(arr[i] - arr[i - 1]) > 3
    );

    // Calculate probability score
    const probabilityScore = (analysis[0].percentage / analysis[analysis.length - 1].percentage) * 100;

    return {
      symbol,
      digits: analysis,
      mostAppearing: analysis[0],
      secondMost: analysis[1] || { digit: 0, count: 0, percentage: 0, type: 'even' },
      leastAppearing: analysis[analysis.length - 1],
      lastDigits,
      pattern,
      recommendedBots: [...new Set(recommendedBots)],
      entryPoints,
      probabilityScore: Math.min(probabilityScore, 100),
      volatility
    };
  }, [analyzeDigits]);

  // ==================== SCAN MARKETS ====================
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    
    try {
      const results: Record<string, MarketAnalysis> = {};
      const total = VOLATILITY_INDICES.length;
      
      for (let i = 0; i < VOLATILITY_INDICES.length; i++) {
        const market = VOLATILITY_INDICES[i].value;
        
        // Collect 1000 ticks
        const ticks: number[] = [];
        let count = 0;
        
        await new Promise<void>((resolve) => {
          const unsubscribe = derivApi.onMessage((data: any) => {
            if (data.tick && data.tick.symbol === market) {
              ticks.push(getDigit(data.tick.quote));
              count++;
              setScanProgress(((i + count/1000) / total) * 100);
              
              if (count >= 1000) {
                unsubscribe();
                marketDigitsRef.current[market] = ticks;
                results[market] = analyzeMarket(market, ticks);
                resolve();
              }
            }
          });
          
          derivApi.subscribeTicks(market);
        });
      }
      
      setMarketData(results);
      
      // Auto-select best market if enabled
      if (autoSelectMarket) {
        const bestMarket = Object.entries(results)
          .sort((a, b) => b[1].probabilityScore - a[1].probabilityScore)[0];
        if (bestMarket) {
          setSelectedMarket(bestMarket[0]);
          toast.success(`Best market selected: ${VOLATILITY_INDICES.find(m => m.value === bestMarket[0])?.label}`);
        }
      }
      
      toast.success(`Scan complete! Analyzed ${total} markets`);
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, analyzeMarket, autoSelectMarket]);

  // ==================== BOT ENTRY CONDITIONS ====================
  const checkEntryCondition = useCallback((botType: string, digits: number[]): boolean => {
    if (digits.length < 3) return false;
    
    const lastThree = digits.slice(-3);
    const lastTwo = digits.slice(-2);
    
    switch(botType) {
      case 'over3':
        return lastThree.every(d => d <= 2); // Below 3 triggers OVER
      case 'under6':
        return lastThree.every(d => d >= 7); // Above 6 triggers UNDER
      case 'even':
        return lastThree.every(d => d % 2 === 1); // All ODD triggers EVEN (reverse)
      case 'odd':
        return lastThree.every(d => d % 2 === 0); // All EVEN triggers ODD (reverse)
      case 'over2':
        // Combined strategy: last digit > 2 with pattern analysis
        const lastFive = digits.slice(-5);
        const oddCount = lastFive.filter(d => d % 2 === 1).length;
        return lastTwo.every(d => d <= 2) || oddCount >= 4; // Below 2 or strong odd trend
      default:
        return false;
    }
  }, []);

  // ==================== START BOT ====================
  const startBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;
    
    if (balance < globalSettings.baseStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      return;
    }

    const market = autoSelectMarket ? 
      Object.entries(marketData).sort((a, b) => b[1].probabilityScore - a[1].probabilityScore)[0]?.[0] :
      selectedMarket;

    if (!market || !marketData[market]) {
      toast.error('Please scan markets first');
      return;
    }

    setBots(prev => prev.map(b => {
      if (b.id === botId) {
        return {
          ...b,
          isRunning: true,
          isPaused: false,
          selectedMarket: market,
          marketCondition: true,
          status: 'analyzing',
          expectedProbability: marketData[market].probabilityScore,
          currentStake: globalSettings.baseStake,
          recoveryStep: 0,
          currentRecoveryMultiplier: 1
        };
      }
      return b;
    }));

    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    // Start trading loop
    runBotLoop(botId);
  }, [bots, isAuthorized, balance, globalSettings, autoSelectMarket, selectedMarket, marketData]);

  // ==================== BOT TRADING LOOP ====================
  const runBotLoop = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.selectedMarket) return;

    let stake = globalSettings.baseStake;
    let recoveryStep = 0;
    let consecutiveLosses = 0;
    let totalPnl = bot.totalPnl;

    while (botRunningRefs.current[botId]) {
      // Check pause state
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Get latest digits
      const marketDigits = marketDigitsRef.current[bot.selectedMarket] || [];
      const entrySignal = checkEntryCondition(bot.type, marketDigits);

      // Update UI with signal
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, entrySignal, status: entrySignal ? 'trading' : 'waiting' } : b
      ));

      // Wait for entry signal
      if (!entrySignal) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Wait for next tick to enter
      await waitForTick(bot.selectedMarket);

      if (activeTradeId) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      try {
        // Prepare contract
        const params: any = {
          contract_type: bot.contractType,
          symbol: bot.selectedMarket,
          duration: globalSettings.duration,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (bot.barrier !== undefined) {
          params.barrier = bot.barrier.toString();
        }

        // Get entry digits
        const entryDigits = marketDigits.slice(-3).map(d => d.toString());

        const tradeId = `${botId}-${Date.now()}`;
        setActiveTradeId(tradeId);

        // Add to trade log
        const newTrade: TradeLog = {
          id: tradeId,
          time: new Date().toLocaleTimeString(),
          market: bot.selectedMarket,
          botName: bot.name,
          botType: bot.type,
          stake,
          result: 'Pending',
          pnl: 0,
          entryDigits,
          recoveryStep
        };

        setTrades(prev => [newTrade, ...prev].slice(0, 50));

        // Execute trade
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        // Update trade log
        setTrades(prev => prev.map(t => 
          t.id === tradeId ? { 
            ...t, 
            result: won ? 'Win' : 'Loss', 
            pnl,
            exitDigit: marketDigits[marketDigits.length - 1]
          } : t
        ));

        // Update bot stats
        totalPnl += pnl;
        
        if (won) {
          consecutiveLosses = 0;
          recoveryStep = 0;
          stake = globalSettings.baseStake;
        } else {
          consecutiveLosses++;
          if (recoveryMode && recoveryStep < globalSettings.maxRecoverySteps) {
            recoveryStep++;
            stake = globalSettings.baseStake * Math.pow(globalSettings.recoveryMultiplier, recoveryStep);
          } else {
            recoveryStep = 0;
            stake = globalSettings.baseStake;
          }
        }

        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: b.trades + 1,
              wins: b.wins + (won ? 1 : 0),
              losses: b.losses + (won ? 0 : 1),
              currentStake: stake,
              consecutiveLosses,
              recoveryStep,
              currentRecoveryMultiplier: Math.pow(globalSettings.recoveryMultiplier, recoveryStep),
              lastTradeResult: won ? 'win' : 'loss',
              status: 'waiting',
              entrySignal: false
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 1000));

      } catch (err) {
        console.error('Trade error:', err);
        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Cleanup
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, isRunning: false, status: 'idle' } : b
    ));
  }, [bots, globalSettings, recoveryMode, activeTradeId, checkEntryCondition]);

  // ==================== STOP BOT ====================
  const stopBot = useCallback((botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, isRunning: false, isPaused: false, status: 'idle' } : b
    ));
  }, []);

  const pauseBot = useCallback((botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b
    ));
  }, []);

  const stopAllBots = useCallback(() => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ ...b, isRunning: false, isPaused: false, status: 'idle' })));
  }, [bots]);

  // ==================== EXPORT DATA ====================
  const exportToCSV = useCallback(() => {
    const headers = ['Time', 'Bot', 'Market', 'Stake', 'Result', 'P&L', 'Entry Digits', 'Exit Digit', 'Recovery Step'];
    const csvData = trades.map(t => [
      t.time,
      t.botName,
      t.market,
      t.stake,
      t.result,
      t.pnl,
      t.entryDigits.join(','),
      t.exitDigit || '',
      t.recoveryStep
    ]);
    
    const csv = [headers, ...csvData].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trades-${new Date().toISOString()}.csv`;
    a.click();
    
    toast.success('Trade log exported');
  }, [trades]);

  // ==================== MEMOIZED VALUES ====================
  const currentMarketAnalysis = useMemo(() => 
    marketData[selectedMarket] || null,
    [marketData, selectedMarket]
  );

  const chartData = useMemo(() => {
    const digits = marketDigitsRef.current[selectedMarket] || [];
    const last100 = digits.slice(-100);
    
    return {
      labels: last100.map((_, i) => i),
      datasets: [
        {
          label: 'Digit Value',
          data: last100,
          borderColor: 'rgb(34, 197, 94)',
          backgroundColor: 'rgba(34, 197, 94, 0.1)',
          fill: true,
          tension: 0.4
        }
      ]
    };
  }, [selectedMarket, marketDigitsRef.current]);

  // ==================== RENDER ====================
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900">
      <div className="container mx-auto p-4 space-y-4 max-w-7xl">
        {/* Header */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-gray-800/50 backdrop-blur-xl border border-gray-700 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-blue-400 bg-clip-text text-transparent">
                🚀 Deriv Multi-Bot Trading System
              </h1>
              <p className="text-sm text-gray-400 mt-1">
                Automated trading with advanced digit analysis and recovery strategies
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={scanAllMarkets}
                disabled={isScanning}
                className="border-green-500/30 text-green-400 hover:bg-green-500/20"
              >
                {isScanning ? (
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Activity className="w-4 h-4 mr-2" />
                )}
                {isScanning ? 'Scanning...' : 'Scan All Markets'}
              </Button>
              <Button
                variant="outline"
                onClick={exportToCSV}
                disabled={trades.length === 0}
                className="border-blue-500/30 text-blue-400 hover:bg-blue-500/20"
              >
                <Download className="w-4 h-4 mr-2" />
                Export CSV
              </Button>
              <Button
                variant="destructive"
                onClick={stopAllBots}
                disabled={!bots.some(b => b.isRunning)}
                className="bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
              >
                <StopCircle className="w-4 h-4 mr-2" />
                Stop All
              </Button>
            </div>
          </div>

          {/* Scan Progress */}
          {isScanning && (
            <div className="mb-4">
              <div className="flex justify-between text-sm text-gray-400 mb-1">
                <span>Scanning markets...</span>
                <span>{Math.round(scanProgress)}%</span>
              </div>
              <Progress value={scanProgress} className="h-2" />
            </div>
          )}

          {/* Strategy Summary */}
          <Card className="bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-blue-500/20">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="w-4 h-4 text-yellow-400" />
                <span className="text-gray-300">Recommended Strategy:</span>
                {currentMarketAnalysis ? (
                  <span className="text-green-400 font-semibold">
                    {currentMarketAnalysis.recommendedBots.map(bot => 
                      BOT_CONFIGS.find(b => b.id === bot)?.name
                    ).filter(Boolean).join(' • ') || 'Neutral market'}
                  </span>
                ) : (
                  <span className="text-gray-400">Scan markets for recommendations</span>
                )}
              </div>
            </CardContent>
          </Card>
        </motion.div>

        {/* Main Content */}
        <div className="grid grid-cols-12 gap-4">
          {/* Left Column - Market Analysis */}
          <div className="col-span-3 space-y-4">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader className="p-3 border-b border-gray-700">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4 text-green-400" />
                  Market Selection
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3">
                <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                  <SelectTrigger className="bg-gray-900 border-gray-700">
                    <SelectValue placeholder="Select market" />
                  </SelectTrigger>
                  <SelectContent>
                    {VOLATILITY_INDICES.map(market => (
                      <SelectItem key={market.value} value={market.value}>
                        <span className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${
                            marketData[market.value]?.probabilityScore > 70 ? 'bg-green-400' :
                            marketData[market.value]?.probabilityScore > 40 ? 'bg-yellow-400' : 'bg-gray-400'
                          }`} />
                          {market.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-gray-400">Auto-select best market</span>
                  <Switch
                    checked={autoSelectMarket}
                    onCheckedChange={setAutoSelectMarket}
                  />
                </div>
              </CardContent>
            </Card>

            {currentMarketAnalysis && (
              <>
                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader className="p-3 border-b border-gray-700">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Percent className="w-4 h-4 text-green-400" />
                      Digit Analysis (1000 ticks)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    <div className="space-y-2">
                      <div className="text-xs text-gray-400 mb-2">
                        Pattern: <span className="font-bold text-green-400 capitalize">{currentMarketAnalysis.pattern}</span>
                      </div>
                      <div className="grid grid-cols-5 gap-1">
                        {currentMarketAnalysis.digits.slice(0, 5).map((digit, i) => (
                          <div key={i} className="text-center p-1 bg-gray-900 rounded">
                            <div className="text-sm font-bold text-green-400">{digit.digit}</div>
                            <div className="text-[8px] text-gray-400">{digit.percentage.toFixed(1)}%</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3">
                        <div className="text-xs text-gray-400">Most Appearing: <span className="text-green-400">{currentMarketAnalysis.mostAppearing.digit}</span> ({currentMarketAnalysis.mostAppearing.percentage.toFixed(1)}%)</div>
                        <div className="text-xs text-gray-400">Least Appearing: <span className="text-red-400">{currentMarketAnalysis.leastAppearing.digit}</span> ({currentMarketAnalysis.leastAppearing.percentage.toFixed(1)}%)</div>
                        <div className="text-xs text-gray-400">Probability Score: <span className="text-yellow-400">{currentMarketAnalysis.probabilityScore.toFixed(1)}%</span></div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-gray-800/50 border-gray-700">
                  <CardHeader className="p-3 border-b border-gray-700">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Target className="w-4 h-4 text-green-400" />
                      Entry Points
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-3">
                    <div className="space-y-2">
                      {currentMarketAnalysis.entryPoints.slice(0, 5).map((point, i) => (
                        <div key={i} className="flex items-center justify-between text-xs bg-gray-900 p-2 rounded">
                          <span className="text-gray-400">Entry {i + 1}</span>
                          <span className="font-bold text-green-400">{point}</span>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Center Column - Bots Grid */}
          <div className="col-span-6 space-y-4">
            {showChart && currentMarketAnalysis && (
              <Card className="bg-gray-800/50 border-gray-700">
                <CardHeader className="p-3 border-b border-gray-700">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-400" />
                    Live Digit Chart (Last 100 ticks)
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 h-[200px]">
                  <Line 
                    data={chartData} 
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      scales: {
                        y: {
                          min: 0,
                          max: 9,
                          grid: { color: 'rgba(255,255,255,0.1)' }
                        },
                        x: {
                          display: false
                        }
                      },
                      plugins: {
                        legend: { display: false }
                      }
                    }}
                  />
                </CardContent>
              </Card>
            )}

            <div className="grid grid-cols-2 gap-3">
              {bots.map((bot) => (
                <motion.div
                  key={bot.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className={`bg-gray-800/50 backdrop-blur border rounded-lg p-3 ${
                    bot.isRunning ? `border-${bot.color}-400 ring-2 ring-${bot.color}-400/20` : 'border-gray-700'
                  } ${bot.entrySignal ? `ring-2 ring-yellow-500/50` : ''}`}
                >
                  {/* Bot Header */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg bg-${bot.color}-500/20 text-${bot.color}-400`}>
                        {bot.icon}
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-white">{bot.name}</h4>
                        <p className="text-[8px] text-gray-400">{bot.condition}</p>
                      </div>
                    </div>
                    <Badge className={`text-[8px] ${
                      bot.isRunning ? `bg-${bot.color}-500/20 text-${bot.color}-400` : 'bg-gray-500/20 text-gray-400'
                    }`}>
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-1 text-[10px] mb-2 bg-gray-900/50 p-2 rounded">
                    <div>
                      <span className="text-gray-400">P&L:</span>
                      <span className={`ml-1 font-mono ${
                        bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-gray-400'
                      }`}>
                        ${bot.totalPnl.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">W:</span>
                      <span className="ml-1 text-green-400">{bot.wins}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">L:</span>
                      <span className="ml-1 text-red-400">{bot.losses}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Win%:</span>
                      <span className="ml-1 text-yellow-400">
                        {bot.trades > 0 ? ((bot.wins / bot.trades) * 100).toFixed(0) : 0}%
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Stake:</span>
                      <span className="ml-1 text-green-400">${bot.currentStake.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Step:</span>
                      <span className="ml-1 text-orange-400">{bot.recoveryStep}</span>
                    </div>
                  </div>

                  {/* Market Info */}
                  {bot.selectedMarket && (
                    <div className="bg-gray-900/50 rounded p-1.5 mb-2 text-[8px]">
                      <div className="flex justify-between">
                        <span className="text-gray-400">Market:</span>
                        <span className="text-green-400">
                          {VOLATILITY_INDICES.find(m => m.value === bot.selectedMarket)?.label}
                        </span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-gray-400">Signal:</span>
                        <span className={bot.entrySignal ? 'text-yellow-400 font-bold' : 'text-gray-500'}>
                          {bot.entrySignal ? '✅ READY' : '❌ WAITING'}
                        </span>
                      </div>
                    </div>
                  )}

                  {/* Controls */}
                  <div className="flex gap-1">
                    {!bot.isRunning ? (
                      <Button
                        onClick={() => startBot(bot.id)}
                        disabled={!isAuthorized || !marketData[selectedMarket] || activeTradeId !== null}
                        size="sm"
                        className={`flex-1 h-7 text-xs bg-${bot.color}-500/20 hover:bg-${bot.color}-500/30 text-${bot.color}-400 border border-${bot.color}-500/30`}
                      >
                        <Play className="w-3 h-3 mr-1" /> Start
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => pauseBot(bot.id)}
                          size="sm"
                          variant="outline"
                          className="flex-1 h-7 text-xs border-gray-600 text-gray-300 hover:bg-gray-700"
                        >
                          <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                        </Button>
                        <Button
                          onClick={() => stopBot(bot.id)}
                          size="sm"
                          variant="destructive"
                          className="flex-1 h-7 text-xs bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30"
                        >
                          <StopCircle className="w-3 h-3 mr-1" /> Stop
                        </Button>
                      </>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>
          </div>

          {/* Right Column - Settings & Trade Log */}
          <div className="col-span-3 space-y-4">
            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader className="p-3 border-b border-gray-700">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4 text-green-400" />
                  Global Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-3">
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Base Stake ($)</label>
                  <input
                    type="number"
                    value={globalSettings.baseStake}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, baseStake: parseFloat(e.target.value) || 0.5 }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-green-400"
                    step="0.1"
                    min="0.1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Recovery Multiplier</label>
                  <input
                    type="number"
                    value={globalSettings.recoveryMultiplier}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, recoveryMultiplier: parseFloat(e.target.value) || 2 }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-orange-400"
                    step="0.1"
                    min="1.1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">Max Recovery Steps</label>
                  <input
                    type="number"
                    value={globalSettings.maxRecoverySteps}
                    onChange={(e) => setGlobalSettings(prev => ({ ...prev, maxRecoverySteps: parseInt(e.target.value) || 3 }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-sm text-yellow-400"
                    min="1"
                    max="5"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Recovery Mode</span>
                  <Switch
                    checked={recoveryMode}
                    onCheckedChange={setRecoveryMode}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">Show Chart</span>
                  <Switch
                    checked={showChart}
                    onCheckedChange={setShowChart}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="bg-gray-800/50 border-gray-700">
              <CardHeader className="p-3 border-b border-gray-700">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Activity className="w-4 h-4 text-green-400" />
                  Trade Log ({trades.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 max-h-[400px] overflow-y-auto">
                <div className="space-y-1">
                  {trades.length === 0 ? (
                    <p className="text-xs text-gray-500 text-center py-4">No trades yet</p>
                  ) : (
                    trades.map((trade, idx) => (
                      <motion.div
                        key={trade.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.05 }}
                        className="text-[10px] bg-gray-900/50 p-2 rounded border border-gray-700"
                      >
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-gray-400">{trade.time}</span>
                          <Badge className={`text-[6px] ${
                            trade.result === 'Win' ? 'bg-green-500/20 text-green-400' :
                            trade.result === 'Loss' ? 'bg-red-500/20 text-red-400' :
                            'bg-yellow-500/20 text-yellow-400'
                          }`}>
                            {trade.result}
                          </Badge>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-400">{trade.botName}</span>
                          <span className="text-green-400">${trade.stake.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="text-gray-500">Entry: {trade.entryDigits.join(',')}</span>
                          <span className={trade.pnl >= 0 ? 'text-green-400' : 'text-red-400'}>
                            {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(2)}
                          </span>
                        </div>
                      </motion.div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Strategy Details */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader className="p-3 border-b border-gray-700">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-yellow-400" />
              Bot Strategies
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3">
            <div className="grid grid-cols-5 gap-2">
              {BOT_CONFIGS.map(bot => (
                <div key={bot.id} className="text-[10px] bg-gray-900/50 p-2 rounded">
                  <div className={`font-bold text-${bot.color}-400 mb-1`}>{bot.name}</div>
                  <p className="text-gray-400">{bot.strategy}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
