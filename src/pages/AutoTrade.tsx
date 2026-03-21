import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { copyTradingService } from '@/services/copy-trading-service';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown,
  Target, ShieldAlert, Zap, Trophy, Play, Pause, StopCircle,
  Scan, Home, RefreshCw, Eye, Anchor, Download, Upload, Bot,
  ChevronUp, ChevronDown, EyeOff,
} from 'lucide-react';

/* ── Markets ── */
const ALL_MARKETS = [
  { symbol: '1HZ10V', name: 'Volatility 10 (1s)', group: 'vol1s' },
  { symbol: '1HZ15V', name: 'Volatility 15 (1s)', group: 'vol1s' },
  { symbol: '1HZ25V', name: 'Volatility 25 (1s)', group: 'vol1s' },
  { symbol: '1HZ30V', name: 'Volatility 30 (1s)', group: 'vol1s' },
  { symbol: '1HZ50V', name: 'Volatility 50 (1s)', group: 'vol1s' },
  { symbol: '1HZ75V', name: 'Volatility 75 (1s)', group: 'vol1s' },
  { symbol: '1HZ100V', name: 'Volatility 100 (1s)', group: 'vol1s' },
  { symbol: 'R_10', name: 'Volatility 10', group: 'vol' },
  { symbol: 'R_25', name: 'Volatility 25', group: 'vol' },
  { symbol: 'R_50', name: 'Volatility 50', group: 'vol' },
  { symbol: 'R_75', name: 'Volatility 75', group: 'vol' },
  { symbol: 'R_100', name: 'Volatility 100', group: 'vol' },
  { symbol: 'JD10', name: 'Jump 10', group: 'jump' },
  { symbol: 'JD25', name: 'Jump 25', group: 'jump' },
  { symbol: 'JD50', name: 'Jump 50', group: 'jump' },
  { symbol: 'JD75', name: 'Jump 75', group: 'jump' },
  { symbol: 'JD100', name: 'Jump 100', group: 'jump' },
  { symbol: 'RDBEAR', name: 'Bear Market', group: 'bear' },
  { symbol: 'RDBULL', name: 'Bull Market', group: 'bull' },
  { symbol: 'stpRNG', name: 'Step Index', group: 'step' },
  { symbol: 'RBRK100', name: 'Range Break 100', group: 'range' },
  { symbol: 'RBRK200', name: 'Range Break 200', group: 'range' },
];

const SCANNER_MARKETS = [
  { symbol: 'R_10', name: 'Vol 10' }, { symbol: 'R_25', name: 'Vol 25' },
  { symbol: 'R_50', name: 'Vol 50' }, { symbol: 'R_75', name: 'Vol 75' },
  { symbol: 'R_100', name: 'Vol 100' }, { symbol: '1HZ10V', name: 'V10 1s' },
  { symbol: '1HZ25V', name: 'V25 1s' }, { symbol: '1HZ50V', name: 'V50 1s' },
  { symbol: '1HZ75V', name: 'V75 1s' }, { symbol: '1HZ100V', name: 'V100 1s' },
  { symbol: 'JD10', name: 'Jump 10' }, { symbol: 'JD25', name: 'Jump 25' },
  { symbol: 'RDBEAR', name: 'Bear' }, { symbol: 'RDBULL', name: 'Bull' },
];

const GROUPS = [
  { value: 'all', label: 'All' }, { value: 'vol1s', label: 'Vol 1s' },
  { value: 'vol', label: 'Vol' }, { value: 'jump', label: 'Jump' },
  { value: 'bear', label: 'Bear' }, { value: 'bull', label: 'Bull' },
  { value: 'step', label: 'Step' }, { value: 'range', label: 'Range' },
];

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '12h', '1d'];
const TF_TICKS: Record<string, number> = {
  '1m': 1000, '3m': 2000, '5m': 3000, '15m': 4000, '30m': 4500,
  '1h': 5000, '4h': 5000, '12h': 5000, '1d': 5000,
};

const CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise' }, { value: 'PUT', label: 'Fall' },
  { value: 'DIGITMATCH', label: 'Digits Match' }, { value: 'DIGITDIFF', label: 'Digits Differs' },
  { value: 'DIGITEVEN', label: 'Digits Even' }, { value: 'DIGITODD', label: 'Digits Odd' },
  { value: 'DIGITOVER', label: 'Digits Over' }, { value: 'DIGITUNDER', label: 'Digits Under' },
];

const CONTRACT_TYPES_SIMPLE = ['DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'] as const;
const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

interface Candle { open: number; high: number; low: number; close: number; time: number; }
interface TradeRecord { id: string; time: number; type: string; stake: number; profit: number; status: 'won' | 'lost' | 'open'; symbol: string; }
interface LogEntry { id: number; time: string; market: 'M1' | 'M2' | 'VH'; symbol: string; contract: string; stake: number; martingaleStep: number; exitDigit: string; result: 'Win' | 'Loss' | 'Pending' | 'V-Win' | 'V-Loss'; pnl: number; balance: number; switchInfo: string; }

function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const seconds: Record<string, number> = { '1m': 60, '3m': 180, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '4h': 14400, '12h': 43200, '1d': 86400 };
  const interval = seconds[tf] || 60;
  const candles: Candle[] = [];
  let current: Candle | null = null;
  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const t = times[i] || Date.now() / 1000 + i;
    const bucket = Math.floor(t / interval) * interval;
    if (!current || current.time !== bucket) {
      if (current) candles.push(current);
      current = { open: p, high: p, low: p, close: p, time: bucket };
    } else {
      current.high = Math.max(current.high, p);
      current.low = Math.min(current.low, p);
      current.close = p;
    }
  }
  if (current) candles.push(current);
  return candles;
}

function calcEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1] || 0;
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calcSR(prices: number[]) {
  if (prices.length < 10) return { support: 0, resistance: 0 };
  const sorted = [...prices].sort((a, b) => a - b);
  const p5 = Math.floor(sorted.length * 0.05);
  const p95 = Math.floor(sorted.length * 0.95);
  return { support: sorted[p5], resistance: sorted[Math.min(p95, sorted.length - 1)] };
}

function calcMACDFull(prices: number[]) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.8;
  return { macd, signal, histogram: macd - signal };
}

class CircularTickBuffer {
  private buffer: { digit: number; ts: number }[];
  private head = 0; private count = 0;
  constructor(private capacity = 1000) { this.buffer = new Array(capacity); }
  push(digit: number) { this.buffer[this.head] = { digit, ts: performance.now() }; this.head = (this.head + 1) % this.capacity; if (this.count < this.capacity) this.count++; }
  last(n: number): number[] { const result: number[] = []; const start = (this.head - Math.min(n, this.count) + this.capacity) % this.capacity; for (let i = 0; i < Math.min(n, this.count); i++) result.push(this.buffer[(start + i) % this.capacity].digit); return result; }
  get size() { return this.count; }
}

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => { const unsub = derivApi.onMessage((data: any) => { if (data.tick && data.tick.symbol === symbol) { unsub(); resolve({ quote: data.tick.quote }); } }); });
}

function simulateVirtualContract(contractType: string, barrier: string, symbol: string): Promise<{ won: boolean; digit: number }> {
  return new Promise((resolve) => { const unsub = derivApi.onMessage((data: any) => { if (data.tick && data.tick.symbol === symbol) { unsub(); const digit = getLastDigit(data.tick.quote); const b = parseInt(barrier) || 0; let won = false; switch (contractType) { case 'DIGITEVEN': won = digit % 2 === 0; break; case 'DIGITODD': won = digit % 2 !== 0; break; case 'DIGITMATCH': won = digit === b; break; case 'DIGITDIFF': won = digit !== b; break; case 'DIGITOVER': won = digit > b; break; case 'DIGITUNDER': won = digit < b; break; } resolve({ won, digit }); } }); });
}

export default function UnifiedTrading() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();

  // Chart visibility
  const [chartVisible, setChartVisible] = useState(true);

  // Chart State
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);

  // Manual Trade State
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeStake, setTradeStake] = useState('1.00');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [isTrading, setIsTrading] = useState(false);

  // Pro Scanner Bot State
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Contract, setM1Contract] = useState('DIGITEVEN');
  const [m1Barrier, setM1Barrier] = useState('5');
  const [m1Symbol, setM1Symbol] = useState('R_100');
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Contract, setM2Contract] = useState('DIGITODD');
  const [m2Barrier, setM2Barrier] = useState('5');
  const [m2Symbol, setM2Symbol] = useState('R_50');
  const [m1HookEnabled, setM1HookEnabled] = useState(false);
  const [m1VirtualLossCount, setM1VirtualLossCount] = useState('3');
  const [m1RealCount, setM1RealCount] = useState('2');
  const [m2HookEnabled, setM2HookEnabled] = useState(false);
  const [m2VirtualLossCount, setM2VirtualLossCount] = useState('3');
  const [m2RealCount, setM2RealCount] = useState('2');
  const [vhFakeWins, setVhFakeWins] = useState(0);
  const [vhFakeLosses, setVhFakeLosses] = useState(0);
  const [vhConsecLosses, setVhConsecLosses] = useState(0);
  const [vhStatus, setVhStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'failed'>('idle');
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(false);
  const [m1StrategyMode, setM1StrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [m2StrategyMode, setM2StrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [m1Pattern, setM1Pattern] = useState('');
  const [m1DigitCondition, setM1DigitCondition] = useState('==');
  const [m1DigitCompare, setM1DigitCompare] = useState('5');
  const [m1DigitWindow, setM1DigitWindow] = useState('3');
  const [m2Pattern, setM2Pattern] = useState('');
  const [m2DigitCondition, setM2DigitCondition] = useState('==');
  const [m2DigitCompare, setM2DigitCompare] = useState('5');
  const [m2DigitWindow, setM2DigitWindow] = useState('3');
  const [scannerActive, setScannerActive] = useState(false);
  const [turboMode, setTurboMode] = useState(false);
  const [botName, setBotName] = useState('');
  const [turboLatency, setTurboLatency] = useState(0);
  const [ticksCaptured, setTicksCaptured] = useState(0);
  const [ticksMissed, setTicksMissed] = useState(0);
  const turboBuffersRef = useRef<Map<string, CircularTickBuffer>>(new Map());
  const lastTickTsRef = useRef(0);
  type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched' | 'virtual_hook';
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [currentMarket, setCurrentMarket] = useState<1 | 2>(1);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});

  // Simple Bot State
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [botRunning, setBotRunning] = useState(false);
  const [botPaused, setBotPaused] = useState(false);
  const botRunningRef = useRef(false);
  const botPausedRef = useRef(false);
  const [botConfig, setBotConfig] = useState({
    stake: '1.00', contractType: 'CALL', prediction: '5', duration: '1', durationUnit: 't',
    martingale: false, multiplier: '2.0', stopLoss: '10', takeProfit: '20', maxTrades: '50',
  });
  const [botStats, setBotStats] = useState({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 });

  // Chart Data Loading
  useEffect(() => {
    let active = true;
    subscribedRef.current = false;
    const load = async () => {
      if (!derivApi.isConnected) { setIsLoading(false); return; }
      setIsLoading(true);
      try {
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, 5000);
        if (!active) return;
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setScrollOffset(0);
        setIsLoading(false);
        if (!subscribedRef.current) {
          subscribedRef.current = true;
          await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            setPrices(prev => [...prev, data.tick.quote].slice(-5000));
            setTimes(prev => [...prev, data.tick.epoch].slice(-5000));
          });
        }
      } catch (err) { console.error(err); setIsLoading(false); }
    };
    load();
    return () => { active = false; derivApi.unsubscribeTicks(symbol as MarketSymbol).catch(() => { }); };
  }, [symbol]);

  // Scanner Tick Subscription
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const digit = getLastDigit(data.tick.quote);
      const now = performance.now();
      const map = tickMapRef.current;
      const arr = map.get(sym) || [];
      arr.push(digit);
      if (arr.length > 200) arr.shift();
      map.set(sym, arr);
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));
      if (!turboBuffersRef.current.has(sym)) turboBuffersRef.current.set(sym, new CircularTickBuffer(1000));
      const buf = turboBuffersRef.current.get(sym)!;
      buf.push(digit);
      if (lastTickTsRef.current > 0) { const lat = now - lastTickTsRef.current; setTurboLatency(Math.round(lat)); if (lat > 50) setTicksMissed(prev => prev + 1); }
      lastTickTsRef.current = now;
      setTicksCaptured(prev => prev + 1);
    };
    const unsub = derivApi.onMessage(handler);
    SCANNER_MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol as MarketSymbol, () => { }).catch(() => { }); });
    return () => { active = false; unsub(); };
  }, []);

  // Chart Derived Data
  const tfTicks = TF_TICKS[timeframe] || 60;
  const tfPrices = useMemo(() => prices.slice(-tfTicks), [prices, tfTicks]);
  const tfTimes = useMemo(() => times.slice(-tfTicks), [times, tfTicks]);
  const candles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last26 = useMemo(() => digits.slice(-26), [digits]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);
  const bb = useMemo(() => calculateBollingerBands(tfPrices, 20), [tfPrices]);
  const ema50 = useMemo(() => calcEMA(tfPrices, 50), [tfPrices]);
  const { support, resistance } = useMemo(() => calcSR(tfPrices), [tfPrices]);
  const rsi = useMemo(() => calculateRSI(tfPrices, 14), [tfPrices]);
  const macd = useMemo(() => calcMACDFull(tfPrices), [tfPrices]);
  const evenCount = useMemo(() => digits.filter(d => d % 2 === 0).length, [digits]);
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = useMemo(() => digits.filter(d => d > 4).length, [digits]);
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;
  const underPct = 100 - overPct;
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = ((currentPrice - bb.lower) / bbRange * 100);
  const riseSignal = useMemo(() => { const conf = rsi < 30 ? 85 : rsi > 70 ? 25 : 50 + (50 - rsi); return { direction: rsi < 45 ? 'Rise' : 'Fall', confidence: Math.min(95, Math.max(10, Math.round(conf))) }; }, [rsi]);
  const eoSignal = useMemo(() => { const conf = Math.abs(evenPct - 50) * 2 + 50; return { direction: evenPct > 50 ? 'Even' : 'Odd', confidence: Math.min(90, Math.round(conf)) }; }, [evenPct]);
  const ouSignal = useMemo(() => { const conf = Math.abs(overPct - 50) * 2 + 50; return { direction: overPct > 50 ? 'Over' : 'Under', confidence: Math.min(90, Math.round(conf)) }; }, [overPct]);
  const matchSignal = useMemo(() => { const bestPct = Math.max(...percentages); return { digit: mostCommon, confidence: Math.min(90, Math.round(bestPct * 3)) }; }, [percentages, mostCommon]);

  // Canvas Drawing
  useEffect(() => {
    if (!chartVisible) return;
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const W = rect.width;
    const totalH = rect.height;
    const rsiH = 80;
    const H = totalH - rsiH - 8;
    const priceAxisW = 70;
    const chartW = W - priceAxisW;

    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, totalH);

    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    const endIdx = candles.length - scrollOffset;
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);

    if (visibleCandles.length < 1) return;

    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const priceRange = rawMax - rawMin;
    const padding = priceRange * 0.12 || 0.001;
    const minP = rawMin - padding;
    const maxP = rawMax + padding;
    const range = maxP - minP || 1;
    const chartPadTop = 20;
    const drawH = H - chartPadTop - 20;
    const toY = (p: number) => chartPadTop + ((maxP - p) / range) * drawH;

    ctx.strokeStyle = '#21262D';
    ctx.lineWidth = 0.5;
    const gridSteps = 8;
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#484F58';
    for (let i = 0; i <= gridSteps; i++) {
      const y = chartPadTop + (i / gridSteps) * drawH;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      const pLabel = maxP - (i / gridSteps) * range;
      ctx.fillText(pLabel.toFixed(4), chartW + 4, y + 3);
    }

    const offsetX = 5;
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      const isGreen = c.close >= c.open;
      const color = isGreen ? '#3FB950' : '#F85149';

      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, toY(c.high));
      ctx.lineTo(x + candleWidth / 2, toY(c.low));
      ctx.stroke();

      const bodyTop = toY(Math.max(c.open, c.close));
      const bodyBot = toY(Math.min(c.open, c.close));
      const bodyH = Math.max(1, bodyBot - bodyTop);
      ctx.fillStyle = color;
      ctx.fillRect(x, bodyTop, candleWidth, bodyH);
    }

    const curY = toY(currentPrice);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#E6EDF3';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, curY); ctx.lineTo(chartW, curY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#58A6FF';
    ctx.fillRect(chartW, curY - 8, priceAxisW, 16);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillText(currentPrice.toFixed(4), chartW + 2, curY + 4);

    // Support/Resistance lines
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#3FB950';
    ctx.lineWidth = 1.5;
    const supY = toY(support);
    ctx.beginPath(); ctx.moveTo(0, supY); ctx.lineTo(chartW, supY); ctx.stroke();

    ctx.strokeStyle = '#F85149';
    const resY = toY(resistance);
    ctx.beginPath(); ctx.moveTo(0, resY); ctx.lineTo(chartW, resY); ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillStyle = '#3FB950';
    ctx.fillRect(chartW, supY - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.fillText(`S ${support.toFixed(4)}`, chartW + 2, supY + 3);
    ctx.fillStyle = '#F85149';
    ctx.fillRect(chartW, resY - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.fillText(`R ${resistance.toFixed(4)}`, chartW + 2, resY + 3);

    // RSI subplot
    const rsiTop = H + 8;
    ctx.fillStyle = '#161B22';
    ctx.fillRect(0, rsiTop, W, rsiH);
    ctx.strokeStyle = '#21262D';
    ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, rsiTop); ctx.lineTo(W, rsiTop); ctx.stroke();

    const rsiToY = (v: number) => rsiTop + 4 + ((100 - v) / 100) * (rsiH - 8);
    ctx.font = '8px JetBrains Mono, monospace';
    [30, 50, 70].forEach(level => {
      const y = rsiToY(level);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = level === 50 ? '#484F58' : (level === 70 ? '#F8514950' : '#3FB95050');
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(chartW, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#484F58';
      ctx.fillText(String(level), chartW + 4, y + 3);
    });

    ctx.fillStyle = '#8B949E';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText('RSI(14)', 4, rsiTop + 12);

    // RSI value
    const lastRsi = rsi;
    const rsiColor = lastRsi > 70 ? '#F85149' : lastRsi < 30 ? '#3FB950' : '#D29922';
    ctx.fillStyle = rsiColor;
    ctx.fillRect(chartW, rsiToY(lastRsi) - 7, priceAxisW, 14);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 9px JetBrains Mono, monospace';
    ctx.fillText(lastRsi.toFixed(1), chartW + 2, rsiToY(lastRsi) + 3);
  }, [candles, support, resistance, currentPrice, rsi, candleWidth, scrollOffset, chartVisible]);

  // Canvas mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chartVisible) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleWidth(prev => Math.max(2, Math.min(20, prev - Math.sign(e.deltaY))));
      } else {
        const delta = Math.sign(e.deltaY) * Math.max(3, Math.floor(candles.length * 0.03));
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 10, prev + delta)));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      const pAxisX = canvasRect.width - 70;
      const localX = e.clientX - canvasRect.left;
      if (localX >= pAxisX) {
        isPriceAxisDragging.current = true;
        priceAxisStartY.current = e.clientY;
        priceAxisStartWidth.current = candleWidth;
        canvas.style.cursor = 'ns-resize';
      } else {
        isDragging.current = true;
        dragStartX.current = e.clientX;
        dragStartOffset.current = scrollOffset;
        canvas.style.cursor = 'grabbing';
      }
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isPriceAxisDragging.current) {
        const dy = priceAxisStartY.current - e.clientY;
        const newWidth = Math.max(2, Math.min(24, priceAxisStartWidth.current + Math.round(dy / 8)));
        setCandleWidth(newWidth);
        return;
      }
      if (!isDragging.current) return;
      const dx = dragStartX.current - e.clientX;
      const candlesPerPx = 1 / (candleWidth + 1);
      const delta = Math.round(dx * candlesPerPx);
      setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
    };

    const onMouseUp = () => {
      isDragging.current = false;
      isPriceAxisDragging.current = false;
      canvas.style.cursor = 'crosshair';
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [candles.length, scrollOffset, candleWidth, chartVisible]);

  // Pattern/Digit Helpers
  const cleanM1Pattern = m1Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m1PatternValid = cleanM1Pattern.length >= 2;
  const cleanM2Pattern = m2Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m2PatternValid = cleanM2Pattern.length >= 2;

  const checkPatternMatchWith = useCallback((symbol: string, cleanPat: string): boolean => {
    const digits = tickMapRef.current.get(symbol) || [];
    if (digits.length < cleanPat.length) return false;
    const recent = digits.slice(-cleanPat.length);
    for (let i = 0; i < cleanPat.length; i++) {
      const expected = cleanPat[i];
      const actual = recent[i] % 2 === 0 ? 'E' : 'O';
      if (expected !== actual) return false;
    }
    return true;
  }, []);

  const checkDigitConditionWith = useCallback((symbol: string, condition: string, compare: string, window: string): boolean => {
    const digits = tickMapRef.current.get(symbol) || [];
    const win = parseInt(window) || 3;
    const comp = parseInt(compare);
    if (digits.length < win) return false;
    const recent = digits.slice(-win);
    return recent.every(d => {
      switch (condition) {
        case '>': return d > comp;
        case '<': return d < comp;
        case '>=': return d >= comp;
        case '<=': return d <= comp;
        case '==': return d === comp;
        default: return false;
      }
    });
  }, []);

  const checkStrategyForMarket = useCallback((symbol: string, market: 1 | 2): boolean => {
    const mode = market === 1 ? m1StrategyMode : m2StrategyMode;
    if (mode === 'pattern') {
      const pat = market === 1 ? cleanM1Pattern : cleanM2Pattern;
      return checkPatternMatchWith(symbol, pat);
    }
    const cond = market === 1 ? m1DigitCondition : m2DigitCondition;
    const comp = market === 1 ? m1DigitCompare : m2DigitCompare;
    const win = market === 1 ? m1DigitWindow : m2DigitWindow;
    return checkDigitConditionWith(symbol, cond, comp, win);
  }, [m1StrategyMode, m2StrategyMode, cleanM1Pattern, cleanM2Pattern, checkPatternMatchWith, checkDigitConditionWith, m1DigitCondition, m1DigitCompare, m1DigitWindow, m2DigitCondition, m2DigitCompare, m2DigitWindow]);

  const findScannerMatchForMarket = useCallback((market: 1 | 2): string | null => {
    for (const m of SCANNER_MARKETS) if (checkStrategyForMarket(m.symbol, market)) return m.symbol;
    return null;
  }, [checkStrategyForMarket]);

  // Logging
  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => { setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100)); }, []);
  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => { setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e)); }, []);
  const clearLog = useCallback(() => { setLogEntries([]); setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0); setMartingaleStepState(0); setVhFakeWins(0); setVhFakeLosses(0); setVhConsecLosses(0); setVhStatus('idle'); setTicksCaptured(0); setTicksMissed(0); }, []);

  // Real Trade Execution
  const executeRealTrade = useCallback(async (cfg: { contract: string; barrier: string; symbol: string }, tradeSymbol: string, cStake: number, mStep: number, mkt: 1 | 2, localBalance: number, localPnl: number, baseStake: number) => {
    const logId = ++logIdRef.current;
    const now = new Date().toLocaleTimeString();
    setTotalStaked(prev => prev + cStake);
    setCurrentStakeState(cStake);
    addLog(logId, { time: now, market: mkt === 1 ? 'M1' : 'M2', symbol: tradeSymbol, contract: cfg.contract, stake: cStake, martingaleStep: mStep, exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance, switchInfo: '' });
    let inRecovery = mkt === 2;
    try {
      if (!turboMode) await waitForNextTick(tradeSymbol as MarketSymbol);
      const buyParams: any = { contract_type: cfg.contract, symbol: tradeSymbol, duration: 1, duration_unit: 't', basis: 'stake', amount: cStake };
      if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;
      const { contractId } = await derivApi.buyContract(buyParams);
      if (copyTradingService.enabled) copyTradingService.copyTrade({ ...buyParams, masterTradeId: contractId }).catch(err => console.error('Copy trading error:', err));
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      localPnl += pnl;
      localBalance += pnl;
      const exitDigit = String(getLastDigit(result.sellPrice || 0));
      let switchInfo = '';
      if (won) {
        setWins(prev => prev + 1);
        if (inRecovery) { switchInfo = '✓ Recovery WIN → Back to M1'; inRecovery = false; } else { switchInfo = '→ Continue M1'; }
        mStep = 0;
        cStake = baseStake;
      } else {
        setLosses(prev => prev + 1);
        if (activeAccount?.is_virtual) recordLoss(cStake, tradeSymbol, 6000);
        if (!inRecovery && m2Enabled) { inRecovery = true; switchInfo = '✗ Loss → Switch to M2'; } else { switchInfo = inRecovery ? '→ Stay M2' : '→ Continue M1'; }
        if (martingaleOn) {
          const maxS = parseInt(martingaleMaxSteps) || 5;
          if (mStep < maxS) { cStake = parseFloat((cStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2)); mStep++; } else { mStep = 0; cStake = baseStake; }
        }
      }
      setNetProfit(prev => prev + pnl);
      setMartingaleStepState(mStep);
      setCurrentStakeState(cStake);
      updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: localBalance, switchInfo });
      let shouldBreak = false;
      if (localPnl >= parseFloat(takeProfit)) { toast.success(`🎯 Take Profit! +$${localPnl.toFixed(2)}`); shouldBreak = true; }
      if (localPnl <= -parseFloat(stopLoss)) { toast.error(`🛑 Stop Loss! $${localPnl.toFixed(2)}`); shouldBreak = true; }
      if (localBalance < cStake) { toast.error('Insufficient balance'); shouldBreak = true; }
      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak };
    } catch (err: any) {
      updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
      if (!turboMode) await new Promise(r => setTimeout(r, 2000));
      return { localPnl, localBalance, cStake, mStep, inRecovery, shouldBreak: false };
    }
  }, [addLog, updateLog, m2Enabled, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, turboMode, activeAccount, recordLoss]);

  // Pro Scanner Bot Main Loop
  const startProBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }
    if (strategyM1Enabled && m1StrategyMode === 'pattern' && !m1PatternValid) { toast.error('Invalid M1 pattern (min 2 E/O)'); return; }
    if (strategyEnabled && m2StrategyMode === 'pattern' && !m2PatternValid) { toast.error('Invalid M2 pattern (min 2 E/O)'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    setVhFakeWins(0);
    setVhFakeLosses(0);
    setVhConsecLosses(0);
    setVhStatus('idle');

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;
    const getConfig = (market: 1 | 2) => ({ contract: market === 1 ? m1Contract : m2Contract, barrier: market === 1 ? m1Barrier : m2Barrier, symbol: market === 1 ? m1Symbol : m2Symbol });

    while (runningRef.current) {
      const mkt: 1 | 2 = inRecovery ? 2 : 1;
      setCurrentMarket(mkt);
      if (mkt === 1 && !m1Enabled) { if (m2Enabled) { inRecovery = true; continue; } else break; }
      if (mkt === 2 && !m2Enabled) { inRecovery = false; continue; }

      let tradeSymbol: string;
      const cfg = getConfig(mkt);
      const hookEnabled = mkt === 1 ? m1HookEnabled : m2HookEnabled;
      const requiredLosses = parseInt(mkt === 1 ? m1VirtualLossCount : m2VirtualLossCount) || 3;
      const realCount = parseInt(mkt === 1 ? m1RealCount : m2RealCount) || 2;

      if (inRecovery && strategyEnabled) {
        setBotStatus('waiting_pattern');
        let matched = false;
        let matchedSymbol = '';
        while (runningRef.current && !matched) {
          if (scannerActive) { const found = findScannerMatchForMarket(2); if (found) { matched = true; matchedSymbol = found; } } else { if (checkStrategyForMarket(cfg.symbol, 2)) { matched = true; matchedSymbol = cfg.symbol; } }
          if (!matched) { await new Promise<void>(r => { if (turboMode) requestAnimationFrame(() => r()); else setTimeout(r, 500); }); }
        }
        if (!runningRef.current) break;
        setBotStatus('pattern_matched');
        tradeSymbol = matchedSymbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else if (!inRecovery && strategyM1Enabled) {
        setBotStatus('waiting_pattern');
        let matched = false;
        while (runningRef.current && !matched) {
          if (checkStrategyForMarket(cfg.symbol, 1)) { matched = true; }
          if (!matched) { await new Promise<void>(r => { if (turboMode) requestAnimationFrame(() => r()); else setTimeout(r, 500); }); }
        }
        if (!runningRef.current) break;
        setBotStatus('pattern_matched');
        tradeSymbol = cfg.symbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = cfg.symbol;
      }

      if (hookEnabled) {
        setBotStatus('virtual_hook');
        setVhStatus('waiting');
        setVhFakeWins(0);
        setVhFakeLosses(0);
        setVhConsecLosses(0);
        let consecLosses = 0;
        let virtualTradeNum = 0;
        while (consecLosses < requiredLosses && runningRef.current) {
          virtualTradeNum++;
          const vLogId = ++logIdRef.current;
          const vNow = new Date().toLocaleTimeString();
          addLog(vLogId, { time: vNow, market: 'VH', symbol: tradeSymbol, contract: cfg.contract, stake: 0, martingaleStep: 0, exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance, switchInfo: `Virtual #${virtualTradeNum} (losses: ${consecLosses}/${requiredLosses})` });
          const vResult = await simulateVirtualContract(cfg.contract, cfg.barrier, tradeSymbol);
          if (!runningRef.current) break;
          if (vResult.won) { consecLosses = 0; setVhConsecLosses(0); setVhFakeWins(prev => prev + 1); updateLog(vLogId, { exitDigit: String(vResult.digit), result: 'V-Win', switchInfo: `Virtual WIN → Losses reset (0/${requiredLosses})` }); }
          else { consecLosses++; setVhConsecLosses(consecLosses); setVhFakeLosses(prev => prev + 1); updateLog(vLogId, { exitDigit: String(vResult.digit), result: 'V-Loss', switchInfo: `Virtual LOSS (${consecLosses}/${requiredLosses})` }); }
        }
        if (!runningRef.current) break;
        setVhStatus('confirmed');
        toast.success(`🎣 Hook confirmed! ${requiredLosses} consecutive losses detected → Executing ${realCount} real trade(s)`);
        for (let ri = 0; ri < realCount && runningRef.current; ri++) {
          const result = await executeRealTrade(cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake);
          if (!result || !runningRef.current) break;
          localPnl = result.localPnl;
          localBalance = result.localBalance;
          cStake = result.cStake;
          mStep = result.mStep;
          inRecovery = result.inRecovery;
          if (result.shouldBreak) { runningRef.current = false; break; }
        }
        setVhStatus('idle');
        setVhConsecLosses(0);
        if (!runningRef.current) break;
        continue;
      }

      const result = await executeRealTrade(cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake);
      if (!result || !runningRef.current) break;
      localPnl = result.localPnl;
      localBalance = result.localBalance;
      cStake = result.cStake;
      mStep = result.mStep;
      inRecovery = result.inRecovery;
      if (result.shouldBreak) break;
      if (!turboMode) await new Promise(r => setTimeout(r, 400));
    }
    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Contract, m2Contract, m1Barrier, m2Barrier, m1Symbol, m2Symbol, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, strategyEnabled, strategyM1Enabled, m1StrategyMode, m2StrategyMode, m1PatternValid, m2PatternValid, scannerActive, findScannerMatchForMarket, checkStrategyForMarket, addLog, updateLog, turboMode, m1HookEnabled, m2HookEnabled, m1VirtualLossCount, m2VirtualLossCount, m1RealCount, m2RealCount, executeRealTrade]);

  const stopProBot = useCallback(() => { runningRef.current = false; setIsRunning(false); setBotStatus('idle'); }, []);

  // Simple Bot Functions
  const startSimpleBot = useCallback(async () => {
    if (!isAuthorized) { toast.error('Login to Deriv first'); return; }
    setBotRunning(true); setBotPaused(false); botRunningRef.current = true; botPausedRef.current = false;
    const baseStake = parseFloat(botConfig.stake) || 1; const sl = parseFloat(botConfig.stopLoss) || 10; const tp = parseFloat(botConfig.takeProfit) || 20;
    const maxT = parseInt(botConfig.maxTrades) || 50; const mart = botConfig.martingale; const mult = parseFloat(botConfig.multiplier) || 2;
    let stake = baseStake; let pnl = 0; let trades = 0; let wins = 0; let losses = 0; let consLosses = 0;
    while (botRunningRef.current) {
      if (botPausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }
      if (trades >= maxT || pnl <= -sl || pnl >= tp) { const reason = trades >= maxT ? 'Max trades reached' : pnl <= -sl ? 'Stop loss hit' : 'Take profit reached'; toast.info(`🤖 Bot stopped: ${reason}`); break; }
      const ct = botConfig.contractType; const params: any = { contract_type: ct, symbol, duration: parseInt(botConfig.duration), duration_unit: botConfig.durationUnit, basis: 'stake', amount: stake };
      if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = botConfig.prediction;
      try {
        const { contractId } = await derivApi.buyContract(params); const tr: TradeRecord = { id: contractId, time: Date.now(), type: ct, stake, profit: 0, status: 'open', symbol };
        setTradeHistory(prev => [tr, ...prev].slice(0, 100)); const result = await derivApi.waitForContractResult(contractId);
        trades++; pnl += result.profit; setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status } : t));
        if (result.status === 'won') { wins++; consLosses = 0; stake = baseStake; } else { losses++; consLosses++; stake = mart ? Math.round(stake * mult * 100) / 100 : baseStake; }
        setBotStats({ trades, wins, losses, pnl, currentStake: stake, consecutiveLosses: consLosses });
      } catch (err: any) { toast.error(`Bot trade error: ${err.message}`); await new Promise(r => setTimeout(r, 2000)); }
    }
    setBotRunning(false); botRunningRef.current = false; setBotStats(prev => ({ ...prev, trades, wins, losses, pnl }));
  }, [isAuthorized, botConfig, symbol]);

  const stopSimpleBot = useCallback(() => { botRunningRef.current = false; setBotRunning(false); toast.info('🛑 Bot stopped'); }, []);
  const togglePauseSimpleBot = useCallback(() => { botPausedRef.current = !botPausedRef.current; setBotPaused(botPausedRef.current); }, []);

  // UI Helpers
  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;
  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const simpleWins = tradeHistory.filter(t => t.status === 'won').length;
  const simpleLosses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (simpleWins / totalTrades * 100) : 0;
  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = { idle: { icon: '⚪', label: 'IDLE', color: 'text-muted-foreground' }, trading_m1: { icon: '🟢', label: 'TRADING M1', color: 'text-profit' }, recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-purple-400' }, waiting_pattern: { icon: '🟡', label: 'WAITING PATTERN', color: 'text-warning' }, pattern_matched: { icon: '✅', label: 'PATTERN MATCHED', color: 'text-profit' }, virtual_hook: { icon: '🎣', label: 'VIRTUAL HOOK', color: 'text-primary' } };
  const proStatus = statusConfig[botStatus];
  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  const activeDigits = (tickMapRef.current.get(activeSymbol) || []).slice(-8);

  const handleBuy = async (side: 'buy' | 'sell') => {
    if (!isAuthorized) { toast.error('Please login to your Deriv account first'); return; }
    if (isTrading) return; setIsTrading(true);
    const ct = side === 'buy' ? contractType : (contractType === 'CALL' ? 'PUT' : contractType === 'PUT' ? 'CALL' : contractType);
    const params: any = { contract_type: ct, symbol, duration: parseInt(duration), duration_unit: durationUnit, basis: 'stake', amount: parseFloat(tradeStake) };
    if (['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct)) params.barrier = prediction;
    try {
      toast.info(`⏳ Placing ${ct} trade... $${tradeStake}`);
      const { contractId } = await derivApi.buyContract(params);
      const newTrade: TradeRecord = { id: contractId, time: Date.now(), type: ct, stake: parseFloat(tradeStake), profit: 0, status: 'open', symbol };
      setTradeHistory(prev => [newTrade, ...prev].slice(0, 50));
      const result = await derivApi.waitForContractResult(contractId);
      setTradeHistory(prev => prev.map(t => t.id === contractId ? { ...t, profit: result.profit, status: result.status } : t));
      if (result.status === 'won') { toast.success(`✅ WON +$${result.profit.toFixed(2)}`); } else { toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)}`); }
    } catch (err: any) { toast.error(`Trade failed: ${err.message}`); } finally { setIsTrading(false); }
  };

  return (
    <div className="space-y-4 max-w-[1920px] mx-auto p-4">
      {/* Chart Toggle Button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setChartVisible(!chartVisible)}
          className="flex items-center gap-2"
        >
          {chartVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          {chartVisible ? 'Hide Chart' : 'Show Chart'}
          {chartVisible ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </Button>
      </div>

      {/* Collapsible Chart Section */}
      {chartVisible && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div><h1 className="text-xl font-bold text-foreground flex items-center gap-2"><BarChart3 className="w-5 h-5 text-primary" /> Trading Chart</h1><p className="text-xs text-muted-foreground">{marketName} • {timeframe} • {tfPrices.length} ticks</p></div>
            <Badge className="font-mono text-sm" variant="outline">{currentPrice.toFixed(4)}</Badge>
          </div>
          <div className="bg-card border border-border rounded-xl p-3"><div className="flex flex-wrap gap-1 mb-2">{GROUPS.map(g => (<Button key={g.value} size="sm" variant={groupFilter === g.value ? 'default' : 'outline'} className="h-6 text-[10px] px-2" onClick={() => setGroupFilter(g.value)}>{g.label}</Button>))}</div><div className="flex flex-wrap gap-1 max-h-20 overflow-auto">{filteredMarkets.map(m => (<Button key={m.symbol} size="sm" variant={symbol === m.symbol ? 'default' : 'ghost'} className={`h-6 text-[9px] px-2 ${symbol === m.symbol ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} onClick={() => setSymbol(m.symbol)}>{m.name}</Button>))}</div></div>
          <div className="flex flex-wrap gap-1">{TIMEFRAMES.map(tf => (<Button key={tf} size="sm" variant={timeframe === tf ? 'default' : 'outline'} className={`h-7 text-xs px-3 ${timeframe === tf ? 'bg-primary text-primary-foreground' : ''}`} onClick={() => setTimeframe(tf)}>{tf}</Button>))}</div>
          <div className="bg-[#0D1117] border border-[#30363D] rounded-xl overflow-hidden">
            <canvas ref={canvasRef} className="w-full" style={{ height: 520, cursor: 'crosshair' }} />
          </div>
          <div className="grid grid-cols-3 md:grid-cols-7 gap-2">{[{ label: 'Price', value: currentPrice.toFixed(4), color: 'text-foreground' }, { label: 'Last Digit', value: String(lastDigit), color: 'text-primary' }, { label: 'Support', value: support.toFixed(2), color: 'text-[#3FB950]' }, { label: 'Resistance', value: resistance.toFixed(2), color: 'text-[#F85149]' }, { label: 'BB Upper', value: bb.upper.toFixed(2), color: 'text-[#BC8CFF]' }, { label: 'BB Middle', value: bb.middle.toFixed(2), color: 'text-[#BC8CFF]' }, { label: 'BB Lower', value: bb.lower.toFixed(2), color: 'text-[#BC8CFF]' }].map(item => (<div key={item.label} className="bg-card border border-border rounded-lg p-2 text-center"><div className="text-[9px] text-muted-foreground">{item.label}</div><div className={`font-mono text-xs font-bold ${item.color}`}>{item.value}</div></div>))}</div>
          <div className="bg-card border border-border rounded-xl p-3 space-y-3"><h3 className="text-xs font-semibold text-foreground">Digit Analysis</h3><div className="grid grid-cols-2 md:grid-cols-4 gap-2"><div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2"><div className="text-[9px] text-[#D29922]">Odd</div><div className="font-mono text-sm font-bold text-[#D29922]">{oddPct.toFixed(1)}%</div><div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#D29922] rounded-full" style={{ width: `${oddPct}%` }} /></div></div><div className="bg-[#3FB950]/10 border border-[#3FB950]/30 rounded-lg p-2"><div className="text-[9px] text-[#3FB950]">Even</div><div className="font-mono text-sm font-bold text-[#3FB950]">{evenPct.toFixed(1)}%</div><div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#3FB950] rounded-full" style={{ width: `${evenPct}%` }} /></div></div><div className="bg-primary/10 border border-primary/30 rounded-lg p-2"><div className="text-[9px] text-primary">Over 4 (5-9)</div><div className="font-mono text-sm font-bold text-primary">{overPct.toFixed(1)}%</div><div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-primary rounded-full" style={{ width: `${overPct}%` }} /></div></div><div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded-lg p-2"><div className="text-[9px] text-[#D29922]">Under 5 (0-4)</div><div className="font-mono text-sm font-bold text-[#D29922]">{underPct.toFixed(1)}%</div><div className="h-1.5 bg-muted rounded-full mt-1"><div className="h-full bg-[#D29922] rounded-full" style={{ width: `${underPct}%` }} /></div></div></div>
            <div className="grid grid-cols-5 md:grid-cols-10 gap-1.5">{Array.from({ length: 10 }, (_, d) => { const pct = percentages[d] || 0; const count = frequency[d] || 0; const isHot = pct > 12; const isWarm = pct > 9; const isBestMatch = d === mostCommon; const isBestDiffer = d === leastCommon; return (<button key={d} onClick={() => { setSelectedDigit(d); setPrediction(String(d)); }} className={`relative rounded-lg p-2 text-center transition-all border cursor-pointer hover:ring-2 hover:ring-primary ${selectedDigit === d ? 'ring-2 ring-primary' : ''} ${isHot ? 'bg-loss/10 border-loss/40 text-loss' : isWarm ? 'bg-warning/10 border-warning/40 text-warning' : 'bg-card border-border text-primary'}`}><div className="font-mono text-lg font-bold">{d}</div><div className="text-[8px]">{count} ({pct.toFixed(1)}%)</div><div className="h-1 bg-muted rounded-full mt-1"><div className={`h-full rounded-full ${isHot ? 'bg-loss' : isWarm ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.min(100, pct * 5)}%` }} /></div>{isBestMatch && <Badge className="absolute -top-1 -right-1 text-[7px] px-1 bg-profit text-profit-foreground">Match</Badge>}{isBestDiffer && <Badge className="absolute -top-1 -left-1 text-[7px] px-1 bg-loss text-loss-foreground">Avoid</Badge>}</button>); })}</div></div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2"><div className="bg-card border border-profit/30 rounded-lg p-2"><div className="text-[9px] text-muted-foreground">Best Match</div><div className="font-mono text-lg font-bold text-profit">{mostCommon}</div><div className="text-[8px] text-muted-foreground">{percentages[mostCommon]?.toFixed(1)}% frequency</div></div><div className="bg-card border border-loss/30 rounded-lg p-2"><div className="text-[9px] text-muted-foreground">Best Differ</div><div className="font-mono text-lg font-bold text-loss">{leastCommon}</div><div className="text-[8px] text-muted-foreground">{percentages[leastCommon]?.toFixed(1)}% frequency</div></div><div className="bg-card border border-[#D29922]/30 rounded-lg p-2"><div className="text-[9px] text-muted-foreground">Even/Odd</div><div className={`font-mono text-lg font-bold ${evenPct > 50 ? 'text-[#3FB950]' : 'text-[#D29922]'}`}>{evenPct > 50 ? 'EVEN' : 'ODD'}</div><div className="text-[8px] text-muted-foreground">{Math.max(evenPct, oddPct).toFixed(1)}%</div></div><div className="bg-card border border-primary/30 rounded-lg p-2"><div className="text-[9px] text-muted-foreground">Over/Under</div><div className={`font-mono text-lg font-bold ${overPct > 50 ? 'text-primary' : 'text-[#D29922]'}`}>{overPct > 50 ? 'OVER' : 'UNDER'}</div><div className="text-[8px] text-muted-foreground">{Math.max(overPct, underPct).toFixed(1)}%</div></div></div>
        </div>
      )}

      {/* Tabs for Bots */}
      <Tabs defaultValue="simple-bot" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4">
          <TabsTrigger value="simple-bot" className="flex items-center gap-2"><Bot className="w-4 h-4" /> Auto Bot</TabsTrigger>
          <TabsTrigger value="pro-scanner" className="flex items-center gap-2"><Scan className="w-4 h-4" /> Pro Scanner Bot</TabsTrigger>
        </TabsList>

        {/* TAB 1: Simple Auto Bot */}
        <TabsContent value="simple-bot" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-card border rounded-xl p-4 space-y-4">
              <div className="flex items-center justify-between"><h2 className="text-lg font-bold flex items-center gap-2"><Bot className="w-5 h-5 text-primary" /> Auto Trading Bot</h2><div className="flex items-center gap-2"><Button size="sm" variant={turboMode ? 'default' : 'outline'} className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit hover:bg-profit/90 text-profit-foreground animate-pulse' : ''}`} onClick={() => setTurboMode(!turboMode)} disabled={botRunning}><Zap className="w-3 h-3 mr-0.5" />{turboMode ? '⚡ TURBO' : 'Turbo'}</Button>{botRunning && <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }}><Badge className="text-[8px] bg-profit text-profit-foreground">RUNNING</Badge></motion.div>}</div></div>
              <Select value={botConfig.contractType} onValueChange={v => setBotConfig(p => ({ ...p, contractType: v }))} disabled={botRunning}><SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent></Select>
              {['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(botConfig.contractType) && (<div><label className="text-[9px] text-muted-foreground">Prediction (0-9)</label><div className="grid grid-cols-5 gap-1">{Array.from({ length: 10 }, (_, i) => (<button key={i} disabled={botRunning} onClick={() => setBotConfig(p => ({ ...p, prediction: String(i) }))} className={`h-6 rounded text-[10px] font-mono font-bold transition-all ${botConfig.prediction === String(i) ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground hover:bg-secondary'}`}>{i}</button>))}</div></div>)}
              <div className="grid grid-cols-2 gap-3"><div><label className="text-[10px] text-muted-foreground">Stake ($)</label><Input type="number" min="0.35" step="0.01" value={botConfig.stake} onChange={e => setBotConfig(p => ({ ...p, stake: e.target.value }))} disabled={botRunning} /></div><div><label className="text-[10px] text-muted-foreground">Duration</label><div className="flex gap-1"><Input type="number" min="1" value={botConfig.duration} onChange={e => setBotConfig(p => ({ ...p, duration: e.target.value }))} disabled={botRunning} className="flex-1" /><Select value={botConfig.durationUnit} onValueChange={v => setBotConfig(p => ({ ...p, durationUnit: v }))} disabled={botRunning}><SelectTrigger className="w-16"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="t">T</SelectItem><SelectItem value="s">S</SelectItem><SelectItem value="m">M</SelectItem></SelectContent></Select></div></div></div>
              <div className="flex items-center justify-between"><label className="text-[10px] text-foreground">Martingale</label><div className="flex items-center gap-2">{botConfig.martingale && (<Input type="number" min="1.1" step="0.1" value={botConfig.multiplier} onChange={e => setBotConfig(p => ({ ...p, multiplier: e.target.value }))} disabled={botRunning} className="h-6 text-[10px] w-14" />)}<button onClick={() => setBotConfig(p => ({ ...p, martingale: !p.martingale }))} disabled={botRunning} className={`w-9 h-5 rounded-full transition-colors ${botConfig.martingale ? 'bg-primary' : 'bg-muted'} relative`}><div className={`w-4 h-4 rounded-full bg-background shadow absolute top-0.5 transition-transform ${botConfig.martingale ? 'translate-x-4' : 'translate-x-0.5'}`} /></button></div></div>
              <div className="grid grid-cols-3 gap-2"><div><label className="text-[8px] text-muted-foreground">Stop Loss</label><Input type="number" value={botConfig.stopLoss} onChange={e => setBotConfig(p => ({ ...p, stopLoss: e.target.value }))} disabled={botRunning} /></div><div><label className="text-[8px] text-muted-foreground">Take Profit</label><Input type="number" value={botConfig.takeProfit} onChange={e => setBotConfig(p => ({ ...p, takeProfit: e.target.value }))} disabled={botRunning} /></div><div><label className="text-[8px] text-muted-foreground">Max Trades</label><Input type="number" value={botConfig.maxTrades} onChange={e => setBotConfig(p => ({ ...p, maxTrades: e.target.value }))} disabled={botRunning} /></div></div>
              {botRunning && (<div className="grid grid-cols-3 gap-2 text-center"><div className="bg-muted/30 rounded p-2"><div className="text-[10px] text-muted-foreground">Current Stake</div><div className="font-mono text-sm font-bold">${botStats.currentStake.toFixed(2)}</div></div><div className="bg-muted/30 rounded p-2"><div className="text-[10px] text-muted-foreground">Loss Streak</div><div className="font-mono text-sm font-bold text-loss">{botStats.consecutiveLosses}L</div></div><div className={`${botStats.pnl >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded p-2`}><div className="text-[10px] text-muted-foreground">P/L</div><div className={`font-mono text-sm font-bold ${botStats.pnl >= 0 ? 'text-profit' : 'text-loss'}`}>{botStats.pnl >= 0 ? '+' : ''}{botStats.pnl.toFixed(2)}</div></div></div>)}
              <div className="flex gap-3">{!botRunning ? (<Button onClick={startSimpleBot} disabled={!isAuthorized} className="flex-1 h-12 text-base font-bold bg-profit hover:bg-profit/90"><Play className="w-5 h-5 mr-2" /> Start Bot</Button>) : (<><Button onClick={togglePauseSimpleBot} variant="outline" className="flex-1 h-12"><Pause className="w-5 h-5 mr-2" /> {botPaused ? 'Resume' : 'Pause'}</Button><Button onClick={stopSimpleBot} variant="destructive" className="flex-1 h-12"><StopCircle className="w-5 h-5 mr-2" /> Stop</Button></>)}</div>
            </div>
            <div className="bg-card border border-border rounded-xl p-4"><div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold flex items-center gap-2"><Trophy className="w-4 h-4 text-primary" /> Trade Progress</h3><Button variant="ghost" size="sm" onClick={() => { setTradeHistory([]); setBotStats({ trades: 0, wins: 0, losses: 0, pnl: 0, currentStake: 0, consecutiveLosses: 0 }); }}>Clear</Button></div><div className="grid grid-cols-4 gap-3 mb-4"><div className="text-center p-2 bg-muted/30 rounded"><div className="text-[10px] text-muted-foreground">Trades</div><div className="text-xl font-bold">{totalTrades}</div></div><div className="text-center p-2 bg-profit/10 rounded"><div className="text-[10px] text-profit">Wins</div><div className="text-xl font-bold text-profit">{simpleWins}</div></div><div className="text-center p-2 bg-loss/10 rounded"><div className="text-[10px] text-loss">Losses</div><div className="text-xl font-bold text-loss">{simpleLosses}</div></div><div className={`text-center p-2 ${totalProfit >= 0 ? 'bg-profit/10' : 'bg-loss/10'} rounded`}><div className="text-[10px] text-muted-foreground">P/L</div><div className={`text-xl font-bold ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>{totalProfit >= 0 ? '+' : ''}{totalProfit.toFixed(2)}</div></div></div>{totalTrades > 0 && (<div><div className="flex justify-between text-xs mb-1"><span>Win Rate</span><span className="font-mono font-bold">{winRate.toFixed(1)}%</span></div><div className="h-2 bg-muted rounded-full"><div className="h-full bg-profit rounded-full" style={{ width: `${winRate}%` }} /></div></div>)}<div className="max-h-60 overflow-auto mt-4"><table className="w-full text-xs"><thead className="text-muted-foreground border-b"><tr><th className="text-left p-2">Time</th><th className="text-left p-2">Type</th><th className="text-right p-2">Stake</th><th className="text-center p-2">Result</th><th className="text-right p-2">P/L</th></tr></thead><tbody>{tradeHistory.slice(0, 20).map(t => (<tr key={t.id} className="border-t"><td className="p-2 text-[10px]">{new Date(t.time).toLocaleTimeString()}</td><td className="p-2">{t.type}</td><td className="p-2 text-right">${t.stake.toFixed(2)}</td><td className="p-2 text-center"><Badge variant={t.status === 'won' ? 'default' : t.status === 'lost' ? 'destructive' : 'secondary'} className="text-[9px]">{t.status === 'open' ? 'Pending' : t.status === 'won' ? 'Win' : 'Loss'}</Badge></td><td className={`p-2 text-right font-mono ${t.profit >= 0 ? 'text-profit' : 'text-loss'}`}>{t.status === 'open' ? '...' : `${t.profit >= 0 ? '+' : ''}$${t.profit.toFixed(2)}`}</td></tr>))}</tbody></table></div></div>
          </div>
        </TabsContent>

        {/* TAB 2: Pro Scanner Bot */}
        <TabsContent value="pro-scanner" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-4 space-y-3">
              <div className="bg-card border-2 border-profit/30 rounded-xl p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-profit flex items-center gap-1"><Home className="w-3.5 h-3.5" /> M1 — Home</h3><Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} /></div><Select value={m1Symbol} onValueChange={setM1Symbol} disabled={isRunning}><SelectTrigger className="h-7 text-xs mt-2"><SelectValue /></SelectTrigger><SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent></Select><Select value={m1Contract} onValueChange={setM1Contract} disabled={isRunning}><SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES_SIMPLE.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>{needsBarrier(m1Contract) && <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)} className="h-7 text-xs mt-1" placeholder="Barrier (0-9)" disabled={isRunning} />}<div className="border-t border-border/30 pt-2 mt-2"><div className="flex items-center justify-between"><span className="text-[9px] font-semibold text-primary flex items-center gap-1"><Anchor className="w-3 h-3" /> Virtual Hook</span><Switch checked={m1HookEnabled} onCheckedChange={setM1HookEnabled} disabled={isRunning} /></div>{m1HookEnabled && (<div className="grid grid-cols-2 gap-1 mt-1"><div><label className="text-[8px] text-muted-foreground">V-Losses</label><Input type="number" min="1" max="20" value={m1VirtualLossCount} onChange={e => setM1VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /></div><div><label className="text-[8px] text-muted-foreground">Real Trades</label><Input type="number" min="1" max="10" value={m1RealCount} onChange={e => setM1RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /></div></div>)}</div></div>
              <div className="bg-card border-2 border-purple-500/30 rounded-xl p-3"><div className="flex items-center justify-between"><h3 className="text-xs font-bold text-purple-400 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> M2 — Recovery</h3><Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} /></div><Select value={m2Symbol} onValueChange={setM2Symbol} disabled={isRunning}><SelectTrigger className="h-7 text-xs mt-2"><SelectValue /></SelectTrigger><SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>)}</SelectContent></Select><Select value={m2Contract} onValueChange={setM2Contract} disabled={isRunning}><SelectTrigger className="h-7 text-xs mt-1"><SelectValue /></SelectTrigger><SelectContent>{CONTRACT_TYPES_SIMPLE.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select>{needsBarrier(m2Contract) && <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)} className="h-7 text-xs mt-1" placeholder="Barrier (0-9)" disabled={isRunning} />}<div className="border-t border-border/30 pt-2 mt-2"><div className="flex items-center justify-between"><span className="text-[9px] font-semibold text-primary flex items-center gap-1"><Anchor className="w-3 h-3" /> Virtual Hook</span><Switch checked={m2HookEnabled} onCheckedChange={setM2HookEnabled} disabled={isRunning} /></div>{m2HookEnabled && (<div className="grid grid-cols-2 gap-1 mt-1"><div><label className="text-[8px] text-muted-foreground">V-Losses</label><Input type="number" min="1" max="20" value={m2VirtualLossCount} onChange={e => setM2VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /></div><div><label className="text-[8px] text-muted-foreground">Real Trades</label><Input type="number" min="1" max="10" value={m2RealCount} onChange={e => setM2RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /></div></div>)}</div></div>
              <div className="bg-card border border-border rounded-xl p-3"><h3 className="text-xs font-semibold mb-2 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" /> Risk</h3><div className="grid grid-cols-3 gap-1"><div><label className="text-[8px] text-muted-foreground">Stake ($)</label><Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-7 text-xs" /></div><div><label className="text-[8px] text-muted-foreground">TP ($)</label><Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-7 text-xs" /></div><div><label className="text-[8px] text-muted-foreground">SL ($)</label><Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-7 text-xs" /></div></div><div className="flex items-center justify-between mt-2"><label className="text-[10px]">Martingale</label><Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} /></div>{martingaleOn && (<div className="grid grid-cols-2 gap-1 mt-1"><div><label className="text-[8px] text-muted-foreground">Multiplier</label><Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-7 text-xs" /></div><div><label className="text-[8px] text-muted-foreground">Max Steps</label><Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-7 text-xs" /></div></div>)}<div className="flex items-center gap-3 mt-2"><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={strategyM1Enabled} onChange={e => setStrategyM1Enabled(e.target.checked)} disabled={isRunning} /> Strategy M1</label><label className="flex items-center gap-1 text-[10px]"><input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} /> Strategy M2</label></div></div>
              {(strategyEnabled || strategyM1Enabled) && (<div className="bg-card border border-warning/30 rounded-xl p-3"><h3 className="text-xs font-semibold text-warning mb-2 flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Strategy (Pattern/Digit)</h3>{strategyM1Enabled && (<div className="border border-profit/20 rounded-lg p-2 mb-2"><div className="flex items-center justify-between mb-1"><label className="text-[9px] font-semibold text-profit">M1 Strategy</label><div className="flex gap-0.5"><Button size="sm" variant={m1StrategyMode === 'pattern' ? 'default' : 'outline'} className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('pattern')} disabled={isRunning}>Pattern</Button><Button size="sm" variant={m1StrategyMode === 'digit' ? 'default' : 'outline'} className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('digit')} disabled={isRunning}>Digit</Button></div></div>{m1StrategyMode === 'pattern' ? (<><Textarea placeholder="E=Even O=Odd e.g. EEEOE" value={m1Pattern} onChange={e => setM1Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))} disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0" /><div className={`text-[9px] font-mono ${m1PatternValid ? 'text-profit' : 'text-loss'}`}>{cleanM1Pattern.length === 0 ? 'Enter pattern...' : m1PatternValid ? `✓ ${cleanM1Pattern}` : `✗ Need 2+`}</div></>) : (<div className="grid grid-cols-3 gap-1"><Select value={m1DigitCondition} onValueChange={setM1DigitCondition} disabled={isRunning}><SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger><SelectContent>{['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><Input type="number" min="0" max="9" value={m1DigitCompare} onChange={e => setM1DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /><Input type="number" min="1" max="50" value={m1DigitWindow} onChange={e => setM1DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /></div>)}</div>)}{strategyEnabled && (<div className="border border-destructive/20 rounded-lg p-2"><div className="flex items-center justify-between mb-1"><label className="text-[9px] font-semibold text-destructive">M2 Strategy</label><div className="flex gap-0.5"><Button size="sm" variant={m2StrategyMode === 'pattern' ? 'default' : 'outline'} className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('pattern')} disabled={isRunning}>Pattern</Button><Button size="sm" variant={m2StrategyMode === 'digit' ? 'default' : 'outline'} className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('digit')} disabled={isRunning}>Digit</Button></div></div>{m2StrategyMode === 'pattern' ? (<><Textarea placeholder="E=Even O=Odd e.g. OOEEO" value={m2Pattern} onChange={e => setM2Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))} disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0" /><div className={`text-[9px] font-mono ${m2PatternValid ? 'text-profit' : 'text-loss'}`}>{cleanM2Pattern.length === 0 ? 'Enter pattern...' : m2PatternValid ? `✓ ${cleanM2Pattern}` : `✗ Need 2+`}</div></>) : (<div className="grid grid-cols-3 gap-1"><Select value={m2DigitCondition} onValueChange={setM2DigitCondition} disabled={isRunning}><SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger><SelectContent>{['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select><Input type="number" min="0" max="9" value={m2DigitCompare} onChange={e => setM2DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /><Input type="number" min="1" max="50" value={m2DigitWindow} onChange={e => setM2DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" /></div>)}</div>)}</div>)}
              <div className="grid grid-cols-2 gap-2"><Button onClick={startProBot} disabled={isRunning || !isAuthorized || balance < parseFloat(stake)} className="h-12 bg-profit hover:bg-profit/90"><Play className="w-4 h-4 mr-2" /> START PRO BOT</Button><Button onClick={stopProBot} disabled={!isRunning} variant="destructive" className="h-12"><StopCircle className="w-4 h-4 mr-2" /> STOP</Button></div>
            </div>
            <div className="lg:col-span-8 space-y-3">
              <div className="bg-card border border-border rounded-xl p-3"><div className="flex items-center justify-between mb-2"><h3 className="text-xs font-semibold">Live Digits — {activeSymbol}</h3><Badge className={`${proStatus.color} text-[10px]`}>{proStatus.icon} {proStatus.label}</Badge></div><div className="flex gap-1 justify-center flex-wrap">{activeDigits.length === 0 ? <span className="text-[10px] text-muted-foreground">Waiting for ticks...</span> : activeDigits.map((d, i) => { const isOver = d >= 5; const isEven = d % 2 === 0; const isLast = i === activeDigits.length - 1; return (<div key={i} className={`w-8 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-mono font-bold border ${isLast ? 'ring-2 ring-primary' : ''} ${isOver ? 'bg-loss/10 border-loss/30 text-loss' : 'bg-profit/10 border-profit/30 text-profit'}`}><span className="text-sm">{d}</span><span className="text-[7px] opacity-60">{isOver ? 'O' : 'U'}{isEven ? 'E' : 'O'}</span></div>); })}</div></div>
              <div className="grid grid-cols-5 gap-2"><div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px] text-muted-foreground">Trades</div><div className="font-mono text-sm font-bold">{wins + losses}</div></div><div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px] text-muted-foreground">Wins</div><div className="font-mono text-sm font-bold text-profit">{wins}</div></div><div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px] text-muted-foreground">Losses</div><div className="font-mono text-sm font-bold text-loss">{losses}</div></div><div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px] text-muted-foreground">P/L</div><div className={`font-mono text-sm font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>{netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}</div></div><div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px] text-muted-foreground">Staked</div><div className="font-mono text-sm font-bold">${totalStaked.toFixed(2)}</div></div></div>
              <div className="bg-card border border-border rounded-xl overflow-hidden"><div className="px-3 py-2 border-b flex justify-between items-center"><h3 className="text-xs font-semibold">Activity Log</h3><Button variant="ghost" size="sm" onClick={clearLog}><Trash2 className="w-3 h-3" /></Button></div><div className="max-h-96 overflow-auto"><table className="w-full text-[10px]"><thead className="text-muted-foreground bg-muted/30"><tr><th className="p-1.5 text-left">Time</th><th className="p-1">Mkt</th><th className="p-1">Symbol</th><th className="p-1">Type</th><th className="p-1 text-right">Stake</th><th className="p-1 text-center">Digit</th><th className="p-1 text-center">Result</th><th className="p-1 text-right">P/L</th></tr></thead><tbody>{logEntries.length === 0 ? (<tr><td colSpan={8} className="text-center py-8 text-muted-foreground">No trades yet — start the bot</td></tr>) : logEntries.map(e => (<tr key={e.id} className={`border-t ${e.market === 'M1' ? 'border-l-2 border-l-profit' : e.market === 'VH' ? 'border-l-2 border-l-primary' : 'border-l-2 border-l-purple-500'}`}><td className="p-1 font-mono">{e.time}</td><td className={`p-1 font-bold ${e.market === 'M1' ? 'text-profit' : e.market === 'VH' ? 'text-primary' : 'text-purple-400'}`}>{e.market}</td><td className="p-1">{e.symbol}</td><td className="p-1">{e.contract.replace('DIGIT', '')}</td><td className="p-1 text-right">{e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}{e.martingaleStep > 0 && e.market !== 'VH' && <span className="text-warning ml-0.5">M{e.martingaleStep}</span>}</td><td className="p-1 text-center font-mono">{e.exitDigit}</td><td className="p-1 text-center"><span className={`px-1 py-0.5 rounded-full text-[8px] font-bold ${e.result === 'Win' || e.result === 'V-Win' ? 'bg-profit/20 text-profit' : e.result === 'Loss' || e.result === 'V-Loss' ? 'bg-loss/20 text-loss' : 'bg-warning/20 text-warning'}`}>{e.result === 'Pending' ? '...' : e.result}</span></td><td className={`p-1 text-right ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>{e.result === 'Pending' ? '...' : e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}</td></tr>))}</tbody></table></div></div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
