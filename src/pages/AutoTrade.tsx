import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { derivApi, type MarketSymbol } from '@/services/deriv-api';
import { copyTradingService } from '@/services/copy-trading-service';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useLossRequirement } from '@/hooks/useLossRequirement';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload, Target, Activity, ArrowUp, ArrowDown,
} from 'lucide-react';
import ConfigPreview, { type BotConfig } from '@/components/bot-config/ConfigPreview';

/* ───── CONSTANTS ───── */
const SCANNER_MARKETS: { symbol: string; name: string }[] = [
  { symbol: 'R_10', name: 'Vol 10' }, { symbol: 'R_25', name: 'Vol 25' },
  { symbol: 'R_50', name: 'Vol 50' }, { symbol: 'R_75', name: 'Vol 75' },
  { symbol: 'R_100', name: 'Vol 100' },
  { symbol: '1HZ10V', name: 'V10 1s' }, { symbol: '1HZ25V', name: 'V25 1s' },
  { symbol: '1HZ50V', name: 'V50 1s' }, { symbol: '1HZ75V', name: 'V75 1s' },
  { symbol: '1HZ100V', name: 'V100 1s' },
  { symbol: 'JD10', name: 'Jump 10' }, { symbol: 'JD25', name: 'Jump 25' },
  { symbol: 'RDBEAR', name: 'Bear' }, { symbol: 'RDBULL', name: 'Bull' },
];

// FIXED: Added all strategy contract types
const CONTRACT_TYPES = [
  'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

type BotStatus = 'idle' | 'trading' | 'recovery' | 'waiting_signal' | 'signal_confirmed' | 'virtual_hook';
type StrategyType = 'over4' | 'under5' | 'over1_recovery' | 'under8_recovery' | 'even' | 'odd' | 'custom';

// ADDED: Strategy configuration interface
interface StrategyConfig {
  type: StrategyType;
  contractType: string;
  barrier?: string;
  entryCondition: (analysis: DigitAnalysis) => boolean;
  recoveryStrategy?: StrategyType;
  minConfirmationTicks: number;
}

// ADDED: Bot settings per strategy
interface BotSettings {
  stake: number;
  martingaleMultiplier: number;
  stopLoss: number;
  takeProfit: number;
  runs: number;
  enabled: boolean;
}

// ADDED: Digit analysis result interface
interface DigitAnalysis {
  counts: { [key: number]: number };
  percentages: number[];
  mostFrequent: number;
  leastFrequent: number;
  top3: number[];
  bottom3: number[];
  evenPct: number;
  oddPct: number;
  over4Pct: number;
  under5Pct: number;
  over1Pct: number;
  under8Pct: number;
  over3Pct: number;
  under5PctRecovery: number;
  totalTicks: number;
  signalStrength: number;
}

interface LogEntry {
  id: number;
  time: string;
  market: 'M1' | 'M2' | 'VH';
  symbol: string;
  contract: string;
  stake: number;
  martingaleStep: number;
  exitDigit: string;
  result: 'Win' | 'Loss' | 'Pending' | 'V-Win' | 'V-Loss';
  pnl: number;
  balance: number;
  switchInfo: string;
  strategy?: StrategyType;
}

/* ── Optimized Circular Digit Buffer (UPDATED with enhanced analysis) ── */
class CircularDigitBuffer {
  private buffer: number[];
  private head = 0;
  private count = 0;
  private capacity: number;
  private counts: { [key: number]: number };
  private cachedAnalysis: DigitAnalysis | null;

  constructor(capacity = 1000) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    this.cachedAnalysis = null;
  }

  static extractLastDigit(price: number | string): number | null {
    if (price === null || price === undefined) return null;
    
    try {
      let num: number;
      if (typeof price === 'string') {
        num = parseFloat(price);
        if (isNaN(num)) return null;
      } else {
        num = price;
      }
      
      num = Math.abs(num);
      const str = num.toFixed(10);
      const matches = str.match(/\d/g);
      if (!matches || matches.length === 0) return null;
      
      const lastDigit = parseInt(matches[matches.length - 1], 10);
      return lastDigit >= 0 && lastDigit <= 9 ? lastDigit : null;
    } catch (e) {
      console.error('Digit extraction error:', e);
      return null;
    }
  }

  push(digit: number): void {
    if (this.count === this.capacity) {
      const oldest = this.buffer[this.head];
      this.counts[oldest]--;
    }
    
    this.buffer[this.head] = digit;
    this.counts[digit]++;
    this.head = (this.head + 1) % this.capacity;
    
    if (this.count < this.capacity) {
      this.count++;
    }
    
    this.cachedAnalysis = null;
  }

  processTick(tick: any): boolean {
    if (!tick?.quote) return false;
    const digit = CircularDigitBuffer.extractLastDigit(tick.quote);
    if (digit === null) return false;
    this.push(digit);
    return true;
  }

  loadTicks(ticks: any[]): void {
    if (!Array.isArray(ticks) || ticks.length === 0) return;
    
    this.buffer = new Array(this.capacity);
    this.head = 0;
    this.count = 0;
    this.counts = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };
    
    const sortedTicks = [...ticks]
      .filter(t => t?.quote)
      .sort((a, b) => (a.epoch || 0) - (b.epoch || 0));
    
    const recentTicks = sortedTicks.slice(-this.capacity);
    
    recentTicks.forEach(tick => {
      const digit = CircularDigitBuffer.extractLastDigit(tick.quote);
      if (digit !== null) {
        this.buffer[this.head] = digit;
        this.counts[digit]++;
        this.head = (this.head + 1) % this.capacity;
        this.count++;
      }
    });
    
    this.cachedAnalysis = null;
  }

  last(n: number): number[] {
    if (n > this.count) n = this.count;
    const result = new Array(n);
    const start = (this.head - n + this.capacity) % this.capacity;
    for (let i = 0; i < n; i++) {
      result[i] = this.buffer[(start + i) % this.capacity];
    }
    return result;
  }

  getAll(): number[] {
    return this.last(this.count);
  }

  get size(): number {
    return this.count;
  }

  getCounts(): { [key: number]: number } {
    return { ...this.counts };
  }

  // UPDATED: Enhanced analysis with all required percentages
  analyze(): DigitAnalysis {
    if (this.cachedAnalysis) {
      return this.cachedAnalysis;
    }
    
    if (this.count === 0) {
      const emptyResult: DigitAnalysis = {
        counts: this.counts,
        percentages: new Array(10).fill(0),
        mostFrequent: 0,
        leastFrequent: 0,
        top3: [0, 1, 2],
        bottom3: [0, 1, 2],
        evenPct: 50,
        oddPct: 50,
        over4Pct: 50,
        under5Pct: 50,
        over1Pct: 50,
        under8Pct: 50,
        over3Pct: 50,
        under5PctRecovery: 50,
        totalTicks: 0,
        signalStrength: 0
      };
      this.cachedAnalysis = emptyResult;
      return emptyResult;
    }
    
    const percentages = new Array(10);
    for (let i = 0; i <= 9; i++) {
      percentages[i] = Number(((this.counts[i] / this.count) * 100).toFixed(2));
    }
    
    let mostFrequent = 0;
    let leastFrequent = 0;
    let maxCount = -1;
    let minCount = Infinity;
    
    const countEntries = Object.entries(this.counts).map(([digit, count]) => ({
      digit: parseInt(digit),
      count
    }));
    
    countEntries.forEach(({ digit, count }) => {
      if (count > maxCount) {
        maxCount = count;
        mostFrequent = digit;
      }
      if (count < minCount) {
        minCount = count;
        leastFrequent = digit;
      }
    });
    
    const sorted = [...countEntries].sort((a, b) => b.count - a.count);
    const top3 = sorted.slice(0, 3).map(item => item.digit);
    const bottom3 = sorted.slice(-3).map(item => item.digit);
    
    // Even/Odd stats
    let evenCount = 0;
    for (let i = 0; i <= 9; i += 2) {
      evenCount += this.counts[i];
    }
    const evenPct = Number(((evenCount / this.count) * 100).toFixed(1));
    const oddPct = Number((100 - evenPct).toFixed(1));
    
    // Strategy-specific percentages
    // Over 4 (digits 5-9)
    let over4Count = 0;
    for (let i = 5; i <= 9; i++) over4Count += this.counts[i];
    const over4Pct = Number(((over4Count / this.count) * 100).toFixed(1));
    
    // Under 5 (digits 0-4)
    let under5Count = 0;
    for (let i = 0; i <= 4; i++) under5Count += this.counts[i];
    const under5Pct = Number(((under5Count / this.count) * 100).toFixed(1));
    
    // Over 1 (digits 2-9)
    let over1Count = 0;
    for (let i = 2; i <= 9; i++) over1Count += this.counts[i];
    const over1Pct = Number(((over1Count / this.count) * 100).toFixed(1));
    
    // Under 8 (digits 0-7)
    let under8Count = 0;
    for (let i = 0; i <= 7; i++) under8Count += this.counts[i];
    const under8Pct = Number(((under8Count / this.count) * 100).toFixed(1));
    
    // Over 3 (digits 4-9)
    let over3Count = 0;
    for (let i = 4; i <= 9; i++) over3Count += this.counts[i];
    const over3Pct = Number(((over3Count / this.count) * 100).toFixed(1));
    
    // Calculate signal strength (0-100)
    const maxPercentage = Math.max(over4Pct, under5Pct, evenPct, oddPct, over1Pct, under8Pct);
    const signalStrength = maxPercentage > 55 ? Math.min(100, (maxPercentage - 50) * 5) : 0;
    
    const result: DigitAnalysis = {
      counts: this.counts,
      percentages,
      mostFrequent,
      leastFrequent,
      top3,
      bottom3,
      evenPct,
      oddPct,
      over4Pct,
      under5Pct,
      over1Pct,
      under8Pct,
      over3Pct,
      under5PctRecovery: under5Pct,
      totalTicks: this.count,
      signalStrength
    };
    
    this.cachedAnalysis = result;
    return result;
  }
}

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { 
        unsub(); 
        resolve({ quote: data.tick.quote }); 
      }
    });
  });
}

function simulateVirtualContract(
  contractType: string, barrier: string, symbol: string
): Promise<{ won: boolean; digit: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        const digit = getLastDigit(data.tick.quote);
        const b = parseInt(barrier) || 0;
        let won = false;
        switch (contractType) {
          case 'DIGITEVEN': won = digit % 2 === 0; break;
          case 'DIGITODD': won = digit % 2 !== 0; break;
          case 'DIGITMATCH': won = digit === b; break;
          case 'DIGITDIFF': won = digit !== b; break;
          case 'DIGITOVER': won = digit > b; break;
          case 'DIGITUNDER': won = digit < b; break;
        }
        resolve({ won, digit });
      }
    });
  });
}

export default function ProScannerBot() {
  const { isAuthorized, balance, activeAccount } = useAuth();
  const { recordLoss } = useLossRequirement();
  const location = useLocation();

  // ADDED: Strategy selection
  const [selectedStrategy, setSelectedStrategy] = useState<StrategyType>('over4');
  
  // ADDED: Bot settings per strategy
  const [botSettings, setBotSettings] = useState<Record<StrategyType, BotSettings>>({
    over4: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 20, runs: 5, enabled: true },
    under5: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 20, runs: 5, enabled: true },
    over1_recovery: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 20, runs: 3, enabled: true },
    under8_recovery: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 20, runs: 3, enabled: true },
    even: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 15, runs: 4, enabled: true },
    odd: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 15, runs: 4, enabled: true },
    custom: { stake: 0.35, martingaleMultiplier: 2.0, stopLoss: 10, takeProfit: 10, runs: 10, enabled: true }
  });

  // ADDED: Strategy definitions with entry conditions
  const strategyConfigs: Record<StrategyType, StrategyConfig> = {
    over4: {
      type: 'over4',
      contractType: 'DIGITOVER',
      barrier: '4',
      entryCondition: (analysis) => analysis.over4Pct > 60,
      minConfirmationTicks: 2
    },
    under5: {
      type: 'under5',
      contractType: 'DIGITUNDER',
      barrier: '5',
      entryCondition: (analysis) => analysis.under5Pct > 60,
      minConfirmationTicks: 2
    },
    over1_recovery: {
      type: 'over1_recovery',
      contractType: 'DIGITOVER',
      barrier: '1',
      entryCondition: (analysis) => analysis.over1Pct > 55,
      recoveryStrategy: 'over3_recovery',
      minConfirmationTicks: 3
    },
    under8_recovery: {
      type: 'under8_recovery',
      contractType: 'DIGITUNDER',
      barrier: '8',
      entryCondition: (analysis) => analysis.under8Pct > 55,
      recoveryStrategy: 'under5_recovery',
      minConfirmationTicks: 3
    },
    even: {
      type: 'even',
      contractType: 'DIGITEVEN',
      entryCondition: (analysis) => analysis.evenPct > 55,
      minConfirmationTicks: 2
    },
    odd: {
      type: 'odd',
      contractType: 'DIGITODD',
      entryCondition: (analysis) => analysis.oddPct > 55,
      minConfirmationTicks: 2
    },
    custom: {
      type: 'custom',
      contractType: 'DIGITEVEN',
      entryCondition: () => true, // Manual override
      minConfirmationTicks: 1
    }
  };

  // ADDED: Recovery strategy configs
  const recoveryConfigs: Record<string, StrategyConfig> = {
    over3_recovery: {
      type: 'over1_recovery',
      contractType: 'DIGITOVER',
      barrier: '3',
      entryCondition: (analysis) => analysis.over3Pct > 50,
      minConfirmationTicks: 2
    },
    under5_recovery: {
      type: 'under8_recovery',
      contractType: 'DIGITUNDER',
      barrier: '5',
      entryCondition: (analysis) => analysis.under5PctRecovery > 50,
      minConfirmationTicks: 2
    }
  };

  /* ── Market 1 config (UPDATED to use strategy) ── */
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Contract, setM1Contract] = useState('DIGITOVER');
  const [m1Barrier, setM1Barrier] = useState('4');
  const [m1Symbol, setM1Symbol] = useState('1HZ100V');

  /* ── Market 2 config ── */
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Contract, setM2Contract] = useState('DIGITUNDER');
  const [m2Barrier, setM2Barrier] = useState('5');
  const [m2Symbol, setM2Symbol] = useState('R_50');

  /* ── Virtual Hook M1 ── */
  const [m1HookEnabled, setM1HookEnabled] = useState(false);
  const [m1VirtualLossCount, setM1VirtualLossCount] = useState('3');
  const [m1RealCount, setM1RealCount] = useState('2');

  /* ── Virtual Hook M2 ── */
  const [m2HookEnabled, setM2HookEnabled] = useState(false);
  const [m2VirtualLossCount, setM2VirtualLossCount] = useState('3');
  const [m2RealCount, setM2RealCount] = useState('2');

  /* ── Virtual Hook stats ── */
  const [vhFakeWins, setVhFakeWins] = useState(0);
  const [vhFakeLosses, setVhFakeLosses] = useState(0);
  const [vhConsecLosses, setVhConsecLosses] = useState(0);
  const [vhStatus, setVhStatus] = useState<'idle' | 'waiting' | 'confirmed' | 'failed'>('idle');

  /* ── Risk (UPDATED to use strategy settings) ── */
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(true);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('20');
  const [stopLoss, setStopLoss] = useState('10');

  /* ── Strategy (UPDATED) ── */
  const [strategyEnabled, setStrategyEnabled] = useState(true);
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(true);
  const [m1StrategyMode, setM1StrategyMode] = useState<'pattern' | 'digit' | 'auto'>('auto');
  const [m2StrategyMode, setM2StrategyMode] = useState<'pattern' | 'digit' | 'auto'>('auto');

  /* ── M1 pattern/digit config ── */
  const [m1Pattern, setM1Pattern] = useState('');
  const [m1DigitCondition, setM1DigitCondition] = useState('==');
  const [m1DigitCompare, setM1DigitCompare] = useState('5');
  const [m1DigitWindow, setM1DigitWindow] = useState('3');

  /* ── M2 pattern/digit config ── */
  const [m2Pattern, setM2Pattern] = useState('');
  const [m2DigitCondition, setM2DigitCondition] = useState('==');
  const [m2DigitCompare, setM2DigitCompare] = useState('5');
  const [m2DigitWindow, setM2DigitWindow] = useState('3');

  /* ── Scanner ── */
  const [scannerActive, setScannerActive] = useState(true);

  /* ── Turbo ── */
  const [turboMode, setTurboMode] = useState(false);
  const [botName, setBotName] = useState('');
  const [turboLatency, setTurboLatency] = useState(0);
  const [ticksCaptured, setTicksCaptured] = useState(0);
  const [ticksMissed, setTicksMissed] = useState(0);

  /* ── Bot state (UPDATED) ── */
  const [botStatus, setBotStatus] = useState<BotStatus>('idle');
  const [isRunning, setIsRunning] = useState(false);
  const [isTrading, setIsTrading] = useState(false); // FIXED: Added isTrading flag to prevent duplicate trades
  const runningRef = useRef(false);
  const tradingRef = useRef(false); // FIXED: Ref for isTrading to avoid closure issues
  const [currentMarket, setCurrentMarket] = useState<1 | 2>(1);
  const [wins, setWins] = useState(0);
  const [losses, setLosses] = useState(0);
  const [totalStaked, setTotalStaked] = useState(0);
  const [netProfit, setNetProfit] = useState(0);
  const [currentStake, setCurrentStakeState] = useState(0);
  const [martingaleStep, setMartingaleStepState] = useState(0);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logIdRef = useRef(0);
  
  // ADDED: Trade control variables
  const [activeContractId, setActiveContractId] = useState<string | null>(null);
  const [currentStrategy, setCurrentStrategy] = useState<StrategyType>('over4');
  const [inRecoveryMode, setInRecoveryMode] = useState(false);
  const [runsCompleted, setRunsCompleted] = useState(0);
  const [signalConfirmation, setSignalConfirmation] = useState(0);
  const [bestMarket, setBestMarket] = useState<string | null>(null);

  /* ── Digit analyzers for each market ── */
  const digitAnalyzersRef = useRef<Map<string, CircularDigitBuffer>>(new Map());
  const [lastUpdate, setLastUpdate] = useState(0);

  /* ── Tick data for pattern matching ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});

  /* Initialize digit analyzers for all markets */
  useEffect(() => {
    SCANNER_MARKETS.forEach(m => {
      if (!digitAnalyzersRef.current.has(m.symbol)) {
        digitAnalyzersRef.current.set(m.symbol, new CircularDigitBuffer(1000));
      }
    });
  }, []);

  /* Load initial 1000 ticks for active markets */
  useEffect(() => {
    if (!derivApi.isConnected) return;
    
    const loadInitialTicks = async () => {
      try {
        // Load for M1 market
        const m1Analyzer = digitAnalyzersRef.current.get(m1Symbol);
        if (m1Analyzer && m1Analyzer.size === 0) {
          const hist1 = await derivApi.getTickHistory(m1Symbol as MarketSymbol, 1000);
          if (hist1?.history?.prices) {
            const ticks = hist1.history.prices.map((price, idx) => ({
              quote: price,
              epoch: hist1.history.times?.[idx] || Date.now() - (1000 - idx) * 1000
            }));
            m1Analyzer.loadTicks(ticks);
          }
        }
        
        // Load for M2 market
        const m2Analyzer = digitAnalyzersRef.current.get(m2Symbol);
        if (m2Analyzer && m2Analyzer.size === 0) {
          const hist2 = await derivApi.getTickHistory(m2Symbol as MarketSymbol, 1000);
          if (hist2?.history?.prices) {
            const ticks = hist2.history.prices.map((price, idx) => ({
              quote: price,
              epoch: hist2.history.times?.[idx] || Date.now() - (1000 - idx) * 1000
            }));
            m2Analyzer.loadTicks(ticks);
          }
        }
        
        setLastUpdate(Date.now());
      } catch (error) {
        console.error('Failed to load initial ticks:', error);
      }
    };
    
    loadInitialTicks();
  }, [m1Symbol, m2Symbol]);

  // ADDED: Auto market scanner
  const scanBestMarket = useCallback((): { symbol: string; analysis: DigitAnalysis; strength: number } | null => {
    let bestSymbol: string | null = null;
    let bestAnalysis: DigitAnalysis | null = null;
    let bestStrength = 0;

    SCANNER_MARKETS.forEach(m => {
      const analyzer = digitAnalyzersRef.current.get(m.symbol);
      if (analyzer && analyzer.size >= 100) {
        const analysis = analyzer.analyze();
        const strength = analysis.signalStrength;
        
        if (strength > bestStrength) {
          bestStrength = strength;
          bestSymbol = m.symbol;
          bestAnalysis = analysis;
        }
      }
    });

    if (bestSymbol && bestAnalysis && bestStrength > 40) {
      return { symbol: bestSymbol, analysis: bestAnalysis, strength: bestStrength };
    }
    return null;
  }, []);

  // ADDED: Signal confirmation with multiple ticks
  const confirmSignal = useCallback((symbol: string, strategy: StrategyConfig): boolean => {
    const analyzer = digitAnalyzersRef.current.get(symbol);
    if (!analyzer) return false;

    const analysis = analyzer.analyze();
    const recentDigits = analyzer.last(strategy.minConfirmationTicks);
    
    // Check if condition holds for consecutive ticks
    if (!strategy.entryCondition(analysis)) {
      setSignalConfirmation(0);
      return false;
    }

    // Increment confirmation counter
    setSignalConfirmation(prev => {
      const newCount = prev + 1;
      return newCount >= strategy.minConfirmationTicks ? strategy.minConfirmationTicks : newCount;
    });

    return signalConfirmation >= strategy.minConfirmationTicks - 1;
  }, [signalConfirmation]);

  // ADDED: Get current strategy config
  const getCurrentStrategyConfig = useCallback((): StrategyConfig => {
    if (inRecoveryMode && recoveryConfigs[currentStrategy]) {
      return recoveryConfigs[currentStrategy];
    }
    return strategyConfigs[currentStrategy];
  }, [currentStrategy, inRecoveryMode]);

  /* Subscribe to all scanner markets (UPDATED with auto-trading logic) */
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
      
      const analyzer = digitAnalyzersRef.current.get(sym);
      if (analyzer) {
        analyzer.processTick(data.tick);
      }
      
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));

      if (lastTickTsRef.current > 0) {
        const lat = now - lastTickTsRef.current;
        setTurboLatency(Math.round(lat));
        if (lat > 50) setTicksMissed(prev => prev + 1);
      }
      lastTickTsRef.current = now;
      setTicksCaptured(prev => prev + 1);
      
      // Throttle UI updates
      if (!updateScheduledRef.current) {
        updateScheduledRef.current = true;
        requestAnimationFrame(() => {
          setLastUpdate(Date.now());
          updateScheduledRef.current = false;
        });
      }

      // Auto scanner: find best market
      if (scannerActive && isRunning) {
        const best = scanBestMarket();
        if (best && best.symbol !== bestMarket) {
          setBestMarket(best.symbol);
          if (currentMarket === 1) {
            setM1Symbol(best.symbol);
          } else {
            setM2Symbol(best.symbol);
          }
        }
      }

      // Auto-trading logic
      if (isRunning && !tradingRef.current && strategyEnabled && currentStrategy !== 'custom') {
        const currentSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
        const strategy = getCurrentStrategyConfig();
        
        // FIXED: Check if we should trade on this symbol
        if (sym === currentSymbol) {
          const shouldTrade = confirmSignal(sym, strategy);
          
          if (shouldTrade && !tradingRef.current) {
            // Execute trade automatically
            executeAutoTrade();
          }
        }
      }
    };
    
    const updateScheduledRef = { current: false };
    const lastTickTsRef = { current: 0 };
    
    const unsub = derivApi.onMessage(handler);
    SCANNER_MARKETS.forEach(m => { 
      derivApi.subscribeTicks(m.symbol as MarketSymbol, () => {}).catch(() => {}); 
    });
    
    return () => { 
      active = false; 
      unsub(); 
    };
  }, [isRunning, scannerActive, strategyEnabled, currentStrategy, currentMarket, m1Symbol, m2Symbol, confirmSignal, scanBestMarket]);

  /* ── Pattern validation ── */
  const cleanM1Pattern = m1Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m1PatternValid = cleanM1Pattern.length >= 2;
  const cleanM2Pattern = m2Pattern.toUpperCase().replace(/[^EO]/g, '');
  const m2PatternValid = cleanM2Pattern.length >= 2;

  /* ── Check pattern match ── */
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

  /* ── Check digit condition ── */
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

  /* ── Check strategy condition ── */
  const checkStrategyForMarket = useCallback((symbol: string, market: 1 | 2): boolean => {
    const mode = market === 1 ? m1StrategyMode : m2StrategyMode;
    
    if (mode === 'auto') {
      const analyzer = digitAnalyzersRef.current.get(symbol);
      if (!analyzer) return false;
      const analysis = analyzer.analyze();
      const strategy = getCurrentStrategyConfig();
      return strategy.entryCondition(analysis);
    }
    
    if (mode === 'pattern') {
      const pat = market === 1 ? cleanM1Pattern : cleanM2Pattern;
      return checkPatternMatchWith(symbol, pat);
    }
    
    const cond = market === 1 ? m1DigitCondition : m2DigitCondition;
    const comp = market === 1 ? m1DigitCompare : m2DigitCompare;
    const win = market === 1 ? m1DigitWindow : m2DigitWindow;
    return checkDigitConditionWith(symbol, cond, comp, win);
  }, [m1StrategyMode, m2StrategyMode, cleanM1Pattern, cleanM2Pattern, checkPatternMatchWith, checkDigitConditionWith, 
      m1DigitCondition, m1DigitCompare, m1DigitWindow, m2DigitCondition, m2DigitCompare, m2DigitWindow, getCurrentStrategyConfig]);

  /* ── Find scanner match ── */
  const findScannerMatchForMarket = useCallback((market: 1 | 2): string | null => {
    for (const m of SCANNER_MARKETS) {
      if (checkStrategyForMarket(m.symbol, market)) return m.symbol;
    }
    return null;
  }, [checkStrategyForMarket]);

  /* ── Add log entry ── */
  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  /* ── Update pending log ── */
  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  /* ── Clear log ── */
  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0);
    setMartingaleStepState(0);
    setVhFakeWins(0); setVhFakeLosses(0); setVhConsecLosses(0); setVhStatus('idle');
    setTicksCaptured(0); setTicksMissed(0);
    setRunsCompleted(0);
    setInRecoveryMode(false);
  }, []);

  // ADDED: Execute auto trade
  const executeAutoTrade = useCallback(async () => {
    if (tradingRef.current || !runningRef.current) return;
    
    tradingRef.current = true;
    setIsTrading(true);
    
    const settings = botSettings[currentStrategy];
    const strategy = getCurrentStrategyConfig();
    const tradeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
    const currentStakeValue = currentStake || settings.stake;
    
    try {
      const logId = ++logIdRef.current;
      const now = new Date().toLocaleTimeString();
      
      addLog(logId, {
        time: now, 
        market: currentMarket === 1 ? 'M1' : 'M2', 
        symbol: tradeSymbol,
        contract: strategy.contractType, 
        stake: currentStakeValue, 
        martingaleStep,
        exitDigit: '...', 
        result: 'Pending', 
        pnl: 0, 
        balance,
        switchInfo: inRecoveryMode ? 'RECOVERY MODE' : `${currentStrategy}`,
        strategy: currentStrategy
      });

      // Wait for next tick if not in turbo mode
      if (!turboMode) {
        await waitForNextTick(tradeSymbol as MarketSymbol);
      }

      const buyParams: any = {
        contract_type: strategy.contractType, 
        symbol: tradeSymbol,
        duration: 1, 
        duration_unit: 't', 
        basis: 'stake', 
        amount: currentStakeValue,
      };
      
      if (strategy.barrier) {
        buyParams.barrier = strategy.barrier;
      }

      const { contractId } = await derivApi.buyContract(buyParams);
      setActiveContractId(contractId);
      
      // Copy trade to followers
      if (copyTradingService.enabled) {
        copyTradingService.copyTrade({
          ...buyParams,
          masterTradeId: contractId,
        }).catch(err => console.error('Copy trading error:', err));
      }
      
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      const pnl = result.profit;
      
      // Update totals
      setNetProfit(prev => prev + pnl);
      setTotalStaked(prev => prev + currentStakeValue);
      
      const exitDigit = String(getLastDigit(result.sellPrice || 0));
      
      // FIXED: Proper win/loss handling with runs and recovery
      if (won) {
        setWins(prev => prev + 1);
        
        // Reset recovery mode on win
        if (inRecoveryMode) {
          setInRecoveryMode(false);
        }
        
        // Increment runs completed
        const newRuns = runsCompleted + 1;
        setRunsCompleted(newRuns);
        
        // FIXED: Reset if runs reached
        if (newRuns >= settings.runs) {
          toast.success(`✅ Completed ${settings.runs} runs! Resetting...`);
          setRunsCompleted(0);
          setCurrentStakeState(settings.stake);
          setMartingaleStepState(0);
        } else {
          // Reset stake on win
          setCurrentStakeState(settings.stake);
          setMartingaleStepState(0);
        }
        
        updateLog(logId, { 
          exitDigit, 
          result: 'Win', 
          pnl, 
          balance: balance + pnl,
          switchInfo: `WIN → Runs: ${newRuns}/${settings.runs}`
        });
      } else {
        setLosses(prev => prev + 1);
        
        // Record loss for virtual trading requirement
        if (activeAccount?.is_virtual) {
          recordLoss(currentStakeValue, tradeSymbol, 6000);
        }
        
        // FIXED: Martingale logic
        if (martingaleOn) {
          const maxS = parseInt(martingaleMaxSteps) || 5;
          if (martingaleStep < maxS) {
            const newStake = currentStakeValue * settings.martingaleMultiplier;
            setCurrentStakeState(newStake);
            setMartingaleStepState(prev => prev + 1);
          } else {
            // Max steps reached, reset stake
            setCurrentStakeState(settings.stake);
            setMartingaleStepState(0);
          }
        }
        
        // FIXED: Recovery mode for specific strategies
        if (currentStrategy === 'over1_recovery' || currentStrategy === 'under8_recovery') {
          setInRecoveryMode(true);
        }
        
        updateLog(logId, { 
          exitDigit, 
          result: 'Loss', 
          pnl, 
          balance: balance + pnl,
          switchInfo: `LOSS → Step: ${martingaleStep + 1}`
        });
      }
      
      // FIXED: Stop loss / take profit check
      if (Math.abs(netProfit + pnl) >= settings.stopLoss) {
        toast.error(`🛑 Stop Loss reached! Stopping bot...`);
        runningRef.current = false;
        setIsRunning(false);
        setBotStatus('idle');
      }
      
      if (netProfit + pnl >= settings.takeProfit) {
        toast.success(`💰 Take Profit reached! Stopping bot...`);
        runningRef.current = false;
        setIsRunning(false);
        setBotStatus('idle');
      }
      
    } catch (err: any) {
      console.error('Trade execution error:', err);
      toast.error(`Trade failed: ${err.message}`);
    } finally {
      tradingRef.current = false;
      setIsTrading(false);
      setActiveContractId(null);
    }
  }, [currentStrategy, currentMarket, m1Symbol, m2Symbol, currentStake, martingaleStep, balance, 
      martingaleOn, martingaleMaxSteps, turboMode, addLog, updateLog, botSettings, getCurrentStrategyConfig,
      runsCompleted, inRecoveryMode, netProfit]);

  /* ═══════════════ MAIN BOT LOOP (UPDATED with strategy system) ═══════════════ */
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    
    const settings = botSettings[selectedStrategy];
    const baseStake = settings.stake;
    
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }

    setIsRunning(true);
    runningRef.current = true;
    tradingRef.current = false;
    setCurrentMarket(1);
    setBotStatus('waiting_signal');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);
    setCurrentStrategy(selectedStrategy);
    setInRecoveryMode(false);
    setRunsCompleted(0);
    setSignalConfirmation(0);
    
    toast.success(`🚀 Bot started with ${selectedStrategy} strategy!`);
  }, [isAuthorized, isRunning, m1Enabled, m2Enabled, selectedStrategy, botSettings]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
    setActiveContractId(null);
    toast.info('Bot stopped');
  }, []);

  /* ── Status helpers ── */
  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = {
    idle: { icon: '⚪', label: 'IDLE', color: 'text-muted-foreground' },
    trading: { icon: '🟢', label: 'TRADING', color: 'text-profit' },
    recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-purple-400' },
    waiting_signal: { icon: '🟡', label: 'WAITING SIGNAL', color: 'text-warning' },
    signal_confirmed: { icon: '✅', label: 'SIGNAL CONFIRMED', color: 'text-profit' },
    virtual_hook: { icon: '🎣', label: 'VIRTUAL HOOK', color: 'text-primary' },
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  /* ── Get digit analysis for active symbol ── */
  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  
  const digitAnalysis = useMemo(() => {
    const analyzer = digitAnalyzersRef.current.get(activeSymbol);
    if (!analyzer) {
      return {
        counts: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },
        percentages: new Array(10).fill(0),
        mostFrequent: 0,
        leastFrequent: 0,
        top3: [0, 1, 2],
        bottom3: [0, 1, 2],
        evenPct: 50,
        oddPct: 50,
        over4Pct: 50,
        under5Pct: 50,
        over1Pct: 50,
        under8Pct: 50,
        over3Pct: 50,
        under5PctRecovery: 50,
        totalTicks: 0,
        signalStrength: 0
      };
    }
    return analyzer.analyze();
  }, [activeSymbol, lastUpdate]);
  
  // Live digits for display (last 26)
  const liveDigits = useMemo(() => {
    const analyzer = digitAnalyzersRef.current.get(activeSymbol);
    if (!analyzer) return [];
    return analyzer.last(26);
  }, [activeSymbol, lastUpdate]);

  /* ── Build config object for preview ── */
  const currentConfig = useMemo<BotConfig>(() => ({
    version: 1,
    m1: { enabled: m1Enabled, symbol: m1Symbol, contract: m1Contract, barrier: m1Barrier, hookEnabled: m1HookEnabled, virtualLossCount: m1VirtualLossCount, realCount: m1RealCount },
    m2: { enabled: m2Enabled, symbol: m2Symbol, contract: m2Contract, barrier: m2Barrier, hookEnabled: m2HookEnabled, virtualLossCount: m2VirtualLossCount, realCount: m2RealCount },
    risk: { stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss },
    strategy: { m1Enabled: strategyM1Enabled, m2Enabled: strategyEnabled, m1Mode: m1StrategyMode, m2Mode: m2StrategyMode, m1Pattern, m1DigitCondition, m1DigitCompare, m1DigitWindow, m2Pattern, m2DigitCondition, m2DigitCompare, m2DigitWindow },
    scanner: { active: scannerActive },
    turbo: { enabled: turboMode },
  }), [m1Enabled, m1Symbol, m1Contract, m1Barrier, m1HookEnabled, m1VirtualLossCount, m1RealCount, m2Enabled, m2Symbol, m2Contract, m2Barrier, m2HookEnabled, m2VirtualLossCount, m2RealCount, stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss, strategyM1Enabled, strategyEnabled, m1StrategyMode, m2StrategyMode, m1Pattern, m1DigitCondition, m1DigitCompare, m1DigitWindow, m2Pattern, m2DigitCondition, m2DigitCompare, m2DigitWindow, scannerActive, turboMode]);

  const handleLoadConfig = useCallback((cfg: BotConfig) => {
    if (cfg.m1) {
      if (cfg.m1.enabled !== undefined) setM1Enabled(cfg.m1.enabled);
      if (cfg.m1.symbol) setM1Symbol(cfg.m1.symbol);
      if (cfg.m1.contract) setM1Contract(cfg.m1.contract);
      if (cfg.m1.barrier) setM1Barrier(cfg.m1.barrier);
      if (cfg.m1.hookEnabled !== undefined) setM1HookEnabled(cfg.m1.hookEnabled);
      if (cfg.m1.virtualLossCount) setM1VirtualLossCount(cfg.m1.virtualLossCount);
      if (cfg.m1.realCount) setM1RealCount(cfg.m1.realCount);
    }
    if (cfg.m2) {
      if (cfg.m2.enabled !== undefined) setM2Enabled(cfg.m2.enabled);
      if (cfg.m2.symbol) setM2Symbol(cfg.m2.symbol);
      if (cfg.m2.contract) setM2Contract(cfg.m2.contract);
      if (cfg.m2.barrier) setM2Barrier(cfg.m2.barrier);
      if (cfg.m2.hookEnabled !== undefined) setM2HookEnabled(cfg.m2.hookEnabled);
      if (cfg.m2.virtualLossCount) setM2VirtualLossCount(cfg.m2.virtualLossCount);
      if (cfg.m2.realCount) setM2RealCount(cfg.m2.realCount);
    }
    if (cfg.risk) {
      if (cfg.risk.stake) setStake(cfg.risk.stake);
      if (cfg.risk.martingaleOn !== undefined) setMartingaleOn(cfg.risk.martingaleOn);
      if (cfg.risk.martingaleMultiplier) setMartingaleMultiplier(cfg.risk.martingaleMultiplier);
      if (cfg.risk.martingaleMaxSteps) setMartingaleMaxSteps(cfg.risk.martingaleMaxSteps);
      if (cfg.risk.takeProfit) setTakeProfit(cfg.risk.takeProfit);
      if (cfg.risk.stopLoss) setStopLoss(cfg.risk.stopLoss);
    }
    if (cfg.strategy) {
      if (cfg.strategy.m1Enabled !== undefined) setStrategyM1Enabled(cfg.strategy.m1Enabled);
      if (cfg.strategy.m2Enabled !== undefined) setStrategyEnabled(cfg.strategy.m2Enabled);
      if (cfg.strategy.m1Mode) setM1StrategyMode(cfg.strategy.m1Mode);
      if (cfg.strategy.m2Mode) setM2StrategyMode(cfg.strategy.m2Mode);
      if (cfg.strategy.m1Pattern !== undefined) setM1Pattern(cfg.strategy.m1Pattern);
      if (cfg.strategy.m1DigitCondition) setM1DigitCondition(cfg.strategy.m1DigitCondition);
      if (cfg.strategy.m1DigitCompare) setM1DigitCompare(cfg.strategy.m1DigitCompare);
      if (cfg.strategy.m1DigitWindow) setM1DigitWindow(cfg.strategy.m1DigitWindow);
      if (cfg.strategy.m2Pattern !== undefined) setM2Pattern(cfg.strategy.m2Pattern);
      if (cfg.strategy.m2DigitCondition) setM2DigitCondition(cfg.strategy.m2DigitCondition);
      if (cfg.strategy.m2DigitCompare) setM2DigitCompare(cfg.strategy.m2DigitCompare);
      if (cfg.strategy.m2DigitWindow) setM2DigitWindow(cfg.strategy.m2DigitWindow);
    }
    if (cfg.scanner?.active !== undefined) setScannerActive(cfg.scanner.active);
    if (cfg.turbo?.enabled !== undefined) setTurboMode(cfg.turbo.enabled);
    if ((cfg as any).botName) setBotName((cfg as any).botName);
  }, []);

  // Auto-load config from navigation state
  useEffect(() => {
    const state = location.state as { loadConfig?: BotConfig } | null;
    if (state?.loadConfig) {
      handleLoadConfig(state.loadConfig);
      window.history.replaceState({}, '');
    }
  }, [location.state, handleLoadConfig]);

  return (
    <div className="space-y-2 max-w-7xl mx-auto">
      {/* ── Compact Header ── */}
      <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <Scan className="w-4 h-4 text-primary" /> Pro Scanner Bot
        </h1>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-[10px]`}>{status.icon} {status.label}</Badge>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-warning animate-pulse font-mono">
              P/L: ${netProfit.toFixed(2)}
            </Badge>
          )}
          {isRunning && (
            <Badge variant="outline" className={`text-[10px] ${currentMarket === 1 ? 'text-profit border-profit/50' : 'text-purple-400 border-purple-500/50'}`}>
              {currentMarket === 1 ? '🏠 M1' : '🔄 M2'}
            </Badge>
          )}
        </div>
      </div>

      {/* ADDED: Strategy Selection Panel */}
      <div className="bg-card border border-primary/30 rounded-xl p-2.5">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xs font-semibold text-primary flex items-center gap-1">
            <Target className="w-3.5 h-3.5" /> Active Strategy
          </h3>
          <Select value={selectedStrategy} onValueChange={(v: StrategyType) => setSelectedStrategy(v)} disabled={isRunning}>
            <SelectTrigger className="h-7 text-xs w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="over4">OVER 4 Bot</SelectItem>
              <SelectItem value="under5">UNDER 5 Bot</SelectItem>
              <SelectItem value="over1_recovery">OVER 1 → OVER 3 Recovery</SelectItem>
              <SelectItem value="under8_recovery">UNDER 8 → UNDER 5 Recovery</SelectItem>
              <SelectItem value="even">EVEN Bot</SelectItem>
              <SelectItem value="odd">ODD Bot</SelectItem>
              <SelectItem value="custom">Custom Pattern</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Strategy Settings */}
        <div className="grid grid-cols-5 gap-2">
          <div>
            <label className="text-[8px] text-muted-foreground">Stake</label>
            <Input 
              type="number" 
              min="0.35" 
              step="0.01" 
              value={botSettings[selectedStrategy].stake}
              onChange={(e) => setBotSettings(prev => ({
                ...prev,
                [selectedStrategy]: { ...prev[selectedStrategy], stake: parseFloat(e.target.value) }
              }))}
              disabled={isRunning}
              className="h-6 text-[10px]"
            />
          </div>
          <div>
            <label className="text-[8px] text-muted-foreground">Martingale</label>
            <Input 
              type="number" 
              min="1.1" 
              step="0.1" 
              value={botSettings[selectedStrategy].martingaleMultiplier}
              onChange={(e) => setBotSettings(prev => ({
                ...prev,
                [selectedStrategy]: { ...prev[selectedStrategy], martingaleMultiplier: parseFloat(e.target.value) }
              }))}
              disabled={isRunning}
              className="h-6 text-[10px]"
            />
          </div>
          <div>
            <label className="text-[8px] text-muted-foreground">Stop Loss</label>
            <Input 
              type="number" 
              min="1" 
              value={botSettings[selectedStrategy].stopLoss}
              onChange={(e) => setBotSettings(prev => ({
                ...prev,
                [selectedStrategy]: { ...prev[selectedStrategy], stopLoss: parseFloat(e.target.value) }
              }))}
              disabled={isRunning}
              className="h-6 text-[10px]"
            />
          </div>
          <div>
            <label className="text-[8px] text-muted-foreground">Take Profit</label>
            <Input 
              type="number" 
              min="1" 
              value={botSettings[selectedStrategy].takeProfit}
              onChange={(e) => setBotSettings(prev => ({
                ...prev,
                [selectedStrategy]: { ...prev[selectedStrategy], takeProfit: parseFloat(e.target.value) }
              }))}
              disabled={isRunning}
              className="h-6 text-[10px]"
            />
          </div>
          <div>
            <label className="text-[8px] text-muted-foreground">Runs</label>
            <Input 
              type="number" 
              min="1" 
              max="20" 
              value={botSettings[selectedStrategy].runs}
              onChange={(e) => setBotSettings(prev => ({
                ...prev,
                [selectedStrategy]: { ...prev[selectedStrategy], runs: parseInt(e.target.value) }
              }))}
              disabled={isRunning}
              className="h-6 text-[10px]"
            />
          </div>
        </div>

        {isRunning && (
          <div className="mt-2 flex items-center gap-2 text-[10px]">
            <Badge variant="outline" className="bg-primary/10 text-primary">
              Current: {currentStrategy}
            </Badge>
            {inRecoveryMode && (
              <Badge variant="outline" className="bg-purple-500/10 text-purple-400">
                Recovery Mode
              </Badge>
            )}
            <Badge variant="outline" className="bg-profit/10 text-profit">
              Runs: {runsCompleted}/{botSettings[currentStrategy].runs}
            </Badge>
            {signalConfirmation > 0 && (
              <Badge variant="outline" className="bg-warning/10 text-warning animate-pulse">
                Signal: {signalConfirmation}/2
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Scanner + Turbo + Stats Compact Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {/* Scanner */}
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">Scanner</span>
              <Badge variant={scannerActive ? 'default' : 'secondary'} className="text-[9px] h-4 px-1.5">
                {scannerActive ? '🟢 ON' : '⚫ OFF'}
              </Badge>
            </div>
            <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
          </div>
          <div className="flex flex-wrap gap-0.5">
            {SCANNER_MARKETS.map(m => {
              const count = tickCounts[m.symbol] || 0;
              const isBest = bestMarket === m.symbol;
              return (
                <Badge 
                  key={m.symbol} 
                  variant="outline"
                  className={`text-[8px] h-4 px-1 font-mono ${
                    isBest ? 'border-profit bg-profit/10 text-profit' : 
                    count > 0 ? 'border-primary/50 text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {m.name}
                  {isBest && ' ✓'}
                </Badge>
              );
            })}
          </div>
        </div>

        {/* Turbo */}
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Zap className={`w-3.5 h-3.5 ${turboMode ? 'text-profit animate-pulse' : 'text-muted-foreground'}`} />
              <span className="text-xs font-semibold text-foreground">Turbo</span>
            </div>
            <Button
              size="sm"
              variant={turboMode ? 'default' : 'outline'}
              className={`h-6 text-[9px] px-2 ${turboMode ? 'bg-profit hover:bg-profit/90 text-profit-foreground animate-pulse' : ''}`}
              onClick={() => setTurboMode(!turboMode)}
              disabled={isRunning}
            >
              {turboMode ? '⚡ ON' : 'OFF'}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Latency</div>
              <div className="font-mono text-[10px] text-primary font-bold">{turboLatency}ms</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Captured</div>
              <div className="font-mono text-[10px] text-profit font-bold">{ticksCaptured}</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Missed</div>
              <div className="font-mono text-[10px] text-loss font-bold">{ticksMissed}</div>
            </div>
          </div>
        </div>

        {/* Live Stats */}
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-foreground">Stats</span>
            <span className="font-mono text-sm font-bold text-foreground">${balance.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">W/L</div>
              <div className="font-mono text-[10px] font-bold"><span className="text-profit">{wins}</span>/<span className="text-loss">{losses}</span></div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Net P/L</div>
              <div className={`font-mono text-[10px] font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>${netProfit.toFixed(2)}</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px] text-muted-foreground">Stake</div>
              <div className="font-mono text-[10px] font-bold text-foreground">${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-warning"> M{martingaleStep}</span>}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main 2-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        {/* ═══ LEFT: Config Column ═══ */}
        <div className="lg:col-span-4 space-y-2">
          {/* Market 1 + Market 2 side by side on md */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-2">
            {/* Market 1 */}
            <div className="bg-card border-2 border-profit/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-profit flex items-center gap-1"><Home className="w-3.5 h-3.5" /> M1 — Home</h3>
                <div className="flex items-center gap-1.5">
                  {currentMarket === 1 && isRunning && <span className="w-2 h-2 rounded-full bg-profit animate-pulse" />}
                  <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
                </div>
              </div>
              <Select value={m1Symbol} onValueChange={v => setM1Symbol(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m1Contract} onValueChange={v => setM1Contract(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              {needsBarrier(m1Contract) && (
                <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)}
                  className="h-7 text-xs" placeholder="Barrier (0-9)" disabled={isRunning} />
              )}
              {/* Virtual Hook M1 */}
              <div className="border-t border-border/30 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-primary flex items-center gap-1">
                    <Anchor className="w-3 h-3" /> Virtual Hook
                  </span>
                  <Switch checked={m1HookEnabled} onCheckedChange={setM1HookEnabled} disabled={isRunning} />
                </div>
                {m1HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div>
                      <label className="text-[8px] text-muted-foreground">V-Losses</label>
                      <Input type="number" min="1" max="20" value={m1VirtualLossCount} onChange={e => setM1VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                    <div>
                      <label className="text-[8px] text-muted-foreground">Real Trades</label>
                      <Input type="number" min="1" max="10" value={m1RealCount} onChange={e => setM1RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Market 2 */}
            <div className="bg-card border-2 border-purple-500/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-purple-400 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> M2 — Recovery</h3>
                <div className="flex items-center gap-1.5">
                  {currentMarket === 2 && isRunning && <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />}
                  <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
                </div>
              </div>
              <Select value={m2Symbol} onValueChange={v => setM2Symbol(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{SCANNER_MARKETS.map(m => <SelectItem key={m.symbol} value={m.symbol}>{m.name} ({m.symbol})</SelectItem>)}</SelectContent>
              </Select>
              <Select value={m2Contract} onValueChange={v => setM2Contract(v)} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
              {needsBarrier(m2Contract) && (
                <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)}
                  className="h-7 text-xs" placeholder="Barrier (0-9)" disabled={isRunning} />
              )}
              {/* Virtual Hook M2 */}
              <div className="border-t border-border/30 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-primary flex items-center gap-1">
                    <Anchor className="w-3 h-3" /> Virtual Hook
                  </span>
                  <Switch checked={m2HookEnabled} onCheckedChange={setM2HookEnabled} disabled={isRunning} />
                </div>
                {m2HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <div>
                      <label className="text-[8px] text-muted-foreground">V-Losses</label>
                      <Input type="number" min="1" max="20" value={m2VirtualLossCount} onChange={e => setM2VirtualLossCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                    <div>
                      <label className="text-[8px] text-muted-foreground">Real Trades</label>
                      <Input type="number" min="1" max="10" value={m2RealCount} onChange={e => setM2RealCount(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Virtual Hook Stats */}
          {(m1HookEnabled || m2HookEnabled) && (
            <div className="bg-card border border-primary/30 rounded-xl p-2.5">
              <h3 className="text-[10px] font-semibold text-primary flex items-center gap-1 mb-1">
                <Anchor className="w-3 h-3" /> Hook Status
              </h3>
              <div className="grid grid-cols-4 gap-1 text-center">
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">V-Win</div>
                  <div className="font-mono text-[10px] font-bold text-profit">{vhFakeWins}</div>
                </div>
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">V-Loss</div>
                  <div className="font-mono text-[10px] font-bold text-loss">{vhFakeLosses}</div>
                </div>
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">Streak</div>
                  <div className="font-mono text-[10px] font-bold text-warning">{vhConsecLosses}</div>
                </div>
                <div className="bg-muted/50 rounded p-1">
                  <div className="text-[8px] text-muted-foreground">State</div>
                  <div className={`text-[9px] font-bold ${
                    vhStatus === 'confirmed' ? 'text-profit' :
                    vhStatus === 'waiting' ? 'text-warning animate-pulse' :
                    vhStatus === 'failed' ? 'text-loss' : 'text-muted-foreground'
                  }`}>
                    {vhStatus === 'confirmed' ? '✓' : vhStatus === 'waiting' ? '⏳' : vhStatus === 'failed' ? '✗' : '—'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Risk */}
          <div className="bg-card border border-border rounded-xl p-2.5 space-y-1.5">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> Risk</h3>
            <div className="grid grid-cols-3 gap-1.5">
              <div>
                <label className="text-[8px] text-muted-foreground">Stake ($)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Take Profit</label>
                <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              </div>
              <div>
                <label className="text-[8px] text-muted-foreground">Stop Loss</label>
                <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
              </div>
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-foreground">Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label className="text-[8px] text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
                </div>
                <div>
                  <label className="text-[8px] text-muted-foreground">Max Steps</label>
                  <Input type="number" min="1" max="10" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} disabled={isRunning} className="h-7 text-xs" />
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 pt-0.5">
              <label className="flex items-center gap-1 text-[10px] text-foreground">
                <input type="checkbox" checked={strategyM1Enabled} onChange={e => setStrategyM1Enabled(e.target.checked)} disabled={isRunning} className="rounded w-3 h-3" />
                Strategy M1
              </label>
              <label className="flex items-center gap-1 text-[10px] text-foreground">
                <input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} className="rounded w-3 h-3" />
                Strategy M2
              </label>
            </div>
          </div>

          {/* Strategy Card */}
          {(strategyEnabled || strategyM1Enabled) && (
            <div className="bg-card border border-warning/30 rounded-xl p-2.5 space-y-1.5">
              <h3 className="text-xs font-semibold text-warning flex items-center gap-1"><Zap className="w-3.5 h-3.5" /> Strategy</h3>

              {/* M1 Strategy */}
              {strategyM1Enabled && (
                <div className="border border-profit/20 rounded-lg p-1.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-semibold text-profit">M1 Strategy</label>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant={m1StrategyMode === 'auto' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('auto')} disabled={isRunning}>
                        Auto
                      </Button>
                      <Button size="sm" variant={m1StrategyMode === 'pattern' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('pattern')} disabled={isRunning}>
                        Pattern
                      </Button>
                      <Button size="sm" variant={m1StrategyMode === 'digit' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM1StrategyMode('digit')} disabled={isRunning}>
                        Digit
                      </Button>
                    </div>
                  </div>
                  {m1StrategyMode === 'pattern' ? (
                    <>
                      <Textarea placeholder="E=Even O=Odd e.g. EEEOE" value={m1Pattern}
                        onChange={e => setM1Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0" />
                      <div className={`text-[9px] font-mono ${m1PatternValid ? 'text-profit' : 'text-loss'}`}>
                        {cleanM1Pattern.length === 0 ? 'Enter pattern...' :
                          m1PatternValid ? `✓ ${cleanM1Pattern}` : `✗ Need 2+`}
                      </div>
                    </>
                  ) : m1StrategyMode === 'digit' ? (
                    <>
                      <div className="grid grid-cols-3 gap-1 mt-0.5">
                        <label className="text-[8px] text-muted-foreground text-center">Condition</label>
                        <label className="text-[8px] text-muted-foreground text-center">Digit</label>
                        <label className="text-[8px] text-muted-foreground text-center">Ticks</label>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Select value={m1DigitCondition} onValueChange={setM1DigitCondition} disabled={isRunning}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" max="9" value={m1DigitCompare} onChange={e => setM1DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                        <Input type="number" min="1" max="50" value={m1DigitWindow} onChange={e => setM1DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] text-center py-1 text-muted-foreground">
                      Auto strategy based on market analysis
                    </div>
                  )}
                </div>
              )}

              {/* M2 Strategy */}
              {strategyEnabled && (
                <div className="border border-destructive/20 rounded-lg p-1.5 space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[9px] font-semibold text-destructive">M2 Strategy</label>
                    <div className="flex gap-0.5">
                      <Button size="sm" variant={m2StrategyMode === 'auto' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('auto')} disabled={isRunning}>
                        Auto
                      </Button>
                      <Button size="sm" variant={m2StrategyMode === 'pattern' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('pattern')} disabled={isRunning}>
                        Pattern
                      </Button>
                      <Button size="sm" variant={m2StrategyMode === 'digit' ? 'default' : 'outline'}
                        className="text-[9px] h-5 px-1.5" onClick={() => setM2StrategyMode('digit')} disabled={isRunning}>
                        Digit
                      </Button>
                    </div>
                  </div>
                  {m2StrategyMode === 'pattern' ? (
                    <>
                      <Textarea placeholder="E=Even O=Odd e.g. OOEEO" value={m2Pattern}
                        onChange={e => setM2Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))}
                        disabled={isRunning} className="h-10 text-[10px] font-mono min-h-0" />
                      <div className={`text-[9px] font-mono ${m2PatternValid ? 'text-profit' : 'text-loss'}`}>
                        {cleanM2Pattern.length === 0 ? 'Enter pattern...' :
                          m2PatternValid ? `✓ ${cleanM2Pattern}` : `✗ Need 2+`}
                      </div>
                    </>
                  ) : m2StrategyMode === 'digit' ? (
                    <>
                      <div className="grid grid-cols-3 gap-1 mt-0.5">
                        <label className="text-[8px] text-muted-foreground text-center">Condition</label>
                        <label className="text-[8px] text-muted-foreground text-center">Digit</label>
                        <label className="text-[8px] text-muted-foreground text-center">Ticks</label>
                      </div>
                      <div className="grid grid-cols-3 gap-1">
                        <Select value={m2DigitCondition} onValueChange={setM2DigitCondition} disabled={isRunning}>
                          <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {['==', '>', '<', '>=', '<='].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        <Input type="number" min="0" max="9" value={m2DigitCompare} onChange={e => setM2DigitCompare(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                        <Input type="number" min="1" max="50" value={m2DigitWindow} onChange={e => setM2DigitWindow(e.target.value)} disabled={isRunning} className="h-6 text-[10px]" />
                      </div>
                    </>
                  ) : (
                    <div className="text-[10px] text-center py-1 text-muted-foreground">
                      Auto strategy based on market analysis
                    </div>
                  )}
                </div>
              )}

              {botStatus === 'waiting_signal' && (
                <div className="bg-warning/10 border border-warning/30 rounded p-1.5 text-[9px] text-warning animate-pulse text-center font-semibold">
                  ⏳ WAITING FOR STRONG SIGNAL...
                </div>
              )}
              {botStatus === 'signal_confirmed' && (
                <div className="bg-profit/10 border border-profit/30 rounded p-1.5 text-[9px] text-profit text-center font-semibold animate-pulse">
                  ✅ SIGNAL CONFIRMED! EXECUTING TRADE...
                </div>
              )}
            </div>
          )}

          {/* Save / Load Config */}
          <div className="bg-card border border-border rounded-xl p-2.5 space-y-1.5">
            <h3 className="text-xs font-semibold text-foreground flex items-center gap-1">💾 Bot Config</h3>
            <Input
              placeholder="Enter bot name before saving..."
              value={botName}
              onChange={e => setBotName(e.target.value)}
              disabled={isRunning}
              className="h-7 text-xs"
            />
            <div className="grid grid-cols-2 gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[10px] gap-1"
                disabled={isRunning || !botName.trim()}
                onClick={() => {
                  const safeName = botName.trim().replace(/[^a-zA-Z0-9_-]/g, '_');
                  const config = {
                    version: 1,
                    botName: botName.trim(),
                    m1: { enabled: m1Enabled, symbol: m1Symbol, contract: m1Contract, barrier: m1Barrier, hookEnabled: m1HookEnabled, virtualLossCount: m1VirtualLossCount, realCount: m1RealCount },
                    m2: { enabled: m2Enabled, symbol: m2Symbol, contract: m2Contract, barrier: m2Barrier, hookEnabled: m2HookEnabled, virtualLossCount: m2VirtualLossCount, realCount: m2RealCount },
                    risk: { stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss },
                    strategy: {
                      m1Enabled: strategyM1Enabled, m2Enabled: strategyEnabled,
                      m1Mode: m1StrategyMode, m2Mode: m2StrategyMode,
                      m1Pattern, m1DigitCondition, m1DigitCompare, m1DigitWindow,
                      m2Pattern, m2DigitCondition, m2DigitCompare, m2DigitWindow,
                    },
                    scanner: { active: scannerActive },
                    turbo: { enabled: turboMode },
                  };
                  const now = new Date();
                  const ts = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}-${String(now.getSeconds()).padStart(2,'0')}`;
                  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = `${safeName}_${ts}.json`; a.click();
                  URL.revokeObjectURL(url);
                  toast.success(`Config "${botName.trim()}" saved!`);
                }}
              >
                <Download className="w-3 h-3" /> Save Config
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-[10px] gap-1"
                disabled={isRunning}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file'; input.accept = '.json';
                  input.onchange = (ev: any) => {
                    const file = ev.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (e) => {
                      try {
                        const cfg = JSON.parse(e.target?.result as string);
                        if (!cfg.version || !cfg.m1 || !cfg.m2 || !cfg.risk) {
                          toast.error('Invalid config file format'); return;
                        }
                        // M1
                        if (cfg.m1.enabled !== undefined) setM1Enabled(cfg.m1.enabled);
                        if (cfg.m1.symbol) setM1Symbol(cfg.m1.symbol);
                        if (cfg.m1.contract) setM1Contract(cfg.m1.contract);
                        if (cfg.m1.barrier) setM1Barrier(cfg.m1.barrier);
                        if (cfg.m1.hookEnabled !== undefined) setM1HookEnabled(cfg.m1.hookEnabled);
                        if (cfg.m1.virtualLossCount) setM1VirtualLossCount(cfg.m1.virtualLossCount);
                        if (cfg.m1.realCount) setM1RealCount(cfg.m1.realCount);
                        // M2
                        if (cfg.m2.enabled !== undefined) setM2Enabled(cfg.m2.enabled);
                        if (cfg.m2.symbol) setM2Symbol(cfg.m2.symbol);
                        if (cfg.m2.contract) setM2Contract(cfg.m2.contract);
                        if (cfg.m2.barrier) setM2Barrier(cfg.m2.barrier);
                        if (cfg.m2.hookEnabled !== undefined) setM2HookEnabled(cfg.m2.hookEnabled);
                        if (cfg.m2.virtualLossCount) setM2VirtualLossCount(cfg.m2.virtualLossCount);
                        if (cfg.m2.realCount) setM2RealCount(cfg.m2.realCount);
                        // Risk
                        if (cfg.risk.stake) setStake(cfg.risk.stake);
                        if (cfg.risk.martingaleOn !== undefined) setMartingaleOn(cfg.risk.martingaleOn);
                        if (cfg.risk.martingaleMultiplier) setMartingaleMultiplier(cfg.risk.martingaleMultiplier);
                        if (cfg.risk.martingaleMaxSteps) setMartingaleMaxSteps(cfg.risk.martingaleMaxSteps);
                        if (cfg.risk.takeProfit) setTakeProfit(cfg.risk.takeProfit);
                        if (cfg.risk.stopLoss) setStopLoss(cfg.risk.stopLoss);
                        // Strategy
                        if (cfg.strategy) {
                          if (cfg.strategy.m1Enabled !== undefined) setStrategyM1Enabled(cfg.strategy.m1Enabled);
                          if (cfg.strategy.m2Enabled !== undefined) setStrategyEnabled(cfg.strategy.m2Enabled);
                          if (cfg.strategy.m1Mode) setM1StrategyMode(cfg.strategy.m1Mode);
                          if (cfg.strategy.m2Mode) setM2StrategyMode(cfg.strategy.m2Mode);
                          if (cfg.strategy.m1Pattern !== undefined) setM1Pattern(cfg.strategy.m1Pattern);
                          if (cfg.strategy.m1DigitCondition) setM1DigitCondition(cfg.strategy.m1DigitCondition);
                          if (cfg.strategy.m1DigitCompare) setM1DigitCompare(cfg.strategy.m1DigitCompare);
                          if (cfg.strategy.m1DigitWindow) setM1DigitWindow(cfg.strategy.m1DigitWindow);
                          if (cfg.strategy.m2Pattern !== undefined) setM2Pattern(cfg.strategy.m2Pattern);
                          if (cfg.strategy.m2DigitCondition) setM2DigitCondition(cfg.strategy.m2DigitCondition);
                          if (cfg.strategy.m2DigitCompare) setM2DigitCompare(cfg.strategy.m2DigitCompare);
                          if (cfg.strategy.m2DigitWindow) setM2DigitWindow(cfg.strategy.m2DigitWindow);
                        }
                        // Scanner & Turbo
                        if (cfg.scanner?.active !== undefined) setScannerActive(cfg.scanner.active);
                        if (cfg.turbo?.enabled !== undefined) setTurboMode(cfg.turbo.enabled);
                        if (cfg.botName) setBotName(cfg.botName);
                        toast.success('Config loaded successfully!');
                      } catch {
                        toast.error('Failed to parse config file');
                      }
                    };
                    reader.readAsText(file);
                  };
                  input.click();
                }}
              >
                <Upload className="w-3 h-3" /> Load Config
              </Button>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Digit Stream + Analysis + Activity Log ═══ */}
        <div className="lg:col-span-8 space-y-2">
          {/* Digit Stream */}
          <div className="bg-card border border-border rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10px] font-semibold text-foreground">Live Digits — {activeSymbol}</h3>
              <span className="text-[9px] text-muted-foreground font-mono">
                Win Rate: {winRate}% | Staked: ${totalStaked.toFixed(2)} | Buffer: {digitAnalyzersRef.current.get(activeSymbol)?.size || 0}/1000
              </span>
            </div>
            <div className="flex gap-1 flex-wrap justify-center">
              {liveDigits.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">Waiting for ticks...</span>
              ) : liveDigits.map((d, i) => {
                const isOver = d >= 5;
                const isEven = d % 2 === 0;
                const isLast = i === liveDigits.length - 1;
                return (
                  <div key={i} className={`w-7 h-9 rounded-lg flex flex-col items-center justify-center text-xs font-mono font-bold border ${
                    isLast ? 'ring-2 ring-primary' : ''
                  } ${isOver ? 'bg-loss/10 border-loss/30 text-loss' : 'bg-profit/10 border-profit/30 text-profit'}`}>
                    <span className="text-sm">{d}</span>
                    <span className="text-[6px] opacity-60">{isOver ? 'O' : 'U'}{isEven ? 'E' : 'O'}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* UPDATED: Digit Analysis Panel - Enhanced with strategy-specific metrics */}
          <div className="bg-card border border-border rounded-xl p-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-foreground">Digit Analysis — {activeSymbol} <span className="text-[9px] text-muted-foreground ml-1">(last {digitAnalyzersRef.current.get(activeSymbol)?.size || 0}/1000 ticks)</span></h3>
              {digitAnalysis.signalStrength > 50 && (
                <Badge className="bg-profit text-profit-foreground text-[8px] animate-pulse">
                  Signal: {digitAnalysis.signalStrength.toFixed(0)}%
                </Badge>
              )}
            </div>

            {/* Strategy-specific stats cards */}
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded p-1.5">
                <div className="text-[8px] text-[#D29922]">Odd</div>
                <div className="font-mono text-xs font-bold text-[#D29922]">{digitAnalysis.oddPct}%</div>
                <Progress value={digitAnalysis.oddPct} className="h-1 mt-0.5 bg-muted" indicatorClassName="bg-[#D29922]" />
                {selectedStrategy === 'odd' && digitAnalysis.oddPct > 55 && (
                  <Badge className="mt-1 text-[6px] px-1 py-0 bg-profit">✓ ENTRY</Badge>
                )}
              </div>
              <div className="bg-[#3FB950]/10 border border-[#3FB950]/30 rounded p-1.5">
                <div className="text-[8px] text-[#3FB950]">Even</div>
                <div className="font-mono text-xs font-bold text-[#3FB950]">{digitAnalysis.evenPct}%</div>
                <Progress value={digitAnalysis.evenPct} className="h-1 mt-0.5 bg-muted" indicatorClassName="bg-[#3FB950]" />
                {selectedStrategy === 'even' && digitAnalysis.evenPct > 55 && (
                  <Badge className="mt-1 text-[6px] px-1 py-0 bg-profit">✓ ENTRY</Badge>
                )}
              </div>
              <div className="bg-primary/10 border border-primary/30 rounded p-1.5">
                <div className="text-[8px] text-primary">Over 4</div>
                <div className="font-mono text-xs font-bold text-primary">{digitAnalysis.over4Pct}%</div>
                <Progress value={digitAnalysis.over4Pct} className="h-1 mt-0.5 bg-muted" indicatorClassName="bg-primary" />
                {selectedStrategy === 'over4' && digitAnalysis.over4Pct > 60 && (
                  <Badge className="mt-1 text-[6px] px-1 py-0 bg-profit">✓ ENTRY</Badge>
                )}
              </div>
              <div className="bg-[#D29922]/10 border border-[#D29922]/30 rounded p-1.5">
                <div className="text-[8px] text-[#D29922]">Under 5</div>
                <div className="font-mono text-xs font-bold text-[#D29922]">{digitAnalysis.under5Pct}%</div>
                <Progress value={digitAnalysis.under5Pct} className="h-1 mt-0.5 bg-muted" indicatorClassName="bg-[#D29922]" />
                {selectedStrategy === 'under5' && digitAnalysis.under5Pct > 60 && (
                  <Badge className="mt-1 text-[6px] px-1 py-0 bg-profit">✓ ENTRY</Badge>
                )}
              </div>
            </div>

            {/* Recovery stats */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="bg-purple-500/10 border border-purple-500/30 rounded p-1.5">
                <div className="text-[8px] text-purple-400">Over 1</div>
                <div className="font-mono text-xs font-bold text-purple-400">{digitAnalysis.over1Pct}%</div>
                <Progress value={digitAnalysis.over1Pct} className="h-1 mt-0.5 bg-muted" indicatorClassName="bg-purple-500" />
              </div>
              <div className="bg-purple-500/10 border border-purple-500/30 rounded p-1.5">
                <div className="text-[8px] text-purple-400">Under 8</div>
                <div className="font-mono text-xs font-bold text-purple-400">{digitAnalysis.under8Pct}%</div>
                <Progress value={digitAnalysis.under8Pct} className="h-1 mt-0.5 bg-muted" indicatorClassName="bg-purple-500" />
              </div>
            </div>

            {/* Digit Grid 0-9 */}
            <div className="grid grid-cols-5 md:grid-cols-10 gap-1">
              {Array.from({ length: 10 }, (_, d) => {
                const pct = digitAnalysis.percentages[d] || 0;
                const count = digitAnalysis.counts[d] || 0;
                const isTop3 = digitAnalysis.top3.includes(d);
                const isBottom3 = digitAnalysis.bottom3.includes(d);
                const isMostFrequent = d === digitAnalysis.mostFrequent;
                const isLeastFrequent = d === digitAnalysis.leastFrequent;
                
                let bgColor = 'bg-card';
                if (isMostFrequent) bgColor = 'bg-profit/20 border-profit';
                else if (isLeastFrequent) bgColor = 'bg-loss/20 border-loss';
                else if (isTop3) bgColor = 'bg-profit/10 border-profit/30';
                else if (isBottom3) bgColor = 'bg-loss/10 border-loss/30';
                
                return (
                  <button
                    key={d}
                    onClick={() => {
                      if (currentMarket === 1 && needsBarrier(m1Contract)) {
                        setM1Barrier(String(d));
                      } else if (currentMarket === 2 && needsBarrier(m2Contract)) {
                        setM2Barrier(String(d));
                      }
                    }}
                    className={`relative rounded p-1 text-center transition-all border cursor-pointer hover:ring-1 hover:ring-primary ${bgColor} ${
                      (currentMarket === 1 && needsBarrier(m1Contract) && m1Barrier === String(d)) ||
                      (currentMarket === 2 && needsBarrier(m2Contract) && m2Barrier === String(d)) ? 'ring-1 ring-primary' : ''
                    }`}
                  >
                    <div className="font-mono text-base font-bold">{d}</div>
                    <div className="text-[8px] leading-tight">{count}</div>
                    <div className="text-[7px] leading-tight opacity-70">{pct.toFixed(1)}%</div>
                    <Progress value={pct} className="h-0.5 mt-0.5 bg-muted" indicatorClassName={
                      isMostFrequent ? 'bg-profit' : 
                      isLeastFrequent ? 'bg-loss' : 
                      isTop3 ? 'bg-profit/70' : 
                      isBottom3 ? 'bg-loss/70' : 'bg-primary'
                    } />
                    {isMostFrequent && (
                      <Badge className="absolute -top-1 -right-1 text-[5px] px-0.5 py-0 h-3 min-w-0 bg-profit text-profit-foreground">1</Badge>
                    )}
                    {isLeastFrequent && (
                      <Badge className="absolute -top-1 -left-1 text-[5px] px-0.5 py-0 h-3 min-w-0 bg-loss text-loss-foreground">9</Badge>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Top/Bottom 3 */}
            <div className="grid grid-cols-2 gap-2">
              <div className="bg-profit/5 border border-profit/20 rounded p-1.5">
                <div className="text-[8px] text-profit font-semibold flex items-center gap-1">
                  <ArrowUp className="w-2.5 h-2.5" /> Top 3 Digits
                </div>
                <div className="flex gap-1 mt-1">
                  {digitAnalysis.top3.map(d => (
                    <Badge key={d} variant="outline" className="bg-profit/10 text-profit border-profit/30 text-[10px] px-1.5">
                      {d} ({digitAnalysis.counts[d]})
                    </Badge>
                  ))}
                </div>
              </div>
              <div className="bg-loss/5 border border-loss/20 rounded p-1.5">
                <div className="text-[8px] text-loss font-semibold flex items-center gap-1">
                  <ArrowDown className="w-2.5 h-2.5" /> Bottom 3 Digits
                </div>
                <div className="flex gap-1 mt-1">
                  {digitAnalysis.bottom3.map(d => (
                    <Badge key={d} variant="outline" className="bg-loss/10 text-loss border-loss/30 text-[10px] px-1.5">
                      {d} ({digitAnalysis.counts[d]})
                    </Badge>
                  ))}
                </div>
              </div>
            </div>

            {/* Strategic Recommendations */}
            <div className="grid grid-cols-4 gap-1.5">
              <div className="bg-card border border-profit/30 rounded p-1 text-center">
                <div className="text-[7px] text-muted-foreground">Best Match</div>
                <div className="font-mono text-sm font-bold text-profit">{digitAnalysis.mostFrequent}</div>
                <div className="text-[6px] text-muted-foreground">{digitAnalysis.percentages[digitAnalysis.mostFrequent]?.toFixed(1)}%</div>
              </div>
              <div className="bg-card border border-loss/30 rounded p-1 text-center">
                <div className="text-[7px] text-muted-foreground">Best Differ</div>
                <div className="font-mono text-sm font-bold text-loss">{digitAnalysis.leastFrequent}</div>
                <div className="text-[6px] text-muted-foreground">{digitAnalysis.percentages[digitAnalysis.leastFrequent]?.toFixed(1)}%</div>
              </div>
              <div className="bg-card border border-[#D29922]/30 rounded p-1 text-center">
                <div className="text-[7px] text-muted-foreground">Even/Odd</div>
                <div className={`font-mono text-sm font-bold ${digitAnalysis.evenPct > 50 ? 'text-[#3FB950]' : 'text-[#D29922]'}`}>
                  {digitAnalysis.evenPct > 50 ? 'EVEN' : 'ODD'}
                </div>
                <div className="text-[6px] text-muted-foreground">{Math.max(digitAnalysis.evenPct, digitAnalysis.oddPct)}%</div>
              </div>
              <div className="bg-card border border-primary/30 rounded p-1 text-center">
                <div className="text-[7px] text-muted-foreground">Over/Under</div>
                <div className={`font-mono text-sm font-bold ${digitAnalysis.over4Pct > 50 ? 'text-primary' : 'text-[#D29922]'}`}>
                  {digitAnalysis.over4Pct > 50 ? 'OVER 4' : 'UNDER 5'}
                </div>
                <div className="text-[6px] text-muted-foreground">{Math.max(digitAnalysis.over4Pct, digitAnalysis.under5Pct)}%</div>
              </div>
            </div>
          </div>

          {/* Trade Summary Panel */}
          <div className="grid grid-cols-5 gap-1.5">
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Trades</div>
              <div className="font-mono text-xs font-bold text-foreground">{wins + losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Wins</div>
              <div className="font-mono text-xs font-bold text-profit">{wins}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Losses</div>
              <div className="font-mono text-xs font-bold text-loss">{losses}</div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Profit/Loss</div>
              <div className={`font-mono text-xs font-bold ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
                {netProfit >= 0 ? '+' : ''}{netProfit.toFixed(2)}
              </div>
            </div>
            <div className="bg-card border border-border rounded-lg p-2 text-center">
              <div className="text-[8px] text-muted-foreground">Total Staked</div>
              <div className="font-mono text-xs font-bold text-primary">${totalStaked.toFixed(2)}</div>
            </div>
          </div>

          {/* Start / Stop Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={startBot}
              disabled={isRunning || !isAuthorized || balance < botSettings[selectedStrategy].stake}
              className="h-14 text-base font-bold bg-profit hover:bg-profit/90 text-profit-foreground rounded-xl"
            >
              <Play className="w-5 h-5 mr-2" /> START AUTO BOT
            </Button>
            <Button
              onClick={stopBot}
              disabled={!isRunning}
              variant="destructive"
              className="h-14 text-base font-bold rounded-xl"
            >
              <StopCircle className="w-5 h-5 mr-2" /> STOP
            </Button>
          </div>

          {/* Activity Log */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-2.5 py-2 border-b border-border flex items-center justify-between gap-2">
              <h3 className="text-xs font-semibold text-foreground">Activity Log</h3>
              <div className="flex items-center gap-1.5">
                {isRunning && (
                  <Badge variant="outline" className="text-[8px]">
                    {isTrading ? 'TRADING' : 'WAITING'}
                  </Badge>
                )}
                {logEntries.length > 0 && logEntries[0].switchInfo && (
                  <span className="text-[9px] text-muted-foreground font-mono hidden md:inline truncate max-w-[200px]">
                    {logEntries[0].switchInfo}
                  </span>
                )}
                {!isRunning ? (
                  <Button onClick={startBot} disabled={!isAuthorized || balance < botSettings[selectedStrategy].stake}
                    size="sm" className="h-7 text-[10px] font-bold bg-profit hover:bg-profit/90 text-profit-foreground px-3">
                    <Play className="w-3 h-3 mr-1" /> START
                  </Button>
                ) : (
                  <Button onClick={stopBot} variant="destructive" size="sm" className="h-7 text-[10px] font-bold px-3">
                    <StopCircle className="w-3 h-3 mr-1" /> STOP
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearLog} className="h-7 w-7 p-0 text-muted-foreground hover:text-loss">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <div className="max-h-[calc(100vh-580px)] min-h-[300px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="text-[9px] text-muted-foreground bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-1.5">Time</th>
                    <th className="text-left p-1">Mkt</th>
                    <th className="text-left p-1">Symbol</th>
                    <th className="text-left p-1">Strategy</th>
                    <th className="text-right p-1">Stake</th>
                    <th className="text-center p-1">Digit</th>
                    <th className="text-center p-1">Result</th>
                    <th className="text-right p-1">P/L</th>
                    <th className="text-right p-1">Bal</th>
                  </tr>
                </thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr><td colSpan={9} className="text-center text-muted-foreground py-8">No trades yet — configure and start the bot</td></tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className={`border-t border-border/30 hover:bg-muted/20 ${
                      e.market === 'M1' ? 'border-l-2 border-l-profit' :
                      e.market === 'VH' ? 'border-l-2 border-l-primary' :
                      'border-l-2 border-l-purple-500'
                    }`}>
                      <td className="p-1 font-mono text-[9px]">{e.time}</td>
                      <td className={`p-1 font-bold ${
                        e.market === 'M1' ? 'text-profit' :
                        e.market === 'VH' ? 'text-primary' :
                        'text-purple-400'
                      }`}>{e.market}</td>
                      <td className="p-1 font-mono text-[9px]">{e.symbol}</td>
                      <td className="p-1 text-[8px]">{e.strategy || '-'}</td>
                      <td className="p-1 font-mono text-right text-[9px]">
                        {e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}
                        {e.martingaleStep > 0 && e.market !== 'VH' && <span className="text-warning ml-0.5">M{e.martingaleStep}</span>}
                      </td>
                      <td className="p-1 text-center font-mono">{e.exitDigit}</td>
                      <td className="p-1 text-center">
                        <span className={`px-1 py-0.5 rounded-full text-[8px] font-bold ${
                          e.result === 'Win' || e.result === 'V-Win' ? 'bg-profit/20 text-profit' :
                          e.result === 'Loss' || e.result === 'V-Loss' ? 'bg-loss/20 text-loss' :
                          'bg-warning/20 text-warning animate-pulse'
                        }`}>{e.result === 'Pending' ? '...' : e.result}</span>
                      </td>
                      <td className={`p-1 font-mono text-right text-[9px] ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>
                        {e.result === 'Pending' ? '...' : e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}
                      </td>
                      <td className="p-1 font-mono text-right text-[9px]">{e.market === 'VH' ? '-' : `$${e.balance.toFixed(2)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
