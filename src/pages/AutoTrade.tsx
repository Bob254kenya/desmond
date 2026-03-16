import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, Scan, Brain, Activity, Target,
  AlertCircle, CheckCircle2, Clock, Hash, Zap, Shield, Gauge,
  Volume2, VolumeX, Timer, XCircle
} from 'lucide-react';

interface MarketAnalysis {
  symbol: string;
  mostAppearing: number;
  secondMost: number;
  leastAppearing: number;
  evenCount: number;
  oddCount: number;
  over3Count: number;
  under6Count: number;
  over8Count: number;
  under3Count: number;
  over1Count: number;
  under8Count: number;
  over4Count: number;
  under5Count: number;
  lastDigit: number;
  previousDigit: number;
  evenPercent: number;
  oddPercent: number;
  underPercent: number;
  overPercent: number;
  marketScore: number;
  recommendedBot: string;
}

interface BotState {
  id: string;
  name: string;
  type: 'over1' | 'over2' | 'over3' | 'under6' | 'even' | 'odd' | 'differs' | 'alternating';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  contractType: string;
  barrier?: number;
  selectedMarket?: string;
  status: 'idle' | 'waiting' | 'trading' | 'cooldown' | 'recovery';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
  recoveryStage: number;
  signal: boolean;
  alternatingState?: 'EVEN' | 'ODD';
  currentMarketDigits?: number[];
}

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Pending' | 'Win' | 'Loss';
  pnl: number;
  bot: string;
  lastDigit?: number;
  signalType?: string;
  marketScore?: number;
}

const VOLATILITY_MARKETS = [
  // Standard Volatility
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1-Second Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Boom & Crash
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Daily Reset
  'RDBEAR', 'RDBULL'
];

// Market display helper - reduced font sizes
const getMarketDisplay = (market: string) => {
  if (market.startsWith('1HZ')) return `⚡${market.replace('1HZ', '')}`;
  if (market.startsWith('R_')) return `📈${market.replace('R_', '')}`;
  if (market.startsWith('BOOM')) return `💥${market.replace('BOOM', '')}`;
  if (market.startsWith('CRASH')) return `📉${market.replace('CRASH', '')}`;
  if (market.startsWith('JD')) return `🦘${market.replace('JD', '')}`;
  if (market === 'RDBEAR') return `🐻B`;
  if (market === 'RDBULL') return `🐂B`;
  return market;
};

function waitForNextTick(symbol: string): Promise<{ quote: number; epoch: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, epoch: data.tick.epoch });
      }
    });
  });
}

// Play sound effect
const playScanSound = () => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.1);
  } catch (e) {
    console.log('Audio not supported');
  }
};

// ==================== ENHANCED MARKET ANALYSIS ====================
const analyzeMarket = (digits: number[]): MarketAnalysis => {
  if (digits.length < 700) return {} as MarketAnalysis;
  
  const last700 = digits.slice(-700);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  
  const over3Count = [4,5,6,7,8,9].reduce((sum, d) => sum + counts[d], 0);
  const under6Count = [0,1,2,3,4,5].reduce((sum, d) => sum + counts[d], 0);
  const over8Count = [9].reduce((sum, d) => sum + counts[d], 0);
  const under3Count = [0,1,2].reduce((sum, d) => sum + counts[d], 0);
  const over1Count = [2,3,4,5,6,7,8,9].reduce((sum, d) => sum + counts[d], 0);
  const under8Count = [0,1,2,3,4,5,6,7].reduce((sum, d) => sum + counts[d], 0);
  const over4Count = [5,6,7,8,9].reduce((sum, d) => sum + counts[d], 0);
  const under5Count = [0,1,2,3,4].reduce((sum, d) => sum + counts[d], 0);
  
  const evenPercent = (evenCount / 700) * 100;
  const oddPercent = (oddCount / 700) * 100;
  const underPercent = (under5Count / 700) * 100;
  const overPercent = (over4Count / 700) * 100;
  
  const lastDigit = digits.length > 0 ? digits[digits.length - 1] : 0;
  const previousDigit = digits.length > 1 ? digits[digits.length - 2] : 0;
  
  // Calculate market score (0-10)
  let marketScore = 0;
  
  // Even/Odd imbalance
  if (evenPercent > 65 || oddPercent > 65) marketScore += 3;
  else if (evenPercent > 60 || oddPercent > 60) marketScore += 2;
  else if (evenPercent > 55 || oddPercent > 55) marketScore += 1;
  
  // Over/Under imbalance
  if (overPercent > 70 || underPercent > 70) marketScore += 3;
  else if (overPercent > 65 || underPercent > 65) marketScore += 2;
  else if (overPercent > 60 || underPercent > 60) marketScore += 1;
  
  // Recommend best bot
  let recommendedBot = 'EVEN Bot';
  if (evenPercent > 60) recommendedBot = 'EVEN Bot';
  else if (oddPercent > 60) recommendedBot = 'ODD Bot';
  else if (underPercent > 65) {
    if (counts[0] + counts[1] > 100) recommendedBot = 'OVER 1 → OVER 3';
    else if (counts[0] + counts[1] + counts[2] > 200) recommendedBot = 'OVER 2 → OVER 3';
    else recommendedBot = 'OVER 3 Bot';
  }
  else if (overPercent > 65) recommendedBot = 'UNDER 6 Bot';
  else if (evenPercent > 55 && oddPercent > 45) recommendedBot = 'EVEN Alternating';
  
  return {
    symbol: '',
    mostAppearing: sortedDigits[0],
    secondMost: sortedDigits[1],
    leastAppearing: sortedDigits[9],
    evenCount,
    oddCount,
    over3Count,
    under6Count,
    over8Count,
    under3Count,
    over1Count,
    under8Count,
    over4Count,
    under5Count,
    lastDigit,
    previousDigit,
    evenPercent,
    oddPercent,
    underPercent,
    overPercent,
    marketScore,
    recommendedBot
  };
};

// ==================== ENTRY CONDITIONS FOR ALL 10 BOTS ====================

// BOT 1: OVER 1 → RECOVERY OVER 3
const checkOver1Entry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastDigit = digits[digits.length - 1];
  return lastDigit === 0 || lastDigit === 1;
};

// BOT 2: OVER 2 → RECOVERY OVER 3
const checkOver2Entry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d <= 2);
};

// BOT 3: OVER 3
const checkOver3Entry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d <= 3);
};

// BOT 4: UNDER 6
const checkUnder6Entry = (digits: number[]): boolean => {
  if (digits.length < 3) return false;
  const lastTwo = digits.slice(-2);
  return lastTwo.every(d => d >= 6);
};

// BOT 5: EVEN
const checkEvenEntry = (digits: number[]): boolean => {
  if (digits.length < 4) return false;
  const lastThree = digits.slice(-3);
  return lastThree.filter(d => d % 2 === 0).length >= 2;
};

// BOT 6: ODD
const checkOddEntry = (digits: number[]): boolean => {
  if (digits.length < 4) return false;
  const lastThree = digits.slice(-3);
  return lastThree.filter(d => d % 2 === 1).length >= 2;
};

// BOT 7: OVER 1 → ODD
const checkOver1OddEntry = (digits: number[], analysis: MarketAnalysis): boolean => {
  if (digits.length < 3) return false;
  const lastDigit = digits[digits.length - 1];
  return (lastDigit === 0 || lastDigit === 1) && analysis.oddPercent > 55;
};

// BOT 8: OVER 1 → EVEN
const checkOver1EvenEntry = (digits: number[], analysis: MarketAnalysis): boolean => {
  if (digits.length < 3) return false;
  const lastDigit = digits[digits.length - 1];
  return (lastDigit === 0 || lastDigit === 1) && analysis.evenPercent > 55;
};

// BOT 9: EVEN ALTERNATING
const checkAlternatingEntry = (digits: number[], state: 'EVEN' | 'ODD'): boolean => {
  if (digits.length < 4) return false;
  const lastThree = digits.slice(-3);
  if (state === 'EVEN') {
    return lastThree.filter(d => d % 2 === 0).length >= 2;
  } else {
    return lastThree.filter(d => d % 2 === 1).length >= 2;
  }
};

// BOT 10: DIFFERS
const checkDiffersEntry = (digits: number[]): boolean => {
  if (digits.length < 10) return false;
  const lastTen = digits.slice(-10);
  const uniqueDigits = new Set(lastTen);
  return uniqueDigits.size >= 8;
};

// Master signal checker for all bots
const checkAllSignals = (digits: number[], analysis?: MarketAnalysis): Record<string, boolean> => {
  return {
    over1: checkOver1Entry(digits),
    over2: checkOver2Entry(digits),
    over3: checkOver3Entry(digits),
    under6: checkUnder6Entry(digits),
    even: checkEvenEntry(digits),
    odd: checkOddEntry(digits),
    over1Odd: analysis ? checkOver1OddEntry(digits, analysis) : false,
    over1Even: analysis ? checkOver1EvenEntry(digits, analysis) : false,
    differs: checkDiffersEntry(digits)
  };
};

// ==================== MAIN COMPONENT ====================
export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [marketSignals, setMarketSignals] = useState<Record<string, Record<string, boolean>>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [globalStake, setGlobalStake] = useState<number>(1.00);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2.0);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(50);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(25);
  const [selectedMarketForScan, setSelectedMarketForScan] = useState<string>('R_100');
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTimer, setScanTimer] = useState(0);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // Update market digits for all markets
  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarketForScan] = digits;
      
      const analysis = analyzeMarket(digits);
      analysis.symbol = selectedMarketForScan;
      
      setMarketAnalysis(prev => ({
        ...prev,
        [selectedMarketForScan]: analysis
      }));
      
      const signals = checkAllSignals(digits, analysis);
      setMarketSignals(prev => ({
        ...prev,
        [selectedMarketForScan]: signals
      }));
    }
  }, [digits, selectedMarketForScan]);

  // Ten bots with all strategies
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'O1→O3', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot2', name: 'O2→O3', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 2,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot3', name: 'O1→ODD', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot4', name: 'O1→EVEN', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot5', name: 'EVEN Alt', type: 'alternating', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      alternatingState: 'EVEN',
      signal: false
    },
    { 
      id: 'bot6', name: 'ODD', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot7', name: 'EVEN', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot8', name: 'OVER3', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot9', name: 'UNDER6', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot10', name: 'DIFFERS', type: 'differs', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITDIFF',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // ==================== ENHANCED MARKET SCANNER WITH PROGRESS ====================
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setScanTimer(20);
    
    // Start countdown timer
    if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    timerIntervalRef.current = setInterval(() => {
      setScanTimer(prev => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    try {
      const analysis: Record<string, MarketAnalysis> = {};
      const signals: Record<string, Record<string, boolean>> = {};
      const bestMarkets: Record<string, { market: string; score: number }> = {};
      
      const markets = VOLATILITY_MARKETS;
      const totalMarkets = markets.length;
      
      // Scan each market with progress
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        const marketDigits = marketDigitsRef.current[market] || [];
        
        // Update progress
        setScanProgress(Math.round(((i + 1) / totalMarkets) * 100));
        
        if (marketDigits.length >= 700) {
          const marketAnalysis = analyzeMarket(marketDigits);
          marketAnalysis.symbol = market;
          analysis[market] = marketAnalysis;
          
          signals[market] = checkAllSignals(marketDigits, marketAnalysis);
          
          const signalCount = Object.values(signals[market]).filter(v => v).length;
          if (signalCount > 0) {
            const score = marketAnalysis.marketScore * 10 + signalCount;
            bestMarkets[market] = { market, score };
          }
        }
        
        // Small delay to prevent UI freeze
        await new Promise(r => setTimeout(r, 50));
      }
      
      setMarketAnalysis(analysis);
      setMarketSignals(signals);
      
      // Play sound when scan completes
      if (soundEnabled) playScanSound();
      
      // Auto-select best markets for bots
      if (autoSwitch) {
        setBots(prev => prev.map(bot => {
          let bestMarket = '';
          let bestScore = -1;
          
          for (const [market, marketSignals] of Object.entries(signals)) {
            let signalMatch = false;
            
            switch (bot.id) {
              case 'bot1': signalMatch = marketSignals.over1; break;
              case 'bot2': signalMatch = marketSignals.over2; break;
              case 'bot3': signalMatch = marketSignals.over1Odd; break;
              case 'bot4': signalMatch = marketSignals.over1Even; break;
              case 'bot5': signalMatch = marketSignals.even || marketSignals.odd; break;
              case 'bot6': signalMatch = marketSignals.odd; break;
              case 'bot7': signalMatch = marketSignals.even; break;
              case 'bot8': signalMatch = marketSignals.over3; break;
              case 'bot9': signalMatch = marketSignals.under6; break;
              case 'bot10': signalMatch = marketSignals.differs; break;
            }
            
            if (signalMatch) {
              const marketScore = analysis[market]?.marketScore || 0;
              if (marketScore > bestScore) {
                bestScore = marketScore;
                bestMarket = market;
              }
            }
          }
          
          return {
            ...bot,
            selectedMarket: bestMarket || bot.selectedMarket
          };
        }));
      }
      
      toast.success(`✅ Scanned ${Object.keys(analysis).length} markets`);
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  }, [isScanning, autoSwitch, soundEnabled]);

  // Stop scanning
  const stopScanning = useCallback(() => {
    if (isScanning) {
      setIsScanning(false);
      setScanProgress(0);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
      toast.info('Scanning stopped');
    }
  }, [isScanning]);

  // Auto-scan every 30 seconds (but not if manually scanning)
  useEffect(() => {
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    
    scanIntervalRef.current = setInterval(() => {
      if (!isScanning) {
        scanAllMarkets();
      }
    }, 30000);
    
    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
    };
  }, [scanAllMarkets, isScanning]);

  // Clear all data
  const clearAll = () => {
    setTrades([]);
    setBots(prev => prev.map(bot => ({
      ...bot,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      currentStake: globalStake,
      status: 'idle',
      consecutiveLosses: 0,
      entryTriggered: false,
      cooldownRemaining: 0,
      recoveryMode: false,
      recoveryStage: 0,
      signal: false,
      alternatingState: bot.id === 'bot5' ? 'EVEN' : bot.alternatingState
    })));
    tradeIdRef.current = 0;
    toast.success('🧹 All data cleared');
  };

  // ==================== TRADING LOOP WITH RECOVERY ====================
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    if (!bot.selectedMarket) {
      toast.error(`${bot.name}: No market selected. Scan first.`);
      return;
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: globalStake,
      status: 'waiting'
    } : b));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = globalStake;
    let totalPnl = bot.totalPnl;
    let tradeCount = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let consecutiveLosses = 0;
    let entryTriggered = false;
    let cooldownRemaining = 0;
    let recoveryMode = false;
    let recoveryStage = 0;
    let alternatingState = bot.alternatingState || 'EVEN';

    const currentMarket = bot.selectedMarket;

    while (botRunningRefs.current[botId]) {
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss! $${totalPnl.toFixed(2)}`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit! +$${totalPnl.toFixed(2)}`);
        break;
      }

      if (cooldownRemaining > 0) {
        setBots(prev => prev.map(b => b.id === botId ? { 
          ...b, 
          status: 'cooldown',
          cooldownRemaining 
        } : b));
        await new Promise(r => setTimeout(r, 1000));
        cooldownRemaining--;
        continue;
      }

      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      const analysis = marketAnalysis[currentMarket];
      const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;

      let currentSignal = false;
      let primaryTrade = bot.contractType;
      let primaryBarrier = bot.barrier;
      
      switch (botId) {
        case 'bot1':
          currentSignal = checkOver1Entry(marketDigits);
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITOVER';
            primaryBarrier = 3;
          }
          break;
        case 'bot2':
          currentSignal = checkOver2Entry(marketDigits);
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITOVER';
            primaryBarrier = 3;
          }
          break;
        case 'bot3':
          currentSignal = analysis ? checkOver1OddEntry(marketDigits, analysis) : false;
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITODD';
            primaryBarrier = undefined;
          }
          break;
        case 'bot4':
          currentSignal = analysis ? checkOver1EvenEntry(marketDigits, analysis) : false;
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITEVEN';
            primaryBarrier = undefined;
          }
          break;
        case 'bot5':
          currentSignal = checkAlternatingEntry(marketDigits, alternatingState);
          primaryTrade = alternatingState === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
          primaryBarrier = undefined;
          break;
        case 'bot6':
          currentSignal = checkOddEntry(marketDigits);
          primaryTrade = 'DIGITODD';
          break;
        case 'bot7':
          currentSignal = checkEvenEntry(marketDigits);
          primaryTrade = 'DIGITEVEN';
          break;
        case 'bot8':
          currentSignal = checkOver3Entry(marketDigits);
          primaryTrade = 'DIGITOVER';
          primaryBarrier = 3;
          break;
        case 'bot9':
          currentSignal = checkUnder6Entry(marketDigits);
          primaryTrade = 'DIGITUNDER';
          primaryBarrier = 6;
          break;
        case 'bot10':
          currentSignal = checkDiffersEntry(marketDigits);
          primaryTrade = 'DIGITDIFF';
          primaryBarrier = undefined;
          break;
      }

      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        signal: currentSignal,
        alternatingState: botId === 'bot5' ? alternatingState : b.alternatingState
      } : b));

      let shouldEnter = false;
      if (!entryTriggered && !recoveryMode) {
        shouldEnter = currentSignal;
      }

      if (!entryTriggered && !recoveryMode) {
        setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'waiting' } : b));
        if (!shouldEnter) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        } else {
          entryTriggered = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));
        }
      }

      try {
        await waitForNextTick(currentMarket);

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const params: any = {
          contract_type: primaryTrade,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (primaryBarrier !== undefined) {
          params.barrier = primaryBarrier.toString();
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: primaryTrade + (primaryBarrier ? ` ${primaryBarrier}` : ''),
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit,
          signalType: bot.type,
          marketScore: analysis?.marketScore
        }, ...prev].slice(0, 50));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));

        totalPnl += pnl;
        tradeCount++;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          stake = globalStake;
          entryTriggered = false;
          recoveryMode = false;
          recoveryStage = 0;
          cooldownRemaining = 0;
          
          if (botId === 'bot5') {
            alternatingState = 'EVEN';
          }
        } else {
          losses++;
          consecutiveLosses++;
          
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          
          if (botId === 'bot1' || botId === 'bot2' || botId === 'bot3' || botId === 'bot4') {
            recoveryMode = true;
            recoveryStage = 0;
          }
          
          if (botId === 'bot5') {
            alternatingState = alternatingState === 'EVEN' ? 'ODD' : 'EVEN';
          }
          
          entryTriggered = false;
          cooldownRemaining = 2;
        }

        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: tradeCount,
              wins,
              losses,
              currentStake: stake,
              consecutiveLosses,
              status: cooldownRemaining > 0 ? 'cooldown' : (recoveryMode ? 'recovery' : (entryTriggered ? 'trading' : 'waiting')),
              cooldownRemaining,
              recoveryMode,
              recoveryStage,
              lastTradeResult: won ? 'win' : 'loss',
              signal: currentSignal,
              alternatingState: botId === 'bot5' ? alternatingState : b.alternatingState
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 500));

      } catch (err: any) {
        setActiveTradeId(null);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        } else {
          console.error(`Trade error:`, err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
      signal: false,
      entryTriggered: false,
      recoveryMode: false
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots, marketAnalysis]);

  // Bot controls
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    if (!bot.selectedMarket) {
      toast.error(`${bot.name}: No market selected. Scan first.`);
      return;
    }
    
    setTimeout(() => runBot(botId), 0);
  };

  const pauseBot = (botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b));
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
      signal: false,
      entryTriggered: false,
      recoveryMode: false
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0,
      signal: false,
      entryTriggered: false,
      recoveryMode: false
    })));
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeBots = bots.filter(b => b.isRunning).length;
  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="space-y-3 p-2 bg-background min-h-screen text-[10px] sm:text-xs">
      {/* Header */}
      <div className="bg-card border border-border rounded-lg p-2">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-1">
            <Brain className="w-4 h-4 text-primary" />
            <h1 className="text-sm font-bold">10-Bot System</h1>
          </div>
          <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
            {/* Sound Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="h-6 w-6 p-0"
            >
              {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            </Button>
            
            {/* Auto-switch Toggle */}
            <div className="flex items-center gap-1 px-1 py-0.5 bg-muted/30 rounded text-[8px]">
              <span>Auto</span>
              <input 
                type="checkbox" 
                checked={autoSwitch} 
                onChange={(e) => setAutoSwitch(e.target.checked)}
                className="toggle scale-75"
              />
            </div>
            
            {/* Market Selector */}
            <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
              <SelectTrigger className="h-6 text-[9px] w-20 sm:w-24">
                <SelectValue placeholder="Market" />
              </SelectTrigger>
              <SelectContent className="text-[9px]">
                {VOLATILITY_MARKETS.slice(0, 5).map(market => (
                  <SelectItem key={market} value={market} className="text-[9px]">
                    {getMarketDisplay(market)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            {/* Scan Button with Timer */}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={scanAllMarkets}
              disabled={isScanning}
              className="h-6 text-[9px] px-1"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  {scanTimer}s
                </>
              ) : (
                <>
                  <Scan className="w-3 h-3 mr-1" />
                  Scan
                </>
              )}
            </Button>
            
            {/* Stop Scan Button (appears when scanning) */}
            {isScanning && (
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={stopScanning}
                className="h-6 text-[9px] px-1"
              >
                <XCircle className="w-3 h-3 mr-1" />
                Stop
              </Button>
            )}
            
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={clearAll}
              className="h-6 text-[9px] px-1"
            >
              <Trash2 className="w-3 h-3 mr-1" /> Clear
            </Button>
            
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={stopAllBots} 
              disabled={activeBots === 0}
              className="h-6 text-[9px] px-1"
            >
              <StopCircle className="w-3 h-3 mr-1" /> Stop
            </Button>
          </div>
        </div>

        {/* Progress Bar */}
        {isScanning && (
          <div className="mb-2">
            <div className="flex items-center justify-between text-[8px] text-muted-foreground mb-1">
              <span>Scanning markets...</span>
              <span>{scanProgress}%</span>
            </div>
            <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
              <div 
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Global Stats - Compact */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 text-[8px]">
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Bal</div>
            <div className="font-bold">${balance?.toFixed(0) || '0'}</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">P&L</div>
            <div className={`font-bold ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
              ${totalProfit.toFixed(0)}
            </div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Win%</div>
            <div className="font-bold">{winRate}%</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Trades</div>
            <div className="font-bold">{totalTrades}</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Active</div>
            <div className="font-bold">{activeBots}/10</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Sig</div>
            <div className="font-bold text-yellow-400">{activeSignals}</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Mkts</div>
            <div className="font-bold">{Object.keys(marketAnalysis).length}</div>
          </div>
          <div className="bg-muted/30 rounded p-1">
            <div className="text-muted-foreground">Best</div>
            <div className="font-bold text-primary">
              {Math.max(...Object.values(marketAnalysis).map(a => a.marketScore || 0), 0)}
            </div>
          </div>
        </div>

        {/* Settings - Compact */}
        <div className="grid grid-cols-4 gap-1 mt-2">
          <div>
            <label className="text-[7px] text-muted-foreground">Stake</label>
            <input 
              type="number" 
              value={globalStake} 
              onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 1)}
              className="w-full bg-background border border-border rounded px-1 py-0.5 text-[8px]"
              step="0.1"
              min="0.1"
            />
          </div>
          <div>
            <label className="text-[7px] text-muted-foreground">Multi</label>
            <input 
              type="number" 
              value={globalMultiplier} 
              onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
              className="w-full bg-background border border-border rounded px-1 py-0.5 text-[8px]"
              step="0.1"
              min="1.1"
            />
          </div>
          <div>
            <label className="text-[7px] text-muted-foreground">SL</label>
            <input 
              type="number" 
              value={globalStopLoss} 
              onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 50)}
              className="w-full bg-background border border-border rounded px-1 py-0.5 text-[8px]"
            />
          </div>
          <div>
            <label className="text-[7px] text-muted-foreground">TP</label>
            <input 
              type="number" 
              value={globalTakeProfit} 
              onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 25)}
              className="w-full bg-background border border-border rounded px-1 py-0.5 text-[8px]"
            />
          </div>
        </div>
      </div>

      {/* Bots Grid - 2 per row on small screens, 5 per row on large */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-1">
        {bots.map((bot) => {
          const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
          const marketSignal = bot.selectedMarket && marketSignals[bot.selectedMarket] 
            ? marketSignals[bot.selectedMarket][
                bot.id === 'bot1' ? 'over1' :
                bot.id === 'bot2' ? 'over2' :
                bot.id === 'bot3' ? 'over1Odd' :
                bot.id === 'bot4' ? 'over1Even' :
                bot.id === 'bot5' ? 'even' :
                bot.id === 'bot6' ? 'odd' :
                bot.id === 'bot7' ? 'even' :
                bot.id === 'bot8' ? 'over3' :
                bot.id === 'bot9' ? 'under6' : 'differs'
              ] 
            : false;
          
          return (
            <motion.div
              key={bot.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`bg-card border rounded-lg p-1.5 ${
                bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
              } ${bot.signal ? 'ring-1 ring-yellow-500/50' : ''} ${
                bot.recoveryMode ? 'ring-1 ring-orange-500/50' : ''
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <div className={`p-0.5 rounded ${
                    bot.id.includes('over') ? 'bg-blue-500/20 text-blue-400' :
                    bot.id.includes('under') ? 'bg-orange-500/20 text-orange-400' :
                    bot.id === 'bot6' ? 'bg-purple-500/20 text-purple-400' :
                    bot.id === 'bot7' ? 'bg-green-500/20 text-green-400' :
                    bot.id === 'bot10' ? 'bg-cyan-500/20 text-cyan-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {bot.id.includes('over') ? <TrendingUp className="w-3 h-3" /> :
                     bot.id.includes('under') ? <TrendingDown className="w-3 h-3" /> :
                     bot.id === 'bot10' ? <Hash className="w-3 h-3" /> :
                     <CircleDot className="w-3 h-3" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-[9px] leading-tight">{bot.name}</h4>
                  </div>
                </div>
                <div className="flex items-center gap-0.5">
                  {bot.recoveryMode && (
                    <Badge variant="default" className="bg-orange-500 text-[6px] px-0.5 py-0 h-3 min-w-3">
                      R
                    </Badge>
                  )}
                  {bot.signal && (
                    <Badge variant="default" className="bg-yellow-500 text-[6px] px-0.5 py-0 h-3 min-w-3">
                      S
                    </Badge>
                  )}
                </div>
              </div>

              {/* Market & Analysis - Compact */}
              <div className="bg-muted/30 rounded p-1 mb-1 text-[7px]">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Mkt:</span>
                  <span className="font-mono font-bold">
                    {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                  </span>
                </div>
                {marketData && (
                  <>
                    <div className="flex justify-between mt-0.5">
                      <span>M:{marketData.mostAppearing}</span>
                      <span>2:{marketData.secondMost}</span>
                      <span>L:{marketData.leastAppearing}</span>
                    </div>
                    <div className="flex justify-between mt-0.5 text-[6px]">
                      <span>E:{marketData.evenPercent.toFixed(0)}%</span>
                      <span>O:{marketData.oddPercent.toFixed(0)}%</span>
                      <span>Sc:{marketData.marketScore}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Stats - Compact */}
              <div className="grid grid-cols-3 gap-0.5 text-[7px] mb-1">
                <div>
                  <span className="text-muted-foreground">P:</span>
                  <span className={`ml-0.5 font-mono ${
                    bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                  }`}>
                    ${bot.totalPnl.toFixed(0)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">W:</span>
                  <span className="ml-0.5 font-mono text-profit">{bot.wins}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">L:</span>
                  <span className="ml-0.5 font-mono text-loss">{bot.losses}</span>
                </div>
              </div>

              {/* Status & Stake */}
              <div className="flex items-center justify-between text-[6px] mb-1">
                <span className={`font-mono ${
                  bot.status === 'trading' ? 'text-green-400' :
                  bot.status === 'recovery' ? 'text-orange-400' :
                  bot.status === 'waiting' ? 'text-yellow-400' :
                  bot.status === 'cooldown' ? 'text-purple-400' :
                  'text-gray-400'
                }`}>
                  {bot.status === 'trading' ? '📈' :
                   bot.status === 'recovery' ? '🔄' :
                   bot.status === 'waiting' ? '⏳' :
                   bot.status === 'cooldown' ? `⏱️${bot.cooldownRemaining}` :
                   '⚫'}
                </span>
                <span className="font-mono">${bot.currentStake.toFixed(1)}</span>
              </div>

              {/* Controls */}
              <div className="flex gap-0.5">
                {!bot.isRunning ? (
                  <Button
                    onClick={() => startBot(bot.id)}
                    disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                    size="sm"
                    className="flex-1 h-5 text-[8px] px-0"
                  >
                    <Play className="w-2 h-2 mr-0.5" /> S
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => pauseBot(bot.id)}
                      size="sm"
                      variant="outline"
                      className="flex-1 h-5 text-[8px] px-0"
                    >
                      <Pause className="w-2 h-2 mr-0.5" /> {bot.isPaused ? 'R' : 'P'}
                    </Button>
                    <Button
                      onClick={() => stopBot(bot.id)}
                      size="sm"
                      variant="destructive"
                      className="flex-1 h-5 text-[8px] px-0"
                    >
                      <StopCircle className="w-2 h-2 mr-0.5" /> X
                    </Button>
                  </>
                )}
              </div>

              {/* Alternating State for Bot 5 */}
              {bot.id === 'bot5' && bot.alternatingState && (
                <div className="mt-0.5 text-[6px] text-center">
                  <span className={bot.alternatingState === 'EVEN' ? 'text-green-400' : 'text-purple-400'}>
                    {bot.alternatingState}
                  </span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Live Signals Panel - Collapsible */}
      <div className="bg-card border border-border rounded-lg p-2">
        <h3 className="text-[9px] font-semibold mb-1 flex items-center gap-1">
          <Activity className="w-3 h-3" />
          Signals
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 max-h-[120px] overflow-y-auto">
          {Object.entries(marketSignals).map(([market, signals]) => {
            const hasAnySignal = Object.values(signals).some(v => v);
            if (!hasAnySignal) return null;
            
            return (
              <div key={market} className="bg-muted/30 rounded p-1 text-[6px]">
                <div className="font-bold mb-0.5 flex items-center justify-between">
                  <span>{getMarketDisplay(market)}</span>
                  <Badge variant="outline" className="text-[5px] px-0.5 py-0">
                    {marketAnalysis[market]?.marketScore || 0}
                  </Badge>
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {signals.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[5px] px-0.5">O1</Badge>}
                  {signals.over2 && <Badge className="bg-blue-500/20 text-blue-400 text-[5px] px-0.5">O2</Badge>}
                  {signals.over3 && <Badge className="bg-blue-500/20 text-blue-400 text-[5px] px-0.5">O3</Badge>}
                  {signals.under6 && <Badge className="bg-orange-500/20 text-orange-400 text-[5px] px-0.5">U6</Badge>}
                  {signals.even && <Badge className="bg-green-500/20 text-green-400 text-[5px] px-0.5">EV</Badge>}
                  {signals.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[5px] px-0.5">OD</Badge>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Trade Log - Compact */}
      <div className="bg-card border border-border rounded-lg p-2">
        <h3 className="text-[9px] font-semibold mb-1 flex items-center gap-1">
          <Target className="w-3 h-3" />
          Trades ({trades.length})
        </h3>
        <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
          {trades.length === 0 ? (
            <p className="text-[8px] text-muted-foreground text-center py-2">No trades</p>
          ) : (
            trades.slice(0, 10).map((trade, idx) => (
              <div key={idx} className="flex items-center justify-between text-[7px] py-0.5 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">{trade.time.slice(-5)}</span>
                  <Badge variant="outline" className="text-[5px] px-0.5 py-0">{trade.bot}</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono">${trade.stake.toFixed(1)}</span>
                  <span className={`font-mono w-12 text-right ${
                    trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                  }`}>
                    {trade.result === 'Win' ? `+$${trade.pnl.toFixed(1)}` : 
                     trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(1)}` : 
                     '⏳'}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
