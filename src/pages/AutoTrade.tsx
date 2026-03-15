import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Sparkles, Volume2, AlertCircle } from 'lucide-react';

interface MarketAnalysis {
  symbol: string;
  mostAppearing: number;
  secondMost: number;
  leastAppearing: number;
  mostType: 'odd' | 'even';
  secondType: 'odd' | 'even';
  leastType: 'odd' | 'even';
  lastDigit: number;
  previousDigit: number;
  thirdLastDigit: number;
  fourthLastDigit: number;
  recommendedBots: string[];
}

interface BotState {
  id: string;
  name: string;
  type: 'over3' | 'under6' | 'even' | 'odd' | 'over1' | 'under8';
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
  marketCondition: boolean;
  status: 'idle' | 'waiting' | 'trading' | 'cooldown';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
  entrySignal: boolean;
  marketDigits: number[];
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
  entryDigits?: string;
}

// Supported markets (removed Boom/Crash)
const SUPPORTED_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Bear & Bull
  'RDBEAR', 'RDBULL'
];

// Voice alert system
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private synth: SpeechSynthesis | null = null;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis;
    }
  }

  static getInstance(): VoiceAlertSystem {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  speak(text: string) {
    if (!this.synth) return;
    this.synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.7;
    utterance.pitch = 0.4;
    utterance.volume = 1;
    this.synth.speak(utterance);
  }

  scanningAlert() {
    this.speak("Scanning the markets for money… stay ready.");
  }

  signalFound() {
    this.speak("Signal found. Prepare to trade.");
  }
}

// Helper: Wait for next tick
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

// Get digit from price
const getDigit = (price: number): number => Math.floor(price) % 10;

// Market analysis function
const analyzeMarketDigits = (digits: number[]): MarketAnalysis => {
  if (digits.length < 1000) return {} as MarketAnalysis;
  
  const last1000 = digits.slice(-1000);
  
  // Count digit frequencies
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last1000.forEach(d => counts[d]++);
  
  // Sort digits by frequency
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  
  const mostAppearing = sortedDigits[0];
  const secondMost = sortedDigits[1];
  const leastAppearing = sortedDigits[9];
  
  // Get last few digits
  const lastDigit = digits.length > 0 ? digits[digits.length - 1] : 0;
  const previousDigit = digits.length > 1 ? digits[digits.length - 2] : 0;
  const thirdLastDigit = digits.length > 2 ? digits[digits.length - 3] : 0;
  const fourthLastDigit = digits.length > 3 ? digits[digits.length - 4] : 0;
  
  // Determine which bots this market qualifies for
  const recommendedBots: string[] = [];
  
  // OVER conditions (most, second, least all > 4)
  if (mostAppearing > 4 && secondMost > 4 && leastAppearing > 4) {
    recommendedBots.push('over3', 'over1');
  }
  
  // UNDER conditions (most, second, least all < 5 for under6, < 6 for under8)
  if (mostAppearing < 5 && secondMost < 5 && leastAppearing < 5) {
    recommendedBots.push('under6');
  }
  if (mostAppearing < 6 && secondMost < 6 && leastAppearing < 6) {
    recommendedBots.push('under8');
  }
  
  // EVEN condition (most, second, least all even)
  if (mostAppearing % 2 === 0 && secondMost % 2 === 0 && leastAppearing % 2 === 0) {
    recommendedBots.push('even');
  }
  
  // ODD condition (most, second, least all odd)
  if (mostAppearing % 2 === 1 && secondMost % 2 === 1 && leastAppearing % 2 === 1) {
    recommendedBots.push('odd');
  }
  
  return {
    symbol: '',
    mostAppearing,
    secondMost,
    leastAppearing,
    mostType: mostAppearing % 2 === 0 ? 'even' : 'odd',
    secondType: secondMost % 2 === 0 ? 'even' : 'odd',
    leastType: leastAppearing % 2 === 0 ? 'even' : 'odd',
    lastDigit,
    previousDigit,
    thirdLastDigit,
    fourthLastDigit,
    recommendedBots: [...new Set(recommendedBots)] // Remove duplicates
  };
};

// Entry condition checks
const checkEntryCondition = {
  over3: (digits: number[]): boolean => {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(d => d <= 2); // Below 3 (0,1,2)
  },
  
  under6: (digits: number[]): boolean => {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(d => d >= 7); // Above 6 (7,8,9)
  },
  
  even: (digits: number[]): boolean => {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(d => d % 2 === 1); // All odd -> entry for even bot
  },
  
  odd: (digits: number[]): boolean => {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(d => d % 2 === 0); // All even -> entry for odd bot
  },
  
  over1: (digits: number[]): boolean => {
    if (digits.length < 2) return false;
    const lastTwo = digits.slice(-2);
    return lastTwo.every(d => d <= 1); // Below 2 (0,1)
  },
  
  under8: (digits: number[]): boolean => {
    if (digits.length < 2) return false;
    const lastTwo = digits.slice(-2);
    return lastTwo.every(d => d >= 8); // Above 7 (8,9)
  }
};

const getMarketDisplay = (market: string): string => {
  if (market.startsWith('1HZ')) return `⚡ ${market}`;
  if (market.startsWith('R_')) return `📈 ${market}`;
  if (market.startsWith('JD')) return `🦘 ${market}`;
  if (market === 'RDBEAR') return `🐻 Bear`;
  if (market === 'RDBULL') return `🐂 Bull`;
  return market;
};

export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const voiceSystem = VoiceAlertSystem.getInstance();
  
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentScanningMarket, setCurrentScanningMarket] = useState('');
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [noSignals, setNoSignals] = useState(false);
  const [signalsFound, setSignalsFound] = useState<string[]>([]);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();
  const scanIntervalRef = useRef<NodeJS.Timeout>();

  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      marketCondition: false, status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, entrySignal: false, marketDigits: []
    },
    { 
      id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      marketCondition: false, status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, entrySignal: false, marketDigits: []
    },
    { 
      id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      marketCondition: false, status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, entrySignal: false, marketDigits: []
    },
    { 
      id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      marketCondition: false, status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, entrySignal: false, marketDigits: []
    },
    { 
      id: 'bot5', name: 'OVER 1 BOT', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      marketCondition: false, status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, entrySignal: false, marketDigits: []
    },
    { 
      id: 'bot6', name: 'UNDER 8 BOT', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      marketCondition: false, status: 'idle', consecutiveLosses: 0, entryTriggered: false, 
      cooldownRemaining: 0, recoveryMode: false, entrySignal: false, marketDigits: []
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Load ticks for a specific market
  const loadMarketTicks = useCallback(async (market: string): Promise<number[]> => {
    return new Promise((resolve) => {
      const ticks: number[] = [];
      let count = 0;
      
      const unsubscribe = derivApi.onMessage((data: any) => {
        if (data.tick && data.tick.symbol === market) {
          const digit = getDigit(data.tick.quote);
          ticks.push(digit);
          count++;
          
          setCurrentScanningMarket(`${market} (${count}/1000)`);
          setScanProgress((count / 1000) * 100);
          
          if (count >= 1000) {
            unsubscribe();
            marketDigitsRef.current[market] = ticks.slice(-1000);
            resolve(ticks.slice(-1000));
          }
        }
      });
      
      derivApi.subscribeTicks(market);
    });
  }, []);

  // Scan all markets (max 30 seconds)
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignals(false);
    setSignalsFound([]);
    setScanProgress(0);
    setMarketAnalysis({});
    voiceSystem.scanningAlert();
    
    // Set timeout for max 30 seconds
    const scanStartTime = Date.now();
    const MAX_SCAN_TIME = 30000; // 30 seconds
    
    // Voice alert every 20 seconds
    scanIntervalRef.current = setInterval(() => {
      voiceSystem.scanningAlert();
    }, 20000);
    
    try {
      const analysis: Record<string, MarketAnalysis> = {};
      const marketSignals: Record<string, string[]> = {};
      
      // Scan each market
      for (let i = 0; i < SUPPORTED_MARKETS.length; i++) {
        // Check if we've exceeded 30 seconds
        if (Date.now() - scanStartTime > MAX_SCAN_TIME) {
          toast.warning('Scan time limit reached (30s)');
          break;
        }
        
        const market = SUPPORTED_MARKETS[i];
        
        // Load 1000 ticks
        const digits = await loadMarketTicks(market);
        
        // Analyze market
        analysis[market] = analyzeMarketDigits(digits);
        analysis[market].symbol = market;
        
        // Store signals
        if (analysis[market].recommendedBots.length > 0) {
          marketSignals[market] = analysis[market].recommendedBots;
        }
        
        // Update progress
        setScanProgress(((i + 1) / SUPPORTED_MARKETS.length) * 100);
      }
      
      setMarketAnalysis(analysis);
      
      // Collect all signals
      const allSignals: string[] = [];
      Object.entries(marketSignals).forEach(([market, bots]) => {
        bots.forEach(bot => {
          allSignals.push(`${market} - ${bot.toUpperCase()}`);
        });
      });
      
      setSignalsFound(allSignals);
      setNoSignals(allSignals.length === 0);
      
      if (allSignals.length > 0) {
        voiceSystem.signalFound();
        toast.success(`Found ${allSignals.length} trading signals!`);
      } else {
        toast.info('No signals found in any market');
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setCurrentScanningMarket('');
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    }
  }, [isScanning, voiceSystem, loadMarketTicks]);

  // Load bot with selected market
  const loadBot = (botId: string, market: string) => {
    const analysis = marketAnalysis[market];
    if (!analysis) return;
    
    setBots(prev => prev.map(bot => {
      if (bot.id === botId) {
        return {
          ...bot,
          selectedMarket: market,
          marketCondition: true,
          marketDigits: marketDigitsRef.current[market] || []
        };
      }
      return bot;
    }));
    
    toast.success(`${bots.find(b => b.id === botId)?.name} loaded with ${getMarketDisplay(market)}`);
  };

  // Auto-start bot after loading
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning || !bot.selectedMarket) return;
    
    // Start the bot automatically
    setTimeout(() => runBot(botId), 500);
  };

  // Run bot trading logic
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      return;
    }

    if (!bot.selectedMarket) {
      toast.error(`${bot.name}: No market selected`);
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
    let recoveryMode = false;

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

      // Get latest market digits
      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      const lastThree = marketDigits.slice(-3);
      const lastTwo = marketDigits.slice(-2);
      
      // Check entry signal
      let entrySignal = false;
      switch (bot.type) {
        case 'over3':
          entrySignal = checkEntryCondition.over3(marketDigits);
          break;
        case 'under6':
          entrySignal = checkEntryCondition.under6(marketDigits);
          break;
        case 'even':
          entrySignal = checkEntryCondition.even(marketDigits);
          break;
        case 'odd':
          entrySignal = checkEntryCondition.odd(marketDigits);
          break;
        case 'over1':
          entrySignal = checkEntryCondition.over1(marketDigits);
          break;
        case 'under8':
          entrySignal = checkEntryCondition.under8(marketDigits);
          break;
      }

      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        entrySignal,
        marketDigits
      } : b));

      // Entry logic
      if (!entryTriggered && !recoveryMode) {
        if (!entrySignal) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        } else {
          entryTriggered = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));
        }
      }

      if (!entryTriggered) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      try {
        // Wait for next tick before trading
        await waitForNextTick(currentMarket);

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // Prepare contract parameters
        const params: any = {
          contract_type: bot.contractType,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (bot.barrier !== undefined) {
          params.barrier = bot.barrier.toString();
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        // Get entry digits for logging
        const entryDigits = marketDigits.slice(-3).join(',');

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: bot.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit: marketDigits[marketDigits.length - 1],
          entryDigits
        }, ...prev].slice(0, 100));

        // Execute trade
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
        } else {
          losses++;
          consecutiveLosses++;
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          recoveryMode = true;
          entryTriggered = false;
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
              status: recoveryMode ? 'waiting' : (entryTriggered ? 'trading' : 'waiting'),
              recoveryMode,
              lastTradeResult: won ? 'win' : 'loss',
              entrySignal: false
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
      entrySignal: false
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots]);

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
      entrySignal: false
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
      entrySignal: false
    })));
  };

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
      recoveryMode: false,
      entrySignal: false,
      marketCondition: false,
      selectedMarket: undefined
    })));
    setMarketAnalysis({});
    setSignalsFound([]);
    setNoSignals(false);
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Dollar Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500/10"
            initial={{
              x: Math.random() * window.innerWidth,
              y: -100,
              rotate: Math.random() * 360,
              scale: Math.random() * 0.5 + 0.5,
            }}
            animate={{
              y: window.innerHeight + 100,
              rotate: Math.random() * 720,
            }}
            transition={{
              duration: Math.random() * 10 + 15,
              repeat: Infinity,
              ease: "linear",
              delay: Math.random() * 10,
            }}
          >
            <DollarSign className="w-12 h-12" />
          </motion.div>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 space-y-4 p-4 max-w-7xl mx-auto">
        {/* Header */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-2xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent">
              🤖 6-Bot Auto Trading System
            </h1>
            <div className="flex items-center gap-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={scanAllMarkets}
                disabled={isScanning}
                className="border-green-500/30 text-green-400 hover:bg-green-500/20"
              >
                {isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                Scan Markets (30s max)
              </Button>
              
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={clearAll}
                className="bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear
              </Button>
              
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={stopAllBots} 
                disabled={!bots.some(b => b.isRunning)}
                className="bg-red-500/20 hover:bg-red-500/30 border-red-500/30"
              >
                <StopCircle className="w-4 h-4 mr-1" /> Stop All
              </Button>
            </div>
          </div>

          {/* Scan Progress */}
          {isScanning && (
            <motion.div className="mb-3">
              <div className="flex justify-between text-xs text-green-400 mb-1">
                <span>🔍 {currentScanningMarket || 'Scanning markets...'}</span>
                <span>{Math.round(scanProgress)}%</span>
              </div>
              <div className="w-full h-2 bg-black/50 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-green-400 to-yellow-400"
                  initial={{ width: 0 }}
                  animate={{ width: `${scanProgress}%` }}
                />
              </div>
            </motion.div>
          )}

          {/* No Signal Message */}
          <AnimatePresence>
            {noSignals && !isScanning && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mb-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-center"
              >
                <AlertCircle className="w-6 h-6 text-red-400 mx-auto mb-1" />
                <p className="text-red-400 font-bold">NO SIGNAL FOUND</p>
                <p className="text-xs text-red-400/60">No markets match any bot conditions</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stats */}
          <div className="grid grid-cols-6 gap-3 text-sm">
            {[
              { label: 'Balance', value: `$${balance?.toFixed(2) || '0.00'}`, color: 'text-green-400' },
              { label: 'Total P&L', value: `$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400' },
              { label: 'Win Rate', value: `${winRate}%`, color: 'text-yellow-400' },
              { label: 'Trades', value: totalTrades.toString(), color: 'text-blue-400' },
              { label: 'Signals', value: signalsFound.length.toString(), color: 'text-purple-400' },
              { label: 'Active', value: bots.filter(b => b.entrySignal).length.toString(), color: 'text-yellow-400' },
            ].map((stat, i) => (
              <motion.div key={i} className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-2">
                <div className="text-green-400/60 text-xs">{stat.label}</div>
                <div className={`font-bold text-lg ${stat.color}`}>{stat.value}</div>
              </motion.div>
            ))}
          </div>

          {/* Settings */}
          <div className="grid grid-cols-4 gap-3 mt-3">
            {[
              { label: 'Stake ($)', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1' },
              { label: 'Multiplier', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1' },
              { label: 'Stop Loss ($)', value: globalStopLoss, setter: setGlobalStopLoss, step: '1', min: '1' },
              { label: 'Take Profit ($)', value: globalTakeProfit, setter: setGlobalTakeProfit, step: '1', min: '1' },
            ].map((setting, i) => (
              <div key={i} className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-2">
                <label className="text-xs text-green-400/60">{setting.label}</label>
                <input 
                  type="number" 
                  value={setting.value} 
                  onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                  className="w-full bg-black/50 border border-green-500/30 rounded px-2 py-1 text-sm text-green-400"
                  step={setting.step}
                  min={setting.min}
                />
              </div>
            ))}
          </div>
        </motion.div>

        {/* Signals Found */}
        <AnimatePresence>
          {signalsFound.length > 0 && !isScanning && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="bg-black/40 backdrop-blur-xl border border-yellow-500/30 rounded-xl p-3"
            >
              <h3 className="text-sm font-semibold mb-2 text-yellow-400 flex items-center gap-2">
                <Sparkles className="w-4 h-4" />
                📡 Signals Found - Click to Load Bot
              </h3>
              <div className="grid grid-cols-3 gap-2">
                {signalsFound.map((signal, index) => {
                  const [market, botType] = signal.split(' - ');
                  const bot = bots.find(b => b.type === botType.toLowerCase());
                  
                  return (
                    <motion.button
                      key={index}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => bot && loadBot(bot.id, market)}
                      className="bg-black/40 backdrop-blur border border-yellow-500/30 rounded-lg p-2 text-left hover:bg-yellow-500/10 transition-colors"
                    >
                      <div className="text-xs text-yellow-400">{getMarketDisplay(market)}</div>
                      <div className="text-sm font-bold text-green-400">{botType}</div>
                      {bot && !bot.selectedMarket && (
                        <Badge className="mt-1 bg-green-500/20 text-green-400 text-[8px]">Click to load</Badge>
                      )}
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bots Grid */}
        <div className="grid grid-cols-3 gap-3">
          {bots.map((bot, index) => {
            const marketData = bot.selectedMarket ? marketAnalysis[bot.selectedMarket] : null;
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: index * 0.1 }}
                className={`bg-black/40 backdrop-blur-xl border rounded-xl p-3 ${
                  bot.isRunning ? 'border-green-400 ring-2 ring-green-400/20' : 'border-green-500/20'
                } ${bot.entrySignal ? 'ring-2 ring-yellow-500/50' : ''} ${
                  bot.marketCondition ? 'border-l-4 border-l-green-400' : ''
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      bot.type.includes('over') ? 'bg-blue-500/20 text-blue-400' :
                      bot.type.includes('under') ? 'bg-orange-500/20 text-orange-400' :
                      bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {bot.type.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                       <CircleDot className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm text-green-400">{bot.name}</h4>
                      <p className="text-[9px] text-green-400/60">
                        {bot.contractType} {bot.barrier ? `B${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge className={`text-[9px] ${
                    bot.isRunning ? 'bg-green-500/20 text-green-400' : 'bg-gray-500/20 text-gray-400'
                  }`}>
                    {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                  </Badge>
                </div>

                {/* Market Info */}
                <div className="bg-black/40 backdrop-blur border border-green-500/20 rounded-lg p-2 mb-2 text-[10px]">
                  <div className="flex justify-between items-center">
                    <span className="text-green-400/60">Market:</span>
                    <span className="font-mono font-bold text-green-400">
                      {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                    </span>
                  </div>
                  {marketData && (
                    <>
                      <div className="flex justify-between mt-1">
                        <span>Most: {marketData.mostAppearing}</span>
                        <span>2nd: {marketData.secondMost}</span>
                        <span>Least: {marketData.leastAppearing}</span>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className={bot.entrySignal ? 'text-yellow-400 font-bold' : 'text-green-400/60'}>
                          Signal: {bot.entrySignal ? '✅ READY' : '❌'}
                        </span>
                        <span className="text-green-400/60">
                          Last: {marketData.lastDigit},{marketData.previousDigit},{marketData.thirdLastDigit}
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                  <div>
                    <span className="text-green-400/60">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-green-400/60">Wins:</span>
                    <span className="ml-1 text-green-400">{bot.wins}</span>
                  </div>
                  <div>
                    <span className="text-green-400/60">Losses:</span>
                    <span className="ml-1 text-red-400">{bot.losses}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between text-[9px] mb-2">
                  <span className="text-green-400/60">Status:</span>
                  <span className={`font-mono ${
                    bot.status === 'trading' ? 'text-green-400' :
                    bot.status === 'waiting' ? 'text-yellow-400' :
                    'text-gray-400'
                  }`}>
                    {bot.status === 'trading' ? '📈 Trading' :
                     bot.status === 'waiting' ? '⏳ Waiting' :
                     '⚫ Idle'}
                  </span>
                  <span className="text-green-400/60">Stake:</span>
                  <span className="font-mono text-green-400">${bot.currentStake.toFixed(2)}</span>
                </div>

                {/* Controls */}
                <div className="flex gap-1">
                  {!bot.selectedMarket ? (
                    <Button
                      disabled
                      size="sm"
                      className="flex-1 h-7 text-xs bg-gray-500/20 text-gray-400"
                    >
                      Scan first
                    </Button>
                  ) : !bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || balance < globalStake || activeTradeId !== null}
                      size="sm"
                      className="flex-1 h-7 text-xs bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start Auto
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs border-green-500/30 text-green-400 hover:bg-green-500/20"
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
            );
          })}
        </div>

        {/* Trade Log */}
        <motion.div className="bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-3">
          <h3 className="text-sm font-semibold mb-2 text-green-400">📋 Live Trade Log</h3>
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-xs text-green-400/60 text-center py-4">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  className="flex items-center justify-between text-xs py-1 border-b border-green-500/10"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-green-400/60">{trade.time}</span>
                    <Badge variant="outline" className="text-[8px] border-green-500/30 text-green-400">
                      {trade.bot}
                    </Badge>
                    <span className="font-mono text-[10px] text-green-400">
                      {getMarketDisplay(trade.market)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px] text-green-400/60">
                      Entry: {trade.entryDigits}
                    </span>
                    <span className="font-mono text-green-400">${trade.stake.toFixed(2)}</span>
                    <span className={`font-mono w-16 text-right ${
                      trade.result === 'Win' ? 'text-green-400' : 
                      trade.result === 'Loss' ? 'text-red-400' : 'text-yellow-400'
                    }`}>
                      {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                       trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                       '⏳'}
                    </span>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </motion.div>

        {/* Voice Status */}
        <motion.div className="fixed bottom-4 right-4 flex items-center gap-2 bg-black/60 backdrop-blur border border-green-500/20 rounded-lg px-3 py-2">
          <Volume2 className="w-4 h-4 text-green-400 animate-pulse" />
          <span className="text-xs text-green-400/60">Voice alerts active</span>
        </motion.div>
      </div>
    </div>
  );
}
