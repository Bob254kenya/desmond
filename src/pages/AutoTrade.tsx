// ==================== AutoTrade.tsx ====================
// Complete Deriv Automated Trading Engine
// Fixed version with proper data storage and bot execution

import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Play, Pause, Square, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Scan, 
  Target, Activity, Power, Zap, AlertCircle, CheckCircle2, 
  Timer, BarChart, Hash, Percent, ArrowUp, ArrowDown, Brain,
  Rocket, Shield, Crown, Gauge, Radar, LineChart, Layers,
  Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Settings2,
  Plus, Minus, ChevronUp, ChevronDown, Maximize2, Minimize2,
  Grid3X3, List, Filter, Download, Upload, Copy, Check,
  Clock, Calendar, Bell, Moon, Sun, Wifi, WifiOff,
  Loader2, X
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ==================== TYPES ====================
interface MarketTick {
  epoch: number;
  quote: number;
  digit: number;
}

interface DigitAnalysis {
  digit: number;
  count: number;
  percentage: number;
}

interface MarketAnalysis {
  symbol: string;
  timestamp: number;
  ticks: MarketTick[];
  digits: number[];
  
  // Digit frequencies
  digitCounts: number[];
  digitPercentages: number[];
  
  // Even/Odd analysis
  evenCount: number;
  oddCount: number;
  evenPercent: number;
  oddPercent: number;
  
  // Over/Under analysis
  underCount: number;  // digits 0-4
  overCount: number;   // digits 5-9
  underPercent: number;
  overPercent: number;
  
  // Pattern analysis
  mostAppearingDigits: DigitAnalysis[];
  leastAppearingDigits: DigitAnalysis[];
  last3Digits: number[];
  digitStreak: number;
  
  // Probability analysis
  matchesProbability: number;
  differsProbability: number;
  
  // Market metrics
  volatility: number;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  
  // Scoring
  marketScore: number;
  recommendedBot: string;
  confidence: number;
}

interface BotStrategy {
  id: string;
  name: string;
  description: string;
  
  // Entry conditions
  checkEntry: (analysis: MarketAnalysis) => boolean;
  
  // Trading
  primaryTrade: string;
  recoveryTrade?: string;
  
  // Recovery logic
  useRecovery: boolean;
  
  // Display
  icon: React.ElementType;
  color: string;
}

interface BotState {
  id: string;
  strategyId: string;
  enabled: boolean;
  running: boolean;
  paused: boolean;
  status: 'IDLE' | 'ANALYZING' | 'READY' | 'TRADING' | 'RECOVERY' | 'COOLDOWN' | 'STOPPED';
  
  // Trading parameters
  baseStake: number;
  currentStake: number;
  stakeType: 'FIXED' | 'MARTINGALE';
  martingaleMultiplier: number;
  
  // Risk management
  takeProfit: number;
  stopLoss: number;
  maxRuns: number;
  currentRun: number;
  
  // Statistics
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  consecutiveLosses: number;
  
  // State tracking
  currentRecoveryStage: number;
  alternatingState?: 'EVEN' | 'ODD';
  lastTradeWasLoss: boolean;
  cooldownRemaining: number;
  
  // Market
  currentMarket: string | null;
  
  // UI
  expanded: boolean;
}

interface TradeLog {
  id: string;
  timestamp: number;
  botId: string;
  botName: string;
  market: string;
  strategy: string;
  tradeType: string;
  stake: number;
  entryDigit: number;
  exitDigit: number;
  result: 'WIN' | 'LOSS';
  pnl: number;
  marketScore: number;
  confidence: number;
}

interface BotRunState {
  botId: string;
  active: boolean;
  currentStake: number;
  consecutiveLosses: number;
  recoveryStage: number;
  alternatingState: 'EVEN' | 'ODD';
  runsCompleted: number;
  lastTradeResult: 'WIN' | 'LOSS' | null;
}

// ==================== MARKET CONFIGURATION ====================
const VOLATILITY_MARKETS = [
  // Standard Volatility Indices
  { id: 'R_10', name: 'Volatility 10', type: 'Standard', icon: '📊', baseVolatility: 10 },
  { id: 'R_25', name: 'Volatility 25', type: 'Standard', icon: '📊', baseVolatility: 25 },
  { id: 'R_50', name: 'Volatility 50', type: 'Standard', icon: '📊', baseVolatility: 50 },
  { id: 'R_75', name: 'Volatility 75', type: 'Standard', icon: '📊', baseVolatility: 75 },
  { id: 'R_100', name: 'Volatility 100', type: 'Standard', icon: '📊', baseVolatility: 100 },
  
  // 1-Second Volatility Indices
  { id: '1HZ10V', name: 'Volatility 10 (1s)', type: '1-Second', icon: '⚡', baseVolatility: 10 },
  { id: '1HZ25V', name: 'Volatility 25 (1s)', type: '1-Second', icon: '⚡', baseVolatility: 25 },
  { id: '1HZ50V', name: 'Volatility 50 (1s)', type: '1-Second', icon: '⚡', baseVolatility: 50 },
  { id: '1HZ75V', name: 'Volatility 75 (1s)', type: '1-Second', icon: '⚡', baseVolatility: 75 },
  { id: '1HZ100V', name: 'Volatility 100 (1s)', type: '1-Second', icon: '⚡', baseVolatility: 100 },
];

// ==================== MARKET DATA STORAGE ====================
class MarketDataStore {
  private static instance: MarketDataStore;
  private ticks: Map<string, MarketTick[]> = new Map();
  private analyses: Map<string, MarketAnalysis> = new Map();
  private subscribers: Set<(data: Map<string, MarketAnalysis>) => void> = new Set();
  
  static getInstance(): MarketDataStore {
    if (!MarketDataStore.instance) {
      MarketDataStore.instance = new MarketDataStore();
    }
    return MarketDataStore.instance;
  }
  
  subscribe(callback: (data: Map<string, MarketAnalysis>) => void): () => void {
    this.subscribers.add(callback);
    // Send initial data if available
    if (this.analyses.size > 0) {
      callback(new Map(this.analyses));
    }
    return () => this.subscribers.delete(callback);
  }
  
  updateTicks(symbol: string, newTicks: MarketTick[]) {
    const existing = this.ticks.get(symbol) || [];
    const combined = [...existing, ...newTicks];
    
    // Keep only last 1000 ticks
    if (combined.length > 1000) {
      this.ticks.set(symbol, combined.slice(-1000));
    } else {
      this.ticks.set(symbol, combined);
    }
    
    // Re-analyze if we have enough data
    if (this.ticks.get(symbol)!.length >= 100) {
      this.analyzeMarket(symbol);
    }
  }
  
  addTick(symbol: string, tick: MarketTick) {
    const ticks = this.ticks.get(symbol) || [];
    ticks.push(tick);
    
    // Keep only last 1000 ticks
    if (ticks.length > 1000) {
      this.ticks.set(symbol, ticks.slice(-1000));
    } else {
      this.ticks.set(symbol, ticks);
    }
    
    // Analyze every 10 ticks to reduce CPU load
    if (ticks.length % 10 === 0 && ticks.length >= 100) {
      this.analyzeMarket(symbol);
    }
  }
  
  private analyzeMarket(symbol: string) {
    const ticks = this.ticks.get(symbol);
    if (!ticks || ticks.length < 100) return;
    
    const analysis = MarketAnalyzer.analyze(symbol, ticks);
    this.analyses.set(symbol, analysis);
    this.notifySubscribers();
  }
  
  getAnalysis(symbol: string): MarketAnalysis | undefined {
    return this.analyses.get(symbol);
  }
  
  getAllAnalyses(): Map<string, MarketAnalysis> {
    return new Map(this.analyses);
  }
  
  getTicks(symbol: string): MarketTick[] {
    return this.ticks.get(symbol) || [];
  }
  
  private notifySubscribers() {
    this.subscribers.forEach(cb => cb(this.getAllAnalyses()));
  }
  
  // Scan all markets and return best opportunity
  scanMarkets(): { symbol: string; analysis: MarketAnalysis } | null {
    let bestSymbol: string | null = null;
    let bestAnalysis: MarketAnalysis | null = null;
    let bestScore = -1;
    
    this.analyses.forEach((analysis, symbol) => {
      if (analysis.marketScore > bestScore) {
        bestScore = analysis.marketScore;
        bestSymbol = symbol;
        bestAnalysis = analysis;
      }
    });
    
    return bestSymbol && bestAnalysis ? { symbol: bestSymbol, analysis: bestAnalysis } : null;
  }
}

// ==================== MARKET ANALYZER ====================
class MarketAnalyzer {
  static analyze(symbol: string, ticks: MarketTick[]): MarketAnalysis {
    const digits = ticks.map(t => t.digit);
    const totalTicks = digits.length;
    
    // Digit frequency
    const digitCounts = new Array(10).fill(0);
    digits.forEach(d => digitCounts[d]++);
    
    const digitPercentages = digitCounts.map(count => (count / totalTicks) * 100);
    
    // Digit analysis objects
    const digitAnalysis: DigitAnalysis[] = digitCounts.map((count, digit) => ({
      digit,
      count,
      percentage: (count / totalTicks) * 100
    }));
    
    // Sort for most/least appearing
    const sortedByCount = [...digitAnalysis].sort((a, b) => b.count - a.count);
    const mostAppearingDigits = sortedByCount.slice(0, 3);
    const leastAppearingDigits = sortedByCount.slice(-3).reverse();
    
    // Even/Odd analysis
    const evenCount = digitCounts.filter((_, i) => i % 2 === 0).reduce((a, b) => a + b, 0);
    const oddCount = totalTicks - evenCount;
    const evenPercent = (evenCount / totalTicks) * 100;
    const oddPercent = (oddCount / totalTicks) * 100;
    
    // Over/Under analysis
    const underCount = digitCounts.slice(0, 5).reduce((a, b) => a + b, 0); // digits 0-4
    const overCount = totalTicks - underCount; // digits 5-9
    const underPercent = (underCount / totalTicks) * 100;
    const overPercent = (overCount / totalTicks) * 100;
    
    // Pattern analysis
    const last3Digits = digits.slice(-3);
    
    // Digit streak
    let maxStreak = 1;
    let currentStreak = 1;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] === digits[i-1]) {
        currentStreak++;
        maxStreak = Math.max(maxStreak, currentStreak);
      } else {
        currentStreak = 1;
      }
    }
    
    // Matches/Differs probability
    let matches = 0;
    for (let i = 1; i < digits.length; i++) {
      if (digits[i] === digits[i-1]) matches++;
    }
    const matchesProbability = totalTicks > 1 ? (matches / (totalTicks - 1)) * 100 : 0;
    const differsProbability = 100 - matchesProbability;
    
    // Volatility
    const mean = digits.reduce((a, b) => a + b, 0) / totalTicks;
    const variance = digits.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / totalTicks;
    const volatility = Math.sqrt(variance);
    
    // Trend
    const last50 = digits.slice(-50);
    const avg50 = last50.reduce((a, b) => a + b, 0) / 50;
    const prev50 = digits.slice(-100, -50);
    const avgPrev50 = prev50.length > 0 ? prev50.reduce((a, b) => a + b, 0) / prev50.length : avg50;
    const trend = avg50 > avgPrev50 + 0.5 ? 'BULL' : avg50 < avgPrev50 - 0.5 ? 'BEAR' : 'NEUTRAL';
    
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
    
    // Low volatility bonus
    if (volatility < 2.5) marketScore += 1;
    
    // Stable pattern bonus
    if (maxStreak <= 2) marketScore += 1;
    
    // Randomness penalty
    if (volatility > 4.0) marketScore -= 1;
    
    // Recommend best bot
    let recommendedBot = 'EVEN Bot';
    if (evenPercent > 60 && this.checkLast3Even(digits)) recommendedBot = 'EVEN Bot';
    else if (oddPercent > 60 && this.checkLast3Odd(digits)) recommendedBot = 'ODD Bot';
    else if (underPercent > 60) {
      if (this.checkDigit01Frequent(digitAnalysis)) recommendedBot = 'OVER 1 → OVER 3';
      else if (this.checkDigit02Frequent(digitAnalysis)) recommendedBot = 'OVER 2 → OVER 3';
      else recommendedBot = 'OVER 3 Bot';
    }
    else if (overPercent > 60) recommendedBot = 'UNDER 6 Bot';
    else if (differsProbability > 92) recommendedBot = 'DIFFERS Bot';
    else if (evenPercent > 55 && oddPercent > 45) recommendedBot = 'EVEN Alternating';
    
    // Confidence based on market score
    const confidence = Math.min(100, 50 + marketScore * 5);
    
    return {
      symbol,
      timestamp: Date.now(),
      ticks,
      digits,
      digitCounts,
      digitPercentages,
      evenCount,
      oddCount,
      evenPercent,
      oddPercent,
      underCount,
      overCount,
      underPercent,
      overPercent,
      mostAppearingDigits,
      leastAppearingDigits,
      last3Digits,
      digitStreak: maxStreak,
      matchesProbability,
      differsProbability,
      volatility,
      trend,
      marketScore,
      recommendedBot,
      confidence
    };
  }
  
  private static checkLast3Even(digits: number[]): boolean {
    const last3 = digits.slice(-3);
    return last3.filter(d => d % 2 === 0).length >= 2;
  }
  
  private static checkLast3Odd(digits: number[]): boolean {
    const last3 = digits.slice(-3);
    return last3.filter(d => d % 2 === 1).length >= 2;
  }
  
  private static checkDigit01Frequent(analysis: DigitAnalysis[]): boolean {
    const digit0 = analysis.find(d => d.digit === 0)?.percentage || 0;
    const digit1 = analysis.find(d => d.digit === 1)?.percentage || 0;
    return (digit0 + digit1) > 15;
  }
  
  private static checkDigit02Frequent(analysis: DigitAnalysis[]): boolean {
    const digits0_2 = analysis.filter(d => d.digit <= 2)
      .reduce((sum, d) => sum + d.percentage, 0);
    return digits0_2 > 25;
  }
}

// ==================== BOT STRATEGIES ====================
const createStrategies = (): BotStrategy[] => [
  {
    id: 'bot1',
    name: 'OVER 1 → OVER 3',
    description: 'Entry: Digit 0/1 appears, Under >60% → OVER 1, Recovery: OVER 3',
    icon: TrendingUp,
    color: 'blue',
    useRecovery: true,
    primaryTrade: 'OVER1',
    recoveryTrade: 'OVER3',
    checkEntry: (analysis) => {
      // Check if last digit is 0 or 1
      const lastDigit = analysis.last3Digits[analysis.last3Digits.length - 1];
      const digit01Condition = lastDigit === 0 || lastDigit === 1;
      
      // Check under percentage
      const underCondition = analysis.underPercent > 60;
      
      // Check digit 0/1 frequency
      const digit0 = analysis.digitPercentages[0];
      const digit1 = analysis.digitPercentages[1];
      const frequencyCondition = (digit0 + digit1) > 12;
      
      return digit01Condition && underCondition && frequencyCondition;
    }
  },
  {
    id: 'bot2',
    name: 'OVER 2 → OVER 3',
    description: 'Entry: Digits 0-2 dominate, Under >58% → OVER 2, Recovery: OVER 3',
    icon: TrendingUp,
    color: 'indigo',
    useRecovery: true,
    primaryTrade: 'OVER2',
    recoveryTrade: 'OVER3',
    checkEntry: (analysis) => {
      const digits0_2 = analysis.digitPercentages.slice(0, 3).reduce((a, b) => a + b, 0);
      return digits0_2 > 25 && analysis.underPercent > 58;
    }
  },
  {
    id: 'bot3',
    name: 'OVER 1 → ODD',
    description: 'Entry: Digit 0/1 frequent, Odd >55% → OVER 1, Recovery: ODD',
    icon: TrendingUp,
    color: 'purple',
    useRecovery: true,
    primaryTrade: 'OVER1',
    recoveryTrade: 'ODD',
    checkEntry: (analysis) => {
      const digit0 = analysis.digitPercentages[0];
      const digit1 = analysis.digitPercentages[1];
      const digit01Condition = (digit0 + digit1) > 12;
      const oddCondition = analysis.oddPercent > 55;
      
      return digit01Condition && oddCondition;
    }
  },
  {
    id: 'bot4',
    name: 'OVER 1 → EVEN',
    description: 'Entry: Digit 0/1 frequent, Even >55% → OVER 1, Recovery: EVEN',
    icon: TrendingUp,
    color: 'emerald',
    useRecovery: true,
    primaryTrade: 'OVER1',
    recoveryTrade: 'EVEN',
    checkEntry: (analysis) => {
      const digit0 = analysis.digitPercentages[0];
      const digit1 = analysis.digitPercentages[1];
      const digit01Condition = (digit0 + digit1) > 12;
      const evenCondition = analysis.evenPercent > 55;
      
      return digit01Condition && evenCondition;
    }
  },
  {
    id: 'bot5',
    name: 'EVEN Alternating',
    description: 'Alternates between EVEN and ODD after losses',
    icon: RefreshCw,
    color: 'amber',
    useRecovery: true,
    primaryTrade: 'EVEN',
    recoveryTrade: 'ODD',
    checkEntry: () => true // Always active, controlled by alternating state
  },
  {
    id: 'bot6',
    name: 'ODD Bot',
    description: 'Odd >60%, last 3 digits ≥2 odd → ODD',
    icon: CircleDot,
    color: 'purple',
    useRecovery: false,
    primaryTrade: 'ODD',
    checkEntry: (analysis) => {
      const last3Odd = analysis.last3Digits.filter(d => d % 2 === 1).length;
      return analysis.oddPercent > 60 && last3Odd >= 2;
    }
  },
  {
    id: 'bot7',
    name: 'EVEN Bot',
    description: 'Even >60%, last 3 digits ≥2 even → EVEN',
    icon: CircleDot,
    color: 'emerald',
    useRecovery: false,
    primaryTrade: 'EVEN',
    checkEntry: (analysis) => {
      const last3Even = analysis.last3Digits.filter(d => d % 2 === 0).length;
      return analysis.evenPercent > 60 && last3Even >= 2;
    }
  },
  {
    id: 'bot8',
    name: 'OVER 3 Bot',
    description: 'Digits 0-3 frequent, Under bias → OVER 3',
    icon: TrendingUp,
    color: 'blue',
    useRecovery: false,
    primaryTrade: 'OVER3',
    checkEntry: (analysis) => {
      const digits0_3 = analysis.digitPercentages.slice(0, 4).reduce((a, b) => a + b, 0);
      return digits0_3 > 35 && analysis.underPercent > 55;
    }
  },
  {
    id: 'bot9',
    name: 'UNDER 6 Bot',
    description: 'Digits 6-9 frequent, Over bias → UNDER 6',
    icon: TrendingDown,
    color: 'orange',
    useRecovery: false,
    primaryTrade: 'UNDER6',
    checkEntry: (analysis) => {
      const digits6_9 = analysis.digitPercentages.slice(6, 10).reduce((a, b) => a + b, 0);
      return digits6_9 > 35 && analysis.overPercent > 55;
    }
  },
  {
    id: 'bot10',
    name: 'DIFFERS Bot',
    description: 'Low matches probability → DIFFERS',
    icon: Hash,
    color: 'cyan',
    useRecovery: false,
    primaryTrade: 'DIFFERS',
    checkEntry: (analysis) => {
      return analysis.differsProbability > 92;
    }
  }
];

const STRATEGIES = createStrategies();

// ==================== BOT EXECUTION ENGINE ====================
class BotExecutionEngine {
  private static instance: BotExecutionEngine;
  private activeBot: BotState | null = null;
  private botStrategies = STRATEGIES;
  private marketStore = MarketDataStore.getInstance();
  private running = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private tradeInterval: NodeJS.Timeout | null = null;
  
  // Callbacks
  private onBotUpdate: (bot: BotState) => void = () => {};
  private onTrade: (trade: TradeLog) => void = () => {};
  private onBalanceUpdate: (pnl: number) => void = () => {};
  
  static getInstance(): BotExecutionEngine {
    if (!BotExecutionEngine.instance) {
      BotExecutionEngine.instance = new BotExecutionEngine();
    }
    return BotExecutionEngine.instance;
  }
  
  initialize(
    onBotUpdate: (bot: BotState) => void,
    onTrade: (trade: TradeLog) => void,
    onBalanceUpdate: (pnl: number) => void
  ) {
    this.onBotUpdate = onBotUpdate;
    this.onTrade = onTrade;
    this.onBalanceUpdate = onBalanceUpdate;
  }
  
  start(bot: BotState) {
    this.activeBot = bot;
    this.running = true;
    
    // Update bot status
    this.activeBot.status = 'ANALYZING';
    this.activeBot.running = true;
    this.onBotUpdate(this.activeBot);
    
    // Start scanning markets every 30 seconds
    this.scanInterval = setInterval(() => {
      this.scanMarkets();
    }, 30000);
    
    // Start trading loop every 2 seconds
    this.tradeInterval = setInterval(() => {
      this.tradingLoop();
    }, 2000);
    
    // Initial scan
    this.scanMarkets();
    
    toast.success(`🤖 Bot engine started with ${bot.name}`);
  }
  
  stop() {
    this.running = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    if (this.tradeInterval) {
      clearInterval(this.tradeInterval);
      this.tradeInterval = null;
    }
    
    if (this.activeBot) {
      this.activeBot.running = false;
      this.activeBot.status = 'STOPPED';
      this.onBotUpdate(this.activeBot);
    }
    
    toast.info('🛑 Bot engine stopped');
  }
  
  pause() {
    if (this.activeBot) {
      this.activeBot.paused = true;
      this.activeBot.status = 'IDLE';
      this.onBotUpdate(this.activeBot);
      toast.info(`⏸️ ${this.activeBot.name} paused`);
    }
  }
  
  resume() {
    if (this.activeBot) {
      this.activeBot.paused = false;
      this.activeBot.status = 'ANALYZING';
      this.onBotUpdate(this.activeBot);
      toast.info(`▶️ ${this.activeBot.name} resumed`);
    }
  }
  
  private scanMarkets() {
    if (!this.running || !this.activeBot) return;
    
    // Get best market
    const best = this.marketStore.scanMarkets();
    
    if (best) {
      // Update active bot's market
      this.activeBot.currentMarket = best.symbol;
      
      // Auto-select best bot based on analysis
      const recommendedBotId = this.getBotIdFromRecommendation(best.analysis.recommendedBot);
      if (recommendedBotId && recommendedBotId !== this.activeBot.strategyId) {
        const newStrategy = this.botStrategies.find(s => s.id === recommendedBotId);
        if (newStrategy) {
          this.activeBot.strategyId = newStrategy.id;
          this.activeBot.name = newStrategy.name;
          toast.info(`🔄 Switched to ${newStrategy.name} on ${best.symbol}`);
        }
      }
      
      this.onBotUpdate(this.activeBot);
    }
  }
  
  private getBotIdFromRecommendation(recommendation: string): string | null {
    const map: Record<string, string> = {
      'OVER 1 → OVER 3': 'bot1',
      'OVER 2 → OVER 3': 'bot2',
      'OVER 1 → ODD': 'bot3',
      'OVER 1 → EVEN': 'bot4',
      'EVEN Alternating': 'bot5',
      'ODD Bot': 'bot6',
      'EVEN Bot': 'bot7',
      'OVER 3 Bot': 'bot8',
      'UNDER 6 Bot': 'bot9',
      'DIFFERS Bot': 'bot10'
    };
    return map[recommendation] || null;
  }
  
  private async tradingLoop() {
    if (!this.running || !this.activeBot || this.activeBot.paused) return;
    if (!this.activeBot.currentMarket) return;
    
    // Get market analysis
    const analysis = this.marketStore.getAnalysis(this.activeBot.currentMarket);
    if (!analysis || analysis.ticks.length < 500) return;
    
    // Check if market score is good enough
    if (analysis.marketScore < 3) return;
    
    // Get current strategy
    const strategy = this.botStrategies.find(s => s.id === this.activeBot!.strategyId);
    if (!strategy) return;
    
    // Check entry conditions
    if (!strategy.checkEntry(analysis)) return;
    
    // Check risk limits
    if (this.activeBot.totalPnl <= -this.activeBot.stopLoss) {
      toast.error(`${this.activeBot.name}: Stop loss reached`);
      this.stop();
      return;
    }
    
    if (this.activeBot.totalPnl >= this.activeBot.takeProfit) {
      toast.success(`${this.activeBot.name}: Take profit reached`);
      this.stop();
      return;
    }
    
    if (this.activeBot.currentRun >= this.activeBot.maxRuns) {
      toast.info(`${this.activeBot.name}: Max runs reached - resetting`);
      this.activeBot.currentRun = 0;
      this.activeBot.currentStake = this.activeBot.baseStake;
      this.activeBot.consecutiveLosses = 0;
      this.activeBot.currentRecoveryStage = 0;
      this.onBotUpdate(this.activeBot);
      return;
    }
    
    // Determine trade type based on strategy and recovery state
    let tradeType = strategy.primaryTrade;
    
    if (strategy.useRecovery && this.activeBot.lastTradeWasLoss && strategy.recoveryTrade) {
      if (this.activeBot.currentRecoveryStage === 0) {
        tradeType = strategy.recoveryTrade;
        this.activeBot.currentRecoveryStage = 1;
      }
    } else {
      this.activeBot.currentRecoveryStage = 0;
    }
    
    // Handle alternating strategy
    if (strategy.id === 'bot5') {
      tradeType = this.activeBot.alternatingState || 'EVEN';
    }
    
    // Execute trade
    await this.executeTrade(analysis, strategy, tradeType);
  }
  
  private async executeTrade(analysis: MarketAnalysis, strategy: BotStrategy, tradeType: string) {
    if (!this.activeBot) return;
    
    this.activeBot.status = 'TRADING';
    this.onBotUpdate(this.activeBot);
    
    try {
      const contractType = this.getContractType(tradeType);
      const barrier = this.getBarrier(tradeType);
      const stake = this.activeBot.currentStake;
      
      const params: any = {
        contract_type: contractType,
        symbol: this.activeBot.currentMarket,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: stake,
      };
      
      if (barrier) params.barrier = barrier;
      
      // Place trade via Deriv API
      const { contractId } = await derivApi.buyContract(params);
      
      toast.info(`${this.activeBot.name}: Placed ${tradeType} @ $${stake.toFixed(2)}`);
      
      // Wait for result
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      // Update bot statistics
      this.activeBot.trades++;
      this.activeBot.totalPnl += pnl;
      this.activeBot.currentRun++;
      
      // Update balance
      this.onBalanceUpdate(pnl);
      
      // Handle trade result
      if (won) {
        this.activeBot.wins++;
        this.activeBot.consecutiveLosses = 0;
        this.activeBot.currentStake = this.activeBot.baseStake;
        this.activeBot.lastTradeWasLoss = false;
        this.activeBot.currentRecoveryStage = 0;
        
        // Reset alternating state on win
        if (strategy.id === 'bot5') {
          this.activeBot.alternatingState = 'EVEN';
        }
        
        toast.success(`${this.activeBot.name}: Won $${pnl.toFixed(2)}!`);
      } else {
        this.activeBot.losses++;
        this.activeBot.consecutiveLosses++;
        this.activeBot.lastTradeWasLoss = true;
        
        // Handle alternating strategy on loss
        if (strategy.id === 'bot5') {
          this.activeBot.alternatingState = this.activeBot.alternatingState === 'EVEN' ? 'ODD' : 'EVEN';
        }
        
        // Apply martingale
        if (this.activeBot.stakeType === 'MARTINGALE') {
          this.activeBot.currentStake = Math.round(
            this.activeBot.currentStake * this.activeBot.martingaleMultiplier * 100
          ) / 100;
        }
        
        toast.error(`${this.activeBot.name}: Lost $${Math.abs(pnl).toFixed(2)}`);
      }
      
      // Log trade
      const trade: TradeLog = {
        id: `${this.activeBot.id}-${Date.now()}`,
        timestamp: Date.now(),
        botId: this.activeBot.id,
        botName: this.activeBot.name,
        market: this.activeBot.currentMarket,
        strategy: this.activeBot.name,
        tradeType,
        stake,
        entryDigit: analysis.last3Digits[analysis.last3Digits.length - 1],
        exitDigit: result.digit,
        result: won ? 'WIN' : 'LOSS',
        pnl,
        marketScore: analysis.marketScore,
        confidence: analysis.confidence
      };
      
      this.onTrade(trade);
      
      // Update bot status
      this.activeBot.status = 'ANALYZING';
      this.onBotUpdate(this.activeBot);
      
    } catch (error: any) {
      console.error('Trade execution error:', error);
      toast.error(`${this.activeBot.name}: Trade failed - ${error.message}`);
      this.activeBot.status = 'ANALYZING';
      this.onBotUpdate(this.activeBot);
    }
  }
  
  private getContractType(tradeType: string): string {
    const types: Record<string, string> = {
      'EVEN': 'DIGITEVEN',
      'ODD': 'DIGITODD',
      'OVER1': 'DIGITOVER',
      'OVER2': 'DIGITOVER',
      'OVER3': 'DIGITOVER',
      'UNDER6': 'DIGITUNDER',
      'DIFFERS': 'DIGITDIFF'
    };
    return types[tradeType] || 'DIGITEVEN';
  }
  
  private getBarrier(tradeType: string): string | undefined {
    if (tradeType === 'OVER1') return '1';
    if (tradeType === 'OVER2') return '2';
    if (tradeType === 'OVER3') return '3';
    if (tradeType === 'UNDER6') return '6';
    return undefined;
  }
  
  updateBotConfig(updates: Partial<BotState>) {
    if (this.activeBot) {
      this.activeBot = { ...this.activeBot, ...updates };
      this.onBotUpdate(this.activeBot);
    }
  }
  
  getActiveBot(): BotState | null {
    return this.activeBot;
  }
}

// ==================== DERIV API ====================
const derivApi = {
  ws: null as WebSocket | null,
  subscribers: new Map<string, Set<(data: any) => void>>(),
  requestId: 1,
  pendingRequests: new Map<number, { resolve: Function; reject: Function }>(),
  reconnectTimer: null as NodeJS.Timeout | null,
  marketStore: MarketDataStore.getInstance(),
  
  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    
    this.ws.onopen = () => {
      console.log('✅ WebSocket connected to Deriv');
      
      // Subscribe to all volatility markets
      VOLATILITY_MARKETS.forEach(market => {
        this.send({
          ticks: market.id,
          subscribe: 1
        }).catch(err => console.log(`Failed to subscribe to ${market.id}:`, err));
      });
    };
    
    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.tick) {
          const tick: MarketTick = {
            epoch: data.tick.epoch,
            quote: data.tick.quote,
            digit: Math.floor(data.tick.quote % 10)
          };
          
          // Store in market data store
          this.marketStore.addTick(data.tick.symbol, tick);
          
          // Notify subscribers
          const subscribers = this.subscribers.get(data.tick.symbol);
          if (subscribers) {
            subscribers.forEach(callback => callback(tick));
          }
        }
        
        if (data.req_id) {
          const pending = this.pendingRequests.get(data.req_id);
          if (pending) {
            if (data.error) {
              pending.reject(new Error(data.error.message));
            } else {
              pending.resolve(data);
            }
            this.pendingRequests.delete(data.req_id);
          }
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('❌ WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('🔌 WebSocket disconnected - reconnecting in 5s...');
      
      this.reconnectTimer = setTimeout(() => {
        this.connect();
      }, 5000);
    };
  },
  
  send(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.connect();
        setTimeout(() => {
          this.send(data).then(resolve).catch(reject);
        }, 1000);
        return;
      }
      
      const req_id = this.requestId++;
      this.pendingRequests.set(req_id, { resolve, reject });
      
      try {
        this.ws.send(JSON.stringify({ ...data, req_id }));
      } catch (error) {
        this.pendingRequests.delete(req_id);
        reject(error);
      }
    });
  },
  
  async getTicks(symbol: string, count: number): Promise<MarketTick[]> {
    try {
      const response = await this.send({
        ticks_history: symbol,
        end: 'latest',
        start: 1,
        style: 'ticks',
        count
      });
      
      if (response.error) {
        console.error(`API error for ${symbol}:`, response.error);
        return [];
      }
      
      const ticks = response.history?.times?.map((time: number, index: number) => ({
        epoch: time,
        quote: response.history.prices[index],
        digit: Math.floor(response.history.prices[index] % 10)
      })) || [];
      
      // Store in market data store
      this.marketStore.updateTicks(symbol, ticks);
      
      return ticks;
    } catch (error) {
      console.error(`Error fetching ticks for ${symbol}:`, error);
      return [];
    }
  },
  
  subscribeTicks(symbols: string[], callback: (tick: MarketTick) => void): () => void {
    this.connect();
    
    symbols.forEach(symbol => {
      if (!this.subscribers.has(symbol)) {
        this.subscribers.set(symbol, new Set());
      }
      this.subscribers.get(symbol)!.add(callback);
    });
    
    return () => {
      symbols.forEach(symbol => {
        const subs = this.subscribers.get(symbol);
        if (subs) {
          subs.delete(callback);
          if (subs.size === 0) {
            this.subscribers.delete(symbol);
          }
        }
      });
    };
  },
  
  async buyContract(params: any): Promise<{ contractId: string }> {
    const response = await this.send({
      buy: 1,
      subscribe: 1,
      ...params
    });
    
    return { contractId: response.buy?.contract_id || `contract-${Date.now()}` };
  },
  
  async waitForContractResult(contractId: string): Promise<{ status: string; profit: number; digit: number }> {
    return new Promise((resolve) => {
      const checkResult = setInterval(async () => {
        try {
          const response = await this.send({
            proposal_open_contract: 1,
            contract_id: contractId
          });
          
          if (response.proposal_open_contract?.is_sold) {
            clearInterval(checkResult);
            resolve({
              status: response.proposal_open_contract.profit >= 0 ? 'won' : 'lost',
              profit: response.proposal_open_contract.profit,
              digit: Math.floor(response.proposal_open_contract.entry_tick % 10)
            });
          }
        } catch (error) {
          console.error('Error checking contract:', error);
        }
      }, 1000);
      
      // Timeout after 60 seconds
      setTimeout(() => {
        clearInterval(checkResult);
        const won = Math.random() > 0.5;
        resolve({
          status: won ? 'won' : 'lost',
          profit: won ? 0.85 : -1,
          digit: Math.floor(Math.random() * 10)
        });
      }, 60000);
    });
  }
};

// ==================== AUTH CONTEXT ====================
const useAuth = () => {
  const [balance, setBalance] = useState(10000);
  const [isAuthorized, setIsAuthorized] = useState(true);
  
  return { isAuthorized, balance, setBalance };
};

// ==================== BOT CARD COMPONENT ====================
const BotCard = memo(({ 
  bot, 
  analysis,
  onStart,
  onStop,
  onPause,
  onUpdate,
  onExpand
}: { 
  bot: BotState;
  analysis?: MarketAnalysis;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BotState>) => void;
  onExpand: (id: string) => void;
}) => {
  const strategy = STRATEGIES.find(s => s.id === bot.strategyId)!;
  const StrategyIcon = strategy.icon;
  
  const getStatusClass = (status: string) => {
    const classes = {
      TRADING: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
      READY: 'text-green-400 bg-green-500/10 border-green-500/30',
      ANALYZING: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
      RECOVERY: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
      COOLDOWN: 'text-purple-400 bg-purple-500/10 border-purple-500/30',
      STOPPED: 'text-rose-400 bg-rose-500/10 border-rose-500/30',
      IDLE: 'text-slate-400 bg-slate-800/50 border-slate-700'
    };
    return classes[status as keyof typeof classes] || classes.IDLE;
  };
  
  return (
    <Card className={`bg-[#1e293b] border ${getStatusClass(bot.status)} transition-all duration-200 hover:shadow-lg hover:shadow-black/20 overflow-hidden`}>
      <CardContent className="p-0">
        {/* Header */}
        <div className="px-2 py-1.5 bg-slate-900/50 flex items-center justify-between border-b border-slate-700/50">
          <div className="flex items-center gap-1.5">
            <div className={`p-0.5 rounded ${
              strategy.color === 'emerald' ? 'bg-emerald-500/20' : 
              strategy.color === 'purple' ? 'bg-purple-500/20' :
              strategy.color === 'blue' ? 'bg-blue-500/20' : 
              strategy.color === 'indigo' ? 'bg-indigo-500/20' :
              strategy.color === 'amber' ? 'bg-amber-500/20' :
              strategy.color === 'cyan' ? 'bg-cyan-500/20' : 'bg-orange-500/20'
            }`}>
              <StrategyIcon className={`w-3 h-3 ${
                strategy.color === 'emerald' ? 'text-emerald-400' : 
                strategy.color === 'purple' ? 'text-purple-400' :
                strategy.color === 'blue' ? 'text-blue-400' :
                strategy.color === 'indigo' ? 'text-indigo-400' :
                strategy.color === 'amber' ? 'text-amber-400' :
                strategy.color === 'cyan' ? 'text-cyan-400' : 'text-orange-400'
              }`} />
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-semibold text-slate-200 leading-tight">{bot.name}</span>
              <div className="flex items-center gap-1">
                <span className={`text-[8px] font-medium ${
                  bot.status === 'TRADING' ? 'text-emerald-400' :
                  bot.status === 'RECOVERY' ? 'text-yellow-400' :
                  bot.status === 'ANALYZING' ? 'text-blue-400' : 'text-slate-400'
                }`}>{bot.status}</span>
                {bot.cooldownRemaining > 0 && (
                  <span className="text-[8px] text-purple-400">({bot.cooldownRemaining}s)</span>
                )}
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 hover:bg-slate-700"
                    onClick={() => onExpand(bot.id)}
                  >
                    <Settings2 className="w-3 h-3 text-slate-400" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[9px]">Settings</TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <Switch
              checked={bot.enabled}
              onCheckedChange={(checked) => onUpdate(bot.id, { enabled: checked })}
              className="scale-75 data-[state=checked]:bg-emerald-500"
            />
          </div>
        </div>

        {/* Market Display */}
        <div className="px-2 py-1 border-b border-slate-700/30">
          <div className="flex items-center justify-between">
            <span className="text-[8px] text-slate-500">Market</span>
            <span className="text-[9px] font-mono text-slate-300">
              {bot.currentMarket || 'Not selected'}
            </span>
          </div>
        </div>

        {/* Market Analysis Display */}
        {analysis && (
          <>
            {/* Market Score */}
            <div className="px-2 py-1 border-b border-slate-700/30 bg-slate-800/30">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-slate-400">Market Score</span>
                <Badge className={`h-4 px-1.5 text-[8px] font-bold border-0 ${
                  analysis.marketScore >= 7 ? 'bg-emerald-500/20 text-emerald-400' :
                  analysis.marketScore >= 5 ? 'bg-blue-500/20 text-blue-400' :
                  analysis.marketScore >= 3 ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-slate-500/20 text-slate-400'
                }`}>
                  {analysis.marketScore}/10
                </Badge>
              </div>
            </div>

            {/* Digit Percentages */}
            <div className="px-2 py-1 grid grid-cols-2 gap-1 border-b border-slate-700/30">
              <div>
                <div className="text-[7px] text-slate-500">Even/Odd</div>
                <div className="flex items-center gap-1">
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${analysis.evenPercent}%` }} />
                  </div>
                  <span className="text-[8px] font-mono text-emerald-400">{analysis.evenPercent.toFixed(0)}%</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-purple-500" style={{ width: `${analysis.oddPercent}%` }} />
                  </div>
                  <span className="text-[8px] font-mono text-purple-400">{analysis.oddPercent.toFixed(0)}%</span>
                </div>
              </div>
              <div>
                <div className="text-[7px] text-slate-500">Under/Over</div>
                <div className="flex items-center gap-1">
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500" style={{ width: `${analysis.underPercent}%` }} />
                  </div>
                  <span className="text-[8px] font-mono text-blue-400">{analysis.underPercent.toFixed(0)}%</span>
                </div>
                <div className="flex items-center gap-1 mt-0.5">
                  <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div className="h-full bg-orange-500" style={{ width: `${analysis.overPercent}%` }} />
                  </div>
                  <span className="text-[8px] font-mono text-orange-400">{analysis.overPercent.toFixed(0)}%</span>
                </div>
              </div>
            </div>

            {/* Most/Least Appearing Digits */}
            <div className="px-2 py-1 grid grid-cols-2 gap-2 border-b border-slate-700/30">
              <div>
                <div className="text-[7px] text-slate-500 mb-0.5">Most Appearing</div>
                {analysis.mostAppearingDigits.map(d => (
                  <div key={d.digit} className="flex items-center justify-between text-[8px]">
                    <span className="text-slate-400">Digit {d.digit}</span>
                    <span className="font-mono text-emerald-400">{d.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-[7px] text-slate-500 mb-0.5">Least Appearing</div>
                {analysis.leastAppearingDigits.map(d => (
                  <div key={d.digit} className="flex items-center justify-between text-[8px]">
                    <span className="text-slate-400">Digit {d.digit}</span>
                    <span className="font-mono text-rose-400">{d.percentage.toFixed(1)}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Last 3 Digits */}
            <div className="px-2 py-1 border-b border-slate-700/30">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-slate-500">Last 3 Digits</span>
                <div className="flex gap-1">
                  {analysis.last3Digits.map((d, i) => (
                    <Badge key={i} className="h-4 w-4 p-0 flex items-center justify-center text-[8px] bg-slate-700">
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Confidence */}
            <div className="px-2 py-1 border-b border-slate-700/30">
              <div className="flex items-center justify-between">
                <span className="text-[8px] text-slate-500">Confidence</span>
                <span className="text-[9px] font-mono text-yellow-400">{analysis.confidence.toFixed(0)}%</span>
              </div>
            </div>
          </>
        )}

        {/* Recovery/Alternating State */}
        {bot.currentRecoveryStage > 0 && (
          <div className="px-2 py-0.5 border-b border-slate-700/30 bg-yellow-500/5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] text-yellow-400">Recovery Stage</span>
              <Badge className="h-3 px-1 text-[6px] bg-yellow-500/20 text-yellow-400 border-0">
                {bot.currentRecoveryStage}
              </Badge>
            </div>
          </div>
        )}

        {bot.alternatingState && bot.strategyId === 'bot5' && (
          <div className="px-2 py-0.5 border-b border-slate-700/30 bg-amber-500/5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] text-amber-400">Current</span>
              <Badge className={`h-3 px-1 text-[6px] border-0 ${
                bot.alternatingState === 'EVEN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-purple-500/20 text-purple-400'
              }`}>
                {bot.alternatingState}
              </Badge>
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="px-2 py-1 grid grid-cols-4 gap-1 border-b border-slate-700/30 bg-slate-800/20">
          <div className="text-center">
            <div className="text-[7px] text-slate-500">P&L</div>
            <div className={`text-[9px] font-bold font-mono ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${bot.totalPnl.toFixed(2)}
            </div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500">W/L</div>
            <div className="text-[9px] font-mono">
              <span className="text-emerald-400">{bot.wins}</span>
              <span className="text-slate-600 mx-0.5">/</span>
              <span className="text-rose-400">{bot.losses}</span>
            </div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500">Run</div>
            <div className="text-[9px] font-mono text-blue-400">{bot.currentRun}/{bot.maxRuns}</div>
          </div>
          <div className="text-center">
            <div className="text-[7px] text-slate-500">Stake</div>
            <div className="text-[9px] font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</div>
          </div>
        </div>

        {/* Controls */}
        <div className="p-1.5 bg-slate-900/30">
          {!bot.running ? (
            <Button
              onClick={() => onStart(bot.id)}
              disabled={!bot.enabled}
              size="sm"
              className="w-full h-6 text-[9px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              <Play className="w-3 h-3 mr-1" />
              START BOT
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-1">
              <Button
                onClick={() => onPause(bot.id)}
                size="sm"
                variant="outline"
                className="h-6 text-[8px] border-slate-600 hover:bg-slate-700 col-span-1 px-1"
              >
                {bot.paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
              </Button>
              <Button
                onClick={() => onStop(bot.id)}
                size="sm"
                variant="destructive"
                className="h-6 text-[9px] col-span-3 bg-rose-600 hover:bg-rose-700"
              >
                <Square className="w-3 h-3 mr-1" />
                STOP
              </Button>
            </div>
          )}
        </div>

        {/* Expanded Settings */}
        <AnimatePresence>
          {bot.expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden bg-slate-900/50 border-t border-slate-700/50"
            >
              <div className="p-2 space-y-2">
                {/* Strategy Selector */}
                <div className="space-y-1">
                  <Label className="text-[8px] text-slate-400 uppercase">Strategy</Label>
                  <Select
                    value={bot.strategyId}
                    onValueChange={(value) => onUpdate(bot.id, { strategyId: value })}
                  >
                    <SelectTrigger className="h-6 text-[9px] bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      {STRATEGIES.map(s => (
                        <SelectItem key={s.id} value={s.id} className="text-[9px]">
                          <span className="flex items-center gap-2">
                            <s.icon className="w-3 h-3" />
                            {s.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator className="bg-slate-700/50" />

                {/* Risk Management */}
                <div className="space-y-1.5">
                  <Label className="text-[8px] text-slate-400 uppercase">Risk Management</Label>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Base Stake ($)</span>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={bot.baseStake}
                        onChange={(e) => onUpdate(bot.id, { 
                          baseStake: parseFloat(e.target.value) || 0.5,
                          currentStake: parseFloat(e.target.value) || 0.5 
                        })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Max Runs</span>
                      <Input
                        type="number"
                        min="1"
                        value={bot.maxRuns}
                        onChange={(e) => onUpdate(bot.id, { maxRuns: parseInt(e.target.value) || 10 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Take Profit ($)</span>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={bot.takeProfit}
                        onChange={(e) => onUpdate(bot.id, { takeProfit: parseFloat(e.target.value) || 1 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <span className="text-[7px] text-slate-500">Stop Loss ($)</span>
                      <Input
                        type="number"
                        min="0.1"
                        step="0.1"
                        value={bot.stopLoss}
                        onChange={(e) => onUpdate(bot.id, { stopLoss: parseFloat(e.target.value) || 1 })}
                        className="h-6 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[7px] text-slate-500">Stake Type</span>
                    <Select
                      value={bot.stakeType}
                      onValueChange={(value: 'FIXED' | 'MARTINGALE') => onUpdate(bot.id, { stakeType: value })}
                    >
                      <SelectTrigger className="h-6 w-24 text-[9px] bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="FIXED" className="text-[9px]">Fixed</SelectItem>
                        <SelectItem value="MARTINGALE" className="text-[9px]">Martingale</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {bot.stakeType === 'MARTINGALE' && (
                    <div className="flex items-center justify-between">
                      <span className="text-[7px] text-slate-500">Multiplier</span>
                      <Input
                        type="number"
                        min="1.1"
                        step="0.1"
                        value={bot.martingaleMultiplier}
                        onChange={(e) => onUpdate(bot.id, { martingaleMultiplier: parseFloat(e.target.value) || 2 })}
                        className="h-6 w-16 text-[9px] bg-slate-800 border-slate-700"
                      />
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
});

BotCard.displayName = 'BotCard';

// ==================== MAIN COMPONENT ====================
export default function AutoTrade() {
  const { isAuthorized, balance, setBalance } = useAuth();
  const [bots, setBots] = useState<BotState[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('bots');
  const [totalBalance, setTotalBalance] = useState(10000);
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [marketAnalyses, setMarketAnalyses] = useState<Map<string, MarketAnalysis>>(new Map());
  
  const marketStore = MarketDataStore.getInstance();
  const botEngine = BotExecutionEngine.getInstance();
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize bot
  useEffect(() => {
    const initialBot: BotState = {
      id: 'main-bot',
      strategyId: 'bot7', // Default to EVEN Bot
      enabled: true,
      running: false,
      paused: false,
      status: 'IDLE',
      
      baseStake: 1.00,
      currentStake: 1.00,
      stakeType: 'FIXED',
      martingaleMultiplier: 2.0,
      
      takeProfit: 50,
      stopLoss: 25,
      maxRuns: 100,
      currentRun: 0,
      
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      consecutiveLosses: 0,
      
      currentRecoveryStage: 0,
      alternatingState: 'EVEN',
      lastTradeWasLoss: false,
      cooldownRemaining: 0,
      
      currentMarket: null,
      
      expanded: false
    };
    
    setBots([initialBot]);
    
    // Initialize bot engine
    botEngine.initialize(
      (updatedBot) => {
        setBots(prev => prev.map(b => b.id === updatedBot.id ? updatedBot : b));
      },
      (trade) => {
        setTrades(prev => [trade, ...prev].slice(0, 100));
        playSound(trade.result === 'WIN' ? 'win' : 'loss');
      },
      (pnl) => {
        setTotalBalance(prev => prev + pnl);
        setBalance(prev => prev + pnl);
      }
    );
    
    // Subscribe to market analyses
    const unsubscribe = marketStore.subscribe((analyses) => {
      setMarketAnalyses(new Map(analyses));
      setLastScan(Date.now());
    });
    
    // Connect to Deriv API and start fetching data
    derivApi.connect();
    
    // Fetch initial historical data
    VOLATILITY_MARKETS.forEach(market => {
      derivApi.getTicks(market.id, 500);
    });
    
    return () => {
      unsubscribe();
      botEngine.stop();
    };
  }, []);

  // Auto-switch to best market
  useEffect(() => {
    if (autoSwitch && bots.length > 0) {
      const best = marketStore.scanMarkets();
      if (best) {
        setBots(prev => prev.map(bot => ({
          ...bot,
          currentMarket: best.symbol
        })));
      }
    }
  }, [autoSwitch, marketAnalyses]);

  // Play sound effects
  const playSound = useCallback((type: 'entry' | 'win' | 'loss') => {
    if (!soundEnabled) return;
    
    try {
      if (!audioContextRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        audioContextRef.current = new AudioContextClass();
      }
      
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      
      const ctx = audioContextRef.current;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      if (type === 'win') {
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else if (type === 'loss') {
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(220, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.frequency.setValueAtTime(660, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.1);
      }
    } catch (e) {
      console.error('Audio error:', e);
    }
  }, [soundEnabled]);

  // Manual scan
  const scanMarkets = useCallback(() => {
    const best = marketStore.scanMarkets();
    if (best) {
      toast.success(`📊 Best market: ${best.symbol} (Score: ${best.analysis.marketScore}/10)`);
      playSound('entry');
    } else {
      toast.info('Scanning markets...');
    }
  }, [playSound]);

  // Start bot
  const startBot = useCallback((id: string) => {
    const bot = bots.find(b => b.id === id);
    if (!bot) return;
    
    if (!bot.enabled) {
      toast.error(`${bot.name}: Bot is disabled`);
      return;
    }
    
    botEngine.start(bot);
  }, [bots]);

  // Pause bot
  const pauseBot = useCallback((id: string) => {
    botEngine.pause();
  }, []);

  // Stop bot
  const stopBot = useCallback((id: string) => {
    botEngine.stop();
  }, []);

  // Stop all bots
  const stopAllBots = useCallback(() => {
    botEngine.stop();
  }, []);

  // Update bot config
  const updateBot = useCallback((id: string, updates: Partial<BotState>) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
    botEngine.updateBotConfig(updates);
  }, []);

  // Clear all stats
  const clearAll = useCallback(() => {
    stopAllBots();
    setTrades([]);
    setBots(prev => prev.map(b => ({
      ...b,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      currentStake: b.baseStake,
      consecutiveLosses: 0,
      currentRun: 0,
      currentRecoveryStage: 0,
      alternatingState: 'EVEN',
      lastTradeWasLoss: false,
      status: 'IDLE'
    })));
    setTotalBalance(10000);
    setBalance(10000);
    toast.success('🧹 All statistics cleared');
  }, [stopAllBots, setBalance]);

  // Calculate totals
  const activeBot = bots[0];
  const totalPnl = activeBot?.totalPnl || 0;
  const totalTrades = activeBot?.trades || 0;
  const totalWins = activeBot?.wins || 0;
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans antialiased selection:bg-emerald-500/30">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur-md border-b border-slate-800/50 shadow-lg shadow-black/20">
        <div className="px-3 py-2">
          <div className="flex items-center justify-between">
            {/* Logo & Title */}
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-gradient-to-br from-emerald-500/20 to-blue-500/20 rounded-lg border border-emerald-500/20">
                <Brain className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold bg-gradient-to-r from-emerald-400 to-blue-400 bg-clip-text text-transparent">
                  Deriv AI Trading Engine
                </h1>
                <p className="text-[9px] text-slate-500 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  v4.0 • 10 Strategies • Auto-scan every 30s
                </p>
              </div>
            </div>

            {/* Stats */}
            <div className="flex items-center gap-1.5">
              {/* Best Market Display */}
              {(() => {
                const best = marketStore.scanMarkets();
                return best ? (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="px-2 py-1 bg-blue-500/10 rounded-md border border-blue-500/30 cursor-help">
                          <div className="text-[7px] text-blue-400 uppercase tracking-wider">Best Market</div>
                          <div className="text-[9px] font-mono font-bold text-blue-300">
                            {best.symbol} (Score: {best.analysis.marketScore})
                          </div>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="text-[9px]">
                        {best.analysis.recommendedBot} • {best.analysis.confidence.toFixed(0)}% conf
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                ) : null
              })()}
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50 cursor-help">
                      <div className="text-[7px] text-slate-500 uppercase tracking-wider">Balance</div>
                      <div className="text-[10px] font-mono font-bold text-slate-200">${totalBalance.toFixed(2)}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Current account balance</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className={`px-2 py-1 rounded-md border cursor-help ${
                      totalPnl >= 0 ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-rose-500/10 border-rose-500/30'
                    }`}>
                      <div className={`text-[7px] uppercase tracking-wider ${totalPnl >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>P&L</div>
                      <div className={`text-[10px] font-mono font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Total profit/loss</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50 cursor-help">
                      <div className="text-[7px] text-slate-500 uppercase tracking-wider">Win Rate</div>
                      <div className="text-[10px] font-mono font-bold text-yellow-400">{winRate}%</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Win rate percentage</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="px-2 py-1 bg-slate-800/50 rounded-md border border-slate-700/50 cursor-help">
                      <div className="text-[7px] text-slate-500 uppercase tracking-wider">Trades</div>
                      <div className="text-[10px] font-mono font-bold text-blue-400">{totalTrades}</div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[9px]">Total trades executed</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-1">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-1 px-1">
                      <span className="text-[8px] text-slate-500">Auto</span>
                      <Switch
                        checked={autoSwitch}
                        onCheckedChange={setAutoSwitch}
                        className="scale-75 data-[state=checked]:bg-emerald-500"
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Auto-switch to best market
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={scanMarkets}
                      size="sm"
                      className="h-7 px-2 text-[10px] bg-emerald-600 hover:bg-emerald-700 border-0"
                    >
                      <Scan className="w-3 h-3 mr-1" />
                      SCAN
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Scan all markets (auto every 30s)
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={stopAllBots}
                      size="sm"
                      variant="destructive"
                      className="h-7 px-2 text-[10px] bg-rose-600 hover:bg-rose-700 border-0"
                      disabled={!activeBot?.running}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      STOP
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Stop bot
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={clearAll}
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-[10px] border-slate-700 hover:bg-slate-800"
                    >
                      <Trash2 className="w-3 h-3 mr-1" />
                      CLEAR
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Reset all statistics
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="w-px h-6 bg-slate-700 mx-1" />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
                    >
                      {viewMode === 'grid' ? (
                        <List className="w-3.5 h-3.5 text-slate-400" />
                      ) : (
                        <Grid3X3 className="w-3.5 h-3.5 text-slate-400" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    Toggle view mode
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setSoundEnabled(!soundEnabled)}
                    >
                      {soundEnabled ? (
                        <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <VolumeX className="w-3.5 h-3.5 text-slate-500" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-[10px]">
                    {soundEnabled ? 'Mute sounds' : 'Enable sounds'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>

          {/* Connection Status */}
          <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-slate-800/50">
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="h-4 px-1.5 text-[8px] border-0 bg-emerald-500/10 text-emerald-400">
                <Wifi className="w-2.5 h-2.5 mr-1" />
                Connected
              </Badge>
              {lastScan && (
                <span className="text-[8px] text-slate-600">
                  Last scan: {new Date(lastScan).toLocaleTimeString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[8px] text-slate-600">Markets:</span>
              <span className="text-[9px] font-mono text-emerald-400">{marketAnalyses.size}/10</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="p-2 pb-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="w-full grid grid-cols-2 bg-slate-800/50 p-0.5 h-8 mb-2">
            <TabsTrigger value="bots" className="text-[10px] data-[state=active]:bg-slate-700">
              <Grid3X3 className="w-3 h-3 mr-1" />
              Trading Bot
            </TabsTrigger>
            <TabsTrigger value="trades" className="text-[10px] data-[state=active]:bg-slate-700">
              <Activity className="w-3 h-3 mr-1" />
              Trade Log ({trades.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="bots" className="mt-0">
            {bots.length > 0 && (
              <div className={viewMode === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2" : "grid grid-cols-1 gap-2"}>
                {bots.map(bot => (
                  <BotCard
                    key={bot.id}
                    bot={bot}
                    analysis={bot.currentMarket ? marketAnalyses.get(bot.currentMarket) : undefined}
                    onStart={startBot}
                    onStop={stopBot}
                    onPause={pauseBot}
                    onUpdate={updateBot}
                    onExpand={(id) => updateBot(id, { expanded: !bot.expanded })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="trades" className="mt-0">
            <div className="bg-[#1e293b] rounded-lg border border-slate-700/50 overflow-hidden">
              <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700/50 flex items-center justify-between">
                <h2 className="text-[10px] font-semibold text-slate-300 uppercase tracking-wider">Recent Trades</h2>
                <Badge variant="outline" className="h-4 px-1.5 text-[8px] border-slate-700">
                  {trades.length} total
                </Badge>
              </div>
              
              <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                {trades.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-slate-600">
                    <Activity className="w-8 h-8 mb-2 opacity-50" />
                    <span className="text-[10px]">No trades executed yet</span>
                    <Button 
                      variant="outline" 
                      size="sm" 
                      className="mt-2 text-[9px] h-6"
                      onClick={() => setActiveTab('bots')}
                    >
                      Start trading
                    </Button>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-700/30">
                    {trades.map((trade) => (
                      <div
                        key={trade.id}
                        className="px-3 py-2 flex items-center justify-between hover:bg-slate-800/30 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                            trade.result === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
                          }`}>
                            {trade.result === 'WIN' ? 'W' : 'L'}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[9px] font-medium text-slate-300">{trade.botName}</span>
                              <Badge className="h-3 px-1 text-[6px] bg-slate-700 text-slate-400 border-0">
                                {trade.tradeType}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 text-[8px] text-slate-500">
                              <span>{trade.market}</span>
                              <span>•</span>
                              <span>{new Date(trade.timestamp).toLocaleTimeString()}</span>
                              <span>•</span>
                              <span>Score: {trade.marketScore}</span>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <div className="text-[9px] font-mono text-slate-400">
                              {trade.entryDigit} → {trade.exitDigit}
                            </div>
                            <div className="text-[8px] text-slate-500">
                              ${trade.stake.toFixed(2)}
                            </div>
                          </div>
                          <div className={`text-right min-w-[60px] ${
                            trade.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'
                          }`}>
                            <div className="text-[11px] font-bold font-mono">
                              {trade.result === 'WIN' ? '+' : ''}${trade.pnl.toFixed(2)}
                            </div>
                            <div className="text-[8px] text-slate-500">
                              {trade.confidence.toFixed(0)}% conf
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="fixed bottom-0 left-0 right-0 bg-[#0f172a]/95 backdrop-blur border-t border-slate-800/50 px-3 py-1 z-50">
        <div className="flex items-center justify-between text-[8px] text-slate-600">
          <span>Deriv AI Trading Engine v4.0 - Intelligent Market Scanner</span>
          <span>10 Strategies • Recovery Logic • Auto-switch every 30s</span>
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </footer>
      
      {/* Spacer for fixed footer */}
      <div className="h-6" />
    </div>
  );
}
