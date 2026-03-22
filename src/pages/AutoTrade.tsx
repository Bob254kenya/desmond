import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Minus,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Clock, Zap, Trophy, Play, Pause, StopCircle, Eye, EyeOff,
  Globe, Radar, TrendingUp as TrendingUpIcon, AlertCircle, Star, StarOff, Settings,
} from 'lucide-react';

/* ── Markets ── */
const ALL_MARKETS = [
  // Vol 1s
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: 'vol1s' },
  { symbol: '1HZ15V', name: 'Volatility 15 (1s)', group: 'vol1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: 'vol1s' },
  { symbol: '1HZ30V', name: 'Volatility 30 (1s)', group: 'vol1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: 'vol1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: 'vol1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: 'vol1s' },
  // Vol
  { symbol: 'R_10', name: 'Volatility 10', group: 'vol' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'vol' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'vol' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'vol' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'vol' },
  // Jump
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  // Bear/Bull
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
  // Step
  { symbol: 'stpRNG', name: 'Step Index', group: 'step' },
  // Range Break
  { symbol: 'RBRK100', name: 'Range Break 100', group: 'range' },
  { symbol: 'RBRK200', name: 'Range Break 200', group: 'range' },
];

// Market performance interface
interface MarketPerformance {
  symbol: string;
  name: string;
  tickHistory: number[];
  patternMatchScore: number;
  digitDistribution: Map<number, number>;
  volatility: number;
  recentWins: number;
  recentLosses: number;
  winRate: number;
  lastTradeTime: number;
  isActive: boolean;
  lastTicks: number[];
  totalTrades: number;
  avgProfit: number;
  avgLoss: number;
  totalPnL: number;
  consecutiveLosses: number;
  bestStreak: number;
  worstStreak: number;
  currentStreak: number;
}

interface MarketStats {
  symbol: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfit: number;
  avgLoss: number;
  totalPnL: number;
  lastTradeResult: 'win' | 'loss' | null;
  consecutiveLosses: number;
  bestStreak: number;
  worstStreak: number;
}

interface TradeRecord {
  id: string;
  time: number;
  type: string;
  stake: number;
  profit: number;
  status: 'won' | 'lost' | 'open';
  symbol: string;
  resultDigit?: number;
}

// Global tick storage for all markets
const globalTickHistory: { [symbol: string]: number[] } = {};

function getGlobalTickHistory(symbol: string): number[] {
  return globalTickHistory[symbol] || [];
}

function addGlobalTick(symbol: string, digit: number) {
  if (!globalTickHistory[symbol]) globalTickHistory[symbol] = [];
  globalTickHistory[symbol].push(digit);
  if (globalTickHistory[symbol].length > 200) globalTickHistory[symbol].shift();
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  const [showChart, setShowChart] = useState(false);
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Zoom & pan state
  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);

  // Trade panel
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeStake, setTradeStake] = useState('1.00');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [isTrading, setIsTrading] = useState(false);

  // Bot progress
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenSignal = useRef('');

  // Strategy State
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyMode, setStrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [patternInput, setPatternInput] = useState('');
  const [digitCondition, setDigitCondition] = useState('==');
  const [digitCompare, setDigitCompare] = useState('5');
  const [digitWindow, setDigitWindow] = useState('3');

  // Auto Bot state
  const [botRunning, setBotRunning] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const botRunningRef = useRef(false);
  const botPausedRef = useRef(false);
  const [botConfig, setBotConfig] = useState({
    stake: '1.00',
    contractType: 'CALL',
    prediction: '5',
    duration: '1',
    durationUnit: 't',
    martingale: false,
    multiplier: '2.0',
    stopLoss: '10',
    takeProfit: '20',
    maxTrades: '50',
  });
  const [botStats, setBotStats] = useState({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });
  const [turboMode, setTurboMode] = useState(false);

  // NEW: Pro Scanner Bot State
  const [scannerEnabled, setScannerEnabled] = useState(false);
  const [autoSwitchMode, setAutoSwitchMode] = useState<'fastest' | 'performance' | 'volatility'>('fastest');
  const [marketPerformances, setMarketPerformances] = useState<Map<string, MarketPerformance>>(new Map());
  const [marketStats, setMarketStats] = useState<Map<string, MarketStats>>(new Map());
  const [marketBlacklist, setMarketBlacklist] = useState<Set<string>>(new Set(['RDBEAR', 'RDBULL']));
  const [marketWhitelist, setMarketWhitelist] = useState<Set<string>>(new Set());
  const [selectedMarket, setSelectedMarket] = useState<string | null>(null);
  const [scanningInterval, setScanningInterval] = useState<NodeJS.Timeout | null>(null);
  const [marketSubscriptions, setMarketSubscriptions] = useState<Set<string>>(new Set());
  const [showMarketDashboard, setShowMarketDashboard] = useState(false);
  const [rebalanceCounter, setRebalanceCounter] = useState(0);
  const [scanMode, setScanMode] = useState<'auto' | 'manual'>('auto');
  const [minWinRateThreshold, setMinWinRateThreshold] = useState(40);
  const [maxConsecutiveLosses, setMaxConsecutiveLosses] = useState(3);

  // Helper function to calculate pattern match score
  const calculatePatternMatchScore = useCallback((ticks: number[], pattern: string): number => {
    if (!pattern || pattern.length === 0 || ticks.length < pattern.length) return 0;
    
    const recentTicks = ticks.slice(-pattern.length);
    let matches = 0;
    
    for (let i = 0; i < pattern.length; i++) {
      const expected = pattern[i];
      const actual = recentTicks[i] % 2 === 0 ? 'E' : 'O';
      if (expected === actual) matches++;
    }
    
    return (matches / pattern.length) * 100;
  }, []);

  // Helper function to calculate digit condition score
  const calculateDigitConditionScore = useCallback((ticks: number[], condition: string, compare: number, window: number): number => {
    if (ticks.length < window) return 0;
    
    const recentTicks = ticks.slice(-window);
    let matches = 0;
    
    recentTicks.forEach(d => {
      switch (condition) {
        case '>': if (d > compare) matches++; break;
        case '<': if (d < compare) matches++; break;
        case '>=': if (d >= compare) matches++; break;
        case '<=': if (d <= compare) matches++; break;
        case '==': if (d === compare) matches++; break;
        case '!=': if (d !== compare) matches++; break;
        default: break;
      }
    });
    
    return (matches / window) * 100;
  }, []);

  // Helper function to calculate volatility (standard deviation of digits)
  const calculateVolatility = useCallback((ticks: number[]): number => {
    if (ticks.length < 2) return 0;
    const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;
    const variance = ticks.reduce((sum, d) => sum + Math.pow(d - mean, 2), 0) / ticks.length;
    return Math.sqrt(variance);
  }, []);

  // Helper function to calculate digit distribution
  const calculateDigitDistribution = useCallback((ticks: number[]): Map<number, number> => {
    const distribution = new Map<number, number>();
    for (let i = 0; i <= 9; i++) distribution.set(i, 0);
    ticks.forEach(d => {
      distribution.set(d, (distribution.get(d) || 0) + 1);
    });
    return distribution;
  }, []);

  // Update market performance for a specific symbol
  const updateMarketPerformance = useCallback((symbol: string, newTick: number) => {
    setMarketPerformances(prev => {
      const current = prev.get(symbol) || {
        symbol,
        name: ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol,
        tickHistory: [],
        patternMatchScore: 0,
        digitDistribution: new Map(),
        volatility: 0,
        recentWins: 0,
        recentLosses: 0,
        winRate: 0,
        lastTradeTime: 0,
        isActive: true,
        lastTicks: [],
        totalTrades: 0,
        avgProfit: 0,
        avgLoss: 0,
        totalPnL: 0,
        consecutiveLosses: 0,
        bestStreak: 0,
        worstStreak: 0,
        currentStreak: 0,
      };
      
      const updatedTickHistory = [...current.tickHistory, newTick].slice(-200);
      const cleanPattern = patternInput.toUpperCase().replace(/[^EO]/g, '');
      let patternScore = 0;
      
      if (strategyEnabled && strategyMode === 'pattern' && cleanPattern.length >= 2) {
        patternScore = calculatePatternMatchScore(updatedTickHistory, cleanPattern);
      } else if (strategyEnabled && strategyMode === 'digit') {
        patternScore = calculateDigitConditionScore(
          updatedTickHistory,
          digitCondition,
          parseInt(digitCompare),
          parseInt(digitWindow)
        );
      }
      
      const volatility = calculateVolatility(updatedTickHistory);
      const digitDistribution = calculateDigitDistribution(updatedTickHistory);
      const winRate = current.totalTrades > 0 ? (current.recentWins / current.totalTrades) * 100 : 0;
      
      return new Map(prev).set(symbol, {
        ...current,
        tickHistory: updatedTickHistory,
        patternMatchScore: patternScore,
        digitDistribution,
        volatility,
        winRate,
        lastTicks: updatedTickHistory.slice(-10),
      });
    });
  }, [strategyEnabled, strategyMode, patternInput, digitCondition, digitCompare, digitWindow, calculatePatternMatchScore, calculateDigitConditionScore, calculateVolatility, calculateDigitDistribution]);

  // Subscribe to all markets for scanner
  useEffect(() => {
    if (!scannerEnabled || !isAuthorized) return;
    
    const subscribeToAllMarkets = async () => {
      for (const market of ALL_MARKETS) {
        if (marketBlacklist.has(market.symbol)) continue;
        if (marketWhitelist.size > 0 && !marketWhitelist.has(market.symbol)) continue;
        
        if (!marketSubscriptions.has(market.symbol)) {
          try {
            await derivApi.subscribeTicks(market.symbol as MarketSymbol, (data: any) => {
              if (!data.tick) return;
              const quote = data.tick.quote;
              const digit = getLastDigit(quote);
              addGlobalTick(market.symbol, digit);
              updateMarketPerformance(market.symbol, digit);
            });
            setMarketSubscriptions(prev => new Set(prev).add(market.symbol));
          } catch (err) {
            console.error(`Failed to subscribe to ${market.symbol}:`, err);
          }
        }
      }
    };
    
    subscribeToAllMarkets();
    
    // Update rankings every 500ms
    const interval = setInterval(() => {
      if (scannerEnabled && botRunningRef.current && !botPausedRef.current) {
        rankAndSelectMarket();
      }
    }, 500);
    
    setScanningInterval(interval);
    
    return () => {
      if (scanningInterval) clearInterval(scanningInterval);
      // Unsubscribe from all markets
      marketSubscriptions.forEach(async (sym) => {
        try {
          await derivApi.unsubscribeTicks(sym as MarketSymbol);
        } catch (err) {
          console.error(`Failed to unsubscribe from ${sym}:`, err);
        }
      });
    };
  }, [scannerEnabled, isAuthorized, marketBlacklist, marketWhitelist, updateMarketPerformance]);

  // Rank and select best market based on current mode
  const rankAndSelectMarket = useCallback(() => {
    const performances = Array.from(marketPerformances.values())
      .filter(p => p.isActive && p.tickHistory.length >= 10);
    
    if (performances.length === 0) return;
    
    let rankedMarkets: MarketPerformance[] = [];
    
    switch (autoSwitchMode) {
      case 'fastest':
        // Rank by pattern match score
        rankedMarkets = performances.sort((a, b) => b.patternMatchScore - a.patternMatchScore);
        break;
        
      case 'performance':
        // Rank by win rate and total PnL
        rankedMarkets = performances.sort((a, b) => {
          const scoreA = (a.winRate * 0.7) + (a.totalPnL * 0.3);
          const scoreB = (b.winRate * 0.7) + (b.totalPnL * 0.3);
          return scoreB - scoreA;
        });
        break;
        
      case 'volatility':
        // Rank by volatility
        rankedMarkets = performances.sort((a, b) => b.volatility - a.volatility);
        break;
    }
    
    // Filter markets that meet minimum requirements
    const viableMarkets = rankedMarkets.filter(m => {
      const meetsWinRate = m.winRate >= minWinRateThreshold || m.totalTrades === 0;
      const meetsConsecutiveLosses = m.consecutiveLosses < maxConsecutiveLosses;
      const meetsPatternScore = !strategyEnabled || m.patternMatchScore > 0;
      return meetsWinRate && meetsConsecutiveLosses && meetsPatternScore;
    });
    
    if (viableMarkets.length > 0) {
      const bestMarket = viableMarkets[0];
      if (bestMarket.symbol !== selectedMarket) {
        setSelectedMarket(bestMarket.symbol);
        if (voiceEnabled) {
          speak(`Switching to ${bestMarket.name}. Score: ${bestMarket.patternMatchScore.toFixed(0)} percent`);
        }
      }
    }
  }, [marketPerformances, autoSwitchMode, strategyEnabled, minWinRateThreshold, maxConsecutiveLosses, selectedMarket, voiceEnabled]);

  // Update market stats after trade
  const updateMarketStats = useCallback((symbol: string, result: 'win' | 'lost', profit: number) => {
    setMarketStats(prev => {
      const current = prev.get(symbol) || {
        symbol,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        avgProfit: 0,
        avgLoss: 0,
        totalPnL: 0,
        lastTradeResult: null,
        consecutiveLosses: 0,
        bestStreak: 0,
        worstStreak: 0,
      };
      
      const totalTrades = current.totalTrades + 1;
      const wins = result === 'win' ? current.wins + 1 : current.wins;
      const losses = result === 'lost' ? current.losses + 1 : current.losses;
      const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
      const totalPnL = current.totalPnL + profit;
      
      let consecutiveLosses = result === 'lost' ? current.consecutiveLosses + 1 : 0;
      let bestStreak = current.bestStreak;
      let worstStreak = current.worstStreak;
      
      if (result === 'win') {
        bestStreak = Math.max(bestStreak, current.currentStreak || 0);
      } else {
        worstStreak = Math.min(worstStreak, -(current.consecutiveLosses || 0));
      }
      
      const avgProfit = wins > 0 ? (current.avgProfit * current.wins + (profit > 0 ? profit : 0)) / wins : 0;
      const avgLoss = losses > 0 ? (current.avgLoss * current.losses + (profit < 0 ? Math.abs(profit) : 0)) / losses : 0;
      
      return new Map(prev).set(symbol, {
        ...current,
        totalTrades,
        wins,
        losses,
        winRate,
        totalPnL,
        avgProfit,
        avgLoss,
        lastTradeResult: result,
        consecutiveLosses,
        bestStreak,
        worstStreak,
      });
    });
    
    // Also update market performance
    setMarketPerformances(prev => {
      const current = prev.get(symbol);
      if (!current) return prev;
      
      const recentWins = result === 'win' ? current.recentWins + 1 : current.recentWins;
      const recentLosses = result === 'lost' ? current.recentLosses + 1 : current.recentLosses;
      const totalTrades = current.totalTrades + 1;
      const winRate = totalTrades > 0 ? (recentWins / totalTrades) * 100 : 0;
      const consecutiveLosses = result === 'lost' ? current.consecutiveLosses + 1 : 0;
      const totalPnL = current.totalPnL + profit;
      
      return new Map(prev).set(symbol, {
        ...current,
        recentWins,
        recentLosses,
        totalTrades,
        winRate,
        consecutiveLosses,
        totalPnL,
        lastTradeTime: Date.now(),
      });
    });
  }, []);

  // Modified trade execution to use selected market from scanner
  const executeTradeOnMarket = useCallback(async (targetSymbol: string) => {
    if (!isAuthorized) { toast.error('Please login to your Deriv account first'); return false; }
    if (isTrading) return false;
    
    setIsTrading(true);
    const ct = contractType;
    const params: any = {
      contract_type: ct,
      symbol: targetSymbol,
      duration: parseInt(duration),
      duration_unit: durationUnit,
      basis: 'stake',
      amount: parseFloat(tradeStake)
    };
    
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) {
      params.barrier = prediction;
    }
    
    try {
      toast.info(`⏳ Placing ${ct} trade on ${targetSymbol}... $${tradeStake}`);
      const { contractId } = await derivApi.buyContract(params);
      const newTrade: TradeRecord = {
        id: contractId,
        time: Date.now(),
        type: ct,
        stake: parseFloat(tradeStake),
        profit: 0,
        status: 'open',
        symbol: targetSymbol
      };
      setTradeHistory(prev => [newTrade, ...prev].slice(0, 50));
      
      const result = await derivApi.waitForContractResult(contractId);
      const resultDigit = getLastDigit(result.price || 0);
      
      setTradeHistory(prev => prev.map(t => t.id === contractId ? {
        ...t,
        profit: result.profit,
        status: result.status,
        resultDigit
      } : t));
      
      // Update market stats
      updateMarketStats(targetSymbol, result.status, result.profit);
      
      if (result.status === 'won') {
        toast.success(`✅ WON +$${result.profit.toFixed(2)} on ${targetSymbol} | Digit: ${resultDigit}`);
        if (voiceEnabled) speak(`Trade won on ${targetSymbol}. Profit ${result.profit.toFixed(2)} dollars`);
        return true;
      } else {
        toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)} on ${targetSymbol} | Digit: ${resultDigit}`);
        if (voiceEnabled) speak(`Trade lost on ${targetSymbol}. Loss ${Math.abs(result.profit).toFixed(2)} dollars`);
        return false;
      }
    } catch (err: any) {
      toast.error(`Trade failed: ${err.message}`);
      return false;
    } finally {
      setIsTrading(false);
    }
  }, [isAuthorized, contractType, duration, durationUnit, tradeStake, prediction, voiceEnabled, updateMarketStats]);

  // Modified bot logic with market switching
  const startScannerBot = useCallback(async () => {
    if (!isAuthorized) { toast.error('Login to Deriv first'); return; }
    setBotRunning(true);
    setBotPaused(false);
    botRunningRef.current = true;
    botPausedRef.current = false;
    setScannerEnabled(true);
    
    const baseStake = parseFloat(botConfig.stake) || 1;
    const sl = parseFloat(botConfig.stopLoss) || 10;
    const tp = parseFloat(botConfig.takeProfit) || 20;
    const maxT = parseInt(botConfig.maxTrades) || 50;
    const mart = botConfig.martingale;
    const mult = parseFloat(botConfig.multiplier) || 2;
    let stake = baseStake;
    let pnl = 0;
    let trades = 0;
    let wins = 0;
    let losses = 0;
    let consLosses = 0;
    
    if (voiceEnabled) speak('Auto scanner bot started. Monitoring all markets.');
    toast.info('🤖 Scanner Bot started - Monitoring all markets');
    
    while (botRunningRef.current) {
      if (botPausedRef.current) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      if (trades >= maxT || pnl <= -sl || pnl >= tp) {
        const reason = trades >= maxT ? 'Max trades reached' : pnl <= -sl ? 'Stop loss hit' : 'Take profit reached';
        toast.info(`🤖 Bot stopped: ${reason}`);
        if (voiceEnabled) speak(`Bot stopped. ${reason}. Total profit ${pnl.toFixed(2)} dollars`);
        break;
      }
      
      // Check strategy condition before each trade
      if (strategyEnabled) {
        let conditionMet = false;
        while (botRunningRef.current && !conditionMet) {
          // Check condition on selected market or any market
          const marketToCheck = selectedMarket || symbol;
          const ticks = getGlobalTickHistory(marketToCheck);
          
          if (strategyMode === 'pattern') {
            const cleanPattern = patternInput.toUpperCase().replace(/[^EO]/g, '');
            conditionMet = calculatePatternMatchScore(ticks, cleanPattern) === 100;
          } else {
            conditionMet = calculateDigitConditionScore(
              ticks,
              digitCondition,
              parseInt(digitCompare),
              parseInt(digitWindow)
            ) === 100;
          }
          
          if (!conditionMet) {
            await new Promise(r => setTimeout(r, turboMode ? 100 : 500));
          }
        }
        if (!botRunningRef.current) break;
      }
      
      // Select best market for trading
      let targetMarket = selectedMarket;
      if (!targetMarket || !marketPerformances.has(targetMarket)) {
        // If no market selected, rank and select one
        const performances = Array.from(marketPerformances.values())
          .filter(p => p.isActive && p.tickHistory.length >= 10);
        
        if (performances.length === 0) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        
        let bestMarket = performances[0];
        if (autoSwitchMode === 'fastest') {
          bestMarket = performances.reduce((best, curr) => 
            curr.patternMatchScore > best.patternMatchScore ? curr : best
          );
        } else if (autoSwitchMode === 'performance') {
          bestMarket = performances.reduce((best, curr) => 
            (curr.winRate * 0.7 + curr.totalPnL * 0.3) > (best.winRate * 0.7 + best.totalPnL * 0.3) ? curr : best
          );
        } else if (autoSwitchMode === 'volatility') {
          bestMarket = performances.reduce((best, curr) => 
            curr.volatility > best.volatility ? curr : best
          );
        }
        
        targetMarket = bestMarket.symbol;
        setSelectedMarket(targetMarket);
      }
      
      // Execute trade on selected market
      const ct = botConfig.contractType;
      const params: any = {
        contract_type: ct,
        symbol: targetMarket,
        duration: parseInt(botConfig.duration),
        duration_unit: botConfig.durationUnit,
        basis: 'stake',
        amount: stake
      };
      
      if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) {
        params.barrier = botConfig.prediction;
      }
      
      try {
        const { contractId } = await derivApi.buyContract(params);
        const tr: TradeRecord = {
          id: contractId,
          time: Date.now(),
          type: ct,
          stake,
          profit: 0,
          status: 'open',
          symbol: targetMarket
        };
        setTradeHistory(prev => [tr, ...prev].slice(0, 100));
        
        const result = await derivApi.waitForContractResult(contractId);
        trades++;
        pnl += result.profit;
        const resultDigit = getLastDigit(result.price || 0);
        
        setTradeHistory(prev => prev.map(t => t.id === contractId ? {
          ...t,
          profit: result.profit,
          status: result.status,
          resultDigit
        } : t));
        
        // Update market stats
        updateMarketStats(targetMarket, result.status, result.profit);
        
        if (result.status === 'won') {
          wins++;
          consLosses = 0;
          stake = baseStake;
          
          // If we won, maybe stay on same market or re-evaluate
          if (autoSwitchMode === 'performance') {
            // Stay on winning market
          } else if (autoSwitchMode === 'fastest') {
            // Re-evaluate for next trade
            setSelectedMarket(null);
          }
          
          if (voiceEnabled && trades % 5 === 0) {
            speak(`Trade ${trades} won on ${targetMarket}. Total profit ${pnl.toFixed(2)}`);
          }
        } else {
          losses++;
          consLosses++;
          stake = mart ? Math.round(stake * mult * 100) / 100 : baseStake;
          
          // On loss, switch to next best market
          if (autoSwitchMode !== 'performance') {
            setSelectedMarket(null);
            if (voiceEnabled) {
              speak(`Loss on ${targetMarket}. Switching to next best market.`);
            }
          }
          
          if (voiceEnabled) {
            speak(`Loss ${consLosses} on ${targetMarket}. ${mart ? `Martingale stake ${stake.toFixed(2)}` : ''}`);
          }
        }
        
        setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
        
        // Rebalance every 50 trades
        if (trades % 50 === 0 && autoSwitchMode === 'performance') {
          setRebalanceCounter(prev => prev + 1);
          setSelectedMarket(null);
          if (voiceEnabled) speak('Rebalancing market selection based on performance');
        }
        
      } catch (err: any) {
        toast.error(`Bot trade error: ${err.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
    
    setBotRunning(false);
    botRunningRef.current = false;
    setScannerEnabled(false);
    setBotStats(prev => ({ ...prev, trades, wins, losses, pnl }));
  }, [isAuthorized, botConfig, voiceEnabled, speak, strategyEnabled, strategyMode, patternInput, digitCondition, digitCompare, digitWindow, selectedMarket, symbol, marketPerformances, autoSwitchMode, turboMode, updateMarketStats]);

  const stopBot = useCallback(() => {
    botRunningRef.current = false;
    setBotRunning(false);
    setScannerEnabled(false);
    toast.info('🛑 Bot stopped');
    if (voiceEnabled) speak('Bot stopped');
  }, [voiceEnabled]);
  
  const togglePauseBot = useCallback(() => {
    botPausedRef.current = !botPausedRef.current;
    setBotPaused(botPausedRef.current);
    if (voiceEnabled) speak(botPausedRef.current ? 'Bot paused' : 'Bot resumed');
  }, [voiceEnabled]);

  // Manual scan all markets
  const scanAllMarkets = useCallback(() => {
    const performances = Array.from(marketPerformances.values());
    const ranked = performances
      .filter(p => p.tickHistory.length >= 10)
      .sort((a, b) => b.patternMatchScore - a.patternMatchScore);
    
    toast.info(`Scanned ${ranked.length} markets. Top: ${ranked[0]?.name || 'None'} (${ranked[0]?.patternMatchScore.toFixed(0)}%)`);
    
    if (ranked.length > 0) {
      setSelectedMarket(ranked[0].symbol);
    }
  }, [marketPerformances]);

  // Toggle market blacklist
  const toggleMarketBlacklist = useCallback((symbol: string) => {
    setMarketBlacklist(prev => {
      const newSet = new Set(prev);
      if (newSet.has(symbol)) {
        newSet.delete(symbol);
        toast.info(`${symbol} removed from blacklist`);
      } else {
        newSet.add(symbol);
        toast.warning(`${symbol} added to blacklist`);
      }
      return newSet;
    });
  }, []);

  // Get top performing markets for display
  const topMarkets = useMemo(() => {
    return Array.from(marketPerformances.values())
      .filter(p => p.tickHistory.length >= 10)
      .sort((a, b) => b.patternMatchScore - a.patternMatchScore)
      .slice(0, 10);
  }, [marketPerformances]);

  // ... (rest of the existing component code for chart, indicators, etc.)
  // I'll include only the new UI components and modified parts
  
  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  // Voice function (keep existing)
  const speak = useCallback((text: string) => {
    if (!voiceEnabled || !window.speechSynthesis) return;
    if (lastSpokenSignal.current === text) return;
    lastSpokenSignal.current = text;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.pitch = 1;
    utterance.volume = 0.8;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }, [voiceEnabled]);

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto">
      {/* Header - same as before */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-primary" /> Trading Chart
          </h1>
          <p className="text-xs text-muted-foreground">
            {ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol} • {timeframe} • {prices.length} ticks
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowChart(!showChart)}
            variant="outline"
            size="sm"
            className="gap-1"
          >
            {showChart ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            {showChart ? "Hide Chart" : "Show Chart"}
          </Button>
          <Badge className="font-mono text-sm" variant="outline">
            {prices[prices.length - 1]?.toFixed(4) || '0.0000'}
          </Badge>
        </div>
      </div>

      {/* Market Selector - same as before */}
      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex flex-wrap gap-1 mb-2">
          {GROUPS.map(g => (
            <Button key={g.value} size="sm" variant={groupFilter === g.value ? 'default' : 'outline'}
              className="h-6 text-[10px] px-2" onClick={() => setGroupFilter(g.value)}>
              {g.label}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1 max-h-20 overflow-auto">
          {filteredMarkets.map(m => (
            <Button key={m.symbol} size="sm"
              variant={symbol === m.symbol ? 'default' : 'ghost'}
              className={`h-6 text-[9px] px-2 ${symbol === m.symbol ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              onClick={() => setSymbol(m.symbol)}>
              {m.name}
            </Button>
          ))}
        </div>
      </div>

      {/* Timeframe - same as before */}
      <div className="flex flex-wrap gap-1">
        {TIMEFRAMES.map(tf => (
          <Button key={tf} size="sm" variant={timeframe === tf ? 'default' : 'outline'}
            className={`h-7 text-xs px-3 ${timeframe === tf ? 'bg-primary text-primary-foreground' : ''}`}
            onClick={() => setTimeframe(tf)}>
            {tf}
          </Button>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* LEFT SIDE - Chart and Analysis (same as before, keep existing code) */}
        <div className="xl:col-span-8 space-y-3">
          {/* Chart canvas - keep existing */}
          <AnimatePresence mode="wait">
            {showChart && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
                className="overflow-hidden"
              >
                <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden">
                  <canvas ref={canvasRef} className="w-full" style={{ height: 520, cursor: 'crosshair' }} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Price Info Panel - keep existing */}
          {/* ... keep existing price info panel ... */}
        </div>

        {/* RIGHT SIDE - Enhanced Scanner Bot Panel */}
        <div className="xl:col-span-4 space-y-3">
          {/* Voice AI Toggle - keep existing */}
          <div className="bg-card border border-primary/30 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Zap className="w-3.5 h-3.5 text-primary" /> AI Voice Signals
              </h3>
              <Button
                size="sm"
                variant={voiceEnabled ? 'default' : 'outline'}
                className="h-7 text-[10px] gap-1"
                onClick={() => {
                  setVoiceEnabled(!voiceEnabled);
                  if (!voiceEnabled) {
                    const u = new SpeechSynthesisUtterance('Voice signals enabled');
                    u.rate = 1.1;
                    window.speechSynthesis?.speak(u);
                  } else {
                    window.speechSynthesis?.cancel();
                  }
                }}
              >
                {voiceEnabled ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />}
                {voiceEnabled ? 'ON' : 'OFF'}
              </Button>
            </div>
            {voiceEnabled && (
              <p className="text-[9px] text-muted-foreground mt-1">🔊 AI will announce market switches and trade results</p>
            )}
          </div>

          {/* ═══ PRO SCANNER BOT PANEL ═══ */}
          <div className={`bg-card border rounded-xl p-3 space-y-2 ${botRunning ? 'border-profit glow-profit' : 'border-border'}`}>
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Radar className="w-3.5 h-3.5 text-primary" /> Ramzfx Pro Scanner Bot
              </h3>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={turboMode ? 'default' : 'outline'}
                  className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit hover:bg-profit/90 text-profit-foreground animate-pulse' : ''}`}
                  onClick={() => setTurboMode(!turboMode)}
                  disabled={botRunning}
                >
                  <Zap className="w-3 h-3 mr-0.5" />
                  {turboMode ? '⚡ TURBO' : 'Turbo'}
                </Button>
                {botRunning && (
                  <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}>
                    <Badge className="text-[8px] bg-profit text-profit-foreground">SCANNING</Badge>
                  </motion.div>
                )}
              </div>
            </div>

            {/* Scanner Mode Selection */}
            <div className="space-y-1">
              <label className="text-[9px] text-muted-foreground">Scanner Mode</label>
              <Select value={autoSwitchMode} onValueChange={(v: any) => setAutoSwitchMode(v)} disabled={botRunning}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fastest">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3 h-3" />
                      <span>Fastest Pattern</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="performance">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-3 h-3" />
                      <span>Best Performance</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="volatility">
                    <div className="flex items-center gap-2">
                      <TrendingUpIcon className="w-3 h-3" />
                      <span>Highest Volatility</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Scan Settings */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[8px] text-muted-foreground">Min Win Rate %</label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={minWinRateThreshold}
                  onChange={e => setMinWinRateThreshold(parseInt(e.target.value))}
                  disabled={botRunning}
                  className="h-7 text-xs"
                />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Max Consecutive Losses</label>
                <Input
                  type="number"
                  min="1"
                  max="10"
                  value={maxConsecutiveLosses}
                  onChange={e => setMaxConsecutiveLosses(parseInt(e.target.value))}
                  disabled={botRunning}
                  className="h-7 text-xs"
                />
              </div>
            </div>

            {/* Strategy Section (same as before) */}
            <div className="border-t border-border pt-2 mt-1">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-semibold text-warning flex items-center gap-1">
                  <Zap className="w-3 h-3" /> Pattern/Digit Strategy
                </label>
                <Switch checked={strategyEnabled} onCheckedChange={setStrategyEnabled} disabled={botRunning} />
              </div>

              {strategyEnabled && (
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant={strategyMode === 'pattern' ? 'default' : 'outline'}
                      className="text-[9px] h-6 px-2 flex-1"
                      onClick={() => setStrategyMode('pattern')}
                      disabled={botRunning}
                    >
                      Pattern (E/O)
                    </Button>
                    <Button
                      size="sm"
                      variant={strategyMode === 'digit' ? 'default' : 'outline'}
                      className="text-[9px] h-6 px-2 flex-1"
                      onClick={() => setStrategyMode('digit')}
                      disabled={botRunning}
                    >
                      Digit Condition 
                    </Button>
                  </div>

                  {strategyMode === 'pattern' ? (
                    <div>
                      <label className="text-[8px] text-muted-foreground">Pattern (E=Even, O=Odd)</label>
                      <Textarea
                        placeholder="e.g., EEEOE or OOEEO"
                        value={patternInput}
                        onChange={e => setPatternInput(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={botRunning}
                        className="h-12 text-[10px] font-mono min-h-0 mt-1"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <div>
                        <label className="text-[8px] text-muted-foreground">Last</label>
                        <Input type="number" min="1" max="50" value={digitWindow}
                          onChange={e => setDigitWindow(e.target.value)} disabled={botRunning}
                          className="h-7 text-[10px]" />
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">Ticks</label>
                        <Select value={digitCondition} onValueChange={setDigitCondition} disabled={botRunning}>
                          <SelectTrigger className="h-7 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '!=', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-[8px] text-muted-foreground">Digit</label>
                        <Input type="number" min="0" max="9" value={digitCompare}
                          onChange={e => setDigitCompare(e.target.value)} disabled={botRunning}
                          className="h-7 text-[10px]" />
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Bot Configuration (same as before) */}
            <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={botConfig.stake}
                  onChange={e => setBotConfig(p => ({ ...p, stake: e.target.value }))} disabled={botRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[9px] text-muted-foreground">Duration</label>
                <div className="flex gap-1">
                  <Input type="number" min="1" value={botConfig.duration}
                    onChange={e => setBotConfig(p => ({ ...p, duration: e.target.value }))} disabled={botRunning} className="h-7 text-xs flex-1" />
                  <Select value={botConfig.durationUnit} onValueChange={v => setBotConfig(p => ({ ...p, durationUnit: v }))} disabled={botRunning}>
                    <SelectTrigger className="h-7 text-xs w-16"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="t">T</SelectItem>
                      <SelectItem value="s">S</SelectItem>
                      <SelectItem value="m">M</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Martingale</label>
              <div className="flex items-center gap-2">
                {botConfig.martingale && (
                  <Input type="number" min="1.1" step="0.1" value={botConfig.multiplier}
                    onChange={e => setBotConfig(p => ({ ...p, multiplier: e.target.value }))} disabled={botRunning}
                    className="h-6 text-[10px] w-14" />
                )}
                <button onClick={() => setBotConfig(p => ({ ...p, martingale: !p.martingale }))} disabled={botRunning}
                  className={`w-9 h-5 rounded-full transition-colors ${botConfig.martingale ? 'bg-primary' : 'bg-muted'} relative`}>
                  <div className={`w-4 h-4 rounded-full bg-background shadow absolute top-0.5 transition-transform ${botConfig.martingale ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
            </div>

            {/* Market Dashboard Toggle */}
            <Button
              variant="outline"
              size="sm"
              className="w-full h-7 text-[10px] gap-1"
              onClick={() => setShowMarketDashboard(!showMarketDashboard)}
            >
              <Globe className="w-3 h-3" />
              {showMarketDashboard ? 'Hide Market Dashboard' : 'Show Market Dashboard'}
            </Button>

            {/* Market Rankings Dashboard */}
            <AnimatePresence>
              {showMarketDashboard && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="space-y-2 overflow-hidden"
                >
                  <div className="flex items-center justify-between">
                    <h4 className="text-[9px] font-semibold text-foreground">Live Market Rankings</h4>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[8px]"
                      onClick={scanAllMarkets}
                      disabled={botRunning}
                    >
                      <Radar className="w-2.5 h-2.5 mr-1" />
                      Scan All
                    </Button>
                  </div>
                  
                  <div className="max-h-60 overflow-auto space-y-1.5">
                    {topMarkets.map((market, idx) => {
                      const isBlacklisted = marketBlacklist.has(market.symbol);
                      const isSelected = selectedMarket === market.symbol;
                      const marketStat = marketStats.get(market.symbol);
                      
                      return (
                        <div
                          key={market.symbol}
                          className={`p-2 rounded-lg border transition-all ${
                            isSelected ? 'border-primary bg-primary/5' :
                            isBlacklisted ? 'border-loss/30 bg-loss/5 opacity-60' :
                            'border-border'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-mono font-bold text-foreground">
                                #{idx + 1}
                              </span>
                              <span className="text-[10px] font-semibold">{market.name}</span>
                              <Badge variant="outline" className="text-[7px] px-1">
                                Score: {market.patternMatchScore.toFixed(0)}%
                              </Badge>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-5 w-5 p-0"
                                onClick={() => toggleMarketBlacklist(market.symbol)}
                              >
                                {isBlacklisted ? <StarOff className="w-3 h-3 text-loss" /> : <Star className="w-3 h-3 text-muted-foreground" />}
                              </Button>
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-4 gap-1 text-[8px]">
                            <div>
                              <span className="text-muted-foreground">Volatility</span>
                              <span className="ml-1 font-mono">{market.volatility.toFixed(2)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Win Rate</span>
                              <span className={`ml-1 font-mono ${market.winRate >= 50 ? 'text-profit' : 'text-loss'}`}>
                                {market.winRate.toFixed(0)}%
                              </span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Trades</span>
                              <span className="ml-1 font-mono">{market.totalTrades}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">P/L</span>
                              <span className={`ml-1 font-mono ${market.totalPnL >= 0 ? 'text-profit' : 'text-loss'}`}>
                                ${market.totalPnL.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          
                          {/* Last 10 digits */}
                          <div className="flex gap-0.5 mt-1">
                            {market.lastTicks.slice(-10).map((digit, i) => (
                              <div
                                key={i}
                                className={`w-4 h-4 rounded text-[7px] flex items-center justify-center font-mono ${
                                  digit % 2 === 0 ? 'bg-profit/20 text-profit' : 'bg-loss/20 text-loss'
                                }`}
                              >
                                {digit}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bot Stats */}
            {botRunning && (
              <div className="grid grid-cols-3 gap-1 text-center">
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Stake</div>
                  <div className="font-mono text-[10px] font-bold text-foreground">${botStats.currentStake.toFixed(2)}</div>
                </div>
                <div className="bg-muted/30 rounded p-1">
                  <div className="text-[7px] text-muted-foreground">Streak</div>
                  <div className="font-mono text-[10px] font-bold text-loss">{botStats.consecutiveLosses}L</div>
                </div>
                <div className={`${botStats.pnl >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded p-1`}>
                  <div className="text-[7px] text-muted-foreground">P/L</div>
                  <div className={`font-mono text-[10px] font-bold ${botStats.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
                    {botStats.pnl >= 0 ? '+' : ''}{botStats.pnl.toFixed(2)}
                  </div>
                </div>
              </div>
            )}

            {/* Current Active Market */}
            {selectedMarket && !botRunning && (
              <div className="bg-primary/10 rounded-lg p-2 text-center">
                <div className="text-[8px] text-muted-foreground">Currently Selected Market</div>
                <div className="font-mono text-sm font-bold text-primary">
                  {ALL_MARKETS.find(m => m.symbol === selectedMarket)?.name || selectedMarket}
                </div>
              </div>
            )}

            {/* Control Buttons */}
            <div className="flex gap-2">
              {!botRunning ? (
                <Button onClick={startScannerBot} disabled={!isAuthorized} className="flex-1 h-10 text-xs font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
                  <Radar className="w-4 h-4 mr-1" /> Start Scanner Bot
                </Button>
              ) : (
                <>
                  <Button onClick={togglePauseBot} variant="outline" className="flex-1 h-10 text-xs">
                    <Pause className="w-3.5 h-3.5 mr-1" /> {botPaused ? 'Resume' : 'Pause'}
                  </Button>
                  <Button onClick={stopBot} variant="destructive" className="flex-1 h-10 text-xs">
                    <StopCircle className="w-3.5 h-3.5 mr-1" /> Stop
                  </Button>
                </>
              )}
            </div>

            {/* Scanner Status */}
            {scannerEnabled && !botRunning && (
              <div className="text-center text-[8px] text-muted-foreground">
                <Radar className="w-3 h-3 inline mr-1 animate-pulse" />
                Scanner active - Monitoring {marketSubscriptions.size} markets
              </div>
            )}
          </div>

          {/* Trade History Panel (same as before) */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
                <Trophy className="w-3.5 h-3.5 text-primary" /> Trade Progress
              </h3>
              {tradeHistory.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-[9px] text-muted-foreground hover:text-loss"
                  onClick={() => { setTradeHistory([]); setBotStats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 }); }}>
                  Clear
                </Button>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-muted/30 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-muted-foreground">Trades</div>
                <div className="font-mono text-sm font-bold text-foreground">{totalTrades}</div>
              </div>
              <div className="bg-profit/10 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-profit">Wins</div>
                <div className="font-mono text-sm font-bold text-profit">{wins}</div>
              </div>
              <div className="bg-loss/10 rounded-lg p-1.5 text-center">
                <div className="text-[8px] text-loss">Losses</div>
                <div className="font-mono text-sm font-bold text-loss">{losses}</div>
              </div>
              <div className={`${totalProfit >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded-lg p-1.5 text-center`}>
                <div className="text-[8px] text-muted-foreground">P/L</div>
                <div className={`font-mono text-sm font-bold ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}
                </div>
              </div>
            </div>
            {totalTrades > 0 && (
              <div>
                <div className="flex justify-between text-[9px] text-muted-foreground mb-0.5">
                  <span>Win Rate</span>
                  <span className="font-mono font-bold">{winRate.toFixed(1)}%</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-profit rounded-full" style={{ width: `${winRate}%` }} />
                </div>
              </div>
            )}

            {/* Trade History List */}
            {tradeHistory.length > 0 && (
              <div className="max-h-40 overflow-auto space-y-1">
                {tradeHistory.slice(0, 10).map(t => (
                  <div key={t.id} className={`flex items-center justify-between text-[9px] p-1.5 rounded-lg border ${
                    t.status === 'open' ? 'border-primary/30 bg-primary/5' :
                    t.status === 'won' ? 'border-profit/30 bg-profit/5' :
                    'border-loss/30 bg-loss/5'
                  }`}>
                    <div className="flex items-center gap-1.5">
                      <span className={`font-bold ${t.status === 'won' ? 'text-profit' : t.status === 'lost' ? 'text-loss' : 'text-primary'}`}>
                        {t.status === 'open' ? '⏳' : t.status === 'won' ? '✅' : '❌'}
                      </span>
                      <span className="font-mono text-muted-foreground">{t.type}</span>
                      <span className="text-muted-foreground">${t.stake.toFixed(2)}</span>
                      <span className="text-[8px] text-muted-foreground">{t.symbol}</span>
                      {t.resultDigit !== undefined && (
                        <Badge variant="outline" className={`text-[7px] px-1 ${t.status === 'won' ? 'border-profit text-profit' : 'border-loss text-loss'}`}>
                          {t.resultDigit}
                        </Badge>
                      )}
                    </div>
                    <span className={`font-mono font-bold ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>
                      {t.status === 'open' ? '...' : `${t.profit >= 0 ? '+' : ''}$${t.profit.toFixed(2)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Technical Status - keep existing */}
          <div className="bg-card border border-border rounded-xl p-3 space-y-2">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-primary" /> Technical Status
            </h3>
            {/* ... keep existing technical status content ... */}
          </div>
        </div>
      </div>
    </div>
  );
}
