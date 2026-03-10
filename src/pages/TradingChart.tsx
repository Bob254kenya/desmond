import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit, analyzeDigits, calculateRSI, calculateMACD, calculateBollingerBands } from '@/services/analysis';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
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
  Star, Heart, Crown, Diamond, CircleDollarSign, Coins, Bitcoin, Wallet,
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

interface DrawingTool {
  id: string;
  type: 'horizontal' | 'vertical' | 'trend' | 'fib' | 'rectangle' | 'text';
  points: { x: number; y: number }[];
  color: string;
  text?: string;
}

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
  { value: '3m', label: '3m', seconds: 180 },
  { value: '5m', label: '5m', seconds: 300 },
  { value: '15m', label: '15m', seconds: 900 },
  { value: '30m', label: '30m', seconds: 1800 },
  { value: '1h', label: '1h', seconds: 3600 },
  { value: '4h', label: '4h', seconds: 14400 },
  { value: '12h', label: '12h', seconds: 43200 },
  { value: '1d', label: '1d', seconds: 86400 },
];

const CHART_TYPES = [
  { value: 'candles', label: 'Candles', icon: ChartCandlestick },
  { value: 'bars', label: 'Bars', icon: ChartBar },
  { value: 'line', label: 'Line', icon: ChartLine },
  { value: 'area', label: 'Area', icon: ChartArea },
  { value: 'hollow', label: 'Hollow', icon: ChartSpline },
  { value: 'heikin-ashi', label: 'Heikin Ashi', icon: ChartNoAxesColumn },
];

const CONTRACT_TYPES = [
  { value: 'CALL', label: 'Rise', icon: TrendingUp, color: '#3FB950' },
  { value: 'PUT', label: 'Fall', icon: TrendingDown, color: '#F85149' },
  { value: 'DIGITMATCH', label: 'Digits Match', icon: Target, color: '#D29922' },
  { value: 'DIGITDIFF', label: 'Digits Differs', icon: Crosshair, color: '#BC8CFF' },
  { value: 'DIGITEVEN', label: 'Digits Even', icon: Activity, color: '#58A6FF' },
  { value: 'DIGITODD', label: 'Digits Odd', icon: Gauge, color: '#F778BA' },
  { value: 'DIGITOVER', label: 'Digits Over', icon: ArrowUp, color: '#7EE3B8' },
  { value: 'DIGITUNDER', label: 'Digits Under', icon: ArrowDown, color: '#FFA28B' },
];

/* ── All Deriv Indicators ── */
const ALL_INDICATORS: Indicator[] = [
  // Trend Indicators
  { id: 'ema', name: 'EMA', enabled: true, color: '#2F81F7', params: { period: 50, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'sma', name: 'SMA', enabled: true, color: '#E6B422', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'wma', name: 'WMA', enabled: false, color: '#F78166', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'hma', name: 'Hull MA', enabled: false, color: '#7EE3B8', params: { period: 20, source: 'close' }, type: 'overlay', section: 'trend' },
  { id: 'vwap', name: 'VWAP', enabled: false, color: '#F778BA', params: { period: 20 }, type: 'overlay', section: 'trend' },
  { id: 'ichimoku', name: 'Ichimoku', enabled: false, color: '#8957E5', params: { conversion: 9, base: 26, span: 52 }, type: 'overlay', section: 'trend' },
  { id: 'parabolic_sar', name: 'Parabolic SAR', enabled: false, color: '#F0883E', params: { step: 0.02, max: 0.2 }, type: 'overlay', section: 'trend' },
  
  // Oscillators
  { id: 'rsi', name: 'RSI', enabled: true, color: '#D29922', params: { period: 14, source: 'close' }, type: 'oscillator', section: 'oscillator' },
  { id: 'macd', name: 'MACD', enabled: true, color: '#BC8CFF', params: { fast: 12, slow: 26, signal: 9 }, type: 'oscillator', section: 'oscillator' },
  { id: 'stoch', name: 'Stochastic', enabled: false, color: '#3FB950', params: { k: 14, d: 3, smooth: 3 }, type: 'oscillator', section: 'oscillator' },
  { id: 'cci', name: 'CCI', enabled: false, color: '#F85149', params: { period: 20 }, type: 'oscillator', section: 'oscillator' },
  { id: 'williams_r', name: 'Williams %R', enabled: false, color: '#58A6FF', params: { period: 14 }, type: 'oscillator', section: 'oscillator' },
  { id: 'awesome', name: 'Awesome Osc', enabled: false, color: '#BC8CFF', params: { fast: 5, slow: 34 }, type: 'oscillator', section: 'oscillator' },
  { id: 'momentum', name: 'Momentum', enabled: false, color: '#D29922', params: { period: 10 }, type: 'oscillator', section: 'oscillator' },
  
  // Volatility
  { id: 'bb', name: 'Bollinger Bands', enabled: true, color: '#BC8CFF', params: { period: 20, std: 2 }, type: 'overlay', section: 'volatility' },
  { id: 'keltner', name: 'Keltner Channels', enabled: false, color: '#F778BA', params: { period: 20, multiplier: 2, atr: 10 }, type: 'overlay', section: 'volatility' },
  { id: 'donchian', name: 'Donchian Channels', enabled: false, color: '#7EE3B8', params: { period: 20 }, type: 'overlay', section: 'volatility' },
  { id: 'atr', name: 'ATR', enabled: false, color: '#F85149', params: { period: 14 }, type: 'oscillator', section: 'volatility' },
  { id: 'stddev', name: 'Std Deviation', enabled: false, color: '#8957E5', params: { period: 20 }, type: 'oscillator', section: 'volatility' },
  { id: 'channels', name: 'Price Channels', enabled: false, color: '#F0883E', params: { period: 20 }, type: 'overlay', section: 'volatility' },
  
  // Volume
  { id: 'volume', name: 'Volume', enabled: true, color: '#58A6FF', params: {}, type: 'volume', section: 'volume' },
  { id: 'obv', name: 'OBV', enabled: false, color: '#3FB950', params: { type: 'simple' }, type: 'volume', section: 'volume' },
  { id: 'mfi', name: 'MFI', enabled: false, color: '#F778BA', params: { period: 14 }, type: 'volume', section: 'volume' },
  { id: 'vwap_volume', name: 'VWAP Volume', enabled: false, color: '#BC8CFF', params: { period: 20 }, type: 'volume', section: 'volume' },
  { id: 'cvd', name: 'CVD', enabled: false, color: '#D29922', params: { period: 20 }, type: 'volume', section: 'volume' },
  
  // Custom Deriv-specific
  { id: 'digit_trend', name: 'Digit Trend', enabled: false, color: '#FF7B72', params: { period: 26 }, type: 'overlay', section: 'custom' },
  { id: 'even_odd', name: 'Even/Odd Ratio', enabled: false, color: '#7EE3B8', params: { period: 100 }, type: 'oscillator', section: 'custom' },
  { id: 'over_under', name: 'Over/Under', enabled: false, color: '#F778BA', params: { period: 100 }, type: 'oscillator', section: 'custom' },
  { id: 'hot_cold', name: 'Hot/Cold Digits', enabled: false, color: '#F0883E', params: { period: 50 }, type: 'oscillator', section: 'custom' },
];

/* ── Candle builder ── */
interface Candle {
  open: number; high: number; low: number; close: number; time: number;
}

function buildCandles(prices: number[], times: number[], tf: string): Candle[] {
  if (prices.length === 0) return [];
  const tfMap = Object.fromEntries(TIMEFRAMES.map(t => [t.value, t.seconds]));
  const interval = tfMap[tf] || 60;
  const candles: Candle[] = [];
  let current: Candle | null = null;

  for (let i = 0; i < prices.length; i++) {
    const p = prices[i];
    const t = times[i] || Date.now()/1000 + i;
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

/* ── Heikin Ashi Candles ── */
function buildHeikinAshi(candles: Candle[]): Candle[] {
  if (candles.length === 0) return [];
  const ha: Candle[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      ha.push({ ...candles[i] });
      continue;
    }
    
    const prev = ha[i - 1];
    const curr = candles[i];
    
    const haClose = (curr.open + curr.high + curr.low + curr.close) / 4;
    const haOpen = (prev.open + prev.close) / 2;
    const haHigh = Math.max(curr.high, haOpen, haClose);
    const haLow = Math.min(curr.low, haOpen, haClose);
    
    ha.push({ open: haOpen, high: haHigh, low: haLow, close: haClose, time: curr.time });
  }
  
  return ha;
}

/* ── Hollow Candles ── */
function isHollowBullish(open: number, close: number): boolean {
  return close > open;
}

/* ── Indicator Calculations ── */
function calcEMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  if (prices.length < period) return prices.map(() => NaN);
  
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else if (i === period - 1) {
      result.push(ema);
    } else {
      ema = prices[i] * k + ema * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function calcSMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function calcWMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
    } else {
      let sum = 0;
      let weightSum = 0;
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

function calcHMA(prices: number[], period: number): number[] {
  const half = Math.floor(period / 2);
  const sqrt = Math.floor(Math.sqrt(period));
  
  const wmaHalf = calcWMA(prices, half);
  const wmaFull = calcWMA(prices, period);
  const diff = wmaHalf.map((v, i) => 2 * v - (wmaFull[i] || 0));
  
  return calcWMA(diff, sqrt);
}

function calcVWAP(prices: number[], volumes: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      result.push(NaN);
    } else {
      let sumPV = 0;
      let sumV = 0;
      for (let j = 0; j < period; j++) {
        sumPV += prices[i - j] * (volumes[i - j] || 1);
        sumV += (volumes[i - j] || 1);
      }
      result.push(sumPV / sumV);
    }
  }
  return result;
}

function calcIchimoku(candles: Candle[]): {
  tenkan: number[];
  kijun: number[];
  senkouA: number[];
  senkouB: number[];
  chikou: number[];
} {
  const tenkan: number[] = [];
  const kijun: number[] = [];
  const senkouA: number[] = [];
  const senkouB: number[] = [];
  const chikou: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    // Tenkan-sen (Conversion Line): (9-period high + 9-period low)/2
    if (i >= 8) {
      const high9 = Math.max(...candles.slice(i - 8, i + 1).map(c => c.high));
      const low9 = Math.min(...candles.slice(i - 8, i + 1).map(c => c.low));
      tenkan.push((high9 + low9) / 2);
    } else {
      tenkan.push(NaN);
    }
    
    // Kijun-sen (Base Line): (26-period high + 26-period low)/2
    if (i >= 25) {
      const high26 = Math.max(...candles.slice(i - 25, i + 1).map(c => c.high));
      const low26 = Math.min(...candles.slice(i - 25, i + 1).map(c => c.low));
      kijun.push((high26 + low26) / 2);
    } else {
      kijun.push(NaN);
    }
    
    // Senkou Span A (Leading Span A): (Tenkan + Kijun)/2, shifted forward 26 periods
    if (i >= 25) {
      senkouA.push((tenkan[i] + kijun[i]) / 2);
    } else {
      senkouA.push(NaN);
    }
    
    // Senkou Span B (Leading Span B): (52-period high + 52-period low)/2, shifted forward 26 periods
    if (i >= 51) {
      const high52 = Math.max(...candles.slice(i - 51, i + 1).map(c => c.high));
      const low52 = Math.min(...candles.slice(i - 51, i + 1).map(c => c.low));
      senkouB.push((high52 + low52) / 2);
    } else {
      senkouB.push(NaN);
    }
    
    // Chikou Span (Lagging Span): Current closing price, shifted backward 26 periods
    chikou.push(candles[i].close);
  }
  
  return { tenkan, kijun, senkouA, senkouB, chikou };
}

function calcParabolicSAR(candles: Candle[], step: number = 0.02, max: number = 0.2): number[] {
  const sar: number[] = [];
  let trend: 'up' | 'down' = 'up';
  let ep = candles[0].high; // Extreme point
  let af = step; // Acceleration factor
  let currentSar = candles[0].low;
  
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      sar.push(NaN);
      continue;
    }
    
    const prev = candles[i - 1];
    const curr = candles[i];
    
    if (trend === 'up') {
      currentSar = currentSar + af * (ep - currentSar);
      
      if (curr.low < currentSar) {
        trend = 'down';
        currentSar = ep;
        ep = curr.low;
        af = step;
      } else {
        if (curr.high > ep) {
          ep = curr.high;
          af = Math.min(af + step, max);
        }
      }
    } else {
      currentSar = currentSar - af * (currentSar - ep);
      
      if (curr.high > currentSar) {
        trend = 'up';
        currentSar = ep;
        ep = curr.high;
        af = step;
      } else {
        if (curr.low < ep) {
          ep = curr.low;
          af = Math.min(af + step, max);
        }
      }
    }
    
    sar.push(currentSar);
  }
  
  return sar;
}

function calcStoch(candles: Candle[], kPeriod: number = 14, dPeriod: number = 3, smooth: number = 3): { k: number[], d: number[] } {
  const k: number[] = [];
  const d: number[] = [];
  
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
    
    if (i >= kPeriod + smooth - 2) {
      const kSlice = k.slice(i - smooth + 1, i + 1);
      const dRaw = kSlice.reduce((a, b) => a + b, 0) / smooth;
      d.push(dRaw);
    } else {
      d.push(NaN);
    }
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

function calcAwesomeOsc(candles: Candle[], fast: number = 5, slow: number = 34): number[] {
  const ao: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < slow - 1) {
      ao.push(NaN);
      continue;
    }
    
    const mp = (candles[i].high + candles[i].low) / 2;
    
    let fastSum = 0;
    for (let j = 0; j < fast; j++) {
      fastSum += (candles[i - j].high + candles[i - j].low) / 2;
    }
    const fastMA = fastSum / fast;
    
    let slowSum = 0;
    for (let j = 0; j < slow; j++) {
      slowSum += (candles[i - j].high + candles[i - j].low) / 2;
    }
    const slowMA = slowSum / slow;
    
    ao.push(fastMA - slowMA);
  }
  
  return ao;
}

function calcMomentum(prices: number[], period: number = 10): number[] {
  const momentum: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period) {
      momentum.push(NaN);
    } else {
      momentum.push(prices[i] - prices[i - period]);
    }
  }
  
  return momentum;
}

function calcKeltner(candles: Candle[], period: number = 20, multiplier: number = 2, atrPeriod: number = 10): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  
  const ema = calcEMA(candles.map(c => c.close), period);
  const atr = calcATR(candles, atrPeriod);
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      const mid = ema[i];
      const atrValue = atr[i] || 0;
      upper.push(mid + multiplier * atrValue);
      middle.push(mid);
      lower.push(mid - multiplier * atrValue);
    }
  }
  
  return { upper, middle, lower };
}

function calcDonchian(candles: Candle[], period: number = 20): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];
  
  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
    } else {
      const periodCandles = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...periodCandles.map(c => c.high));
      const low = Math.min(...periodCandles.map(c => c.low));
      
      upper.push(high);
      lower.push(low);
      middle.push((high + low) / 2);
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
    
    if (i < period) {
      atr.push(NaN);
    } else if (i === period) {
      let sum = 0;
      for (let j = 1; j <= period; j++) {
        const prev = candles[i - j];
        const curr = candles[i - j + 1];
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

function calcStdDev(prices: number[], period: number = 20): number[] {
  const stddev: number[] = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      stddev.push(NaN);
    } else {
      const slice = prices.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
      stddev.push(Math.sqrt(variance));
    }
  }
  
  return stddev;
}

function calcOBV(prices: number[], volumes: number[]): number[] {
  const obv: number[] = [volumes[0] || 0];
  
  for (let i = 1; i < prices.length; i++) {
    if (prices[i] > prices[i - 1]) {
      obv.push(obv[i - 1] + (volumes[i] || 0));
    } else if (prices[i] < prices[i - 1]) {
      obv.push(obv[i - 1] - (volumes[i] || 0));
    } else {
      obv.push(obv[i - 1]);
    }
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
    
    let positiveFlow = 0;
    let negativeFlow = 0;
    
    for (let j = 0; j < period; j++) {
      const idx = i - j;
      const tp = (candles[idx].high + candles[idx].low + candles[idx].close) / 3;
      const rawMoneyFlow = tp * (candles[idx].volume || 1);
      
      if (idx > 0) {
        const prevTP = (candles[idx - 1].high + candles[idx - 1].low + candles[idx - 1].close) / 3;
        if (tp > prevTP) {
          positiveFlow += rawMoneyFlow;
        } else {
          negativeFlow += rawMoneyFlow;
        }
      }
    }
    
    const moneyRatio = positiveFlow / negativeFlow;
    mfi.push(100 - (100 / (1 + moneyRatio)));
  }
  
  return mfi;
}

function calcCVD(prices: number[], volumes: number[], period: number = 20): number[] {
  const cvd: number[] = [0];
  
  for (let i = 1; i < prices.length; i++) {
    const delta = prices[i] - prices[i - 1];
    const volumeDelta = (volumes[i] || 0) * Math.sign(delta);
    cvd.push(cvd[i - 1] + volumeDelta);
  }
  
  return cvd;
}

function calcDigitTrend(digits: number[], period: number = 26): number[] {
  const trend: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      trend.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const evens = slice.filter(d => d % 2 === 0).length;
      const odds = period - evens;
      const ratio = (evens - odds) / period * 100;
      trend.push(ratio);
    }
  }
  
  return trend;
}

function calcEvenOddRatio(digits: number[], period: number = 100): number[] {
  const ratio: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      ratio.push(NaN);
    } else {
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
    if (i < period) {
      ratio.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const over = slice.filter(d => d > 4).length;
      ratio.push((over / period) * 100);
    }
  }
  
  return ratio;
}

function calcHotCold(digits: number[], period: number = 50): { hot: number[], cold: number[] } {
  const hot: number[] = [];
  const cold: number[] = [];
  
  for (let i = 0; i < digits.length; i++) {
    if (i < period) {
      hot.push(NaN);
      cold.push(NaN);
    } else {
      const slice = digits.slice(i - period + 1, i + 1);
      const freq = Array(10).fill(0);
      slice.forEach(d => freq[d]++);
      
      const maxFreq = Math.max(...freq);
      const minFreq = Math.min(...freq);
      
      hot.push((maxFreq / period) * 100);
      cold.push((minFreq / period) * 100);
    }
  }
  
  return { hot, cold };
}

/* ── Interface for props ── */
interface TradeRecord {
  id: string;
  time: number;
  type: string;
  stake: number;
  profit: number;
  status: 'won' | 'lost' | 'open';
  symbol: string;
}

export default function TradingChart() {
  const { isAuthorized } = useAuth();
  
  // Chart State
  const [symbol, setSymbol] = useState('R_100');
  const [groupFilter, setGroupFilter] = useState('all');
  const [timeframe, setTimeframe] = useState('1m');
  const [chartType, setChartType] = useState('candles');
  const [prices, setPrices] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [volumes, setVolumes] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const subscribedRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  // Indicators
  const [indicators, setIndicators] = useState<Indicator[]>(ALL_INDICATORS);
  const [showIndicatorPanel, setShowIndicatorPanel] = useState(true);
  const [selectedIndicatorSection, setSelectedIndicatorSection] = useState('trend');
  
  // Chart Settings
  const [chartSettings, setChartSettings] = useState({
    gridLines: true,
    crosshair: true,
    showVolume: true,
    showOHLC: true,
    showTicker: true,
    precision: 4,
    theme: 'dark',
    colors: {
      bg: '#0D1117',
      grid: '#21262D',
      text: '#E6EDF3',
      up: '#3FB950',
      down: '#F85149',
      volume: '#58A6FF',
      crosshair: '#FFFFFF',
    },
  });
  
  // Zoom & pan
  const [candleWidth, setCandleWidth] = useState(7);
  const [scrollOffset, setScrollOffset] = useState(0);
  const isDragging = useRef(false);
  const dragStartX = useRef(0);
  const dragStartOffset = useRef(0);
  const isPriceAxisDragging = useRef(false);
  const priceAxisStartY = useRef(0);
  const priceAxisStartWidth = useRef(7);
  
  // Crosshair
  const [crosshairPos, setCrosshairPos] = useState<{ x: number; y: number } | null>(null);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);
  const [crosshairTime, setCrosshairTime] = useState<number | null>(null);
  
  // Drawing tools
  const [drawingMode, setDrawingMode] = useState<string | null>(null);
  const [drawings, setDrawings] = useState<DrawingTool[]>([]);
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  
  // Layout
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [activeTab, setActiveTab] = useState('chart');
  
  // Trade panel
  const [contractType, setContractType] = useState('CALL');
  const [prediction, setPrediction] = useState('5');
  const [duration, setDuration] = useState('1');
  const [durationUnit, setDurationUnit] = useState('t');
  const [tradeStake, setTradeStake] = useState('1.00');
  const [selectedDigit, setSelectedDigit] = useState<number | null>(null);
  const [isTrading, setIsTrading] = useState(false);
  
  // Trade history
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const lastSpokenSignal = useRef('');
  
  // Auto Bot
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
  
  /* ── Load history + subscribe ── */
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
        setVolumes(hist.history.prices?.map(() => Math.random() * 100) || []); // Mock volumes
        setScrollOffset(0);
        setIsLoading(false);

        if (!subscribedRef.current) {
          subscribedRef.current = true;
          await derivApi.subscribeTicks(symbol as MarketSymbol, (data: any) => {
            if (!active || !data.tick) return;
            setPrices(prev => [...prev, data.tick.quote].slice(-5000));
            setTimes(prev => [...prev, data.tick.epoch].slice(-5000));
            setVolumes(prev => [...prev, Math.random() * 100].slice(-5000));
          });
        }
      } catch (err) {
        console.error(err);
        setIsLoading(false);
      }
    };
    load();
    return () => {
      active = false;
      derivApi.unsubscribeTicks(symbol as MarketSymbol).catch(() => {});
    };
  }, [symbol]);

  /* ── Derived data ── */
  const tfPrices = useMemo(() => prices.slice(-1000), [prices]);
  const tfTimes = useMemo(() => times.slice(-1000), [times]);
  const tfVolumes = useMemo(() => volumes.slice(-1000), [volumes]);
  
  const rawCandles = useMemo(() => buildCandles(tfPrices, tfTimes, timeframe), [tfPrices, tfTimes, timeframe]);
  
  const candles = useMemo(() => {
    if (chartType === 'heikin-ashi') {
      return buildHeikinAshi(rawCandles);
    }
    return rawCandles;
  }, [rawCandles, chartType]);
  
  const currentPrice = prices[prices.length - 1] || 0;
  const lastDigit = getLastDigit(currentPrice);
  const digits = useMemo(() => tfPrices.map(getLastDigit), [tfPrices]);
  const last26 = useMemo(() => digits.slice(-26), [digits]);
  const { frequency, percentages, mostCommon, leastCommon } = useMemo(() => analyzeDigits(tfPrices), [tfPrices]);

  // Calculate all indicator values
  const indicatorValues = useMemo(() => {
    const values: Record<string, any> = {};
    
    indicators.forEach(ind => {
      if (!ind.enabled) return;
      
      try {
        switch (ind.id) {
          case 'ema':
            values.ema = calcEMA(tfPrices, ind.params.period);
            break;
          case 'sma':
            values.sma = calcSMA(tfPrices, ind.params.period);
            break;
          case 'wma':
            values.wma = calcWMA(tfPrices, ind.params.period);
            break;
          case 'hma':
            values.hma = calcHMA(tfPrices, ind.params.period);
            break;
          case 'vwap':
            values.vwap = calcVWAP(tfPrices, tfVolumes, ind.params.period);
            break;
          case 'ichimoku':
            values.ichimoku = calcIchimoku(candles);
            break;
          case 'parabolic_sar':
            values.parabolicSar = calcParabolicSAR(candles, ind.params.step, ind.params.max);
            break;
          case 'rsi':
            values.rsi = calculateRSI(tfPrices, ind.params.period);
            break;
          case 'macd':
            values.macd = calculateMACD(tfPrices, ind.params.fast, ind.params.slow, ind.params.signal);
            break;
          case 'stoch':
            values.stoch = calcStoch(candles, ind.params.k, ind.params.d, ind.params.smooth);
            break;
          case 'cci':
            values.cci = calcCCI(candles, ind.params.period);
            break;
          case 'williams_r':
            values.williamsR = calcWilliamsR(candles, ind.params.period);
            break;
          case 'awesome':
            values.awesome = calcAwesomeOsc(candles, ind.params.fast, ind.params.slow);
            break;
          case 'momentum':
            values.momentum = calcMomentum(tfPrices, ind.params.period);
            break;
          case 'bb':
            values.bb = calculateBollingerBands(tfPrices, ind.params.period, ind.params.std);
            break;
          case 'keltner':
            values.keltner = calcKeltner(candles, ind.params.period, ind.params.multiplier, ind.params.atr);
            break;
          case 'donchian':
            values.donchian = calcDonchian(candles, ind.params.period);
            break;
          case 'atr':
            values.atr = calcATR(candles, ind.params.period);
            break;
          case 'stddev':
            values.stddev = calcStdDev(tfPrices, ind.params.period);
            break;
          case 'obv':
            values.obv = calcOBV(tfPrices, tfVolumes);
            break;
          case 'mfi':
            values.mfi = calcMFI(candles, ind.params.period);
            break;
          case 'cvd':
            values.cvd = calcCVD(tfPrices, tfVolumes, ind.params.period);
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
          case 'hot_cold':
            values.hotCold = calcHotCold(digits, ind.params.period);
            break;
        }
      } catch (e) {
        console.error(`Error calculating ${ind.id}:`, e);
      }
    });
    
    return values;
  }, [indicators, tfPrices, tfVolumes, candles, digits]);

  // Digit stats
  const evenCount = useMemo(() => digits.filter(d => d % 2 === 0).length, [digits]);
  const oddCount = digits.length - evenCount;
  const evenPct = digits.length > 0 ? (evenCount / digits.length * 100) : 50;
  const oddPct = 100 - evenPct;
  const overCount = useMemo(() => digits.filter(d => d > 4).length, [digits]);
  const underCount = digits.length - overCount;
  const overPct = digits.length > 0 ? (overCount / digits.length * 100) : 50;
  const underPct = 100 - overPct;

  // BB position
  const bb = indicatorValues.bb || { upper: 0, middle: 0, lower: 0 };
  const bbRange = bb.upper - bb.lower || 1;
  const bbPosition = ((currentPrice - bb.lower) / bbRange * 100);

  /* ── Canvas Chart ── */
  // Map candles to pixel positions
  const getCandleX = useCallback((index: number): number => {
    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const visibleCandles = candles.slice(
      Math.max(0, Math.min(candles.length - 10, scrollOffset)),
      Math.min(candles.length, scrollOffset + Math.floor((canvasRef.current?.width || 800) / totalCandleW))
    );
    const visibleStart = Math.max(0, Math.min(candles.length - 10, scrollOffset));
    return 5 + (index - visibleStart) * totalCandleW;
  }, [candles.length, scrollOffset, candleWidth]);

  const getCandleY = useCallback((price: number, chartHeight: number, minP: number, maxP: number): number => {
    const range = maxP - minP || 1;
    return 20 + ((maxP - price) / range) * (chartHeight - 40);
  }, []);

  // Canvas mouse handlers
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        setCandleWidth(prev => Math.max(2, Math.min(30, prev - Math.sign(e.deltaY))));
      } else {
        const delta = Math.sign(e.deltaY) * Math.max(3, Math.floor(candles.length * 0.03));
        setScrollOffset(prev => Math.max(0, Math.min(candles.length - 10, prev + delta)));
      }
    };

    const onMouseDown = (e: MouseEvent) => {
      const canvasRect = canvas.getBoundingClientRect();
      const pAxisX = canvasRect.width - 80;
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
      const canvasRect = canvas.getBoundingClientRect();
      const localX = e.clientX - canvasRect.left;
      const localY = e.clientY - canvasRect.top;
      
      if (isPriceAxisDragging.current) {
        const dy = priceAxisStartY.current - e.clientY;
        const newWidth = Math.max(2, Math.min(30, priceAxisStartWidth.current + Math.round(dy / 8)));
        setCandleWidth(newWidth);
        return;
      }
      
      if (isDragging.current) {
        const dx = dragStartX.current - e.clientX;
        const candlesPerPx = 1 / (candleWidth + 1);
        const delta = Math.round(dx * candlesPerPx);
        setScrollOffset(Math.max(0, Math.min(candles.length - 10, dragStartOffset.current + delta)));
      } else if (chartSettings.crosshair) {
        // Update crosshair position
        setCrosshairPos({ x: localX, y: localY });
        
        // Find price and time at crosshair
        const chartH = canvasRect.height - (indicatorValues.rsi ? 100 : 0) - (indicatorValues.macd ? 120 : 0);
        
        if (localY < chartH && candles.length > 0) {
          // Price calculation
          const allPrices = candles.flatMap(c => [c.high, c.low]);
          const rawMin = Math.min(...allPrices);
          const rawMax = Math.max(...allPrices);
          const priceRange = rawMax - rawMin;
          const padding = priceRange * 0.08;
          const minP = rawMin - padding;
          const maxP = rawMax + padding;
          
          const priceY = localY - 20;
          const chartHeight = chartH - 40;
          const priceAtY = maxP - (priceY / chartHeight) * (maxP - minP);
          setCrosshairPrice(priceAtY);
          
          // Time calculation
          const gap = 1;
          const totalCandleW = candleWidth + gap;
          const visibleStart = Math.max(0, Math.min(candles.length - 10, scrollOffset));
          const candleIndex = visibleStart + Math.floor((localX - 5) / totalCandleW);
          
          if (candleIndex >= 0 && candleIndex < candles.length) {
            setCrosshairTime(candles[candleIndex].time);
          }
        }
      }
    };

    const onMouseUp = () => {
      isDragging.current = false;
      isPriceAxisDragging.current = false;
      canvas.style.cursor = 'crosshair';
    };

    const onMouseLeave = () => {
      setCrosshairPos(null);
      setCrosshairPrice(null);
      setCrosshairTime(null);
    };

    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);

    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [candles.length, scrollOffset, candleWidth, indicatorValues, chartSettings.crosshair]);

  // Draw chart
  useEffect(() => {
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
    const H = rect.height;
    
    // Calculate indicator heights
    let oscillatorHeight = 0;
    let volumeHeight = 0;
    
    if (indicatorValues.rsi || indicatorValues.macd || indicatorValues.stoch) {
      oscillatorHeight = 100;
    }
    if (chartSettings.showVolume && indicatorValues.volume) {
      volumeHeight = 80;
    }
    
    const chartH = H - oscillatorHeight - volumeHeight;
    const priceAxisW = 80;
    const chartW = W - priceAxisW;
    
    // Clear
    ctx.fillStyle = chartSettings.colors.bg;
    ctx.fillRect(0, 0, W, H);
    
    // ── Visible candles ──
    const gap = 1;
    const totalCandleW = candleWidth + gap;
    const maxVisible = Math.floor(chartW / totalCandleW);
    const endIdx = candles.length - scrollOffset;
    const startIdx = Math.max(0, endIdx - maxVisible);
    const visibleCandles = candles.slice(startIdx, endIdx);
    
    if (visibleCandles.length < 1) return;
    
    // ── Price scale ──
    const allPrices = visibleCandles.flatMap(c => [c.high, c.low]);
    
    // Add indicator values for proper scaling
    Object.values(indicatorValues).forEach(val => {
      if (Array.isArray(val)) {
        val.slice(startIdx, endIdx).forEach(v => {
          if (typeof v === 'number' && !isNaN(v)) allPrices.push(v);
        });
      } else if (val && typeof val === 'object') {
        Object.values(val).forEach(arr => {
          if (Array.isArray(arr)) {
            arr.slice(startIdx, endIdx).forEach(v => {
              if (typeof v === 'number' && !isNaN(v)) allPrices.push(v);
            });
          }
        });
      }
    });
    
    const rawMin = Math.min(...allPrices);
    const rawMax = Math.max(...allPrices);
    const priceRange = rawMax - rawMin;
    const padding = priceRange * 0.08 || 0.001;
    const minP = rawMin - padding;
    const maxP = rawMax + padding;
    const range = maxP - minP || 1;
    
    const chartPadTop = 20;
    const chartPadBot = 20;
    const drawH = chartH - chartPadTop - chartPadBot;
    
    const toY = (p: number) => chartPadTop + ((maxP - p) / range) * drawH;
    const offsetX = 5;
    
    // ── Grid ──
    if (chartSettings.gridLines) {
      ctx.strokeStyle = chartSettings.colors.grid;
      ctx.lineWidth = 0.5;
      
      // Horizontal grid
      const gridSteps = 8;
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillStyle = '#484F58';
      
      for (let i = 0; i <= gridSteps; i++) {
        const y = chartPadTop + (i / gridSteps) * drawH;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        
        const pLabel = maxP - (i / gridSteps) * range;
        ctx.fillText(pLabel.toFixed(chartSettings.precision), chartW + 4, y + 3);
      }
      
      // Vertical grid
      for (let i = 0; i < 10; i++) {
        const x = (chartW / 10) * i;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, chartH);
        ctx.stroke();
      }
    }
    
    // ── Draw Indicators (Overlays) ──
    const drawLine = (values: (number | null)[], color: string, width: number, dash: number[] = []) => {
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
    
    // Draw Bollinger Bands
    if (indicatorValues.bb && indicators.find(i => i.id === 'bb')?.enabled) {
      const bb = indicatorValues.bb;
      
      // BB fill
      ctx.fillStyle = 'rgba(188, 140, 255, 0.06)';
      ctx.beginPath();
      
      let firstPoint = true;
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= bb.upper.length) continue;
        
        const u = bb.upper[globalIdx];
        const l = bb.lower[globalIdx];
        if (u === null || l === null || isNaN(u) || isNaN(l)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const yU = toY(u);
        const yL = toY(l);
        
        if (firstPoint) {
          ctx.moveTo(x, yU);
          firstPoint = false;
        } else {
          ctx.lineTo(x, yU);
        }
      }
      
      for (let i = visibleCandles.length - 1; i >= 0; i--) {
        const globalIdx = startIdx + i;
        if (globalIdx >= bb.lower.length) continue;
        
        const l = bb.lower[globalIdx];
        if (l === null || isNaN(l)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const yL = toY(l);
        ctx.lineTo(x, yL);
      }
      
      ctx.closePath();
      ctx.fill();
      
      // BB lines
      drawLine(bb.upper, '#BC8CFF', 1.2, [5, 3]);
      drawLine(bb.middle, '#BC8CFF', 1.5);
      drawLine(bb.lower, '#BC8CFF', 1.2, [5, 3]);
    }
    
    // Draw Keltner Channels
    if (indicatorValues.keltner && indicators.find(i => i.id === 'keltner')?.enabled) {
      const keltner = indicatorValues.keltner;
      drawLine(keltner.upper, '#F778BA', 1.2, [5, 3]);
      drawLine(keltner.middle, '#F778BA', 1.5);
      drawLine(keltner.lower, '#F778BA', 1.2, [5, 3]);
    }
    
    // Draw Donchian Channels
    if (indicatorValues.donchian && indicators.find(i => i.id === 'donchian')?.enabled) {
      const donchian = indicatorValues.donchian;
      drawLine(donchian.upper, '#7EE3B8', 1.2, [5, 3]);
      drawLine(donchian.middle, '#7EE3B8', 1.5);
      drawLine(donchian.lower, '#7EE3B8', 1.2, [5, 3]);
    }
    
    // Draw EMAs
    if (indicatorValues.ema && indicators.find(i => i.id === 'ema')?.enabled) {
      drawLine(indicatorValues.ema, '#2F81F7', 1.5);
    }
    
    // Draw SMAs
    if (indicatorValues.sma && indicators.find(i => i.id === 'sma')?.enabled) {
      drawLine(indicatorValues.sma, '#E6B422', 1.5);
    }
    
    // Draw WMAs
    if (indicatorValues.wma && indicators.find(i => i.id === 'wma')?.enabled) {
      drawLine(indicatorValues.wma, '#F78166', 1.5);
    }
    
    // Draw HMA
    if (indicatorValues.hma && indicators.find(i => i.id === 'hma')?.enabled) {
      drawLine(indicatorValues.hma, '#7EE3B8', 1.5);
    }
    
    // Draw VWAP
    if (indicatorValues.vwap && indicators.find(i => i.id === 'vwap')?.enabled) {
      drawLine(indicatorValues.vwap, '#F778BA', 1.5);
    }
    
    // Draw Ichimoku
    if (indicatorValues.ichimoku && indicators.find(i => i.id === 'ichimoku')?.enabled) {
      const ichi = indicatorValues.ichimoku;
      drawLine(ichi.tenkan, '#2F81F7', 1.2);
      drawLine(ichi.kijun, '#F85149', 1.2);
      
      // Cloud fill
      ctx.fillStyle = 'rgba(63, 185, 80, 0.1)';
      ctx.beginPath();
      
      let firstCloud = true;
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= ichi.senkouA.length - 26) continue;
        
        const a = ichi.senkouA[globalIdx + 26];
        const b = ichi.senkouB[globalIdx + 26];
        if (a === null || b === null || isNaN(a) || isNaN(b)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const yA = toY(a);
        const yB = toY(b);
        
        if (firstCloud) {
          ctx.moveTo(x, yA);
          firstCloud = false;
        } else {
          ctx.lineTo(x, yA);
        }
      }
      
      for (let i = visibleCandles.length - 1; i >= 0; i--) {
        const globalIdx = startIdx + i;
        if (globalIdx >= ichi.senkouB.length - 26) continue;
        
        const b = ichi.senkouB[globalIdx + 26];
        if (b === null || isNaN(b)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const yB = toY(b);
        ctx.lineTo(x, yB);
      }
      
      ctx.closePath();
      ctx.fill();
    }
    
    // Draw Parabolic SAR
    if (indicatorValues.parabolicSar && indicators.find(i => i.id === 'parabolic_sar')?.enabled) {
      const sar = indicatorValues.parabolicSar;
      ctx.fillStyle = '#F0883E';
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= sar.length) continue;
        
        const v = sar[globalIdx];
        if (v === null || isNaN(v)) continue;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = toY(v);
        
        ctx.beginPath();
        ctx.arc(x, y, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    
    // ── Candlesticks ──
    for (let i = 0; i < visibleCandles.length; i++) {
      const c = visibleCandles[i];
      const x = offsetX + i * totalCandleW;
      
      let isBullish = c.close >= c.open;
      let color = isBullish ? chartSettings.colors.up : chartSettings.colors.down;
      
      // Heikin Ashi special coloring
      if (chartType === 'heikin-ashi') {
        isBullish = c.close > c.open;
        color = isBullish ? chartSettings.colors.up : chartSettings.colors.down;
      }
      
      // Hollow candles
      if (chartType === 'hollow') {
        const hollowBullish = isHollowBullish(c.open, c.close);
        color = hollowBullish ? chartSettings.colors.up : chartSettings.colors.down;
      }
      
      // Wick
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + candleWidth / 2, toY(c.high));
      ctx.lineTo(x + candleWidth / 2, toY(c.low));
      ctx.stroke();
      
      // Body
      if (chartType === 'line') {
        // Line chart
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x + candleWidth / 2, toY(c.close), 2, 0, Math.PI * 2);
        ctx.fill();
        
        if (i > 0) {
          const prev = visibleCandles[i - 1];
          ctx.strokeStyle = color;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x - totalCandleW + candleWidth / 2, toY(prev.close));
          ctx.lineTo(x + candleWidth / 2, toY(c.close));
          ctx.stroke();
        }
      } else if (chartType === 'area') {
        // Area chart
        ctx.fillStyle = color + '20';
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        
        if (i > 0) {
          const prev = visibleCandles[i - 1];
          ctx.beginPath();
          ctx.moveTo(x - totalCandleW + candleWidth / 2, toY(prev.close));
          ctx.lineTo(x + candleWidth / 2, toY(c.close));
          ctx.lineTo(x + candleWidth / 2, chartH);
          ctx.lineTo(x - totalCandleW + candleWidth / 2, chartH);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      } else if (chartType === 'bars') {
        // Bar chart
        ctx.fillStyle = color;
        ctx.fillRect(x, toY(Math.max(c.open, c.close)) - 2, candleWidth, 4);
        
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, toY(c.high));
        ctx.lineTo(x + candleWidth / 2, toY(c.low));
        ctx.stroke();
      } else {
        // Candles
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyBot = toY(Math.min(c.open, c.close));
        const bodyH = Math.max(1, bodyBot - bodyTop);
        
        ctx.fillStyle = color;
        ctx.fillRect(x, bodyTop, candleWidth, bodyH);
      }
    }
    
    // ── OHLC Values ──
    if (chartSettings.showOHLC && visibleCandles.length > 0) {
      const lastCandle = visibleCandles[visibleCandles.length - 1];
      ctx.font = '10px JetBrains Mono, monospace';
      ctx.fillStyle = '#E6EDF3';
      
      const ohlcText = `O: ${lastCandle.open.toFixed(chartSettings.precision)} H: ${lastCandle.high.toFixed(chartSettings.precision)} L: ${lastCandle.low.toFixed(chartSettings.precision)} C: ${lastCandle.close.toFixed(chartSettings.precision)}`;
      ctx.fillText(ohlcText, 10, 20);
    }
    
    // ── Current price line ──
    const curY = toY(currentPrice);
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = '#E6EDF3';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, curY);
    ctx.lineTo(chartW, curY);
    ctx.stroke();
    ctx.setLineDash([]);
    
    ctx.fillStyle = '#58A6FF';
    ctx.fillRect(chartW, curY - 10, priceAxisW, 20);
    ctx.fillStyle = '#0D1117';
    ctx.font = 'bold 10px JetBrains Mono, monospace';
    ctx.fillText(currentPrice.toFixed(chartSettings.precision), chartW + 4, curY + 4);
    
    // ── Crosshair ──
    if (chartSettings.crosshair && crosshairPos && crosshairPrice && crosshairTime) {
      ctx.strokeStyle = chartSettings.colors.crosshair;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 5]);
      
      // Vertical line
      ctx.beginPath();
      ctx.moveTo(crosshairPos.x, 0);
      ctx.lineTo(crosshairPos.x, chartH);
      ctx.stroke();
      
      // Horizontal line
      ctx.beginPath();
      ctx.moveTo(0, crosshairPos.y);
      ctx.lineTo(chartW, crosshairPos.y);
      ctx.stroke();
      
      ctx.setLineDash([]);
      
      // Price box
      ctx.fillStyle = '#58A6FF';
      ctx.fillRect(chartW, crosshairPos.y - 10, priceAxisW, 20);
      ctx.fillStyle = '#0D1117';
      ctx.font = 'bold 10px JetBrains Mono, monospace';
      ctx.fillText(crosshairPrice.toFixed(chartSettings.precision), chartW + 4, crosshairPos.y + 4);
      
      // Time box
      const timeStr = new Date(crosshairTime * 1000).toLocaleTimeString();
      ctx.fillStyle = '#58A6FF';
      ctx.fillRect(crosshairPos.x - 40, chartH + 2, 80, 20);
      ctx.fillStyle = '#0D1117';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillText(timeStr, crosshairPos.x - 35, chartH + 16);
    }
    
    // ── Indicator legend ──
    let lx = 10;
    const ly = 40;
    ctx.font = '9px JetBrains Mono, monospace';
    
    indicators.filter(i => i.enabled && i.type === 'overlay').forEach(ind => {
      ctx.fillStyle = ind.color;
      ctx.fillRect(lx, ly, 12, 2);
      ctx.fillText(ind.name, lx + 16, ly + 4);
      lx += ctx.measureText(ind.name).width + 30;
    });
    
    // ── Zoom info ──
    ctx.fillStyle = '#484F58';
    ctx.font = '9px JetBrains Mono, monospace';
    ctx.fillText(`${visibleCandles.length} candles | Scroll: wheel | Zoom: Ctrl+wheel | Drag to pan`, 10, chartH - 10);
    
    // ═════ RSI Subplot ═════
    if (indicatorValues.rsi && indicators.find(i => i.id === 'rsi')?.enabled) {
      const rsiTop = chartH + (volumeHeight > 0 ? volumeHeight : 0);
      const rsiH = oscillatorHeight;
      
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, rsiTop, W, rsiH);
      
      ctx.strokeStyle = chartSettings.colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, rsiTop);
      ctx.lineTo(W, rsiTop);
      ctx.stroke();
      
      const rsiToY = (v: number) => rsiTop + 4 + ((100 - v) / 100) * (rsiH - 8);
      
      ctx.font = '8px JetBrains Mono, monospace';
      [30, 50, 70].forEach(level => {
        const y = rsiToY(level);
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = level === 50 ? '#484F58' : (level === 70 ? '#F8514950' : '#3FB95050');
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(chartW, y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.fillStyle = '#484F58';
        ctx.fillText(String(level), chartW + 4, y + 3);
      });
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('RSI(14)', 4, rsiTop + 12);
      
      // RSI line
      ctx.strokeStyle = '#D29922';
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
        const y = rsiToY(v);
        
        if (!rsiStarted) {
          ctx.moveTo(x, y);
          rsiStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      
      // Current RSI
      const lastRsi = indicatorValues.rsi[indicatorValues.rsi.length - 1];
      const rsiColor = lastRsi > 70 ? '#F85149' : lastRsi < 30 ? '#3FB950' : '#D29922';
      ctx.fillStyle = rsiColor;
      ctx.fillRect(chartW, rsiToY(lastRsi) - 7, priceAxisW, 14);
      ctx.fillStyle = '#0D1117';
      ctx.font = 'bold 9px JetBrains Mono, monospace';
      ctx.fillText(lastRsi.toFixed(1), chartW + 2, rsiToY(lastRsi) + 3);
      
      // Overbought/Oversold zones
      ctx.fillStyle = 'rgba(248, 81, 73, 0.04)';
      ctx.fillRect(0, rsiTop, chartW, rsiToY(70) - rsiTop);
      ctx.fillStyle = 'rgba(63, 185, 80, 0.04)';
      ctx.fillRect(0, rsiToY(30), chartW, rsiTop + rsiH - rsiToY(30));
    }
    
    // ═════ MACD Subplot ═════
    if (indicatorValues.macd && indicators.find(i => i.id === 'macd')?.enabled) {
      const macdTop = chartH + (volumeHeight > 0 ? volumeHeight : 0) + (indicatorValues.rsi ? oscillatorHeight : 0);
      const macdH = oscillatorHeight;
      
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, macdTop, W, macdH);
      
      ctx.strokeStyle = chartSettings.colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, macdTop);
      ctx.lineTo(W, macdTop);
      ctx.stroke();
      
      const macd = indicatorValues.macd;
      const maxMACD = Math.max(...macd.map(v => Math.abs(v || 0)));
      const macdRange = maxMACD * 2 || 1;
      
      const macdToY = (v: number) => macdTop + 4 + ((maxMACD - v) / macdRange) * (macdH - 8);
      
      // Zero line
      const zeroY = macdToY(0);
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = '#484F58';
      ctx.beginPath();
      ctx.moveTo(0, zeroY);
      ctx.lineTo(chartW, zeroY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('MACD', 4, macdTop + 12);
      
      // MACD line
      ctx.strokeStyle = '#BC8CFF';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let macdStarted = false;
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= macd.length) continue;
        
        const v = macd[globalIdx];
        if (v === null || isNaN(v)) {
          macdStarted = false;
          continue;
        }
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = macdToY(v);
        
        if (!macdStarted) {
          ctx.moveTo(x, y);
          macdStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      
      // Signal line
      ctx.strokeStyle = '#F85149';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let signalStarted = false;
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= macd.length) continue;
        
        const v = macd[globalIdx] * 0.8; // Mock signal
        if (v === null || isNaN(v)) {
          signalStarted = false;
          continue;
        }
        
        const x = offsetX + i * totalCandleW + candleWidth / 2;
        const y = macdToY(v);
        
        if (!signalStarted) {
          ctx.moveTo(x, y);
          signalStarted = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      
      // Histogram
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= macd.length) continue;
        
        const v = macd[globalIdx];
        if (v === null || isNaN(v)) continue;
        
        const signal = v * 0.8;
        const histogram = v - signal;
        
        const x = offsetX + i * totalCandleW + candleWidth / 2 - 2;
        const y0 = macdToY(0);
        const yHist = macdToY(histogram);
        
        ctx.fillStyle = histogram >= 0 ? '#3FB950' : '#F85149';
        ctx.fillRect(x, Math.min(y0, yHist), 4, Math.abs(yHist - y0));
      }
    }
    
    // ═════ Volume Subplot ═════
    if (chartSettings.showVolume && indicatorValues.volume) {
      const volumeTop = chartH;
      const volumeH = volumeHeight;
      
      ctx.fillStyle = '#161B22';
      ctx.fillRect(0, volumeTop, W, volumeH);
      
      ctx.strokeStyle = chartSettings.colors.grid;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(0, volumeTop);
      ctx.lineTo(W, volumeTop);
      ctx.stroke();
      
      const maxVolume = Math.max(...tfVolumes.slice(startIdx, endIdx).filter(v => !isNaN(v)), 1);
      
      ctx.fillStyle = '#8B949E';
      ctx.font = '9px JetBrains Mono, monospace';
      ctx.fillText('Volume', 4, volumeTop + 12);
      
      for (let i = 0; i < visibleCandles.length; i++) {
        const globalIdx = startIdx + i;
        if (globalIdx >= tfVolumes.length) continue;
        
        const vol = tfVolumes[globalIdx] || 0;
        const isBullish = visibleCandles[i].close >= visibleCandles[i].open;
        const x = offsetX + i * totalCandleW;
        const barH = (vol / maxVolume) * (volumeH - 20);
        
        ctx.fillStyle = isBullish ? 'rgba(63, 185, 80, 0.5)' : 'rgba(248, 81, 73, 0.5)';
        ctx.fillRect(x, volumeTop + volumeH - barH - 5, candleWidth, barH);
      }
    }
    
  }, [candles, indicatorValues, chartSettings, chartType, scrollOffset, candleWidth, crosshairPos, crosshairPrice, crosshairTime, startIdx, endIdx, tfVolumes, currentPrice]);

  // Filter markets
  const filteredMarkets = groupFilter === 'all' ? ALL_MARKETS : ALL_MARKETS.filter(m => m.group === groupFilter);
  const marketName = ALL_MARKETS.find(m => m.symbol === symbol)?.name || symbol;

  // Trade execution
  const handleBuy = async (side: 'buy' | 'sell') => {
    if (!isAuthorized) { toast.error('Please login to your Deriv account first'); return; }
    if (isTrading) return;
    setIsTrading(true);
    
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
      
      if (result.status === 'won') { 
        toast.success(`✅ WON +$${result.profit.toFixed(2)}`); 
        if (voiceEnabled) speak(`Trade won. Profit ${result.profit.toFixed(2)} dollars`);
      } else { 
        toast.error(`❌ LOST -$${Math.abs(result.profit).toFixed(2)}`); 
        if (voiceEnabled) speak(`Trade lost. Loss ${Math.abs(result.profit).toFixed(2)} dollars`);
      }
    } catch (err: any) { 
      toast.error(`Trade failed: ${err.message}`); 
    } finally { 
      setIsTrading(false); 
    }
  };

  // Voice AI
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

  // Toggle indicator
  const toggleIndicator = useCallback((indicatorId: string) => {
    setIndicators(prev => prev.map(ind => 
      ind.id === indicatorId ? { ...ind, enabled: !ind.enabled } : ind
    ));
  }, []);

  // Update indicator params
  const updateIndicatorParam = useCallback((indicatorId: string, paramName: string, value: any) => {
    setIndicators(prev => prev.map(ind => 
      ind.id === indicatorId ? { ...ind, params: { ...ind.params, [paramName]: value } } : ind
    ));
  }, []);

  // Bot stats
  const totalTrades = tradeHistory.filter(t => t.status !== 'open').length;
  const wins = tradeHistory.filter(t => t.status === 'won').length;
  const losses = tradeHistory.filter(t => t.status === 'lost').length;
  const totalProfit = tradeHistory.reduce((s, t) => s + t.profit, 0);
  const winRate = totalTrades > 0 ? (wins / totalTrades * 100) : 0;

  return (
    <div className={`flex h-screen ${chartSettings.theme === 'dark' ? 'dark' : ''}`}>
      {/* Left Sidebar - Markets */}
      {showSidebar && (
        <div className="w-64 bg-card border-r border-border flex flex-col">
          <div className="p-3 border-b border-border">
            <h2 className="font-semibold text-sm">Markets</h2>
          </div>
          
          <div className="p-2">
            <Select value={groupFilter} onValueChange={setGroupFilter}>
              <SelectTrigger className="h-8 text-xs">
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
            <div className="p-2 space-y-1">
              {filteredMarkets.map(m => (
                <button
                  key={m.symbol}
                  onClick={() => setSymbol(m.symbol)}
                  className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
                    symbol === m.symbol 
                      ? 'bg-primary text-primary-foreground' 
                      : 'hover:bg-muted text-muted-foreground'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}
      
      {/* Main Chart Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Toolbar */}
        <div className="h-12 border-b border-border flex items-center px-3 gap-2 bg-card">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowSidebar(!showSidebar)}
          >
            <Layers className="h-4 w-4" />
          </Button>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Chart Type */}
          <Select value={chartType} onValueChange={setChartType}>
            <SelectTrigger className="h-8 w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHART_TYPES.map(t => {
                const Icon = t.icon;
                return (
                  <SelectItem key={t.value} value={t.value}>
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4" />
                      {t.label}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Timeframes */}
          <div className="flex gap-1">
            {TIMEFRAMES.map(tf => (
              <Button
                key={tf.value}
                size="sm"
                variant={timeframe === tf.value ? 'default' : 'ghost'}
                className="h-7 text-xs px-2"
                onClick={() => setTimeframe(tf.value)}
              >
                {tf.label}
              </Button>
            ))}
          </div>
          
          <Separator orientation="vertical" className="h-6" />
          
          {/* Indicators Toggle */}
          <Button
            variant={showIndicatorPanel ? 'default' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => setShowIndicatorPanel(!showIndicatorPanel)}
          >
            <Sigma className="h-3.5 w-3.5" />
            Indicators
          </Button>
          
          {/* Drawing Tools */}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1"
          >
            <Pencil className="h-3.5 w-3.5" />
            Draw
          </Button>
          
          <div className="flex-1" />
          
          {/* Current Price */}
          <Badge variant="outline" className="font-mono text-sm">
            {currentPrice.toFixed(chartSettings.precision)}
          </Badge>
          
          {/* Fullscreen */}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsFullscreen(!isFullscreen)}
          >
            {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
        
        {/* Chart */}
        <div className="flex-1 relative">
          <canvas 
            ref={canvasRef} 
            className="w-full h-full cursor-crosshair"
            style={{ background: chartSettings.colors.bg }}
          />
          
          {/* Loading Overlay */}
          {isLoading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
              <div className="text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Loading chart data...</p>
              </div>
            </div>
          )}
        </div>
        
        {/* Bottom Panel - Tabs */}
        <div className="h-[300px] border-t border-border bg-card">
          <Tabs defaultValue="indicators" className="h-full flex flex-col">
            <div className="px-3 pt-2 border-b border-border">
              <TabsList>
                <TabsTrigger value="indicators" className="text-xs">Indicators</TabsTrigger>
                <TabsTrigger value="trading" className="text-xs">Trading</TabsTrigger>
                <TabsTrigger value="bot" className="text-xs">Auto Bot</TabsTrigger>
                <TabsTrigger value="history" className="text-xs">History</TabsTrigger>
                <TabsTrigger value="analysis" className="text-xs">Analysis</TabsTrigger>
                <TabsTrigger value="settings" className="text-xs">Settings</TabsTrigger>
              </TabsList>
            </div>
            
            <TabsContent value="indicators" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-4 gap-4">
                {['trend', 'oscillator', 'volatility', 'volume', 'custom'].map(section => (
                  <div key={section}>
                    <h3 className="text-xs font-semibold mb-2 capitalize">{section}</h3>
                    <div className="space-y-2">
                      {indicators
                        .filter(i => i.section === section)
                        .map(ind => (
                          <div key={ind.id} className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={ind.enabled}
                                onCheckedChange={() => toggleIndicator(ind.id)}
                              />
                              <span className="text-xs" style={{ color: ind.color }}>{ind.name}</span>
                            </div>
                            
                            {ind.enabled && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6"
                                onClick={() => {
                                  // Show settings modal
                                }}
                              >
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
            
            <TabsContent value="trading" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-3 gap-4">
                {/* Contract Type */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Contract Type</label>
                  <Select value={contractType} onValueChange={setContractType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONTRACT_TYPES.map(c => {
                        const Icon = c.icon;
                        return (
                          <SelectItem key={c.value} value={c.value}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4" style={{ color: c.color }} />
                              {c.label}
                            </div>
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>
                
                {/* Duration */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Duration</label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      value={duration}
                      onChange={(e) => setDuration(e.target.value)}
                      className="flex-1"
                    />
                    <Select value={durationUnit} onValueChange={setDurationUnit}>
                      <SelectTrigger className="w-20">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="t">Ticks</SelectItem>
                        <SelectItem value="s">Seconds</SelectItem>
                        <SelectItem value="m">Minutes</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                
                {/* Stake */}
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Stake ($)</label>
                  <Input
                    type="number"
                    value={tradeStake}
                    onChange={(e) => setTradeStake(e.target.value)}
                    step="0.01"
                    min="0.35"
                  />
                </div>
              </div>
              
              {/* Digit Prediction */}
              {['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(contractType) && (
                <div className="mt-3">
                  <label className="text-xs text-muted-foreground mb-1 block">Prediction</label>
                  <div className="grid grid-cols-10 gap-1">
                    {Array.from({ length: 10 }, (_, i) => (
                      <button
                        key={i}
                        onClick={() => { setPrediction(String(i)); setSelectedDigit(i); }}
                        className={`h-10 rounded text-sm font-mono font-bold transition-all ${
                          prediction === String(i) 
                            ? 'bg-primary text-primary-foreground' 
                            : 'bg-muted text-foreground hover:bg-secondary'
                        }`}
                      >
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Action Buttons */}
              <div className="flex gap-3 mt-4">
                <Button
                  onClick={() => handleBuy('buy')}
                  disabled={isTrading || !isAuthorized}
                  className="flex-1 h-12 bg-profit hover:bg-profit/90 text-profit-foreground"
                >
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Buy {contractType === 'CALL' ? 'Rise' : contractType}
                </Button>
                
                <Button
                  onClick={() => handleBuy('sell')}
                  disabled={isTrading || !isAuthorized}
                  className="flex-1 h-12 bg-loss hover:bg-loss/90 text-loss-foreground"
                >
                  <TrendingDown className="h-4 w-4 mr-2" />
                  Sell {contractType === 'PUT' ? 'Fall' : contractType}
                </Button>
              </div>
            </TabsContent>
            
            <TabsContent value="bot" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Bot Mode</label>
                  <Select>
                    <SelectTrigger>
                      <SelectValue placeholder="Select mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="simple">Simple</SelectItem>
                      <SelectItem value="martingale">Martingale</SelectItem>
                      <SelectItem value="antimartingale">Anti-Martingale</SelectItem>
                      <SelectItem value="dAlembert">d'Alembert</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Base Stake ($)</label>
                  <Input type="number" value="1.00" step="0.01" />
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Trades</label>
                  <Input type="number" value="50" />
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-4 mt-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Stop Loss ($)</label>
                  <Input type="number" value="10" />
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Take Profit ($)</label>
                  <Input type="number" value="20" />
                </div>
                
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Max Concurrent</label>
                  <Input type="number" value="1" />
                </div>
              </div>
              
              <div className="flex gap-3 mt-4">
                <Button className="flex-1 bg-profit hover:bg-profit/90">
                  <Play className="h-4 w-4 mr-2" />
                  Start Bot
                </Button>
                
                <Button variant="outline" className="flex-1">
                  <Pause className="h-4 w-4 mr-2" />
                  Pause
                </Button>
                
                <Button variant="destructive" className="flex-1">
                  <StopCircle className="h-4 w-4 mr-2" />
                  Stop
                </Button>
              </div>
              
              {/* Bot Stats */}
              <div className="grid grid-cols-5 gap-2 mt-4 p-3 bg-muted/30 rounded-lg">
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Trades</div>
                  <div className="font-mono font-bold">0</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Win Rate</div>
                  <div className="font-mono font-bold text-profit">0%</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Profit</div>
                  <div className="font-mono font-bold">$0.00</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Balance</div>
                  <div className="font-mono font-bold">$0.00</div>
                </div>
                <div className="text-center">
                  <div className="text-xs text-muted-foreground">Streak</div>
                  <div className="font-mono font-bold">0</div>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="history" className="flex-1 p-3 overflow-auto">
              <div className="space-y-2">
                {tradeHistory.length > 0 ? (
                  tradeHistory.map(t => (
                    <div
                      key={t.id}
                      className={`flex items-center justify-between p-2 rounded-lg border ${
                        t.status === 'open' ? 'border-primary/30 bg-primary/5' :
                        t.status === 'won' ? 'border-profit/30 bg-profit/5' :
                        'border-loss/30 bg-loss/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${
                          t.status === 'won' ? 'text-profit' : 
                          t.status === 'lost' ? 'text-loss' : 
                          'text-primary'
                        }`}>
                          {t.status === 'open' ? '⏳' : t.status === 'won' ? '✅' : '❌'}
                        </span>
                        
                        <div>
                          <div className="text-xs font-medium">{t.type}</div>
                          <div className="text-[10px] text-muted-foreground">
                            {new Date(t.time).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="text-xs font-mono">Stake: ${t.stake.toFixed(2)}</div>
                        <div className={`text-xs font-mono font-bold ${
                          t.profit >= 0 ? 'text-profit' : 'text-loss'
                        }`}>
                          {t.profit >= 0 ? '+' : ''}{t.profit.toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No trades yet
                  </div>
                )}
              </div>
            </TabsContent>
            
            <TabsContent value="analysis" className="flex-1 p-3 overflow-auto">
              <div className="grid grid-cols-2 gap-4">
                {/* Digit Analysis */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Digit Distribution</h3>
                  <div className="grid grid-cols-5 gap-2">
                    {Array.from({ length: 10 }, (_, d) => {
                      const pct = percentages[d] || 0;
                      const count = frequency[d] || 0;
                      return (
                        <div key={d} className="text-center p-2 bg-muted/30 rounded">
                          <div className="text-lg font-mono font-bold">{d}</div>
                          <div className="text-xs">{count}x</div>
                          <div className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                
                {/* Statistics */}
                <div>
                  <h3 className="text-sm font-semibold mb-2">Statistics</h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs">
                      <span>Even/Odd Ratio</span>
                      <span className="font-mono">{evenPct.toFixed(1)}% / {oddPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Over/Under Ratio</span>
                      <span className="font-mono">{overPct.toFixed(1)}% / {underPct.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Most Common Digit</span>
                      <span className="font-mono text-profit">{mostCommon} ({percentages[mostCommon]?.toFixed(1)}%)</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span>Least Common Digit</span>
                      <span className="font-mono text-loss">{leastCommon} ({percentages[leastCommon]?.toFixed(1)}%)</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Last Digits */}
              <div className="mt-4">
                <h3 className="text-sm font-semibold mb-2">Last 26 Digits</h3>
                <div className="flex gap-1 flex-wrap">
                  {last26.map((d, i) => {
                    const isEven = d % 2 === 0;
                    return (
                      <div
                        key={i}
                        className={`w-8 h-8 rounded flex items-center justify-center font-mono text-xs font-bold border-2 ${
                          isEven
                            ? 'border-profit text-profit bg-profit/10'
                            : 'border-warning text-warning bg-warning/10'
                        }`}
                      >
                        {d}
                      </div>
                    );
                  })}
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="settings" className="flex-1 p-3 overflow-auto">
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-semibold mb-2">Chart Settings</h3>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Grid Lines</span>
                      <Switch
                        checked={chartSettings.gridLines}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, gridLines: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Crosshair</span>
                      <Switch
                        checked={chartSettings.crosshair}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, crosshair: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Show Volume</span>
                      <Switch
                        checked={chartSettings.showVolume}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, showVolume: v }))}
                      />
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-xs">Show OHLC</span>
                      <Switch
                        checked={chartSettings.showOHLC}
                        onCheckedChange={(v) => setChartSettings(prev => ({ ...prev, showOHLC: v }))}
                      />
                    </div>
                  </div>
                </div>
                
                <div>
                  <h3 className="text-sm font-semibold mb-2">Precision</h3>
                  <Select 
                    value={String(chartSettings.precision)} 
                    onValueChange={(v) => setChartSettings(prev => ({ ...prev, precision: parseInt(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2">2 decimals</SelectItem>
                      <SelectItem value="3">3 decimals</SelectItem>
                      <SelectItem value="4">4 decimals</SelectItem>
                      <SelectItem value="5">5 decimals</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <h3 className="text-sm font-semibold mb-2">Candle Width</h3>
                  <Slider
                    value={[candleWidth]}
                    onValueChange={([v]) => setCandleWidth(v)}
                    min={2}
                    max={30}
                    step={1}
                  />
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
