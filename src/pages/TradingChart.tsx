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
     
