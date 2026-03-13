import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, Volume2, DollarSign, Sparkles, 
  Zap, Activity, TrendingUp as TrendUp, Award, Target, Shield,
  ArrowUpCircle, ArrowDownCircle, AlertCircle, CheckCircle2,
  Binary, Gauge, Rocket, Crown, Flame, Gem, Star, Orbit
} from 'lucide-react';

// Mock derivApi for demonstration - replace with actual Deriv API
const derivApi = {
  onMessage: (callback: any) => {
    return () => {};
  },
  subscribeTicks: (symbol: string) => {
    console.log('Subscribing to', symbol);
  },
  buyContract: async (params: any) => {
    return { contractId: 'mock123' };
  },
  waitForContractResult: async (contractId: string) => {
    await new Promise(r => setTimeout(r, 2000));
    return {
      status: Math.random() > 0.5 ? 'won' : 'lost',
      profit: Math.random() > 0.5 ? 0.95 : -1
    };
  }
};

// Mock auth context
const useAuth = () => {
  return {
    isAuthorized: true,
    activeAccount: { id: 'test' },
    balance: 1000
  };
};

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
  status: 'waiting' | 'triggered';
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
  status: 'idle' | 'waiting' | 'trading' | 'cooldown' | 'entry_pending';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
  signal: boolean;
  lastDigit?: number;
  autoTradeEnabled: boolean;
  pendingEntry: boolean;
  entryTimestamp?: number;
  cycleActive: boolean;
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
  entryDigit: number;
  exitDigit?: number;
  signalType?: string;
  executionTime?: number;
}

// Markets without BOOM/CRASH
const ALL_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'RDBEAR', 'RDBULL',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

// Bot strategies
const BOT_STRATEGIES = [
  {
    id: 1,
    name: 'OVER 1',
    type: 'over1',
    contractType: 'DIGITOVER',
    barrier: 1,
    icon: <ArrowUpCircle className="w-3 h-3" />,
    color: 'blue',
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
    name: 'UNDER 8',
    type: 'under8',
    contractType: 'DIGITUNDER',
    barrier: 8,
    icon: <ArrowDownCircle className="w-3 h-3" />,
    color: 'orange',
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
    name: 'EVEN',
    type: 'even',
    contractType: 'DIGITEVEN',
    icon: <Binary className="w-3 h-3" />,
    color: 'green',
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
    name: 'ODD',
    type: 'odd',
    contractType: 'DIGITODD',
    icon: <Binary className="w-3 h-3" />,
    color: 'purple',
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
    name: 'OVER 3',
    type: 'over3',
    contractType: 'DIGITOVER',
    barrier: 3,
    icon: <Gauge className="w-3 h-3" />,
    color: 'cyan',
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
    name: 'UNDER 6',
    type: 'under6',
    contractType: 'DIGITUNDER',
    barrier: 6,
    icon: <Target className="w-3 h-3" />,
    color: 'red',
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

// Scanning sound
const playScanSound = (type: 'start' | 'progress' | 'complete' | 'signal' | 'trade') => {
  try {
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.type = 'sine';
    
    switch(type) {
      case 'start':
        oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.3);
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        break;
      case 'progress':
        oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        oscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.1);
        gainNode.gain.setValueAtTime(0.05, audioContext.currentTime);
        break;
      case 'complete':
        oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(554.37, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);
        break;
      case 'signal':
        oscillator.frequency.setValueAtTime(988, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(1318.51, audioContext.currentTime + 0.15);
        gainNode.gain.setValueAtTime(0.2, audioContext.currentTime);
        break;
      case 'trade':
        oscillator.frequency.setValueAtTime(523.25, audioContext.currentTime);
        oscillator.frequency.setValueAtTime(659.25, audioContext.currentTime + 0.1);
        oscillator.frequency.setValueAtTime(783.99, audioContext.currentTime + 0.2);
        gainNode.gain.setValueAtTime(0.25, audioContext.currentTime);
        break;
    }
    
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.3);
  } catch (e) {
    console.log('Audio not supported');
  }
};

// Voice system
const speak = (text: string, isScary = true) => {
  try {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.pitch = isScary ? 0.3 : 0.8;
    utterance.rate = 0.7;
    utterance.volume = 1;
    
    const voices = window.speechSynthesis.getVoices();
    const deepVoice = voices.find(v => 
      v.name.includes('Google UK English Male') || 
      v.name.includes('Daniel')
    );
    if (deepVoice) utterance.voice = deepVoice;
    
    window.speechSynthesis.speak(utterance);
  } catch (e) {
    console.log('Speech not supported');
  }
};

// Digit analysis
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  
  digits.forEach(d => counts[d]++);
  
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

// Market display
const getMarketDisplay = (market: string) => {
  if (market.startsWith('R_')) return `R${market.slice(2)}`;
  if (market.startsWith('1HZ')) return `HZ${market.slice(3)}`;
  if (market === 'RDBEAR') return 'BEAR';
  if (market === 'RDBULL') return 'BULL';
  if (market.startsWith('JD')) return `JD${market.slice(2)}`;
  return market;
};

// Mock tick loader with real-time updates
const useTickLoader = (market: string, count: number) => {
  const [digits, setDigits] = useState<number[]>([]);
  const [lastTick, setLastTick] = useState<number>(0);
  
  useEffect(() => {
    const mockDigits = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 10));
    setDigits(mockDigits);
    setLastTick(mockDigits[mockDigits.length - 1]);
    
    const interval = setInterval(() => {
      const newDigit = Math.floor(Math.random() * 10);
      setDigits(prev => {
        const updated = [...prev.slice(1), newDigit];
        return updated;
      });
      setLastTick(newDigit);
    }, 2000);
    
    return () => clearInterval(interval);
  }, [market]);
  
  return { digits, lastTick, prices: [], isLoading: false, tickCount: digits.length };
};

// Wait for next tick function
const waitForNextTick = (market: string): Promise<number> => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(Math.floor(Math.random() * 10));
    }, 500);
  });
};

export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [marketSignals, setMarketSignals] = useState<MarketSignal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [noSignal, setNoSignal] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
  const [masterCycleActive, setMasterCycleActive] = useState(false);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const marketLastTickRef = useRef<Record<string, number>>({});
  const voiceIntervalRef = useRef<NodeJS.Timeout>();
  const tickListenersRef = useRef<Record<string, ((digit: number) => void)[]>>({});
  const masterCycleRef = useRef<NodeJS.Timeout>();

  const { digits, lastTick } = useTickLoader('R_100', 1000);

  // Initialize voices
  useEffect(() => {
    if (window.speechSynthesis) window.speechSynthesis.getVoices();
  }, []);

  // Six bots
  const [bots, setBots] = useState<BotState[]>([
    { id: 'bot1', name: 'OVER 3', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, 
      signal: false, lastDigit: undefined, autoTradeEnabled: false, pendingEntry: false, entryTimestamp: undefined, cycleActive: false },
    { id: 'bot2', name: 'UNDER 6', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, 
      signal: false, lastDigit: undefined, autoTradeEnabled: false, pendingEntry: false, entryTimestamp: undefined, cycleActive: false },
    { id: 'bot3', name: 'EVEN', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, 
      signal: false, lastDigit: undefined, autoTradeEnabled: false, pendingEntry: false, entryTimestamp: undefined, cycleActive: false },
    { id: 'bot4', name: 'ODD', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, 
      signal: false, lastDigit: undefined, autoTradeEnabled: false, pendingEntry: false, entryTimestamp: undefined, cycleActive: false },
    { id: 'bot5', name: 'OVER 1', type: 'over1', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, 
      signal: false, lastDigit: undefined, autoTradeEnabled: false, pendingEntry: false, entryTimestamp: undefined, cycleActive: false },
    { id: 'bot6', name: 'UNDER 8', type: 'under8', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8,
      status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false, 
      signal: false, lastDigit: undefined, autoTradeEnabled: false, pendingEntry: false, entryTimestamp: undefined, cycleActive: false }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Register tick listener
  const registerTickListener = useCallback((market: string, callback: (digit: number) => void) => {
    if (!tickListenersRef.current[market]) {
      tickListenersRef.current[market] = [];
    }
    tickListenersRef.current[market].push(callback);
    
    return () => {
      tickListenersRef.current[market] = tickListenersRef.current[market].filter(cb => cb !== callback);
    };
  }, []);

  // Simulate tick updates
  useEffect(() => {
    const interval = setInterval(() => {
      ALL_MARKETS.forEach(market => {
        const newDigit = Math.floor(Math.random() * 10);
        marketLastTickRef.current[market] = newDigit;
        
        if (!marketDigitsRef.current[market]) {
          marketDigitsRef.current[market] = [];
        }
        marketDigitsRef.current[market].push(newDigit);
        if (marketDigitsRef.current[market].length > 1000) {
          marketDigitsRef.current[market].shift();
        }
        
        if (tickListenersRef.current[market]) {
          tickListenersRef.current[market].forEach(callback => callback(newDigit));
        }
      });
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  // Monitor entry conditions
  useEffect(() => {
    const checkSignals = () => {
      marketSignals.forEach(signal => {
        if (signal.status === 'waiting') {
          const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
          const marketDigits = marketDigitsRef.current[signal.market] || [];
          const lastDigit = marketDigits.length > 0 ? marketDigits[marketDigits.length - 1] : undefined;
          
          if (lastDigit !== undefined) {
            setBots(prev => prev.map(b => 
              b.type === bot.type ? { ...b, lastDigit } : b
            ));
          }
          
          if (bot.entryCondition(marketDigits)) {
            setMarketSignals(prev => prev.map(s => 
              s.market === signal.market && s.botId === signal.botId
                ? { ...s, status: 'triggered' }
                : s
            ));
            
            if (soundEnabled) playScanSound('signal');
            
            const botState = bots.find(b => b.type === bot.type);
            
            if (botState) {
              setBots(prev => prev.map(b => 
                b.type === bot.type ? { 
                  ...b, 
                  signal: true, 
                  selectedMarket: signal.market,
                  pendingEntry: true,
                  entryTimestamp: Date.now()
                } : b
              ));
              
              const unsubscribe = registerTickListener(signal.market, async (newDigit) => {
                const currentBot = bots.find(b => b.type === bot.type);
                if (currentBot?.pendingEntry && currentBot.selectedMarket === signal.market) {
                  setBots(prev => prev.map(b => 
                    b.type === bot.type ? { ...b, pendingEntry: false } : b
                  ));
                  
                  unsubscribe();
                  
                  if (soundEnabled) playScanSound('trade');
                  
                  if (autoTradeEnabled || masterCycleActive) {
                    startBot(botState.id);
                  } else {
                    toast.info(`${bot.name} ready to trade on next tick!`);
                  }
                }
              });
            }
          }
        }
      });
    };

    const interval = setInterval(checkSignals, 500);
    return () => clearInterval(interval);
  }, [marketSignals, bots, soundEnabled, autoTradeEnabled, masterCycleActive, registerTickListener]);

  // Master cycle control
  const startMasterCycle = useCallback(() => {
    if (masterCycleActive) return;
    
    setMasterCycleActive(true);
    setAutoTradeEnabled(true);
    
    // Activate all bots that have signals
    bots.forEach(bot => {
      if (bot.signal && !bot.isRunning) {
        setBots(prev => prev.map(b => 
          b.id === bot.id ? { ...b, cycleActive: true } : b
        ));
      }
    });
    
    toast.success('Master trading cycle activated!');
    speak('Master cycle activated. Trading all signals.', true);
    if (soundEnabled) playScanSound('start');
    
  }, [masterCycleActive, bots, soundEnabled]);

  const stopMasterCycle = useCallback(() => {
    setMasterCycleActive(false);
    setAutoTradeEnabled(false);
    
    setBots(prev => prev.map(b => ({ ...b, cycleActive: false })));
    stopAllBots();
    
    toast.info('Master cycle stopped');
    speak('Master cycle stopped', true);
    
  }, [soundEnabled]);

  // Check TP/SL for master cycle
  useEffect(() => {
    if (!masterCycleActive) return;
    
    const totalPnl = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
    
    if (totalPnl <= -globalStopLoss) {
      toast.error(`Master cycle: Stop Loss reached! $${totalPnl.toFixed(2)}`);
      stopMasterCycle();
    } else if (totalPnl >= globalTakeProfit) {
      toast.success(`Master cycle: Take Profit reached! +$${totalPnl.toFixed(2)}`);
      stopMasterCycle();
    }
  }, [bots, globalStopLoss, globalTakeProfit, masterCycleActive, stopMasterCycle]);

  // Fetch ticks
  const fetchMarketTicks = useCallback(async (market: string, count: number = 1000): Promise<number[]> => {
    await new Promise(r => setTimeout(r, 300));
    return Array.from({ length: count }, () => Math.floor(Math.random() * 10));
  }, []);

  // Scan all markets
  const scanMarket = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignal(false);
    setMarketSignals([]);
    setScanProgress(0);
    
    setBots(prev => prev.map(b => ({ ...b, signal: false, selectedMarket: undefined, pendingEntry: false })));
    
    if (soundEnabled) playScanSound('start');
    speak("Scanning the markets for money", true);
    
    voiceIntervalRef.current = setInterval(() => {
      speak("Scanning the markets for money", true);
      if (soundEnabled) playScanSound('progress');
    }, 15000);
    
    const totalMarkets = ALL_MARKETS.length;
    let processed = 0;
    const usedBots = new Set<number>();
    const foundSignals: MarketSignal[] = [];
    
    try {
      for (const market of ALL_MARKETS) {
        processed++;
        setScanProgress(Math.round((processed / totalMarkets) * 100));
        
        const digits = await fetchMarketTicks(market, 1000);
        
        if (digits.length >= 700) {
          marketDigitsRef.current[market] = digits;
          const analysis = analyzeDigits(digits);
          
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
              
              if (soundEnabled) playScanSound('signal');
              
              break;
            }
          }
        }
        
        await new Promise(r => setTimeout(r, 50));
      }
      
      if (foundSignals.length === 0) {
        setNoSignal(true);
        speak("No signals found", true);
      } else {
        setMarketSignals(foundSignals);
        toast.success(`Found ${foundSignals.length} market signals`);
      }
      
      if (soundEnabled) playScanSound('complete');
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      if (voiceIntervalRef.current) clearInterval(voiceIntervalRef.current);
    }
  }, [isScanning, fetchMarketTicks, soundEnabled]);

  // Clear all
  const clearAll = () => {
    setTrades([]);
    setMarketSignals([]);
    setNoSignal(false);
    setMasterCycleActive(false);
    setAutoTradeEnabled(false);
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
      selectedMarket: undefined,
      lastDigit: undefined,
      pendingEntry: false,
      entryTimestamp: undefined,
      cycleActive: false
    })));
    tradeIdRef.current = 0;
    toast.success('All cleared');
  };

  // Execute trade
  const executeTrade = useCallback(async (botId: string, entryDigit: number) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return false;

    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance`);
      return false;
    }

    try {
      const id = ++tradeIdRef.current;
      const now = new Date().toLocaleTimeString();
      const tradeId = `${botId}-${id}`;
      setActiveTradeId(tradeId);

      const newTrade: TradeLog = {
        id,
        time: now,
        market: bot.selectedMarket!,
        contract: bot.contractType,
        stake: bot.currentStake,
        result: 'Pending',
        pnl: 0,
        bot: bot.name,
        entryDigit,
        signalType: bot.type,
        executionTime: Date.now()
      };
      
      setTrades(prev => [newTrade, ...prev].slice(0, 50));

      const params: any = {
        contract_type: bot.contractType,
        symbol: bot.selectedMarket,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: bot.currentStake,
      };

      if (bot.barrier !== undefined) {
        params.barrier = bot.barrier.toString();
      }

      const { contractId } = await derivApi.buyContract(params);
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;

      const exitDigit = await waitForNextTick(bot.selectedMarket!);

      setTrades(prev => prev.map(t => 
        t.id === id ? { 
          ...t, 
          result: won ? 'Win' : 'Loss', 
          pnl,
          exitDigit 
        } : t
      ));

      setBots(prev => prev.map(b => {
        if (b.id === botId) {
          const newTrades = b.trades + 1;
          const newWins = won ? b.wins + 1 : b.wins;
          const newLosses = won ? b.losses : b.losses + 1;
          const newPnl = b.totalPnl + pnl;
          const newStake = won ? globalStake : Math.round(b.currentStake * globalMultiplier * 100) / 100;
          
          return {
            ...b,
            totalPnl: newPnl,
            trades: newTrades,
            wins: newWins,
            losses: newLosses,
            currentStake: newStake,
            lastTradeResult: won ? 'win' : 'loss',
            consecutiveLosses: won ? 0 : b.consecutiveLosses + 1,
            status: 'trading'
          };
        }
        return b;
      }));

      setActiveTradeId(null);
      
      if (soundEnabled) playScanSound('complete');
      
      return true;

    } catch (err) {
      console.error('Trade error:', err);
      setActiveTradeId(null);
      return false;
    }
  }, [isAuthorized, balance, globalStake, globalMultiplier, bots, soundEnabled]);

  // Start bot
  const startBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance`);
      return;
    }

    if (!bot.selectedMarket) {
      toast.error(`No market selected`);
      return;
    }

    const currentDigit = marketLastTickRef.current[bot.selectedMarket] || 
                        (marketDigitsRef.current[bot.selectedMarket]?.slice(-1)[0]) || 
                        Math.floor(Math.random() * 10);

    await executeTrade(botId, currentDigit);

  }, [isAuthorized, balance, bots, executeTrade]);

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
      pendingEntry: false,
      cycleActive: false
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => botRunningRefs.current[bot.id] = false);
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false, 
      status: 'idle',
      pendingEntry: false,
      cycleActive: false
    })));
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';
  const activeSignals = bots.filter(b => b.signal).length;
  const pendingEntries = bots.filter(b => b.pendingEntry).length;
  const activeInCycle = bots.filter(b => b.cycleActive).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 relative overflow-hidden">
      {/* Animated Dollar Background - Enhanced */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {/* Large floating dollars */}
        {[...Array(30)].map((_, i) => {
          const colors = [
            'text-green-500/5', 'text-yellow-500/5', 'text-blue-500/5', 
            'text-purple-500/5', 'text-pink-500/5', 'text-orange-500/5',
            'text-cyan-500/5', 'text-emerald-500/5', 'text-amber-500/5'
          ];
          const color = colors[Math.floor(Math.random() * colors.length)];
          const size = 40 + Math.random() * 80;
          const left = Math.random() * 100;
          const duration = 20 + Math.random() * 30;
          const delay = Math.random() * 15;
          
          return (
            <motion.div
              key={`large-${i}`}
              className={`absolute ${color} font-bold`}
              style={{ 
                fontSize: size,
                left: `${left}%`,
                filter: 'blur(1px)'
              }}
              initial={{ 
                y: '120vh',
                rotate: 0,
                opacity: 0.1
              }}
              animate={{ 
                y: '-20vh',
                rotate: 360,
                opacity: [0.1, 0.2, 0.1]
              }}
              transition={{
                duration: duration,
                repeat: Infinity,
                delay: delay,
                ease: "linear"
              }}
            >
              {i % 3 === 0 ? '💰' : '$'}
            </motion.div>
          );
        })}
        
        {/* Medium floating dollars */}
        {[...Array(40)].map((_, i) => {
          const colors = [
            'text-emerald-500/10', 'text-teal-500/10', 'text-lime-500/10',
            'text-amber-500/10', 'text-rose-500/10', 'text-fuchsia-500/10'
          ];
          const color = colors[Math.floor(Math.random() * colors.length)];
          const size = 20 + Math.random() * 40;
          const left = Math.random() * 100;
          const duration = 15 + Math.random() * 20;
          
          return (
            <motion.div
              key={`medium-${i}`}
              className={`absolute ${color} font-bold`}
              style={{ 
                fontSize: size,
                left: `${left}%`,
              }}
              initial={{ 
                y: '100vh',
                rotate: Math.random() * 360,
                opacity: 0.05
              }}
              animate={{ 
                y: '-10vh',
                rotate: 720,
                opacity: [0.05, 0.15, 0.05]
              }}
              transition={{
                duration: duration,
                repeat: Infinity,
                delay: Math.random() * 10,
                ease: "linear"
              }}
            >
              $
            </motion.div>
          );
        })}
        
        {/* Small sparkling dollars */}
        {[...Array(60)].map((_, i) => (
          <motion.div
            key={`small-${i}`}
            className="absolute text-yellow-300/20 text-xs"
            style={{ 
              left: `${Math.random() * 100}%`,
            }}
            initial={{ 
              y: '80vh',
              scale: 0,
              opacity: 0
            }}
            animate={{ 
              y: '-5vh',
              scale: [0, 1, 0],
              opacity: [0, 0.3, 0]
            }}
            transition={{
              duration: 10 + Math.random() * 15,
              repeat: Infinity,
              delay: Math.random() * 10,
              ease: "easeInOut"
            }}
          >
            ✦
          </motion.div>
        ))}
        
        {/* Rotating dollar rings */}
        {[...Array(5)].map((_, i) => (
          <motion.div
            key={`ring-${i}`}
            className="absolute border-2 border-green-500/5 rounded-full"
            style={{
              width: 200 + i * 150,
              height: 200 + i * 150,
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
            }}
            animate={{
              rotate: 360,
              scale: [1, 1.1, 1],
            }}
            transition={{
              duration: 20 + i * 5,
              repeat: Infinity,
              ease: "linear"
            }}
          />
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-4 py-6">
        {/* Header with Glow Effect */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center mb-8"
        >
          <h1 className="text-5xl font-extrabold mb-2">
            <span className="bg-gradient-to-r from-yellow-400 via-green-400 to-blue-400 text-transparent bg-clip-text drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]">
              AUTO TRADER PRO
            </span>
          </h1>
          <p className="text-gray-400 text-sm tracking-wider">6-Bot Intelligent Trading System</p>
        </motion.div>

        {/* Master Control Button - Large Central Button */}
        <motion.div 
          className="flex justify-center mb-8"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.2 }}
        >
          <motion.button
            onClick={masterCycleActive ? stopMasterCycle : startMasterCycle}
            disabled={isScanning || marketSignals.length === 0}
            className={`relative w-48 h-48 rounded-full font-bold text-xl shadow-2xl ${
              masterCycleActive 
                ? 'bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-400 hover:to-pink-400' 
                : marketSignals.length > 0
                  ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400'
                  : 'bg-gradient-to-r from-gray-600 to-gray-700 cursor-not-allowed'
            }`}
            whileHover={{ scale: marketSignals.length > 0 ? 1.1 : 1 }}
            whileTap={{ scale: marketSignals.length > 0 ? 0.95 : 1 }}
            animate={masterCycleActive ? {
              boxShadow: [
                '0 0 20px rgba(239,68,68,0.5)',
                '0 0 40px rgba(239,68,68,0.8)',
                '0 0 20px rgba(239,68,68,0.5)'
              ]
            } : marketSignals.length > 0 ? {
              boxShadow: [
                '0 0 20px rgba(34,197,94,0.5)',
                '0 0 40px rgba(34,197,94,0.8)',
                '0 0 20px rgba(34,197,94,0.5)'
              ]
            } : {}}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div className="flex flex-col items-center">
              {masterCycleActive ? (
                <>
                  <StopCircle className="w-12 h-12 mb-2" />
                  <span>STOP CYCLE</span>
                  <span className="text-xs mt-1">TP: ${globalTakeProfit}</span>
                </>
              ) : (
                <>
                  <Rocket className="w-12 h-12 mb-2" />
                  <span>MASTER CYCLE</span>
                  <span className="text-xs mt-1">{marketSignals.length} Signals Ready</span>
                </>
              )}
            </div>
            
            {/* Orbiting rings */}
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-white/20"
              animate={{ rotate: 360 }}
              transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute inset-2 rounded-full border border-white/10"
              animate={{ rotate: -360 }}
              transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
            />
          </motion.button>
        </motion.div>

        {/* Control Panel */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 mb-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-400" />
              <h2 className="text-lg font-semibold text-white">Control Center</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/10 rounded-lg px-2 py-1">
                <Sparkles className="w-3 h-3 text-yellow-400" />
                <Label htmlFor="auto-trade" className="text-[10px] text-white">AUTO</Label>
                <Switch
                  id="auto-trade"
                  checked={autoTradeEnabled}
                  onCheckedChange={setAutoTradeEnabled}
                  className="scale-75"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="w-7 h-7 bg-white/10 border-white/20"
              >
                <Volume2 className={`w-3 h-3 ${soundEnabled ? 'text-green-400' : 'text-gray-400'}`} />
              </Button>
              <Button variant="destructive" size="sm" onClick={clearAll} className="h-7 text-xs">
                <Trash2 className="w-3 h-3 mr-1" /> Clear
              </Button>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-5 gap-2 mb-3">
            <div className="bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-xl p-2 border border-blue-500/30">
              <div className="text-[8px] text-blue-300">Balance</div>
              <div className="text-sm font-bold text-blue-400">${balance?.toFixed(2)}</div>
            </div>
            <div className="bg-gradient-to-br from-green-500/20 to-emerald-500/20 rounded-xl p-2 border border-green-500/30">
              <div className="text-[8px] text-green-300">P&L</div>
              <div className={`text-sm font-bold ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                ${totalProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-gradient-to-br from-yellow-500/20 to-orange-500/20 rounded-xl p-2 border border-yellow-500/30">
              <div className="text-[8px] text-yellow-300">Win Rate</div>
              <div className="text-sm font-bold text-yellow-400">{winRate}%</div>
            </div>
            <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 rounded-xl p-2 border border-purple-500/30">
              <div className="text-[8px] text-purple-300">Signals</div>
              <div className="text-sm font-bold text-purple-400">{activeSignals}/6</div>
            </div>
            <div className="bg-gradient-to-br from-orange-500/20 to-red-500/20 rounded-xl p-2 border border-orange-500/30">
              <div className="text-[8px] text-orange-300">Pending</div>
              <div className="text-sm font-bold text-orange-400">{pendingEntries}</div>
            </div>
          </div>

          {/* Settings */}
          <div className="grid grid-cols-4 gap-2">
            <div className="relative">
              <span className="absolute -top-1 left-2 text-[7px] text-green-400">Stake</span>
              <input 
                type="number" 
                value={globalStake} 
                onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
                className="w-full bg-white/5 border border-green-500/30 rounded-lg px-2 pt-3 pb-1 text-xs text-green-400 text-center"
                step="0.1"
                min="0.1"
              />
            </div>
            <div className="relative">
              <span className="absolute -top-1 left-2 text-[7px] text-blue-400">Multiplier</span>
              <input 
                type="number" 
                value={globalMultiplier} 
                onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
                className="w-full bg-white/5 border border-blue-500/30 rounded-lg px-2 pt-3 pb-1 text-xs text-blue-400 text-center"
                step="0.1"
                min="1.1"
              />
            </div>
            <div className="relative">
              <span className="absolute -top-1 left-2 text-[7px] text-red-400">Stop Loss</span>
              <input 
                type="number" 
                value={globalStopLoss} 
                onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
                className="w-full bg-white/5 border border-red-500/30 rounded-lg px-2 pt-3 pb-1 text-xs text-red-400 text-center"
              />
            </div>
            <div className="relative">
              <span className="absolute -top-1 left-2 text-[7px] text-green-400">Take Profit</span>
              <input 
                type="number" 
                value={globalTakeProfit} 
                onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
                className="w-full bg-white/5 border border-green-500/30 rounded-lg px-2 pt-3 pb-1 text-xs text-green-400 text-center"
              />
            </div>
          </div>

          {/* Scan Button */}
          <motion.button
            onClick={scanMarket}
            disabled={isScanning}
            className={`w-full mt-3 py-2 rounded-xl font-bold text-sm relative overflow-hidden ${
              isScanning 
                ? 'bg-gray-600 cursor-not-allowed' 
                : 'bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400'
            }`}
            whileHover={{ scale: isScanning ? 1 : 1.02 }}
            whileTap={{ scale: isScanning ? 1 : 0.98 }}
          >
            {isScanning ? (
              <div className="flex items-center justify-center">
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Scanning Markets... {scanProgress}%
              </div>
            ) : (
              <div className="flex items-center justify-center">
                <RefreshCw className="w-4 h-4 mr-2" />
                SCAN ALL MARKETS
              </div>
            )}
            {/* Scanning progress bar */}
            {isScanning && (
              <motion.div 
                className="absolute bottom-0 left-0 h-1 bg-gradient-to-r from-green-400 to-blue-400"
                initial={{ width: 0 }}
                animate={{ width: `${scanProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            )}
          </motion.button>
        </motion.div>

        {/* No Signal Message */}
        <AnimatePresence>
          {noSignal && !isScanning && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: -10 }} 
              className="mb-4"
            >
              <div className="bg-red-500/10 backdrop-blur-xl rounded-xl p-4 border border-red-500/30 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-2" />
                <h2 className="text-lg font-bold text-red-400 mb-1">NO SIGNAL FOUND</h2>
                <p className="text-xs text-gray-400">Click SCAN to analyze markets again</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active Signals Panel */}
        {marketSignals.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-3 mb-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
              <h3 className="text-xs font-semibold text-white">Active Signals ({marketSignals.filter(s => s.status === 'triggered').length}/{marketSignals.length})</h3>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {marketSignals.map((signal) => {
                const bot = BOT_STRATEGIES.find(b => b.id === signal.botId)!;
                const botState = bots.find(b => b.type === bot.type);
                const isPending = botState?.pendingEntry;
                
                return (
                  <motion.div 
                    key={`${signal.market}_${signal.botId}`} 
                    className={`rounded-lg p-2 ${
                      signal.status === 'triggered' 
                        ? isPending
                          ? 'bg-gradient-to-r from-yellow-500/20 to-amber-500/20 border border-yellow-500'
                          : 'bg-gradient-to-r from-green-500/20 to-emerald-500/20 border border-green-500'
                        : 'bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30'
                    }`}
                    whileHover={{ scale: 1.02 }}
                  >
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-blue-400">{getMarketDisplay(signal.market)}</span>
                      <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-bold ${
                        signal.status === 'triggered' 
                          ? isPending
                            ? 'bg-yellow-500 text-black'
                            : 'bg-green-500 text-white'
                          : 'bg-yellow-500 text-black'
                      }`}>
                        {signal.status === 'triggered' 
                          ? isPending ? 'NEXT TICK' : 'READY' 
                          : 'WAIT'}
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span className="text-gray-400">Bot: {signal.botName}</span>
                      <span className="text-gray-400">Last: <span className="font-mono text-white">{botState?.lastDigit ?? '—'}</span></span>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Bots Grid */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {bots.map((bot) => {
            const botStrategy = BOT_STRATEGIES.find(s => s.type === bot.type);
            const signal = marketSignals.find(s => s.botId === botStrategy?.id);
            const color = botStrategy?.color || 'gray';
            
            const colorClasses = {
              blue: 'from-blue-500/20 to-blue-600/20 border-blue-500/30',
              orange: 'from-orange-500/20 to-orange-600/20 border-orange-500/30',
              green: 'from-green-500/20 to-green-600/20 border-green-500/30',
              purple: 'from-purple-500/20 to-purple-600/20 border-purple-500/30',
              cyan: 'from-cyan-500/20 to-cyan-600/20 border-cyan-500/30',
              red: 'from-red-500/20 to-red-600/20 border-red-500/30'
            };
            
            return (
              <motion.div
                key={bot.id}
                className={`backdrop-blur-xl border rounded-xl p-2 ${
                  bot.pendingEntry
                    ? 'bg-gradient-to-br from-yellow-500/30 to-amber-500/30 border-yellow-500 ring-2 ring-yellow-500/50'
                    : bot.cycleActive
                      ? 'bg-gradient-to-br from-green-500/30 to-emerald-500/30 border-green-500 ring-2 ring-green-500/50'
                      : bot.signal 
                        ? `bg-gradient-to-br ${colorClasses[color as keyof typeof colorClasses]}`
                        : 'bg-white/5 border-white/10'
                }`}
                whileHover={{ scale: 1.02 }}
                animate={bot.pendingEntry ? {
                  boxShadow: ['0 0 0px rgba(234,179,8,0)', '0 0 12px rgba(234,179,8,0.7)', '0 0 0px rgba(234,179,8,0)'],
                } : bot.cycleActive ? {
                  boxShadow: ['0 0 0px rgba(34,197,94,0)', '0 0 12px rgba(34,197,94,0.7)', '0 0 0px rgba(34,197,94,0)'],
                } : {}}
                transition={{ duration: 1.5, repeat: bot.pendingEntry || bot.cycleActive ? Infinity : 0 }}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-1">
                    <div className={`p-1 rounded bg-${color}-500/30`}>
                      {botStrategy?.icon}
                    </div>
                    <span className="text-xs font-bold text-white">{bot.name}</span>
                    {bot.pendingEntry && (
                      <Zap className="w-3 h-3 text-yellow-400" />
                    )}
                    {bot.cycleActive && (
                      <Flame className="w-3 h-3 text-orange-400" />
                    )}
                  </div>
                  <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[6px] px-1 py-0 h-3">
                    {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-1 text-[8px] mb-1">
                  <div>
                    <span className="text-gray-400">Market:</span>
                    <span className="ml-1 text-blue-400">{bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : '—'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">Last:</span>
                    <span className="ml-1 font-mono text-white">{bot.lastDigit ?? '—'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400">P&L:</span>
                    <span className={`ml-1 ${bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''}`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-400">Stake:</span>
                    <span className="ml-1 text-yellow-400">${bot.currentStake.toFixed(2)}</span>
                  </div>
                </div>

                <div className="flex gap-1">
                  {!bot.isRunning ? (
                    <Button 
                      onClick={() => startBot(bot.id)} 
                      disabled={!bot.selectedMarket} 
                      size="sm" 
                      className={`flex-1 h-5 text-[8px] ${
                        bot.pendingEntry
                          ? 'bg-gradient-to-r from-yellow-500 to-amber-500 hover:from-yellow-400 hover:to-amber-400'
                          : bot.signal 
                            ? 'bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-400 hover:to-emerald-400'
                            : ''
                      }`}
                    >
                      {bot.pendingEntry ? 'EXECUTE' : (bot.signal ? 'TRADE' : 'START')}
                    </Button>
                  ) : (
                    <>
                      <Button onClick={() => pauseBot(bot.id)} size="sm" variant="outline" className="flex-1 h-5 text-[8px]">
                        {bot.isPaused ? 'RES' : 'PAU'}
                      </Button>
                      <Button onClick={() => stopBot(bot.id)} size="sm" variant="destructive" className="flex-1 h-5 text-[8px]">
                        STOP
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Trade Log */}
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-xl p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-green-400" />
              <h3 className="text-xs font-semibold text-white">Trade History</h3>
            </div>
            {pendingEntries > 0 && (
              <motion.div 
                className="text-[8px] bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded-full"
                animate={{ opacity: [1, 0.7, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              >
                {pendingEntries} pending execution
              </motion.div>
            )}
          </div>
          
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {trades.length === 0 ? (
              <p className="text-[10px] text-center py-4 text-gray-500">No trades yet</p>
            ) : (
              trades.map((trade, idx) => (
                <motion.div 
                  key={idx} 
                  className="grid grid-cols-7 gap-1 text-[9px] py-1 px-2 border-b border-white/10 last:border-0 hover:bg-white/5 rounded"
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <span className="text-gray-400">{trade.time.slice(-5)}</span>
                  <span className="font-bold text-blue-400">{getMarketDisplay(trade.market)}</span>
                  <span className="text-center text-yellow-400">${trade.stake.toFixed(2)}</span>
                  <span className="text-center font-mono">
                    <span className="text-yellow-400">{trade.entryDigit}</span>
                    {trade.exitDigit && (
                      <>
                        <span className="text-gray-500 mx-0.5">→</span>
                        <span className={trade.result === 'Win' ? 'text-profit' : 'text-loss'}>
                          {trade.exitDigit}
                        </span>
                      </>
                    )}
                  </span>
                  <span className="text-center text-[7px] uppercase text-gray-400">
                    {trade.contract}
                  </span>
                  <span className={`text-right font-mono ${
                    trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                  }`}>
                    {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                     trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                     '...'}
                  </span>
                  {trade.result === 'Win' ? (
                    <CheckCircle2 className="w-3 h-3 text-profit" />
                  ) : trade.result === 'Loss' ? (
                    <AlertCircle className="w-3 h-3 text-loss" />
                  ) : (
                    <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
                  )}
                </motion.div>
              ))
            )}
          </div>
        </motion.div>

        {/* Footer Stats */}
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="grid grid-cols-4 gap-2 mt-2 text-[8px]"
        >
          <div className="bg-white/5 backdrop-blur rounded-lg p-1 text-center text-gray-400">
            Total Trades: {totalTrades}
          </div>
          <div className="bg-white/5 backdrop-blur rounded-lg p-1 text-center text-gray-400">
            Wins: {totalWins} | Losses: {totalTrades - totalWins}
          </div>
          <div className="bg-white/5 backdrop-blur rounded-lg p-1 text-center text-gray-400">
            Auto: {autoTradeEnabled ? 'ON' : 'OFF'}
          </div>
          <div className="bg-white/5 backdrop-blur rounded-lg p-1 text-center text-gray-400">
            Cycle: {masterCycleActive ? 'ACTIVE' : 'IDLE'}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
