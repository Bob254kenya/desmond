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
  AlertCircle, CheckCircle2, Clock, Hash, Zap, Shield, Gauge
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

// Market display helper
const getMarketDisplay = (market: string) => {
  if (market.startsWith('1HZ')) return `⚡ ${market}`;
  if (market.startsWith('R_')) return `📈 ${market}`;
  if (market.startsWith('BOOM')) return `💥 ${market}`;
  if (market.startsWith('CRASH')) return `📉 ${market}`;
  if (market.startsWith('JD')) return `🦘 ${market}`;
  if (market === 'RDBEAR') return `🐻 Bear`;
  if (market === 'RDBULL') return `🐂 Bull`;
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
  // Check if all digits are different (no repeats)
  const uniqueDigits = new Set(lastTen);
  return uniqueDigits.size >= 8; // At least 8 unique digits in last 10
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
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // Update market digits for all markets
  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarketForScan] = digits;
      
      // Analyze this market
      const analysis = analyzeMarket(digits);
      analysis.symbol = selectedMarketForScan;
      
      setMarketAnalysis(prev => ({
        ...prev,
        [selectedMarketForScan]: analysis
      }));
      
      // Check signals for this market
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
      id: 'bot1', name: 'OVER 1 → OVER 3', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot2', name: 'OVER 2 → OVER 3', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 2,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot3', name: 'OVER 1 → ODD', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot4', name: 'OVER 1 → EVEN', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot5', name: 'EVEN Alternating', type: 'alternating', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      alternatingState: 'EVEN',
      signal: false
    },
    { 
      id: 'bot6', name: 'ODD Bot', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot7', name: 'EVEN Bot', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot8', name: 'OVER 3 Bot', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot9', name: 'UNDER 6 Bot', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
    { 
      id: 'bot10', name: 'DIFFERS Bot', type: 'differs', isRunning: false, isPaused: false, 
      currentStake: 1.00, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      contractType: 'DIGITDIFF',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, recoveryStage: 0,
      signal: false
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // ==================== ENHANCED MARKET SCANNER ====================
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    
    try {
      const analysis: Record<string, MarketAnalysis> = {};
      const signals: Record<string, Record<string, boolean>> = {};
      const bestMarkets: Record<string, { market: string; score: number }> = {};
      
      // Scan each market
      for (const market of VOLATILITY_MARKETS) {
        const marketDigits = marketDigitsRef.current[market] || [];
        if (marketDigits.length >= 700) {
          const marketAnalysis = analyzeMarket(marketDigits);
          marketAnalysis.symbol = market;
          analysis[market] = marketAnalysis;
          
          // Check all signals for this market
          signals[market] = checkAllSignals(marketDigits, marketAnalysis);
          
          // Track best market for each bot type based on signal frequency
          const signalCount = Object.values(signals[market]).filter(v => v).length;
          if (signalCount > 0) {
            const score = marketAnalysis.marketScore * 10 + signalCount;
            bestMarkets[market] = { market, score };
          }
        }
      }
      
      setMarketAnalysis(analysis);
      setMarketSignals(signals);
      
      // Auto-select best markets for bots based on their strategy
      if (autoSwitch) {
        setBots(prev => prev.map(bot => {
          // Find best market for this bot type
          let bestMarket = '';
          let bestScore = -1;
          
          for (const [market, marketSignals] of Object.entries(signals)) {
            let signalMatch = false;
            
            switch (bot.id) {
              case 'bot1':
                signalMatch = marketSignals.over1;
                break;
              case 'bot2':
                signalMatch = marketSignals.over2;
                break;
              case 'bot3':
                signalMatch = marketSignals.over1Odd;
                break;
              case 'bot4':
                signalMatch = marketSignals.over1Even;
                break;
              case 'bot5':
                signalMatch = marketSignals.even || marketSignals.odd;
                break;
              case 'bot6':
                signalMatch = marketSignals.odd;
                break;
              case 'bot7':
                signalMatch = marketSignals.even;
                break;
              case 'bot8':
                signalMatch = marketSignals.over3;
                break;
              case 'bot9':
                signalMatch = marketSignals.under6;
                break;
              case 'bot10':
                signalMatch = marketSignals.differs;
                break;
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
      
      toast.success(`✅ Scanned ${Object.keys(analysis).length} markets - Best markets selected`);
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [isScanning, autoSwitch]);

  // Auto-scan every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      scanAllMarkets();
    }, 30000);
    
    return () => clearInterval(interval);
  }, [scanAllMarkets]);

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

      // Check stop loss / take profit
      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss! $${totalPnl.toFixed(2)}`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit! +$${totalPnl.toFixed(2)}`);
        break;
      }

      // Handle cooldown
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

      // Get current market digits and analysis
      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      const analysis = marketAnalysis[currentMarket];
      const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;

      // Check signal for this bot
      let currentSignal = false;
      let primaryTrade = bot.contractType;
      let primaryBarrier = bot.barrier;
      
      switch (botId) {
        case 'bot1': // OVER 1 → OVER 3
          currentSignal = checkOver1Entry(marketDigits);
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITOVER';
            primaryBarrier = 3;
          }
          break;
        case 'bot2': // OVER 2 → OVER 3
          currentSignal = checkOver2Entry(marketDigits);
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITOVER';
            primaryBarrier = 3;
          }
          break;
        case 'bot3': // OVER 1 → ODD
          currentSignal = analysis ? checkOver1OddEntry(marketDigits, analysis) : false;
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITODD';
            primaryBarrier = undefined;
          }
          break;
        case 'bot4': // OVER 1 → EVEN
          currentSignal = analysis ? checkOver1EvenEntry(marketDigits, analysis) : false;
          if (recoveryMode && recoveryStage === 0) {
            primaryTrade = 'DIGITEVEN';
            primaryBarrier = undefined;
          }
          break;
        case 'bot5': // EVEN Alternating
          currentSignal = checkAlternatingEntry(marketDigits, alternatingState);
          primaryTrade = alternatingState === 'EVEN' ? 'DIGITEVEN' : 'DIGITODD';
          primaryBarrier = undefined;
          break;
        case 'bot6': // ODD Bot
          currentSignal = checkOddEntry(marketDigits);
          primaryTrade = 'DIGITODD';
          break;
        case 'bot7': // EVEN Bot
          currentSignal = checkEvenEntry(marketDigits);
          primaryTrade = 'DIGITEVEN';
          break;
        case 'bot8': // OVER 3 Bot
          currentSignal = checkOver3Entry(marketDigits);
          primaryTrade = 'DIGITOVER';
          primaryBarrier = 3;
          break;
        case 'bot9': // UNDER 6 Bot
          currentSignal = checkUnder6Entry(marketDigits);
          primaryTrade = 'DIGITUNDER';
          primaryBarrier = 6;
          break;
        case 'bot10': // DIFFERS Bot
          currentSignal = checkDiffersEntry(marketDigits);
          primaryTrade = 'DIGITDIFF';
          primaryBarrier = undefined;
          break;
      }

      // Update bot signal status
      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        signal: currentSignal,
        alternatingState: botId === 'bot5' ? alternatingState : b.alternatingState
      } : b));

      // Entry condition check
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
        }, ...prev].slice(0, 100));

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
          
          // Reset alternating state on win
          if (botId === 'bot5') {
            alternatingState = 'EVEN';
          }
        } else {
          losses++;
          consecutiveLosses++;
          
          // Martingale
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          
          // Enter recovery mode after loss
          if (botId === 'bot1' || botId === 'bot2' || botId === 'bot3' || botId === 'bot4') {
            recoveryMode = true;
            recoveryStage = 0;
          }
          
          // Handle alternating strategy on loss
          if (botId === 'bot5') {
            alternatingState = alternatingState === 'EVEN' ? 'ODD' : 'EVEN';
          }
          
          entryTriggered = false;
          cooldownRemaining = 2; // Short cooldown after loss
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
    <div className="space-y-4 p-4 bg-background min-h-screen">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Brain className="w-6 h-6 text-primary" />
            <h1 className="text-xl font-bold">10-Bot Intelligent Trading System</h1>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 px-2 py-1 bg-muted/30 rounded-lg">
              <span className="text-xs text-muted-foreground">Auto-switch</span>
              <input 
                type="checkbox" 
                checked={autoSwitch} 
                onChange={(e) => setAutoSwitch(e.target.checked)}
                className="toggle"
              />
            </div>
            <Select value={selectedMarketForScan} onValueChange={setSelectedMarketForScan}>
              <SelectTrigger className="w-[180px] h-8">
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent>
                {VOLATILITY_MARKETS.map(market => (
                  <SelectItem key={market} value={market}>
                    {getMarketDisplay(market)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={scanAllMarkets}
              disabled={isScanning}
            >
              {isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Scan className="w-4 h-4 mr-1" />}
              Scan All Markets
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={clearAll}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Clear
            </Button>
            <Button variant="destructive" size="sm" onClick={stopAllBots} disabled={activeBots === 0}>
              <StopCircle className="w-4 h-4 mr-1" /> Stop All
            </Button>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-8 gap-3 text-sm">
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Balance</div>
            <div className="font-bold text-lg">${balance?.toFixed(2) || '0.00'}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Total P&L</div>
            <div className={`font-bold text-lg ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
              ${totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Win Rate</div>
            <div className="font-bold text-lg">{winRate}%</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Trades</div>
            <div className="font-bold text-lg">{totalTrades}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Active</div>
            <div className="font-bold text-lg">{activeBots}/10</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Signals</div>
            <div className="font-bold text-lg text-yellow-400">{activeSignals}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Markets</div>
            <div className="font-bold text-lg">{Object.keys(marketAnalysis).length}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Best Score</div>
            <div className="font-bold text-lg text-primary">
              {Math.max(...Object.values(marketAnalysis).map(a => a.marketScore || 0), 0)}
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-4 gap-3 mt-3">
          <div>
            <label className="text-xs text-muted-foreground">Stake ($)</label>
            <input 
              type="number" 
              value={globalStake} 
              onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 1)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              step="0.1"
              min="0.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Multiplier</label>
            <input 
              type="number" 
              value={globalMultiplier} 
              onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              step="0.1"
              min="1.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Stop Loss ($)</label>
            <input 
              type="number" 
              value={globalStopLoss} 
              onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 50)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Take Profit ($)</label>
            <input 
              type="number" 
              value={globalTakeProfit} 
              onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 25)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Bots Grid - 5x2 for 10 bots */}
      <div className="grid grid-cols-5 gap-3">
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
              className={`bg-card border rounded-xl p-3 ${
                bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
              } ${bot.signal ? 'ring-2 ring-yellow-500/50' : ''} ${
                bot.recoveryMode ? 'ring-2 ring-orange-500/50' : ''
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${
                    bot.id.includes('over') ? 'bg-blue-500/20 text-blue-400' :
                    bot.id.includes('under') ? 'bg-orange-500/20 text-orange-400' :
                    bot.id === 'bot6' ? 'bg-purple-500/20 text-purple-400' :
                    bot.id === 'bot7' ? 'bg-green-500/20 text-green-400' :
                    bot.id === 'bot10' ? 'bg-cyan-500/20 text-cyan-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {bot.id.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                     bot.id.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                     bot.id === 'bot10' ? <Hash className="w-4 h-4" /> :
                     <CircleDot className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs">{bot.name}</h4>
                    <p className="text-[8px] text-muted-foreground">
                      {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {bot.recoveryMode && (
                    <Badge variant="default" className="bg-orange-500 text-[7px] px-1 py-0 h-3">
                      R{bot.recoveryStage + 1}
                    </Badge>
                  )}
                  {bot.signal && (
                    <Badge variant="default" className="bg-yellow-500 text-[7px] px-1 py-0 h-3">
                      SIG
                    </Badge>
                  )}
                </div>
              </div>

              {/* Market & Analysis */}
              <div className="bg-muted/30 rounded-lg p-1.5 mb-2 text-[9px]">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Market:</span>
                  <span className="font-mono font-bold">
                    {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                  </span>
                </div>
                {marketData && (
                  <>
                    <div className="flex justify-between mt-1 text-[8px]">
                      <span>M: {marketData.mostAppearing}</span>
                      <span>2nd: {marketData.secondMost}</span>
                      <span>L: {marketData.leastAppearing}</span>
                    </div>
                    <div className="flex justify-between mt-1 text-[7px]">
                      <span>E:{marketData.evenPercent.toFixed(0)}%</span>
                      <span>O:{marketData.oddPercent.toFixed(0)}%</span>
                      <span>U:{marketData.underPercent.toFixed(0)}%</span>
                      <span>Ov:{marketData.overPercent.toFixed(0)}%</span>
                      <span className={marketSignal ? 'text-yellow-400' : ''}>S:{marketSignal ? '✓' : '✗'}</span>
                    </div>
                    <div className="text-[7px] text-right text-primary">
                      Score: {marketData.marketScore}/10
                    </div>
                  </>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-1 text-[9px] mb-2">
                <div>
                  <span className="text-muted-foreground">P&L:</span>
                  <span className={`ml-1 font-mono ${
                    bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                  }`}>
                    ${bot.totalPnl.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">W:</span>
                  <span className="ml-1 font-mono text-profit">{bot.wins}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">L:</span>
                  <span className="ml-1 font-mono text-loss">{bot.losses}</span>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between text-[8px] mb-2">
                <span className="text-muted-foreground">Status:</span>
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
                <span className="text-muted-foreground">Stake:</span>
                <span className="font-mono">${bot.currentStake.toFixed(2)}</span>
              </div>

              {/* Controls */}
              <div className="flex gap-1">
                {!bot.isRunning ? (
                  <Button
                    onClick={() => startBot(bot.id)}
                    disabled={!isAuthorized || balance < globalStake || activeTradeId !== null || !bot.selectedMarket}
                    size="sm"
                    className="flex-1 h-6 text-xs"
                  >
                    <Play className="w-3 h-3 mr-1" /> Start
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => pauseBot(bot.id)}
                      size="sm"
                      variant="outline"
                      className="flex-1 h-6 text-xs"
                    >
                      <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button
                      onClick={() => stopBot(bot.id)}
                      size="sm"
                      variant="destructive"
                      className="flex-1 h-6 text-xs"
                    >
                      <StopCircle className="w-3 h-3 mr-1" /> Stop
                    </Button>
                  </>
                )}
              </div>

              {/* Alternating State for Bot 5 */}
              {bot.id === 'bot5' && bot.alternatingState && (
                <div className="mt-1 text-[7px] text-center">
                  Next: <span className={bot.alternatingState === 'EVEN' ? 'text-green-400' : 'text-purple-400'}>
                    {bot.alternatingState}
                  </span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Live Signals Panel */}
      <div className="bg-card border border-border rounded-xl p-3">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Activity className="w-4 h-4" />
          📡 Live Signals - All Markets
        </h3>
        <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto">
          {Object.entries(marketSignals).map(([market, signals]) => {
            const hasAnySignal = Object.values(signals).some(v => v);
            if (!hasAnySignal) return null;
            
            return (
              <div key={market} className="bg-muted/30 rounded-lg p-2 text-[9px]">
                <div className="font-bold mb-1 flex items-center justify-between">
                  <span>{getMarketDisplay(market)}</span>
                  <Badge variant="outline" className="text-[7px] px-1">
                    Score: {marketAnalysis[market]?.marketScore || 0}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  {signals.over1 && <Badge className="bg-blue-500/20 text-blue-400 text-[7px]">OVER 1</Badge>}
                  {signals.over2 && <Badge className="bg-blue-500/20 text-blue-400 text-[7px]">OVER 2</Badge>}
                  {signals.over3 && <Badge className="bg-blue-500/20 text-blue-400 text-[7px]">OVER 3</Badge>}
                  {signals.under6 && <Badge className="bg-orange-500/20 text-orange-400 text-[7px]">UNDER 6</Badge>}
                  {signals.even && <Badge className="bg-green-500/20 text-green-400 text-[7px]">EVEN</Badge>}
                  {signals.odd && <Badge className="bg-purple-500/20 text-purple-400 text-[7px]">ODD</Badge>}
                  {signals.over1Odd && <Badge className="bg-amber-500/20 text-amber-400 text-[7px]">O1→ODD</Badge>}
                  {signals.over1Even && <Badge className="bg-emerald-500/20 text-emerald-400 text-[7px]">O1→EVEN</Badge>}
                  {signals.differs && <Badge className="bg-cyan-500/20 text-cyan-400 text-[7px]">DIFFERS</Badge>}
                </div>
              </div>
            );
          })}
          {Object.keys(marketSignals).length === 0 && (
            <p className="text-xs text-muted-foreground col-span-4 text-center py-2">
              No active signals. Click "Scan All Markets" to start.
            </p>
          )}
        </div>
      </div>

      {/* Trade Log */}
      <div className="bg-card border border-border rounded-xl p-3">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Target className="w-4 h-4" />
          📋 Live Trade Log
        </h3>
        <div className="space-y-1 max-h-[300px] overflow-y-auto">
          {trades.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No trades yet</p>
          ) : (
            trades.map((trade, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground">{trade.time}</span>
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{trade.bot}</Badge>
                  <span className="font-mono text-[10px]">
                    {getMarketDisplay(trade.market)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {trade.contract}
                  </span>
                  <span className="font-mono">${trade.stake.toFixed(2)}</span>
                  <span className={`font-mono w-20 text-right ${
                    trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                  }`}>
                    {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                     trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
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
