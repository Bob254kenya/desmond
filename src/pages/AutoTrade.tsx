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
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Play, StopCircle, TrendingUp, TrendingDown, CircleDot, RefreshCw, 
  Loader2, Activity, Target, AlertCircle, CheckCircle2, Clock, Hash,
  Zap, Gauge, Volume2, VolumeX, Timer, XCircle, Settings, ChevronDown,
  ChevronUp, DollarSign, Percent, Plus, Minus, BarChart3, LineChart,
  Brain, Scan, Trash2, Download, Upload, Copy, Eye, EyeOff, Rocket,
  Flame, Snowflake, Wind, Sun, Moon, Cloud, Droplets, Award, Star,
  AlertTriangle, Info, FileText, History, TrendingUpDown, Sigma,
  ArrowUp, ArrowDown, MinusCircle, PlusCircle, CheckCheck, ListChecks
} from 'lucide-react';

// ==================== TYPES ====================

interface DigitAnalysis {
  symbol: string;
  counts: {
    [key: number]: number;
  };
  percentages: {
    [key: number]: number;
    low012: number;      // 0,1,2 combined
    high789: number;     // 7,8,9 combined
    even: number;        // Even digits (0,2,4,6,8)
    odd: number;         // Odd digits (1,3,5,7,9)
  };
  mostFrequent: {
    digit: number;
    percentage: number;
  };
  leastFrequent: {
    digit: number;
    percentage: number;
  };
  conditions: {
    low012: boolean;     // 0,1,2 < 10%
    low789: boolean;     // 7,8,9 < 10%
    evenDominant: boolean; // Even > 55%
    oddDominant: boolean;  // Odd > 55%
    digit4Focus: boolean;  // Digit 4 > 12% and odd dominant
  };
  recommendedBot: {
    type: 'TYPE_A' | 'TYPE_B' | 'EVEN_BOT' | 'ODD_BOT' | 'NONE';
    entry: number | 'EVEN' | 'ODD';
    description: string;
    confidence: number;
  };
  volatility: 'LOW' | 'MEDIUM' | 'HIGH';
  timestamp: Date;
}

interface BotConfig {
  id: string;
  name: string;
  type: 'TYPE_A' | 'TYPE_B' | 'EVEN_BOT' | 'ODD_BOT';
  market: string;
  
  // Entry configuration
  entryType: 'digit' | 'even' | 'odd';
  entryValue: number | 'EVEN' | 'ODD';
  contractType: string;
  duration: number;
  
  // Stake configuration
  baseStake: number;
  currentStake: number;
  
  // Recovery configuration
  martingaleMultiplier: number;
  maxRecoverySteps: number;
  takeProfit: number;
  stopLoss: number;
  
  // Bot state
  isRunning: boolean;
  isPaused: boolean;
  status: 'idle' | 'watching' | 'trading' | 'recovery' | 'completed' | 'stopped' | 'error';
  
  // Statistics
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  currentRun: number;
  recoveryStep: number;
  lastTradeResult?: 'win' | 'loss';
  
  // Market data
  analysis: DigitAnalysis;
  
  // UI
  expanded: boolean;
  showRecovery: boolean;
  createdAt: Date;
}

interface TradeLog {
  id: string;
  timestamp: Date;
  botId: string;
  botName: string;
  market: string;
  entryType: string;
  entryValue: string;
  stake: number;
  result: 'win' | 'loss' | 'pending';
  profit: number;
  recoveryStep: number;
  digit?: number;
  balance: number;
}

interface SessionStats {
  startTime: Date;
  endTime?: Date;
  totalProfit: number;
  totalTrades: number;
  totalWins: number;
  totalLosses: number;
  maxWin: number;
  maxLoss: number;
  botCount: number;
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
  { value: '1HZ10V', label: '1HZ 10V', icon: '⚡', group: '1-Second' },
  { value: '1HZ25V', label: '1HZ 25V', icon: '⚡', group: '1-Second' },
  { value: '1HZ50V', label: '1HZ 50V', icon: '⚡', group: '1-Second' },
  { value: '1HZ75V', label: '1HZ 75V', icon: '⚡', group: '1-Second' },
  { value: '1HZ100V', label: '1HZ 100V', icon: '⚡', group: '1-Second' },
  
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
  { value: 'JB100', label: 'Jump Bear 100', icon: '🐻', group: 'Jump' },
  
  // Boom & Crash
  { value: 'BOOM300', label: 'BOOM 300', icon: '💥', group: 'Boom & Crash' },
  { value: 'BOOM500', label: 'BOOM 500', icon: '💥', group: 'Boom & Crash' },
  { value: 'BOOM1000', label: 'BOOM 1000', icon: '💥', group: 'Boom & Crash' },
  { value: 'CRASH300', label: 'CRASH 300', icon: '📉', group: 'Boom & Crash' },
  { value: 'CRASH500', label: 'CRASH 500', icon: '📉', group: 'Boom & Crash' },
  { value: 'CRASH1000', label: 'CRASH 1000', icon: '📉', group: 'Boom & Crash' },
  
  // Daily Reset
  { value: 'RDBEAR', label: 'RD Bear', icon: '🐻', group: 'Daily Reset' },
  { value: 'RDBULL', label: 'RD Bull', icon: '🐂', group: 'Daily Reset' }
];

const CONTRACT_TYPES = {
  digit: {
    DIGITMATCH: { label: 'Matches', icon: '=' },
    DIGITDIFF: { label: 'Differs', icon: '≠' }
  },
  even: {
    DIGITEVEN: { label: 'Even', icon: '2️⃣' }
  },
  odd: {
    DIGITODD: { label: 'Odd', icon: '3️⃣' }
  }
};

const BOT_STYLES = {
  TYPE_A: {
    name: 'Type A - Low 0,1,2',
    border: 'border-emerald-500',
    bg: 'bg-emerald-500/5',
    badge: 'bg-emerald-500/20 text-emerald-500',
    icon: <TrendingDown className="w-4 h-4" />,
    gradient: 'from-emerald-500/20 to-transparent'
  },
  TYPE_B: {
    name: 'Type B - Low 7,8,9',
    border: 'border-blue-500',
    bg: 'bg-blue-500/5',
    badge: 'bg-blue-500/20 text-blue-500',
    icon: <TrendingUp className="w-4 h-4" />,
    gradient: 'from-blue-500/20 to-transparent'
  },
  EVEN_BOT: {
    name: 'Even Dominant Bot',
    border: 'border-purple-500',
    bg: 'bg-purple-500/5',
    badge: 'bg-purple-500/20 text-purple-500',
    icon: <CircleDot className="w-4 h-4" />,
    gradient: 'from-purple-500/20 to-transparent'
  },
  ODD_BOT: {
    name: 'Odd Focus Bot',
    border: 'border-orange-500',
    bg: 'bg-orange-500/5',
    badge: 'bg-orange-500/20 text-orange-500',
    icon: <Hash className="w-4 h-4" />,
    gradient: 'from-orange-500/20 to-transparent'
  }
};

// ==================== HELPER FUNCTIONS ====================

const analyzeMarketDigits = (symbol: string, ticks: number[]): DigitAnalysis => {
  if (ticks.length === 0) {
    return {
      symbol,
      counts: {},
      percentages: { low012: 0, high789: 0, even: 0, odd: 0 },
      mostFrequent: { digit: 0, percentage: 0 },
      leastFrequent: { digit: 0, percentage: 0 },
      conditions: {
        low012: false,
        low789: false,
        evenDominant: false,
        oddDominant: false,
        digit4Focus: false
      },
      recommendedBot: { type: 'NONE', entry: 0, description: 'Insufficient data', confidence: 0 },
      volatility: 'MEDIUM',
      timestamp: new Date()
    };
  }

  const total = ticks.length;
  const digits = ticks.map(t => Math.floor(t % 10));
  
  // Count digits
  const counts: { [key: number]: number } = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  digits.forEach(d => counts[d]++);
  
  // Calculate percentages
  const percentages: { [key: number]: number } = {};
  for (let i = 0; i <= 9; i++) {
    percentages[i] = (counts[i] / total) * 100;
  }
  
  percentages.low012 = ((counts[0] + counts[1] + counts[2]) / total) * 100;
  percentages.high789 = ((counts[7] + counts[8] + counts[9]) / total) * 100;
  
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  
  percentages.even = evenDigits.reduce((sum, d) => sum + counts[d], 0) / total * 100;
  percentages.odd = oddDigits.reduce((sum, d) => sum + counts[d], 0) / total * 100;
  
  // Find most and least frequent
  let mostFreq = 0, mostCount = 0;
  let leastFreq = 0, leastCount = total;
  
  for (let i = 0; i <= 9; i++) {
    if (counts[i] > mostCount) {
      mostCount = counts[i];
      mostFreq = i;
    }
    if (counts[i] < leastCount) {
      leastCount = counts[i];
      leastFreq = i;
    }
  }
  
  // Check conditions
  const conditions = {
    low012: percentages.low012 < 10,
    low789: percentages.high789 < 10,
    evenDominant: percentages.even > 55,
    oddDominant: percentages.odd > 55,
    digit4Focus: percentages.odd > 55 && percentages[4] > 12
  };
  
  // Determine recommended bot
  let recommendedBot: { type: 'TYPE_A' | 'TYPE_B' | 'EVEN_BOT' | 'ODD_BOT' | 'NONE'; entry: number | 'EVEN' | 'ODD'; description: string; confidence: number } = {
    type: 'NONE',
    entry: 0,
    description: 'No clear condition',
    confidence: 0
  };
  
  if (conditions.low012) {
    // Find best entry among 0,1,2
    const lowDigits = [0,1,2];
    let bestDigit = lowDigits.reduce((a, b) => counts[a] > counts[b] ? a : b);
    recommendedBot = {
      type: 'TYPE_A',
      entry: bestDigit,
      description: `Low 0,1,2 (${percentages.low012.toFixed(1)}%) - Best entry: ${bestDigit}`,
      confidence: Math.max(0, 100 - percentages.low012 * 2)
    };
  }
  else if (conditions.low789) {
    // Find best entry among 7,8,9
    const highDigits = [7,8,9];
    let bestDigit = highDigits.reduce((a, b) => counts[a] > counts[b] ? a : b);
    recommendedBot = {
      type: 'TYPE_B',
      entry: bestDigit,
      description: `Low 7,8,9 (${percentages.high789.toFixed(1)}%) - Best entry: ${bestDigit}`,
      confidence: Math.max(0, 100 - percentages.high789 * 2)
    };
  }
  else if (conditions.evenDominant) {
    recommendedBot = {
      type: 'EVEN_BOT',
      entry: 'EVEN',
      description: `Even dominant (${percentages.even.toFixed(1)}%)`,
      confidence: percentages.even
    };
  }
  else if (conditions.oddDominant) {
    if (conditions.digit4Focus) {
      recommendedBot = {
        type: 'ODD_BOT',
        entry: 4,
        description: `Odd dominant with 4 focus (${percentages[4].toFixed(1)}%)`,
        confidence: percentages.odd
      };
    } else {
      recommendedBot = {
        type: 'ODD_BOT',
        entry: 'ODD',
        description: `Odd dominant (${percentages.odd.toFixed(1)}%)`,
        confidence: percentages.odd
      };
    }
  }
  
  // Calculate volatility
  const stdDev = Math.sqrt(digits.reduce((sum, d) => sum + Math.pow(d - 4.5, 2), 0) / total);
  let volatility: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  if (stdDev < 2) volatility = 'LOW';
  if (stdDev > 3) volatility = 'HIGH';
  
  return {
    symbol,
    counts,
    percentages,
    mostFrequent: { digit: mostFreq, percentage: (mostCount / total) * 100 },
    leastFrequent: { digit: leastFreq, percentage: (leastCount / total) * 100 },
    conditions,
    recommendedBot,
    volatility,
    timestamp: new Date()
  };
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

const formatTime = (date: Date): string => {
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

// ==================== MAIN COMPONENT ====================

export default function DerivTradingBot() {
  const { isAuthorized, balance, updateBalance } = useAuth();
  
  // ==================== STATE ====================
  
  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentScanMarket, setCurrentScanMarket] = useState('');
  const [scanResults, setScanResults] = useState<Record<string, DigitAnalysis>>({});
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  
  // Bots state
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [tradeLogs, setTradeLogs] = useState<TradeLog[]>([]);
  const [sessionStats, setSessionStats] = useState<SessionStats>({
    startTime: new Date(),
    totalProfit: 0,
    totalTrades: 0,
    totalWins: 0,
    totalLosses: 0,
    maxWin: 0,
    maxLoss: 0,
    botCount: 0
  });
  
  // UI state
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoCreateBots, setAutoCreateBots] = useState(true);
  const [selectedTab, setSelectedTab] = useState('bots');
  const [showSettings, setShowSettings] = useState(false);
  
  // Global defaults
  const [defaultStake, setDefaultStake] = useState(1.00);
  const [defaultDuration, setDefaultDuration] = useState(5);
  const [defaultMultiplier, setDefaultMultiplier] = useState(2.0);
  const [defaultMaxSteps, setDefaultMaxSteps] = useState(3);
  const [defaultTakeProfit, setDefaultTakeProfit] = useState(10);
  const [defaultStopLoss, setDefaultStopLoss] = useState(25);
  
  // Refs
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const marketDataRef = useRef<Record<string, number[]>>({});
  const scanIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // ==================== MARKET SCANNING ====================
  
  const scanAllMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScanProgress(0);
    
    const markets = VOLATILITY_MARKETS.map(m => m.value);
    const totalMarkets = markets.length;
    const results: Record<string, DigitAnalysis> = {};
    const ticksData: Record<string, number[]> = {};
    
    toast.info(`🔍 Scanning ${totalMarkets} markets for 1000 ticks each...`);
    
    try {
      // Connect to Deriv API
      await derivApi.connect();
      
      for (let i = 0; i < markets.length; i++) {
        const market = markets[i];
        setCurrentScanMarket(market);
        setScanProgress(Math.round(((i + 1) / totalMarkets) * 100));
        
        try {
          // Get tick history
          const history = await derivApi.getTickHistory(market, 1000);
          
          if (history && history.length > 0) {
            const ticks = history.map((t: any) => t.quote);
            ticksData[market] = ticks;
            marketDataRef.current[market] = ticks;
            
            // Analyze digits
            const analysis = analyzeMarketDigits(market, ticks);
            results[market] = analysis;
            
            // Auto-create bot if enabled and condition met
            if (autoCreateBots && analysis.recommendedBot.type !== 'NONE' && analysis.recommendedBot.confidence > 65) {
              createBotFromAnalysis(market, analysis);
            }
          }
        } catch (error) {
          console.error(`Error scanning ${market}:`, error);
        }
        
        // Small delay to prevent rate limiting
        await new Promise(r => setTimeout(r, 100));
      }
      
      setScanResults(results);
      setLastScanTime(new Date());
      
      const qualifyingCount = Object.values(results).filter(r => r.recommendedBot.type !== 'NONE').length;
      
      if (soundEnabled) {
        playSound('success');
      }
      
      toast.success(`✅ Scan complete! ${qualifyingCount} qualifying markets found`);
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed - check connection');
    } finally {
      setIsScanning(false);
      setCurrentScanMarket('');
    }
  }, [isScanning, autoCreateBots, soundEnabled]);

  // ==================== CREATE BOT ====================
  
  const createBotFromAnalysis = useCallback((market: string, analysis: DigitAnalysis) => {
    // Check if bot already exists
    const existingBot = bots.find(b => b.market === market && b.type === analysis.recommendedBot.type);
    if (existingBot) return;
    
    const style = BOT_STYLES[analysis.recommendedBot.type];
    
    // Determine entry configuration
    let entryType: 'digit' | 'even' | 'odd';
    let entryValue: number | 'EVEN' | 'ODD';
    let contractType: string;
    
    if (analysis.recommendedBot.type === 'TYPE_A' || analysis.recommendedBot.type === 'TYPE_B') {
      entryType = 'digit';
      entryValue = analysis.recommendedBot.entry as number;
      contractType = 'DIGITMATCH';
    } else if (analysis.recommendedBot.type === 'EVEN_BOT') {
      entryType = 'even';
      entryValue = 'EVEN';
      contractType = 'DIGITEVEN';
    } else {
      entryType = 'odd';
      entryValue = analysis.recommendedBot.entry;
      contractType = 'DIGITODD';
    }
    
    const newBot: BotConfig = {
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      name: `${market} - ${style.name}`,
      type: analysis.recommendedBot.type,
      market,
      
      entryType,
      entryValue,
      contractType,
      duration: defaultDuration,
      
      baseStake: defaultStake,
      currentStake: defaultStake,
      
      martingaleMultiplier: defaultMultiplier,
      maxRecoverySteps: defaultMaxSteps,
      takeProfit: defaultTakeProfit,
      stopLoss: defaultStopLoss,
      
      isRunning: false,
      isPaused: false,
      status: 'idle',
      
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      currentRun: 0,
      recoveryStep: 0,
      
      analysis,
      
      expanded: true,
      showRecovery: false,
      createdAt: new Date()
    };
    
    setBots(prev => [...prev, newBot]);
    
    toast.success(`🤖 Created ${newBot.name}`);
  }, [bots, defaultStake, defaultDuration, defaultMultiplier, defaultMaxSteps, defaultTakeProfit, defaultStopLoss]);

  const createManualBot = useCallback(() => {
    if (!selectedMarketForManual) {
      toast.error('Please select a market');
      return;
    }
    
    const analysis = scanResults[selectedMarketForManual] || {
      symbol: selectedMarketForManual,
      counts: {},
      percentages: { low012: 0, high789: 0, even: 0, odd: 0 },
      mostFrequent: { digit: 0, percentage: 0 },
      leastFrequent: { digit: 0, percentage: 0 },
      conditions: {
        low012: false,
        low789: false,
        evenDominant: false,
        oddDominant: false,
        digit4Focus: false
      },
      recommendedBot: { type: 'NONE', entry: 0, description: 'Manual creation', confidence: 0 },
      volatility: 'MEDIUM',
      timestamp: new Date()
    };
    
    // Show bot type selector modal
    setShowBotTypeModal(true);
    setSelectedMarketForManual(selectedMarketForManual);
  }, [scanResults]);

  const [showBotTypeModal, setShowBotTypeModal] = useState(false);
  const [selectedMarketForManual, setSelectedMarketForManual] = useState('');

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

  // ==================== BOT TRADING LOGIC ====================
  
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;
    
    // Check balance
    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }
    
    // Update bot state
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        isRunning: true, 
        status: 'watching',
        currentRun: 0,
        recoveryStep: 0,
        currentStake: bot.baseStake
      } : b
    ));
    
    botRunningRefs.current[botId] = true;
    
    let currentStake = bot.baseStake;
    let totalPnl = bot.totalPnl;
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let currentRun = 0;
    let recoveryStep = 0;
    let inRecovery = false;
    
    // Run 3 consecutive contracts
    while (botRunningRefs.current[botId] && currentRun < 3) {
      // Check TP/SL
      if (totalPnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take Profit reached! +${formatCurrency(totalPnl)}`);
        break;
      }
      if (totalPnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop Loss reached! ${formatCurrency(totalPnl)}`);
        break;
      }
      
      // Update status
      setBots(prev => prev.map(b => 
        b.id === botId ? { 
          ...b, 
          status: inRecovery ? 'recovery' : 'watching',
          currentRun,
          recoveryStep
        } : b
      ));
      
      // Wait for next tick
      const tick = await waitForNextTick(bot.market);
      if (tick === 0) continue;
      
      const currentDigit = Math.floor(tick % 10);
      
      // Check entry condition
      let shouldEnter = false;
      
      if (bot.entryType === 'digit' && typeof bot.entryValue === 'number') {
        shouldEnter = currentDigit === bot.entryValue;
      } else if (bot.entryType === 'even') {
        shouldEnter = currentDigit % 2 === 0;
      } else if (bot.entryType === 'odd') {
        shouldEnter = currentDigit % 2 === 1;
      }
      
      if (!shouldEnter) continue;
      
      // Execute trade
      try {
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, status: 'trading' } : b
        ));
        
        const params: any = {
          contract_type: bot.contractType,
          symbol: bot.market,
          duration: bot.duration,
          duration_unit: 't',
          basis: 'stake',
          amount: currentStake,
        };
        
        if (bot.entryType === 'digit' && typeof bot.entryValue === 'number') {
          params.barrier = bot.entryValue.toString();
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
          entryType: bot.entryType,
          entryValue: bot.entryValue.toString(),
          stake: currentStake,
          result: 'pending',
          profit: 0,
          recoveryStep: inRecovery ? recoveryStep : 0,
          digit: currentDigit,
          balance: balance - currentStake
        };
        
        setTradeLogs(prev => [newTrade, ...prev].slice(0, 100));
        
        // Buy contract
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        const won = result.status === 'won';
        const profit = result.profit;
        
        // Update balance
        updateBalance(balance + profit);
        
        // Update trade log
        setTradeLogs(prev => prev.map(t => 
          t.id === tradeId ? { ...t, result: won ? 'win' : 'loss', profit } : t
        ));
        
        // Update statistics
        totalPnl += profit;
        trades++;
        
        if (won) {
          wins++;
          
          if (inRecovery) {
            // Recovery successful - stop bot
            toast.success(`${bot.name}: Recovery successful! Profit: ${formatCurrency(profit)}`);
            botRunningRefs.current[botId] = false;
            break;
          } else {
            // Normal win - increment run counter
            currentRun++;
            toast.success(`${bot.name}: Run ${currentRun}/3 won! Profit: ${formatCurrency(profit)}`);
            
            // Reset stake after win
            currentStake = bot.baseStake;
            recoveryStep = 0;
            inRecovery = false;
            
            // If we've completed 3 runs, stop
            if (currentRun >= 3) {
              toast.success(`${bot.name}: Completed 3 runs successfully!`);
              break;
            }
          }
        } else {
          losses++;
          
          if (!inRecovery) {
            // First loss - start recovery
            inRecovery = true;
            recoveryStep = 1;
            currentStake = bot.baseStake * bot.martingaleMultiplier;
            
            toast.info(`${bot.name}: Loss - Starting recovery step ${recoveryStep} with stake ${formatCurrency(currentStake)}`);
          } else {
            // Recovery loss - increase stake
            recoveryStep++;
            
            if (recoveryStep <= bot.maxRecoverySteps) {
              currentStake = bot.baseStake * Math.pow(bot.martingaleMultiplier, recoveryStep);
              toast.info(`${bot.name}: Recovery step ${recoveryStep} - Stake: ${formatCurrency(currentStake)}`);
            } else {
              // Max recovery steps reached
              toast.error(`${bot.name}: Max recovery steps reached. Stopping bot.`);
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
            currentRun,
            recoveryStep,
            lastTradeResult: won ? 'win' : 'loss'
          } : b
        ));
        
        // Update session stats
        setSessionStats(prev => ({
          ...prev,
          totalProfit: totalPnl,
          totalTrades: trades,
          totalWins: wins,
          totalLosses: losses,
          maxWin: Math.max(prev.maxWin, won ? profit : 0),
          maxLoss: Math.min(prev.maxLoss, !won ? profit : 0)
        }));
        
        // Small delay between trades
        await new Promise(r => setTimeout(r, 500));
        
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
    
  }, [isAuthorized, balance, bots, updateBalance]);

  // ==================== BOT CONTROLS ====================
  
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    runBot(botId);
  };
  
  const pauseBot = (botId: string) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, isPaused: !b.isPaused } : b
    ));
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
    
    toast.info('All bots stopped');
  };
  
  const removeBot = (botId: string) => {
    stopBot(botId);
    setBots(prev => prev.filter(b => b.id !== botId));
  };
  
  const duplicateBot = (bot: BotConfig) => {
    const newBot: BotConfig = {
      ...bot,
      id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      name: `${bot.name} (Copy)`,
      isRunning: false,
      isPaused: false,
      status: 'idle',
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveWins: 0,
      consecutiveLosses: 0,
      currentRun: 0,
      recoveryStep: 0,
      currentStake: bot.baseStake,
      createdAt: new Date()
    };
    
    setBots(prev => [...prev, newBot]);
    toast.success('Bot duplicated');
  };
  
  const updateBotSetting = (botId: string, key: keyof BotConfig, value: any) => {
    setBots(prev => prev.map(b => 
      b.id === botId ? { ...b, [key]: value } : b
    ));
  };

  // ==================== EXPORT/IMPORT ====================
  
  const exportSettings = () => {
    const data = {
      bots: bots.map(({ id, ...bot }) => bot),
      settings: {
        defaultStake,
        defaultDuration,
        defaultMultiplier,
        defaultMaxSteps,
        defaultTakeProfit,
        defaultStopLoss,
        autoCreateBots,
        soundEnabled
      },
      timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `deriv-bot-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('Settings exported');
  };
  
  const importSettings = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);
        
        if (data.bots && Array.isArray(data.bots)) {
          const importedBots = data.bots.map((bot: any) => ({
            ...bot,
            id: `bot-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
            isRunning: false,
            isPaused: false,
            status: 'idle',
            totalPnl: 0,
            trades: 0,
            wins: 0,
            losses: 0,
            consecutiveWins: 0,
            consecutiveLosses: 0,
            currentRun: 0,
            recoveryStep: 0,
            currentStake: bot.baseStake,
            createdAt: new Date()
          }));
          
          setBots(prev => [...prev, ...importedBots]);
        }
        
        if (data.settings) {
          setDefaultStake(data.settings.defaultStake || defaultStake);
          setDefaultDuration(data.settings.defaultDuration || defaultDuration);
          setDefaultMultiplier(data.settings.defaultMultiplier || defaultMultiplier);
          setDefaultMaxSteps(data.settings.defaultMaxSteps || defaultMaxSteps);
          setDefaultTakeProfit(data.settings.defaultTakeProfit || defaultTakeProfit);
          setDefaultStopLoss(data.settings.defaultStopLoss || defaultStopLoss);
          setAutoCreateBots(data.settings.autoCreateBots !== undefined ? data.settings.autoCreateBots : autoCreateBots);
          setSoundEnabled(data.settings.soundEnabled !== undefined ? data.settings.soundEnabled : soundEnabled);
        }
        
        toast.success(`Imported ${data.bots?.length || 0} bots`);
      } catch (error) {
        console.error('Import error:', error);
        toast.error('Failed to import settings');
      }
    };
    reader.readAsText(file);
  };

  // ==================== CLEAR DATA ====================
  
  const clearAllData = () => {
    stopAllBots();
    setBots([]);
    setTradeLogs([]);
    setScanResults({});
    setSessionStats({
      startTime: new Date(),
      totalProfit: 0,
      totalTrades: 0,
      totalWins: 0,
      totalLosses: 0,
      maxWin: 0,
      maxLoss: 0,
      botCount: 0
    });
    toast.success('All data cleared');
  };

  // ==================== CALCULATE STATS ====================
  
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
  const activeBots = bots.filter(b => b.isRunning).length;
  const qualifyingMarkets = Object.values(scanResults).filter(r => r.recommendedBot.type !== 'NONE').length;

  // Auto-scan on load
  useEffect(() => {
    scanAllMarkets();
  }, []);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-gradient-to-br from-background via-background to-secondary/20 p-2 sm:p-4">
        
        {/* ==================== HEADER ==================== */}
        <div className="mb-4 space-y-3">
          <Card className="border-2 shadow-xl bg-card/50 backdrop-blur-sm">
            <CardHeader className="p-3 sm:p-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <Brain className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <CardTitle className="text-base sm:text-lg">Deriv AI Trading Bot</CardTitle>
                    <CardDescription className="text-xs">
                      Automated trading with market analysis • Martingale recovery • Real-time monitoring
                    </CardDescription>
                  </div>
                </div>
                
                <div className="flex flex-wrap items-center gap-1 w-full sm:w-auto">
                  {/* Sound Toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setSoundEnabled(!soundEnabled)}
                        className="h-7 w-7 p-0"
                      >
                        {soundEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Toggle sound</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Auto Create Toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-1 px-2 py-1 bg-muted/30 rounded-lg text-xs">
                        <span>Auto</span>
                        <Switch
                          checked={autoCreateBots}
                          onCheckedChange={setAutoCreateBots}
                          className="scale-75"
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Auto-create bots when conditions met</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Settings Toggle */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowSettings(!showSettings)}
                        className="h-7 w-7 p-0"
                      >
                        <Settings className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Global settings</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Scan Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                            {scanProgress}%
                          </>
                        ) : (
                          <>
                            <Scan className="w-3 h-3 mr-1" />
                            Scan Markets
                          </>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Scan all markets for 1000 ticks</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Export Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={exportSettings}
                        className="h-7 w-7 p-0"
                      >
                        <Download className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Export settings</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Import Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.createElement('input');
                          input.type = 'file';
                          input.accept = '.json';
                          input.onchange = (e) => {
                            const file = (e.target as HTMLInputElement).files?.[0];
                            if (file) importSettings(file);
                          };
                          input.click();
                        }}
                        className="h-7 w-7 p-0"
                      >
                        <Upload className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Import settings</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Clear Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={clearAllData}
                        className="h-7 w-7 p-0"
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Clear all data</p>
                    </TooltipContent>
                  </Tooltip>
                  
                  {/* Stop All Button */}
                  <Tooltip>
                    <TooltipTrigger asChild>
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
                    </TooltipTrigger>
                    <TooltipContent>
                      <p className="text-xs">Stop all running bots</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
              
              {/* Scan Progress */}
              {isScanning && (
                <div className="mt-2 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Scanning {currentScanMarket}...
                    </span>
                    <span className="font-medium text-primary">{scanProgress}%</span>
                  </div>
                  <Progress value={scanProgress} className="h-1.5" />
                  <p className="text-[10px] text-muted-foreground">
                    Fetching 1000 ticks per market
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
                  <span>{bots.length} bots active</span>
                </div>
              )}
            </CardHeader>
            
            {/* Global Settings */}
            <AnimatePresence>
              {showSettings && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <CardContent className="p-3 pt-0">
                    <Separator className="mb-3" />
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                      <div>
                        <Label className="text-[10px]">Default Stake ($)</Label>
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
                        <Label className="text-[10px]">Martingale Multiplier</Label>
                        <Input
                          type="number"
                          value={defaultMultiplier}
                          onChange={(e) => setDefaultMultiplier(parseFloat(e.target.value) || 1.5)}
                          className="h-7 text-xs"
                          step="0.1"
                          min="1.1"
                          max="5"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px]">Max Recovery Steps</Label>
                        <Input
                          type="number"
                          value={defaultMaxSteps}
                          onChange={(e) => setDefaultMaxSteps(parseInt(e.target.value) || 1)}
                          className="h-7 text-xs"
                          min="1"
                          max="5"
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
                    </div>
                  </CardContent>
                </motion.div>
              )}
            </AnimatePresence>
            
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
                  <div className="text-muted-foreground">Wins</div>
                  <div className="font-bold text-green-500">{totalWins}</div>
                </div>
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-muted-foreground">Losses</div>
                  <div className="font-bold text-red-500">{totalTrades - totalWins}</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* ==================== TABS ==================== */}
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="bots" className="text-xs">🤖 Bots</TabsTrigger>
            <TabsTrigger value="analysis" className="text-xs">📊 Market Analysis</TabsTrigger>
            <TabsTrigger value="trades" className="text-xs">📝 Trade Log</TabsTrigger>
            <TabsTrigger value="stats" className="text-xs">📈 Statistics</TabsTrigger>
          </TabsList>
          
          {/* ==================== BOTS TAB ==================== */}
          <TabsContent value="bots" className="space-y-4">
            {/* Create Bot Button */}
            <div className="flex gap-2">
              <Select onValueChange={setSelectedMarketForManual}>
                <SelectTrigger className="w-[200px] h-8 text-xs">
                  <SelectValue placeholder="Select market" />
                </SelectTrigger>
                <SelectContent>
                  {VOLATILITY_MARKETS.map(market => (
                    <SelectItem key={market.value} value={market.value} className="text-xs">
                      {market.icon} {market.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              
              <Button onClick={createManualBot} size="sm" className="h-8 text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Create Manual Bot
              </Button>
            </div>
            
            {/* Bots Grid */}
            {bots.length === 0 ? (
              <Card className="border-2 border-dashed bg-card/50">
                <CardContent className="p-8 text-center">
                  <Brain className="w-16 h-16 mx-auto mb-4 text-muted-foreground opacity-30" />
                  <h3 className="text-lg font-medium mb-2">No Bots Created Yet</h3>
                  <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
                    Click "Scan Markets" to analyze all markets. Bots will be created automatically when conditions are met.
                  </p>
                  <Button onClick={scanAllMarkets} disabled={isScanning}>
                    {isScanning ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Scanning...
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
                  {bots.map(bot => {
                    const style = BOT_STYLES[bot.type];
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
                                      {bot.type.replace('_', ' ')}
                                    </Badge>
                                  </CardTitle>
                                  <CardDescription className="text-[10px]">
                                    Entry: {bot.entryValue.toString()} • Conf: {bot.analysis.recommendedBot.confidence.toFixed(0)}%
                                  </CardDescription>
                                </div>
                              </div>
                              
                              <div className="flex items-center gap-1">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => duplicateBot(bot)}
                                      className="h-6 w-6 p-0"
                                    >
                                      <Copy className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">Duplicate bot</p>
                                  </TooltipContent>
                                </Tooltip>
                                
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeBot(bot.id)}
                                      className="h-6 w-6 p-0 text-red-500 hover:text-red-600"
                                      disabled={bot.isRunning}
                                    >
                                      <XCircle className="w-3 h-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p className="text-xs">Remove bot</p>
                                  </TooltipContent>
                                </Tooltip>
                                
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
                                  bot.analysis.conditions.low012 ? 'text-emerald-500' : ''
                                }`}>
                                  {bot.analysis.percentages.low012.toFixed(1)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">7-8-9:</span>
                                <span className={`ml-1 font-bold ${
                                  bot.analysis.conditions.low789 ? 'text-blue-500' : ''
                                }`}>
                                  {bot.analysis.percentages.high789.toFixed(1)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Even:</span>
                                <span className={`ml-1 font-bold ${
                                  bot.analysis.conditions.evenDominant ? 'text-purple-500' : ''
                                }`}>
                                  {bot.analysis.percentages.even.toFixed(1)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Odd:</span>
                                <span className={`ml-1 font-bold ${
                                  bot.analysis.conditions.oddDominant ? 'text-orange-500' : ''
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
                                  bot.status === 'recovery' ? 'text-orange-500 animate-pulse' :
                                  bot.status === 'watching' ? 'text-yellow-500' :
                                  bot.status === 'completed' ? 'text-blue-500' :
                                  'text-gray-500'
                                }`}>
                                  {bot.status === 'trading' && <Activity className="w-3 h-3" />}
                                  {bot.status === 'recovery' && <RefreshCw className="w-3 h-3 animate-spin" />}
                                  {bot.status === 'watching' && <Eye className="w-3 h-3" />}
                                  {bot.status === 'completed' && <CheckCircle2 className="w-3 h-3" />}
                                  {bot.status === 'stopped' && <StopCircle className="w-3 h-3" />}
                                  {bot.status === 'idle' && <CircleDot className="w-3 h-3" />}
                                  <span className="text-[8px] capitalize">{bot.status}</span>
                                </div>
                              </div>
                            </div>
                            
                            {/* Recovery Progress */}
                            {bot.recoveryStep > 0 && (
                              <div className="mb-2">
                                <div className="flex justify-between text-[8px] text-muted-foreground mb-0.5">
                                  <span>Recovery Step {bot.recoveryStep}/{bot.maxRecoverySteps}</span>
                                  <span className="font-medium text-orange-500">Stake: {formatCurrency(bot.currentStake)}</span>
                                </div>
                                <Progress value={(bot.recoveryStep / bot.maxRecoverySteps) * 100} className="h-1" />
                              </div>
                            )}
                            
                            {/* Run Progress */}
                            <div className="flex items-center gap-1 text-[8px]">
                              <span className="text-muted-foreground">Run:</span>
                              {[1,2,3].map(run => (
                                <div
                                  key={run}
                                  className={`w-4 h-4 rounded-full flex items-center justify-center ${
                                    run <= bot.currentRun ? 'bg-primary text-primary-foreground' : 'bg-muted'
                                  }`}
                                >
                                  {run}
                                </div>
                              ))}
                            </div>
                          </CardContent>
                          
                          {/* Expanded Settings */}
                          <AnimatePresence>
                            {bot.expanded && (
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                exit={{ opacity: 0, height: 0 }}
                              >
                                <CardContent className="p-3 pt-0 relative">
                                  <Separator className="mb-3" />
                                  
                                  <div className="space-y-3">
                                    {/* Basic Settings */}
                                    <div className="grid grid-cols-2 gap-2">
                                      <div>
                                        <Label className="text-[8px]">Stake ($)</Label>
                                        <div className="flex items-center gap-1">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => updateBotSetting(bot.id, 'baseStake', Math.max(0.1, bot.baseStake - 0.1))}
                                            className="h-6 w-6 p-0"
                                            disabled={bot.isRunning}
                                          >
                                            <Minus className="w-2 h-2" />
                                          </Button>
                                          <Input
                                            type="number"
                                            value={bot.baseStake}
                                            onChange={(e) => updateBotSetting(bot.id, 'baseStake', parseFloat(e.target.value) || 0.1)}
                                            disabled={bot.isRunning}
                                            className="h-6 text-[8px] text-center p-0"
                                            step="0.1"
                                            min="0.1"
                                          />
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => updateBotSetting(bot.id, 'baseStake', bot.baseStake + 0.1)}
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
                                    </div>
                                    
                                    {/* Recovery Settings Toggle */}
                                    <div className="flex items-center justify-between">
                                      <Label className="text-[8px] font-medium">Recovery Settings</Label>
                                      <Switch
                                        checked={bot.showRecovery}
                                        onCheckedChange={(checked) => updateBotSetting(bot.id, 'showRecovery', checked)}
                                      />
                                    </div>
                                    
                                    {bot.showRecovery && (
                                      <div className="grid grid-cols-2 gap-2">
                                        <div>
                                          <Label className="text-[8px]">Multiplier</Label>
                                          <Input
                                            type="number"
                                            value={bot.martingaleMultiplier}
                                            onChange={(e) => updateBotSetting(bot.id, 'martingaleMultiplier', parseFloat(e.target.value) || 1.5)}
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
                                            value={bot.maxRecoverySteps}
                                            onChange={(e) => updateBotSetting(bot.id, 'maxRecoverySteps', parseInt(e.target.value) || 1)}
                                            disabled={bot.isRunning}
                                            className="h-6 text-[8px]"
                                            min="1"
                                            max="5"
                                          />
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
                                      </div>
                                    )}
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
                                disabled={!isAuthorized || balance < bot.baseStake || activeTradeId !== null}
                                className={`flex-1 h-7 text-xs ${style.badge} hover:opacity-80`}
                                size="sm"
                              >
                                <Play className="w-3 h-3 mr-1" />
                                Start Bot
                              </Button>
                            ) : (
                              <>
                                <Button
                                  onClick={() => pauseBot(bot.id)}
                                  variant={bot.isPaused ? "default" : "outline"}
                                  className="flex-1 h-7 text-xs"
                                  size="sm"
                                >
                                  {bot.isPaused ? (
                                    <>                                  {bot.isPaused ? (
                                    <>
                                      <Play className="w-3 h-3 mr-1" />
                                      Resume
                                    </>
                                  ) : (
                                    <>
                                      <Pause className="w-3 h-3 mr-1" />
                                      Pause
                                    </>
                                  )}
                                </Button>
                                <Button
                                  onClick={() => stopBot(bot.id)}
                                  variant="destructive"
                                  className="flex-1 h-7 text-xs"
                                  size="sm"
                                >
                                  <StopCircle className="w-3 h-3 mr-1" />
                                  Stop
                                </Button>
                              </>
                            )}
                          </CardFooter>
                        </Card>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </TabsContent>
          
          {/* ==================== MARKET ANALYSIS TAB ==================== */}
          <TabsContent value="analysis">
            <Card className="border-2">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Market Analysis Results
                </CardTitle>
                <CardDescription className="text-xs">
                  {Object.keys(scanResults).length} markets analyzed • Last scan: {lastScanTime?.toLocaleTimeString() || 'Never'}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {Object.entries(scanResults).length === 0 ? (
                    <div className="text-center py-8">
                      <p className="text-muted-foreground">No market data available. Click "Scan Markets" to analyze.</p>
                    </div>
                  ) : (
                    Object.entries(scanResults).map(([symbol, analysis]) => {
                      const marketInfo = VOLATILITY_MARKETS.find(m => m.value === symbol);
                      const hasCondition = analysis.recommendedBot.type !== 'NONE';
                      
                      return (
                        <Card key={symbol} className={`border ${hasCondition ? 'border-primary/50' : 'border-border'}`}>
                          <CardHeader className="p-2">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-lg">{marketInfo?.icon}</span>
                                <div>
                                  <h4 className="text-sm font-medium">{symbol}</h4>
                                  <p className="text-[10px] text-muted-foreground">
                                    {analysis.volatility} volatility • {analysis.timestamp.toLocaleTimeString()}
                                  </p>
                                </div>
                              </div>
                              {hasCondition && (
                                <Badge className={BOT_STYLES[analysis.recommendedBot.type]?.badge || ''}>
                                  {analysis.recommendedBot.type.replace('_', ' ')}
                                </Badge>
                              )}
                            </div>
                          </CardHeader>
                          <CardContent className="p-2 pt-0">
                            {/* Digit Distribution */}
                            <div className="grid grid-cols-10 gap-0.5 mb-2">
                              {[0,1,2,3,4,5,6,7,8,9].map(digit => {
                                const percentage = analysis.percentages[digit] || 0;
                                let bgColor = 'bg-gray-500/20';
                                if (digit <= 2 && analysis.conditions.low012) bgColor = 'bg-emerald-500/20';
                                if (digit >= 7 && analysis.conditions.low789) bgColor = 'bg-blue-500/20';
                                if (digit % 2 === 0 && analysis.conditions.evenDominant) bgColor = 'bg-purple-500/20';
                                if (digit === 4 && analysis.conditions.digit4Focus) bgColor = 'bg-orange-500/20';
                                
                                return (
                                  <Tooltip key={digit}>
                                    <TooltipTrigger>
                                      <div className={`${bgColor} rounded p-0.5 text-center`}>
                                        <div className="text-[10px] font-bold">{digit}</div>
                                        <div className="text-[6px]">{percentage.toFixed(1)}%</div>
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="text-xs">Digit {digit}: {analysis.counts[digit] || 0} times ({percentage.toFixed(1)}%)</p>
                                    </TooltipContent>
                                  </Tooltip>
                                );
                              })}
                            </div>
                            
                            {/* Analysis Metrics */}
                            <div className="grid grid-cols-4 gap-1 text-[8px] mb-2">
                              <div>
                                <span className="text-muted-foreground">0-1-2:</span>
                                <span className={`ml-1 font-bold ${analysis.conditions.low012 ? 'text-emerald-500' : ''}`}>
                                  {analysis.percentages.low012.toFixed(1)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">7-8-9:</span>
                                <span className={`ml-1 font-bold ${analysis.conditions.low789 ? 'text-blue-500' : ''}`}>
                                  {analysis.percentages.high789.toFixed(1)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Even:</span>
                                <span className={`ml-1 font-bold ${analysis.conditions.evenDominant ? 'text-purple-500' : ''}`}>
                                  {analysis.percentages.even.toFixed(1)}%
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Odd:</span>
                                <span className={`ml-1 font-bold ${analysis.conditions.oddDominant ? 'text-orange-500' : ''}`}>
                                  {analysis.percentages.odd.toFixed(1)}%
                                </span>
                              </div>
                            </div>
                            
                            {/* Most/Least Frequent */}
                            <div className="flex justify-between text-[8px] mb-2">
                              <div>
                                <span className="text-muted-foreground">Most frequent:</span>
                                <span className="ml-1 font-bold">{analysis.mostFrequent.digit} ({analysis.mostFrequent.percentage.toFixed(1)}%)</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Least frequent:</span>
                                <span className="ml-1 font-bold">{analysis.leastFrequent.digit} ({analysis.leastFrequent.percentage.toFixed(1)}%)</span>
                              </div>
                            </div>
                            
                            {/* Recommendation */}
                            {hasCondition && (
                              <div className="bg-primary/10 rounded p-1.5 mb-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-[8px] font-medium">Recommended Bot:</span>
                                  <Badge className={BOT_STYLES[analysis.recommendedBot.type]?.badge || ''}>
                                    {analysis.recommendedBot.type.replace('_', ' ')}
                                  </Badge>
                                </div>
                                <p className="text-[8px] mt-0.5">{analysis.recommendedBot.description}</p>
                                <div className="flex items-center gap-1 mt-1">
                                  <span className="text-[8px] text-muted-foreground">Confidence:</span>
                                  <Progress value={analysis.recommendedBot.confidence} className="h-1 flex-1" />
                                  <span className="text-[8px] font-bold">{analysis.recommendedBot.confidence.toFixed(0)}%</span>
                                </div>
                              </div>
                            )}
                            
                            {/* Create Bot Button */}
                            {hasCondition && !bots.find(b => b.market === symbol && b.type === analysis.recommendedBot.type) && (
                              <Button
                                onClick={() => createBotFromAnalysis(symbol, analysis)}
                                size="sm"
                                className="w-full h-6 text-[8px]"
                                disabled={isScanning}
                              >
                                <Brain className="w-3 h-3 mr-1" />
                                Create {analysis.recommendedBot.type.replace('_', ' ')} Bot
                              </Button>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ==================== TRADE LOG TAB ==================== */}
          <TabsContent value="trades">
            <Card className="border-2">
              <CardHeader className="p-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <History className="w-4 h-4" />
                  Trade History
                </CardTitle>
                <CardDescription className="text-xs">
                  Last 100 trades • Total P&L: {formatCurrency(totalProfit)}
                </CardDescription>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                {tradeLogs.length === 0 ? (
                  <div className="text-center py-8">
                    <FileText className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                    <p className="text-muted-foreground">No trades yet</p>
                  </div>
                ) : (
                  <div className="space-y-1 max-h-[400px] overflow-y-auto">
                    {tradeLogs.map((trade, index) => (
                      <div
                        key={trade.id}
                        className={`flex items-center justify-between p-1.5 rounded text-xs ${
                          trade.result === 'win' ? 'bg-green-500/10' :
                          trade.result === 'loss' ? 'bg-red-500/10' :
                          'bg-yellow-500/10'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-1">
                          <span className="text-muted-foreground text-[8px] w-16">
                            {formatTime(trade.timestamp)}
                          </span>
                          <Badge variant="outline" className="text-[6px] px-1 py-0">
                            {trade.botName}
                          </Badge>
                          <span className="text-[8px]">
                            {trade.entryType} {trade.entryValue}
                          </span>
                          {trade.digit !== undefined && (
                            <span className="text-[8px] text-muted-foreground">
                              → {trade.digit}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[8px] font-mono">
                            {formatCurrency(trade.stake)}
                          </span>
                          {trade.martingaleStep > 0 && (
                            <Badge className="text-[6px] px-1 py-0 bg-orange-500/20 text-orange-500">
                              R{trade.martingaleStep}
                            </Badge>
                          )}
                          <span className={`text-[8px] font-bold w-16 text-right ${
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
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          {/* ==================== STATISTICS TAB ==================== */}
          <TabsContent value="stats">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Session Statistics */}
              <Card className="border-2">
                <CardHeader className="p-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Session Statistics
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/30 rounded-lg p-2">
                      <div className="text-muted-foreground text-[10px]">Session Started</div>
                      <div className="font-bold text-sm">{formatTime(sessionStats.startTime)}</div>
                    </div>
                    <div className="bg-muted/30 rounded-lg p-2">
                      <div className="text-muted-foreground text-[10px]">Duration</div>
                      <div className="font-bold text-sm">
                        {Math.floor((Date.now() - sessionStats.startTime.getTime()) / 60000)}m
                      </div>
                    </div>
                  </div>
                  
                  <Separator />
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-muted-foreground text-[10px]">Total P&L</div>
                      <div className={`text-xl font-bold ${totalProfit >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                        {formatCurrency(totalProfit)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">Win Rate</div>
                      <div className="text-xl font-bold">{formatPercentage(winRate)}</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-3 gap-1 text-center">
                    <div className="bg-muted/30 rounded p-1">
                      <div className="text-muted-foreground text-[8px]">Trades</div>
                      <div className="font-bold">{totalTrades}</div>
                    </div>
                    <div className="bg-muted/30 rounded p-1">
                      <div className="text-muted-foreground text-[8px]">Wins</div>
                      <div className="font-bold text-green-500">{totalWins}</div>
                    </div>
                    <div className="bg-muted/30 rounded p-1">
                      <div className="text-muted-foreground text-[8px]">Losses</div>
                      <div className="font-bold text-red-500">{totalTrades - totalWins}</div>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-muted-foreground text-[10px]">Max Win</div>
                      <div className="font-bold text-green-500">{formatCurrency(sessionStats.maxWin)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground text-[10px]">Max Loss</div>
                      <div className="font-bold text-red-500">{formatCurrency(Math.abs(sessionStats.maxLoss))}</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
              
              {/* Bot Performance */}
              <Card className="border-2">
                <CardHeader className="p-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Gauge className="w-4 h-4" />
                    Bot Performance
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {bots.length === 0 ? (
                      <p className="text-center text-muted-foreground text-xs py-4">No bots created</p>
                    ) : (
                      bots.map(bot => {
                        const botWinRate = bot.trades > 0 ? (bot.wins / bot.trades) * 100 : 0;
                        const style = BOT_STYLES[bot.type];
                        
                        return (
                          <div key={bot.id} className={`border rounded-lg p-2 ${style.bg}`}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1">
                                <span className="text-sm">{VOLATILITY_MARKETS.find(m => m.value === bot.market)?.icon}</span>
                                <span className="text-xs font-medium">{bot.market}</span>
                                <Badge className={`text-[6px] px-1 py-0 ${style.badge}`}>
                                  {bot.type.replace('_', ' ')}
                                </Badge>
                              </div>
                              <span className={`text-xs font-bold ${bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {formatCurrency(bot.totalPnl)}
                              </span>
                            </div>
                            
                            <div className="grid grid-cols-4 gap-1 text-[8px] mb-1">
                              <div>
                                <span className="text-muted-foreground">Trades:</span>
                                <span className="ml-1 font-bold">{bot.trades}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Wins:</span>
                                <span className="ml-1 font-bold text-green-500">{bot.wins}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Losses:</span>
                                <span className="ml-1 font-bold text-red-500">{bot.losses}</span>
                              </div>
                              <div>
                                <span className="text-muted-foreground">Win%:</span>
                                <span className="ml-1 font-bold">{botWinRate.toFixed(0)}%</span>
                              </div>
                            </div>
                            
                            <Progress value={botWinRate} className="h-1" />
                          </div>
                        );
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
              
              {/* Market Conditions Summary */}
              <Card className="border-2 md:col-span-2">
                <CardHeader className="p-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ListChecks className="w-4 h-4" />
                    Market Conditions Summary
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 pt-0">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-emerald-500/10 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <TrendingDown className="w-3 h-3 text-emerald-500" />
                        <span className="text-[10px] font-medium">Low 0-1-2</span>
                      </div>
                      <div className="text-lg font-bold text-emerald-500">
                        {Object.values(scanResults).filter(a => a.conditions.low012).length}
                      </div>
                      <div className="text-[8px] text-muted-foreground">markets</div>
                    </div>
                    
                    <div className="bg-blue-500/10 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <TrendingUp className="w-3 h-3 text-blue-500" />
                        <span className="text-[10px] font-medium">Low 7-8-9</span>
                      </div>
                      <div className="text-lg font-bold text-blue-500">
                        {Object.values(scanResults).filter(a => a.conditions.low789).length}
                      </div>
                      <div className="text-[8px] text-muted-foreground">markets</div>
                    </div>
                    
                    <div className="bg-purple-500/10 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <CircleDot className="w-3 h-3 text-purple-500" />
                        <span className="text-[10px] font-medium">Even >55%</span>
                      </div>
                      <div className="text-lg font-bold text-purple-500">
                        {Object.values(scanResults).filter(a => a.conditions.evenDominant).length}
                      </div>
                      <div className="text-[8px] text-muted-foreground">markets</div>
                    </div>
                    
                    <div className="bg-orange-500/10 rounded-lg p-2">
                      <div className="flex items-center gap-1 mb-1">
                        <Hash className="w-3 h-3 text-orange-500" />
                        <span className="text-[10px] font-medium">Odd + Digit 4</span>
                      </div>
                      <div className="text-lg font-bold text-orange-500">
                        {Object.values(scanResults).filter(a => a.conditions.digit4Focus).length}
                      </div>
                      <div className="text-[8px] text-muted-foreground">markets</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        
        {/* Manual Bot Creation Modal */}
        <AnimatePresence>
          {showBotTypeModal && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center"
              onClick={() => setShowBotTypeModal(false)}
            >
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                className="bg-card border-2 rounded-lg p-4 max-w-md w-full"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-sm font-medium mb-3">Select Bot Type</h3>
                <div className="space-y-2">
                  {Object.entries(BOT_STYLES).map(([type, style]) => (
                    <Button
                      key={type}
                      variant="outline"
                      className="w-full justify-start h-auto p-2"
                      onClick={() => {
                        const analysis = scanResults[selectedMarketForManual] || {
                          symbol: selectedMarketForManual,
                          counts: {},
                          percentages: { low012: 0, high789: 0, even: 0, odd: 0 },
                          mostFrequent: { digit: 0, percentage: 0 },
                          leastFrequent: { digit: 0, percentage: 0 },
                          conditions: {
                            low012: false,
                            low789: false,
                            evenDominant: false,
                            oddDominant: false,
                            digit4Focus: false
                          },
                          recommendedBot: { 
                            type: type as any, 
                            entry: type === 'EVEN_BOT' ? 'EVEN' : type === 'ODD_BOT' ? 4 : 0,
                            description: 'Manual creation',
                            confidence: 50
                          },
                          volatility: 'MEDIUM',
                          timestamp: new Date()
                        };
                        createBotFromAnalysis(selectedMarketForManual, analysis);
                        setShowBotTypeModal(false);
                      }}
                    >
                      <div className={`p-1.5 rounded-lg ${style.badge} mr-2`}>
                        {style.icon}
                      </div>
                      <div className="text-left">
                        <div className="text-xs font-medium">{style.name}</div>
                        <div className="text-[8px] text-muted-foreground">
                          {type === 'TYPE_A' && 'For markets with low 0,1,2 digits'}
                          {type === 'TYPE_B' && 'For markets with low 7,8,9 digits'}
                          {type === 'EVEN_BOT' && 'For markets with even >55%'}
                          {type === 'ODD_BOT' && 'For markets with odd >55% and digit 4 focus'}
                        </div>
                      </div>
                    </Button>
                  ))}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => setShowBotTypeModal(false)}
                >
                  Cancel
                </Button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </TooltipProvider>
  );
}
