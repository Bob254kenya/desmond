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
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Play, StopCircle, TrendingUp, TrendingDown, CircleDot, RefreshCw, 
  Loader2, Activity, Target, AlertCircle, CheckCircle2, Clock, Hash,
  Zap, Gauge, Volume2, VolumeX, Timer, XCircle, Settings, ChevronDown,
  ChevronUp, DollarSign, Percent, Plus, Minus, BarChart3, LineChart,
  Brain, Scan, Trash2, Download, Upload, Copy, Eye, EyeOff, Rocket,
  Flame, Snowflake, Wind, Sun, Moon, Cloud, Droplets, Award, Star
} from 'lucide-react';

// ==================== TYPES ====================

interface MarketData {
  symbol: string;
  ticks: number[];
  digits: number[];
  analysis: MarketAnalysis;
  fetchedAt: Date;
}

interface MarketAnalysis {
  condition: 'LOW_012' | 'LOW_789' | 'EVEN_55' | 'ODD_4' | 'NONE';
  confidence: number;
  percentages: {
    p0: number; p1: number; p2: number; p3: number; p4: number;
    p5: number; p6: number; p7: number; p8: number; p9: number;
    low012: number;
    high789: number;
    even: number;
    odd: number;
  };
  mostFrequent: number;
  leastFrequent: number;
  recommendedEntry: number | 'EVEN' | 'ODD';
  digit4Frequency: number;
}

interface BotConfig {
  id: string;
  market: string;
  name: string;
  condition: 'LOW_012' | 'LOW_789' | 'EVEN_55' | 'ODD_4';
  
  // Entry settings
  entryType: 'digit' | 'even' | 'odd';
  entryDigit?: number;
  contractType: string;
  
  // User configurable settings
  stake: number;
  duration: number; // in ticks
  takeProfit: number; // in dollars
  stopLoss: number; // in dollars
  
  // Martingale settings
  martingaleMultiplier: number;
  maxMartingaleSteps: number;
  
  // Bot state
  isRunning: boolean;
  status: 'idle' | 'watching' | 'trading' | 'martingale' | 'completed' | 'stopped';
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  martingaleStep: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  lastTradeResult?: 'win' | 'loss';
  
  // Market data
  analysis: MarketAnalysis;
  
  // UI
  expanded: boolean;
}

interface TradeLog {
  id: string;
  timestamp: Date;
  botId: string;
  botName: string;
  market: string;
  entryType: string;
  stake: number;
  result: 'win' | 'loss' | 'pending';
  profit: number;
  martingaleStep: number;
  digit?: number;
}

// ==================== CONSTANTS ====================

const VOLATILITY_MARKETS = [
  // Standard Volatility
  { value: 'R_10', label: 'R 10', icon: '📈', group: 'Standard' },
  { value: 'R_25', label: 'R 25', icon: '📈', group: 'Standard' },
  { value: 'R_50', label: 'R 50', icon: '📈', group: 'Standard' },
  { value: 'R_75', label: 'R 75', icon: '📈', group: 'Standard' },
  { value: 'R_100', label: 'R 100', icon: '📈', group: 'Standard' },
  
  // 1-Second Volatility
  { value: '1HZ10V', label: '1HZ 10', icon: '⚡', group: '1-Second' },
  { value: '1HZ25V', label: '1HZ 25', icon: '⚡', group: '1-Second' },
  { value: '1HZ50V', label: '1HZ 50', icon: '⚡', group: '1-Second' },
  { value: '1HZ75V', label: '1HZ 75', icon: '⚡', group: '1-Second' },
  { value: '1HZ100V', label: '1HZ 100', icon: '⚡', group: '1-Second' },
  
  // Jump Bull
  { value: 'JD10', label: 'Jump Bull 10', icon: '🐂', group: 'Jump' },
  { value: 'JD25', label: 'Jump Bull 25', icon: '🐂', group: 'Jump' },
  { value: 'JD50', label: 'Jump Bull 50', icon: '🐂', group: 'Jump' },
  { value: 'JD75', label: 'Jump Bull 75', icon: '🐂', group: 'Jump' },
  { value: 'JD100', label: 'Jump Bull 100', icon: '🐂', group: 'Jump' },
  
  // Jump Bear
  { value: 'JB10', label: 'Jump Bear 10', icon: '🐻', group: 'Jump' },
  { value: 'JB25', label: 'Jump Bear 25', icon: '🐻', group: 'Jump' },
  { value: 'JB50', label: 'Jump Bear 50', icon: '🐻', group: 'Jump' },
  { value: 'JB75', label: 'Jump Bear 75', icon: '🐻', group: 'Jump' },
  { value: 'JB100', label: 'Jump Bear 100', icon: '🐻', group: 'Jump' }
];

const CONDITION_STYLES = {
  LOW_012: {
    name: 'Low 0-1-2 Bot',
    border: 'border-emerald-500',
    bg: 'bg-emerald-500/5',
    badge: 'bg-emerald-500/20 text-emerald-500',
    icon: <TrendingDown className="w-4 h-4" />,
    gradient: 'from-emerald-500/20 to-transparent'
  },
  LOW_789: {
    name: 'Low 7-8-9 Bot',
    border: 'border-blue-500',
    bg: 'bg-blue-500/5',
    badge: 'bg-blue-500/20 text-blue-500',
    icon: <TrendingUp className="w-4 h-4" />,
    gradient: 'from-blue-500/20 to-transparent'
  },
  EVEN_55: {
    name: 'Even Dominant Bot',
    border: 'border-purple-500',
    bg: 'bg-purple-500/5',
    badge: 'bg-purple-500/20 text-purple-500',
    icon: <CircleDot className="w-4 h-4" />,
    gradient: 'from-purple-500/20 to-transparent'
  },
  ODD_4: {
    name: 'Odd with 4 Focus Bot',
    border: 'border-orange-500',
    bg: 'bg-orange-500/5',
    badge: 'bg-orange-500/20 text-orange-500',
    icon: <Hash className="w-4 h-4" />,
    gradient: 'from-orange-500/20 to-transparent'
  }
};

// ==================== HELPER FUNCTIONS ====================

const analyzeMarketFast = (ticks: number[]): MarketAnalysis => {
  if (ticks.length < 100) {
    return {
      condition: 'NONE',
      confidence: 0,
      percentages: {
        p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0, p8: 0, p9: 0,
        low012: 0, high789: 0, even: 0, odd: 0
      },
      mostFrequent: 0,
      leastFrequent: 0,
      recommendedEntry: 0,
      digit4Frequency: 0
    };
  }

  const last1000 = ticks.slice(-1000);
  const total = last1000.length;
  
  // Fast counting using array
  const counts = new Array(10).fill(0);
  
  last1000.forEach(tick => {
    const digit = Math.floor(tick % 10);
    counts[digit]++;
  });
  
  // Calculate percentages
  const percentages = {
    p0: (counts[0] / total) * 100,
    p1: (counts[1] / total) * 100,
    p2: (counts[2] / total) * 100,
    p3: (counts[3] / total) * 100,
    p4: (counts[4] / total) * 100,
    p5: (counts[5] / total) * 100,
    p6: (counts[6] / total) * 100,
    p7: (counts[7] / total) * 100,
    p8: (counts[8] / total) * 100,
    p9: (counts[9] / total) * 100,
    low012: ((counts[0] + counts[1] + counts[2]) / total) * 100,
    high789: ((counts[7] + counts[8] + counts[9]) / total) * 100,
    even: ((counts[0] + counts[2] + counts[4] + counts[6] + counts[8]) / total) * 100,
    odd: ((counts[1] + counts[3] + counts[5] + counts[7] + counts[9]) / total) * 100
  };
  
  // Find most/least frequent
  let mostFrequent = 0;
  let leastFrequent = 0;
  let maxCount = 0;
  let minCount = total;
  
  for (let i = 0; i <= 9; i++) {
    if (counts[i] > maxCount) {
      maxCount = counts[i];
      mostFrequent = i;
    }
    if (counts[i] < minCount) {
      minCount = counts[i];
      leastFrequent = i;
    }
  }
  
  // Determine condition
  let condition: 'LOW_012' | 'LOW_789' | 'EVEN_55' | 'ODD_4' | 'NONE' = 'NONE';
  let confidence = 0;
  let recommendedEntry: number | 'EVEN' | 'ODD' = 0;
  
  if (percentages.low012 < 10) {
    condition = 'LOW_012';
    confidence = 100 - percentages.low012 * 2;
    // Recommend most frequent among low digits
    const lowDigits = [0,1,2];
    let bestLow = 0;
    let bestLowCount = 0;
    lowDigits.forEach(d => {
      if (counts[d] > bestLowCount) {
        bestLowCount = counts[d];
        bestLow = d;
      }
    });
    recommendedEntry = bestLow;
  }
  else if (percentages.high789 < 10) {
    condition = 'LOW_789';
    confidence = 100 - percentages.high789 * 2;
    // Recommend most frequent among high digits
    const highDigits = [7,8,9];
    let bestHigh = 7;
    let bestHighCount = 0;
    highDigits.forEach(d => {
      if (counts[d] > bestHighCount) {
        bestHighCount = counts[d];
        bestHigh = d;
      }
    });
    recommendedEntry = bestHigh;
  }
  else if (percentages.even > 55) {
    condition = 'EVEN_55';
    confidence = percentages.even;
    recommendedEntry = 'EVEN';
  }
  else if (percentages.odd > 55 && counts[4] > total / 12) { // Digit 4 appears more than average
    condition = 'ODD_4';
    confidence = percentages.odd;
    recommendedEntry = 4;
  }
  
  return {
    condition,
    confidence,
    percentages,
    mostFrequent,
    leastFrequent,
    recommendedEntry,
    digit4Frequency: (counts[4] / total) * 100
  };
};

// Fast parallel market data fetcher
const fetchMarketDataParallel = async (markets: string[], timeoutMs = 15000): Promise<Record<string, number[]>> => {
  const results: Record<string, number[]> = {};
  
  const fetchPromises = markets.map(async (market) => {
    try {
      // Get tick history directly (faster than subscribing)
      const history = await derivApi.getTickHistory(market, 1000);
      if (history && history.length > 0) {
        const ticks = history.map((t: any) => t.quote);
        results[market] = ticks;
      }
    } catch (error) {
      console.error(`Error fetching ${market}:`, error);
    }
  });
  
  // Wait for all fetches with timeout
  await Promise.race([
    Promise.all(fetchPromises),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
  
  return results;
};

const waitForNextTick = (symbol: string): Promise<number> => {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      unsub();
      resolve(0);
    }, 5000);
    
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        clearTimeout(timeout);
        unsub();
        resolve(data.tick.quote);
      }
    });
  });
};

const formatCurrency = (amount: number): string => {
  return `$${amount.toFixed(2)}`;
};

const formatPercentage = (value: number): string => {
  return `${value.toFixed(1)}%`;
};

// ==================== MAIN COMPONENT ====================

export default function FastBotGenerator() {
  const { isAuthorized, balance } = useAuth();
  
  // ==================== STATE ====================
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTimer, setScanTimer] = useState(20);
  const [marketsScanned, setMarketsScanned] = useState(0);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  
  // User configurable global defaults
  const [defaultStake, setDefaultStake] = useState(1.00);
  const [defaultDuration, setDefaultDuration] = useState(5); // ticks
  const [defaultTakeProfit, setDefaultTakeProfit] = useState(10);
  const [defaultStopLoss, setDefaultStopLoss] = useState(25);
  const [defaultMartingaleMultiplier, setDefaultMartingaleMultiplier] = useState(2.0);
  const [defaultMaxMartingaleSteps, setDefaultMaxMartingaleSteps] = useState(3);
  
  // Refs
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null);
  const marketCacheRef = useRef<Record<string, number[]>>({});

  // ==================== FAST SCAN (UNDER 20 SECONDS) ====================
  
  const scanAllMarketsFast = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setScanTimer(20);
    setMarketsScanned(0);
    
    const markets = VOLATILITY_MARKETS.map(m => m.value);
    const totalMarkets = markets.length;
    
    // Start countdown timer
    if (scanTimerRef.current) clearInterval(scanTimerRef.current);
    scanTimerRef.current = setInterval(() => {
      setScanTimer(prev => {
        if (prev <= 1) {
          clearInterval(scanTimerRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    try {
      toast.info(`🚀 Fast scanning ${totalMarkets} markets...`);
      
      // Fetch all markets in parallel
      const startTime = Date.now();
      const fetchedData = await fetchMarketDataParallel(markets, 15000);
      const elapsed = Date.now() - startTime;
      
      // Update cache
      Object.assign(marketCacheRef.current, fetchedData);
      
      // Process each market
      const newMarketData: Record<string, MarketData> = {};
      const processedMarkets = Object.keys(fetchedData).length;
      
      setMarketsScanned(processedMarkets);
      setScanProgress(Math.round((processedMarkets / totalMarkets) * 100));
      
      for (const [market, ticks] of Object.entries(fetchedData)) {
        if (ticks.length >= 100) {
          // Extract digits
          const digits = ticks.map(t => Math.floor(t % 10));
          
          // Fast analysis
          const analysis = analyzeMarketFast(ticks);
          
          newMarketData[market] = {
            symbol: market,
            ticks,
            digits,
            analysis,
            fetchedAt: new Date()
          };
          
          // Auto-create bot if condition met with good confidence
          if (analysis.condition !== 'NONE' && analysis.confidence > 65) {
            createBotFromMarket(market, analysis);
          }
        }
      }
      
      setMarketData(prev => ({ ...prev, ...newMarketData }));
      setLastScanTime(new Date());
      
      // Remove bots for markets that no longer qualify
      setBots(prev => prev.filter(bot => {
        const data = newMarketData[bot.market];
        return data && data.analysis.condition === bot.condition && data.analysis.confidence > 65;
      }));
      
      const qualifyingCount = Object.values(newMarketData).filter(d => d.analysis.condition !== 'NONE').length;
      
      if (soundEnabled) {
        playSound('success');
      }
      
      toast.success(`✅ Scan complete in ${(elapsed / 1000).toFixed(1)}s! ${qualifyingCount} qualifying markets found`);
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed - check connection');
    } finally {
      setIsScanning(false);
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
        scanTimerRef.current = null;
      }
    }
  }, [isScanning, soundEnabled]);

  // ==================== CREATE BOT FROM MARKET ====================
  
  const createBotFromMarket = useCallback((market: string, analysis: MarketAnalysis) => {
    // Check if bot already exists
    const existingBot = bots.find(b => b.market === market && b.condition === analysis.condition);
    if (existingBot) return;
    
    const style = CONDITION_STYLES[analysis.condition];
    
    // Determine entry settings based on condition
    let entryType: 'digit' | 'even' | 'odd' = 'digit';
    let entryDigit: number | undefined;
    let contractType = '';
    
    switch (analysis.condition) {
      case 'LOW_012':
        entryType = 'digit';
        entryDigit = typeof analysis.recommendedEntry === 'number' ? analysis.recommendedEntry : 0;
        contractType = 'DIGITMATCH';
        break;
      case 'LOW_789':
        entryType = 'digit';
        entryDigit = typeof analysis.recommendedEntry === 'number' ? analysis.recommendedEntry : 7;
        contractType = 'DIGITMATCH';
        break;
      case 'EVEN_55':
        entryType = 'even';
        contractType = 'DIGITEVEN';
        break;
      case 'ODD_4':
        entryType = 'odd';
        entryDigit = 4;
        contractType = 'DIGITODD';
        break;
    }
    
    const newBot: BotConfig = {
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      market,
      name: `${market} - ${style.name}`,
      condition: analysis.condition,
      
      entryType,
      entryDigit,
      contractType,
      
      // User configurable
      stake: defaultStake,
      duration: defaultDuration,
      takeProfit: defaultTakeProfit,
      stopLoss: defaultStopLoss,
      
      // Martingale settings
      martingaleMultiplier: defaultMartingaleMultiplier,
      maxMartingaleSteps: defaultMaxMartingaleSteps,
      
      // Bot state
      isRunning: false,
      status: 'idle',
      currentStake: defaultStake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      martingaleStep: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      
      analysis,
      
      expanded: true
    };
    
    setBots(prev => [...prev, newBot]);
    
    toast.success(`🤖 Auto-created ${newBot.name}`);
  }, [bots, defaultStake, defaultDuration, defaultTakeProfit, defaultStopLoss, defaultMartingaleMultiplier, defaultMaxMartingaleSteps]);

  // ==================== PLAY SOUND ====================
  
  const playSound = (type: 'success' | 'error' | 'alert') => {
    if (!soundEnabled) return;
    
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      switch (type) {
        case 'success':
          oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.1);
          break;
        case 'error':
          oscillator.frequency.setValueAtTime(220, audioContext.currentTime);
          oscillator.frequency.exponentialRampToValueAtTime(110, audioContext.currentTime + 0.1);
          break;
        case 'alert':
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.1);
          oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.2);
          break;
      }
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
      console.log('Audio not supported');
    }
  };

  // ==================== RUN BOT WITH MARTINGALE ====================
  
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;
    
    // Check balance
    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: true, 
        status: 'watching',
        currentStake: bot.stake
      } : b
    ));
    
    botRunningRefs.current[botId] = true;
    
    let currentStake = bot.stake;
    let totalPnl = bot.totalPnl;
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let martingaleStep = 0;
    let inMartingale = false;
    
    while (botRunningRefs.current[botId]) {
      // Check TP/SL
      if (totalPnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take Profit reached! +${formatCurrency(totalPnl)}`);
        break;
      }
      if (totalPnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop Loss reached! ${formatCurrency(totalPnl)}`);
        break;
      }
      
      // Wait for next tick
      const tick = await waitForNextTick(bot.market);
      if (tick === 0) continue;
      
      const currentDigit = Math.floor(tick % 10);
      
      // Check entry condition
      let shouldEnter = false;
      
      if (bot.entryType === 'digit' && bot.entryDigit !== undefined) {
        shouldEnter = currentDigit === bot.entryDigit;
      } else if (bot.entryType === 'even') {
        shouldEnter = currentDigit % 2 === 0;
      } else if (bot.entryType === 'odd') {
        shouldEnter = currentDigit % 2 === 1;
      }
      
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, status: shouldEnter ? 'trading' : 'watching' } : b
      ));
      
      if (!shouldEnter) continue;
      
      // Execute trade
      try {
        const params: any = {
          contract_type: bot.contractType,
          symbol: bot.market,
          duration: bot.duration,
          duration_unit: 't',
          basis: 'stake',
          amount: currentStake,
        };
        
        if (bot.entryDigit !== undefined && bot.entryType === 'digit') {
          params.barrier = bot.entryDigit.toString();
        }
        
        const tradeId = `${botId}-${Date.now()}-${trades + 1}`;
        setActiveTradeId(tradeId);
        
        // Log trade start
        const newTrade: TradeLog = {
          id: tradeId,
          timestamp: new Date(),
          botId,
          botName: bot.name,
          market: bot.market,
          entryType: bot.entryType + (bot.entryDigit ? ` ${bot.entryDigit}` : ''),
          stake: currentStake,
          result: 'pending',
          profit: 0,
          martingaleStep: inMartingale ? martingaleStep : 0,
          digit: currentDigit
        };
        
        setTradeLogs(prev => [newTrade, ...prev].slice(0, 100));
        
        // Buy contract
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        const won = result.status === 'won';
        const profit = result.profit;
        
        // Update trade log
        setTradeLogs(prev => prev.map(t => 
          t.id === tradeId ? { ...t, result: won ? 'win' : 'loss', profit } : t
        ));
        
        // Update stats
        totalPnl += profit;
        trades++;
        
        if (won) {
          wins++;
          
          if (inMartingale) {
            // Martingale successful - reset and stop
            toast.success(`${bot.name}: Martingale successful! Stopping bot.`);
            botRunningRefs.current[botId] = false;
            break;
          } else {
            // Normal win - stop bot immediately (as per rules)
            toast.success(`${bot.name}: Won! Stopping bot.`);
            botRunningRefs.current[botId] = false;
            break;
          }
        } else {
          losses++;
          
          if (!inMartingale) {
            // First loss - start martingale
            inMartingale = true;
            martingaleStep = 1;
            currentStake = bot.stake * bot.martingaleMultiplier;
            
            setBots(prev => prev.map(b => 
              b.id === botId ? { ...b, status: 'martingale' } : b
            ));
            
            toast.info(`${bot.name}: Loss - Starting martingale step ${martingaleStep}`);
          } else {
            // Martingale loss - increase stake
            martingaleStep++;
            
            if (martingaleStep <= bot.maxMartingaleSteps) {
              currentStake = bot.stake * Math.pow(bot.martingaleMultiplier, martingaleStep);
              toast.info(`${bot.name}: Martingale step ${martingaleStep} - Stake: ${formatCurrency(currentStake)}`);
            } else {
              // Max martingale steps reached
              toast.error(`${bot.name}: Max martingale steps reached. Stopping bot.`);
              botRunningRefs.current[botId] = false;
              break;
            }
          }
        }
        
        setActiveTradeId(null);
        
        // Update bot state
        setBots(prev => prev.map(b => 
          b.id === botId ? {
            ...b,
            totalPnl,
            trades,
            wins,
            losses,
            currentStake,
            martingaleStep: inMartingale ? martingaleStep : 0,
            lastTradeResult: won ? 'win' : 'loss'
          } : b
        ));
        
        // Small delay between trades
        await new Promise(r => setTimeout(r, 300));
        
      } catch (err: any) {
        setActiveTradeId(null);
        console.error('Trade error:', err);
        
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        }
        
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    // Bot stopped
    setBots(prev => prev.map(b => 
      b.id === botId ? {
        ...b,
        isRunning: false,
        status: totalPnl >= bot.takeProfit ? 'completed' : 'stopped'
      } : b
    ));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, bots]);

  // ==================== BOT CONTROLS ====================
  
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    runBot(botId);
  };
  
  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    
    setBots(prev => prev.map(b => 
      b.id === botId ? {
        ...b,
        isRunning: false,
        status: 'stopped'
      } : b
    ));
  };
  
  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    
    setBots(prev => prev.map(b => ({
      ...b,
      isRunning: false,
      status: 'stopped'
    })));
  };
  
  const removeBot = (botId: string) => {
    stopBot(botId);
    setBots(prev => prev.filter(b => b.id !== botId));
  };
  
  const updateBotSetting = (botId: string, key: keyof BotConfig, value: any) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, [key]: value } : b
    ));
  };

  // ==================== CALCULATE STATS ====================
  
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  const activeBots = bots.filter(b => b.isRunning).length;
  const qualifyingMarkets = Object.values(marketData).filter(d => d.analysis.condition !== 'NONE').length;

  // Auto-scan on load
  useEffect(() => {
    scanAllMarketsFast();
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/20 p-2 sm:p-4">
      {/* Header with Fast Scan Indicator */}
      <div className="mb-4 space-y-3">
        <Card className="border-2 shadow-xl bg-card/50 backdrop-blur-sm">
          <CardHeader className="p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Rocket className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <CardTitle className="text-base sm:text-lg">Fast Bot Generator - 20s Scan</CardTitle>
                  <CardDescription className="text-xs">
                    Parallel market scanning • Auto bot creation • Martingale recovery
                  </CardDescription>
                </div>
              </div>
              
              <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                {/* Sound Toggle */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSoundEnabled(!soundEnabled)}
                  className="h-7 w-7 p-0"
                >
                  {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                </Button>
                
                {/* Fast Scan Button with Timer */}
                <Button
                  variant={isScanning ? "secondary" : "default"}
                  size="sm"
                  onClick={scanAllMarketsFast}
                  disabled={isScanning}
                  className="h-7 text-xs px-2 min-w-[90px]"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      {scanTimer}s
                    </>
                  ) : (
                    <>
                      <Zap className="w-3 h-3 mr-1" />
                      Fast Scan
                    </>
                  )}
                </Button>
                
                {/* Stop All Button */}
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={stopAllBots}
                  disabled={activeBots === 0}
                  className="h-7 text-xs px-2"
                >
                  <StopCircle className="w-3 h-3 mr-1" />
                  Stop All
                </Button>
              </div>
            </div>
            
            {/* Scan Progress */}
            {isScanning && (
              <div className="mt-2 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Scanning {marketsScanned}/{VOLATILITY_MARKETS.length} markets</span>
                  <span className="font-medium text-primary">{scanProgress}%</span>
                </div>
                <Progress value={scanProgress} className="h-1.5" />
                <p className="text-[10px] text-muted-foreground">
                  Fetching 1000 ticks in parallel... Target: 20s
                </p>
              </div>
            )}
            
            {/* Last Scan Info */}
            {lastScanTime && !isScanning && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <Clock className="w-3 h-3" />
                <span>Last scan: {lastScanTime.toLocaleTimeString()}</span>
                <span>•</span>
                <span>{qualifyingMarkets} qualifying markets</span>
                <span>•</span>
                <span>{bots.length} bots generated</span>
              </div>
            )}
          </CardHeader>
          
          {/* Global Settings - All User Configurable */}
          <CardContent className="p-3 pt-0">
            <Separator className="mb-3" />
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
              <div>
                <Label className="text-[10px]">Stake ($)</Label>
                <Input
                  type="number"
                  value={defaultStake}
                  onChange={(e) => setDefaultStake(parseFloat(e.target.value) || 0.1)}
                  className="h-7 text-xs"
                  step="0.1"
                  min="0.1"
                />
              </div>
              <div>
                <Label className="text-[10px]">Duration (ticks)</Label>
                <Input
                  type="number"
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(parseInt(e.target.value) || 1)}
                  className="h-7 text-xs"
                  min="1"
                  max="10"
                />
              </div>
              <div>
                <Label className="text-[10px]">Take Profit ($)</Label>
                <Input
                  type="number"
                  value={defaultTakeProfit}
                  onChange={(e) => setDefaultTakeProfit(parseFloat(e.target.value) || 0)}
                  className="h-7 text-xs"
                  step="5"
                />
              </div>
              <div>
                <Label className="text-[10px]">Stop Loss ($)</Label>
                <Input
                  type="number"
                  value={defaultStopLoss}
                  onChange={(e) => setDefaultStopLoss(parseFloat(e.target.value) || 0)}
                  className="h-7 text-xs"
                  step="5"
                />
              </div>
              <div>
                <Label className="text-[10px]">Martingale Multiplier</Label>
                <Input
                  type="number"
                  value={defaultMartingaleMultiplier}
                  onChange={(e) => setDefaultMartingaleMultiplier(parseFloat(e.target.value) || 1.5)}
                  className="h-7 text-xs"
                  step="0.1"
                  min="1.1"
                  max="5"
                />
              </div>
              <div>
                <Label className="text-[10px]">Max Martingale Steps</Label>
                <Input
                  type="number"
                  value={defaultMaxMartingaleSteps}
                  onChange={(e) => setDefaultMaxMartingaleSteps(parseInt(e.target.value) || 1)}
                  className="h-7 text-xs"
                  min="1"
                  max="5"
                />
              </div>
            </div>
          </CardContent>
          
          {/* Stats Bar */}
          <CardContent className="p-3 pt-0">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 text-[10px]">
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Balance</div>
                <div className="font-bold">{formatCurrency(balance || 0)}</div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Total P&L</div>
                <div className={`font-bold ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatCurrency(totalProfit)}
                </div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Win Rate</div>
                <div className="font-bold">{formatPercentage(winRate)}</div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Trades</div>
                <div className="font-bold">{totalTrades}</div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Active</div>
                <div className="font-bold text-green-500">{activeBots}</div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Bots</div>
                <div className="font-bold">{bots.length}</div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">Qualifying</div>
                <div className="font-bold text-primary">{qualifyingMarkets}</div>
              </div>
              <div className="bg-muted/30 rounded p-1">
                <div className="text-muted-foreground">W/L</div>
                <div className="font-bold">
                  <span className="text-green-500">{totalWins}</span>/
                  <span className="text-red-500">{totalTrades - totalWins}</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
      
      {/* Bot Cards Grid */}
      {bots.length === 0 ? (
        <Card className="border-2 border-dashed bg-card/50">
          <CardContent className="p-8 text-center">
            <div className="relative">
              <Rocket className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
              <Scan className="w-8 h-8 absolute top-4 right-1/2 transform translate-x-12 text-primary animate-pulse" />
            </div>
            <h3 className="text-lg font-medium mb-2">No Bots Generated Yet</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
              Click "Fast Scan" to analyze all markets in under 20 seconds. Bots will be created automatically when conditions are met.
            </p>
            <Button onClick={scanAllMarketsFast} disabled={isScanning} size="lg">
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning Markets...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4 mr-2" />
                  Start Fast Scan
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {bots.map(bot => {
              const style = CONDITION_STYLES[bot.condition];
              const marketInfo = VOLATILITY_MARKETS.find(m => m.value === bot.market);
              
              return (
                <motion.div
                  key={bot.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <Card className={`border-2 ${style.border} ${style.bg} backdrop-blur-sm relative overflow-hidden`}>
                    {/* Gradient Background */}
                    <div className={`absolute inset-0 bg-gradient-to-br ${style.gradient} pointer-events-none`} />
                    
                    {/* Bot Header */}
                    <CardHeader className="p-3 pb-0 relative">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded-lg ${style.badge}`}>
                            {style.icon}
                          </div>
                          <div>
                            <CardTitle className="text-sm flex items-center gap-1">
                              {marketInfo?.icon} {bot.market}
                              <Badge className={`text-[8px] px-1 py-0 ${style.badge}`}>
                                {bot.condition.replace('_', ' ')}
                              </Badge>
                            </CardTitle>
                            <CardDescription className="text-[10px]">
                              Confidence: {bot.analysis.confidence.toFixed(0)}% | Entry: {bot.entryDigit ?? bot.entryType}
                            </CardDescription>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeBot(bot.id)}
                            className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                            disabled={bot.isRunning}
                          >
                            <XCircle className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => updateBotSetting(bot.id, 'expanded', !bot.expanded)}
                            className="h-6 w-6 p-0"
                          >
                            {bot.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    
                    {/* Market Statistics */}
                    <CardContent className="p-3 relative">
                      <div className="grid grid-cols-4 gap-1 text-[10px] mb-2">
                        <div>
                          <span className="text-muted-foreground">0-1-2:</span>
                          <span className={`ml-1 font-bold ${
                            bot.analysis.percentages.low012 < 10 ? 'text-emerald-500' : ''
                          }`}>
                            {bot.analysis.percentages.low012.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">7-8-9:</span>
                          <span className={`ml-1 font-bold ${
                            bot.analysis.percentages.high789 < 10 ? 'text-blue-500' : ''
                          }`}>
                            {bot.analysis.percentages.high789.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Even:</span>
                          <span className={`ml-1 font-bold ${
                            bot.analysis.percentages.even > 55 ? 'text-purple-500' : ''
                          }`}>
                            {bot.analysis.percentages.even.toFixed(1)}%
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Odd:</span>
                          <span className={`ml-1 font-bold ${
                            bot.analysis.percentages.odd > 55 ? 'text-orange-500' : ''
                          }`}>
                            {bot.analysis.percentages.odd.toFixed(1)}%
                          </span>
                        </div>
                      </div>
                      
                      {/* Bot Stats */}
                      <div className="grid grid-cols-3 gap-1 text-xs mb-2">
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-muted-foreground text-[8px]">P&L</div>
                          <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatCurrency(bot.totalPnl)}
                          </div>
                        </div>
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-muted-foreground text-[8px]">W/L</div>
                          <div>
                            <span className="text-green-500">{bot.wins}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-red-500">{bot.losses}</span>
                          </div>
                        </div>
                        <div className="bg-background/50 rounded p-1">
                          <div className="text-muted-foreground text-[8px]">Status</div>
                          <div className={`flex items-center gap-0.5 ${
                            bot.status === 'trading' ? 'text-green-500' :
                            bot.status === 'martingale' ? 'text-orange-500' :
                            bot.status === 'watching' ? 'text-yellow-500' :
                            bot.status === 'completed' ? 'text-blue-500' :
                            'text-gray-500'
                          }`}>
                            {bot.status === 'trading' && <Activity className="w-3 h-3" />}
                            {bot.status === 'martingale' && <RefreshCw className="w-3 h-3 animate-spin" />}
                            {bot.status === 'watching' && <Eye className="w-3 h-3" />}
                            {bot.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                            {bot.status === 'stopped' && <StopCircle className="w-3 h-3" />}
                            {bot.status === 'idle' && <CircleDot className="w-3 h-3" />}
                            <span className="text-[8px] capitalize">{bot.status}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Martingale Progress */}
                      {bot.martingaleStep > 0 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-[8px] text-muted-foreground mb-0.5">
                            <span>Martingale Step {bot.martingaleStep}/{bot.maxMartingaleSteps}</span>
                            <span className="font-medium text-orange-500">Stake: {formatCurrency(bot.currentStake)}</span>
                          </div>
                          <Progress value={(bot.martingaleStep / bot.maxMartingaleSteps) * 100} className="h-1" />
                        </div>
                      )}
                    </CardContent>
                    
                    {/* Expanded Settings - All User Configurable */}
                    <AnimatePresence>
                      {bot.expanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <CardContent className="p-3 pt-0 relative">
                            <Separator className="mb-3" />
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <Label className="text-[8px]">Stake ($)</Label>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateBotSetting(bot.id, 'stake', Math.max(0.1, bot.stake - 0.1))}
                                    className="h-6 w-6 p-0"
                                    disabled={bot.isRunning}
                                  >
                                    <Minus className="w-2 h-2" />
                                  </Button>
                                  <Input
                                    type="number"
                                    value={bot.stake}
                                    onChange={(e) => updateBotSetting(bot.id, 'stake', parseFloat(e.target.value) || 0.1)}
                                    disabled={bot.isRunning}
                                    className="h-6 text-[8px] text-center p-0"
                                    step="0.1"
                                    min="0.1"
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateBotSetting(bot.id, 'stake', bot.stake + 0.1)}
                                    className="h-6 w-6 p-0"
                                    disabled={bot.isRunning}
                                  >
                                    <Plus className="w-2 h-2" />
                                  </Button>
                                </div>
                              </div>
                              
                              <div>
                                <Label className="text-[8px]">Duration (ticks)</Label>
                                <Select
                                  value={bot.duration.toString()}
                                  onValueChange={(v) => updateBotSetting(bot.id, 'duration', parseInt(v))}
                                  disabled={bot.isRunning}
                                >
                                  <SelectTrigger className="h-6 text-[8px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {[1,2,3,4,5,6,7,8,9,10].map(d => (
                                      <SelectItem key={d} value={d.toString()} className="text-[8px]">
                                        {d} {d === 1 ? 'tick' : 'ticks'}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              
                              <div>
                                <Label className="text-[8px]">Take Profit ($)</Label>
                                <Input
                                  type="number"
                                  value={bot.takeProfit}
                                  onChange={(e) => updateBotSetting(bot.id, 'takeProfit', parseFloat(e.target.value) || 0)}
                                  disabled={bot.isRunning}
                                  className="h-6 text-[8px]"
                                  step="5"
                                />
                              </div>
                              
                              <div>
                                <Label className="text-[8px]">Stop Loss ($)</Label>
                                <Input
                                  type="number"
                                  value={bot.stopLoss}
                                  onChange={(e) => updateBotSetting(bot.id, 'stopLoss', parseFloat(e.target.value) || 0)}
                                  disabled={bot.isRunning}
                                  className="h-6 text-[8px]"
                                  step="5"
                                />
                              </div>
                              
                              <div>
                                <Label className="text-[8px]">Martingale Multiplier</Label>
                                <Input
                                  type="number"
                                  value={bot.martingaleMultiplier}
                                  onChange={(e) => updateBotSetting(bot.id, 'martingaleMultiplier', parseFloat(e.target.value) || 1.5)}
                                  disabled={bot.isRunning}
                                  className="h-6 text-[8px]"
                                  step="0.1"
                                  min="1.1"
                                  max="5"
                                />
                              </div>
                              
                              <div>
                                <Label className="text-[8px]">Max Martingale Steps</Label>
                                <Input
                                  type="number"
                                  value={bot.maxMartingaleSteps}
                                  onChange={(e) => updateBotSetting(bot.id, 'maxMartingaleSteps', parseInt(e.target.value) || 1)}
                                  disabled={bot.isRunning}
                                  className="h-6 text-[8px]"
                                  min="1"
                                  max="5"
                                />
                              </div>
                            </div>
                          </CardContent>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {/* Bot Actions */}
                    <CardFooter className="p-3 pt-0 flex gap-2 relative">
                      {!bot.isRunning ? (
                        <Button
                          onClick={() => startBot(bot.id)}
                          disabled={!isAuthorized || balance < bot.stake || activeTradeId !== null}
                          className={`flex-1 h-7 text-xs ${style.badge} hover:opacity-80`}
                          size="sm"
                        >
                          <Play className="w-3 h-3 mr-1" />
                          Start Bot
                        </Button>
                      ) : (
                        <Button
                          onClick={() => stopBot(bot.id)}
                          variant="destructive"
                          className="flex-1 h-7 text-xs"
                          size="sm"
                        >
                          <StopCircle className="w-3 h-3 mr-1" />
                          Stop Bot
                        </Button>
                      )}
                    </CardFooter>
                  </Card>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      
      {/* Trade Log */}
      {tradeLogs.length > 0 && (
        <Card className="mt-4 border-2 bg-card/50 backdrop-blur-sm">
          <CardHeader className="p-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Recent Trades
            </CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0">
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {tradeLogs.slice(0, 10).map(trade => (
                <div
                  key={trade.id}
                  className={`flex items-center justify-between p-1.5 rounded text-xs ${
                    trade.result === 'win' ? 'bg-green-500/10' :
                    trade.result === 'loss' ? 'bg-red-500/10' :
                    'bg-yellow-500/10'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-[8px]">
                      {trade.timestamp.toLocaleTimeString()}
                    </span>
                    <Badge variant="outline" className="text-[6px] px-1 py-0">
                      {trade.botName}
                    </Badge>
                    <span className="text-[8px]">{trade.entryType}</span>
                    {trade.digit !== undefined && (
                      <span className="text-[8px] text-muted-foreground">→ {trade.digit}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-mono">{formatCurrency(trade.stake)}</span>
                    {trade.martingaleStep > 0 && (
                      <Badge className="text-[6px] px-1 py-0 bg-orange-500/20 text-orange-500">
                        M{trade.martingaleStep}
                      </Badge>
                    )}
                    <span className={`text-[8px] font-bold ${
                      trade.result === 'win' ? 'text-green-500' :
                      trade.result === 'loss' ? 'text-red-500' :
                      'text-yellow-500'
                    }`}>
                      {trade.result === 'win' ? `+${formatCurrency(trade.profit)}` :
                       trade.result === 'loss' ? `-${formatCurrency(Math.abs(trade.profit))}` :
                       'Pending'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
