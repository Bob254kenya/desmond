import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign } from 'lucide-react';

interface DigitAnalysis {
  most: number;
  second: number;
  third: number;
  least: number;
  counts: Record<number, number>;
}

interface MarketSignal {
  market: string;
  botId: number;
  botName: string;
  status: 'waiting' | 'triggered' | 'trading';
  analysis: DigitAnalysis;
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
  status: 'idle' | 'waiting' | 'trading' | 'cooldown';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
  signal: boolean;
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
}

const ALL_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Jump Indices
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  // Bear/Bull
  'RDBEAR', 'RDBULL',
  // Jump Digital
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

// Bot strategies based on prompt requirements
const BOT_STRATEGIES = [
  {
    id: 1,
    name: 'OVER 1 BOT',
    type: 'over1',
    contractType: 'DIGITOVER',
    barrier: 1,
    recoveryBot: 'OVER 3',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most > 4 && analysis.second > 4 && analysis.least > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d <= 1);
    }
  },
  {
    id: 2,
    name: 'UNDER 8 BOT',
    type: 'under8',
    contractType: 'DIGITUNDER',
    barrier: 8,
    recoveryBot: 'UNDER 6',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most < 6 && analysis.second < 6 && analysis.least < 6;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d >= 8);
    }
  },
  {
    id: 3,
    name: 'EVEN BOT',
    type: 'even',
    contractType: 'DIGITEVEN',
    recoveryBot: 'EVEN',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most % 2 === 0 && 
             analysis.second % 2 === 0 && 
             analysis.least % 2 === 0;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    }
  },
  {
    id: 4,
    name: 'ODD BOT',
    type: 'odd',
    contractType: 'DIGITODD',
    recoveryBot: 'ODD',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most % 2 === 1 && 
             analysis.second % 2 === 1 && 
             analysis.third % 2 === 1;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    }
  },
  {
    id: 5,
    name: 'OVER 3 BOT',
    type: 'over3',
    contractType: 'DIGITOVER',
    barrier: 3,
    recoveryBot: 'OVER 3',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most > 4 && analysis.second > 4 && analysis.least > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d <= 2);
    }
  },
  {
    id: 6,
    name: 'UNDER 6 BOT',
    type: 'under6',
    contractType: 'DIGITUNDER',
    barrier: 6,
    recoveryBot: 'UNDER 6',
    condition: (analysis: DigitAnalysis) => {
      return analysis.most < 5 && analysis.second < 5 && analysis.least < 5;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d >= 7);
    }
  }
];

// Voice system using Web Speech API
const speak = (text: string, isScary = true) => {
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = isScary ? 0.3 : 0.8;
    utterance.rate = 0.7;
    utterance.volume = 1;
    
    // Try to find a deep voice
    const voices = window.speechSynthesis.getVoices();
    const deepVoice = voices.find(v => 
      v.name.includes('Google UK English Male') || 
      v.name.includes('Daniel') || 
      v.name.includes('Alex')
    );
    if (deepVoice) {
      utterance.voice = deepVoice;
    }
    
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.log('Speech not supported');
  }
};

// Digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  
  digits.forEach(d => {
    counts[d] = (counts[d] || 0) + 1;
  });
  
  const sorted = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => parseInt(entry[0]));
  
  return {
    most: sorted[0],
    second: sorted[1],
    third: sorted[2],
    least: sorted[9],
    counts
  };
};

// Market display helper
const getMarketDisplay = (market: string) => {
  if (market.startsWith('R_')) return `Volatility ${market.slice(2)}`;
  if (market.startsWith('1HZ')) return `1HZ ${market.slice(3)}`;
  if (market.startsWith('BOOM')) return `BOOM ${market.slice(4)}`;
  if (market.startsWith('CRASH')) return `CRASH ${market.slice(5)}`;
  if (market === 'RDBEAR') return 'Bear Market';
  if (market === 'RDBULL') return 'Bull Market';
  if (market.startsWith('JD')) return `Jump ${market.slice(2)}`;
  return market;
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketSignals, setMarketSignals] = useState<MarketSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [selectedMarketForScan, setSelectedMarketForScan] = useState<string>('R_100');
  const [noSignal, setNoSignal] = useState(false);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const scanTimeoutRef = useRef<NodeJS.Timeout>();
  const voiceIntervalRef = useRef<NodeJS.Timeout>();

  const { digits, prices, isLoading, tickCount } = useTickLoader(selectedMarketForScan, 1000);

  // Initialize voices
  useEffect(() => {
    // Load voices
    window.speechSynthesis.getVoices();
  }, []);

  // Update market digits
  useEffect(() => {
    if (digits.length > 0) {
      marketDigitsRef.current[selectedMarketForScan] = digits;
    }
  }, [digits, selectedMarketForScan]);

  // Monitor entry conditions for active signals
  useEffect(() => {
    marketSignals.forEach(signal => {
      if (signal.status === 'waiting') {
        const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
        const marketDigits = marketDigitsRef.current[signal.market] || [];
        
        if (bot.entryCondition(marketDigits)) {
          // Update signal status
          setMarketSignals(prev => prev.map(s => 
            s.market === signal.market && s.botId === signal.botId
              ? { ...s, status: 'triggered' }
              : s
          ));
          
          // Voice alert
          speak(`Signal found for ${bot.name} on ${getMarketDisplay(signal.market)}. Prepare to trade.`, true);
          toast.success(`${bot.name} triggered on ${getMarketDisplay(signal.market)}`);
          
          // Find and start the corresponding bot
          const botState = bots.find(b => b.type === bot.type);
          if (botState && !botState.isRunning) {
            setBots(prev => prev.map(b => 
              b.id === botState.id 
                ? { ...b, selectedMarket: signal.market, signal: true }
                : b
            ));
            setTimeout(() => startBot(botState.id), 1000);
          }
        }
      }
    });
  }, [marketSignals, bots]);

  // Six bots
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot5', name: 'OVER 1 BOT', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
    { 
      id: 'bot6', name: 'UNDER 8 BOT', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false,
      signal: false
    },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Fetch ticks for a market
  const fetchMarketTicks = useCallback(async (market: string, count: number = 1000): Promise<number[]> => {
    return new Promise((resolve) => {
      const ticks: number[] = [];
      
      const unsubscribe = derivApi.onMessage((data: any) => {
        if (data.error) {
          console.error(`Error fetching ${market}:`, data.error);
          unsubscribe();
          resolve(ticks);
          return;
        }
        
        if (data.history && data.history.prices) {
          const digits = data.history.prices.map((price: string) => 
            parseInt(price.slice(-1))
          );
          ticks.push(...digits);
          
          if (ticks.length >= count) {
            unsubscribe();
            resolve(ticks.slice(0, count));
          }
        }
      });
      
      derivApi.subscribeTicks(market);
    });
  }, []);

  // Scan all markets
  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignal(false);
    setMarketSignals([]);
    setScanProgress(0);
    
    // Start voice alerts every 20 seconds
    speak("Scanning the markets for money… stay ready.", true);
    voiceIntervalRef.current = setInterval(() => {
      speak("Scanning the markets for money… stay ready.", true);
    }, 20000);
    
    const totalMarkets = ALL_MARKETS.length;
    let processed = 0;
    const usedBots = new Set<number>();
    const foundSignals: MarketSignal[] = [];
    
    try {
      for (const market of ALL_MARKETS) {
        processed++;
        setScanProgress(Math.round((processed / totalMarkets) * 100));
        
        // Fetch 1000 ticks
        const digits = await fetchMarketTicks(market, 1000);
        
        if (digits.length >= 700) {
          // Store for later use
          marketDigitsRef.current[market] = digits;
          
          // Analyze digits
          const analysis = analyzeDigits(digits);
          
          // Check each bot strategy
          for (const bot of BOT_STRATEGIES) {
            if (!usedBots.has(bot.id) && bot.condition(analysis)) {
              usedBots.add(bot.id);
              foundSignals.push({
                market,
                botId: bot.id,
                botName: bot.name,
                status: 'waiting',
                analysis
              });
              
              // Voice alert for signal
              speak(`Signal found for ${bot.name} on ${getMarketDisplay(market)}. Prepare to trade.`, true);
              
              // Assign market to corresponding bot
              setBots(prev => prev.map(b => 
                b.type === bot.type ? { ...b, selectedMarket: market } : b
              ));
              
              break; // Only one bot per market
            }
          }
        }
        
        // Small delay to avoid rate limiting
        await new Promise(r => setTimeout(r, 100));
      }
      
      if (foundSignals.length === 0) {
        setNoSignal(true);
        speak("No signals found. Keep scanning.", true);
      } else {
        setMarketSignals(foundSignals);
        toast.success(`Found ${foundSignals.length} trading signals!`);
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
      speak("Scan failed. Please try again.", true);
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
    }
  }, [isScanning, fetchMarketTicks]);

  // Clear all data
  const clearAll = () => {
    setTrades([]);
    setMarketSignals([]);
    setNoSignal(false);
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
      signal: false,
      selectedMarket: undefined
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  // Trading loop
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
      const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;

      // Check entry condition based on bot type
      const botStrategy = BOT_STRATEGIES.find(s => s.type === bot.type)!;
      let currentSignal = botStrategy.entryCondition(marketDigits);

      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        signal: currentSignal 
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

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: bot.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit,
          signalType: bot.type
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl, lastDigit } : t));

        totalPnl += pnl;
        tradeCount++;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          stake = globalStake;
          entryTriggered = false;
          recoveryMode = false;
          cooldownRemaining = 0;
        } else {
          losses++;
          consecutiveLosses++;
          
          stake = Math.round(stake * globalMultiplier * 100) / 100;
          recoveryMode = true;
          entryTriggered = false;
          
          if (bot.type === 'even' || bot.type === 'odd') {
            cooldownRemaining = 5;
          }
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
              status: cooldownRemaining > 0 ? 'cooldown' : (recoveryMode ? 'waiting' : (entryTriggered ? 'trading' : 'waiting')),
              cooldownRemaining,
              recoveryMode,
              lastTradeResult: won ? 'win' : 'loss',
              signal: currentSignal
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
      signal: false
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots]);

  // Bot controls
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
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
      signal: false
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
      signal: false
    })));
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // Get active signals count
  const activeSignals = bots.filter(b => b.signal).length;

  return (
    <div className="space-y-4 p-4 bg-background min-h-screen relative overflow-hidden">
      {/* Animated dollar sign background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(30)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500/10 font-bold text-4xl"
            initial={{
              x: Math.random() * window.innerWidth,
              y: window.innerHeight + 100,
              rotate: Math.random() * 360,
              scale: 0.5 + Math.random()
            }}
            animate={{
              y: -100,
              rotate: Math.random() * 720,
              x: Math.random() * window.innerWidth
            }}
            transition={{
              duration: 10 + Math.random() * 20,
              repeat: Infinity,
              delay: Math.random() * 10,
              ease: "linear"
            }}
          >
            $
          </motion.div>
        ))}
      </div>

      {/* Main content */}
      <div className="relative z-10">
        {/* Header */}
        <div className="bg-card border border-border rounded-xl p-6 mb-4 text-center">
          <motion.h1 
            className="text-3xl font-bold bg-gradient-to-r from-yellow-400 to-green-400 text-transparent bg-clip-text"
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5 }}
          >
            DERIV AUTO TRADER
          </motion.h1>
          <p className="text-muted-foreground mt-2">Automated Market Scanner & 6-Bot System</p>
        </div>

        {/* Scan Button - Large Central Button */}
        <div className="flex justify-center mb-8">
          <motion.button
            onClick={scanMarket}
            disabled={isScanning}
            className={`relative w-64 h-64 rounded-full font-bold text-2xl shadow-2xl ${
              isScanning 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-gradient-to-r from-green-500 to-green-600 hover:from-green-400 hover:to-green-500'
            }`}
            whileHover={{ scale: isScanning ? 1 : 1.1 }}
            whileTap={{ scale: isScanning ? 1 : 0.95 }}
            animate={isScanning ? {
              boxShadow: [
                "0 0 20px rgba(34,197,94,0.5)",
                "0 0 40px rgba(34,197,94,0.8)",
                "0 0 20px rgba(34,197,94,0.5)"
              ]
            } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            {isScanning ? (
              <div className="flex flex-col items-center">
                <Loader2 className="w-12 h-12 animate-spin mb-2" />
                <span>SCANNING...</span>
                <span className="text-sm mt-2">{scanProgress}%</span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <RefreshCw className="w-16 h-16 mb-4" />
                <span>SCAN</span>
                <span className="text-sm mt-2">All Markets</span>
              </div>
            )}
          </motion.button>
        </div>

        {/* No Signal Message */}
        {noSignal && !isScanning && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-8"
          >
            <div className="bg-red-900/50 rounded-xl p-8 border border-red-700 text-center">
              <div className="text-6xl mb-4">😢</div>
              <h2 className="text-2xl font-bold text-red-400 mb-2">NO SIGNAL FOUND</h2>
              <p className="text-gray-400">Click SCAN to try again</p>
            </div>
          </motion.div>
        )}

        {/* Signal Container */}
        {marketSignals.length > 0 && (
          <div className="mb-8">
            <h2 className="text-xl font-bold mb-4 flex items-center">
              <span className="w-2 h-2 bg-green-400 rounded-full mr-2 animate-pulse"></span>
              Active Signals ({marketSignals.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {marketSignals.map((signal) => (
                <motion.div
                  key={`${signal.market}_${signal.botId}`}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`bg-card border-2 rounded-xl p-4 ${
                    signal.status === 'triggered' 
                      ? 'border-green-500' 
                      : 'border-yellow-500'
                  }`}
                >
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-lg font-bold text-blue-400">
                        {getMarketDisplay(signal.market)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        BOT: {signal.botName}
                      </div>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                      signal.status === 'triggered'
                        ? 'bg-green-500 text-white'
                        : 'bg-yellow-500 text-black'
                    }`}>
                      {signal.status === 'triggered' ? 'TRADING' : 'WAITING ENTRY'}
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2 text-sm bg-muted/30 rounded-lg p-2">
                    <div>
                      <span className="text-muted-foreground">Most:</span>
                      <span className="ml-2 font-mono">{signal.analysis.most}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Second:</span>
                      <span className="ml-2 font-mono">{signal.analysis.second}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Third:</span>
                      <span className="ml-2 font-mono">{signal.analysis.third}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Least:</span>
                      <span className="ml-2 font-mono">{signal.analysis.least}</span>
                    </div>
                  </div>
                  
                  {signal.status === 'waiting' && (
                    <div className="mt-3 flex items-center text-yellow-400 text-sm">
                      <div className="w-2 h-2 bg-yellow-400 rounded-full mr-2 animate-pulse"></div>
                      Monitoring live ticks for entry...
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {/* Global Stats */}
        <div className="bg-card border border-border rounded-xl p-4 mb-4">
          <div className="grid grid-cols-6 gap-3 text-sm">
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
              <div className="text-muted-foreground text-xs">Total Trades</div>
              <div className="font-bold text-lg">{totalTrades}</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Active</div>
              <div className="font-bold text-lg">{bots.filter(b => b.isRunning).length}/6</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-2">
              <div className="text-muted-foreground text-xs">Signals</div>
              <div className="font-bold text-lg text-yellow-400">{activeSignals}/6</div>
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-5 gap-3 mt-3">
            <div>
              <label className="text-xs text-muted-foreground">Stake ($)</label>
              <input 
                type="number" 
                value={globalStake} 
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
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
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Take Profit ($)</label>
              <input 
                type="number" 
                value={globalTakeProfit} 
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">&nbsp;</label>
              <Button 
                variant="destructive" 
                size="sm" 
                onClick={clearAll}
                className="w-full"
              >
                <Trash2 className="w-4 h-4 mr-1" /> Clear All
              </Button>
            </div>
          </div>
        </div>

        {/* Bots Grid */}
        <div className="grid grid-cols-3 gap-3 mt-3">
          {bots.map((bot) => {
            const marketSignal = marketSignals.find(s => s.botId === BOT_STRATEGIES.find(bs => bs.type === bot.type)?.id);
            
            return (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`bg-card border rounded-xl p-3 ${
                  bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                } ${bot.signal ? 'ring-2 ring-yellow-500/50' : ''}`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      bot.type === 'over3' || bot.type === 'over1' ? 'bg-blue-500/20 text-blue-400' :
                      bot.type === 'under6' || bot.type === 'under8' ? 'bg-orange-500/20 text-orange-400' :
                      bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {bot.type.includes('over') ? <TrendingUp className="w-4 h-4" /> :
                       bot.type.includes('under') ? <TrendingDown className="w-4 h-4" /> :
                       <CircleDot className="w-4 h-4" />}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{bot.name}</h4>
                      <p className="text-[9px] text-muted-foreground">
                        {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {bot.signal && (
                      <motion.div
                        initial={{ scale: 0 }}
                        animate={{ scale: [1, 1.2, 1] }}
                        transition={{ duration: 0.5, repeat: Infinity }}
                      >
                        <Badge variant="default" className="bg-yellow-500 text-[8px] px-1 py-0">
                          SIGNAL
                        </Badge>
                      </motion.div>
                    )}
                    <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>
                </div>

                {/* Market Info */}
                <div className="bg-muted/30 rounded-lg p-2 mb-2 text-[10px]">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Market:</span>
                    <span className="font-mono font-bold text-blue-400">
                      {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}
                    </span>
                  </div>
                  {marketSignal && (
                    <div className="flex justify-between mt-1">
                      <span>Most: {marketSignal.analysis.most}</span>
                      <span>2nd: {marketSignal.analysis.second}</span>
                      <span>Least: {marketSignal.analysis.least}</span>
                    </div>
                  )}
                </div>

                {/* Stats */}
                <div className="grid grid-cols-3 gap-1 text-[10px] mb-2">
                  <div>
                    <span className="text-muted-foreground">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Wins:</span>
                    <span className="ml-1 font-mono text-profit">{bot.wins}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Losses:</span>
                    <span className="ml-1 font-mono text-loss">{bot.losses}</span>
                  </div>
                </div>

                {/* Status */}
                <div className="flex items-center justify-between text-[9px] mb-2">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`font-mono ${
                    bot.status === 'trading' ? 'text-green-400' :
                    bot.status === 'waiting' ? 'text-yellow-400' :
                    bot.status === 'cooldown' ? 'text-purple-400' :
                    'text-gray-400'
                  }`}>
                    {bot.status === 'trading' ? '📈 Trading' :
                     bot.status === 'waiting' ? '⏳ Waiting' :
                     bot.status === 'cooldown' ? `⏱️ Cooldown ${bot.cooldownRemaining}` :
                     '⚫ Idle'}
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
                      className="flex-1 h-7 text-xs"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                      >
                        <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        onClick={() => stopBot(bot.id)}
                        size="sm"
                        variant="destructive"
                        className="flex-1 h-7 text-xs"
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
        <div className="bg-card border border-border rounded-xl p-3 mt-3">
          <h3 className="text-sm font-semibold mb-2">📋 Live Trade Log</h3>
          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">{trade.time}</span>
                    <Badge variant="outline" className="text-[8px] px-1 py-0">{trade.bot}</Badge>
                    <span className="font-mono text-[10px] text-blue-400">
                      {getMarketDisplay(trade.market)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-[10px]">
                      Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                    </span>
                    <span className="font-mono">${trade.stake.toFixed(2)}</span>
                    <span className={`font-mono w-16 text-right ${
                      trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
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
        </div>
      </div>
    </div>
  );
}

// Helper function for waiting ticks
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
