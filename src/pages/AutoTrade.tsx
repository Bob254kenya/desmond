import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
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
  Waves, Wind, Flame, Snowflake
} from 'lucide-react';

// ==================== TYPES ====================

interface MarketAnalysis {
  symbol: string;
  counts: { [key: number]: number };
  percentages: {
    [key: number]: number;
    low012: number;
    high789: number;
    even: number;
    odd: number;
  };
  mostFrequent: number;
  leastFrequent: number;
  condition: 'TYPE_A' | 'TYPE_B' | 'EVEN' | 'ODD' | 'NONE';
  entry: number | 'EVEN' | 'ODD';
  confidence: number;
  volatility: VolatilityAnalysis;
}

interface VolatilityAnalysis {
  averageChange: number;
  volatilityIndex: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  priceRange: { min: number; max: number };
  recentSpikes: number;
  trend: 'UP' | 'DOWN' | 'SIDEWAYS';
  volatilityScore: number; // 0-100
}

interface Bot {
  id: string;
  market: string;
  type: 'TYPE_A' | 'TYPE_B' | 'EVEN' | 'ODD';
  name: string;
  entryType: 'digit' | 'even' | 'odd';
  entryValue: number | 'EVEN' | 'ODD';
  
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

// ==================== CONSTANTS ====================

const MARKETS = [
  { value: 'R_10', label: 'R 10', icon: '📈', volatility: 'MEDIUM' },
  { value: 'R_25', label: 'R 25', icon: '📈', volatility: 'MEDIUM' },
  { value: 'R_50', label: 'R 50', icon: '📈', volatility: 'HIGH' },
  { value: 'R_75', label: 'R 75', icon: '📈', volatility: 'HIGH' },
  { value: 'R_100', label: 'R 100', icon: '📈', volatility: 'EXTREME' },
  { value: '1HZ10V', label: '1HZ 10', icon: '⚡', volatility: 'LOW' },
  { value: '1HZ25V', label: '1HZ 25', icon: '⚡', volatility: 'LOW' },
  { value: '1HZ50V', label: '1HZ 50', icon: '⚡', volatility: 'MEDIUM' },
  { value: '1HZ75V', label: '1HZ 75', icon: '⚡', volatility: 'MEDIUM' },
  { value: '1HZ100V', label: '1HZ 100', icon: '⚡', volatility: 'HIGH' },
  { value: 'JD10', label: 'Jump 10', icon: '🦘', volatility: 'HIGH' },
  { value: 'JD25', label: 'Jump 25', icon: '🦘', volatility: 'HIGH' },
  { value: 'JD50', label: 'Jump 50', icon: '🦘', volatility: 'EXTREME' },
  { value: 'JD75', label: 'Jump 75', icon: '🦘', volatility: 'EXTREME' },
  { value: 'JD100', label: 'Jump 100', icon: '🦘', volatility: 'EXTREME' },
  { value: 'JB10', label: 'Bear 10', icon: '🐻', volatility: 'HIGH' },
  { value: 'JB25', label: 'Bear 25', icon: '🐻', volatility: 'HIGH' },
  { value: 'JB50', label: 'Bear 50', icon: '🐻', volatility: 'EXTREME' },
  { value: 'JB75', label: 'Bear 75', icon: '🐻', volatility: 'EXTREME' },
  { value: 'JB100', label: 'Bear 100', icon: '🐻', volatility: 'EXTREME' }
];

const BOT_STYLES = {
  TYPE_A: { border: 'border-emerald-500', bg: 'bg-emerald-500/5', badge: 'bg-emerald-500/20 text-emerald-500', icon: <TrendingDown className="w-4 h-4" /> },
  TYPE_B: { border: 'border-blue-500', bg: 'bg-blue-500/5', badge: 'bg-blue-500/20 text-blue-500', icon: <TrendingUp className="w-4 h-4" /> },
  EVEN: { border: 'border-purple-500', bg: 'bg-purple-500/5', badge: 'bg-purple-500/20 text-purple-500', icon: <CircleDot className="w-4 h-4" /> },
  ODD: { border: 'border-orange-500', bg: 'bg-orange-500/5', badge: 'bg-orange-500/20 text-orange-500', icon: <Hash className="w-4 h-4" /> }
};

const VOLATILITY_ICONS = {
  LOW: <Snowflake className="w-3 h-3 text-blue-400" />,
  MEDIUM: <Wind className="w-3 h-3 text-yellow-400" />,
  HIGH: <Waves className="w-3 h-3 text-orange-400" />,
  EXTREME: <Flame className="w-3 h-3 text-red-400" />
};

// ==================== HELPER FUNCTIONS ====================

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

const analyzeMarket = (ticks: number[]): MarketAnalysis => {
  if (ticks.length < 100) {
    return {
      symbol: '',
      counts: {},
      percentages: { low012: 0, high789: 0, even: 0, odd: 0 },
      mostFrequent: 0,
      leastFrequent: 0,
      condition: 'NONE',
      entry: 0,
      confidence: 0,
      volatility: analyzeVolatility(ticks)
    };
  }

  const last1000 = ticks.slice(-1000);
  const counts = [0,0,0,0,0,0,0,0,0,0];
  
  last1000.forEach(tick => {
    const digit = Math.floor(tick % 10);
    counts[digit]++;
  });
  
  const low012 = (counts[0] + counts[1] + counts[2]) / 10;
  const high789 = (counts[7] + counts[8] + counts[9]) / 10;
  
  let even = 0, odd = 0;
  [0,2,4,6,8].forEach(d => even += counts[d]);
  [1,3,5,7,9].forEach(d => odd += counts[d]);
  
  even = even / 10;
  odd = odd / 10;
  
  let mostFreq = 0, maxCount = 0;
  let leastFreq = 0, minCount = 1000;
  
  for (let i = 0; i < 10; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      mostFreq = i;
    }
    if (counts[i] < minCount) {
      minCount = counts[i];
      leastFreq = i;
    }
  }
  
  let condition: 'TYPE_A' | 'TYPE_B' | 'EVEN' | 'ODD' | 'NONE' = 'NONE';
  let entry: number | 'EVEN' | 'ODD' = 0;
  let confidence = 0;
  
  if (low012 < 10) {
    condition = 'TYPE_A';
    // For TYPE_A, we want to bet on the digit that appears MOST among 0,1,2
    const lowDigits = [0,1,2];
    let best = lowDigits.reduce((a,b) => counts[a] > counts[b] ? a : b);
    entry = best;
    confidence = 100 - low012 * 2;
  }
  else if (high789 < 10) {
    condition = 'TYPE_B';
    // For TYPE_B, we want to bet on the digit that appears MOST among 7,8,9
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
    symbol: '',
    counts: Object.fromEntries(counts.map((c,i) => [i, c])),
    percentages,
    mostFrequent: mostFreq,
    leastFrequent: leastFreq,
    condition,
    entry,
    confidence,
    volatility: analyzeVolatility(ticks)
  };
};

const waitForNextTick = (symbol: string): Promise<number> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(0), 5000);
    
    // Subscribe to ticks
    derivApi.subscribeTicks(symbol);
    
    const handleMessage = (data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        clearTimeout(timeout);
        derivApi.unsubscribeTicks(symbol);
        resolve(data.tick.quote);
      }
    };
    
    derivApi.onMessage(handleMessage);
  });
};

const formatMoney = (n: number): string => `$${n.toFixed(2)}`;
const formatPercent = (n: number): string => `${n.toFixed(1)}%`;

// ==================== MAIN COMPONENT ====================

export default function TradingBot() {
  const { isAuthorized, balance } = useAuth();
  
  // State
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [analyses, setAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [bots, setBots] = useState<Bot[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [activeTrade, setActiveTrade] = useState<string | null>(null);
  const [sound, setSound] = useState(true);
  const [autoCreate, setAutoCreate] = useState(true);
  const [selectedTab, setSelectedTab] = useState('bots');
  const [globalVolatilityCheck, setGlobalVolatilityCheck] = useState(true);
  
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
  const marketTicks = useRef<Record<string, number[]>>({});
  const abortControllerRef = useRef<AbortController | null>(null);

  // ==================== SCAN MARKETS ====================
  
  const scanMarkets = useCallback(async () => {
    if (scanning) return;
    
    // Cancel any ongoing scan
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    abortControllerRef.current = new AbortController();
    
    setScanning(true);
    setScanProgress(0);
    
    const results: Record<string, MarketAnalysis> = {};
    const total = MARKETS.length;
    
    toast.info(`Scanning ${total} markets...`);
    
    for (let i = 0; i < MARKETS.length; i++) {
      // Check if scan was aborted
      if (abortControllerRef.current.signal.aborted) {
        break;
      }
      
      const market = MARKETS[i].value;
      setScanProgress(Math.round((i + 1) / total * 100));
      
      try {
        const history = await derivApi.getTickHistory(market, 1000);
        if (history?.length) {
          const ticks = history.map((t: any) => t.quote);
          marketTicks.current[market] = ticks;
          
          const analysis = analyzeMarket(ticks);
          analysis.symbol = market;
          results[market] = analysis;
          
          if (autoCreate && analysis.condition !== 'NONE' && analysis.confidence > 60) {
            const exists = bots.some(b => b.market === market && b.type === analysis.condition);
            if (!exists) {
              const newBot: Bot = {
                id: `bot-${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
                market,
                type: analysis.condition,
                name: `${market} - ${analysis.condition}`,
                entryType: analysis.condition === 'EVEN' ? 'even' : analysis.condition === 'ODD' ? 'odd' : 'digit',
                entryValue: analysis.entry,
                stake: defStake,
                duration: defDuration,
                multiplier: defMult,
                maxSteps: defSteps,
                takeProfit: defTP,
                stopLoss: defSL,
                checkVolatility: globalVolatilityCheck,
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
        }
      } catch (e) {
        console.error(`Failed to scan ${market}`);
      }
      
      await new Promise(r => setTimeout(r, 50));
    }
    
    setAnalyses(results);
    setScanning(false);
    toast.success(`Scan complete! Found ${Object.values(results).filter(r => r.condition !== 'NONE').length} qualifying markets`);
    if (sound) playSound('success');
  }, [scanning, autoCreate, bots, defStake, defDuration, defMult, defSteps, defTP, defSL, defMinVol, defMaxVol, globalVolatilityCheck, sound]);

  // ==================== CHECK VOLATILITY ====================
  
  const checkVolatilityCondition = useCallback((bot: Bot, analysis: VolatilityAnalysis): boolean => {
    if (!bot.checkVolatility) return true;
    
    const score = analysis.volatilityScore;
    return score >= bot.minVolatility && score <= bot.maxVolatility;
  }, []);

  // ==================== UPDATE MARKET DATA ====================
  
  const updateMarketData = useCallback(async (symbol: string) => {
    try {
      const ticks = marketTicks.current[symbol] || [];
      const newTick = await waitForNextTick(symbol);
      if (newTick > 0) {
        ticks.push(newTick);
        if (ticks.length > 1000) ticks.shift();
        marketTicks.current[symbol] = ticks;
        
        // Update analysis
        const newAnalysis = analyzeMarket(ticks);
        newAnalysis.symbol = symbol;
        setAnalyses(prev => ({
          ...prev,
          [symbol]: newAnalysis
        }));
      }
      return newTick;
    } catch (e) {
      return 0;
    }
  }, []);

  // ==================== PLAY SOUND ====================
  
  const playSound = (type: string) => {
    if (!sound) return;
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = type === 'success' ? 880 : type === 'error' ? 220 : 440;
      gain.gain.value = 0.1;
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {}
  };

  // ==================== CHECK MARKET CONDITION ====================
  
  const checkMarketCondition = useCallback((bot: Bot, analysis: MarketAnalysis): boolean => {
    if (!analysis) return false;
    
    switch (bot.type) {
      case 'TYPE_A':
        return analysis.percentages.low012 < 10;
      case 'TYPE_B':
        return analysis.percentages.high789 < 10;
      case 'EVEN':
        return analysis.percentages.even > 55;
      case 'ODD':
        return analysis.percentages.odd > 55;
      default:
        return false;
    }
  }, []);

  // ==================== RUN BOT ====================
  
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized || balance < bot.currentStake) {
      toast.error('Insufficient balance or not authorized');
      return;
    }
    
    // Check initial market condition
    const initialAnalysis = analyses[bot.market];
    if (!checkMarketCondition(bot, initialAnalysis)) {
      toast.error(`Market ${bot.market} no longer meets conditions for ${bot.type}`);
      return;
    }
    
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
      // Check profit/loss limits
      if (pnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take profit reached!`);
        break;
      }
      if (pnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop loss reached!`);
        break;
      }
      
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'waiting' } : b));
      
      const tick = await updateMarketData(bot.market);
      if (tick === 0) continue;
      
      // Get latest analysis
      const currentAnalysis = analyses[bot.market];
      if (!currentAnalysis) continue;
      
      // Update bot with latest volatility
      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        lastVolatilityCheck: currentAnalysis.volatility 
      } : b));
      
      // Check volatility condition
      if (!checkVolatilityCondition(bot, currentAnalysis.volatility)) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      // Check market condition
      if (!checkMarketCondition(bot, currentAnalysis)) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }
      
      const digit = Math.floor(tick % 10);
      let shouldEnter = false;
      
      // Check entry condition
      if (bot.entryType === 'digit') {
        shouldEnter = digit === bot.entryValue;
      } else if (bot.entryType === 'even') {
        shouldEnter = digit % 2 === 0;
      } else {
        shouldEnter = digit % 2 === 1;
      }
      
      if (!shouldEnter) continue;
      
      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));
      
      try {
        const contractType = bot.entryType === 'digit' ? 'DIGITMATCH' : 
                           bot.entryType === 'even' ? 'DIGITEVEN' : 'DIGITODD';
        
        const params: any = {
          contract_type: contractType,
          symbol: bot.market,
          duration: bot.duration,
          duration_unit: 't',
          basis: 'stake',
          amount: stake
        };
        
        if (bot.entryType === 'digit') {
          params.barrier = bot.entryValue.toString();
        }
        
        const tradeId = `${botId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        setActiveTrade(tradeId);
        
        setTrades(prev => [{
          id: tradeId,
          time: new Date().toLocaleTimeString(),
          botName: bot.name,
          market: bot.market,
          entry: bot.entryValue.toString(),
          stake,
          result: 'pending',
          profit: 0,
          digit,
          volatility: currentAnalysis.volatility.volatilityScore
        }, ...prev].slice(0, 50));
        
        // Buy contract
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        const won = result.status === 'won';
        const profit = result.profit || (won ? stake * 0.95 : -stake); // Approximate profit
        
        setTrades(prev => prev.map(t => t.id === tradeId ? { ...t, result: won ? 'win' : 'loss', profit } : t));
        
        pnl += profit;
        trades++;
        
        if (won) {
          wins++;
          if (recovering) {
            // Recovery successful - stop bot
            toast.success(`${bot.name}: Recovery successful! Profit: ${formatMoney(profit)}`);
            if (sound) playSound('success');
            break;
          } else {
            run++;
            stake = bot.stake;
            step = 0;
            recovering = false;
            if (run >= 3) {
              toast.success(`${bot.name}: Completed 3 runs! Total P&L: ${formatMoney(pnl)}`);
              if (sound) playSound('success');
              break;
            }
          }
        } else {
          losses++;
          
          if (!recovering) {
            // Start recovery mode
            recovering = true;
            step = 1;
            stake = bot.stake * bot.multiplier;
            setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'recovery' } : b));
            toast.info(`${bot.name}: Loss - Starting recovery mode`);
          } else {
            step++;
            if (step <= bot.maxSteps) {
              stake = bot.stake * Math.pow(bot.multiplier, step);
            } else {
              // Max recovery steps reached
              toast.error(`${bot.name}: Max recovery steps reached`);
              if (sound) playSound('error');
              break;
            }
          }
        }
        
        setActiveTrade(null);
        
        // Update bot state
        setBots(prev => prev.map(b => b.id === botId ? {
          ...b,
          totalPnl: pnl,
          trades,
          wins,
          losses,
          currentStake: stake,
          currentRun: run,
          recoveryStep: step
        } : b));
        
        await new Promise(r => setTimeout(r, 500));
        
      } catch (error) {
        console.error('Trade error:', error);
        setActiveTrade(null);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isRunning: false, status: 'idle' } : b));
    runningRef.current[botId] = false;
  }, [bots, isAuthorized, balance, analyses, checkVolatilityCondition, checkMarketCondition, updateMarketData, sound]);

  // ==================== BOT CONTROLS ====================
  
  const startBot = (id: string) => runBot(id);
  
  const stopBot = (id: string) => { 
    runningRef.current[id] = false; 
    setBots(prev => prev.map(b => b.id === id ? { ...b, isRunning: false, status: 'idle' } : b));
    toast.info('Bot stopped');
  };
  
  const stopAll = () => { 
    bots.forEach(b => runningRef.current[b.id] = false); 
    setBots(prev => prev.map(b => ({ ...b, isRunning: false, status: 'idle' })));
    toast.info('All bots stopped');
  };
  
  const removeBot = (id: string) => { 
    stopBot(id); 
    setBots(prev => prev.filter(b => b.id !== id)); 
  };
  
  const duplicateBot = (bot: Bot) => {
    setBots(prev => [...prev, { 
      ...bot, 
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, 
      isRunning: false, 
      totalPnl: 0, 
      trades: 0, 
      wins: 0, 
      losses: 0, 
      currentStake: bot.stake,
      currentRun: 0,
      recoveryStep: 0
    }]);
    toast.success('Bot duplicated');
  };
  
  const clearAll = () => { 
    stopAll(); 
    setBots([]); 
    setTrades([]);
    toast.success('All bots and trades cleared');
  };

  // Auto scan on load
  useEffect(() => { 
    scanMarkets(); 
    
    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      stopAll();
    };
  }, []);

  // Stats
  const totalPnl = bots.reduce((s, b) => s + b.totalPnl, 0);
  const totalTrades = bots.reduce((s, b) => s + b.trades, 0);
  const totalWins = bots.reduce((s, b) => s + b.wins, 0);
  const winRate = totalTrades ? (totalWins / totalTrades * 100) : 0;
  const activeBots = bots.filter(b => b.isRunning).length;

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
                <p className="text-xs text-muted-foreground">Auto market analysis • Volatility check • Martingale recovery</p>
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
          <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 mt-2 text-[10px]">
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
              <span className="text-muted-foreground">Markets</span>
              <div className="font-bold">{Object.keys(analyses).length}</div>
            </div>
            <div className="bg-muted/30 rounded p-1">
              <span className="text-muted-foreground">W/L</span>
              <div className="font-bold">
                <span className="text-green-500">{totalWins}</span>/
                <span className="text-red-500">{totalTrades - totalWins}</span>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>
      
      {/* Tabs */}
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full grid-cols-3 mb-4">
          <TabsTrigger value="bots">🤖 Bots ({bots.length})</TabsTrigger>
          <TabsTrigger value="analysis">📊 Analysis</TabsTrigger>
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
                const style = BOT_STYLES[bot.type];
                const market = MARKETS.find(m => m.value === bot.market);
                const volatility = bot.lastVolatilityCheck || (analyses[bot.market]?.volatility);
                const marketAnalysis = analyses[bot.market];
                
                return (
                  <Card key={bot.id} className={`border-2 ${style.border} ${style.bg}`}>
                    <CardHeader className="p-3 pb-0">
                      <div className="flex justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded ${style.badge}`}>{style.icon}</div>
                          <div>
                            <h4 className="text-sm font-medium">{market?.icon} {bot.market}</h4>
                            <p className="text-[10px] text-muted-foreground">
                              Entry: {bot.entryValue.toString()}
                              {marketAnalysis && !checkMarketCondition(bot, marketAnalysis) && (
                                <span className="ml-1 text-red-500">(Invalid)</span>
                              )}
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
                      <div className="grid grid-cols-3 gap-1 text-xs mb-2">
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-[8px] text-muted-foreground">P&L</div>
                          <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatMoney(bot.totalPnl)}
                          </div>
                        </div>
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-[8px] text-muted-foreground">W/L</div>
                          <div>
                            <span className="text-green-500">{bot.wins}</span>/
                            <span className="text-red-500">{bot.losses}</span>
                          </div>
                        </div>
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-[8px] text-muted-foreground">Status</div>
                          <div className="flex items-center gap-0.5">
                            {bot.status === 'trading' && <Activity className="w-3 h-3 text-green-500 animate-pulse" />}
                            {bot.status === 'recovery' && <RefreshCw className="w-3 h-3 text-orange-500 animate-spin" />}
                            {bot.status === 'watching' && <Eye className="w-3 h-3 text-yellow-500" />}
                            {bot.status === 'waiting' && <Timer className="w-3 h-3 text-blue-500" />}
                            {bot.status === 'idle' && <CircleDot className="w-3 h-3 text-gray-500" />}
                            <span className="text-[8px] capitalize">{bot.status}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Volatility Display */}
                      {volatility && (
                        <div className="flex items-center gap-1 mb-2 text-[8px] bg-background/50 rounded p-1">
                          {VOLATILITY_ICONS[volatility.volatilityIndex]}
                          <span className="text-muted-foreground">Vol:</span>
                          <span className={`
                            ${volatility.volatilityIndex === 'LOW' ? 'text-blue-400' : ''}
                            ${volatility.volatilityIndex === 'MEDIUM' ? 'text-yellow-400' : ''}
                            ${volatility.volatilityIndex === 'HIGH' ? 'text-orange-400' : ''}
                            ${volatility.volatilityIndex === 'EXTREME' ? 'text-red-400' : ''}
                          `}>
                            {volatility.volatilityIndex}
                          </span>
                          <span className="text-muted-foreground ml-auto">
                            Δ{volatility.averageChange.toFixed(2)}
                          </span>
                          {bot.checkVolatility && (
                            <span className={`ml-1 text-[6px] ${
                              volatility.volatilityScore >= bot.minVolatility && 
                              volatility.volatilityScore <= bot.maxVolatility 
                                ? 'text-green-500' 
                                : 'text-red-500'
                            }`}>
                              ({volatility.volatilityScore.toFixed(0)})
                            </span>
                          )}
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
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-6 w-6 p-0" 
                                  onClick={() => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stake: Math.max(0.1, b.stake - 0.1) } : b))} 
                                  disabled={bot.isRunning}
                                >
                                  <Minus className="w-3 h-3" />
                                </Button>
                                <Input 
                                  type="number" 
                                  value={bot.stake} 
                                  onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stake: Math.max(0.1, parseFloat(e.target.value) || 0.1) } : b))} 
                                  disabled={bot.isRunning} 
                                  className="h-6 text-[8px] text-center p-0" 
                                  step="0.1" 
                                  min="0.1"
                                />
                                <Button 
                                  variant="outline" 
                                  size="sm" 
                                  className="h-6 w-6 p-0" 
                                  onClick={() => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stake: b.stake + 0.1 } : b))} 
                                  disabled={bot.isRunning}
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                            <div>
                              <Label className="text-[8px]">Duration</Label>
                              <Select 
                                value={bot.duration.toString()} 
                                onValueChange={v => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, duration: parseInt(v) } : b))} 
                                disabled={bot.isRunning}
                              >
                                <SelectTrigger className="h-6 text-[8px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {[1,2,3,4,5,6,7,8,9,10].map(d => (
                                    <SelectItem key={d} value={d.toString()} className="text-[8px]">
                                      {d} ticks
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div>
                              <Label className="text-[8px]">Multiplier</Label>
                              <Input 
                                type="number" 
                                value={bot.multiplier} 
                                onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, multiplier: parseFloat(e.target.value) || 1.5 } : b))} 
                                disabled={bot.isRunning} 
                                className="h-6 text-[8px]" 
                                step="0.1" 
                                min="1.1"
                              />
                            </div>
                            <div>
                              <Label className="text-[8px]">Max Steps</Label>
                              <Input 
                                type="number" 
                                value={bot.maxSteps} 
                                onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, maxSteps: parseInt(e.target.value) || 1 } : b))} 
                                disabled={bot.isRunning} 
                                className="h-6 text-[8px]" 
                                min="1" 
                                max="5"
                              />
                            </div>
                            <div>
                              <Label className="text-[8px]">Take Profit</Label>
                              <Input 
                                type="number" 
                                value={bot.takeProfit} 
                                onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, takeProfit: parseFloat(e.target.value) || 0 } : b))} 
                                disabled={bot.isRunning} 
                                className="h-6 text-[8px]" 
                              />
                            </div>
                            <div>
                              <Label className="text-[8px]">Stop Loss</Label>
                              <Input 
                                type="number" 
                                value={bot.stopLoss} 
                                onChange={e => setBots(prev => prev.map(b => b.id === bot.id ? { ...b, stopLoss: parseFloat(e.target.value) || 0 } : b))} 
                                disabled={bot.isRunning} 
                                className="h-6 text-[8px]" 
                              />
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
                        <Button 
                          className="w-full h-7 text-xs" 
                          onClick={() => startBot(bot.id)} 
                          disabled={!isAuthorized || balance < bot.stake || !!activeTrade}
                        >
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
                const market = MARKETS.find(m => m.value === symbol);
                const hasCondition = a.condition !== 'NONE';
                
                return (
                  <Card key={symbol} className={`mb-2 ${hasCondition ? 'border-primary/50' : ''}`}>
                    <CardHeader className="p-2">
                      <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{market?.icon}</span>
                          <span className="text-sm font-medium">{symbol}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          {VOLATILITY_ICONS[a.volatility.volatilityIndex]}
                          {hasCondition && (
                            <Badge className={BOT_STYLES[a.condition]?.badge}>
                              {a.condition}
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="p-2 pt-0">
                      <div className="grid grid-cols-5 gap-0.5 mb-2">
                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                          <div key={d} className={`text-center p-0.5 rounded ${
                            d === a.mostFrequent ? 'bg-green-500/20' : 
                            d === a.leastFrequent ? 'bg-red-500/20' : 'bg-muted/30'
                          }`}>
                            <div className="text-[10px] font-bold">{d}</div>
                            <div className="text-[6px]">{a.percentages[d]?.toFixed(1)}%</div>
                          </div>
                        ))}
                      </div>
                      
                      <div className="grid grid-cols-4 gap-1 text-[8px] mb-2">
                        <div>
                          <span className="text-muted-foreground">0-1-2:</span>{' '}
                          <span className={a.percentages.low012 < 10 ? 'text-emerald-500 font-bold' : ''}>
                            {a.percentages.low012.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">7-8-9:</span>{' '}
                          <span className={a.percentages.high789 < 10 ? 'text-blue-500 font-bold' : ''}>
                            {a.percentages.high789.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Even:</span>{' '}
                          <span className={a.percentages.even > 55 ? 'text-purple-500 font-bold' : ''}>
                            {a.percentages.even.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Odd:</span>{' '}
                          <span className={a.percentages.odd > 55 ? 'text-orange-500 font-bold' : ''}>
                            {a.percentages.odd.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      
                      {/* Volatility Info */}
                      <div className="grid grid-cols-3 gap-1 mb-2 text-[8px]">
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
                          }`}>
                            {a.volatility.trend}
                          </div>
                        </div>
                      </div>
                      
                      {hasCondition && (
                        <div className="bg-primary/10 rounded p-1.5">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-[8px] font-medium">Recommended: {a.condition}</span>
                            <span className="text-[8px]">Confidence: {a.confidence.toFixed(0)}%</span>
                          </div>
                          <Progress value={a.confidence} className="h-1" />
                          <p className="text-[8px] text-muted-foreground mt-1">
                            Entry: {a.entry.toString()}
                          </p>
                        </div>
                      )}
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
                    t.result === 'win' ? 'bg-green-500/10' : 
                    t.result === 'loss' ? 'bg-red-500/10' : 'bg-yellow-500/10'
                  }`}>
                    <div className="flex items-center gap-2">
                      <span className="text-[8px] text-muted-foreground w-12">{t.time}</span>
                      <Badge variant="outline" className="text-[6px] px-1 py-0">{t.botName}</Badge>
                      <span className="text-[8px]">{t.entry}</span>
                      {t.digit !== undefined && (
                        <span className="text-[8px] text-muted-foreground">→ {t.digit}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {t.volatility !== undefined && (
                        <span className="text-[6px] text-muted-foreground">
                          Vol:{t.volatility.toFixed(0)}
                        </span>
                      )}
                      <span className="text-[8px] font-mono">{formatMoney(t.stake)}</span>
                      <span className={`text-[8px] font-bold w-16 text-right ${
                        t.result === 'win' ? 'text-green-500' : 
                        t.result === 'loss' ? 'text-red-500' : 'text-yellow-500'
                      }`}>
                        {t.result === 'win' ? `+${formatMoney(t.profit)}` : 
                         t.result === 'loss' ? `-${formatMoney(Math.abs(t.profit))}` : 'Pending'}
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
