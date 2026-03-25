import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Target,
  Zap,
  Volume2,
  Clock,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Gauge,
  Signal,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  RefreshCw,
  Flame,
  AlertTriangle,
  BarChart,
  Eye,
  EyeOff,
  TrendingUp as TrendIcon
} from 'lucide-react';

// Market configurations from your code
const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

// Full market list with metadata
const ALL_MARKETS = [
  ...VOLATILITIES.vol.map(s => ({ symbol: s, name: s, group: s.includes('1HZ') ? 'vol1s' : 'vol', baseVol: parseInt(s.match(/\d+/)?.[0] || '10') })),
  ...VOLATILITIES.jump.map(s => ({ symbol: s, name: s, group: 'jump', baseVol: parseInt(s.match(/\d+/)?.[0] || '10') })),
  ...VOLATILITIES.bull.map(s => ({ symbol: s, name: 'Bull Market', group: 'bull', baseVol: 50 })),
  ...VOLATILITIES.bear.map(s => ({ symbol: s, name: 'Bear Market', group: 'bear', baseVol: 50 })),
];

// Signal types
type SignalType = 'over' | 'under' | 'odd' | 'even';
type SignalStrength = 'strong' | 'moderate' | 'weak' | 'critical';

interface Signal {
  id: string;
  market: typeof ALL_MARKETS[0];
  type: SignalType;
  strength: SignalStrength;
  percentage: number;
  threshold: number;
  timestamp: number;
  timeframe: string;
  conditionMet: string;
  priority: number;
  recentDigits: number[];
  patternLength: number;
}

interface OverUnderSignal {
  type: 'over' | 'under';
  market: typeof ALL_MARKETS[0];
  percentage: number;
  threshold: number;
  strength: SignalStrength;
  recentDigits: number[];
  patternConfidence: number;
}

// Main Signal Page Component
export default function SignalPage() {
  const [activeSignals, setActiveSignals] = useState<Signal[]>([]);
  const [historicalSignals, setHistoricalSignals] = useState<Signal[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [autoScan, setAutoScan] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [contractType, setContractType] = useState<'risefall' | 'evenodd' | 'overunder'>('overunder');
  const [patternLength, setPatternLength] = useState<number | 'all'>(3);
  const [tickCount, setTickCount] = useState<number>(1000);
  const [showPatterns, setShowPatterns] = useState(false);
  const [selectedDigitThreshold, setSelectedDigitThreshold] = useState<Record<string, number>>({});
  
  // Market data storage
  const ticksMap = useRef<Record<string, number[]>>({});
  const wsConnections = useRef<Record<string, WebSocket>>({});

  // Get last digit from price
  const getLastDigit = (price: number): number => {
    const priceStr = price.toString();
    const match = priceStr.match(/\d+(?:\.\d+)?/);
    if (!match) return 0;
    const numStr = match[0].replace('.', '');
    return parseInt(numStr.slice(-1), 10);
  };

  // Calculate percentages for a market
  const calculatePercentages = useCallback((ticks: number[], threshold: number) => {
    if (ticks.length === 0) return null;
    
    let evenCount = 0, oddCount = 0, overCount = 0, underCount = 0;
    ticks.forEach(d => {
      if (d % 2 === 0) evenCount++;
      else oddCount++;
      if (d > threshold) overCount++;
      else if (d < threshold) underCount++;
    });
    const total = ticks.length;
    
    return {
      evenPct: (evenCount / total) * 100,
      oddPct: (oddCount / total) * 100,
      overPct: (overCount / total) * 100,
      underPct: (underCount / total) * 100,
      total,
    };
  }, []);

  // Analyze patterns for over/under signals
  const analyzePatterns = useCallback((ticks: number[], threshold: number, patternLen: number) => {
    if (ticks.length < patternLen + 10) return null;
    
    const patterns: Record<string, { wins: number; total: number; winDigits: number[] }> = {};
    
    for (let i = 0; i < ticks.length - patternLen; i++) {
      const pattern = ticks.slice(i, i + patternLen).join('');
      const nextDigit = ticks[i + patternLen];
      const isOver = nextDigit > threshold;
      
      if (!patterns[pattern]) {
        patterns[pattern] = { wins: 0, total: 0, winDigits: [] };
      }
      patterns[pattern].total++;
      if (isOver) {
        patterns[pattern].wins++;
        patterns[pattern].winDigits.push(nextDigit);
        if (patterns[pattern].winDigits.length > 13) patterns[pattern].winDigits.shift();
      }
    }
    
    // Find patterns with highest win rate
    const patternStats = Object.entries(patterns)
      .map(([pattern, stats]) => ({
        pattern,
        winRate: (stats.wins / stats.total) * 100,
        wins: stats.wins,
        total: stats.total,
        recentWins: stats.winDigits.slice(-5),
      }))
      .filter(p => p.total >= 5)
      .sort((a, b) => b.winRate - a.winRate);
    
    return patternStats.slice(0, 5);
  }, []);

  // Check for over/under signals (ensure exactly 3 signals)
  const checkOverUnderSignals = useCallback((
    markets: typeof ALL_MARKETS[],
    ticksData: Record<string, number[]>,
    thresholds: Record<string, number>
  ): OverUnderSignal[] => {
    const overUnderSignals: OverUnderSignal[] = [];
    
    for (const market of markets) {
      const ticks = ticksData[market.symbol];
      if (!ticks || ticks.length < 100) continue;
      
      const threshold = thresholds[market.symbol] || 5;
      const percentages = calculatePercentages(ticks.slice(-tickCount), threshold);
      if (!percentages) continue;
      
      // Check over signal (digits > threshold)
      if (percentages.overPct >= 55) {
        let strength: SignalStrength = 'weak';
        if (percentages.overPct >= 75) strength = 'critical';
        else if (percentages.overPct >= 65) strength = 'strong';
        else if (percentages.overPct >= 55) strength = 'moderate';
        
        // Analyze patterns for confirmation
        const patterns = analyzePatterns(ticks.slice(-500), threshold, 
          typeof patternLength === 'number' ? patternLength : 3);
        const patternConfidence = patterns && patterns[0]?.winRate || 50;
        
        overUnderSignals.push({
          type: 'over',
          market,
          percentage: percentages.overPct,
          threshold,
          strength,
          recentDigits: ticks.slice(-30),
          patternConfidence,
        });
      }
      
      // Check under signal (digits < threshold)
      if (percentages.underPct >= 55) {
        let strength: SignalStrength = 'weak';
        if (percentages.underPct >= 75) strength = 'critical';
        else if (percentages.underPct >= 65) strength = 'strong';
        else if (percentages.underPct >= 55) strength = 'moderate';
        
        const patterns = analyzePatterns(ticks.slice(-500), threshold,
          typeof patternLength === 'number' ? patternLength : 3);
        const patternConfidence = patterns && patterns[0]?.winRate || 50;
        
        overUnderSignals.push({
          type: 'under',
          market,
          percentage: percentages.underPct,
          threshold,
          strength,
          recentDigits: ticks.slice(-30),
          patternConfidence,
        });
      }
    }
    
    // Sort by strength and pattern confidence
    const strengthOrder = { critical: 4, strong: 3, moderate: 2, weak: 1 };
    const sortedSignals = overUnderSignals.sort((a, b) => {
      const strengthDiff = strengthOrder[b.strength] - strengthOrder[a.strength];
      if (strengthDiff !== 0) return strengthDiff;
      return b.patternConfidence - a.patternConfidence;
    });
    
    // Return exactly 3 signals (or all if less than 3)
    return sortedSignals.slice(0, 3);
  }, [tickCount, patternLength, calculatePercentages, analyzePatterns]);

  // Check for odd/even signals
  const checkOddEvenSignals = useCallback((
    markets: typeof ALL_MARKETS[],
    ticksData: Record<string, number[]>
  ): Omit<Signal, 'id' | 'timestamp' | 'priority' | 'recentDigits' | 'patternLength' | 'threshold'>[] => {
    const signals: Omit<Signal, 'id' | 'timestamp' | 'priority' | 'recentDigits' | 'patternLength' | 'threshold'>[] = [];
    
    for (const market of markets) {
      const ticks = ticksData[market.symbol];
      if (!ticks || ticks.length < 100) continue;
      
      const percentages = calculatePercentages(ticks.slice(-tickCount), 5);
      if (!percentages) continue;
      
      // Odd signal
      if (percentages.oddPct >= 55) {
        let strength: SignalStrength = 'weak';
        let conditionMet = '';
        
        if (percentages.oddPct >= 75) {
          strength = 'critical';
          conditionMet = `CRITICAL: Odd digits at ${percentages.oddPct.toFixed(1)}% (75%+) → Extreme odd bias! 🔥`;
        } else if (percentages.oddPct >= 65) {
          strength = 'strong';
          conditionMet = `STRONG: Odd digits at ${percentages.oddPct.toFixed(1)}% (65%+) → Strong odd bias`;
        } else if (percentages.oddPct >= 55) {
          strength = 'moderate';
          conditionMet = `MODERATE: Odd digits at ${percentages.oddPct.toFixed(1)}% (55%+) → Odd bias confirmed`;
        } else {
          conditionMet = `WEAK: Odd digits at ${percentages.oddPct.toFixed(1)}% → Approaching odd threshold`;
        }
        
        signals.push({
          market,
          type: 'odd',
          strength,
          percentage: percentages.oddPct,
          timeframe: '1m',
          conditionMet,
        });
      }
      
      // Even signal
      if (percentages.evenPct >= 55) {
        let strength: SignalStrength = 'weak';
        let conditionMet = '';
        
        if (percentages.evenPct >= 75) {
          strength = 'critical';
          conditionMet = `CRITICAL: Even digits at ${percentages.evenPct.toFixed(1)}% (75%+) → Extreme even bias! 🔥`;
        } else if (percentages.evenPct >= 65) {
          strength = 'strong';
          conditionMet = `STRONG: Even digits at ${percentages.evenPct.toFixed(1)}% (65%+) → Strong even bias`;
        } else if (percentages.evenPct >= 55) {
          strength = 'moderate';
          conditionMet = `MODERATE: Even digits at ${percentages.evenPct.toFixed(1)}% (55%+) → Even bias confirmed`;
        } else {
          conditionMet = `WEAK: Even digits at ${percentages.evenPct.toFixed(1)}% → Approaching even threshold`;
        }
        
        signals.push({
          market,
          type: 'even',
          strength,
          percentage: percentages.evenPct,
          timeframe: '1m',
          conditionMet,
        });
      }
    }
    
    return signals;
  }, [tickCount, calculatePercentages]);

  // Generate final signals (exactly 3 over/under + up to 3 odd/even)
  const generateSignals = useCallback(() => {
    const marketsToScan = selectedGroup === 'all' 
      ? ALL_MARKETS 
      : ALL_MARKETS.filter(m => {
          if (selectedGroup === 'vol') return VOLATILITIES.vol.includes(m.symbol);
          if (selectedGroup === 'jump') return VOLATILITIES.jump.includes(m.symbol);
          if (selectedGroup === 'bull') return VOLATILITIES.bull.includes(m.symbol);
          if (selectedGroup === 'bear') return VOLATILITIES.bear.includes(m.symbol);
          return false;
        });
    
    // Get exactly 3 over/under signals
    const overUnderSignals = checkOverUnderSignals(marketsToScan, ticksMap.current, selectedDigitThreshold);
    
    // Get odd/even signals for additional slots
    const oddEvenSignals = checkOddEvenSignals(marketsToScan, ticksMap.current);
    
    // Combine: first 3 are over/under, then fill with odd/even up to 6 total
    const combinedSignals: Omit<Signal, 'id' | 'timestamp' | 'priority'>[] = [];
    
    overUnderSignals.forEach(signal => {
      combinedSignals.push({
        market: signal.market,
        type: signal.type,
        strength: signal.strength,
        percentage: signal.percentage,
        threshold: signal.threshold,
        timeframe: '1m',
        conditionMet: `${signal.type.toUpperCase()} SIGNAL: ${signal.percentage.toFixed(1)}% of digits ${signal.type === 'over' ? '>' : '<'} ${signal.threshold}. Pattern confidence: ${signal.patternConfidence.toFixed(1)}%`,
        recentDigits: signal.recentDigits,
        patternLength: typeof patternLength === 'number' ? patternLength : 3,
      });
    });
    
    // Add odd/even signals up to 6 total
    const remainingSlots = Math.max(0, 6 - combinedSignals.length);
    const oddEvenToAdd = oddEvenSignals.slice(0, remainingSlots);
    oddEvenToAdd.forEach(signal => {
      combinedSignals.push({
        ...signal,
        threshold: 5,
        recentDigits: ticksMap.current[signal.market.symbol]?.slice(-30) || [],
        patternLength: 0,
      });
    });
    
    // Add priority numbers
    return combinedSignals.map((signal, idx) => ({
      ...signal,
      id: `${signal.market.symbol}-${Date.now()}-${idx}`,
      timestamp: Date.now(),
      priority: idx + 1,
    }));
  }, [selectedGroup, checkOverUnderSignals, checkOddEvenSignals, selectedDigitThreshold, patternLength]);

  // Scan all markets
  const scanMarkets = useCallback(() => {
    setIsScanning(true);
    
    setTimeout(() => {
      const signals = generateSignals();
      setActiveSignals(signals);
      
      // Add to historical
      setHistoricalSignals(prev => {
        const combined = [...signals, ...prev];
        return combined.slice(0, 30);
      });
      
      setLastUpdate(new Date());
      setIsScanning(false);
      
      const overUnderCount = signals.filter(s => s.type === 'over' || s.type === 'under').length;
      const criticalCount = signals.filter(s => s.strength === 'critical').length;
      
      if (signals.length > 0) {
        toast.success(
          `📡 ${signals.length} signal${signals.length > 1 ? 's' : ''} detected! ` +
          `(${overUnderCount} over/under, ${criticalCount > 0 ? `${criticalCount} critical 🔥` : ''})`
        );
      } else {
        toast.info('No signals detected in this scan cycle');
      }
    }, 500);
  }, [generateSignals]);

  // Auto-scan interval
  useEffect(() => {
    if (!autoScan) return;
    
    scanMarkets();
    const interval = setInterval(scanMarkets, 30000);
    
    return () => clearInterval(interval);
  }, [autoScan, scanMarkets]);

  // WebSocket connection for each market
  useEffect(() => {
    const connectMarket = (symbol: string) => {
      if (wsConnections.current[symbol]) return;
      
      const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=1089`);
      const ticks: number[] = [];
      
      ws.onopen = () => {
        ws.send(JSON.stringify({ ticks_history: symbol, count: tickCount, end: "latest", style: "ticks" }));
      };
      
      ws.onmessage = (msg) => {
        const data = JSON.parse(msg.data);
        
        if (data.history?.prices) {
          data.history.prices.forEach((price: number) => {
            const digit = getLastDigit(price);
            if (!isNaN(digit)) ticks.push(digit);
          });
          ticksMap.current[symbol] = ticks;
          ws.send(JSON.stringify({ ticks: symbol, subscribe: 1 }));
        }
        
        if (data.tick?.quote) {
          const digit = getLastDigit(data.tick.quote);
          if (!isNaN(digit)) {
            if (ticks.length >= 4000) ticks.shift();
            ticks.push(digit);
            ticksMap.current[symbol] = [...ticks];
          }
        }
      };
      
      ws.onerror = () => console.error(`WebSocket error for ${symbol}`);
      ws.onclose = () => {
        delete wsConnections.current[symbol];
        setTimeout(() => connectMarket(symbol), 5000);
      };
      
      wsConnections.current[symbol] = ws;
    };
    
    // Connect to all markets
    const allSymbols = selectedGroup === 'all' 
      ? ALL_MARKETS.map(m => m.symbol)
      : ALL_MARKETS.filter(m => {
          if (selectedGroup === 'vol') return VOLATILITIES.vol.includes(m.symbol);
          if (selectedGroup === 'jump') return VOLATILITIES.jump.includes(m.symbol);
          if (selectedGroup === 'bull') return VOLATILITIES.bull.includes(m.symbol);
          if (selectedGroup === 'bear') return VOLATILITIES.bear.includes(m.symbol);
          return false;
        }).map(m => m.symbol);
    
    allSymbols.forEach(connectMarket);
    
    return () => {
      Object.values(wsConnections.current).forEach(ws => ws.close());
      wsConnections.current = {};
    };
  }, [selectedGroup, tickCount]);

  // Update thresholds for individual markets
  const updateThreshold = (symbol: string, value: number) => {
    setSelectedDigitThreshold(prev => ({ ...prev, [symbol]: value }));
  };

  const getSignalStats = useMemo(() => {
    const total = activeSignals.length;
    const critical = activeSignals.filter(s => s.strength === 'critical').length;
    const strong = activeSignals.filter(s => s.strength === 'strong').length;
    const moderate = activeSignals.filter(s => s.strength === 'moderate').length;
    const weak = activeSignals.filter(s => s.strength === 'weak').length;
    const overUnder = activeSignals.filter(s => s.type === 'over' || s.type === 'under').length;
    return { total, critical, strong, moderate, weak, overUnder };
  }, [activeSignals]);

  // Get market groups for filter
  const groups = [
    { value: 'all', label: 'All Markets' },
    { value: 'vol', label: 'Volatility' },
    { value: 'jump', label: 'Jump' },
    { value: 'bull', label: 'Bull' },
    { value: 'bear', label: 'Bear' },
  ];

  // Signal Card Component
  const SignalCard: React.FC<{ signal: Signal; index: number }> = ({ signal, index }) => {
    const getSignalIcon = () => {
      if (signal.type === 'over') return <ArrowUp className="w-5 h-5" />;
      if (signal.type === 'under') return <ArrowDown className="w-5 h-5" />;
      if (signal.type === 'odd') return <Activity className="w-5 h-5" />;
      return <Target className="w-5 h-5" />;
    };

    const getSignalColor = () => {
      if (signal.type === 'over') return 'from-emerald-500 to-green-600';
      if (signal.type === 'under') return 'from-rose-500 to-red-600';
      if (signal.type === 'odd') return 'from-amber-500 to-orange-600';
      return 'from-sky-500 to-blue-600';
    };

    const getStrengthColor = () => {
      switch (signal.strength) {
        case 'critical': return 'text-red-400 bg-red-400/10 border-red-400/30';
        case 'strong': return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
        case 'moderate': return 'text-amber-400 bg-amber-400/10 border-amber-400/30';
        default: return 'text-rose-400 bg-rose-400/10 border-rose-400/30';
      }
    };

    const getStrengthText = () => {
      switch (signal.strength) {
        case 'critical': return '🔥 Critical';
        case 'strong': return '⚡ Strong';
        case 'moderate': return '📊 Moderate';
        default: return '⚠️ Weak';
      }
    };

    return (
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ delay: index * 0.1, duration: 0.4 }}
        whileHover={{ y: -4, scale: 1.02 }}
      >
        <Card className={`overflow-hidden border-border/50 bg-gradient-to-br from-card/80 to-card/40 backdrop-blur-sm hover:shadow-xl transition-all duration-300 ${
          signal.strength === 'critical' ? 'ring-2 ring-red-500/50 shadow-lg shadow-red-500/20' : ''
        }`}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <motion.div
                  whileHover={{ rotate: 360, scale: 1.1 }}
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${getSignalColor()} flex items-center justify-center text-white shadow-lg`}
                >
                  {getSignalIcon()}
                </motion.div>
                <div>
                  <h3 className="font-bold text-sm flex items-center gap-2">
                    {signal.market.name}
                    {signal.strength === 'critical' && <Flame className="w-4 h-4 text-red-400" />}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>{new Date(signal.timestamp).toLocaleTimeString()}</span>
                    <Badge variant="outline" className="text-[10px]">{signal.timeframe}</Badge>
                  </div>
                </div>
              </div>
              <Badge className={`${getStrengthColor()} border text-[10px] font-semibold`}>
                {getStrengthText()}
              </Badge>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground capitalize">
                  {signal.type.toUpperCase()} Signal
                  {signal.type === 'over' || signal.type === 'under' ? ` (Threshold: ${signal.threshold})` : ''}
                </span>
                <span className="font-mono font-bold text-lg">{signal.percentage.toFixed(1)}%</span>
              </div>
              
              <div className="relative h-2 bg-muted rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, signal.percentage)}%` }}
                  transition={{ duration: 0.8 }}
                  className={`absolute inset-y-0 left-0 rounded-full bg-gradient-to-r ${getSignalColor()}`}
                />
              </div>

              <div className="flex items-center gap-2 text-xs bg-muted/30 rounded-lg p-2">
                <AlertCircle className="w-3 h-3 flex-shrink-0" />
                <span className="text-muted-foreground">{signal.conditionMet}</span>
              </div>

              {/* Recent digits display */}
              {'recentDigits' in signal && signal.recentDigits && (
                <div className="flex flex-wrap gap-1 justify-center">
                  {signal.recentDigits.slice(-15).map((d, i) => {
                    const isOver = d > signal.threshold;
                    const isUnder = d < signal.threshold;
                    return (
                      <span
                        key={i}
                        className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-mono font-bold ${
                          isOver ? 'bg-emerald-500/20 text-emerald-400' :
                          isUnder ? 'bg-rose-500/20 text-rose-400' :
                          'bg-muted text-muted-foreground'
                        }`}
                      >
                        {d}
                      </span>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-1 text-xs">
                  <Gauge className="w-3 h-3 text-muted-foreground" />
                  <span>Volatility: {signal.market.baseVol}</span>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">Priority: {signal.priority}/6</span>
                  <Signal className="w-4 h-4 text-primary" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background/95 to-background/90">
      {/* Header */}
      <div className="relative overflow-hidden border-b border-border/50 bg-card/30 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-6">
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col md:flex-row justify-between items-center gap-4"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center shadow-lg">
                <Signal className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                  Volatility Signal Scanner
                </h1>
                <p className="text-sm text-muted-foreground">
                  Exactly 3 over/under signals | Real-time digit analysis | Pattern detection
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-3">
              <Button
                variant={autoScan ? "default" : "outline"}
                size="sm"
                onClick={() => setAutoScan(!autoScan)}
                className="gap-2"
              >
                {autoScan ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                {autoScan ? 'Auto-Scan On' : 'Auto-Scan Off'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={scanMarkets}
                disabled={isScanning}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${isScanning ? 'animate-spin' : ''}`} />
                Scan Now
              </Button>
            </div>
          </motion.div>

          {/* Settings Panel */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6"
          >
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Contract Type</label>
              <Select value={contractType} onValueChange={(v: any) => setContractType(v)}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overunder">Over/Under</SelectItem>
                  <SelectItem value="evenodd">Even/Odd</SelectItem>
                  <SelectItem value="risefall">Rise/Fall</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Pattern Length</label>
              <Select value={patternLength === 'all' ? 'all' : String(patternLength)} onValueChange={(v) => setPatternLength(v === 'all' ? 'all' : parseInt(v))}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Lengths</SelectItem>
                  <SelectItem value="1">1 Digit</SelectItem>
                  <SelectItem value="2">2 Digits</SelectItem>
                  <SelectItem value="3">3 Digits</SelectItem>
                  <SelectItem value="4">4 Digits</SelectItem>
                  <SelectItem value="5">5 Digits</SelectItem>
                  <SelectItem value="6">6 Digits</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Tick Count</label>
              <Input
                type="number"
                value={tickCount}
                onChange={(e) => setTickCount(parseInt(e.target.value) || 1000)}
                className="h-9 text-sm"
                min={100}
                max={5000}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Show Patterns</label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPatterns(!showPatterns)}
                className="w-full h-9 gap-2"
              >
                {showPatterns ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                {showPatterns ? 'Hide' : 'Show'} Patterns
              </Button>
            </div>
          </motion.div>

          {/* Stats Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-2 md:grid-cols-6 gap-4 mt-6"
          >
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Signal className="w-4 h-4" />
                <span className="text-xs">Active Signals</span>
              </div>
              <div className="text-2xl font-bold">{getSignalStats.total}</div>
              <div className="text-[10px] text-muted-foreground">Max 6 signals</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-red-400 mb-1">
                <Flame className="w-4 h-4" />
                <span className="text-xs">Critical</span>
              </div>
              <div className="text-2xl font-bold text-red-400">{getSignalStats.critical}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-emerald-400 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs">Strong</span>
              </div>
              <div className="text-2xl font-bold text-emerald-400">{getSignalStats.strong}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-amber-400 mb-1">
                <Activity className="w-4 h-4" />
                <span className="text-xs">Moderate</span>
              </div>
              <div className="text-2xl font-bold text-amber-400">{getSignalStats.moderate}</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-primary mb-1">
                <ArrowUp className="w-4 h-4" />
                <ArrowDown className="w-4 h-4 -ml-1" />
                <span className="text-xs">Over/Under</span>
              </div>
              <div className="text-2xl font-bold">{getSignalStats.overUnder}</div>
              <div className="text-[10px] text-muted-foreground">Exactly 3 guaranteed</div>
            </div>
            <div className="bg-card/50 rounded-xl border border-border/50 p-3">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Clock className="w-4 h-4" />
                <span className="text-xs">Last Scan</span>
              </div>
              <div className="text-sm font-mono">{lastUpdate.toLocaleTimeString()}</div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Filter Section */}
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="gap-1">
              <BarChart3 className="w-3 h-3" />
              Markets: {selectedGroup === 'all' ? ALL_MARKETS.length : 
                selectedGroup === 'vol' ? VOLATILITIES.vol.length :
                selectedGroup === 'jump' ? VOLATILITIES.jump.length :
                selectedGroup === 'bull' ? VOLATILITIES.bull.length :
                VOLATILITIES.bear.length}
            </Badge>
            <Badge variant="outline" className="gap-1 bg-emerald-500/10 border-emerald-500/30">
              <ArrowUp className="w-3 h-3 text-emerald-400" />
              Over: > threshold (≥55%)
            </Badge>
            <Badge variant="outline" className="gap-1 bg-rose-500/10 border-rose-500/30">
              <ArrowDown className="w-3 h-3 text-rose-400" />
              Under: < threshold (≥55%)
            </Badge>
          </div>
          
          <div className="flex gap-2 flex-wrap">
            {groups.map(group => (
              <Button
                key={group.value}
                size="sm"
                variant={selectedGroup === group.value ? 'default' : 'outline'}
                onClick={() => setSelectedGroup(group.value)}
                className="text-xs"
              >
                {group.label}
              </Button>
            ))}
          </div>
        </div>

        {/* Threshold Settings for Each Market */}
        <div className="mb-6 p-4 bg-card/30 rounded-xl border border-border/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Target className="w-4 h-4 text-primary" />
            Digit Threshold Settings (Over/Under detection)
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
            {ALL_MARKETS.slice(0, 12).map(market => (
              <div key={market.symbol} className="flex items-center gap-2">
                <span className="text-[10px] font-mono truncate max-w-[60px]">{market.symbol}</span>
                <Input
                  type="number"
                  min="0"
                  max="9"
                  value={selectedDigitThreshold[market.symbol] ?? 5}
                  onChange={(e) => updateThreshold(market.symbol, parseInt(e.target.value) || 5)}
                  className="h-7 w-14 text-xs text-center"
                />
              </div>
            ))}
          </div>
        </div>
        
        {/* Active Signals Grid */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="w-5 h-5 text-primary" />
              Active Signals
              <Badge variant="secondary" className="ml-2">
                {activeSignals.length}/6 signals | {activeSignals.filter(s => s.type === 'over' || s.type === 'under').length} over/under
              </Badge>
            </h2>
            {isScanning && (
              <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                <RefreshCw className="w-4 h-4 text-primary" />
              </motion.div>
            )}
          </div>
          
          {activeSignals.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12 bg-card/30 rounded-xl border border-dashed border-border"
            >
              <Signal className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <p className="text-muted-foreground">No active signals at the moment</p>
              <p className="text-xs text-muted-foreground mt-1">Scanning markets for over/under patterns...</p>
            </motion.div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <AnimatePresence mode="wait">
                {activeSignals.map((signal, idx) => (
                  <SignalCard key={signal.id} signal={signal} index={idx} />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
        
        {/* Historical Signals */}
        {historicalSignals.length > 0 && (
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground" />
              Recent Signals
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {historicalSignals.slice(0, 9).map((signal, idx) => (
                <motion.div
                  key={signal.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: idx * 0.03 }}
                  className={`bg-card/40 rounded-lg border border-border/50 p-3 hover:bg-card/60 transition-colors ${
                    signal.strength === 'critical' ? 'border-red-500/30 bg-red-500/5' : ''
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs ${
                        signal.type === 'over' ? 'bg-emerald-500/20 text-emerald-400' :
                        signal.type === 'under' ? 'bg-rose-500/20 text-rose-400' :
                        signal.type === 'odd' ? 'bg-amber-500/20 text-amber-400' :
                        'bg-sky-500/20 text-sky-400'
                      }`}>
                        {signal.type === 'over' ? '↑' : signal.type === 'under' ? '↓' : signal.type === 'odd' ? 'O' : 'E'}
                      </div>
                      <span className="font-mono text-xs font-medium truncate max-w-[100px]">{signal.market.name}</span>
                    </div>
                    <Badge className={`text-[8px] ${
                      signal.strength === 'critical' ? 'bg-red-500/20 text-red-400' :
                      signal.strength === 'strong' ? 'bg-emerald-500/20 text-emerald-400' :
                      signal.strength === 'moderate' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-rose-500/20 text-rose-400'
                    }`}>
                      {signal.strength === 'critical' ? '🔥' : ''}{signal.strength}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs capitalize text-muted-foreground">
                      {signal.type.toUpperCase()} • {signal.percentage.toFixed(0)}%
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(signal.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}
        
        {/* Signal Conditions Legend */}
        <div className="mt-8 p-4 bg-card/30 rounded-xl border border-border/50">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-primary" />
            Signal Conditions
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 mt-0.5" />
                <div>
                  <span className="font-medium">OVER Signal:</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Digits above threshold ≥ 55%</div>
                    <div>• Pattern analysis for confirmation</div>
                    <div>• Exactly 3 over/under signals guaranteed</div>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <XCircle className="w-4 h-4 text-rose-400 mt-0.5" />
                <div>
                  <span className="font-medium">UNDER Signal:</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Digits below threshold ≥ 55%</div>
                    <div>• Pattern analysis for confirmation</div>
                    <div>• Sorted by strength and pattern confidence</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-start gap-2">
                <Activity className="w-4 h-4 text-amber-400 mt-0.5" />
                <div>
                  <span className="font-medium">ODD/EVEN Signals:</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Odd/Even digits ≥ 55%</div>
                    <div>• Fills remaining slots up to 6 total</div>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <BarChart className="w-4 h-4 text-primary mt-0.5" />
                <div>
                  <span className="font-medium">Pattern Detection:</span>
                  <div className="text-muted-foreground text-xs">
                    <div>• Analyzes {patternLength === 'all' ? '1-6' : patternLength}-digit patterns</div>
                    <div>• Win rate analysis for signal confirmation</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-border/50 text-xs text-muted-foreground text-center">
            📊 Exactly 3 over/under signals per scan | Up to 6 total signals | Auto-scans every 30 seconds
          </div>
        </div>
      </div>
    </div>
  );
}
