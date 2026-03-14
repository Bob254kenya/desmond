import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, Trash2, DollarSign, Sparkles, Scan, Volume2, 
  AlertTriangle, CheckCircle2, Clock, Radio, Activity, 
  BarChart3, Gauge, Zap, Shield, Target, Eye, Users,
  Wallet, PieChart, TrendingUp as TrendUp, TrendingDown as TrendDown,
  ChevronRight, ChevronLeft, Maximize2, Minimize2, Settings,
  Award, Medal, Crown, Flame, ZapOff
} from 'lucide-react';

// Types (keeping your existing types)
interface DigitAnalysis {
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  evenCount: number;
  oddCount: number;
  lastDigit: number;
  previousDigit: number;
}

interface BotSignal {
  id: string;
  market: string;
  botType: BotType;
  status: 'waiting_entry' | 'entry_triggered' | 'trading' | 'cooldown';
  entryCondition: boolean;
  analysis: DigitAnalysis;
  timestamp: number;
}

interface BotState {
  id: string;
  name: string;
  type: BotType;
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
}

type BotType = 'over1' | 'under8' | 'even' | 'odd' | 'over3' | 'under6';

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
}

interface ScannedMarket {
  name: string;
  digits: number[];
  analysis: DigitAnalysis;
  signals: BotType[];
}

// Constants
const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  'RDBEAR', 'RDBULL'
];

const BOT_CONFIGS: Record<BotType, { name: string; contractType: string; barrier?: number; entryCheck: (digits: number[]) => boolean; marketCheck: (analysis: DigitAnalysis) => boolean; color: string; icon: any }> = {
  over1: {
    name: 'OVER 1 BOT',
    contractType: 'DIGITOVER',
    barrier: 1,
    entryCheck: (digits) => digits.length >= 2 && digits.slice(-2).every(d => d <= 1),
    marketCheck: (analysis) => analysis.mostAppearing > 4 && analysis.secondMost > 4 && analysis.leastAppearing > 4,
    color: 'blue',
    icon: TrendingUp
  },
  under8: {
    name: 'UNDER 8 BOT',
    contractType: 'DIGITUNDER',
    barrier: 8,
    entryCheck: (digits) => digits.length >= 2 && digits.slice(-2).every(d => d >= 8),
    marketCheck: (analysis) => analysis.mostAppearing < 6 && analysis.secondMost < 6 && analysis.leastAppearing < 6,
    color: 'orange',
    icon: TrendingDown
  },
  even: {
    name: 'EVEN BOT',
    contractType: 'DIGITEVEN',
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d % 2 === 1),
    marketCheck: (analysis) => analysis.mostAppearing % 2 === 0 && analysis.secondMost % 2 === 0 && analysis.leastAppearing % 2 === 0,
    color: 'green',
    icon: CircleDot
  },
  odd: {
    name: 'ODD BOT',
    contractType: 'DIGITODD',
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d % 2 === 0),
    marketCheck: (analysis) => analysis.mostAppearing % 2 === 1 && analysis.secondMost % 2 === 1 && analysis.thirdMost % 2 === 1,
    color: 'purple',
    icon: CircleDot
  },
  over3: {
    name: 'OVER 3 BOT',
    contractType: 'DIGITOVER',
    barrier: 3,
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d <= 2),
    marketCheck: (analysis) => analysis.mostAppearing > 4 && analysis.secondMost > 4 && analysis.leastAppearing > 4,
    color: 'cyan',
    icon: TrendingUp
  },
  under6: {
    name: 'UNDER 6 BOT',
    contractType: 'DIGITUNDER',
    barrier: 6,
    entryCheck: (digits) => digits.length >= 3 && digits.slice(-3).every(d => d >= 7),
    marketCheck: (analysis) => analysis.mostAppearing < 5 && analysis.secondMost < 5 && analysis.leastAppearing < 5,
    color: 'red',
    icon: TrendingDown
  }
};

// Voice alert system
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private speech: SpeechSynthesisUtterance | null = null;
  private lastScanMessage: number = 0;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.speech = new SpeechSynthesisUtterance();
      this.speech.rate = 0.9;
      this.speech.pitch = 0.8;
      this.speech.volume = 0.7;
    }
  }

  static getInstance() {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  speak(text: string) {
    if (!this.speech || typeof window === 'undefined') return;
    window.speechSynthesis.cancel();
    this.speech.text = text;
    window.speechSynthesis.speak(this.speech);
  }

  scanAlert() {
    const now = Date.now();
    if (now - this.lastScanMessage > 20000) {
      this.speak("Scanning the markets for money... stay ready.");
      this.lastScanMessage = now;
    }
  }

  signalFound() {
    this.speak("Signal found. Prepare to trade.");
  }
}

// Digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < 1000) return {} as DigitAnalysis;
  
  const last1000 = digits.slice(-1000);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last1000.forEach(d => counts[d]++);
  
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  
  return {
    mostAppearing: sortedDigits[0],
    secondMost: sortedDigits[1],
    thirdMost: sortedDigits[2],
    leastAppearing: sortedDigits[9],
    evenCount,
    oddCount,
    lastDigit: digits[digits.length - 1] || 0,
    previousDigit: digits[digits.length - 2] || 0
  };
};

// Background Animation Component
const BackgroundEffects = () => (
  <>
    {/* Gradient Orbs */}
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div className="absolute -top-40 -right-40 w-80 h-80 bg-green-500/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl animate-pulse delay-1000" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl animate-pulse delay-700" />
    </div>

    {/* Floating Dollar Signs */}
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-green-500/10"
          initial={{
            x: Math.random() * window.innerWidth,
            y: window.innerHeight + 100,
            rotate: Math.random() * 360,
            scale: Math.random() * 0.5 + 0.3,
          }}
          animate={{
            y: -100,
            rotate: Math.random() * 720,
            x: `calc(${Math.random() * 100}vw + ${Math.sin(i) * 50}px)`,
          }}
          transition={{
            duration: Math.random() * 20 + 15,
            repeat: Infinity,
            ease: "linear",
            delay: Math.random() * 10,
          }}
        >
          <DollarSign className="w-12 h-12" />
        </motion.div>
      ))}
    </div>

    {/* Grid Pattern */}
    <div className="fixed inset-0 bg-[url('data:image/svg+xml,%3Csvg width="60" height="60" viewBox="0 0 60 60" xmlns="http://www.w3.org/2000/svg"%3E%3Cpath d="M0 0h60v60H0z" fill="none" stroke="%2322c55e" stroke-width="0.5" stroke-opacity="0.1"/%3E%3C/svg%3E')] pointer-events-none" />
  </>
);

// Signal Card Component
const SignalCard = ({ signal, onAssign }: { signal: BotSignal; onAssign: (signal: BotSignal) => void }) => {
  const config = BOT_CONFIGS[signal.botType];
  const Icon = config.icon;
  
  const colorClasses = {
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400',
    orange: 'from-orange-500/20 to-orange-600/10 border-orange-500/30 text-orange-400',
    green: 'from-green-500/20 to-green-600/10 border-green-500/30 text-green-400',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400',
    cyan: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30 text-cyan-400',
    red: 'from-red-500/20 to-red-600/10 border-red-500/30 text-red-400',
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02, y: -2 }}
      className={`bg-gradient-to-br ${colorClasses[config.color as keyof typeof colorClasses]} backdrop-blur-xl rounded-xl p-4 shadow-2xl border`}
    >
      <div className="flex items-center justify-between mb-3">
        <Badge variant="outline" className="bg-black/50 text-white border-white/20">
          {signal.market}
        </Badge>
        <Badge className={`bg-${config.color}-500/20 text-${config.color}-400 border-${config.color}-500/30`}>
          <Icon className="w-3 h-3 mr-1" />
          {config.name}
        </Badge>
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between items-center">
          <span className="text-white/60">Status:</span>
          <span className={signal.status === 'waiting_entry' ? 'text-yellow-400' : 'text-green-400'}>
            {signal.status === 'waiting_entry' ? '⏳ WAITING' : '✅ READY'}
          </span>
        </div>
        
        <div className="grid grid-cols-2 gap-2 text-xs bg-black/30 rounded-lg p-2">
          <div>
            <span className="text-white/50">Most:</span>
            <span className="ml-1 text-white font-bold">{signal.analysis.mostAppearing}</span>
          </div>
          <div>
            <span className="text-white/50">2nd:</span>
            <span className="ml-1 text-white font-bold">{signal.analysis.secondMost}</span>
          </div>
          <div>
            <span className="text-white/50">3rd:</span>
            <span className="ml-1 text-white font-bold">{signal.analysis.thirdMost}</span>
          </div>
          <div>
            <span className="text-white/50">Least:</span>
            <span className="ml-1 text-white font-bold">{signal.analysis.leastAppearing}</span>
          </div>
        </div>
        
        <div className="flex justify-between text-xs bg-black/20 rounded-lg p-2">
          <span className="text-white/60">Last Digit:</span>
          <span className="font-mono text-white font-bold">{signal.analysis.lastDigit}</span>
          <span className="text-white/60">Previous:</span>
          <span className="font-mono text-white font-bold">{signal.analysis.previousDigit}</span>
        </div>
      </div>
      
      <Button
        onClick={() => onAssign(signal)}
        className={`w-full mt-3 bg-${config.color}-500/20 hover:bg-${config.color}-500/30 text-white border border-${config.color}-500/30`}
        size="sm"
      >
        <Play className="w-3 h-3 mr-1" /> Assign to Bot
      </Button>
    </motion.div>
  );
};

// Main Component
export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanTimeRemaining, setScanTimeRemaining] = useState(30);
  const [scanStatus, setScanStatus] = useState('');
  const [currentScanningMarket, setCurrentScanningMarket] = useState('');
  const [scannedMarkets, setScannedMarkets] = useState<ScannedMarket[]>([]);
  const [signals, setSignals] = useState<BotSignal[]>([]);
  const [marketDigits, setMarketDigits] = useState<Record<string, number[]>>({});
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [showMarketSelector, setShowMarketSelector] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  
  // Bot states
  const [bots, setBots] = useState<BotState[]>(
    Object.entries(BOT_CONFIGS).map(([type, config], index) => ({
      id: `bot${index + 1}`,
      name: config.name,
      type: type as BotType,
      isRunning: false,
      isPaused: false,
      currentStake: 0.5,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      contractType: config.contractType,
      barrier: config.barrier,
      status: 'idle',
      consecutiveLosses: 0,
      entryTriggered: false,
      cooldownRemaining: 0,
      recoveryMode: false,
      signal: false
    }))
  );

  // Settings
  const [globalStake, setGlobalStake] = useState(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState(2);
  const [globalStopLoss, setGlobalStopLoss] = useState(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState(5);
  
  // Trade log
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});
  const voiceSystem = VoiceAlertSystem.getInstance();
  const scanTimerRef = useRef<NodeJS.Timeout>();

  // Fetch ticks for a market
  const fetchMarketTicks = async (market: string): Promise<number[]> => {
    try {
      const ticks = await derivApi.getTicks(market, 1000);
      return ticks.map((t: any) => Math.floor(t.quote) % 10);
    } catch (error) {
      console.error(`Failed to fetch ticks for ${market}:`, error);
      return [];
    }
  };

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
      }
    };
  }, []);

  // Scan all markets
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    setScanTimeRemaining(30);
    setSignals([]);
    setScannedMarkets([]);
    setShowMarketSelector(false);
    
    const newSignals: BotSignal[] = [];
    const scannedList: ScannedMarket[] = [];
    const totalMarkets = VOLATILITY_MARKETS.length;
    const digitsRecord: Record<string, number[]> = {};
    
    // Start 30-second timer
    const startTime = Date.now();
    scanTimerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = Math.max(0, 30 - elapsed);
      setScanTimeRemaining(remaining);
      
      if (remaining <= 0) {
        clearInterval(scanTimerRef.current);
      }
    }, 100);
    
    try {
      for (let i = 0; i < VOLATILITY_MARKETS.length; i++) {
        const market = VOLATILITY_MARKETS[i];
        setCurrentScanningMarket(market);
        setScanStatus(`Scanning ${market}... (${i + 1}/${totalMarkets})`);
        setScanProgress(((i + 1) / totalMarkets) * 100);
        
        // Voice alert every 20 seconds
        if (i % 4 === 0) voiceSystem.scanAlert();
        
        const digits = await fetchMarketTicks(market);
        if (digits.length >= 1000) {
          digitsRecord[market] = digits;
          const analysis = analyzeDigits(digits);
          
          const marketSignals: BotType[] = [];
          
          for (const [botType, config] of Object.entries(BOT_CONFIGS)) {
            if (config.marketCheck(analysis)) {
              marketSignals.push(botType as BotType);
              
              newSignals.push({
                id: `${market}-${botType}-${Date.now()}`,
                market,
                botType: botType as BotType,
                status: 'waiting_entry',
                entryCondition: config.entryCheck(digits),
                analysis,
                timestamp: Date.now()
              });
            }
          }
          
          scannedList.push({
            name: market,
            digits,
            analysis,
            signals: marketSignals
          });
        }
        
        await new Promise(r => setTimeout(r, 100));
      }
      
      // Ensure we wait for full 30 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed < 30000) {
        await new Promise(r => setTimeout(r, 30000 - elapsed));
      }
      
      setMarketDigits(digitsRecord);
      setScannedMarkets(scannedList);
      setSignals(newSignals);
      setShowMarketSelector(true);
      
      if (newSignals.length > 0) {
        voiceSystem.signalFound();
        toast.success(`Found ${newSignals.length} trading signals!`);
      } else {
        toast.info('No signals found in any market.');
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed. Please try again.');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      setScanStatus('');
      setCurrentScanningMarket('');
      if (scanTimerRef.current) {
        clearInterval(scanTimerRef.current);
      }
    }
  }, [isScanning]);

  // Assign signal to bot
  const assignSignalToBot = (signal: BotSignal) => {
    const availableBot = bots.find(b => !b.isRunning && !b.selectedMarket);
    if (!availableBot) {
      toast.error('No available bots. Stop a running bot first.');
      return;
    }
    
    setBots(prev => prev.map(b => 
      b.id === availableBot.id ? {
        ...b,
        selectedMarket: signal.market,
        status: 'waiting'
      } : b
    ));
    
    toast.success(`Assigned ${signal.market} to ${availableBot.name}`);
  };

  // Wait for next tick
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

  // Run bot logic
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized || !bot.selectedMarket) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
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
    const config = BOT_CONFIGS[bot.type];

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

      const marketDigitsList = marketDigits[currentMarket] || [];
      const currentSignal = config.entryCheck(marketDigitsList);

      setBots(prev => prev.map(b => b.id === botId ? { ...b, signal: currentSignal } : b));

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
          lastDigit: marketDigitsList[marketDigitsList.length - 1]
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
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots, marketDigits]);

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

  const clearAll = () => {
    setTrades([]);
    setSignals([]);
    setScannedMarkets([]);
    setShowMarketSelector(false);
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

  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `⚡ ${market}`;
    if (market.startsWith('R_')) return `📈 ${market}`;
    if (market.startsWith('BOOM')) return `💥 ${market}`;
    if (market.startsWith('CRASH')) return `📉 ${market}`;
    if (market.startsWith('JD')) return `🦘 ${market}`;
    if (market === 'RDBEAR') return '🐻 Bear Market';
    if (market === 'RDBULL') return '🐂 Bull Market';
    return market;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white relative overflow-x-hidden">
      <BackgroundEffects />

      {/* Main Container - Full Width with Responsive Padding */}
      <div className="relative z-10 w-full min-h-screen px-2 sm:px-4 md:px-6 lg:px-8 py-4 sm:py-6">
        
        {/* Header - Full Width */}
        <motion.div 
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full mb-4 sm:mb-6"
        >
          <div className="bg-gray-800/40 backdrop-blur-xl border border-green-500/30 rounded-2xl p-4 sm:p-6 shadow-2xl">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg">
                  <BarChart3 className="w-6 h-6 sm:w-8 sm:h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-xl sm:text-2xl md:text-3xl font-bold bg-gradient-to-r from-green-400 via-green-500 to-yellow-400 bg-clip-text text-transparent">
                    Auto Trade Scanner
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-400">Real-time market analysis & automated trading</p>
                </div>
              </div>
              
              {/* Balance Display */}
              <div className="flex items-center gap-2 sm:gap-4">
                <div className="bg-black/40 backdrop-blur border border-green-500/30 rounded-xl px-4 py-2">
                  <div className="text-xs text-gray-400">Available Balance</div>
                  <div className="text-lg sm:text-xl font-bold text-green-400 flex items-center gap-1">
                    <DollarSign className="w-4 h-4" />
                    {balance?.toFixed(2) || '0.00'}
                  </div>
                </div>
                
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                  className="border-green-500/30 text-green-400 hover:bg-green-500/20"
                >
                  {isSidebarOpen ? <Maximize2 className="w-4 h-4" /> : <Minimize2 className="w-4 h-4" />}
                </Button>
              </div>
            </div>
          </div>
        </motion.div>

        {/* Stats Grid - Full Width */}
        <motion.div 
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3 mb-4 sm:mb-6"
        >
          {[
            { label: 'Total P&L', value: `$${totalProfit.toFixed(2)}`, color: totalProfit >= 0 ? 'text-green-400' : 'text-red-400', icon: Wallet },
            { label: 'Win Rate', value: `${winRate}%`, color: 'text-yellow-400', icon: Target },
            { label: 'Total Trades', value: totalTrades.toString(), color: 'text-blue-400', icon: Activity },
            { label: 'Active Bots', value: `${bots.filter(b => b.isRunning).length}/6`, color: 'text-purple-400', icon: Gauge },
            { label: 'Signals', value: signals.length.toString(), color: 'text-pink-400', icon: Zap },
            { label: 'Markets', value: scannedMarkets.length.toString(), color: 'text-cyan-400', icon: Users },
          ].map((stat, i) => {
            const Icon = stat.icon;
            return (
              <motion.div
                key={i}
                whileHover={{ scale: 1.02, y: -2 }}
                className="bg-gray-800/40 backdrop-blur border border-gray-700/50 rounded-xl p-2 sm:p-3"
              >
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg bg-${stat.color.split('-')[1]}-500/20`}>
                    <Icon className={`w-3 h-3 ${stat.color}`} />
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">{stat.label}</div>
                    <div className={`text-sm sm:text-base font-bold ${stat.color}`}>{stat.value}</div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </motion.div>

        {/* Scanner Section - Full Width */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full mb-4 sm:mb-6"
        >
          <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 backdrop-blur-xl border-2 border-green-500/30 rounded-2xl p-4 sm:p-8 shadow-2xl">
            <div className="flex flex-col items-center space-y-4 sm:space-y-6">
              
              {/* Scanner Title */}
              <div className="text-center space-y-2">
                <h2 className="text-xl sm:text-2xl font-bold text-green-400 flex items-center justify-center gap-2 flex-wrap">
                  <Radio className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
                  Market Scanner Control
                  <Activity className="w-5 h-5 sm:w-6 sm:h-6 animate-pulse" />
                </h2>
                <p className="text-xs sm:text-sm text-gray-400">Click to scan all 25+ markets for trading opportunities (30 seconds)</p>
              </div>

              {/* Main Scanner Button Container */}
              <div className="relative w-full max-w-md mx-auto">
                {/* Animated Rings */}
                {!isScanning && !showMarketSelector && (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="absolute inset-0 rounded-full bg-green-500/30 blur-2xl"
                    />
                    <motion.div
                      animate={{ scale: [1, 1.2, 1], opacity: [0.2, 0.4, 0.2] }}
                      transition={{ duration: 2, repeat: Infinity, delay: 0.5 }}
                      className="absolute inset-0 rounded-full bg-yellow-500/20 blur-xl"
                    />
                  </>
                )}

                {/* Scan Button */}
                <Button
                  onClick={scanAllMarkets}
                  disabled={isScanning}
                  className="relative w-40 h-40 sm:w-48 sm:h-48 mx-auto rounded-full text-white font-bold text-lg sm:text-xl shadow-2xl transition-all duration-300"
                  style={{
                    background: isScanning 
                      ? 'linear-gradient(135deg, #059669 0%, #d97706 100%)'
                      : 'linear-gradient(135deg, #10b981 0%, #f59e0b 100%)'
                  }}
                >
                  <div className="absolute inset-2 rounded-full bg-gray-900 flex items-center justify-center">
                    {isScanning ? (
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 sm:w-12 sm:h-12 animate-spin mx-auto mb-2 text-green-400" />
                        <span className="text-xs sm:text-sm text-green-400">SCANNING</span>
                        <span className="block text-xs text-yellow-400 mt-1 font-mono">{scanTimeRemaining}s</span>
                      </div>
                    ) : showMarketSelector ? (
                      <div className="text-center">
                        <CheckCircle2 className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-2 text-green-400" />
                        <span className="text-xs sm:text-sm text-green-400">SCAN</span>
                        <span className="block text-xs text-gray-400 mt-1">COMPLETE</span>
                      </div>
                    ) : (
                      <div className="text-center">
                        <Scan className="w-8 h-8 sm:w-12 sm:h-12 mx-auto mb-2 text-green-400" />
                        <span className="text-xs sm:text-sm text-green-400">START</span>
                        <span className="block text-xs text-gray-400 mt-1">30s SCAN</span>
                      </div>
                    )}
                  </div>
                </Button>
              </div>

              {/* Progress Bar - Full Width */}
              {isScanning && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-2xl mx-auto space-y-3"
                >
                  <div className="flex flex-col sm:flex-row justify-between items-center gap-2 text-sm">
                    <span className="text-green-400 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {currentScanningMarket}
                    </span>
                    <span className="text-yellow-400 font-mono">{Math.round(scanProgress)}%</span>
                  </div>
                  
                  <div className="relative h-4 sm:h-6 bg-gray-700/50 rounded-full overflow-hidden border border-green-500/30">
                    <motion.div 
                      className="absolute inset-y-0 left-0 bg-gradient-to-r from-green-400 via-yellow-400 to-green-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${scanProgress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>

                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Time remaining
                    </span>
                    <span className="text-green-400 font-mono font-bold">{scanTimeRemaining}s</span>
                  </div>
                </motion.div>
              )}

              {/* Scan Results Summary */}
              {showMarketSelector && !isScanning && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full max-w-4xl mx-auto"
                >
                  <div className="bg-gray-900/50 backdrop-blur border border-green-500/30 rounded-xl p-4">
                    <h3 className="text-base sm:text-lg font-semibold text-green-400 mb-3 flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 sm:w-5 sm:h-5" />
                      Scan Complete - Markets Ready for Selection
                    </h3>
                    
                    <div className="grid grid-cols-3 gap-2 sm:gap-3">
                      <div className="text-center p-2 sm:p-3 bg-gray-800/50 rounded-lg">
                        <div className="text-xl sm:text-2xl font-bold text-green-400">{scannedMarkets.length}</div>
                        <div className="text-xs text-gray-400">Markets</div>
                      </div>
                      <div className="text-center p-2 sm:p-3 bg-gray-800/50 rounded-lg">
                        <div className="text-xl sm:text-2xl font-bold text-yellow-400">{signals.length}</div>
                        <div className="text-xs text-gray-400">Signals</div>
                      </div>
                      <div className="text-center p-2 sm:p-3 bg-gray-800/50 rounded-lg">
                        <div className="text-xl sm:text-2xl font-bold text-purple-400">
                          {scannedMarkets.filter(m => m.signals.length > 0).length}
                        </div>
                        <div className="text-xs text-gray-400">Active</div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>

        {/* Market Selector - Full Width */}
        <AnimatePresence>
          {showMarketSelector && !isScanning && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="w-full mb-4 sm:mb-6"
            >
              <div className="bg-gray-800/40 backdrop-blur-xl border border-green-500/30 rounded-xl p-3 sm:p-4">
                <h2 className="text-base sm:text-lg font-semibold mb-3 text-green-400 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
                  Available Markets ({scannedMarkets.length})
                </h2>
                
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2 max-h-96 overflow-y-auto p-2">
                  {scannedMarkets.map((market) => (
                    <motion.button
                      key={market.name}
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => toast.info(`Selected ${getMarketDisplay(market.name)}`)}
                      className={`p-2 sm:p-3 rounded-lg border transition-all ${
                        market.signals.length > 0
                          ? 'bg-green-500/10 border-green-500/30 hover:bg-green-500/20'
                          : 'bg-gray-700/30 border-gray-600/30 hover:bg-gray-600/40'
                      }`}
                    >
                      <div className="text-xs font-mono truncate">{getMarketDisplay(market.name)}</div>
                      {market.signals.length > 0 && (
                        <Badge className="mt-1 bg-green-500/20 text-green-400 text-[8px] sm:text-[10px] border-green-500/30">
                          {market.signals.length} signal{market.signals.length > 1 ? 's' : ''}
                        </Badge>
                      )}
                    </motion.button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Settings Panel - Full Width */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full mb-4 sm:mb-6"
        >
          <div className="bg-gray-800/40 backdrop-blur-xl border border-green-500/30 rounded-xl p-3 sm:p-4">
            <h2 className="text-base sm:text-lg font-semibold mb-3 text-green-400 flex items-center gap-2">
              <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
              Global Settings
            </h2>
            
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
              {[
                { label: 'Stake ($)', value: globalStake, setter: setGlobalStake, step: '0.1', min: '0.1' },
                { label: 'Multiplier', value: globalMultiplier, setter: setGlobalMultiplier, step: '0.1', min: '1.1' },
                { label: 'Stop Loss ($)', value: globalStopLoss, setter: setGlobalStopLoss, step: '1', min: '1' },
                { label: 'Take Profit ($)', value: globalTakeProfit, setter: setGlobalTakeProfit, step: '1', min: '1' },
              ].map((setting, i) => (
                <div key={i} className="space-y-1">
                  <label className="text-xs text-gray-400">{setting.label}</label>
                  <input 
                    type="number" 
                    value={setting.value} 
                    onChange={(e) => setting.setter(parseFloat(e.target.value) || 0.5)}
                    className="w-full bg-gray-900/50 border border-green-500/30 rounded-lg px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm text-green-400 focus:outline-none focus:border-green-400"
                    step={setting.step}
                    min={setting.min}
                  />
                </div>
              ))}
            </div>
            
            <div className="flex flex-wrap justify-end gap-2 mt-3">
              <Button variant="outline" size="sm" onClick={clearAll} className="border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs sm:text-sm">
                <Trash2 className="w-3 h-3 mr-1" /> Clear All
              </Button>
              <Button variant="outline" size="sm" onClick={stopAllBots} className="border-red-500/30 text-red-400 hover:bg-red-500/20 text-xs sm:text-sm">
                <StopCircle className="w-3 h-3 mr-1" /> Stop All Bots
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Signals Grid - Full Width */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full mb-4 sm:mb-6"
        >
          <h2 className="text-base sm:text-lg font-semibold mb-3 text-green-400 flex items-center gap-2">
            <Sparkles className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
            Trading Signals
            {signals.length > 0 && (
              <Badge className="bg-green-500/20 text-green-400 text-xs">{signals.length} active</Badge>
            )}
          </h2>
          
          {signals.length === 0 ? (
            <div className="bg-gray-800/40 backdrop-blur border border-green-500/30 rounded-xl p-6 sm:p-8 text-center">
              <AlertTriangle className="w-10 h-10 sm:w-12 sm:h-12 text-yellow-400/50 mx-auto mb-3" />
              <p className="text-sm sm:text-base text-gray-400">NO SIGNAL FOUND</p>
              <p className="text-xs sm:text-sm text-gray-500 mt-2">Click the SCAN button to analyze all markets</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              {signals.map(signal => (
                <SignalCard key={signal.id} signal={signal} onAssign={assignSignalToBot} />
              ))}
            </div>
          )}
        </motion.div>

        {/* Bots Grid - Full Width */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full mb-4 sm:mb-6"
        >
          <h2 className="text-base sm:text-lg font-semibold mb-3 text-green-400">🤖 Trading Bots</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {bots.map((bot, index) => {
              const config = BOT_CONFIGS[bot.type];
              const Icon = config.icon;
              
              const colorClasses = {
                blue: 'border-blue-500/30 ring-blue-400/20',
                orange: 'border-orange-500/30 ring-orange-400/20',
                green: 'border-green-500/30 ring-green-400/20',
                purple: 'border-purple-500/30 ring-purple-400/20',
                cyan: 'border-cyan-500/30 ring-cyan-400/20',
                red: 'border-red-500/30 ring-red-400/20',
              };
              
              return (
                <motion.div
                  key={bot.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.1 }}
                  className={`bg-gray-800/40 backdrop-blur-xl border rounded-xl p-3 sm:p-4 shadow-xl ${
                    bot.isRunning ? `border-${config.color}-400 ring-2 ring-${config.color}-400/20` : 'border-gray-700/50'
                  } ${bot.signal ? `ring-2 ring-yellow-500/50` : ''}`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 sm:p-2 rounded-lg bg-${config.color}-500/20 text-${config.color}-400`}>
                        <Icon className="w-3 h-3 sm:w-4 sm:h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xs sm:text-sm">{bot.name}</h3>
                        <p className="text-[10px] sm:text-xs text-gray-400 truncate max-w-[100px] sm:max-w-[150px]">
                          {bot.selectedMarket ? getMarketDisplay(bot.selectedMarket) : 'No market'}
                        </p>
                      </div>
                    </div>
                    <Badge className={bot.isRunning ? 'bg-green-500/20 text-green-400 text-[10px]' : 'bg-gray-500/20 text-gray-400 text-[10px]'}>
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-2 gap-1 sm:gap-2 text-xs mb-3">
                    <div>
                      <span className="text-gray-400">P&L:</span>
                      <span className={`ml-1 font-mono ${
                        bot.totalPnl > 0 ? 'text-green-400' : bot.totalPnl < 0 ? 'text-red-400' : 'text-gray-400'
                      }`}>
                        ${bot.totalPnl.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">W/L:</span>
                      <span className="ml-1 font-mono">
                        <span className="text-green-400">{bot.wins}</span>
                        <span className="text-gray-400">/</span>
                        <span className="text-red-400">{bot.losses}</span>
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Stake:</span>
                      <span className="ml-1 font-mono text-green-400">${bot.currentStake.toFixed(2)}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Status:</span>
                      <span className={`ml-1 ${
                        bot.status === 'trading' ? 'text-green-400' :
                        bot.status === 'waiting' ? 'text-yellow-400' :
                        bot.status === 'cooldown' ? 'text-purple-400' :
                        'text-gray-400'
                      }`}>
                        {bot.status === 'cooldown' ? `${bot.cooldownRemaining}s` : bot.status}
                      </span>
                    </div>
                  </div>

                  {bot.signal && (
                    <div className="mb-3 p-2 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                      <p className="text-[10px] sm:text-xs text-yellow-400 text-center animate-pulse">
                        ⚡ ENTRY SIGNAL DETECTED ⚡
                      </p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {!bot.isRunning ? (
                      <Button
                        onClick={() => startBot(bot.id)}
                        disabled={!isAuthorized || !bot.selectedMarket}
                        className="flex-1 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30 text-xs py-1 h-8"
                        size="sm"
                      >
                        <Play className="w-3 h-3 mr-1" /> Start
                      </Button>
                    ) : (
                      <>
                        <Button
                          onClick={() => pauseBot(bot.id)}
                          variant="outline"
                          className="flex-1 border-green-500/30 text-green-400 hover:bg-green-500/20 text-xs py-1 h-8"
                          size="sm"
                        >
                          <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                        </Button>
                        <Button
                          onClick={() => stopBot(bot.id)}
                          variant="destructive"
                          className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 border border-red-500/30 text-xs py-1 h-8"
                          size="sm"
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
        </motion.div>

        {/* Trade Log - Full Width */}
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="w-full"
        >
          <div className="bg-gray-800/40 backdrop-blur-xl border border-green-500/30 rounded-xl p-3 sm:p-4">
            <h2 className="text-base sm:text-lg font-semibold mb-3 text-green-400">📋 Live Trade Log</h2>
            <div className="space-y-2 max-h-80 sm:max-h-96 overflow-y-auto">
              {trades.length === 0 ? (
                <p className="text-center text-gray-400 py-6 sm:py-8 text-sm">No trades yet</p>
              ) : (
                trades.map((trade, idx) => (
                  <motion.div 
                    key={idx} 
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.02 }}
                    className="flex flex-col sm:flex-row sm:items-center justify-between text-xs sm:text-sm py-2 px-2 sm:px-3 bg-gray-900/50 rounded-lg border border-green-500/10 gap-2"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-gray-400">{trade.time}</span>
                      <Badge variant="outline" className="border-green-500/30 text-green-400 text-[10px]">
                        {trade.bot}
                      </Badge>
                      <span className="text-gray-300 text-[10px] sm:text-xs">{getMarketDisplay(trade.market)}</span>
                    </div>
                    <div className="flex items-center justify-between sm:justify-end gap-2 sm:gap-4">
                      <span className="font-mono text-green-400 text-xs">${trade.stake.toFixed(2)}</span>
                      <span className={`font-mono text-xs sm:text-sm w-16 sm:w-20 text-right ${
                        trade.result === 'Win' ? 'text-green-400' : 
                        trade.result === 'Loss' ? 'text-red-400' : 'text-yellow-400'
                      }`}>
                        {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                         trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                         'Pending'}
                      </span>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
      }
