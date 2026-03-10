import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/contexts/AuthContext';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, ArrowUp, ArrowDown, Minus,
  Target, ShieldAlert, Gauge, Volume2, VolumeX, Clock, Zap, Trophy, Play, Pause, StopCircle,
  Settings, Eye, EyeOff, LineChart, CandlestickChart, AreaChart, Move, ZoomIn, ZoomOut,
  RefreshCw, Download, Maximize2, Minimize2, ChevronDown, ChevronRight, Layers, Sigma,
  Waves, Rabbit, Turtle, Flame, Snowflake, AlertCircle, CheckCircle2, XCircle, Info,
  ChartCandlestick, ChartLine, ChartArea, ChartBar, ChartNoAxesColumn, ChartSpline,
  ArrowLeftRight, ArrowUpDown, Palette, Grid3x3, Ruler, EyeClosed, Crosshair,
  TimerReset, Timer, Sunrise, Sunset, Cloud, CloudRain, CloudSnow, CloudLightning,
  Wind, GaugeCircle, Sparkles, Brain, Cpu, Orbit, Rocket, Shield, Swords, Wand2,
  Star, Heart, Crown, Diamond, CircleDollarSign, Coins, Bitcoin, Wallet, Pencil,
} from 'lucide-react';

/* ── Types ── */
interface Indicator {
  id: string;
  name: string;
  enabled: boolean;
  color: string;
  params: Record<string, any>;
  type: 'overlay' | 'oscillator' | 'volume';
  section: 'trend' | 'oscillator' | 'volume' | 'volatility' | 'custom';
}

interface Candle {
  open: number; high: number; low: number; close: number; time: number; volume?: number;
}

interface TradeRecord {
  id: string;
  time: number;
  type: string;
  stake: number;
  profit: number;
  status: 'won' | 'lost' | 'open';
  symbol: string;
}

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

const GROUPS = [
  { value: 'all', label: 'All Markets' },
  { value: 'vol1s', label: 'Volatility 1s' },
  { value: 'vol', label: 'Volatility' },
  { value: 'jump', label: 'Jump' },
  { value: 'bear', label: 'Bear/Bull' },
  { value: 'step', label: 'Step' },
  { value: 'range', label: 'Range Break' },
];

const TIMEFRAMES = [
  { value: '1m', label: '1m', seconds: 60 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '30m', label: '30m', seconds: 1800 },
  { value: '1h', label: '1h', seconds: 3600 },
  { value: '4h', label: '4h', seconds: 14400 },
  { value: '1d', label: '1d', seconds: 86400 },
  { value: '1w', label: '1w', seconds: 604800 },
  { value: '1M', label: '1M', seconds: 2592000 },
];

const CHART_TYPES = [
  { value: 'candles', label: 'Candles', icon: CandlestickChart },
  { value: 'bars', label: 'Bars', icon: BarChart3 },
  { value: 'line', label: 'Line', icon: TrendingUp },
  { value: 'area', label: 'Area', icon: Activity },
  { value: 'hollow', label: 'Hollow', icon: ChartSpline },
];

const CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise', icon: TrendingUp, color: '#22c55e' },
  { value: 'PUT', label: 'Fall', icon: TrendingDown, color: '#ef4444' },
  { value: 'DIGITMATCH', label: 'Matches', icon: Target, color: '#eab308' },
  { value: 'DIGITDIFF', label: 'Differs', icon: Crosshair, color: '#a855f7' },
  { value: 'DIGITEVEN', label: 'Even', icon: Activity, color: '#3b82f6' },
  { value: 'DIGITODD', label: 'Odd', icon: Gauge, color: '#ec4899' },
  { value: 'DIGITOVER', label: 'Over', icon: ArrowUp, color: '#14b8a6' },
  { value: 'DIGITUNDER', label: 'Under', icon: ArrowDown, color: '#f97316' },
];

/* ── All Deriv Indicators ── */
const ALL_INDICATORS: Indicator[] = [
  // Trend
  { id: 'ema', name: 'EMA', enabled: true, color: '#3b82f6', params: { period: 9, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'ema20', name: 'EMA 20', enabled: true, color: '#eab308', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'ema50', name: 'EMA 50', enabled: true, color: '#a855f7', params: { period: 50, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'ema200', name: 'EMA 200', enabled: false, color: '#ec4899', params: { period: 200, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'sma', name: 'SMA', enabled: false, color: '#f97316', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'wma', name: 'WMA', enabled: false, color: '#14b8a6', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'vwap', name: 'VWAP', enabled: false, color: '#8b5cf6', params: { period: 20 }, type: 'overlay', section: 'trend' },
  { id: 'ichimoku', name: 'Ichimoku', enabled: false, color: '#06b6d4', params: { conversion: 9, base: 26, span: 52 }, type: 'overlay', section: 'trend' },
  
  // Oscillators
  { id: 'rsi', name: 'RSI', enabled: true, color: '#eab308', params: { period: 14 }, type: 'oscillator', section: 'oscillator' },
  { id: 'macd', name: 'MACD', enabled: true, color: '#a855f7', params: { fast: 12, slow: 26, signal: 9 }, type: 'oscillator', section: 'oscillator' },
  { id: 'stoch', name: 'Stochastic', enabled: false, color: '#22c55e', params: { k: 14, d: 3 }, type: 'oscillator', section: 'oscillator' },
  { id: 'cci', name: 'CCI', enabled: false, color: '#ef4444', params: { period: 20 }, type: 'oscillator', section: 'oscillator' },
  { id: 'williams', name: 'Williams %R', enabled: false, color: '#3b82f6', params: { period: 14 }, type: 'oscillator', section: 'oscillator' },
  { id: 'momentum', name: 'Momentum', enabled: false, color: '#eab308', params: { period: 10 }, type: 'oscillator', section: 'oscillator' },
  
  // Volatility
  { id: 'bb', name: 'Bollinger Bands', enabled: true, color: '#a855f7', params: { period: 20, std: 2 }, type: 'overlay', section: 'volatility' },
  { id: 'keltner', name: 'Keltner', enabled: false, color: '#ec4899', params: { period: 20, multiplier: 2 }, type: 'overlay', section: 'volatility' },
  { id: 'atr', name: 'ATR', enabled: false, color: '#f97316', params: { period: 14 }, type: 'oscillator', section: 'volatility' },
  
  // Volume
  { id: 'volume', name: 'Volume', enabled: true, color: '#3b82f6', params: {}, type: 'volume', section: 'volume' },
  { id: 'obv', name: 'OBV', enabled: false, color: '#22c55e', params: {}, type: 'volume', section: 'volume' },
  { id: 'mfi', name: 'MFI', enabled: false, color: '#eab308', params: { period: 14 }, type: 'volume', section: 'volume' },
  
  // Custom Deriv
  { id: 'digit_trend', name: 'Digit Trend', enabled: false, color: '#ec4899', params: { period: 26 }, type: 'overlay', section: 'custom' },
  { id: 'even_odd', name: 'Even/Odd', enabled: false, color: '#14b8a6', params: { period: 100 }, type: 'oscillator', section: 'custom' },
  { id: 'over_under', name: 'Over/Under', enabled: false, color: '#f97316', params: { period: 100 }, type: 'oscillator', section: 'custom' },
];

/* ── Candle builder ── */
function buildCandles(prices: number[], times: number[], volumes: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const tfMap = Object.fromEntries(TIMEFRAMES.map(t => [t.value, t.seconds]));
  const interval = tfMap[tf] || 60;
  const candles: Candle[] = [];
  let current: Candle | null = null;

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const t = times[i] || Date.now()/1000 + i;
    const v = volumes[i] || 0;
    const bucket = Math.floor(t / interval) * interval;

    if (!current || current.time !== bucket) {
      if (current) candles.push(current);
      current = { open: p, high: p, low: p, close: p, time: bucket, volume: v };
    } else {
      current.high = Math.max(current.high, p);
      current.low = Math.min(current.low, p);
      current.close = p;
      current.volume = (current.volume || 0) + v;
    }
  }
  if (current) candles.push(current);
  return candles;
}

/* ── Indicator Calculations ── */
function calcEMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  if (prices.length < period) return prices.map(() => NaN);
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) result.push(NaN);
    else if (i === period - 1) result.push(ema);
    else {
      ema = prices[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function calcSMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) result.push(NaN);
    else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calcWMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) result.push(NaN);
    else {
      let sum = 0, weightSum = 0;
      for (let j = 0; j < period; j++) {
        const weight = period - j;
        sum += prices[i - j] * weight;
        weightSum += weight;
      }
      result.push(sum / weightSum);
    }
  }
  return result;
}

function calcVWAP(prices: number[], volumes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period) result.push(NaN);
    else {
      let sumPV = 0, sumV = 0;
      for (let j = 0; j < period; j++) {
        sumPV += prices[i - j] * (volumes[i - j] || 1);
        sumV += (volumes[i - j] || 1);
      }
      result.push(sumPV / sumV);
    }
  }
  return result;
}

function calcIchimoku(candles: Candle[]): any {
  const tenkan: number[] = [], kijun: number[] = [], spanA: number[] = [], spanB: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i >= 8) {
      const high9 = Math.max(...candles.slice(i - 8, i + 1).map(c => c.high));
      const low9 = Math.min(...candles.slice(i - 8, i + 1).map(c => c.low));
      tenkan.push((high9 + low9) / 2);
    } else tenkan.push(NaN);
    
    if (i >= 25) {
      const high26 = Math.max(...candles.slice(i - 25, i + 1).map(c => c.high));
      const low26 = Math.min(...candles.slice(i - 25, i + 1).map(c => c.low));
      kijun.push((high26 + low26) / 2);
    } else kijun.push(NaN);
    
    if (i >= 51) {
      const high52 = Math.max(...candles.slice(i - 51, i + 1).map(c => c.high));
      const low52 = Math.min(...candles.slice(i - 51, i + 1).map(c => c.low));
      spanB.push((high52 + low52) / 2);
    } else spanB.push(NaN);
    
    if (i >= 25 && !isNaN(tenkan[i]) && !isNaN(kijun[i])) {
      spanA.push((tenkan[i] + kijun[i]) / 2);
    } else spanA.push(NaN);
  }
  
  return { tenkan, kijun, spanA, spanB };
}

function calcStoch(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3): { k: number[], d: number[] } {
  const k: number[] = [], d: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
      d.push(NaN);
      continue;
    }
    
    const periodCandles = candles.slice(i - kPeriod + 1, i + 1);
    const high = Math.max(...periodCandles.map(c => c.high));
    const low = Math.min(...periodCandles.map(c => c.low));
    const close = candles[i].close;
    
    const kRaw = ((close - low) / (high - low)) * 100;
    k.push(kRaw);
    
    if (i >= kPeriod + dPeriod - 2) {
      const kSlice = k.slice(i - dPeriod + 1, i + 1);
      d.push(kSlice.reduce((a, b) => a + b, 0) / dPeriod);
    } else d.push(NaN);
  }
  
  return { k, d };
}

function calcCCI(candles: Candle[], period: number = 20): number[] {
  const cci: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      cci.push(NaN);
      continue;
    }
    
    const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
    const periodTPs = [];
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      periodTPs.push((candles[idx].high + candles[idx].low + candles[idx].close) / 3);
    }
    
    const smaTP = periodTPs.reduce((a, b) => a + b, 0) / period;
    const meanDev = periodTPs.reduce((sum, val) => sum + Math.abs(val - smaTP), 0) / period;
    cci.push((tp - smaTP) / (0.015 * meanDev));
  }
  
  return cci;
}

function calcWilliamsR(candles: Candle[], period: number = 14): number[] {
  const wr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      wr.push(NaN);
      continue;
    }
    
    const periodCandles = candles.slice(i - period + 1, i + 1);
    const high = Math.max(...periodCandles.map(c => c.high));
    const low = Math.min(...periodCandles.map(c => c.low));
    const close = candles[i].close;
    
    wr.push(((high - close) / (high - low)) * -100);
  }
  
  return wr;
}

function calcMomentum(prices: number[], period: number = 10): number[] {
  const momentum: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period) momentum.push(NaN);
    else momentum.push(prices[i] - prices[i - period]);
  }
  return momentum;
}

function calcKeltner(candles: Candle[], period: number = 20, multiplier: number = 2): any {
  const upper: number[] = [], middle: number[] = [], lower: number[] = [];
  const ema = calcEMA(candles.map(c => c.close), period);
  const atr = calcATR(candles, period);
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      middle.push(ema[i]);
      upper.push(ema[i] + multiplier * atr[i]);
      lower.push(ema[i] - multiplier * atr[i]);
    }
  }
  
  return { upper, middle, lower };
}

function calcATR(candles: Candle[], period: number = 14): number[] {
  const atr: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(NaN);
      continue;
    }
    
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close)
    );
    
    if (i < period) atr.push(NaN);
    else if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) {
        const curr = candles[i - j + 1];
        const prev = candles[i - j];
        sum += Math.max(
          curr.high - curr.low,
          Math.abs(curr.high - prev.close),
          Math.abs(curr.low - prev.close)
        );
      }
      atr.push(sum / period);
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr) / period);
    }
  }
  
  return atr;
}

function calcOBV(prices: number[], volumes: number[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) obv.push(obv[i - 1] + (volumes[i] || 0));
    else if (prices[i] < prices[i - 1]) obv.push(obv[i - 1] - (volumes[i] || 0));
    else obv.push(obv[i - 1]);
  }
  return obv;
}

function calcMFI(candles: Candle[], period: number = 14): number[] {
  const mfi: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      mfi.push(NaN);
      continue;
    }
    
    let positiveFlow = 0, negativeFlow = 0;
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      const tp = (candles[idx].high + candles[idx].low + candles[idx].close) / 3;
      const flow = tp * (candles[idx].volume || 1);
      
      if (idx > 0) {
        const prevTP = (candles[idx - 1].high + candles[idx - 1].low + candles[idx - 1].close) / 3;
        if (tp > prevTP) positiveFlow += flow;
        else negativeFlow += flow;
      }
    }
    
    const ratio = positiveFlow / negativeFlow;
    mfi.push(100 - (100 / (1 + ratio)));
  }
  
  return mfi;
}

function calcDigitTrend(digits: number[], period: number = 26): number[] {
  const trend: number[] = [];
  for (let i = 0; i < digits.length; i++) {
    if (i < period) trend.push(NaN);
    else {
      const slice = digits.slice(i - period + 1, i + 1);
      const evens = slice.filter(d => d % 2 === 0).length;
      trend.push((evens / period) * 100);
    }
  }
  return trend;
}

function calcEvenOddRatio(digits: number[], period: number = 100): number[] {
  const ratio: number[] = [];
  for (let i = 0; i < digits.length; i++) {
    if (i < period) ratio.push(NaN);
    else {
      const slice = digits.slice(i - period + 1, i + 1);
      const evens = slice.filter(d => d % 2 === 0).length;
      ratio.push((evens / period) * 100);
    }
  }
  return ratio;
}

function calcOverUnder(digits: number[], period: number = 100): number[] {
  const ratio: number[] = [];
  for (let i = 0; i < digits.length; i++) {
    if (i < period) ratio.push(NaN);
    else {
      const slice = digits.slice(i - period + 1, i + 1);
      const over = slice.filter(d => d > 4).length;
      ratio.push((over / period) * 100);
    }
  }
  return ratio;
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  
  // Chart State
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1h');
  const [chartType, setChartType] = useState('candles');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [volumes, setVolumes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Indicators
  const [indicators, setIndicators] = useState<Indicator[]>(ALL_INDICATORS);
  
  // Chart Settings
  const [chartSettings, setChartSettings] = useState({
    gridLines: true,
    crosshair: true,
    showVolume: true,
    showOHLC: true,
    precision: 2,
    theme: 'dark',
  });
  
  // Zoom & pan
  const [candleWidth, setCandleWidth] = useState(6);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  
  // Crosshair
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
  const [crosshairTime, setCrosshairTime] = useState<number | null>(null);
  
  // UI State
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState('indicators');
  
  // Trading
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('h');
  const [tradeStake, setTradeStake] = useState('10');
  const [isTrading, setIsTrading] = useState(false);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);

  /* ── Load data ── */
  useEffect(() => {
    let active = true;
    
    const load = async () => {
      if (!derivApi.isConnected) { setIsLoading(false); return; }
      setIsLoading(true);
      try {
        const hist = await derivApi.getTickHistory(symbol as MarketSymbol, 5000);
        if (!active) return;
        setPrices(hist.history.prices || []);
        setTimes(hist.history.times || []);
        setVolumes(hist.history.prices?.map(() => Math.random() * 1000) || []);
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current) {
          subscribedRef.current = true;
          await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            setPrices(prev => [...prev, data.tick.quote].slice(-5000));
            setTimes(prev => [...prev, data.tick.epoch].slice(-5000));
            setVolumes(prev => [...prev, Math.random() * 1000].slice(-5000));
          });
        }
      } catch (err) {
        console.error(err);
        setIsLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, [symbol]);

  /* ── Derived data ── */
  const tfPrices = useMemo(() => prices.slice(-1000), [prices]);
  const tfTimes = useMemo(() => times.slice(-1000), [times]);
  const tfVolumes = useMemo(() => volumes.slice(-1000), [volumes]);
  
  const candles = useMemo(() => 
    buildCandles(tfPrices, tfTimes, tfVolumes, timeframe), 
    [tfPrices, tfTimes, tfVolumes, timeframe]
  );
  
  const currentPrice = prices[prices.length - 1] || 0;
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);

  // Indicator calculations
  const indicatorValues = useMemo(() => {
    const values: Record<string, any> = {};
    const closePrices = candles.map(c => c.close);
    
    indicators.forEach(ind => {
      if (!ind.enabled) return;
      
      try {
        switch (ind.id) {
          case 'ema':
          case 'ema20':
          case 'ema50':
          case 'ema200':
            values[ind.id] = calcEMA(closePrices, ind.params.period);
            break;
          case 'sma':
            values.sma = calcSMA(closePrices, ind.params.period);
            break;
          case 'wma':
            values.wma = calcWMA(closePrices, ind.params.period);
            break;
          case 'vwap':
            values.vwap = calcVWAP(closePrices, tfVolumes, ind.params.period);
            break;
          case 'ichimoku':
            values.ichimoku = calcIchimoku(candles);
            break;
          case 'rsi':
            values.rsi = calculateRSI(closePrices, ind.params.period);
            break;
          case 'macd':
            values.macd = calculateMACD(closePrices, ind.params.fast, ind.params.slow, ind.params.signal);
            break;
          case 'stoch':
            values.stoch = calcStoch(candles, ind.params.k, ind.params.d);
            break;
          case 'cci':
            values.cci = calcCCI(candles, ind.params.period);
            break;
          case 'williams':
            values.williams = calcWilliamsR(candles, ind.params.period);
            break;
          case 'momentum':
            values.momentum = calcMomentum(closePrices, ind.params.period);
            break;
          case 'bb':
            values.bb = calculateBollingerBands(closePrices, ind.params.period, ind.params.std);
            break;
          case 'keltner':
            values.keltner = calcKeltner(candles, ind.params.period, ind.params.multiplier);
            break;
          case 'atr':
            values.atr = calcATR(candles, ind.params.period);
            break;
          case 'obv':
            values.obv = calcOBV(closePrices, tfVolumes);
            break;
          case 'mfi':
            values.mfi = calcMFI(candles, ind.params.period);
            break;
          case 'digit_trend':
            values.digitTrend = calcDigitTrend(digits, ind.params.period);
            break;
          case 'even_odd':
            values.evenOdd = calcEvenOddRatio(digits, ind.params.period);
            break;
          case 'over_under':
            values.overUnder = calcOverUnder(digits, ind.params.period);
            break;
        }
      } catch (e) {
        console.error(`Error calculating ${ind.id}:`, e);
      }
    });
    
    return values;
  }, [indicators, candles, tfVolumes, digits]);

  // Stats
  const evenCount = digits.filter(d => d % 2 === 0).length;
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const overCount = digits.filter(d => d > 4).length;
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;

  /* ── Canvas Drawing ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length < 2) return;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Setup canvas with proper sizing
    const container = containerRef.current;
    if (!container) return;
    
    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(dpr, dpr);
    
    const W = rect.width;
    const H = rect.height;
    
    // Layout dimensions
    const volumeHeight = chartSettings.showVolume && indicatorValues.volume ? 80 : 0;
    const rsiHeight = indicatorValues.rsi ? 80 : 0;
    const macdHeight = indicatorValues.macd ? 100 : 0;
    const stochHeight = indicatorValues.stoch ? 80 : 0;
    const oscillatorHeight = rsiHeight + macdHeight + stochHeight;
    
    const chartH = H - volumeHeight - oscillatorHeight;
    const priceAxisW = 80;
    const chartW = W - priceAxisW;
    
    // Visible range
    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    const endIdx = candles.length - scrollOffset;
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);
    
    if (visibleCandles.length === 0) return;
    
    // Price range
    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
    Object.values(indicatorValues).forEach(val => {
      if (Array.isArray(val)) {
        val.slice(startIdx, endIdx).forEach(v => {
          if (typeof v === 'number' && !isNaN(v)) allPrices.push(v);
        });
      }
    });
    
    const minPrice = Math.min(...allPrices);
    const maxPrice = Math.max(...allPrices);
    const priceRange = maxPrice - minPrice;
    const padding = priceRange * 0.05;
    const plotMin = minPrice - padding;
    const plotMax = maxPrice + padding;
    const plotRange = plotMax - plotMin;
    
    // Drawing functions
    const toY = (price: number) => 20 + ((plotMax - price) / plotRange) * (chartH - 40);
    const offsetX = 10;
    
    // Clear
    ctx.fillStyle = '#0D1117';
    ctx.fillRect(0, 0, W, H);
    
    // Grid
    if (chartSettings.gridLines) {
      ctx.strokeStyle = '#30363D';
      ctx.lineWidth = 0.5;
      
      // Horizontal grid
      for (let i = 0; i <= 5; i++) {
        const y = 20 + (i / 5) * (chartH - 40);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
      }
      
      // Vertical grid (time)
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * chartW;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartH);
        ctx.stroke();
      }
    }
    
    // Price labels
    ctx.fillStyle = '#8B949E';
    ctx.font = '10px JetBrains Mono';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const price = plotMax - (i / 5) * plotRange;
      const y = 20 + (i / 5) * (chartH - 40);
      ctx.fillText(price.toFixed(chartSettings.precision), chartW - 5, y + 3);
    }
    
    // Time labels
    ctx.textAlign = 'center';
    const timeStep = Math.max(1, Math.floor(visibleCandles.length / 6));
    for (let i = 0; i < visibleCandles.length; i += timeStep) {
      const candle = visibleCandles[i];
      const x = offsetX + i * totalCandleW + candleWidth / 2;
      if (x < chartW) {
        const date = new Date(candle.time * 1000);
        const label = `${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;
        ctx.fillText(label, x, chartH - 5);
      }
    }
    
    // Draw overlays first
    const drawLine = (values: (number | null)[], color: string, width: number = 1.5, dash: number[] = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      let started = false;
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= values.length) continue;
        
        const v = values[globalIdx];
        if (v === null || isNaN(v)) {
          started = false;
          continue;
        }
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(v);
        
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    
    // Bollinger Bands
    if (indicatorValues.bb) {
      const bb = indicatorValues.bb;
      
      // Fill between bands
      ctx.fillStyle = 'rgba(168, 85, 247, 0.05)';
      ctx.beginPath();
      
      let first = true;
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= bb.upper.length) continue;
        const u = bb.upper[globalIdx];
        if (u === null || isNaN(u)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(u);
        if (first) { ctx.moveTo(x, y); first = false; }
        else ctx.lineTo(x, y);
      }
      
      for (let i = visibleCandles.length - 1; i >= 0; i--) {
        const globalIdx = startIdx + i;
        if (globalIdx >= bb.lower.length) continue;
        const l = bb.lower[globalIdx];
        if (l === null || isNaN(l)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(l);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      
      drawLine(bb.upper, '#a855f7', 1, [5, 3]);
      drawLine(bb.middle, '#a855f7', 1.5);
      drawLine(bb.lower, '#a855f7', 1, [5, 3]);
    }
    
    // EMAs
    if (indicatorValues.ema) drawLine(indicatorValues.ema, '#3b82f6', 1.5);
    if (indicatorValues.ema20) drawLine(indicatorValues.ema20, '#eab308', 1.5);
    if (indicatorValues.ema50) drawLine(indicatorValues.ema50, '#a855f7', 1.5);
    if (indicatorValues.ema200) drawLine(indicatorValues.ema200, '#ec4899', 1.5);
    
    // Ichimoku
    if (indicatorValues.ichimoku) {
      const ichi = indicatorValues.ichimoku;
      drawLine(ichi.tenkan, '#06b6d4', 1);
      drawLine(ichi.kijun, '#f97316', 1);
      
      // Cloud
      ctx.fillStyle = 'rgba(34, 197, 94, 0.1)';
      ctx.beginPath();
      let cloudStarted = false;
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= ichi.spanA.length - 26) continue;
        const a = ichi.spanA[globalIdx + 26];
        const b = ichi.spanB[globalIdx + 26];
        if (a === null || b === null || isNaN(a) || isNaN(b)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const yA = toY(a);
        const yB = toY(b);
        
        if (!cloudStarted) {
          ctx.moveTo(x, yA);
          cloudStarted = true;
        } else {
          ctx.lineTo(x, yA);
        }
      }
      for (let i = visibleCandles.length - 1; i >= 0; i--) {
        const globalIdx = startIdx + i;
        if (globalIdx >= ichi.spanB.length - 26) continue;
        const b = ichi.spanB[globalIdx + 26];
        if (b === null || isNaN(b)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const yB = toY(b);
        ctx.lineTo(x, yB);
      }
      ctx.closePath();
      ctx.fill();
    }
    
    // Candles
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      const isUp = c.close >= c.open;
      const color = isUp ? '#22c55e' : '#ef4444';
      
      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, toY(c.high));
      ctx.lineTo(x + candleWidth / 2, toY(c.low));
      ctx.stroke();
      
      // Body
      if (chartType === 'line') {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + candleWidth / 2, toY(c.close), 2, 0, Math.PI * 2);
        ctx.fill();
        
        if (i > 0) {
          const prev = visibleCandles[i - 1];
          ctx.strokeStyle = '#8B949E';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x - totalCandleW + candleWidth / 2, toY(prev.close));
          ctx.lineTo(x + candleWidth / 2, toY(c.close));
          ctx.stroke();
        }
      } else {
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyBottom = toY(Math.min(c.open, c.close));
        const bodyHeight = Math.max(1, bodyBottom - bodyTop);
        
        if (chartType === 'hollow' && isUp) {
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.strokeRect(x, bodyTop, candleWidth, bodyHeight);
        } else {
          ctx.fillStyle = color;
          ctx.fillRect(x, bodyTop, candleWidth, bodyHeight);
        }
      }
    }
    
    // Current price line
    const currentY = toY(currentPrice);
    ctx.strokeStyle = '#8B949E';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    ctx.moveTo(0, currentY);
    ctx.lineTo(chartW, currentY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Price label
    ctx.fillStyle = '#1F2937';
    ctx.fillRect(chartW, currentY - 10, priceAxisW, 20);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 11px JetBrains Mono';
    ctx.textAlign = 'left';
    ctx.fillText(currentPrice.toFixed(chartSettings.precision), chartW + 5, currentY + 4);
    
    // OHLC
    if (chartSettings.showOHLC && visibleCandles.length > 0) {
      const last = visibleCandles[visibleCandles.length - 1];
      ctx.fillStyle = '#8B949E';
      ctx.font = '11px JetBrains Mono';
      ctx.textAlign = 'left';
      ctx.fillText(`O: ${last.open.toFixed(chartSettings.precision)} H: ${last.high.toFixed(chartSettings.precision)} L: ${last.low.toFixed(chartSettings.precision)} C: ${last.close.toFixed(chartSettings.precision)}`, 20, 30);
    }
    
    // Crosshair
    if (chartSettings.crosshair && crosshairPos && crosshairPrice && crosshairTime) {
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 3]);
      
      ctx.beginPath();
      ctx.moveTo(crosshairPos.x, 0);
      ctx.lineTo(crosshairPos.x, chartH);
      ctx.stroke();
      
      ctx.beginPath();
      ctx.moveTo(0, crosshairPos.y);
      ctx.lineTo(chartW, crosshairPos.y);
      ctx.stroke();
      
      ctx.setLineDash([]);
      
      // Crosshair labels
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(chartW, crosshairPos.y - 10, priceAxisW, 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 11px JetBrains Mono';
      ctx.fillText(crosshairPrice.toFixed(chartSettings.precision), chartW + 5, crosshairPos.y + 4);
      
      const timeStr = new Date(crosshairTime * 1000).toLocaleTimeString();
      ctx.fillStyle = '#1F2937';
      ctx.fillRect(crosshairPos.x - 40, chartH + 2, 80, 20);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = '10px JetBrains Mono';
      ctx.fillText(timeStr, crosshairPos.x - 35, chartH + 16);
    }
    
    // ── Volume ──
    if (chartSettings.showVolume && indicatorValues.volume) {
      const volumeTop = chartH;
      const volumeH = volumeHeight;
      
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, volumeTop, W, volumeH);
      
      ctx.strokeStyle = '#30363D';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, volumeTop);
      ctx.lineTo(W, volumeTop);
      ctx.stroke();
      
      const maxVolume = Math.max(...tfVolumes.slice(startIdx, endIdx).filter(v => !isNaN(v)), 1);
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= tfVolumes.length) continue;
        
        const vol = tfVolumes[globalIdx] || 0;
        const isUp = visibleCandles[i].close >= visibleCandles[i].open;
        const x = offsetX + i * totalCandleW;
        const barH = (vol / maxVolume) * (volumeH - 20);
        
        ctx.fillStyle = isUp ? 'rgba(34, 197, 94, 0.5)' : 'rgba(239, 68, 68, 0.5)';
        ctx.fillRect(x, volumeTop + volumeH - barH - 5, candleWidth, barH);
      }
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '11px JetBrains Mono';
      ctx.fillText('Volume', 10, volumeTop + 20);
    }
    
    // ── RSI ──
    if (indicatorValues.rsi) {
      const rsiTop = chartH + volumeHeight;
      const rsiH = 80;
      
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, rsiTop, W, rsiH);
      
      ctx.strokeStyle = '#30363D';
      ctx.beginPath();
      ctx.moveTo(0, rsiTop);
      ctx.lineTo(W, rsiTop);
      ctx.stroke();
      
      // Levels
      [30, 50, 70].forEach(level => {
        const y = rsiTop + 4 + ((100 - level) / 100) * (rsiH - 8);
        ctx.strokeStyle = level === 50 ? '#4B5563' : (level === 70 ? '#ef444450' : '#22c55e50');
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#8B949E';
        ctx.fillText(level.toString(), chartW + 5, y + 3);
      });
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '11px JetBrains Mono';
      ctx.fillText('RSI(14)', 10, rsiTop + 20);
      
      // RSI line
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let rsiStarted = false;
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= indicatorValues.rsi.length) continue;
        
        const v = indicatorValues.rsi[globalIdx];
        if (v === null || isNaN(v)) {
          rsiStarted = false;
          continue;
        }
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = rsiTop + 4 + ((100 - v) / 100) * (rsiH - 8);
        
        if (!rsiStarted) {
          ctx.moveTo(x, y);
          rsiStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    
    // ── MACD ──
    if (indicatorValues.macd) {
      const macdTop = chartH + volumeHeight + (indicatorValues.rsi ? 80 : 0);
      const macdH = 100;
      const macd = indicatorValues.macd;
      
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, macdTop, W, macdH);
      
      ctx.strokeStyle = '#30363D';
      ctx.beginPath();
      ctx.moveTo(0, macdTop);
      ctx.lineTo(W, macdTop);
      ctx.stroke();
      
      // Zero line
      const zeroY = macdTop + macdH / 2;
      ctx.strokeStyle = '#4B5563';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(chartW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '11px JetBrains Mono';
      ctx.fillText('MACD(12,26,9)', 10, macdTop + 20);
      
      // Histogram
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= macd.histogram.length) continue;
        
        const hist = macd.histogram[globalIdx];
        if (hist === null || isNaN(hist)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2 - 2;
        const y = zeroY;
        const barH = (hist / (Math.max(...macd.histogram.filter(v => !isNaN(v))) || 1)) * (macdH / 2 - 10);
        
        ctx.fillStyle = hist >= 0 ? '#22c55e' : '#ef4444';
        ctx.fillRect(x, hist >= 0 ? y - barH : y, 4, barH);
      }
      
      // MACD line
      ctx.strokeStyle = '#a855f7';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let macdStarted = false;
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= macd.macd.length) continue;
        
        const v = macd.macd[globalIdx];
        if (v === null || isNaN(v)) {
          macdStarted = false;
          continue;
        }
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = zeroY - (v / (Math.max(...macd.macd.filter(v => !isNaN(v))) || 1)) * (macdH / 2 - 10);
        
        if (!macdStarted) {
          ctx.moveTo(x, y);
          macdStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      
      // Signal line
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1;
      ctx.beginPath();
      let signalStarted = false;
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= macd.signal.length) continue;
        
        const v = macd.signal[globalIdx];
        if (v === null || isNaN(v)) {
          signalStarted = false;
          continue;
        }
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = zeroY - (v / (Math.max(...macd.macd.filter(v => !isNaN(v))) || 1)) * (macdH / 2 - 10);
        
        if (!signalStarted) {
          ctx.moveTo(x, y);
          signalStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
    }
    
  }, [candles, indicatorValues, chartSettings, chartType, scrollOffset, candleWidth, crosshairPos, crosshairPrice, crosshairTime, tfVolumes, currentPrice]);

  // Mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setCrosshairPos({ x, y });
      
      // Calculate price and time
      const chartH = rect.height - (chartSettings.showVolume ? 80 : 0) - (indicatorValues.rsi ? 80 : 0) - (indicatorValues.macd ? 100 : 0);
      if (y < chartH && candles.length > 0) {
        const minPrice = Math.min(...candles.map(c => c.low));
        const maxPrice = Math.max(...candles.map(c => c.high));
        const priceRange = maxPrice - minPrice;
        const padding = priceRange * 0.05;
        const plotMin = minPrice - padding;
        const plotMax = maxPrice + padding;
        
        const priceY = y - 20;
        const chartHeight = chartH - 40;
        const price = plotMax - (priceY / chartHeight) * (plotMax - plotMin);
        setCrosshairPrice(price);
        
        // Time
        const gap = 1;
        const totalCandleW = candleWidth + gap;
        const visibleStart = Math.max(0, Math.min(candles.length - 10, scrollOffset));
        const candleIndex = visibleStart + Math.floor((x - 10) / totalCandleW);
        if (candleIndex >= 0 && candleIndex < candles.length) {
          setCrosshairTime(candles[candleIndex].time);
        }
      }
    };

    const onMouseLeave = () => {
      setCrosshairPos(null);
      setCrosshairPrice(null);
      setCrosshairTime(null);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        setCandleWidth(prev => Math.max(3, Math.min(20, prev - Math.sign(e.deltaY))));
      } else {
        const delta = Math.sign(e.deltaY) * 5;
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 20, prev + delta)));
      }
    };

    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [candles.length, scrollOffset, candleWidth, chartSettings.showVolume, indicatorValues]);

  const toggleIndicator = (id: string) => {
    setIndicators(prev => prev.map(ind => 
      ind.id === id ? { ...ind, enabled: !ind.enabled } : ind
    ));
  };

  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

  return (
    <div className="flex h-screen bg-[#0D1117] text-white">
      {/* Left Sidebar */}
      {showSidebar && (
        <div className="w-64 border-r border-[#30363D] flex flex-col">
          <div className="p-4 border-b border-[#30363D]">
            <h2 className="font-semibold">Markets</h2>
          </div>
          
          <div className="p-2">
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="bg-[#161B22] border-[#30363D] h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUPS.map(g => (
                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <ScrollArea className="flex-1">
            {filteredMarkets.map(m => (
              <button
                key={m.symbol}
                onClick={() => setSymbol(m.symbol)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-[#161B22] ${
                  symbol === m.symbol ? 'bg-[#1F2937] text-blue-400' : 'text-[#8B949E]'
                }`}
              >
                {m.name}
              </button>
            ))}
          </ScrollArea>
        </div>
      )}
      
      {/* Main Chart Area */}
      <div className="flex-1 flex flex-col">
        {/* Toolbar */}
        <div className="h-12 border-b border-[#30363D] flex items-center px-4 gap-4 bg-[#161B22]">
          <Button variant="ghost" size="icon" onClick={() => setShowSidebar(!showSidebar)}>
            <Layers className="h-4 w-4" />
          </Button>
          
          <Select value={chartType} onValueChange={setChartType}>
            <SelectTrigger className="w-32 h-8 bg-[#0D1117] border-[#30363D]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map(t => (
                <SelectItem key={t.value} value={t.value}>
                  <div className="flex items-center gap-2">
                    <t.icon className="h-4 w-4" />
                    {t.label}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <div className="flex gap-1">
            {TIMEFRAMES.map(tf => (
              <Button
                key={tf.value}
                size="sm"
                variant={timeframe === tf.value ? 'default' : 'ghost'}
                className="h-7 px-2 text-xs"
                onClick={() => setTimeframe(tf.value)}
              >
                {tf.label}
              </Button>
            ))}
          </div>
          
          <div className="flex-1" />
          
          <Badge variant="outline" className="font-mono text-sm border-[#30363D]">
            {currentPrice.toFixed(chartSettings.precision)}
          </Badge>
        </div>
        
        {/* Chart */}
        <div ref={containerRef} className="flex-1 relative">
          <canvas ref={canvasRef} className="w-full h-full cursor-crosshair" />
          
          {isLoading && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-2 border-blue-500 border-t-transparent" />
            </div>
          )}
        </div>
        
        {/* Bottom Panel */}
        <div className="h-[300px] border-t border-[#30363D] bg-[#161B22]">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full">
            <div className="px-4 pt-2 border-b border-[#30363D]">
              <TabsList className="bg-[#0D1117]">
                <TabsTrigger value="indicators">Indicators</TabsTrigger>
                <TabsTrigger value="trading">Trading</TabsTrigger>
                <TabsTrigger value="analysis">Analysis</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="indicators" className="p-4 overflow-auto h-[calc(100%-41px)]">
              <div className="grid grid-cols-4 gap-4">
                {['trend', 'oscillator', 'volatility', 'volume', 'custom'].map(section => (
                  <div key={section}>
                    <h3 className="text-sm font-semibold mb-2 capitalize">{section}</h3>
                    <div className="space-y-2">
                      {indicators.filter(i => i.section === section).map(ind => (
                        <div key={ind.id} className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={ind.enabled}
                              onCheckedChange={() => toggleIndicator(ind.id)}
                            />
                            <span style={{ color: ind.color }}>{ind.name}</span>
                          </div>
                          {ind.enabled && (
                            <Button variant="ghost" size="icon" className="h-6 w-6">
                              <Settings className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </TabsContent>
            
            <TabsContent value="trading" className="p-4 overflow-auto h-[calc(100%-41px)]">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-[#8B949E]">Contract</label>
                  <Select value={contractType} onValueChange={setContractType}>
                    <SelectTrigger className="bg-[#0D1117] border-[#30363D]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map(c => (
                        <SelectItem key={c.value} value={c.value}>
                          <div className="flex items-center gap-2">
                            <c.icon className="h-4 w-4" style={{ color: c.color }} />
                            {c.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-xs text-[#8B949E]">Duration</label>
                  <div className="flex gap-2">
                    <Input type="number" value={duration} onChange={e => setDuration(e.target.value)} 
                           className="bg-[#0D1117] border-[#30363D]" />
                    <Select value={durationUnit} onValueChange={setDurationUnit}>
                      <SelectTrigger className="w-20 bg-[#0D1117] border-[#30363D]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="t">Ticks</SelectItem>
                        <SelectItem value="m">Min</SelectItem>
                        <SelectItem value="h">Hour</SelectItem>
                        <SelectItem value="d">Day</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                <div>
                  <label className="text-xs text-[#8B949E]">Stake ($)</label>
                  <Input type="number" value={tradeStake} onChange={e => setTradeStake(e.target.value)}
                         className="bg-[#0D1117] border-[#30363D]" />
                </div>
              </div>
              
              {['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contractType) && (
                <div className="mt-4">
                  <label className="text-xs text-[#8B949E]">Digit</label>
                  <div className="grid grid-cols-10 gap-1 mt-1">
                    {Array.from({ length: 10 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => setPrediction(String(i))}
                        className={`h-8 rounded text-sm font-mono font-bold ${
                          prediction === String(i) 
                            ? 'bg-blue-600 text-white' 
                            : 'bg-[#0D1117] border border-[#30363D] text-[#8B949E]'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              <div className="flex gap-4 mt-4">
                <Button className="flex-1 bg-green-600 hover:bg-green-700">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Buy {contractType}
                </Button>
                <Button className="flex-1 bg-red-600 hover:bg-red-700">
                  <TrendingDown className="h-4 w-4 mr-2" />
                  Sell {contractType}
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="analysis" className="p-4 overflow-auto h-[calc(100%-41px)]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Digit Distribution</h3>
                  <div className="grid grid-cols-5 gap-2">
                    {Array.from({ length: 10 }, (_, d) => (
                      <div key={d} className="text-center p-2 bg-[#0D1117] rounded">
                        <div className="text-lg font-mono font-bold">{d}</div>
                        <div className="text-xs text-[#8B949E]">{frequency[d] || 0}x</div>
                        <div className="text-xs text-[#8B949E]">{percentages[d]?.toFixed(1)}%</div>
                      </div>
                    ))}
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-semibold mb-2">Statistics</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Even/Odd</span>
                      <span>{evenPct.toFixed(1)}% / {(100 - evenPct).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Over/Under</span>
                      <span>{overPct.toFixed(1)}% / {(100 - overPct).toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Most Common</span>
                      <span className="text-green-500">{mostCommon} ({percentages[mostCommon]?.toFixed(1)}%)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#8B949E]">Least Common</span>
                      <span className="text-red-500">{leastCommon} ({percentages[leastCommon]?.toFixed(1)}%)</span>
                    </div>
                  </div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="settings" className="p-4 overflow-auto h-[calc(100%-41px)]">
              <div className="space-y-4 max-w-md">
                <div className="flex items-center justify-between">
                  <span>Grid Lines</span>
                  <Switch checked={chartSettings.gridLines} 
                         onCheckedChange={v => setChartSettings(prev => ({ ...prev, gridLines: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <span>Crosshair</span>
                  <Switch checked={chartSettings.crosshair}
                         onCheckedChange={v => setChartSettings(prev => ({ ...prev, crosshair: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <span>Show Volume</span>
                  <Switch checked={chartSettings.showVolume}
                         onCheckedChange={v => setChartSettings(prev => ({ ...prev, showVolume: v }))} />
                </div>
                <div className="flex items-center justify-between">
                  <span>Show OHLC</span>
                  <Switch checked={chartSettings.showOHLC}
                         onCheckedChange={v => setChartSettings(prev => ({ ...prev, showOHLC: v }))} />
                </div>
                <div>
                  <label className="text-sm">Precision</label>
                  <Select value={String(chartSettings.precision)} 
                         onValueChange={v => setChartSettings(prev => ({ ...prev, precision: parseInt(v) }))}>
                    <SelectTrigger className="bg-[#0D1117] border-[#30363D]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 decimals</SelectItem>
                      <SelectItem value="3">3 decimals</SelectItem>
                      <SelectItem value="4">4 decimals</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-sm">Candle Width</label>
                  <Slider value={[candleWidth]} onValueChange={([v]) => setCandleWidth(v)} 
                         min={3} max={20} step={1} className="mt-2" />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
