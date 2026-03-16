import { useState, useRef, useCallback, useEffect, memo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { 
  Play, StopCircle, Pause, TrendingUp, TrendingDown, 
  CircleDot, RefreshCw, Trash2, DollarSign, Scan, 
  Target, Activity, Power, Zap, AlertCircle, CheckCircle2, 
  Timer, BarChart, Hash, Percent, ArrowUp, ArrowDown, Brain,
  Rocket, Shield, Crown, Gauge, Radar, LineChart, Layers,
  Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Settings2,
  Plus, Minus, ChevronUp, ChevronDown, Maximize2, Minimize2,
  Grid3X3, List, Filter, Download, Upload, Copy, Check,
  Clock, Calendar, Bell, Moon, Sun, Wifi, WifiOff
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// ==================== TYPES ====================
interface MarketTick {
  epoch: number;
  quote: number;
  digit: number;
}

interface MarketData {
  symbol: string;
  ticks: MarketTick[];
  lastDigit: number;
  lastQuote: number;
  evenPercent: number;
  oddPercent: number;
  lowPercent: number;  // 0-4
  highPercent: number; // 5-9
  volatility: number;
  trend: 'BULL' | 'BEAR' | 'NEUTRAL';
  signal: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | null;
  confidence: number;
  updateTime: number;
}

interface BotStrategy {
  id: string;
  name: string;
  type: 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
  icon: any;
  color: string;
  conditions: {
    dominantPercent: number;
    consecutiveRequired: number;
    predictionType: string;
  };
}

interface BotConfig {
  id: string;
  name: string;
  strategy: BotStrategy;
  market: string | null;
  enabled: boolean;
  running: boolean;
  paused: boolean;
  status: 'IDLE' | 'WAITING_ENTRY' | 'ANALYZING' | 'READY' | 'TRADING' | 'COOLDOWN' | 'STOPPED';
  
  // Entry System
  entryEnabled: boolean;
  entryDigit: number;
  entryCondition: 'EQUAL' | 'GREATER' | 'LESS';
  entryTriggered: boolean;
  
  // Risk Management
  stake: number;
  stakeType: 'FIXED' | 'MARTINGALE';
  martingaleMultiplier: number;
  takeProfit: number;
  stopLoss: number;
  maxTrades: number;
  
  // Stats
  trades: number;
  wins: number;
  losses: number;
  totalPnl: number;
  currentStake: number;
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastSignal: boolean;
  
  // UI
  expanded: boolean;
}

interface TradeLog {
  id: string;
  time: number;
  botId: string;
  botName: string;
  market: string;
  strategy: string;
  stake: number;
  entry: number;
  exit: number;
  result: 'WIN' | 'LOSS';
  pnl: number;
  confidence: number;
}

// ==================== CONSTANTS ====================
const MARKETS = [
  // Volatility Indices
  { id: 'R_10', name: 'R 10', type: 'Volatility', icon: '📈' },
  { id: 'R_25', name: 'R 25', type: 'Volatility', icon: '📈' },
  { id: 'R_50', name: 'R 50', type: 'Volatility', icon: '📈' },
  { id: 'R_75', name: 'R 75', type: 'Volatility', icon: '📈' },
  { id: 'R_100', name: 'R 100', type: 'Volatility', icon: '📈' },
  
  // 1HZ Indices
  { id: '1HZ10V', name: '1HZ 10V', type: '1HZ', icon: '⚡' },
  { id: '1HZ25V', name: '1HZ 25V', type: '1HZ', icon: '⚡' },
  { id: '1HZ50V', name: '1HZ 50V', type: '1HZ', icon: '⚡' },
  { id: '1HZ75V', name: '1HZ 75V', type: '1HZ', icon: '⚡' },
  { id: '1HZ100V', name: '1HZ 100V', type: '1HZ', icon: '⚡' },
  
  // Jump Indices
  { id: 'JD10', name: 'JD 10', type: 'Jump', icon: '🦘' },
  { id: 'JD25', name: 'JD 25', type: 'Jump', icon: '🦘' },
  { id: 'JD50', name: 'JD 50', type: 'Jump', icon: '🦘' },
  { id: 'JD75', name: 'JD 75', type: 'Jump', icon: '🦘' },
  { id: 'JD100', name: 'JD 100', type: 'Jump', icon: '🦘' },
  
  // Boom & Crash
  { id: 'BOOM300', name: 'BOOM 300', type: 'Boom', icon: '💥' },
  { id: 'BOOM500', name: 'BOOM 500', type: 'Boom', icon: '💥' },
  { id: 'BOOM1000', name: 'BOOM 1000', type: 'Boom', icon: '💥' },
  { id: 'CRASH300', name: 'CRASH 300', type: 'Crash', icon: '📉' },
  { id: 'CRASH500', name: 'CRASH 500', type: 'Crash', icon: '📉' },
  { id: 'CRASH1000', name: 'CRASH 1000', type: 'Crash', icon: '📉' },
  
  // Bear & Bull
  { id: 'RDBEAR', name: 'Bear Market', type: 'Bear', icon: '🐻' },
  { id: 'RDBULL', name: 'Bull Market', type: 'Bull', icon: '🐂' },
];

const STRATEGIES: BotStrategy[] = [
  {
    id: 'even',
    name: 'EVEN',
    type: 'EVEN',
    icon: CircleDot,
    color: 'emerald',
    conditions: {
      dominantPercent: 60,
      consecutiveRequired: 2,
      predictionType: 'EVEN'
    }
  },
  {
    id: 'odd',
    name: 'ODD',
    type: 'ODD',
    icon: CircleDot,
    color: 'purple',
    conditions: {
      dominantPercent: 60,
      consecutiveRequired: 2,
      predictionType: 'ODD'
    }
  },
  {
    id: 'over',
    name: 'OVER',
    type: 'OVER',
    icon: TrendingUp,
    color: 'blue',
    conditions: {
      dominantPercent: 65,
      consecutiveRequired: 2,
      predictionType: 'OVER5'
    }
  },
  {
    id: 'under',
    name: 'UNDER',
    type: 'UNDER',
    icon: TrendingDown,
    color: 'orange',
    conditions: {
      dominantPercent: 65,
      consecutiveRequired: 2,
      predictionType: 'UNDER4'
    }
  }
];

// ==================== UTILITIES ====================
const analyzeMarket = (ticks: MarketTick[]): Partial<MarketData> => {
  if (ticks.length < 100) return {};
  
  const recent = ticks.slice(-100);
  const last = recent[recent.length - 1];
  
  let even = 0, odd = 0, low = 0, high = 0;
  recent.forEach(t => {
    if (t.digit % 2 === 0) even++;
    else odd++;
    if (t.digit <= 4) low++;
    if (t.digit >= 5) high++;
  });
  
  const evenPercent = (even / 100) * 100;
  const oddPercent = (odd / 100) * 100;
  const lowPercent = (low / 100) * 100;
  const highPercent = (high / 100) * 100;
  
  // Calculate volatility
  const digits = recent.map(t => t.digit);
  const mean = digits.reduce((a, b) => a + b, 0) / 100;
  const variance = digits.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 100;
  const volatility = Math.sqrt(variance);
  
  // Determine trend
  const last10 = recent.slice(-10).map(t => t.digit);
  const avg10 = last10.reduce((a, b) => a + b, 0) / 10;
  const trend = avg10 > mean ? 'BULL' : avg10 < mean ? 'BEAR' : 'NEUTRAL';
  
  // Determine signal
  let signal = null;
  let confidence = 0;
  
  if (oddPercent > 60) {
    signal = 'EVEN';
    confidence = oddPercent;
  } else if (evenPercent > 60) {
    signal = 'ODD';
    confidence = evenPercent;
  } else if (lowPercent > 65) {
    signal = 'OVER';
    confidence = lowPercent;
  } else if (highPercent > 65) {
    signal = 'UNDER';
    confidence = highPercent;
  }
  
  return {
    lastDigit: last?.digit,
    lastQuote: last?.quote,
    evenPercent,
    oddPercent,
    lowPercent,
    highPercent,
    volatility,
    trend,
    signal,
    confidence,
    updateTime: Date.now()
  };
};

const checkConsecutive = (ticks: MarketTick[], count: number, condition: (d: number) => boolean): boolean => {
  if (ticks.length < count) return false;
  return ticks.slice(-count).every(t => condition(t.digit));
};

// ==================== MARKET DATA HOOK ====================
const useMarketData = (symbols: string[]) => {
  const [data, setData] = useState<Record<string, MarketData>>({});
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  
  const ticksRef = useRef<Record<string, MarketTick[]>>({});
  const subsRef = useRef<(() => void) | null>(null);
  const frameRef = useRef<number>();

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      
      // Fetch historical data
      for (const symbol of symbols) {
        try {
          const ticks = await derivApi.getTicks(symbol, 1000);
          ticksRef.current[symbol] = ticks.map((t: any) => ({
            epoch: t.epoch,
            quote: t.quote,
            digit: Math.floor(t.quote % 10)
          }));
        } catch (error) {
          console.error(`Failed to fetch ${symbol}:`, error);
          ticksRef.current[symbol] = [];
        }
      }
      
      // Subscribe to real-time
      subsRef.current = derivApi.subscribeTicks(symbols, (tick: any) => {
        const symbol = tick.symbol;
        const newTick = {
          epoch: tick.epoch,
          quote: tick.quote,
          digit: Math.floor(tick.quote % 10)
        };
        
        if (!ticksRef.current[symbol]) {
          ticksRef.current[symbol] = [];
        }
        
        ticksRef.current[symbol].push(newTick);
        if (ticksRef.current[symbol].length > 1000) {
          ticksRef.current[symbol] = ticksRef.current[symbol].slice(-1000);
        }
        
        // Throttle updates
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        frameRef.current = requestAnimationFrame(updateData);
      });
      
      setConnected(true);
      setLoading(false);
      updateData();
    };
    
    const updateData = () => {
      const newData: Record<string, MarketData> = {};
      
      symbols.forEach(symbol => {
        const ticks = ticksRef.current[symbol] || [];
        const analysis = analyzeMarket(ticks);
        
        newData[symbol] = {
          symbol,
          ticks,
          lastDigit: analysis.lastDigit || 0,
          lastQuote: analysis.lastQuote || 0,
          evenPercent: analysis.evenPercent || 0,
          oddPercent: analysis.oddPercent || 0,
          lowPercent: analysis.lowPercent || 0,
          highPercent: analysis.highPercent || 0,
          volatility: analysis.volatility || 0,
          trend: analysis.trend || 'NEUTRAL',
          signal: analysis.signal || null,
          confidence: analysis.confidence || 0,
          updateTime: Date.now()
        };
      });
      
      setData(newData);
    };
    
    init();
    
    return () => {
      if (subsRef.current) subsRef.current();
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [symbols]);
  
  return { data, loading, connected };
};

// ==================== BOT CARD COMPONENT ====================
const BotCard = memo(({ 
  bot, 
  market,
  onStart,
  onStop,
  onPause,
  onUpdate,
  onExpand
}: { 
  bot: BotConfig;
  market?: MarketData;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
  onPause: (id: string) => void;
  onUpdate: (id: string, updates: Partial<BotConfig>) => void;
  onExpand: (id: string) => void;
}) => {
  const StrategyIcon = bot.strategy.icon;
  
  const getStatusColor = () => {
    switch (bot.status) {
      case 'TRADING': return 'text-emerald-400';
      case 'READY': return 'text-green-400';
      case 'ANALYZING': return 'text-blue-400';
      case 'WAITING_ENTRY': return 'text-yellow-400';
      case 'COOLDOWN': return 'text-purple-400';
      case 'STOPPED': return 'text-rose-400';
      default: return 'text-slate-400';
    }
  };
  
  const getStatusBg = () => {
    switch (bot.status) {
      case 'TRADING': return 'bg-emerald-500/10';
      case 'READY': return 'bg-green-500/10';
      case 'ANALYZING': return 'bg-blue-500/10';
      case 'WAITING_ENTRY': return 'bg-yellow-500/10';
      case 'COOLDOWN': return 'bg-purple-500/10';
      case 'STOPPED': return 'bg-rose-500/10';
      default: return 'bg-slate-800';
    }
  };
  
  return (
    <Card className={`bg-[#1e293b] border-slate-700/50 hover:border-slate-600 transition-all ${getStatusBg()}`}>
      <CardContent className="p-2">
        {/* Header */}
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <div className={`p-1 rounded bg-${bot.strategy.color}-500/10`}>
              <StrategyIcon className={`w-3 h-3 text-${bot.strategy.color}-400`} />
            </div>
            <div>
              <div className="flex items-center gap-1">
                <span className="text-xs font-medium text-slate-200">{bot.name}</span>
                <Badge variant="outline" className="h-3.5 px-1 text-[8px] border-slate-600 text-slate-400">
                  {bot.strategy.name}
                </Badge>
              </div>
              <div className="flex items-center gap-1 mt-0.5">
                <Badge className={`h-3.5 px-1 text-[7px] ${getStatusColor()} ${getStatusBg()} border-0`}>
                  {bot.status}
                </Badge>
                {bot.cooldownRemaining > 0 && (
                  <Badge className="h-3.5 px-1 text-[7px] bg-purple-500/10 text-purple-400 border-0">
                    {bot.cooldownRemaining}s
                  </Badge>
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
                    className="h-5 w-5"
                    onClick={() => onExpand(bot.id)}
                  >
                    <Settings2 className="w-2.5 h-2.5 text-slate-400" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-[9px]">
                  Settings
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            
            <Switch
              checked={bot.enabled}
              onCheckedChange={(checked) => onUpdate(bot.id, { enabled: checked })}
              className="scale-75"
            />
          </div>
        </div>
        
        {/* Market Selector */}
        <div className="mb-1.5">
          <Select
            value={bot.market || ''}
            onValueChange={(value) => onUpdate(bot.id, { market: value })}
          >
            <SelectTrigger className="h-5 text-[9px] bg-slate-800 border-slate-700">
              <SelectValue placeholder="Select market" />
            </SelectTrigger>
            <SelectContent className="bg-slate-800 border-slate-700">
              {MARKETS.map(m => (
                <SelectItem key={m.id} value={m.id} className="text-[9px]">
                  <span className="flex items-center gap-1">
                    <span>{m.icon}</span>
                    <span>{m.name}</span>
                    <span className="text-slate-500">({m.type})</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
        {/* Live Data */}
        {market && (
          <div className="grid grid-cols-4 gap-1 mb-1.5">
            <div className="bg-slate-800/50 rounded p-1">
              <div className="text-[7px] text-slate-500">Last</div>
              <div className="text-[9px] font-mono text-slate-200">{market.lastDigit}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-1">
              <div className="text-[7px] text-slate-500">Quote</div>
              <div className="text-[9px] font-mono text-slate-200">{market.lastQuote.toFixed(5)}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-1">
              <div className="text-[7px] text-slate-500">Vol</div>
              <div className="text-[9px] font-mono text-slate-200">{market.volatility.toFixed(2)}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-1">
              <div className="text-[7px] text-slate-500">Trend</div>
              <div className={`text-[9px] font-mono ${
                market.trend === 'BULL' ? 'text-emerald-400' : 
                market.trend === 'BEAR' ? 'text-rose-400' : 'text-slate-400'
              }`}>
                {market.trend}
              </div>
            </div>
          </div>
        )}
        
        {/* Percentages */}
        {market && (
          <div className="grid grid-cols-2 gap-1 mb-1.5">
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[7px] text-slate-500">Even</span>
                <span className="text-[8px] font-mono text-emerald-400">{market.evenPercent.toFixed(1)}%</span>
              </div>
              <Progress value={market.evenPercent} className="h-0.5 bg-slate-700" />
              
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[7px] text-slate-500">Odd</span>
                <span className="text-[8px] font-mono text-purple-400">{market.oddPercent.toFixed(1)}%</span>
              </div>
              <Progress value={market.oddPercent} className="h-0.5 bg-slate-700" />
            </div>
            
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[7px] text-slate-500">Low (0-4)</span>
                <span className="text-[8px] font-mono text-blue-400">{market.lowPercent.toFixed(1)}%</span>
              </div>
              <Progress value={market.lowPercent} className="h-0.5 bg-slate-700" />
              
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-[7px] text-slate-500">High (5-9)</span>
                <span className="text-[8px] font-mono text-orange-400">{market.highPercent.toFixed(1)}%</span>
              </div>
              <Progress value={market.highPercent} className="h-0.5 bg-slate-700" />
            </div>
          </div>
        )}
        
        {/* Signal */}
        {market?.signal && (
          <div className="bg-slate-800/50 rounded p-1 mb-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[7px] text-slate-500">Signal</span>
              <Badge className={`h-4 px-1 text-[7px] ${
                market.signal === 'EVEN' ? 'bg-emerald-500/20 text-emerald-400' :
                market.signal === 'ODD' ? 'bg-purple-500/20 text-purple-400' :
                market.signal === 'OVER' ? 'bg-blue-500/20 text-blue-400' :
                'bg-orange-500/20 text-orange-400'
              } border-0`}>
                {market.signal} {market.confidence.toFixed(0)}%
              </Badge>
            </div>
          </div>
        )}
        
        {/* Entry System (collapsed) */}
        {!bot.expanded && bot.entryEnabled && (
          <div className="bg-slate-800/50 rounded p-1 mb-1.5">
            <div className="flex items-center gap-1">
              <Target className="w-2.5 h-2.5 text-slate-400" />
              <span className="text-[7px] text-slate-500">Entry:</span>
              <span className="text-[8px] font-mono text-slate-300">
                {bot.entryCondition} {bot.entryDigit}
              </span>
              {bot.entryTriggered && (
                <Badge className="h-3 px-1 text-[6px] bg-emerald-500/20 text-emerald-400 border-0 ml-auto">
                  Triggered
                </Badge>
              )}
            </div>
          </div>
        )}
        
        {/* Stats */}
        <div className="grid grid-cols-3 gap-1 mb-1.5">
          <div className="bg-slate-800/50 rounded p-1">
            <div className="text-[7px] text-slate-500">P&L</div>
            <div className={`text-[9px] font-mono ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              ${bot.totalPnl.toFixed(2)}
            </div>
          </div>
          <div className="bg-slate-800/50 rounded p-1">
            <div className="text-[7px] text-slate-500">W/L</div>
            <div className="text-[9px] font-mono">
              <span className="text-emerald-400">{bot.wins}</span>
              <span className="text-slate-500">/</span>
              <span className="text-rose-400">{bot.losses}</span>
            </div>
          </div>
          <div className="bg-slate-800/50 rounded p-1">
            <div className="text-[7px] text-slate-500">Win%</div>
            <div className="text-[9px] font-mono text-yellow-400">
              {bot.trades > 0 ? ((bot.wins / bot.trades) * 100).toFixed(0) : 0}%
            </div>
          </div>
        </div>
        
        {/* Stake */}
        <div className="flex items-center justify-between bg-slate-800/50 rounded p-1 mb-1.5">
          <span className="text-[7px] text-slate-500">Stake</span>
          <div className="flex items-center gap-1">
            <span className="text-[8px] font-mono text-emerald-400">${bot.currentStake.toFixed(2)}</span>
            {bot.stakeType === 'MARTINGALE' && (
              <Badge variant="outline" className="h-3 px-1 text-[6px] border-slate-600">
                M{bot.martingaleMultiplier}x
              </Badge>
            )}
          </div>
        </div>
        
        {/* Controls */}
        <div className="grid grid-cols-3 gap-1">
          {!bot.running ? (
            <Button
              onClick={() => onStart(bot.id)}
              disabled={!bot.enabled || !bot.market}
              size="sm"
              className="col-span-3 h-5 text-[8px] bg-emerald-600 hover:bg-emerald-700"
            >
              <Play className="w-2.5 h-2.5 mr-1" />
              START
            </Button>
          ) : (
            <>
              <Button
                onClick={() => onPause(bot.id)}
                size="sm"
                variant="outline"
                className="h-5 text-[8px] border-slate-600"
              >
                {bot.paused ? <Play className="w-2.5 h-2.5" /> : <Pause className="w-2.5 h-2.5" />}
              </Button>
              <Button
                onClick={() => onStop(bot.id)}
                size="sm"
                variant="destructive"
                className="h-5 text-[8px] col-span-2"
              >
                <StopCircle className="w-2.5 h-2.5 mr-1" />
                STOP
              </Button>
            </>
          )}
        </div>
        
        {/* Expanded Settings */}
        <AnimatePresence>
          {bot.expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mt-2"
            >
              <Separator className="my-1.5 bg-slate-700" />
              
              {/* Entry System */}
              <div className="space-y-1 mb-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-[8px] text-slate-400">Entry System</Label>
                  <Switch
                    checked={bot.entryEnabled}
                    onCheckedChange={(checked) => onUpdate(bot.id, { entryEnabled: checked })}
                    className="scale-50"
                  />
                </div>
                
                {bot.entryEnabled && (
                  <div className="flex items-center gap-1">
                    <Select
                      value={bot.entryCondition}
                      onValueChange={(value: any) => onUpdate(bot.id, { entryCondition: value })}
                    >
                      <SelectTrigger className="h-4 w-12 text-[7px] bg-slate-800 border-slate-700">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="EQUAL" className="text-[8px]">=</SelectItem>
                        <SelectItem value="GREATER" className="text-[8px]">></SelectItem>
                        <SelectItem value="LESS" className="text-[8px]">{'<'}</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    <Input
                      type="number"
                      min="0"
                      max="9"
                      value={bot.entryDigit}
                      onChange={(e) => onUpdate(bot.id, { entryDigit: parseInt(e.target.value) || 0 })}
                      className="h-4 w-10 text-[7px] bg-slate-800 border-slate-700"
                    />
                    
                    <Badge className="h-4 text-[6px] bg-slate-700 text-slate-300 border-0 ml-auto">
                      {bot.entryTriggered ? 'Triggered' 'Pending'}
                    </Badge>
                  </div>
                )}
              </div>
              
              {/* Risk Management */}
              <div className="space-y-1">
                <Label className="text-[8px] text-slate-400">Risk Settings</Label>
                
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <span className="text-[7px] text-slate-500">TP</span>
                    <Input
                      type="number"
                      value={bot.takeProfit}
                      onChange={(e) => onUpdate(bot.id, { takeProfit: parseFloat(e.target.value) || 0 })}
                      className="h-4 text-[7px] bg-slate-800 border-slate-700"
                    />
                  </div>
                  <div>
                    <span className="text-[7px] text-slate-500">SL</span>
                    <Input
                      type="number"
                      value={bot.stopLoss}
                      onChange={(e) => onUpdate(bot.id, { stopLoss: parseFloat(e.target.value) || 0 })}
                      className="h-4 text-[7px] bg-slate-800 border-slate-700"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-1">
                  <div>
                    <span className="text-[7px] text-slate-500">Stake</span>
                    <Input
                      type="number"
                      value={bot.stake}
                      onChange={(e) => onUpdate(bot.id, { stake: parseFloat(e.target.value) || 0 })}
                      className="h-4 text-[7px] bg-slate-800 border-slate-700"
                    />
                  </div>
                  <div>
                    <span className="text-[7px] text-slate-500">Max Trades</span>
                    <Input
                      type="number"
                      value={bot.maxTrades}
                      onChange={(e) => onUpdate(bot.id, { maxTrades: parseInt(e.target.value) || 0 })}
                      className="h-4 text-[7px] bg-slate-800 border-slate-700"
                    />
                  </div>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-[7px] text-slate-500">Type</span>
                  <Select
                    value={bot.stakeType}
                    onValueChange={(value: any) => onUpdate(bot.id, { stakeType: value })}
                  >
                    <SelectTrigger className="h-4 w-20 text-[7px] bg-slate-800 border-slate-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-slate-800 border-slate-700">
                      <SelectItem value="FIXED" className="text-[8px]">Fixed</SelectItem>
                      <SelectItem value="MARTINGALE" className="text-[8px]">Martingale</SelectItem>
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
                      onChange={(e) => onUpdate(bot.id, { martingaleMultiplier: parseFloat(e.target.value) || 1.1 })}
                      className="h-4 w-16 text-[7px] bg-slate-800 border-slate-700"
                    />
                  </div>
                )}
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
  const { isAuthorized, balance } = useAuth();
  const [bots, setBots] = useState<BotConfig[]>([]);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [darkMode, setDarkMode] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [autoScan, setAutoScan] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);
  
  const { data: marketData, loading, connected } = useMarketData(MARKETS.map(m => m.id));
  const runningRefs = useRef<Record<string, boolean>>({});
  const tradeIdRef = useRef(0);

  // Initialize bots
  useEffect(() => {
    const initial: BotConfig[] = [];
    
    // Create 12 bots (3 rows of 4)
    for (let i = 0; i < 12; i++) {
      const strategy = STRATEGIES[i % 4];
      initial.push({
        id: `bot-${i}`,
        name: `Bot ${i + 1}`,
        strategy,
        market: null,
        enabled: true,
        running: false,
        paused: false,
        status: 'IDLE',
        
        entryEnabled: false,
        entryDigit: 0,
        entryCondition: 'EQUAL',
        entryTriggered: false,
        
        stake: 0.5,
        stakeType: 'FIXED',
        martingaleMultiplier: 2,
        takeProfit: 5,
        stopLoss: 30,
        maxTrades: 100,
        
        trades: 0,
        wins: 0,
        losses: 0,
        totalPnl: 0,
        currentStake: 0.5,
        consecutiveLosses: 0,
        cooldownRemaining: 0,
        lastSignal: false,
        
        expanded: false
      });
    }
    
    setBots(initial);
  }, []);

  // Auto scan best markets
  const scanMarkets = useCallback(() => {
    const markets = Object.entries(marketData)
      .map(([symbol, data]) => ({
        symbol,
        volatility: data.volatility,
        signal: data.signal,
        confidence: data.confidence
      }))
      .sort((a, b) => b.volatility - a.volatility);
    
    setBots(prev => prev.map((bot, i) => {
      const bestMarket = markets[i % markets.length];
      return {
        ...bot,
        market: bestMarket?.symbol || null
      };
    }));
    
    setLastScan(Date.now());
    toast.success(`Assigned best markets to ${bots.length} bots`);
  }, [marketData]);

  // Bot trading logic
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.market || !isAuthorized) return;
    
    const market = marketData[bot.market];
    if (!market) return;
    
    if (balance < bot.currentStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        running: true,
        status: bot.entryEnabled ? 'WAITING_ENTRY' : 'ANALYZING',
        currentStake: bot.stake
      } : b
    ));
    
    runningRefs.current[botId] = true;
    
    let trades = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let totalPnl = bot.totalPnl;
    let currentStake = bot.stake;
    let consecutiveLosses = 0;
    let entryTriggered = !bot.entryEnabled;
    let cooldown = 0;
    
    while (runningRefs.current[botId]) {
      // Check TP/SL
      if (totalPnl <= -bot.stopLoss) {
        toast.error(`${bot.name}: Stop Loss reached`);
        break;
      }
      if (totalPnl >= bot.takeProfit) {
        toast.success(`${bot.name}: Take Profit reached`);
        break;
      }
      if (trades >= bot.maxTrades) {
        toast.info(`${bot.name}: Max trades reached`);
        break;
      }
      
      // Cooldown
      if (cooldown > 0) {
        setBots(prev => prev.map(b => 
          b.id === botId ? { ...b, status: 'COOLDOWN', cooldownRemaining: cooldown } : b
        ));
        await new Promise(r => setTimeout(r, 1000));
        cooldown--;
        continue;
      }
      
      const currentMarket = marketData[bot.market!];
      if (!currentMarket) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      const ticks = currentMarket.ticks;
      const lastDigit = ticks[ticks.length - 1]?.digit;
      
      // Check entry condition
      if (!entryTriggered && bot.entryEnabled) {
        let entryMet = false;
        switch (bot.entryCondition) {
          case 'EQUAL':
            entryMet = lastDigit === bot.entryDigit;
            break;
          case 'GREATER':
            entryMet = lastDigit > bot.entryDigit;
            break;
          case 'LESS':
            entryMet = lastDigit < bot.entryDigit;
            break;
        }
        
        if (entryMet) {
          entryTriggered = true;
          setBots(prev => prev.map(b => 
            b.id === botId ? { ...b, status: 'ANALYZING', entryTriggered: true } : b
          ));
          
          if (soundEnabled) {
            playSound('entry');
          }
        } else {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
      }
      
      // Analyze for entry signal
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, status: 'ANALYZING' } : b
      ));
      
      let shouldEnter = false;
      let prediction = '';
      
      switch (bot.strategy.type) {
        case 'EVEN':
          if (currentMarket.oddPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d % 2 === 1);
            prediction = 'EVEN';
          }
          break;
        case 'ODD':
          if (currentMarket.evenPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d % 2 === 0);
            prediction = 'ODD';
          }
          break;
        case 'OVER':
          if (currentMarket.lowPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d <= 4);
            prediction = 'OVER5';
          }
          break;
        case 'UNDER':
          if (currentMarket.highPercent > bot.strategy.conditions.dominantPercent) {
            shouldEnter = checkConsecutive(ticks, 2, d => d >= 5);
            prediction = 'UNDER4';
          }
          break;
      }
      
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, lastSignal: shouldEnter } : b
      ));
      
      if (!shouldEnter) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
      
      // Ready to trade
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, status: 'READY' } : b
      ));
      
      // Small delay before trading
      await new Promise(r => setTimeout(r, 200));
      
      // Place trade
      setBots(prev => prev.map(b => 
        b.id === botId ? { ...b, status: 'TRADING' } : b
      ));
      
      try {
        const contractType = 
          prediction === 'EVEN' ? 'DIGITEVEN' :
          prediction === 'ODD' ? 'DIGITODD' :
          prediction === 'OVER5' ? 'DIGITOVER' :
          'DIGITUNDER';
        
        const barrier = prediction === 'OVER5' ? '5' : prediction === 'UNDER4' ? '4' : undefined;
        
        const params: any = {
          contract_type: contractType,
          symbol: bot.market,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: currentStake,
        };
        
        if (barrier) params.barrier = barrier;
        
        const id = `${botId}-${Date.now()}`;
        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        
        const won = result.status === 'won';
        const pnl = result.profit;
        
        // Update stats
        trades++;
        totalPnl += pnl;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          currentStake = bot.stake;
          
          if (soundEnabled) playSound('win');
        } else {
          losses++;
          consecutiveLosses++;
          
          if (bot.stakeType === 'MARTINGALE') {
            currentStake = Math.round(currentStake * bot.martingaleMultiplier * 100) / 100;
          }
          
          if (soundEnabled) playSound('loss');
        }
        
        // Add to trade log
        setTrades(prev => [{
          id,
          time: Date.now(),
          botId,
          botName: bot.name,
          market: bot.market!,
          strategy: bot.strategy.name,
          stake: currentStake,
          entry: lastDigit!,
          exit: result.digit,
          result: won ? 'WIN' : 'LOSS',
          pnl,
          confidence: currentMarket.confidence
        }, ...prev].slice(0, 50));
        
        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              trades,
              wins,
              losses,
              totalPnl,
              currentStake,
              consecutiveLosses,
              status: 'ANALYZING',
              cooldownRemaining: !won && (bot.strategy.type === 'EVEN' || bot.strategy.type === 'ODD') ? 3 : 0
            };
          }
          return b;
        }));
        
      } catch (err: any) {
        console.error('Trade error:', err);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        }
      }
      
      await new Promise(r => setTimeout(r, 1000));
    }
    
    setBots(prev => prev.map(b => 
      b.id === botId ? { 
        ...b, 
        running: false, 
        status: 'STOPPED',
        cooldownRemaining: 0,
        entryTriggered: false
      } : b
    ));
    
    runningRefs.current[botId] = false;
  }, [bots, marketData, isAuthorized, balance, soundEnabled]);

  const startBot = (id: string) => {
    const bot = bots.find(b => b.id === id);
    if (!bot || bot.running) return;
    runBot(id);
  };

  const pauseBot = (id: string) => {
    setBots(prev => prev.map(b => 
      b.id === id ? { ...b, paused: !b.paused } : b
    ));
  };

  const stopBot = (id: string) => {
    runningRefs.current[id] = false;
    setBots(prev => prev.map(b => 
      b.id === id ? { 
        ...b, 
        running: false, 
        paused: false,
        status: 'STOPPED',
        cooldownRemaining: 0,
        entryTriggered: false
      } : b
    ));
  };

  const stopAllBots = () => {
    Object.keys(runningRefs.current).forEach(id => {
      runningRefs.current[id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      running: false, 
      paused: false,
      status: 'STOPPED',
      cooldownRemaining: 0,
      entryTriggered: false
    })));
    toast.success('All bots stopped');
  };

  const updateBot = (id: string, updates: Partial<BotConfig>) => {
    setBots(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const clearAll = () => {
    stopAllBots();
    setTrades([]);
    setBots(prev => prev.map(b => ({
      ...b,
      trades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      currentStake: b.stake,
      consecutiveLosses: 0,
      status: 'IDLE',
      entryTriggered: false
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  const playSound = (type: 'entry' | 'win' | 'loss') => {
    // Implement sound playback
  };

  const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
  const totalTrades = bots.reduce((sum, b) => sum + b.trades, 0);
  const totalWins = bots.reduce((sum, b) => sum + b.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans antialiased">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-[#0f172a]/95 backdrop-blur border-b border-slate-800/50">
        <div className="px-3 py-1.5">
          <div className="flex items-center justify-between">
            {/* Left */}
            <div className="flex items-center gap-2">
              <div className="p-1 bg-emerald-500/10 rounded">
                <Brain className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div>
                <h1 className="text-sm font-medium text-slate-200">AI Trading System</h1>
                <p className="text-[9px] text-slate-500">v2.0 • {bots.length} Bots</p>
              </div>
              
              <div className="flex items-center gap-1 ml-2">
                <Badge variant="outline" className="h-4 px-1 text-[8px] border-slate-700">
                  <div className={`w-1 h-1 rounded-full mr-1 ${connected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                  {connected ? 'Live' : 'Offline'}
                </Badge>
                
                <Badge variant="outline" className="h-4 px-1 text-[8px] border-slate-700">
                  Balance: ${balance?.toFixed(2) || '0.00'}
                </Badge>
                
                <Badge variant="outline" className={`h-4 px-1 text-[8px] border-slate-700 ${totalPnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  P&L: ${totalPnl.toFixed(2)}
                </Badge>
                
                <Badge variant="outline" className="h-4 px-1 text-[8px] border-slate-700">
                  Win: {winRate}%
                </Badge>
              </div>
            </div>
            
            {/* Center */}
            <div className="flex items-center gap-1">
              <Button
                onClick={scanMarkets}
                size="sm"
                className="h-5 px-2 text-[8px] bg-emerald-600 hover:bg-emerald-700"
              >
                <Scan className="w-2.5 h-2.5 mr-1" />
                SCAN
              </Button>
              
              <Button
                onClick={stopAllBots}
                size="sm"
                variant="destructive"
                className="h-5 px-2 text-[8px]"
                disabled={!bots.some(b => b.running)}
              >
                <StopCircle className="w-2.5 h-2.5 mr-1" />
                STOP ALL
              </Button>
              
              <Button
                onClick={clearAll}
                size="sm"
                variant="outline"
                className="h-5 px-2 text-[8px] border-slate-700"
              >
                <Trash2 className="w-2.5 h-2.5 mr-1" />
                CLEAR
              </Button>
            </div>
            
            {/* Right */}
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
              >
                {viewMode === 'grid' ? (
                  <List className="w-2.5 h-2.5 text-slate-400" />
                ) : (
                  <Grid3X3 className="w-2.5 h-2.5 text-slate-400" />
                )}
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setSoundEnabled(!soundEnabled)}
              >
                {soundEnabled ? (
                  <Volume2 className="w-2.5 h-2.5 text-slate-400" />
                ) : (
                  <VolumeX className="w-2.5 h-2.5 text-slate-400" />
                )}
              </Button>
              
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={() => setDarkMode(!darkMode)}
              >
                {darkMode ? (
                  <Moon className="w-2.5 h-2.5 text-slate-400" />
                ) : (
                  <Sun className="w-2.5 h-2.5 text-slate-400" />
                )}
              </Button>
            </div>
          </div>
          
          {/* Last scan */}
          {lastScan && (
            <div className="flex items-center justify-end mt-0.5">
              <span className="text-[7px] text-slate-600">
                Last scan: {new Date(lastScan).toLocaleTimeString()}
              </span>
            </div>
          )}
        </div>
      </div>
      
      {/* Main Content */}
      <div className="p-2">
        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="w-3 h-3 animate-spin text-emerald-400 mr-1" />
            <span className="text-[9px] text-slate-400">Loading market data...</span>
          </div>
        )}
        
        {/* Bots Grid */}
        <div className={viewMode === 'grid' 
          ? "grid grid-cols-4 gap-1.5" 
          : "grid grid-cols-1 gap-1"
        }>
          {bots.map(bot => (
            <BotCard
              key={bot.id}
              bot={bot}
              market={bot.market ? marketData[bot.market] : undefined}
              onStart={startBot}
              onStop={stopBot}
              onPause={pauseBot}
              onUpdate={updateBot}
              onExpand={(id) => updateBot(id, { expanded: !bots.find(b => b.id === id)?.expanded })}
            />
          ))}
        </div>
        
        {/* Trade Log */}
        <Card className="mt-2 bg-[#1e293b] border-slate-700/50">
          <CardContent className="p-2">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[10px] font-medium text-slate-400">TRADE LOG</h2>
              <Badge variant="outline" className="h-3.5 px-1 text-[7px] border-slate-700">
                {trades.length} trades
              </Badge>
            </div>
            
            <div className="max-h-[120px] overflow-y-auto">
              {trades.length === 0 ? (
                <div className="text-center py-2 text-[8px] text-slate-600">
                  No trades yet
                </div>
              ) : (
                <div className="space-y-0.5">
                  {trades.map(trade => (
                    <div
                      key={trade.id}
                      className="flex items-center justify-between py-0.5 px-1 bg-slate-800/30 rounded text-[8px]"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500">
                          {new Date(trade.time).toLocaleTimeString()}
                        </span>
                        <Badge className="h-3 px-1 text-[6px] bg-slate-700 text-slate-300 border-0">
                          {trade.botName}
                        </Badge>
                        <span className="text-slate-400">{trade.market}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-300">${trade.stake.toFixed(2)}</span>
                        <span className={`font-mono ${trade.result === 'WIN' ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {trade.result === 'WIN' ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}
                        </span>
                        <Badge className={`h-3 px-1 text-[6px] ${
                          trade.result === 'WIN' 
                            ? 'bg-emerald-500/20 text-emerald-400' 
                            : 'bg-rose-500/20 text-rose-400'
                        } border-0`}>
                          {trade.result}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
        
        {/* Footer */}
        <div className="mt-1 text-center text-[6px] text-slate-700">
          AI Trading System • Real-time Data • {bots.filter(b => b.running).length} Active Bots
        </div>
      </div>
    </div>
  );
}
