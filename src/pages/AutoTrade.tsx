// ============================================================
// FILE: pages/AutoTradingHub.tsx (FIXED VERSION)
// ============================================================
// Complete Automated Trading Hub - High-Performance Signal Scanner + Pro Bot Integration

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { copyTradingService } from '@/services/copy-trading-service';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play, StopCircle, Trash2, Scan, Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload,
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Target, Gauge, Volume2, VolumeX,
  Clock, Trophy, Pause, Loader2, Sparkles, Flame, Timer, Crown, AlertCircle
} from 'lucide-react';

/* ───── CONSTANTS ───── */
const VOLATILITY_MARKETS = [
  { symbol: '1HZ10V', name: 'V10 (1s)', group: '1s' },
  { symbol: '1HZ25V', name: 'V25 (1s)', group: '1s' },
  { symbol: '1HZ50V', name: 'V50 (1s)', group: '1s' },
  { symbol: '1HZ75V', name: 'V75 (1s)', group: '1s' },
  { symbol: '1HZ100V', name: 'V100 (1s)', group: '1s' },
  { symbol: 'R_10', name: 'Vol 10', group: 'standard' },
  { symbol: 'R_25', name: 'Vol 25', group: 'standard' },
  { symbol: 'R_50', name: 'Vol 50', group: 'standard' },
  { symbol: 'R_75', name: 'Vol 75', group: 'standard' },
  { symbol: 'R_100', name: 'Vol 100', group: 'standard' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
];

const CONTRACT_TYPES = [
  'CALL', 'PUT', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const DIGIT_CONTRACT_TYPES = ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'];

const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

type SignalStrength = 'strong' | 'moderate' | 'weak';
type BotStatus = 'idle' | 'trading' | 'waiting_signal' | 'signal_matched';

// Enhanced Market Data Interface
interface MarketData {
  symbol: string;
  name: string;
  prices: number[];
  digits: number[];
  lastPrice: number;
  lastDigit: number;
  
  // Analysis Results
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  risePct: number;
  fallPct: number;
  digitPct: Record<number, number>;
  mostCommonDigit: number;
  leastCommonDigit: number;
  matchStrength: number; // 0-100, how strong the match signal is
  diffStrength: number; // 0-100, how strong the diff signal is
  
  // Momentum (last 5-10 ticks)
  momentum: number; // -1 to 1, negative = down, positive = up
  volatility: number; // standard deviation of recent ticks
  
  // Timestamp
  lastUpdate: number;
  isLoading: boolean;
  error?: string;
}

interface MarketSignal {
  symbol: string;
  name: string;
  type: string;
  direction: string;
  confidence: number;
  strength: SignalStrength;
  digit?: number;
  evenPct: number;
  oddPct: number;
  overPct: number;
  underPct: number;
  risePct: number;
  fallPct: number;
  rsi: number;
  lastDigit: number;
  momentum: number;
}

interface LogEntry {
  id: number;
  time: string;
  symbol: string;
  contract: string;
  stake: number;
  signalType: string;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending';
  pnl: number;
  balance: number;
}

/* ── HIGH-PERFORMANCE HELPER FUNCTIONS ── */

// Get last digit from price
const getLastDigit = (price: number): number => {
  return Math.floor(price) % 10;
};

// Calculate percentages efficiently
const calculatePercentages = (digits: number[]) => {
  const total = digits.length;
  let even = 0, odd = 0, over = 0, under = 0;
  const digitCount = new Array(10).fill(0);
  
  for (const digit of digits) {
    digitCount[digit]++;
    if (digit % 2 === 0) even++;
    else odd++;
    if (digit > 4) over++;
    else under++;
  }
  
  const digitPct: Record<number, number> = {};
  for (let i = 0; i < 10; i++) {
    digitPct[i] = (digitCount[i] / total) * 100;
  }
  
  // Find most and least common digits
  let mostCommon = 0, leastCommon = 0;
  for (let i = 1; i < 10; i++) {
    if (digitCount[i] > digitCount[mostCommon]) mostCommon = i;
    if (digitCount[i] < digitCount[leastCommon]) leastCommon = i;
  }
  
  return {
    evenPct: (even / total) * 100,
    oddPct: (odd / total) * 100,
    overPct: (over / total) * 100,
    underPct: (under / total) * 100,
    digitPct,
    mostCommonDigit: mostCommon,
    leastCommonDigit: leastCommon,
  };
};

// Calculate Rise/Fall percentages from prices
const calculateRiseFall = (prices: number[]) => {
  let rise = 0, fall = 0;
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) rise++;
    else if (prices[i] < prices[i - 1]) fall++;
  }
  const total = prices.length - 1;
  return {
    risePct: total > 0 ? (rise / total) * 100 : 50,
    fallPct: total > 0 ? (fall / total) * 100 : 50,
  };
};

// Calculate match/diff strength based on consecutive repeats
const calculateMatchDiffStrength = (digits: number[]) => {
  if (digits.length < 20) return { matchStrength: 50, diffStrength: 50 };
  
  let repeats = 0;
  let totalSequences = 0;
  
  // Analyze last 200 ticks for patterns
  const recentDigits = digits.slice(-200);
  let currentRepeat = 1;
  
  for (let i = 1; i < recentDigits.length; i++) {
    if (recentDigits[i] === recentDigits[i - 1]) {
      currentRepeat++;
      if (currentRepeat >= 3) repeats++;
    } else {
      if (currentRepeat >= 2) totalSequences++;
      currentRepeat = 1;
    }
  }
  
  // Calculate match strength (higher = more repeats)
  const matchStrength = Math.min(95, (repeats / Math.max(1, totalSequences)) * 100);
  const diffStrength = Math.min(95, 100 - matchStrength);
  
  return { matchStrength, diffStrength };
};

// Calculate momentum from last N ticks
const calculateMomentum = (prices: number[], ticks: number = 10) => {
  if (prices.length < ticks + 1) return 0;
  const recentPrices = prices.slice(-ticks);
  const first = recentPrices[0];
  const last = recentPrices[recentPrices.length - 1];
  const change = ((last - first) / first) * 100;
  return Math.min(1, Math.max(-1, change / 5)); // Normalize to -1..1
};

// Calculate volatility (standard deviation)
const calculateVolatility = (prices: number[], ticks: number = 20) => {
  if (prices.length < ticks) return 0;
  const recent = prices.slice(-ticks);
  const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const variance = recent.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / recent.length;
  return Math.sqrt(variance);
};

// Calculate RSI (optimized)
const calculateRSI = (prices: number[], period: number = 14): number => {
  if (prices.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[prices.length - i] - prices[prices.length - i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
};

// Signal generation with confirmation
const generateSignals = (data: MarketData): MarketSignal[] => {
  const signals: MarketSignal[] = [];
  
  // Risk filter: Check if market is choppy
  const isChoppy = Math.abs(data.evenPct - data.oddPct) < 5 && 
                   Math.abs(data.overPct - data.underPct) < 5 &&
                   Math.abs(data.risePct - data.fallPct) < 5;
  
  // Check for sudden spikes (volatility spike)
  const hasSpike = data.volatility > 0.5; // Adjust threshold based on market
  
  if (isChoppy || hasSpike) {
    // Return empty signals if conditions are bad
    return signals;
  }
  
  // Even/Odd signals
  if (data.evenPct >= 55 && !isChoppy) {
    const confidence = Math.min(95, data.evenPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Even',
      direction: 'DIGITEVEN',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
    });
  }
  
  if (data.oddPct >= 55 && !isChoppy) {
    const confidence = Math.min(95, data.oddPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Odd',
      direction: 'DIGITODD',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
    });
  }
  
  // Over/Under signals
  if (data.overPct >= 55 && !isChoppy) {
    const confidence = Math.min(95, data.overPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Over',
      direction: 'DIGITOVER',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      digit: 5,
    });
  }
  
  if (data.underPct >= 55 && !isChoppy) {
    const confidence = Math.min(95, data.underPct);
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Under',
      direction: 'DIGITUNDER',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      digit: 4,
    });
  }
  
  // Rise/Fall signals with momentum confirmation
  if (data.risePct >= 55 && !isChoppy && data.momentum > 0) {
    const confidence = Math.min(95, data.risePct + (data.momentum * 10));
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Rise',
      direction: 'CALL',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
    });
  }
  
  if (data.fallPct >= 55 && !isChoppy && data.momentum < 0) {
    const confidence = Math.min(95, data.fallPct + (Math.abs(data.momentum) * 10));
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Fall',
      direction: 'PUT',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
    });
  }
  
  // Match/Differ signals
  if (data.matchStrength >= 55 && !isChoppy) {
    const confidence = data.matchStrength;
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Match',
      direction: 'DIGITMATCH',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      digit: data.mostCommonDigit,
    });
  }
  
  if (data.diffStrength >= 55 && !isChoppy) {
    const confidence = data.diffStrength;
    signals.push({
      symbol: data.symbol,
      name: data.name,
      type: 'Differ',
      direction: 'DIGITDIFF',
      confidence,
      strength: getStrength(confidence),
      evenPct: data.evenPct,
      oddPct: data.oddPct,
      overPct: data.overPct,
      underPct: data.underPct,
      risePct: data.risePct,
      fallPct: data.fallPct,
      rsi: calculateRSI(data.prices),
      lastDigit: data.lastDigit,
      momentum: data.momentum,
      digit: data.leastCommonDigit,
    });
  }
  
  return signals;
};

const getStrength = (confidence: number): SignalStrength => {
  if (confidence >= 75) return 'strong';
  if (confidence >= 55) return 'moderate';
  return 'weak';
};

// Fetch 1000 ticks using WebSocket API
const fetch1000Ticks = async (symbol: string): Promise<{ prices: number[]; times: number[] }> => {
  return new Promise((resolve, reject) => {
    const requestId = Date.now() + Math.random();
    const message = {
      ticks_history: symbol,
      adjust_start_time: 1,
      count: 1000,
      end: 'latest',
      start: 1,
      style: 'ticks',
      subscribe: 0,
      req_id: requestId,
    };
    
    let timeoutId: NodeJS.Timeout;
    let unsubscribe: (() => void) | null = null;
    
    const handler = (data: any) => {
      // Check if this is our response
      if (data.req_id === requestId) {
        if (timeoutId) clearTimeout(timeoutId);
        if (unsubscribe) unsubscribe();
        
        if (data.error) {
          reject(new Error(data.error.message || `Failed to fetch ticks for ${symbol}`));
        } else if (data.ticks_history && data.ticks_history.prices) {
          resolve({
            prices: data.ticks_history.prices,
            times: data.ticks_history.times || [],
          });
        } else {
          reject(new Error(`Invalid response format for ${symbol}`));
        }
      }
    };
    
    unsubscribe = derivApi.onMessage(handler);
    
    timeoutId = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error(`Timeout fetching 1000 ticks for ${symbol}`));
    }, 15000);
    
    derivApi.send(message).catch((err) => {
      if (timeoutId) clearTimeout(timeoutId);
      if (unsubscribe) unsubscribe();
      reject(err);
    });
  });
};

export default function AutoTradingHub() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // ==================== SIGNAL SCANNER STATE ====================
  const [marketsData, setMarketsData] = useState<Map<string, MarketData>>(new Map());
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [topSignals, setTopSignals] = useState<MarketSignal[]>([]);
  const [selectedSignal, setSelectedSignal] = useState<MarketSignal | null>(null);
  const [groupFilter, setGroupFilter] = useState('all');
  const [isLoadingMarkets, setIsLoadingMarkets] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastSpokenRef = useRef('');
  const lastTradeTimeRef = useRef<number>(0);
  const cooldownMs = 60000; // 1 minute cooldown between trades

  // ==================== BOT CONFIGURATION ====================
  const [botEnabled, setBotEnabled] = useState(false);
  const [followSignal, setFollowSignal] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState('R_100');
  const [contractType, setContractType] = useState('CALL');
  const [barrier, setBarrier] = useState('5');
  const [stake, setStake] = useState('0.35');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');
  const [turboMode, setTurboMode] = useState(false);

  // ==================== BOT STATE ====================
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [currentSignal, setCurrentSignal] = useState<MarketSignal | null>(null);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const [botStats, setBotStats] = useState({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });

  // Tick data for pattern matching
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});

  // ==================== LOAD ALL MARKET DATA (1000 ticks each) ====================
  const loadAllMarkets = useCallback(async () => {
    setIsLoadingMarkets(true);
    setLoadingProgress(0);
    
    const filteredMarkets = groupFilter === 'all' 
      ? VOLATILITY_MARKETS 
      : VOLATILITY_MARKETS.filter(m => m.group === groupFilter);
    
    let loaded = 0;
    const newMarketsData = new Map(marketsData);
    
    for (const market of filteredMarkets) {
      try {
        // Check if we already have fresh data (less than 30 seconds old)
        const existing = newMarketsData.get(market.symbol);
        if (existing && !existing.isLoading && (Date.now() - existing.lastUpdate) < 30000) {
          loaded++;
          setLoadingProgress((loaded / filteredMarkets.length) * 100);
          continue;
        }
        
        // Set loading state
        newMarketsData.set(market.symbol, {
          ...existing,
          symbol: market.symbol,
          name: market.name,
          prices: [],
          digits: [],
          lastPrice: 0,
          lastDigit: 0,
          evenPct: 50,
          oddPct: 50,
          overPct: 50,
          underPct: 50,
          risePct: 50,
          fallPct: 50,
          digitPct: {},
          mostCommonDigit: 0,
          leastCommonDigit: 0,
          matchStrength: 50,
          diffStrength: 50,
          momentum: 0,
          volatility: 0,
          lastUpdate: Date.now(),
          isLoading: true,
        });
        
        setMarketsData(new Map(newMarketsData));
        
        // Fetch 1000 ticks
        const { prices, times } = await fetch1000Ticks(market.symbol);
        
        if (prices && prices.length > 0) {
          const digits = prices.map(getLastDigit);
          const percentages = calculatePercentages(digits);
          const riseFall = calculateRiseFall(prices);
          const { matchStrength, diffStrength } = calculateMatchDiffStrength(digits);
          const momentum = calculateMomentum(prices);
          const volatility = calculateVolatility(prices);
          
          const marketData: MarketData = {
            symbol: market.symbol,
            name: market.name,
            prices,
            digits,
            lastPrice: prices[prices.length - 1],
            lastDigit: digits[digits.length - 1],
            evenPct: percentages.evenPct,
            oddPct: percentages.oddPct,
            overPct: percentages.overPct,
            underPct: percentages.underPct,
            risePct: riseFall.risePct,
            fallPct: riseFall.fallPct,
            digitPct: percentages.digitPct,
            mostCommonDigit: percentages.mostCommonDigit,
            leastCommonDigit: percentages.leastCommonDigit,
            matchStrength,
            diffStrength,
            momentum,
            volatility,
            lastUpdate: Date.now(),
            isLoading: false,
          };
          
          newMarketsData.set(market.symbol, marketData);
          tickMapRef.current.set(market.symbol, digits);
        } else {
          newMarketsData.set(market.symbol, {
            ...newMarketsData.get(market.symbol)!,
            isLoading: false,
            error: 'No data received',
          });
        }
        
        loaded++;
        setLoadingProgress((loaded / filteredMarkets.length) * 100);
        setMarketsData(new Map(newMarketsData));
        
      } catch (err) {
        console.error(`Failed to load ${market.symbol}:`, err);
        newMarketsData.set(market.symbol, {
          ...newMarketsData.get(market.symbol)!,
          isLoading: false,
          error: err instanceof Error ? err.message : 'Failed to load',
        });
        setMarketsData(new Map(newMarketsData));
        loaded++;
        setLoadingProgress((loaded / filteredMarkets.length) * 100);
      }
    }
    
    setIsLoadingMarkets(false);
  }, [groupFilter, marketsData]);

  // Subscribe to real-time ticks for updates
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const handler = (data: any) => {
      if (!data.tick) return;
      const sym = data.tick.symbol as string;
      const price = data.tick.quote;
      const digit = getLastDigit(price);
      
      // Update tick map
      const map = tickMapRef.current;
      const arr = map.get(sym) || [];
      arr.push(digit);
      if (arr.length > 1000) arr.shift();
      map.set(sym, arr);
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));
      
      // Update market data incrementally
      setMarketsData(prev => {
        const existing = prev.get(sym);
        if (!existing || existing.isLoading) return prev;
        
        // Update arrays with new tick
        const newPrices = [...existing.prices, price].slice(-1000);
        const newDigits = [...existing.digits, digit].slice(-1000);
        
        // Recalculate all metrics efficiently
        const percentages = calculatePercentages(newDigits);
        const riseFall = calculateRiseFall(newPrices);
        const { matchStrength, diffStrength } = calculateMatchDiffStrength(newDigits);
        const momentum = calculateMomentum(newPrices);
        const volatility = calculateVolatility(newPrices);
        
        const updated: MarketData = {
          ...existing,
          prices: newPrices,
          digits: newDigits,
          lastPrice: price,
          lastDigit: digit,
          evenPct: percentages.evenPct,
          oddPct: percentages.oddPct,
          overPct: percentages.overPct,
          underPct: percentages.underPct,
          risePct: riseFall.risePct,
          fallPct: riseFall.fallPct,
          digitPct: percentages.digitPct,
          mostCommonDigit: percentages.mostCommonDigit,
          leastCommonDigit: percentages.leastCommonDigit,
          matchStrength,
          diffStrength,
          momentum,
          volatility,
          lastUpdate: Date.now(),
        };
        
        const newMap = new Map(prev);
        newMap.set(sym, updated);
        return newMap;
      });
    };
    
    const unsub = derivApi.onMessage(handler);
    
    // Subscribe to ticks for all markets
    VOLATILITY_MARKETS.forEach(m => {
      derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(console.error);
    });
    
    // Initial load
    loadAllMarkets();
    
    return () => {
      unsub();
      VOLATILITY_MARKETS.forEach(m => {
        derivApi.unsubscribeTicks(m.symbol as MarketSymbol).catch(console.error);
      });
    };
  }, [loadAllMarkets]);

  // ==================== SIGNAL CALCULATION ====================
  const calculateSignals = useCallback(() => {
    const allSignals: MarketSignal[] = [];
    
    for (const [symbol, data] of marketsData) {
      if (data.isLoading || data.prices.length < 100) continue;
      
      const marketSignals = generateSignals(data);
      allSignals.push(...marketSignals);
    }
    
    // Sort by confidence
    allSignals.sort((a, b) => b.confidence - a.confidence);
    setSignals(allSignals);
    
    // Get top signals (unique markets)
    const uniqueMarkets = new Map<string, MarketSignal>();
    for (const signal of allSignals) {
      if (!uniqueMarkets.has(signal.symbol) && signal.confidence >= 65) {
        uniqueMarkets.set(signal.symbol, signal);
      }
      if (uniqueMarkets.size >= 4) break;
    }
    setTopSignals(Array.from(uniqueMarkets.values()));
    
    // Voice announcement
    if (voiceEnabled && topSignals.length > 0 && topSignals[0].confidence >= 75) {
      const best = topSignals[0];
      const msg = `Strong ${best.type} signal on ${best.name} with ${Math.round(best.confidence)} percent confidence`;
      if (lastSpokenRef.current !== msg) {
        lastSpokenRef.current = msg;
        const utterance = new SpeechSynthesisUtterance(msg);
        utterance.rate = 1;
        window.speechSynthesis?.cancel();
        window.speechSynthesis?.speak(utterance);
      }
    }
  }, [marketsData, voiceEnabled, topSignals]);
  
  // Auto-refresh signals
  useEffect(() => {
    if (autoRefresh && marketsData.size > 0 && !isLoadingMarkets) {
      calculateSignals();
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(calculateSignals, 3000);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, marketsData, calculateSignals, isLoadingMarkets]);
  
  // ==================== BOT TRADE EXECUTION ====================
  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    const id = ++logIdRef.current;
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
    return id;
  }, []);
  
  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);
  
  const waitForNextTick = useCallback((symbol: string): Promise<{ quote: number }> => {
    return new Promise((resolve) => {
      const unsub = derivApi.onMessage((data: any) => {
        if (data.tick && data.tick.symbol === symbol) {
          unsub();
          resolve({ quote: data.tick.quote });
        }
      });
    });
  }, []);
  
  const executeTrade = useCallback(async (signal: MarketSignal, tradeStake: number, step: number) => {
    // Check cooldown
    if (Date.now() - lastTradeTimeRef.current < cooldownMs) {
      toast.warning(`Please wait ${Math.ceil((cooldownMs - (Date.now() - lastTradeTimeRef.current)) / 1000)} seconds before next trade`);
      return { won: false, pnl: 0, exitDigit: '-' };
    }
    
    const ct = signal.direction;
    const logId = addLog({
      time: new Date().toLocaleTimeString(),
      symbol: signal.symbol,
      contract: ct,
      stake: tradeStake,
      signalType: signal.type,
      exitDigit: '...',
      result: 'Pending',
      pnl: 0,
      balance: balance,
    });
    
    try {
      if (!turboMode) await waitForNextTick(signal.symbol);
      
      const buyParams: any = {
        contract_type: ct,
        symbol: signal.symbol,
        duration: parseInt(duration),
        duration_unit: durationUnit,
        basis: 'stake',
        amount: tradeStake,
      };
      
      if (needsBarrier(ct)) {
        const digitVal = signal.digit !== undefined ? signal.digit : parseInt(barrier);
        buyParams.barrier = String(digitVal);
      }
      
      const { contractId } = await derivApi.buyContract(buyParams);
      lastTradeTimeRef.current = Date.now();
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      const exitDigit = String(getLastDigit(result.sellPrice || 0));
      
      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: balance + pnl });
      
      return { won, pnl, exitDigit };
    } catch (err: any) {
      console.error('Trade execution error:', err);
      updateLog(logId, { result: 'Loss', exitDigit: '-', pnl: 0 });
      return { won: false, pnl: 0, exitDigit: '-' };
    }
  }, [turboMode, duration, durationUnit, barrier, balance, addLog, updateLog, waitForNextTick]);
  
  // ==================== MAIN BOT LOOP ====================
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    
    setIsRunning(true);
    runningRef.current = true;
    setBotStatus('waiting_signal');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    
    let cStake = baseStake;
    let mStep = 0;
    let localPnl = 0;
    let localBalance = balance;
    let trades = 0;
    let localWins = 0;
    let localLosses = 0;
    let consecLosses = 0;
    
    while (runningRef.current) {
      // Wait for a signal
      if (followSignal) {
        setBotStatus('waiting_signal');
        let bestSignal: MarketSignal | null = null;
        
        while (runningRef.current && !bestSignal) {
          const currentSignals = signals.filter(s => s.confidence >= 70);
          if (currentSignals.length > 0) {
            bestSignal = currentSignals[0];
          }
          if (!bestSignal) await new Promise(r => setTimeout(r, 1000));
        }
        
        if (!runningRef.current) break;
        setCurrentSignal(bestSignal);
        setBotStatus('signal_matched');
        setSelectedMarket(bestSignal.symbol);
        setContractType(bestSignal.direction);
        if (bestSignal.digit !== undefined) setBarrier(String(bestSignal.digit));
        toast.info(`🎯 Signal detected: ${bestSignal.type} on ${bestSignal.name} (${Math.round(bestSignal.confidence)}%)`);
        if (voiceEnabled) {
          const utterance = new SpeechSynthesisUtterance(`${bestSignal.type} signal on ${bestSignal.name} with ${Math.round(bestSignal.confidence)} percent confidence. Trading now.`);
          window.speechSynthesis?.speak(utterance);
        }
      }
      
      const signalToUse = currentSignal || {
        symbol: selectedMarket,
        name: VOLATILITY_MARKETS.find(m => m.symbol === selectedMarket)?.name || selectedMarket,
        type: contractType === 'CALL' ? 'Rise' : contractType === 'PUT' ? 'Fall' : contractType,
        direction: contractType,
        confidence: 80,
        strength: 'moderate',
        digit: DIGIT_CONTRACT_TYPES.includes(contractType) ? parseInt(barrier) : undefined,
        evenPct: 50, oddPct: 50, overPct: 50, underPct: 50, risePct: 50, fallPct: 50, rsi: 50, lastDigit: 0, momentum: 0,
      };
      
      const { won, pnl } = await executeTrade(signalToUse, cStake, mStep);
      
      trades++;
      localPnl += pnl;
      localBalance += pnl;
      setTotalStaked(prev => prev + cStake);
      setNetProfit(localPnl);
      setBotStats({ trades, wins: localWins, losses: localLosses, pnl: localPnl, currentStake: cStake, consecutiveLosses: consecLosses });
      
      if (won) {
        localWins++;
        setWins(prev => prev + 1);
        consecLosses = 0;
        cStake = baseStake;
        mStep = 0;
        if (voiceEnabled) {
          const utterance = new SpeechSynthesisUtterance(`Trade won. Profit ${pnl.toFixed(2)} dollars.`);
          window.speechSynthesis?.speak(utterance);
        }
      } else {
        localLosses++;
        setLosses(prev => prev + 1);
        consecLosses++;
        if (activeAccount?.is_virtual) recordLoss(cStake, signalToUse.symbol, 6000);
        
        if (martingaleOn) {
          const maxSteps = parseInt(martingaleMaxSteps) || 5;
          if (mStep < maxSteps) {
            cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
            mStep++;
            setMartingaleStepState(mStep);
            setCurrentStakeState(cStake);
          } else {
            cStake = baseStake;
            mStep = 0;
          }
        }
        if (voiceEnabled) {
          const utterance = new SpeechSynthesisUtterance(`Trade lost. Loss ${Math.abs(pnl).toFixed(2)} dollars.`);
          window.speechSynthesis?.speak(utterance);
        }
      }
      
      // Check stop loss / take profit
      if (localPnl >= parseFloat(takeProfit)) {
        toast.success(`🎯 Take Profit reached! +$${localPnl.toFixed(2)}`);
        break;
      }
      if (localPnl <= -parseFloat(stopLoss)) {
        toast.error(`🛑 Stop Loss reached! $${localPnl.toFixed(2)}`);
        break;
      }
      if (localBalance < cStake) {
        toast.error('Insufficient balance');
        break;
      }
      
      if (!turboMode) await new Promise(r => setTimeout(r, 1000));
    }
    
    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
    setCurrentSignal(null);
  }, [isAuthorized, isRunning, balance, stake, followSignal, signals, selectedMarket, contractType, barrier, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode, voiceEnabled, activeAccount, recordLoss, executeTrade]);
  
  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
    toast.info('Bot stopped');
  }, []);
  
  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0);
    setMartingaleStepState(0);
    setBotStats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });
  }, []);
  
  const handleUseSignal = (signal: MarketSignal) => {
    setSelectedSignal(signal);
    setSelectedMarket(signal.symbol);
    setContractType(signal.direction);
    if (signal.digit !== undefined) setBarrier(String(signal.digit));
    toast.success(`Configured bot for ${signal.type} signal on ${signal.name}`);
  };
  
  const filteredMarkets = groupFilter === 'all' ? VOLATILITY_MARKETS : VOLATILITY_MARKETS.filter(m => m.group === groupFilter);
  const loadedCount = Array.from(marketsData.values()).filter(d => !d.isLoading && d.prices.length > 0).length;
  const winRate = wins + losses > 0 ? (wins / (wins + losses) * 100).toFixed(1) : '0.0';
  
  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> Auto Trading Hub
          </h1>
          <p className="text-xs text-muted-foreground">
            Signal Scanner + Automated Bot | {loadedCount}/{VOLATILITY_MARKETS.length} markets active
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono">
            Balance: ${balance.toFixed(2)}
          </Badge>
          <Button size="sm" variant={voiceEnabled ? 'default' : 'outline'} className="h-7 text-[10px] gap-1" onClick={() => setVoiceEnabled(!voiceEnabled)}>
            {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
            Voice
          </Button>
        </div>
      </div>
      
      {/* Loading Progress */}
      {isLoadingMarkets && (
        <Card>
          <CardContent className="py-4">
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Loading market data...</span>
                <span>{Math.round(loadingProgress)}%</span>
              </div>
              <Progress value={loadingProgress} className="h-2" />
            </div>
          </CardContent>
        </Card>
      )}
      
      {/* Top Signals Dashboard */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {!isLoadingMarkets && topSignals.length === 0 && (
          <div className="col-span-full text-center py-8 text-muted-foreground">
            <Scan className="w-8 h-8 mx-auto mb-2 opacity-30" />
            <p>Waiting for signals... Market may be choppy</p>
          </div>
        )}
        {topSignals.map((signal, idx) => (
          <motion.div
            key={`${signal.symbol}-${signal.type}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className={`relative overflow-hidden rounded-xl border-2 cursor-pointer transition-all hover:scale-[1.02] ${
              signal.strength === 'strong' ? 'border-profit shadow-lg shadow-profit/20' :
              signal.strength === 'moderate' ? 'border-warning' : 'border-border'
            } bg-card`}
            onClick={() => handleUseSignal(signal)}
          >
            <div className="absolute top-0 right-0 w-16 h-16 -mr-8 -mt-8 rounded-full bg-primary/10" />
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-foreground">{signal.name}</span>
                <Badge className={`text-[8px] px-1.5 ${signal.strength === 'strong' ? 'bg-profit' : signal.strength === 'moderate' ? 'bg-warning' : 'bg-muted'}`}>
                  {signal.strength.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1">
                  {signal.type === 'Rise' && <TrendingUp className="w-5 h-5 text-profit" />}
                  {signal.type === 'Fall' && <TrendingDown className="w-5 h-5 text-loss" />}
                  {(signal.type === 'Even' || signal.type === 'Odd') && <Activity className="w-5 h-5 text-primary" />}
                  {(signal.type === 'Over' || signal.type === 'Under') && <ArrowUp className="w-5 h-5 text-primary" />}
                  {(signal.type === 'Match' || signal.type === 'Differ') && <Target className="w-5 h-5 text-profit" />}
                  <span className="text-lg font-bold text-foreground">{signal.type}</span>
                </div>
                <span className="text-xl font-mono font-bold text-primary">{Math.round(signal.confidence)}%</span>
              </div>
              <div className="h-1.5 bg-muted rounded-full mb-2">
                <div className={`h-full rounded-full ${signal.strength === 'strong' ? 'bg-profit' : signal.strength === 'moderate' ? 'bg-warning' : 'bg-muted-foreground'}`} style={{ width: `${signal.confidence}%` }} />
              </div>
              <div className="grid grid-cols-2 gap-1 text-[9px] text-muted-foreground">
                <span>E: {signal.evenPct.toFixed(0)}% / O: {signal.oddPct.toFixed(0)}%</span>
                <span>Ov: {signal.overPct.toFixed(0)}% / Un: {signal.underPct.toFixed(0)}%</span>
              </div>
              <div className="grid grid-cols-2 gap-1 text-[9px] text-muted-foreground mt-1">
                <span>Rise: {signal.risePct.toFixed(0)}%</span>
                <span>Fall: {signal.fallPct.toFixed(0)}%</span>
              </div>
              <Button size="sm" className="w-full mt-2 h-6 text-[9px]" variant="outline" onClick={(e) => { e.stopPropagation(); handleUseSignal(signal); }}>
                Use Signal
              </Button>
            </div>
          </motion.div>
        ))}
      </div>
      
      {/* Main Content Tabs */}
      <Tabs defaultValue="bot" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="bot">🤖 Bot Control</TabsTrigger>
          <TabsTrigger value="scanner">📊 Signal Scanner</TabsTrigger>
        </TabsList>
        
        {/* Bot Control Tab */}
        <TabsContent value="bot" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left Column - Bot Config */}
            <div className="lg:col-span-5 space-y-4">
              {/* Bot Status Card */}
              <Card className="border-2 border-primary/30">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      {isRunning ? <Zap className="w-4 h-4 text-profit animate-pulse" /> : <Play className="w-4 h-4 text-primary" />}
                      Bot Status
                    </span>
                    <Badge className={isRunning ? 'bg-profit' : 'bg-muted'}>
                      {isRunning ? 'RUNNING' : botStatus === 'waiting_signal' ? 'WAITING' : 'IDLE'}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Current Signal:</span>
                    <span className="font-mono font-bold">
                      {currentSignal ? `${currentSignal.type} on ${currentSignal.name} (${Math.round(currentSignal.confidence)}%)` : 'Waiting...'}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Win Rate:</span>
                    <span className="font-mono font-bold text-profit">{winRate}%</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">P/L:</span>
                    <span className={`font-mono font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      ${netProfit.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Current Stake:</span>
                    <span className="font-mono font-bold">${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-warning ml-1">M{martingaleStep}</span>}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Trades:</span>
                    <span className="font-mono font-bold">{wins + losses} ({wins}W / {losses}L)</span>
                  </div>
                </CardContent>
              </Card>
              
              {/* Bot Configuration */}
              <Card>
                <CardHeader className="py-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4" /> Bot Configuration
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-xs">Follow AI Signals</label>
                    <Switch checked={followSignal} onCheckedChange={setFollowSignal} disabled={isRunning} />
                  </div>
                  
                  {!followSignal && (
                    <>
                      <Select value={selectedMarket} onValueChange={setSelectedMarket} disabled={isRunning}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {VOLATILITY_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      
                      <Select value={contractType} onValueChange={setContractType} disabled={isRunning}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </>
                  )}
                  
                  {needsBarrier(contractType) && (
                    <div>
                      <label className="text-[10px] text-muted-foreground">Barrier Digit</label>
                      <Input type="number" min="0" max="9" value={barrier} onChange={e => setBarrier(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Stake ($)</label>
                      <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Duration</label>
                      <div className="flex gap-1">
                        <Input type="number" min="1" value={duration} onChange={e => setDuration(e.target.value)} disabled={isRunning} className="h-8 text-xs flex-1" />
                        <Select value={durationUnit} onValueChange={setDurationUnit} disabled={isRunning}>
                          <SelectTrigger className="h-8 text-xs w-14"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="t">T</SelectItem>
                            <SelectItem value="s">S</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="text-xs">Martingale</label>
                    <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
                  </div>
                  
                  {martingaleOn && (
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Multiplier</label>
                        <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Max Steps</label>
                        <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                      </div>
                    </div>
                  )}
                  
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] text-muted-foreground">Stop Loss ($)</label>
                      <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground">Take Profit ($)</label>
                      <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <label className="text-xs flex items-center gap-1"><Zap className="w-3 h-3" /> Turbo Mode</label>
                    <Switch checked={turboMode} onCheckedChange={setTurboMode} disabled={isRunning} />
                  </div>
                </CardContent>
              </Card>
              
              {/* Start/Stop Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <Button onClick={startBot} disabled={isRunning || !isAuthorized || balance < parseFloat(stake)} className="h-12 bg-profit hover:bg-profit/90 text-profit-foreground">
                  <Play className="w-4 h-4 mr-2" /> Start Bot
                </Button>
                <Button onClick={stopBot} disabled={!isRunning} variant="destructive" className="h-12">
                  <StopCircle className="w-4 h-4 mr-2" /> Stop Bot
                </Button>
              </div>
            </div>
            
            {/* Right Column - Activity Log */}
            <div className="lg:col-span-7">
              <Card className="h-full">
                <CardHeader className="py-3 flex-row items-center justify-between">
                  <CardTitle className="text-sm">Activity Log</CardTitle>
                  <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 text-muted-foreground">
                    <Trash2 className="w-3 h-3" /> Clear
                  </Button>
                </CardHeader>
                <CardContent className="max-h-[500px] overflow-auto">
                  {logEntries.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">No trades yet</div>
                  ) : (
                    <div className="space-y-1">
                      {logEntries.map(entry => (
                        <div key={entry.id} className={`p-2 rounded-lg border-l-4 ${entry.result === 'Win' ? 'border-profit bg-profit/5' : entry.result === 'Loss' ? 'border-loss bg-loss/5' : 'border-warning bg-warning/5'}`}>
                          <div className="flex justify-between text-[10px]">
                            <span className="font-mono">{entry.time}</span>
                            <span className={`font-bold ${entry.result === 'Win' ? 'text-profit' : entry.result === 'Loss' ? 'text-loss' : 'text-warning'}`}>
                              {entry.result}
                            </span>
                          </div>
                          <div className="flex justify-between text-[11px] mt-1">
                            <span>{entry.symbol}</span>
                            <span className="font-mono">${entry.stake.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
                            <span>{entry.contract}</span>
                            <span>Digit: {entry.exitDigit}</span>
                            <span className={entry.pnl >= 0 ? 'text-profit' : 'text-loss'}>
                              {entry.pnl !== 0 && `${entry.pnl >= 0 ? '+' : ''}$${entry.pnl.toFixed(2)}`}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>
        
        {/* Signal Scanner Tab */}
        <TabsContent value="scanner" className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-1">
              {['all', '1s', 'standard', 'jump', 'bear', 'bull'].map(g => (
                <Button key={g} size="sm" variant={groupFilter === g ? 'default' : 'outline'} className="h-6 text-[10px]" onClick={() => setGroupFilter(g)}>
                  {g === 'all' ? 'All' : g === '1s' ? '1s Vol' : g === 'standard' ? 'Standard' : g === 'jump' ? 'Jump' : g === 'bear' ? 'Bear' : 'Bull'}
                </Button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[9px] text-muted-foreground">Auto-refresh</span>
              <Switch checked={autoRefresh} onCheckedChange={setAutoRefresh} />
              <Button size="sm" variant="outline" onClick={loadAllMarkets} disabled={isLoadingMarkets} className="h-7 text-[10px]">
                <RefreshCw className={`w-3 h-3 mr-1 ${isLoadingMarkets ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </div>
          </div>
          
          {/* All Signals Table */}
          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">All Market Signals</CardTitle>
            </CardHeader>
            <CardContent className="max-h-[500px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-card">
                  <tr className="text-muted-foreground border-b">
                    <th className="p-2 text-left">Market</th>
                    <th className="p-2 text-left">Rise</th>
                    <th className="p-2 text-left">Fall</th>
                    <th className="p-2 text-left">Even</th>
                    <th className="p-2 text-left">Odd</th>
                    <th className="p-2 text-left">Over</th>
                    <th className="p-2 text-left">Under</th>
                    <th className="p-2 text-left">Match</th>
                    <th className="p-2 text-left">Differ</th>
                    <th className="p-2 text-left">Last</th>
                    <th className="p-2 text-left">Momentum</th>
                    <th className="p-2 text-left">RSI</th>
                   </tr>
                </thead>
                <tbody>
                  {filteredMarkets.map(market => {
                    const data = marketsData.get(market.symbol);
                    if (!data || data.isLoading) return null;
                    
                    const rise = signals.find(s => s.symbol === market.symbol && s.type === 'Rise');
                    const fall = signals.find(s => s.symbol === market.symbol && s.type === 'Fall');
                    const even = signals.find(s => s.symbol === market.symbol && s.type === 'Even');
                    const odd = signals.find(s => s.symbol === market.symbol && s.type === 'Odd');
                    const over = signals.find(s => s.symbol === market.symbol && s.type === 'Over');
                    const under = signals.find(s => s.symbol === market.symbol && s.type === 'Under');
                    const match = signals.find(s => s.symbol === market.symbol && s.type === 'Match');
                    const differ = signals.find(s => s.symbol === market.symbol && s.type === 'Differ');
                    
                    const momentumIndicator = data.momentum > 0.3 ? '↑↑' : data.momentum > 0 ? '↑' : data.momentum < -0.3 ? '↓↓' : data.momentum < 0 ? '↓' : '→';
                    
                    return (
                      <tr key={market.symbol} className="border-t border-border/30 hover:bg-muted/20">
                        <td className="p-2 font-mono font-bold">{market.name}</td>
                        <td className="p-2"><span className={`font-mono ${rise?.confidence >= 70 ? 'text-profit' : rise?.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.round(rise?.confidence || 0)}%</span></td>
                        <td className="p-2"><span className={`font-mono ${fall?.confidence >= 70 ? 'text-profit' : fall?.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.round(fall?.confidence || 0)}%</span></td>
                        <td className="p-2"><span className={`font-mono ${even?.confidence >= 70 ? 'text-profit' : even?.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.round(even?.confidence || 0)}%</span></td>
                        <td className="p-2"><span className={`font-mono ${odd?.confidence >= 70 ? 'text-profit' : odd?.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.round(odd?.confidence || 0)}%</span></td>
                        <td className="p-2"><span className={`font-mono ${over?.confidence >= 70 ? 'text-profit' : over?.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.round(over?.confidence || 0)}%</span></td>
                        <td className="p-2"><span className={`font-mono ${under?.confidence >= 70 ? 'text-profit' : under?.confidence >= 50 ? 'text-warning' : 'text-muted-foreground'}`}>{Math.round(under?.confidence || 0)}%</span></td>
                        <td className="p-2"><span className="font-mono">{match?.digit !== undefined ? `${match.digit} (${Math.round(match?.confidence || 0)}%)` : '-'}</span></td>
                        <td className="p-2"><span className="font-mono">{differ?.digit !== undefined ? `${differ.digit} (${Math.round(differ?.confidence || 0)}%)` : '-'}</span></td>
                        <td className="p-2 font-mono font-bold">{data.lastDigit}</td>
                        <td className="p-2 font-mono"><span className={data.momentum > 0 ? 'text-profit' : data.momentum < 0 ? 'text-loss' : ''}>{momentumIndicator}</span></td>
                        <td className="p-2 font-mono"><span className={data.rsi > 70 ? 'text-loss' : data.rsi < 30 ? 'text-profit' : ''}>{data.rsi.toFixed(1)}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
  }
