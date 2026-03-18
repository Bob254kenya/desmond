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
  Loader2, Activity, Target, AlertCircle, CheckCircle2, Clock, Hash,
  Zap, Gauge, Volume2, VolumeX, Timer, XCircle, Settings, ChevronDown,
  ChevronUp, DollarSign, Percent, Plus, Minus, BarChart3, LineChart,
  Brain, Scan, Trash2, Download, Upload, Copy, Eye, EyeOff
} from 'lucide-react';

// ==================== TYPES ====================

interface MarketDigits {
  [key: string]: number[];
}

interface MarketAnalysis {
  symbol: string;
  digits: {
    count0: number; count1: number; count2: number; count3: number;
    count4: number; count5: number; count6: number; count7: number;
    count8: number; count9: number;
  };
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
  condition: 'LOW_012' | 'LOW_789' | 'EVEN_55' | 'ODD_4' | 'NONE';
  confidence: number;
  recommendedEntry: number | 'EVEN' | 'ODD';
  lastUpdated: Date;
}

interface AutoBot {
  id: string;
  market: string;
  name: string;
  condition: 'LOW_012' | 'LOW_789' | 'EVEN_55' | 'ODD_4';
  entryType: 'digit' | 'even' | 'odd';
  entryDigit?: number;
  contractType: string;
  duration: number;
  
  // User configurable only (stake, tp, sl)
  stake: number;
  takeProfit: number;
  stopLoss: number;
  
  // Recovery settings (fixed)
  recoveryMultiplier: 2;
  maxRecoverySteps: 3;
  
  // Bot state
  isRunning: boolean;
  status: 'idle' | 'trading' | 'recovery' | 'stopped' | 'completed';
  currentRun: number;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  recoveryStep: number;
  lastTradeResult?: 'win' | 'loss';
  
  // Market data
  analysis: MarketAnalysis;
  
  // UI
  expanded: boolean;
  showSettings: boolean;
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
  recoveryStep: number;
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

const CONDITION_CONFIG = {
  LOW_012: {
    name: 'Low 0-1-2 Bot',
    color: 'border-green-500 bg-green-500/5',
    badge: 'bg-green-500/20 text-green-500',
    icon: <TrendingDown className="w-4 h-4" />,
    entryType: 'digit',
    contractType: 'DIGITMATCH'
  },
  LOW_789: {
    name: 'Low 7-8-9 Bot',
    color: 'border-blue-500 bg-blue-500/5',
    badge: 'bg-blue-500/20 text-blue-500',
    icon: <TrendingUp className="w-4 h-4" />,
    entryType: 'digit',
    contractType: 'DIGITMATCH'
  },
  EVEN_55: {
    name: 'Even Dominant Bot',
    color: 'border-purple-500 bg-purple-500/5',
    badge: 'bg-purple-500/20 text-purple-500',
    icon: <CircleDot className="w-4 h-4" />,
    entryType: 'even',
    contractType: 'DIGITEVEN'
  },
  ODD_4: {
    name: 'Odd with 4 Focus Bot',
    color: 'border-orange-500 bg-orange-500/5',
    badge: 'bg-orange-500/20 text-orange-500',
    icon: <Hash className="w-4 h-4" />,
    entryType: 'odd',
    contractType: 'DIGITODD'
  }
};

// ==================== HELPER FUNCTIONS ====================

const analyzeMarketDigits = (ticks: number[]): MarketAnalysis => {
  if (ticks.length === 0) {
    return {
      symbol: '',
      digits: {
        count0: 0, count1: 0, count2: 0, count3: 0, count4: 0,
        count5: 0, count6: 0, count7: 0, count8: 0, count9: 0
      },
      percentages: {
        p0: 0, p1: 0, p2: 0, p3: 0, p4: 0, p5: 0, p6: 0, p7: 0, p8: 0, p9: 0,
        low012: 0, high789: 0, even: 0, odd: 0
      },
      mostFrequent: 0,
      leastFrequent: 0,
      condition: 'NONE',
      confidence: 0,
      recommendedEntry: 0,
      lastUpdated: new Date()
    };
  }

  const last1000 = ticks.slice(-1000);
  const total = last1000.length;
  
  // Initialize counters
  const counts = {
    count0: 0, count1: 0, count2: 0, count3: 0, count4: 0,
    count5: 0, count6: 0, count7: 0, count8: 0, count9: 0
  };
  
  // Count digits
  last1000.forEach(tick => {
    const digit = Math.floor(tick % 10);
    switch(digit) {
      case 0: counts.count0++; break;
      case 1: counts.count1++; break;
      case 2: counts.count2++; break;
      case 3: counts.count3++; break;
      case 4: counts.count4++; break;
      case 5: counts.count5++; break;
      case 6: counts.count6++; break;
      case 7: counts.count7++; break;
      case 8: counts.count8++; break;
      case 9: counts.count9++; break;
    }
  });
  
  // Calculate percentages
  const percentages = {
    p0: (counts.count0 / total) * 100,
    p1: (counts.count1 / total) * 100,
    p2: (counts.count2 / total) * 100,
    p3: (counts.count3 / total) * 100,
    p4: (counts.count4 / total) * 100,
    p5: (counts.count5 / total) * 100,
    p6: (counts.count6 / total) * 100,
    p7: (counts.count7 / total) * 100,
    p8: (counts.count8 / total) * 100,
    p9: (counts.count9 / total) * 100,
    low012: ((counts.count0 + counts.count1 + counts.count2) / total) * 100,
    high789: ((counts.count7 + counts.count8 + counts.count9) / total) * 100,
    even: ((counts.count0 + counts.count2 + counts.count4 + counts.count6 + counts.count8) / total) * 100,
    odd: ((counts.count1 + counts.count3 + counts.count5 + counts.count7 + counts.count9) / total) * 100
  };
  
  // Find most/least frequent
  const countsArray = [
    { digit: 0, count: counts.count0 },
    { digit: 1, count: counts.count1 },
    { digit: 2, count: counts.count2 },
    { digit: 3, count: counts.count3 },
    { digit: 4, count: counts.count4 },
    { digit: 5, count: counts.count5 },
    { digit: 6, count: counts.count6 },
    { digit: 7, count: counts.count7 },
    { digit: 8, count: counts.count8 },
    { digit: 9, count: counts.count9 }
  ];
  
  countsArray.sort((a, b) => b.count - a.count);
  const mostFrequent = countsArray[0].digit;
  const leastFrequent = countsArray[9].digit;
  
  // Determine condition
  let condition: 'LOW_012' | 'LOW_789' | 'EVEN_55' | 'ODD_4' | 'NONE' = 'NONE';
  let confidence = 0;
  let recommendedEntry: number | 'EVEN' | 'ODD' = 0;
  
  if (percentages.low012 < 10) {
    condition = 'LOW_012';
    confidence = Math.max(0, 100 - percentages.low012 * 2);
    // Recommend most frequent among 0,1,2
    const lowDigits = countsArray.filter(d => d.digit <= 2);
    recommendedEntry = lowDigits[0]?.digit || 0;
  }
  else if (percentages.high789 < 10) {
    condition = 'LOW_789';
    confidence = Math.max(0, 100 - percentages.high789 * 2);
    // Recommend most frequent among 7,8,9
    const highDigits = countsArray.filter(d => d.digit >= 7);
    recommendedEntry = highDigits[0]?.digit || 7;
  }
  else if (percentages.even > 55) {
    condition = 'EVEN_55';
    confidence = percentages.even;
    recommendedEntry = 'EVEN';
  }
  else if (percentages.odd > 55 && counts.count4 > (total / 10) * 1.2) {
    condition = 'ODD_4';
    confidence = percentages.odd;
    recommendedEntry = 4;
  }
  
  return {
    symbol: '',
    digits: counts,
    percentages,
    mostFrequent,
    leastFrequent,
    condition,
    confidence,
    recommendedEntry,
    lastUpdated: new Date()
  };
};

const waitForNextTick = (symbol: string): Promise<{ quote: number; epoch: number }> => {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, epoch: data.tick.epoch });
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

export default function AutoBotGenerator() {
  const { isAuthorized, balance } = useAuth();
  
  // ==================== STATE ====================
  
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentScanMarket, setCurrentScanMarket] = useState('');
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  const [marketTicks, setMarketTicks] = useState<MarketDigits>({});
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [autoBots, setAutoBots] = useState<AutoBot[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  
  const [globalStake, setGlobalStake] = useState(1.00);
  const [globalTakeProfit, setGlobalTakeProfit] = useState(10);
  const [globalStopLoss, setGlobalStopLoss] = useState(25);
  
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Refs
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const marketDataRef = useRef<MarketDigits>({});

  // ==================== AUTO SCAN ON LOAD ====================
  
  useEffect(() => {
    // Auto-scan on page load
    scanAllMarkets();
    
    // Set up auto-scan every 5 minutes
    scanIntervalRef.current = setInterval(() => {
      scanAllMarkets();
    }, 300000); // 5 minutes
    
    return () => {
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    };
  }, []);

  // ==================== SCAN ALL MARKETS ====================
  
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    
    const markets = VOLATILITY_MARKETS.map(m => m.value);
    const totalMarkets = markets.length;
    const newAnalyses: Record<string, MarketAnalysis> = {};
    
    try {
      // Connect to Deriv API
      await derivApi.connect();
      
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        setCurrentScanMarket(market);
        setScanProgress(Math.round(((i + 1) / totalMarkets) * 100));
        
        try {
          // Subscribe to ticks
          await derivApi.subscribeTicks(market);
          
          // Wait to collect 1000 ticks
          let ticks: number[] = [];
          let tickCount = 0;
          
          while (ticks.length < 1000 && tickCount < 1200) {
            await new Promise(r => setTimeout(r, 100));
            const history = await derivApi.getTickHistory(market, 1000);
            if (history && history.length > 0) {
              ticks = history.map((t: any) => t.quote);
            }
            tickCount++;
          }
          
          if (ticks.length >= 100) {
            marketDataRef.current[market] = ticks;
            setMarketTicks(prev => ({ ...prev, [market]: ticks }));
            
            // Analyze market
            const analysis = analyzeMarketDigits(ticks);
            analysis.symbol = market;
            newAnalyses[market] = analysis;
            
            // Auto-create bot if condition met
            if (analysis.condition !== 'NONE' && analysis.confidence > 70) {
              createBotFromAnalysis(market, analysis);
            }
          }
          
          // Unsubscribe
          await derivApi.unsubscribeTicks(market);
          
        } catch (error) {
          console.error(`Error scanning ${market}:`, error);
        }
      }
      
      setMarketAnalyses(prev => ({ ...prev, ...newAnalyses }));
      setLastScanTime(new Date());
      
      // Remove bots for markets that no longer qualify
      setAutoBots(prev => prev.filter(bot => {
        const analysis = newAnalyses[bot.market];
        return analysis && analysis.condition === bot.condition && analysis.confidence > 70;
      }));
      
      if (soundEnabled) {
        playSound('success');
      }
      
      toast.success(`✅ Scanned ${totalMarkets} markets, ${Object.keys(newAnalyses).filter(m => newAnalyses[m].condition !== 'NONE').length} conditions met`);
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      setCurrentScanMarket('');
    }
  }, [isScanning, soundEnabled]);

  // ==================== CREATE BOT FROM ANALYSIS ====================
  
  const createBotFromAnalysis = useCallback((market: string, analysis: MarketAnalysis) => {
    // Check if bot already exists
    const existingBot = autoBots.find(b => b.market === market && b.condition === analysis.condition);
    if (existingBot) return;
    
    const config = CONDITION_CONFIG[analysis.condition];
    
    const newBot: AutoBot = {
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      market,
      name: `${market} - ${config.name}`,
      condition: analysis.condition,
      entryType: config.entryType as 'digit' | 'even' | 'odd',
      entryDigit: typeof analysis.recommendedEntry === 'number' ? analysis.recommendedEntry : undefined,
      contractType: config.contractType,
      duration: 5,
      
      // User configurable
      stake: globalStake,
      takeProfit: globalTakeProfit,
      stopLoss: globalStopLoss,
      
      // Fixed recovery settings
      recoveryMultiplier: 2,
      maxRecoverySteps: 3,
      
      // Bot state
      isRunning: false,
      status: 'idle',
      currentRun: 0,
      currentStake: globalStake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      recoveryStep: 0,
      
      // Market data
      analysis,
      
      // UI
      expanded: true,
      showSettings: false
    };
    
    setAutoBots(prev => [...prev, newBot]);
    
    toast.success(`🤖 Auto-created ${newBot.name}`);
  }, [autoBots, globalStake, globalTakeProfit, globalStopLoss]);

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

  // ==================== RUN BOT ====================
  
  const runBot = useCallback(async (botId: string) => {
    const bot = autoBots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;
    
    // Check balance
    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }
    
    setAutoBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: true, 
        status: 'trading',
        currentStake: bot.stake
      } : b
    ));
    
    botRunningRefs.current[botId] = true;
    
    let currentStake = bot.stake;
    let totalPnl = bot.totalPnl;
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let currentRun = 0;
    let recoveryStep = 0;
    let inRecovery = false;
    
    while (botRunningRefs.current[botId] && currentRun < 3) {
      // Check TP/SL
      if (totalPnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop Loss reached!`);
        break;
      }
      if (totalPnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take Profit reached!`);
        break;
      }
      
      // Wait for next tick
      try {
        await waitForNextTick(bot.market);
        
        // Check entry condition
        const currentTick = marketDataRef.current[bot.market]?.slice(-1)[0];
        if (!currentTick) continue;
        
        const currentDigit = Math.floor(currentTick % 10);
        let shouldEnter = false;
        
        if (bot.entryType === 'digit' && bot.entryDigit !== undefined) {
          shouldEnter = currentDigit === bot.entryDigit;
        } else if (bot.entryType === 'even') {
          shouldEnter = currentDigit % 2 === 0;
        } else if (bot.entryType === 'odd') {
          shouldEnter = currentDigit % 2 === 1;
        }
        
        if (!shouldEnter) {
          await new Promise(r => setTimeout(r, 100));
          continue;
        }
        
        // Execute trade
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
        
        const tradeId = `${botId}-${Date.now()}`;
        setActiveTradeId(tradeId);
        
        // Add to trade log
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
          recoveryStep: inRecovery ? recoveryStep : 0
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
          if (inRecovery) {
            // Recovery successful - stop bot
            toast.success(`${bot.name}: Recovery successful! Stopping bot.`);
            botRunningRefs.current[botId] = false;
            break;
          } else {
            // Win on normal run - move to next run or stop
            currentRun++;
            currentStake = bot.stake; // Reset stake
            inRecovery = false;
            recoveryStep = 0;
            
            // Stop after any win (as per rules)
            if (currentRun < 3) {
              toast.success(`${bot.name}: Won on run ${currentRun}/3! Stopping bot.`);
              botRunningRefs.current[botId] = false;
              break;
            }
          }
        } else {
          losses++;
          
          if (!inRecovery) {
            // First loss - start recovery
            inRecovery = true;
            recoveryStep = 1;
            currentStake = bot.stake * bot.recoveryMultiplier;
            
            setAutoBots(prev => prev.map(b => 
              b.id === botId ? { ...b, status: 'recovery' } : b
            ));
          } else {
            // Recovery loss - increase stake
            recoveryStep++;
            if (recoveryStep <= bot.maxRecoverySteps) {
              currentStake = bot.stake * Math.pow(bot.recoveryMultiplier, recoveryStep);
            } else {
              // Max recovery steps reached - stop bot
              toast.error(`${bot.name}: Max recovery steps reached. Stopping bot.`);
              botRunningRefs.current[botId] = false;
              break;
            }
          }
        }
        
        setActiveTradeId(null);
        
        // Update bot state
        setAutoBots(prev => prev.map(b => 
          b.id === botId ? {
            ...b,
            totalPnl,
            trades,
            wins,
            losses,
            currentStake,
            currentRun,
            recoveryStep,
            lastTradeResult: won ? 'win' : 'loss'
          } : b
        ));
        
        await new Promise(r => setTimeout(r, 500));
        
      } catch (err: any) {
        setActiveTradeId(null);
        console.error('Trade error:', err);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    // Bot stopped
    setAutoBots(prev => prev.map(b => 
      b.id === botId ? {
        ...b,
        isRunning: false,
        status: totalPnl >= bot.takeProfit ? 'completed' : 'stopped'
      } : b
    ));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, autoBots]);

  // ==================== BOT CONTROLS ====================
  
  const startBot = (botId: string) => {
    const bot = autoBots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    runBot(botId);
  };
  
  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    
    setAutoBots(prev => prev.map(b => 
      b.id === botId ? {
        ...b,
        isRunning: false,
        status: 'stopped'
      } : b
    ));
  };
  
  const stopAllBots = () => {
    autoBots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    
    setAutoBots(prev => prev.map(b => ({
      ...b,
      isRunning: false,
      status: 'stopped'
    })));
  };
  
  const removeBot = (botId: string) => {
    stopBot(botId);
    setAutoBots(prev => prev.filter(b => b.id !== botId));
  };
  
  const updateBotStake = (botId: string, stake: number) => {
    setAutoBots(prev => prev.map(b => 
      b.id === botId ? { ...b, stake, currentStake: stake } : b
    ));
  };
  
  const updateBotTP = (botId: string, takeProfit: number) => {
    setAutoBots(prev => prev.map(b => 
      b.id === botId ? { ...b, takeProfit } : b
    ));
  };
  
  const updateBotSL = (botId: string, stopLoss: number) => {
    setAutoBots(prev => prev.map(b => 
      b.id === botId ? { ...b, stopLoss } : b
    ));
  };

  // ==================== CALCULATE STATS ====================
  
  const totalProfit = autoBots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = autoBots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = autoBots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  const activeBots = autoBots.filter(b => b.isRunning).length;
  const qualifyingMarkets = Object.values(marketAnalyses).filter(a => a.condition !== 'NONE').length;

  return (
    <div className="min-h-screen bg-background p-2 sm:p-4">
      {/* Header */}
      <div className="mb-4 space-y-3">
        <Card className="border-2 shadow-lg">
          <CardHeader className="p-3 sm:p-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-primary" />
                <div>
                  <CardTitle className="text-base sm:text-lg">Auto Bot Generator - Deriv Volatilities</CardTitle>
                  <CardDescription className="text-xs">
                    Automatically creates bots when market conditions are met
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
                
                {/* Settings Toggle */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowSettings(!showSettings)}
                  className="h-7 w-7 p-0"
                >
                  <Settings className="w-3 h-3" />
                </Button>
                
                {/* Manual Scan Button */}
                <Button
                  variant="default"
                  size="sm"
                  onClick={scanAllMarkets}
                  disabled={isScanning}
                  className="h-7 text-xs px-2"
                >
                  {isScanning ? (
                    <>
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      Scanning
                    </>
                  ) : (
                    <>
                      <Scan className="w-3 h-3 mr-1" />
                      Scan Now
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
              <div className="mt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                  <span>Scanning {currentScanMarket}...</span>
                  <span>{scanProgress}%</span>
                </div>
                <Progress value={scanProgress} className="h-1" />
              </div>
            )}
            
            {/* Last Scan Time */}
            {lastScanTime && !isScanning && (
              <div className="text-xs text-muted-foreground mt-1">
                Last scan: {lastScanTime.toLocaleTimeString()}
              </div>
            )}
          </CardHeader>
          
          {/* Statistics Panel */}
          <CardContent className="p-3 pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Balance</div>
                <div className="font-bold text-sm">{formatCurrency(balance || 0)}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Total P&L</div>
                <div className={`font-bold text-sm ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {formatCurrency(totalProfit)}
                </div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Win Rate</div>
                <div className="font-bold text-sm">{formatPercentage(winRate)}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Trades</div>
                <div className="font-bold text-sm">{totalTrades}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Markets Scanned</div>
                <div className="font-bold text-sm">{Object.keys(marketAnalyses).length}/{VOLATILITY_MARKETS.length}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Qualifying</div>
                <div className="font-bold text-sm text-green-500">{qualifyingMarkets}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Bots Generated</div>
                <div className="font-bold text-sm">{autoBots.length}</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2">
                <div className="text-muted-foreground">Active Trades</div>
                <div className="font-bold text-sm">{activeBots}</div>
              </div>
            </div>
          </CardContent>
          
          {/* Global Settings (only stake, TP, SL) */}
          <AnimatePresence>
            {showSettings && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <CardContent className="p-3 pt-0">
                  <Separator className="mb-3" />
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Default Stake ($)</Label>
                      <Input
                        type="number"
                        value={globalStake}
                        onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 1)}
                        className="h-8 text-xs"
                        step="0.1"
                        min="0.1"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Take Profit ($)</Label>
                      <Input
                        type="number"
                        value={globalTakeProfit}
                        onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 10)}
                        className="h-8 text-xs"
                        step="5"
                        min="0"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Stop Loss ($)</Label>
                      <Input
                        type="number"
                        value={globalStopLoss}
                        onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 25)}
                        className="h-8 text-xs"
                        step="5"
                        min="0"
                      />
                    </div>
                  </div>
                </CardContent>
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      </div>
      
      {/* Bot Cards Grid */}
      {autoBots.length === 0 ? (
        <Card className="border-2 border-dashed">
          <CardContent className="p-8 text-center">
            <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
            <h3 className="text-lg font-medium mb-2">No Bots Generated Yet</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Click "Scan Now" to analyze markets and automatically create bots when conditions are met.
            </p>
            <Button onClick={scanAllMarkets} disabled={isScanning}>
              {isScanning ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Scanning Markets...
                </>
              ) : (
                <>
                  <Scan className="w-4 h-4 mr-2" />
                  Start Scan
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <AnimatePresence>
            {autoBots.map(bot => {
              const config = CONDITION_CONFIG[bot.condition];
              const marketInfo = VOLATILITY_MARKETS.find(m => m.value === bot.market);
              
              return (
                <motion.div
                  key={bot.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                >
                  <Card className={`border-2 ${config.color}`}>
                    {/* Bot Header */}
                    <CardHeader className="p-3 pb-0">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className={`p-1.5 rounded ${config.badge}`}>
                            {config.icon}
                          </div>
                          <div>
                            <CardTitle className="text-sm flex items-center gap-1">
                              {marketInfo?.icon} {bot.market}
                              <Badge className={`text-[8px] px-1 py-0 ${config.badge}`}>
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
                            className="h-6 w-6 p-0 text-red-500"
                            disabled={bot.isRunning}
                          >
                            <XCircle className="w-3 h-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAutoBots(prev => prev.map(b => 
                              b.id === bot.id ? { ...b, expanded: !b.expanded } : b
                            ))}
                            className="h-6 w-6 p-0"
                          >
                            {bot.expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    
                    {/* Market Statistics */}
                    <CardContent className="p-3">
                      <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                        <div>
                          <span className="text-muted-foreground">0-1-2:</span>
                          <span className={`ml-1 font-bold ${
                            bot.analysis.percentages.low012 < 10 ? 'text-green-500' : ''
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
                        <div>
                          <span className="text-muted-foreground">Most:</span>
                          <span className="ml-1 font-bold">{bot.analysis.mostFrequent}</span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Least:</span>
                          <span className="ml-1 font-bold">{bot.analysis.leastFrequent}</span>
                        </div>
                      </div>
                      
                      {/* Bot Stats */}
                      <div className="grid grid-cols-3 gap-1 text-xs mb-2">
                        <div>
                          <div className="text-muted-foreground">P&L</div>
                          <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                            {formatCurrency(bot.totalPnl)}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">W/L</div>
                          <div>
                            <span className="text-green-500">{bot.wins}</span>
                            <span className="text-muted-foreground">/</span>
                            <span className="text-red-500">{bot.losses}</span>
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Status</div>
                          <div className={`flex items-center gap-0.5 ${
                            bot.status === 'trading' ? 'text-green-500' :
                            bot.status === 'recovery' ? 'text-orange-500' :
                            bot.status === 'completed' ? 'text-blue-500' :
                            'text-gray-500'
                          }`}>
                            {bot.status === 'trading' && <Activity className="w-3 h-3" />}
                            {bot.status === 'recovery' && <RefreshCw className="w-3 h-3" />}
                            {bot.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                            {bot.status === 'stopped' && <StopCircle className="w-3 h-3" />}
                            {bot.status === 'idle' && <CircleDot className="w-3 h-3" />}
                            <span className="text-[10px] capitalize">{bot.status}</span>
                          </div>
                        </div>
                      </div>
                      
                      {/* Recovery Progress */}
                      {bot.recoveryStep > 0 && (
                        <div className="mb-2">
                          <div className="flex justify-between text-[8px] text-muted-foreground mb-0.5">
                            <span>Recovery Step {bot.recoveryStep}/{bot.maxRecoverySteps}</span>
                            <span>Stake: {formatCurrency(bot.currentStake)}</span>
                          </div>
                          <Progress value={(bot.recoveryStep / bot.maxRecoverySteps) * 100} className="h-1" />
                        </div>
                      )}
                    </CardContent>
                    
                    {/* Expanded Settings - Only Stake, TP, SL */}
                    <AnimatePresence>
                      {bot.expanded && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                        >
                          <CardContent className="p-3 pt-0">
                            <Separator className="mb-3" />
                            <div className="grid grid-cols-3 gap-2">
                              <div>
                                <Label className="text-[8px]">Stake ($)</Label>
                                <div className="flex items-center gap-1">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateBotStake(bot.id, Math.max(0.1, bot.stake - 0.1))}
                                    className="h-6 w-6 p-0"
                                    disabled={bot.isRunning}
                                  >
                                    <Minus className="w-2 h-2" />
                                  </Button>
                                  <Input
                                    type="number"
                                    value={bot.stake}
                                    onChange={(e) => updateBotStake(bot.id, parseFloat(e.target.value) || 0.1)}
                                    disabled={bot.isRunning}
                                    className="h-6 text-[8px] text-center p-0"
                                    step="0.1"
                                    min="0.1"
                                  />
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => updateBotStake(bot.id, bot.stake + 0.1)}
                                    className="h-6 w-6 p-0"
                                    disabled={bot.isRunning}
                                  >
                                    <Plus className="w-2 h-2" />
                                  </Button>
                                </div>
                              </div>
                              <div>
                                <Label className="text-[8px]">TP ($)</Label>
                                <Input
                                  type="number"
                                  value={bot.takeProfit}
                                  onChange={(e) => updateBotTP(bot.id, parseFloat(e.target.value) || 0)}
                                  disabled={bot.isRunning}
                                  className="h-6 text-[8px]"
                                  step="5"
                                  min="0"
                                />
                              </div>
                              <div>
                                <Label className="text-[8px]">SL ($)</Label>
                                <Input
                                  type="number"
                                  value={bot.stopLoss}
                                  onChange={(e) => updateBotSL(bot.id, parseFloat(e.target.value) || 0)}
                                  disabled={bot.isRunning}
                                  className="h-6 text-[8px]"
                                  step="5"
                                  min="0"
                                />
                              </div>
                            </div>
                          </CardContent>
                        </motion.div>
                      )}
                    </AnimatePresence>
                    
                    {/* Bot Actions */}
                    <CardFooter className="p-3 pt-0 flex gap-2">
                      {!bot.isRunning ? (
                        <Button
                          onClick={() => startBot(bot.id)}
                          disabled={!isAuthorized || balance < bot.stake || activeTradeId !== null}
                          className="flex-1 h-7 text-xs"
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
        <Card className="mt-4">
          <CardHeader className="p-3">
            <CardTitle className="text-sm">Recent Trades</CardTitle>
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
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[8px] font-mono">{formatCurrency(trade.stake)}</span>
                    {trade.recoveryStep > 0 && (
                      <Badge className="text-[6px] px-1 py-0 bg-orange-500/20 text-orange-500">
                        R{trade.recoveryStep}
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
