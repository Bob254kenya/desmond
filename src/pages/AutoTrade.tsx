import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Play, StopCircle, TrendingUp, TrendingDown, CircleDot, RefreshCw, 
  Loader2, Activity, Target, Clock, Hash, Zap, Volume2, VolumeX, 
  Timer, XCircle, Settings, ChevronDown, ChevronUp, DollarSign, 
  Plus, Minus, Brain, Scan, Trash2, Download, Upload, Copy, Eye,
  BarChart3, History, Gauge, ListChecks, AlertCircle, CheckCircle2,
  Waves, Wind, Flame, Snowflake, Wifi, WifiOff
} from 'lucide-react';

// ==================== CONSTANTS ====================

const APP_ID = 1089; // Deriv test app ID
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`;

const MARKET_GROUPS = {
  vol: ["1HZ10V", "R_10", "1HZ25V", "R_25", "1HZ50V", "R_50", "1HZ75V", "R_75", "1HZ100V", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const ALL_MARKETS = [...MARKET_GROUPS.vol, ...MARKET_GROUPS.jump, ...MARKET_GROUPS.bull, ...MARKET_GROUPS.bear];

// ==================== TYPES ====================

interface MarketConnection {
  ws: WebSocket | null;
  ticks: number[];
  status: 'connecting' | 'live' | 'error' | 'offline';
  lastUpdate: number;
}

interface MarketAnalysis {
  symbol: string;
  counts: number[];
  percentages: {
    [key: number]: number;
    low012: number;
    high789: number;
    even: number;
    odd: number;
  };
  mostFrequent: number;
  secondMostFrequent: number;
  leastFrequent: number;
  condition: 'TYPE_A' | 'TYPE_B' | 'EVEN' | 'ODD' | 'NONE';
  entry: number | 'EVEN' | 'ODD';
  confidence: number;
  volatility: VolatilityAnalysis;
  lastDigits: number[];
}

interface VolatilityAnalysis {
  averageChange: number;
  volatilityIndex: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  priceRange: { min: number; max: number };
  recentSpikes: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  volatilityScore: number;
}

interface Bot {
  id: string;
  market: string;
  type: 'TYPE_A' | 'TYPE_B' | 'EVEN' | 'ODD';
  name: string;
  entryType: 'digit' | 'even' | 'odd';
  entryValue: number | 'EVEN' | 'ODD';
  activeDigit: number;
  
  // User configurable
  stake: number;
  duration: number;
  multiplier: number;
  maxSteps: number;
  takeProfit: number;
  stopLoss: number;
  
  // Volatility settings
  checkVolatility: boolean;
  minVolatility: number;
  maxVolatility: number;
  
  // State
  isRunning: boolean;
  status: 'idle' | 'watching' | 'trading' | 'recovery' | 'completed' | 'waiting';
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  currentRun: number;
  recoveryStep: number;
  lastVolatilityCheck: VolatilityAnalysis | null;
  
  // UI
  expanded: boolean;
}

interface Trade {
  id: string;
  time: string;
  botName: string;
  market: string;
  entry: string;
  stake: number;
  result: 'win' | 'loss' | 'pending';
  profit: number;
  digit?: number;
  volatility?: number;
}

// ==================== HELPER FUNCTIONS ====================

const getLastDigit = (price: number): number => {
  return parseInt(price.toFixed(2).slice(-1));
};

const analyzeVolatility = (ticks: number[]): VolatilityAnalysis => {
  if (ticks.length < 50) {
    return {
      averageChange: 0,
      volatilityIndex: 'LOW',
      priceRange: { min: 0, max: 0 },
      recentSpikes: 0,
      trend: 'SIDEWAYS',
      volatilityScore: 0
    };
  }

  const recent = ticks.slice(-50);
  let changes = [];
  let spikes = 0;
  
  for (let i = 1; i < recent.length; i++) {
    const change = Math.abs(recent[i] - recent[i-1]);
    changes.push(change);
    if (change > 5) spikes++;
  }
  
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  
  let volatilityIndex: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
  let volatilityScore = 0;
  
  if (avgChange < 0.5) {
    volatilityIndex = 'LOW';
    volatilityScore = 25;
  } else if (avgChange < 1.5) {
    volatilityIndex = 'MEDIUM';
    volatilityScore = 50;
  } else if (avgChange < 3) {
    volatilityIndex = 'HIGH';
    volatilityScore = 75;
  } else {
    volatilityIndex = 'EXTREME';
    volatilityScore = 100;
  }
  
  // Determine trend
  const first10 = recent.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const last10 = recent.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const trend = last10 > first10 ? 'UP' : last10 < first10 ? 'DOWN' : 'SIDEWAYS';
  
  return {
    averageChange: avgChange,
    volatilityIndex,
    priceRange: { min: Math.min(...recent), max: Math.max(...recent) },
    recentSpikes: spikes,
    trend,
    volatilityScore
  };
};

const analyzeMarket = (symbol: string, ticks: number[]): MarketAnalysis => {
  if (ticks.length < 100) {
    return {
      symbol,
      counts: Array(10).fill(0),
      percentages: { low012: 0, high789: 0, even: 0, odd: 0 },
      mostFrequent: 0,
      secondMostFrequent: 0,
      leastFrequent: 0,
      condition: 'NONE',
      entry: 0,
      confidence: 0,
      volatility: analyzeVolatility(ticks),
      lastDigits: ticks.slice(-30)
    };
  }

  const last1000 = ticks.slice(-1000);
  const counts = Array(10).fill(0);
  
  last1000.forEach(tick => {
    const digit = getLastDigit(tick);
    counts[digit]++;
  });
  
  const low012 = (counts[0] + counts[1] + counts[2]) / 10;
  const high789 = (counts[7] + counts[8] + counts[9]) / 10;
  
  let even = 0, odd = 0;
  [0,2,4,6,8].forEach(d => even += counts[d]);
  [1,3,5,7,9].forEach(d => odd += counts[d]);
  
  even = even / 10;
  odd = odd / 10;
  
  // Find most, second most, and least frequent
  const sorted = counts
    .map((count, digit) => ({ digit, count }))
    .sort((a, b) => b.count - a.count);
  
  const mostFrequent = sorted[0].digit;
  const secondMostFrequent = sorted[1].digit;
  const leastFrequent = sorted[sorted.length - 1].digit;
  
  let condition: 'TYPE_A' | 'TYPE_B' | 'EVEN' | 'ODD' | 'NONE' = 'NONE';
  let entry: number | 'EVEN' | 'ODD' = 0;
  let confidence = 0;
  
  if (low012 < 10) {
    condition = 'TYPE_A';
    const lowDigits = [0,1,2];
    let best = lowDigits.reduce((a,b) => counts[a] > counts[b] ? a : b);
    entry = best;
    confidence = 100 - low012 * 2;
  }
  else if (high789 < 10) {
    condition = 'TYPE_B';
    const highDigits = [7,8,9];
    let best = highDigits.reduce((a,b) => counts[a] > counts[b] ? a : b);
    entry = best;
    confidence = 100 - high789 * 2;
  }
  else if (even > 55) {
    condition = 'EVEN';
    entry = 'EVEN';
    confidence = even;
  }
  else if (odd > 55) {
    condition = 'ODD';
    entry = 'ODD';
    confidence = odd;
  }
  
  const percentages: any = { low012, high789, even, odd };
  for (let i = 0; i < 10; i++) percentages[i] = counts[i] / 10;
  
  return {
    symbol,
    counts,
    percentages,
    mostFrequent,
    secondMostFrequent,
    leastFrequent,
    condition,
    entry,
    confidence,
    volatility: analyzeVolatility(ticks),
    lastDigits: ticks.slice(-30).map(getLastDigit)
  };
};

// ==================== MAIN COMPONENT ====================

export default function TradingBot() {
  const { isAuthorized, balance } = useAuth();
  
  // State
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [connections, setConnections] = useState<Record<string, MarketConnection>>({});
  const [analyses, setAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [activeTrade, setActiveTrade] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const [autoCreate, setAutoCreate] = useState(true);
  const [selectedTab, setSelectedTab] = useState('bots');
  const [globalVolatilityCheck, setGlobalVolatilityCheck] = useState(true);
  const [tickCount, setTickCount] = useState(1000);
  const [marketGroup, setMarketGroup] = useState<'vol' | 'jump' | 'bull' | 'bear'>('vol');
  
  // Defaults
  const [defStake, setDefStake] = useState(1);
  const [defDuration, setDefDuration] = useState(5);
  const [defMult, setDefMult] = useState(2);
  const [defSteps, setDefSteps] = useState(3);
  const [defTP, setDefTP] = useState(10);
  const [defSL, setDefSL] = useState(25);
  const [defMinVol, setDefMinVol] = useState(0);
  const [defMaxVol, setDefMaxVol] = useState(100);
  
  // Refs
  const runningRef = useRef<Record<string, boolean>>({});
  const wsRefs = useRef<Record<string, WebSocket>>({});

  // ==================== WEBSOCKET CONNECTION ====================
  
  const connectMarket = useCallback((symbol: string) => {
    if (wsRefs.current[symbol]) {
      try {
        wsRefs.current[symbol].close();
      } catch (e) {}
    }

    setConnections(prev => ({
      ...prev,
      [symbol]: { 
        ws: null, 
        ticks: [], 
        status: 'connecting', 
        lastUpdate: Date.now() 
      }
    }));

    const ws = new WebSocket(WS_URL);
    wsRefs.current[symbol] = ws;

    ws.onopen = () => {
      console.log(`Connected to ${symbol}`);
      
      // Request history
      ws.send(JSON.stringify({
        ticks_history: symbol,
        style: "ticks",
        count: tickCount,
        end: "latest",
        subscribe: 1
      }));

      setConnections(prev => ({
        ...prev,
        [symbol]: { 
          ...prev[symbol], 
          ws, 
          status: 'live',
          lastUpdate: Date.now() 
        }
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      setConnections(prev => {
        const conn = prev[symbol] || { ticks: [], status: 'live', lastUpdate: Date.now() };
        let ticks = [...conn.ticks];

        if (data.history) {
          // Initial history data
          ticks = data.history.prices.map((p: string) => parseFloat(p));
        } else if (data.tick) {
          // Live tick
          const tick = parseFloat(data.tick.quote);
          ticks.push(tick);
          if (ticks.length > 4000) ticks.shift();
        }

        // Update analysis
        const analysis = analyzeMarket(symbol, ticks);
        setAnalyses(prev => ({ ...prev, [symbol]: analysis }));

        return {
          ...prev,
          [symbol]: {
            ...conn,
            ticks,
            status: 'live',
            lastUpdate: Date.now()
          }
        };
      });
    };

    ws.onerror = () => {
      setConnections(prev => ({
        ...prev,
        [symbol]: { 
          ...prev[symbol], 
          status: 'error',
          lastUpdate: Date.now() 
        }
      }));
    };

    ws.onclose = () => {
      setConnections(prev => ({
        ...prev,
        [symbol]: { 
          ...prev[symbol], 
          status: 'offline',
          lastUpdate: Date.now() 
        }
      }));
      
      // Attempt to reconnect after 5 seconds
      setTimeout(() => {
        if (!wsRefs.current[symbol]) {
          connectMarket(symbol);
        }
      }, 5000);
    };
  }, [tickCount]);

  // ==================== SCAN MARKETS ====================
  
  const scanMarkets = useCallback(async () => {
    if (scanning) return;
    
    setScanning(true);
    setScanProgress(0);
    
    const marketsToScan = MARKET_GROUPS[marketGroup];
    const total = marketsToScan.length;
    
    toast.info(`Scanning ${total} markets...`);
    
    for (let i = 0; i < marketsToScan.length; i++) {
      const symbol = marketsToScan[i];
      setScanProgress(Math.round((i + 1) / total * 100));
      
      // Connect to market if not already connected
      if (!wsRefs.current[symbol]) {
        connectMarket(symbol);
      }
      
      await new Promise(r => setTimeout(r, 100));
    }
    
    setScanning(false);
    toast.success(`Scan complete! Monitoring ${total} markets`);
    if (sound) playSound('success');
  }, [scanning, marketGroup, connectMarket, sound]);

  // ==================== AUTO CREATE BOTS ====================
  
  useEffect(() => {
    if (!autoCreate) return;
    
    Object.entries(analyses).forEach(([symbol, analysis]) => {
      if (analysis.condition !== 'NONE' && analysis.confidence > 60) {
        const exists = bots.some(b => b.market === symbol && b.type === analysis.condition);
        if (!exists) {
          const newBot: Bot = {
            id: `bot-${Date.now()}-${Math.random()}`,
            market: symbol,
            type: analysis.condition,
            name: `${symbol} - ${analysis.condition}`,
            entryType: analysis.condition === 'EVEN' ? 'even' : analysis.condition === 'ODD' ? 'odd' : 'digit',
            entryValue: analysis.entry,
            activeDigit: typeof analysis.entry === 'number' ? analysis.entry : 5,
            stake: defStake,
            duration: defDuration,
            multiplier: defMult,
            maxSteps: defSteps,
            takeProfit: defTP,
            stopLoss: defSL,
            checkVolatility: true,
            minVolatility: defMinVol,
            maxVolatility: defMaxVol,
            isRunning: false,
            status: 'idle',
            currentStake: defStake,
            totalPnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            currentRun: 0,
            recoveryStep: 0,
            lastVolatilityCheck: null,
            expanded: true
          };
          setBots(prev => [...prev, newBot]);
        }
      }
    });
  }, [analyses, autoCreate, defStake, defDuration, defMult, defSteps, defTP, defSL, defMinVol, defMaxVol]);

  // ==================== PLAY SOUND ====================
  
  const playSound = (type: string) => {
    if (!sound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = type === 'success' ? 880 : 220;
      gain.gain.value = 0.1;
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  };

  // ==================== CHECK CONDITIONS ====================
  
  const checkEntryCondition = useCallback((bot: Bot, analysis: MarketAnalysis, currentDigit: number): boolean => {
    // Check digit condition
    if (bot.entryType === 'digit') {
      if (currentDigit !== bot.entryValue) return false;
    } else if (bot.entryType === 'even') {
      if (currentDigit % 2 !== 0) return false;
    } else {
      if (currentDigit % 2 !== 1) return false;
    }

    // Check market type condition
    if (bot.type === 'TYPE_A') {
      const low012 = analysis.percentages.low012;
      if (low012 >= 10) return false;
    } else if (bot.type === 'TYPE_B') {
      const high789 = analysis.percentages.high789;
      if (high789 >= 10) return false;
    }

    // Check volatility
    if (bot.checkVolatility) {
      const score = analysis.volatility.volatilityScore;
      if (score < bot.minVolatility || score > bot.maxVolatility) return false;
    }

    return true;
  }, []);

  // ==================== RUN BOT ====================
  
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized || balance < bot.currentStake) return;
    
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isRunning: true, status: 'watching' } : b));
    runningRef.current[botId] = true;
    
    let stake = bot.stake;
    let pnl = bot.totalPnl;
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let run = 0;
    let step = 0;
    let recovering = false;
    
    while (runningRef.current[botId] && run < 3) {
      if (pnl >= bot.takeProfit || pnl <= -bot.stopLoss) break;
      
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'waiting' } : b));
      
      // Wait for next tick
      await new Promise(resolve => {
        const checkTick = () => {
          const analysis = analyses[bot.market];
          if (analysis && analysis.lastDigits.length > 0) {
            resolve(true);
          } else {
            setTimeout(checkTick, 100);
          }
        };
        checkTick();
      });
      
      const analysis = analyses[bot.market];
      if (!analysis) continue;
      
      const currentDigit = analysis.lastDigits[analysis.lastDigits.length - 1];
      
      // Check if conditions are met
      if (!checkEntryCondition(bot, analysis, currentDigit)) {
        continue;
      }
      
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));
      
      try {
        // Simulate trade (replace with actual Deriv API call)
        const tradeId = `${botId}-${Date.now()}`;
        setActiveTrade(tradeId);
        
        // Determine win/loss based on next tick
        const nextTick = await new Promise<number>(resolve => {
          setTimeout(() => {
            const newAnalysis = analyses[bot.market];
            resolve(newAnalysis?.lastDigits[newAnalysis.lastDigits.length - 1] || currentDigit);
          }, 1000);
        });
        
        const won = bot.entryType === 'digit' 
          ? nextTick === bot.entryValue
          : bot.entryType === 'even'
            ? nextTick % 2 === 0
            : nextTick % 2 === 1;
        
        const profit = won ? stake * 0.95 : -stake;
        
        setTrades(prev => [{
          id: tradeId,
          time: new Date().toLocaleTimeString(),
          botName: bot.name,
          market: bot.market,
          entry: bot.entryValue.toString(),
          stake,
          result: won ? 'win' : 'loss',
          profit,
          digit: nextTick,
          volatility: analysis.volatility.volatilityScore
        }, ...prev].slice(0, 50));
        
        pnl += profit;
        trades++;
        
        if (won) {
          wins++;
          if (recovering) {
            runningRef.current[botId] = false;
            toast.success(`${bot.name}: Recovery successful!`);
            if (sound) playSound('success');
            break;
          } else {
            run++;
            stake = bot.stake;
            step = 0;
            recovering = false;
            if (run >= 3) {
              toast.success(`${bot.name}: Completed 3 runs!`);
              if (sound) playSound('success');
              break;
            }
          }
        } else {
          losses++;
          
          if (!recovering) {
            recovering = true;
            step = 1;
            stake = bot.stake * bot.multiplier;
            setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'recovery' } : b));
          } else {
            step++;
            if (step <= bot.maxSteps) {
              stake = bot.stake * Math.pow(bot.multiplier, step);
            } else {
              runningRef.current[botId] = false;
              toast.error(`${bot.name}: Max recovery steps reached`);
              if (sound) playSound('error');
              break;
            }
          }
        }
        
        setActiveTrade(null);
        
        setBots(prev => prev.map(b => b.id === botId ? {
          ...b,
          totalPnl: pnl,
          trades,
          wins,
          losses,
          currentStake: stake,
          currentRun: run,
          recoveryStep: step,
          lastVolatilityCheck: analysis.volatility
        } : b));
        
        await new Promise(r => setTimeout(r, 500));
        
      } catch (e) {
        setActiveTrade(null);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isRunning: false, status: 'idle' } : b));
    runningRef.current[botId] = false;
  }, [bots, isAuthorized, balance, analyses, checkEntryCondition, sound]);

  // ==================== BOT CONTROLS ====================
  
  const startBot = (id: string) => runBot(id);
  const stopBot = (id: string) => { runningRef.current[id] = false; setBots(prev => prev.map(b => b.id === id ? { ...b, isRunning: false, status: 'idle' } : b)); };
  const stopAll = () => { bots.forEach(b => runningRef.current[b.id] = false); setBots(prev => prev.map(b => ({ ...b, isRunning: false, status: 'idle' }))); };
  const removeBot = (id: string) => { stopBot(id); setBots(prev => prev.filter(b => b.id !== id)); };
  const duplicateBot = (bot: Bot) => setBots(prev => [...prev, { ...bot, id: `bot-${Date.now()}`, isRunning: false, totalPnl: 0, trades: 0, wins: 0, losses: 0, currentStake: bot.stake }]);
  const clearAll = () => { stopAll(); setBots([]); setTrades([]); };

  // Initialize connections on mount
  useEffect(() => {
    scanMarkets();
    
    return () => {
      // Cleanup all WebSocket connections
      Object.values(wsRefs.current).forEach(ws => {
        try { ws.close(); } catch (e) {}
      });
    };
  }, []);

  // Stats
  const totalPnl = bots.reduce((s, b) => s + b.totalPnl, 0);
  const totalTrades = bots.reduce((s, b) => s + b.trades, 0);
  const totalWins = bots.reduce((s, b) => s + b.wins, 0);
  const winRate = totalTrades ? (totalWins / totalTrades * 100) : 0;
  const activeBots = bots.filter(b => b.isRunning).length;
  const liveConnections = Object.values(connections).filter(c => c.status === 'live').length;

  return (
    <div className="min-h-screen bg-background p-2 sm:p-4">
      {/* Header */}
      <Card className="mb-4 border-2">
        <CardHeader className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-primary" />
              <div>
                <h2 className="text-sm font-bold">Deriv Trading Bot</h2>
                <p className="text-xs text-muted-foreground">Real-time market analysis • Volatility check • Martingale recovery</p>
              </div>
            </div>
            
            <div className="flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => setSound(!sound)}>
                {sound ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
              </Button>
              
              <div className="flex items-center gap-1 px-2 bg-muted/30 rounded text-xs">
                <span>Auto</span>
                <Switch checked={autoCreate} onCheckedChange={setAutoCreate} className="scale-75" />
              </div>
              
              <div className="flex items-center gap-1 px-2 bg-muted/30 rounded text-xs">
                <span>Vol Check</span>
                <Switch checked={globalVolatilityCheck} onCheckedChange={setGlobalVolatilityCheck} className="scale-75" />
              </div>
              
              <Select value={marketGroup} onValueChange={(v: any) => setMarketGroup(v)}>
                <SelectTrigger className="h-7 text-xs w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vol">Volatility</SelectItem>
                  <SelectItem value="jump">Jump</SelectItem>
                  <SelectItem value="bull">Bull</SelectItem>
                  <SelectItem value="bear">Bear</SelectItem>
                </SelectContent>
              </Select>
              
              <Select value={tickCount.toString()} onValueChange={(v) => setTickCount(parseInt(v))}>
                <SelectTrigger className="h-7 text-xs w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="500">500 ticks</SelectItem>
                  <SelectItem value="1000">1000 ticks</SelectItem>
                  <SelectItem value="2000">2000 ticks</SelectItem>
                </SelectContent>
              </Select>
              
              <Button variant="default" size="sm" className="h-7 text-xs px-2" onClick={scanMarkets} disabled={scanning}>
                {scanning ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Scan className="w-3 h-3 mr-1" />}
                {scanning ? `${scanProgress}%` : 'Scan'}
              </Button>
              
              <Button variant="destructive" size="sm" className="h-7 text-xs px-2" onClick={stopAll} disabled={!activeBots}>
                <StopCircle className="w-3 h-3 mr-1" /> Stop All
              </Button>
              
              <Button variant="destructive" size="sm" className="h-7 text-xs px-2" onClick={clearAll}>
                <Trash2 className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
          </div>
          
          {/* Stats */}
          <div className="grid grid-cols-4 sm:grid-cols-9 gap-1 mt-2 text-[10px]">
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">Balance</span>
              <div className="font-bold">{formatMoney(balance || 0)}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">P&L</span>
              <div className={`font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>{formatMoney(totalPnl)}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">Win%</span>
              <div className="font-bold">{formatPercent(winRate)}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">Trades</span>
              <div className="font-bold">{totalTrades}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">Active</span>
              <div className="font-bold text-green-500">{activeBots}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">Bots</span>
              <div className="font-bold">{bots.length}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">Live</span>
              <div className="font-bold text-green-500 flex items-center gap-0.5">
                {liveConnections}/{Object.keys(connections).length}
                {liveConnections > 0 ? <Wifi className="w-2 h-2" /> : <WifiOff className="w-2 h-2" />}
              </div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">W/L</span>
              <div className="font-bold"><span className="text-green-500">{totalWins}</span>/<span className="text-red-500">{totalTrades - totalWins}</span></div>
            </div>
          </div>
        </CardHeader>
      </Card>
      
      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="bots">🤖 Bots ({bots.length})</TabsTrigger>
          <TabsTrigger value="analysis">📊 Analysis ({Object.keys(analyses).length})</TabsTrigger>
          <TabsTrigger value="trades">📝 Trades ({trades.length})</TabsTrigger>
        </TabsList>
        
        {/* Bots Tab */}
        <TabsContent value="bots">
          {bots.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="p-8 text-center">
                <Brain className="w-12 h-12 mx-auto mb-4 opacity-30" />
                <p className="text-sm mb-2">No bots created</p>
                <p className="text-xs text-muted-foreground mb-4">Click Scan to analyze markets and auto-create bots</p>
                <Button onClick={scanMarkets} disabled={scanning}>
                  {scanning ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Scan className="w-4 h-4 mr-2" />}
                  Scan Markets
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {bots.map(bot => {
                const analysis = analyses[bot.market];
                const connection = connections[bot.market];
                
                return (
                  <Card key={bot.id} className="border-2">
                    <CardHeader className="p-3 pb-0">
                      <div className="flex justify-between">
                        <div className="flex items-center gap-2">
                          <div>
                            <h4 className="text-sm font-medium">{bot.market}</h4>
                            <p className="text-[10px] text-muted-foreground">
                              Entry: {bot.entryValue.toString()} | Type: {bot.type}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => duplicateBot(bot)}>
                            <Copy className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-500" onClick={() => removeBot(bot.id)} disabled={bot.isRunning}>
                            <XCircle className="w-3 h-3" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, expanded: !b.expanded } : b))}>
                            {bot.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="p-3">
                      {/* Connection Status */}
                      <div className="flex items-center gap-1 mb-2 text-[8px]">
                        {connection?.status === 'live' ? (
                          <Badge className="bg-green-500/20 text-green-500 text-[6px] px-1">● LIVE</Badge>
                        ) : connection?.status === 'connecting' ? (
                          <Badge className="bg-yellow-500/20 text-yellow-500 text-[6px] px-1">⟳ CONNECTING</Badge>
                        ) : (
                          <Badge className="bg-red-500/20 text-red-500 text-[6px] px-1">○ OFFLINE</Badge>
                        )}
                        
                        {analysis && (
                          <>
                            <span className="text-muted-foreground">Last:</span>
                            <span className="font-mono">{analysis.lastDigits[analysis.lastDigits.length - 1]}</span>
                          </>
                        )}
                      </div>
                      
                      {/* Stats Grid */}
                      <div className="grid grid-cols-3 gap-1 text-xs mb-2">
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-[8px] text-muted-foreground">P&L</div>
                          <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatMoney(bot.totalPnl)}
                          </div>
                        </div>
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-[8px] text-muted-foreground">W/L</div>
                          <div><span className="text-green-500">{bot.wins}</span>/<span className="text-red-500">{bot.losses}</span></div>
                        </div>
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-[8px] text-muted-foreground">Status</div>
                          <div className="flex items-center gap-0.5">
                            {bot.status === 'trading' && <Activity className="w-3 h-3 text-green-500" />}
                            {bot.status === 'recovery' && <RefreshCw className="w-3 h-3 text-orange-500 animate-spin" />}
                            {bot.status === 'watching' && <Eye className="w-3 h-3 text-yellow-500" />}
                            {bot.status === 'waiting' && <Timer className="w-3 h-3 text-blue-500" />}
                            <span className="text-[8px]">{bot.status}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Volatility Display */}
                      {analysis && (
                        <div className="flex items-center gap-1 mb-2 text-[8px] bg-background/50 rounded p-1">
                          {analysis.volatility.volatilityIndex === 'LOW' && <Snowflake className="w-3 h-3 text-blue-400" />}
                          {analysis.volatility.volatilityIndex === 'MEDIUM' && <Wind className="w-3 h-3 text-yellow-400" />}
                          {analysis.volatility.volatilityIndex === 'HIGH' && <Waves className="w-3 h-3 text-orange-400" />}
                          {analysis.volatility.volatilityIndex === 'EXTREME' && <Flame className="w-3 h-3 text-red-400" />}
                          <span className="text-muted-foreground">Vol:</span>
                          <span className={`
                            ${analysis.volatility.volatilityIndex === 'LOW' ? 'text-blue-400' : ''}
                            ${analysis.volatility.volatilityIndex === 'MEDIUM' ? 'text-yellow-400' : ''}
                            ${analysis.volatility.volatilityIndex === 'HIGH' ? 'text-orange-400' : ''}
                            ${analysis.volatility.volatilityIndex === 'EXTREME' ? 'text-red-400' : ''}
                          `}>
                            {analysis.volatility.volatilityIndex}
                          </span>
                          <span className="text-muted-foreground ml-auto">Δ{analysis.volatility.averageChange.toFixed(2)}</span>
                        </div>
                      )}
                      
                      {/* Last Digits Display */}
                      {analysis && (
                        <div className="flex gap-0.5 mb-2 overflow-x-auto">
                          {analysis.lastDigits.slice(-20).map((digit, i) => (
                            <div
                              key={i}
                              className={`w-4 h-4 text-[6px] flex items-center justify-center rounded ${
                                digit === bot.activeDigit
                                  ? 'bg-primary text-primary-foreground'
                                  : digit > (bot.activeDigit)
                                  ? 'bg-green-500/20'
                                  : digit < (bot.activeDigit)
                                  ? 'bg-red-500/20'
                                  : 'bg-muted'
                              }`}
                            >
                              {digit}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {bot.recoveryStep > 0 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-[8px] mb-0.5">
                            <span>Recovery {bot.recoveryStep}/{bot.maxSteps}</span>
                            <span className="text-orange-500">Stake: {formatMoney(bot.currentStake)}</span>
                          </div>
                          <Progress value={bot.recoveryStep / bot.maxSteps * 100} className="h-1" />
                        </div>
                      )}
                      
                      <div className="flex gap-1 text-[8px]">
                        {[1,2,3].map(r => (
                          <div key={r} className={`flex-1 h-1 rounded-full ${r <= bot.currentRun ? 'bg-primary' : 'bg-muted'}`} />
                        ))}
                      </div>
                      
                      {bot.expanded && (
                        <div className="mt-3 space-y-2">
                          <Separator />
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <Label className="text-[8px]">Stake ($)</Label>
                              <div className="flex items-center gap-1">
                                <Button variant="outline" size="sm" className="h-6 w-6 p-0" onClick={() => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stake: Math.max(0.1, b.stake - 0.1) } : b))} disabled={bot.isRunning}>-</Button>
                                <Input type="number" value={bot.stake} onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stake: parseFloat(e.target.value) || 0.1 } : b))} disabled={bot.isRunning} className="h-6 text-[8px] text-center p-0" step="0.1" />
                                <Button variant="outline" size="sm" className="h-6 w-6 p-0" onClick={() => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stake: b.stake + 0.1 } : b))} disabled={bot.isRunning}>+</Button>
                              </div>
                            </div>
                            <div>
                              <Label className="text-[8px]">Active Digit</Label>
                              <Select value={bot.activeDigit.toString()} onValueChange={v => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, activeDigit: parseInt(v), entryValue: parseInt(v) } : b))} disabled={bot.isRunning}>
                                <SelectTrigger className="h-6 text-[8px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {[0,1,2,3,4,5,6,7,8,9].map(d => <SelectItem key={d} value={d.toString()} className="text-[8px]">{d}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[8px]">Duration</Label>
                              <Select value={bot.duration.toString()} onValueChange={v => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, duration: parseInt(v) } : b))} disabled={bot.isRunning}>
                                <SelectTrigger className="h-6 text-[8px]"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {[1,2,3,4,5,6,7,8,9,10].map(d => <SelectItem key={d} value={d.toString()} className="text-[8px]">{d} ticks</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[8px]">Multiplier</Label>
                              <Input type="number" value={bot.multiplier} onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, multiplier: parseFloat(e.target.value) || 1.5 } : b))} disabled={bot.isRunning} className="h-6 text-[8px]" step="0.1" />
                            </div>
                            <div>
                              <Label className="text-[8px]">Max Steps</Label>
                              <Input type="number" value={bot.maxSteps} onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, maxSteps: parseInt(e.target.value) || 1 } : b))} disabled={bot.isRunning} className="h-6 text-[8px]" min="1" max="5" />
                            </div>
                            <div>
                              <Label className="text-[8px]">Take Profit</Label>
                              <Input type="number" value={bot.takeProfit} onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, takeProfit: parseFloat(e.target.value) || 0 } : b))} disabled={bot.isRunning} className="h-6 text-[8px]" />
                            </div>
                            <div>
                              <Label className="text-[8px]">Stop Loss</Label>
                              <Input type="number" value={bot.stopLoss} onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stopLoss: parseFloat(e.target.value) || 0 } : b))} disabled={bot.isRunning} className="h-6 text-[8px]" />
                            </div>
                            
                            {/* Volatility Settings */}
                            <div className="col-span-2">
                              <div className="flex items-center gap-2 mb-1">
                                <Switch 
                                  checked={bot.checkVolatility} 
                                  onCheckedChange={v => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, checkVolatility: v } : b))}
                                  disabled={bot.isRunning}
                                  className="scale-75"
                                />
                                <Label className="text-[8px]">Check Volatility</Label>
                              </div>
                              
                              {bot.checkVolatility && (
                                <div className="grid grid-cols-2 gap-1 mt-1">
                                  <div>
                                    <Label className="text-[8px]">Min Vol (0-100)</Label>
                                    <Input 
                                      type="number" 
                                      value={bot.minVolatility} 
                                      onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, minVolatility: parseFloat(e.target.value) || 0 } : b))}
                                      disabled={bot.isRunning}
                                      className="h-6 text-[8px]" 
                                      min="0" 
                                      max="100"
                                    />
                                  </div>
                                  <div>
                                    <Label className="text-[8px]">Max Vol (0-100)</Label>
                                    <Input 
                                      type="number" 
                                      value={bot.maxVolatility} 
                                      onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, maxVolatility: parseFloat(e.target.value) || 100 } : b))}
                                      disabled={bot.isRunning}
                                      className="h-6 text-[8px]" 
                                      min="0" 
                                      max="100"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </CardContent>
                    
                    <CardFooter className="p-3 pt-0">
                      {!bot.isRunning ? (
                        <Button className="w-full h-7 text-xs" onClick={() => startBot(bot.id)} disabled={!isAuthorized || balance < bot.stake || !!activeTrade || connection?.status !== 'live'}>
                          <Play className="w-3 h-3 mr-1" /> Start
                        </Button>
                      ) : (
                        <Button variant="destructive" className="w-full h-7 text-xs" onClick={() => stopBot(bot.id)}>
                          <StopCircle className="w-3 h-3 mr-1" /> Stop
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
        
        {/* Analysis Tab */}
        <TabsContent value="analysis">
          <Card>
            <CardHeader className="p-3">
              <h3 className="text-sm font-medium">Market Analysis</h3>
              <p className="text-xs text-muted-foreground">{Object.keys(analyses).length} markets analyzed</p>
            </CardHeader>
            <CardContent className="p-3 pt-0 max-h-[500px] overflow-y-auto">
              {Object.entries(analyses).map(([symbol, a]) => {
                const connection = connections[symbol];
                
                return (
                  <Card key={symbol} className={`mb-2 ${a.condition !== 'NONE' ? 'border-primary/50' : ''}`}>
                    <CardHeader className="p-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{symbol}</span>
                          {connection?.status === 'live' ? (
                            <Badge className="bg-green-500/20 text-green-500 text-[6px]">● LIVE</Badge>
                          ) : (
                            <Badge className="bg-red-500/20 text-red-500 text-[6px]">○ OFFLINE</Badge>
                          )}
                        </div>
                        {a.condition !== 'NONE' && (
                          <Badge>{a.condition}</Badge>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="p-2 pt-0">
                      {/* Digit Distribution */}
                      <div className="grid grid-cols-5 gap-0.5 mb-2">
                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                          <div key={d} className={`text-center p-0.5 rounded ${
                            d === a.mostFrequent ? 'bg-green-500/20' : 
                            d === a.leastFrequent ? 'bg-red-500/20' : 'bg-muted/30'
                          }`}>
                            <div className="text-[10px] font-bold">{d}</div>
                            <div className="text-[6px]">{((a.counts[d] / 1000) * 100).toFixed(1)}%</div>
                          </div>
                        ))}
                      </div>
                      
                      {/* Statistics */}
                      <div className="grid grid-cols-4 gap-1 text-[8px] mb-2">
                        <div><span className="text-muted-foreground">0-1-2:</span> {a.percentages.low012.toFixed(1)}%</div>
                        <div><span className="text-muted-foreground">7-8-9:</span> {a.percentages.high789.toFixed(1)}%</div>
                        <div><span className="text-muted-foreground">Even:</span> {a.percentages.even.toFixed(1)}%</div>
                        <div><span className="text-muted-foreground">Odd:</span> {a.percentages.odd.toFixed(1)}%</div>
                      </div>
                      
                      {/* Volatility */}
                      <div className="grid grid-cols-3 gap-1 text-[8px]">
                        <div className="bg-muted/30 rounded p-1">
                          <span className="text-muted-foreground">Volatility:</span>
                          <div className="font-bold">{a.volatility.volatilityIndex}</div>
                        </div>
                        <div className="bg-muted/30 rounded p-1">
                          <span className="text-muted-foreground">Avg Δ:</span>
                          <div className="font-bold">{a.volatility.averageChange.toFixed(2)}</div>
                        </div>
                        <div className="bg-muted/30 rounded p-1">
                          <span className="text-muted-foreground">Trend:</span>
                          <div className={`font-bold ${
                            a.volatility.trend === 'UP' ? 'text-green-500' : 
                            a.volatility.trend === 'DOWN' ? 'text-red-500' : 'text-yellow-500'
                          }`}>{a.volatility.trend}</div>
                        </div>
                      </div>
                      
                      {/* Last Digits */}
                      <div className="mt-2 flex gap-0.5 overflow-x-auto">
                        {a.lastDigits.slice(-20).map((digit, i) => (
                          <div
                            key={i}
                            className="w-4 h-4 text-[6px] flex items-center justify-center rounded bg-muted"
                          >
                            {digit}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Trades Tab */}
        <TabsContent value="trades">
          <Card>
            <CardHeader className="p-3">
              <h3 className="text-sm font-medium">Trade History</h3>
              <p className="text-xs text-muted-foreground">Last 50 trades</p>
            </CardHeader>
            <CardContent className="p-3 pt-0 max-h-[400px] overflow-y-auto">
              {trades.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No trades yet</p>
              ) : (
                trades.map((t, i) => (
                  <div key={i} className={`flex items-center justify-between p-1.5 rounded text-xs mb-1 ${
                    t.result === 'win' ? 'bg-green-500/10' : t.result === 'loss' ? 'bg-red-500/10' : 'bg-yellow-500/10'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-muted-foreground w-12">{t.time}</span>
                      <Badge variant="outline" className="text-[6px] px-1 py-0">{t.market}</Badge>
                      <span className="text-[8px]">Entry: {t.entry}</span>
                      {t.digit !== undefined && <span className="text-[8px] text-muted-foreground">→ {t.digit}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {t.volatility !== undefined && (
                        <span className="text-[6px] text-muted-foreground">Vol:{t.volatility.toFixed(0)}</span>
                      )}
                      <span className="text-[8px] font-mono">{formatMoney(t.stake)}</span>
                      <span className={`text-[8px] font-bold w-16 text-right ${
                        t.result === 'win' ? 'text-green-500' : t.result === 'loss' ? 'text-red-500' : 'text-yellow-500'
                      }`}>
                        {t.result === 'win' ? `+${formatMoney(t.profit)}` : t.result === 'loss' ? `-${formatMoney(Math.abs(t.profit))}` : 'Pending'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Helper function for formatting money
const formatMoney = (n: number): string => `$${n.toFixed(2)}`;
const formatPercent = (n: number): string => `${n.toFixed(1)}%`;
