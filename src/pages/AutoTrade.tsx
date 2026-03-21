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
import { toast } from 'sonner';
import {
  Play, StopCircle, Trash2, Scan,
  Home, RefreshCw, Shield, Zap, Eye, Anchor, Download, Upload, Signal, TrendingUp, TrendingDown, Sparkles
} from 'lucide-react';

/* ───── CONSTANTS ───── */
const VOLATILITIES = {
  vol: ["1HZ10V", "1HZ25V", "1HZ50V", "1HZ75V", "1HZ100V", "R_10", "R_25", "R_50", "R_75", "R_100"],
  jump: ["JD10", "JD25", "JD50", "JD75", "JD100"],
  bull: ["RDBULL"],
  bear: ["RDBEAR"],
};

const ALL_SYMBOLS = [...VOLATILITIES.vol, ...VOLATILITIES.jump, ...VOLATILITIES.bull, ...VOLATILITIES.bear];

const CONTRACT_TYPES = [
  'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER',
] as const;

const needsBarrier = (ct: string) => ['DIGITMATCH', 'DIGITDIFF', 'DIGITOVER', 'DIGITUNDER'].includes(ct);

type BotStatus = 'idle' | 'trading_m1' | 'recovery' | 'waiting_pattern' | 'pattern_matched' | 'virtual_hook';

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
}

/* ── Signal Types ── */
interface PatternSignal {
  pattern: string;
  wins: number;
  winDigits: string[];
  loses: number;
  loseDigits: string[];
}

interface TopSignal {
  symbol: string;
  type: string;
  name: string;
  strength: number;
  detail: string;
  pattern: string;
  wins: number;
  direction: 'up' | 'down' | 'neutral';
}

/* ── Circular Tick Buffer ── */
class CircularTickBuffer {
  private buffer: { digit: number; ts: number }[];
  private head = 0;
  private count = 0;
  constructor(private capacity = 2000) {
    this.buffer = new Array(capacity);
  }
  push(digit: number) {
    this.buffer[this.head] = { digit, ts: performance.now() };
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }
  getAllDigits(): number[] {
    if (this.count === 0) return [];
    const result: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.head - this.count + i + this.capacity) % this.capacity;
      result.push(this.buffer[idx].digit);
    }
    return result;
  }
  get size() { return this.count; }
}

function waitForNextTick(symbol: string): Promise<{ quote: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) { unsub(); resolve({ quote: data.tick.quote }); }
    });
  });
}

/* ── Advanced Pattern Analysis Engine (from signal generator) ── */
function analyzePatterns(ticks: number[], threshold: number = 5, patternLengths: number[] = [2, 3, 4]): {
  bestOver: PatternSignal | null;
  bestUnder: PatternSignal | null;
  bestEven: PatternSignal | null;
  bestOdd: PatternSignal | null;
  overRate: number;
  underRate: number;
  evenRate: number;
  oddRate: number;
  totalTicks: number;
} | null {
  if (!ticks || ticks.length < 20) return null;
  
  const recentTicks = ticks.slice(-2000);
  const totalTicks = recentTicks.length;
  
  // Calculate basic rates
  let overCount = 0, underCount = 0, evenCount = 0, oddCount = 0;
  recentTicks.forEach(d => {
    if (d > threshold) overCount++;
    else if (d < threshold) underCount++;
    if (d % 2 === 0) evenCount++;
    else oddCount++;
  });
  
  const overRate = totalTicks > 0 ? overCount / totalTicks : 0.5;
  const underRate = totalTicks > 0 ? underCount / totalTicks : 0.5;
  const evenRate = totalTicks > 0 ? evenCount / totalTicks : 0.5;
  const oddRate = totalTicks > 0 ? oddCount / totalTicks : 0.5;
  
  let bestOver: PatternSignal | null = null;
  let bestUnder: PatternSignal | null = null;
  let bestEven: PatternSignal | null = null;
  let bestOdd: PatternSignal | null = null;
  
  for (const len of patternLengths) {
    const overPatterns: Record<string, PatternSignal> = {};
    const underPatterns: Record<string, PatternSignal> = {};
    const evenPatterns: Record<string, PatternSignal> = {};
    const oddPatterns: Record<string, PatternSignal> = {};
    
    for (let i = 0; i < recentTicks.length - len; i++) {
      const nextDigit = recentTicks[i + len];
      const pattern = recentTicks.slice(i, i + len).join("");
      
      // Over/Under analysis
      if (nextDigit > threshold) {
        if (!overPatterns[pattern]) overPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        overPatterns[pattern].wins++;
        overPatterns[pattern].winDigits.push(nextDigit.toString());
        if (overPatterns[pattern].winDigits.length > 13) overPatterns[pattern].winDigits.shift();
        
        if (!underPatterns[pattern]) underPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        underPatterns[pattern].loses++;
        underPatterns[pattern].loseDigits.push(nextDigit.toString());
        if (underPatterns[pattern].loseDigits.length > 13) underPatterns[pattern].loseDigits.shift();
      } else {
        if (!underPatterns[pattern]) underPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        underPatterns[pattern].wins++;
        underPatterns[pattern].winDigits.push(nextDigit.toString());
        if (underPatterns[pattern].winDigits.length > 13) underPatterns[pattern].winDigits.shift();
        
        if (!overPatterns[pattern]) overPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        overPatterns[pattern].loses++;
        overPatterns[pattern].loseDigits.push(nextDigit.toString());
        if (overPatterns[pattern].loseDigits.length > 13) overPatterns[pattern].loseDigits.shift();
      }
      
      // Even/Odd analysis
      if (nextDigit % 2 === 0) {
        if (!evenPatterns[pattern]) evenPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        evenPatterns[pattern].wins++;
        evenPatterns[pattern].winDigits.push("E");
        if (evenPatterns[pattern].winDigits.length > 13) evenPatterns[pattern].winDigits.shift();
        
        if (!oddPatterns[pattern]) oddPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        oddPatterns[pattern].loses++;
        oddPatterns[pattern].loseDigits.push("E");
        if (oddPatterns[pattern].loseDigits.length > 13) oddPatterns[pattern].loseDigits.shift();
      } else {
        if (!oddPatterns[pattern]) oddPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        oddPatterns[pattern].wins++;
        oddPatterns[pattern].winDigits.push("O");
        if (oddPatterns[pattern].winDigits.length > 13) oddPatterns[pattern].winDigits.shift();
        
        if (!evenPatterns[pattern]) evenPatterns[pattern] = { pattern, wins: 0, winDigits: [], loses: 0, loseDigits: [] };
        evenPatterns[pattern].loses++;
        evenPatterns[pattern].loseDigits.push("O");
        if (evenPatterns[pattern].loseDigits.length > 13) evenPatterns[pattern].loseDigits.shift();
      }
    }
    
    // Get top patterns
    const topOver = Object.values(overPatterns).sort((a, b) => b.wins - a.wins).slice(0, 1);
    const topUnder = Object.values(underPatterns).sort((a, b) => b.wins - a.wins).slice(0, 1);
    const topEven = Object.values(evenPatterns).sort((a, b) => b.wins - a.wins).slice(0, 1);
    const topOdd = Object.values(oddPatterns).sort((a, b) => b.wins - a.wins).slice(0, 1);
    
    if (!bestOver && topOver.length && topOver[0].wins > 5) bestOver = topOver[0];
    if (!bestUnder && topUnder.length && topUnder[0].wins > 5) bestUnder = topUnder[0];
    if (!bestEven && topEven.length && topEven[0].wins > 5) bestEven = topEven[0];
    if (!bestOdd && topOdd.length && topOdd[0].wins > 5) bestOdd = topOdd[0];
  }
  
  return {
    bestOver,
    bestUnder,
    bestEven,
    bestOdd,
    overRate,
    underRate,
    evenRate,
    oddRate,
    totalTicks
  };
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

  /* ── Market 1 config ── */
  const [m1Enabled, setM1Enabled] = useState(true);
  const [m1Contract, setM1Contract] = useState('DIGITEVEN');
  const [m1Barrier, setM1Barrier] = useState('5');
  const [m1Symbol, setM1Symbol] = useState('R_100');

  /* ── Market 2 config ── */
  const [m2Enabled, setM2Enabled] = useState(true);
  const [m2Contract, setM2Contract] = useState('DIGITODD');
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

  /* ── Risk ── */
  const [stake, setStake] = useState('0.35');
  const [martingaleOn, setMartingaleOn] = useState(false);
  const [martingaleMultiplier, setMartingaleMultiplier] = useState('2.0');
  const [martingaleMaxSteps, setMartingaleMaxSteps] = useState('5');
  const [takeProfit, setTakeProfit] = useState('10');
  const [stopLoss, setStopLoss] = useState('5');

  /* ── Strategy ── */
  const [strategyEnabled, setStrategyEnabled] = useState(false);
  const [strategyM1Enabled, setStrategyM1Enabled] = useState(false);
  const [m1StrategyMode, setM1StrategyMode] = useState<'pattern' | 'digit'>('pattern');
  const [m2StrategyMode, setM2StrategyMode] = useState<'pattern' | 'digit'>('pattern');

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
  const [scannerActive, setScannerActive] = useState(false);

  /* ── Turbo ── */
  const [turboMode, setTurboMode] = useState(false);
  const [botName, setBotName] = useState('');
  const [turboLatency, setTurboLatency] = useState(0);
  const [ticksCaptured, setTicksCaptured] = useState(0);
  const [ticksMissed, setTicksMissed] = useState(0);
  const lastTickTsRef = useRef(0);

  /* ── Signal Forge State ── */
  const [topSignals, setTopSignals] = useState<TopSignal[]>([]);
  const [signalMarketGroup, setSignalMarketGroup] = useState<'all' | 'vol' | 'jump' | 'bull' | 'bear'>('all');
  const [lastSignalUpdate, setLastSignalUpdate] = useState<Date>(new Date());

  /* ── Bot state ── */
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

  /* ── Tick data store ── */
  const tickMapRef = useRef<Map<string, number[]>>(new Map());
  const [tickCounts, setTickCounts] = useState<Record<string, number>>({});

  /* ── Generate Signals IMMEDIATELY using pattern analysis ── */
  const generateSignals = useCallback(() => {
    const allSignals: TopSignal[] = [];
    
    // Determine symbols to scan based on selected group
    let symbolsToScan: string[] = [];
    if (signalMarketGroup === 'all') {
      symbolsToScan = ALL_SYMBOLS;
    } else if (signalMarketGroup === 'vol') {
      symbolsToScan = VOLATILITIES.vol;
    } else if (signalMarketGroup === 'jump') {
      symbolsToScan = VOLATILITIES.jump;
    } else if (signalMarketGroup === 'bull') {
      symbolsToScan = VOLATILITIES.bull;
    } else if (signalMarketGroup === 'bear') {
      symbolsToScan = VOLATILITIES.bear;
    }
    
    for (const symbol of symbolsToScan) {
      const ticks = tickMapRef.current.get(symbol) || [];
      if (ticks.length < 20) continue; // Need at least 20 ticks for analysis
      
      const analysis = analyzePatterns(ticks, 5, [2, 3, 4]);
      if (!analysis) continue;
      
      const { bestOver, bestUnder, bestEven, bestOdd, overRate, underRate, evenRate, oddRate } = analysis;
      const tickConfidence = Math.min(0.95, 0.5 + (ticks.length / 2000));
      
      // Over signal
      if (bestOver && bestOver.wins > 5) {
        const winRate = bestOver.wins / (bestOver.wins + bestOver.loses);
        const strength = Math.min(0.95, (0.55 + winRate * 0.35 + overRate * 0.2) * tickConfidence);
        allSignals.push({
          symbol,
          type: 'OVER',
          name: '📈 OVER',
          strength,
          detail: `Pattern "${bestOver.pattern}" → ${bestOver.wins}W/${bestOver.loses}L (${(winRate * 100).toFixed(0)}% WR)`,
          pattern: bestOver.pattern,
          wins: bestOver.wins,
          direction: 'up'
        });
      }
      
      // Under signal
      if (bestUnder && bestUnder.wins > 5) {
        const winRate = bestUnder.wins / (bestUnder.wins + bestUnder.loses);
        const strength = Math.min(0.95, (0.55 + winRate * 0.35 + underRate * 0.2) * tickConfidence);
        allSignals.push({
          symbol,
          type: 'UNDER',
          name: '📉 UNDER',
          strength,
          detail: `Pattern "${bestUnder.pattern}" → ${bestUnder.wins}W/${bestUnder.loses}L (${(winRate * 100).toFixed(0)}% WR)`,
          pattern: bestUnder.pattern,
          wins: bestUnder.wins,
          direction: 'down'
        });
      }
      
      // Even signal
      if (bestEven && bestEven.wins > 5) {
        const winRate = bestEven.wins / (bestEven.wins + bestEven.loses);
        const strength = Math.min(0.95, (0.55 + winRate * 0.35 + evenRate * 0.2) * tickConfidence);
        allSignals.push({
          symbol,
          type: 'EVEN',
          name: '🎲 EVEN',
          strength,
          detail: `Pattern "${bestEven.pattern}" → ${bestEven.wins}W/${bestEven.loses}L (${(winRate * 100).toFixed(0)}% WR)`,
          pattern: bestEven.pattern,
          wins: bestEven.wins,
          direction: 'down'
        });
      }
      
      // Odd signal
      if (bestOdd && bestOdd.wins > 5) {
        const winRate = bestOdd.wins / (bestOdd.wins + bestOdd.loses);
        const strength = Math.min(0.95, (0.55 + winRate * 0.35 + oddRate * 0.2) * tickConfidence);
        allSignals.push({
          symbol,
          type: 'ODD',
          name: '🎲 ODD',
          strength,
          detail: `Pattern "${bestOdd.pattern}" → ${bestOdd.wins}W/${bestOdd.loses}L (${(winRate * 100).toFixed(0)}% WR)`,
          pattern: bestOdd.pattern,
          wins: bestOdd.wins,
          direction: 'up'
        });
      }
    }
    
    // Sort by strength and get top 4
    allSignals.sort((a, b) => b.strength - a.strength);
    setTopSignals(allSignals.slice(0, 4));
    setLastSignalUpdate(new Date());
  }, [signalMarketGroup]);

  /* ── Auto-update signals every 3 seconds (IMMEDIATE FEEDBACK) ── */
  useEffect(() => {
    // Initial immediate update
    generateSignals();
    
    // Then update every 3 seconds
    const interval = setInterval(() => {
      generateSignals();
    }, 3000);
    
    return () => clearInterval(interval);
  }, [generateSignals]);

  /* ── Subscribe to all markets using derivApi ── */
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const digit = getLastDigit(data.tick.quote);
      const now = performance.now();

      // Store ticks for pattern analysis
      const map = tickMapRef.current;
      const arr = map.get(sym) || [];
      arr.push(digit);
      if (arr.length > 3000) arr.shift();
      map.set(sym, arr);
      setTickCounts(prev => ({ ...prev, [sym]: arr.length }));

      // Turbo latency tracking
      if (lastTickTsRef.current > 0) {
        const lat = now - lastTickTsRef.current;
        setTurboLatency(Math.round(lat));
        if (lat > 50) setTicksMissed(prev => prev + 1);
      }
      lastTickTsRef.current = now;
      setTicksCaptured(prev => prev + 1);
    };
    
    const unsub = derivApi.onMessage(handler);
    
    // Subscribe to all markets
    ALL_SYMBOLS.forEach(symbol => {
      derivApi.subscribeTicks(symbol as MarketSymbol, () => {}).catch(() => {});
    });
    
    return () => { active = false; unsub(); };
  }, []);

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
    if (mode === 'pattern') {
      const pat = market === 1 ? cleanM1Pattern : cleanM2Pattern;
      return checkPatternMatchWith(symbol, pat);
    }
    const cond = market === 1 ? m1DigitCondition : m2DigitCondition;
    const comp = market === 1 ? m1DigitCompare : m2DigitCompare;
    const win = market === 1 ? m1DigitWindow : m2DigitWindow;
    return checkDigitConditionWith(symbol, cond, comp, win);
  }, [m1StrategyMode, m2StrategyMode, cleanM1Pattern, cleanM2Pattern, checkPatternMatchWith, checkDigitConditionWith]);

  /* ── Find scanner match ── */
  const findScannerMatchForMarket = useCallback((market: 1 | 2): string | null => {
    for (const symbol of ALL_SYMBOLS) {
      if (checkStrategyForMarket(symbol, market)) return symbol;
    }
    return null;
  }, [checkStrategyForMarket]);

  /* ── Log functions ── */
  const addLog = useCallback((id: number, entry: Omit<LogEntry, 'id'>) => {
    setLogEntries(prev => [{ ...entry, id }, ...prev].slice(0, 100));
  }, []);

  const updateLog = useCallback((id: number, updates: Partial<LogEntry>) => {
    setLogEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }, []);

  const clearLog = useCallback(() => {
    setLogEntries([]);
    setWins(0); setLosses(0); setTotalStaked(0); setNetProfit(0);
    setMartingaleStepState(0);
    setVhFakeWins(0); setVhFakeLosses(0); setVhConsecLosses(0); setVhStatus('idle');
    setTicksCaptured(0); setTicksMissed(0);
  }, []);

  /* ═══════════════ MAIN BOT LOOP ═══════════════ */
  const startBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    const baseStake = parseFloat(stake);
    if (baseStake < 0.35) { toast.error('Min stake $0.35'); return; }
    if (!m1Enabled && !m2Enabled) { toast.error('Enable at least one market'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setCurrentMarket(1);
    setBotStatus('trading_m1');
    setCurrentStakeState(baseStake);
    setMartingaleStepState(0);

    let cStake = baseStake;
    let mStep = 0;
    let inRecovery = false;
    let localPnl = 0;
    let localBalance = balance;

    const getConfig = (market: 1 | 2) => ({
      contract: market === 1 ? m1Contract : m2Contract,
      barrier: market === 1 ? m1Barrier : m2Barrier,
      symbol: market === 1 ? m1Symbol : m2Symbol,
    });

    const executeRealTrade = async (
      cfg: { contract: string; barrier: string; symbol: string },
      tradeSymbol: string,
      tradeStake: number,
      step: number,
      mkt: 1 | 2,
      curBalance: number,
      curPnl: number,
      base: number
    ) => {
      const logId = ++logIdRef.current;
      const now = new Date().toLocaleTimeString();
      setTotalStaked(prev => prev + tradeStake);
      setCurrentStakeState(tradeStake);

      addLog(logId, {
        time: now, market: mkt === 1 ? 'M1' : 'M2', symbol: tradeSymbol,
        contract: cfg.contract, stake: tradeStake, martingaleStep: step,
        exitDigit: '...', result: 'Pending', pnl: 0, balance: curBalance,
        switchInfo: '',
      });

      let isRecovery = mkt === 2;

      try {
        if (!turboMode) await waitForNextTick(tradeSymbol);

        const buyParams: any = {
          contract_type: cfg.contract, symbol: tradeSymbol,
          duration: 1, duration_unit: 't', basis: 'stake', amount: tradeStake,
        };
        if (needsBarrier(cfg.contract)) buyParams.barrier = cfg.barrier;

        const { contractId } = await derivApi.buyContract(buyParams);

        if (copyTradingService.enabled) {
          copyTradingService.copyTrade({
            ...buyParams,
            masterTradeId: contractId,
          }).catch(err => console.error('Copy trading error:', err));
        }

        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;
        curPnl += pnl;
        curBalance += pnl;

        const exitDigit = String(getLastDigit(result.sellPrice || 0));

        let switchInfo = '';
        if (won) {
          setWins(prev => prev + 1);
          if (isRecovery) {
            switchInfo = '✓ Recovery WIN → Back to M1';
            isRecovery = false;
          } else {
            switchInfo = '→ Continue M1';
          }
          step = 0;
          tradeStake = base;
        } else {
          setLosses(prev => prev + 1);
          if (activeAccount?.is_virtual) {
            recordLoss(tradeStake, tradeSymbol, 6000);
          }
          if (!isRecovery && m2Enabled) {
            isRecovery = true;
            switchInfo = '✗ Loss → Switch to M2';
          } else {
            switchInfo = isRecovery ? '→ Stay M2' : '→ Continue M1';
          }
          if (martingaleOn) {
            const maxS = parseInt(martingaleMaxSteps) || 5;
            if (step < maxS) {
              tradeStake = parseFloat((tradeStake * (parseFloat(martingaleMultiplier) || 2)).toFixed(2));
              step++;
            } else {
              step = 0;
              tradeStake = base;
            }
          }
        }

        setNetProfit(prev => prev + pnl);
        setMartingaleStepState(step);
        setCurrentStakeState(tradeStake);

        updateLog(logId, { exitDigit, result: won ? 'Win' : 'Loss', pnl, balance: curBalance, switchInfo });

        let shouldBreak = false;
        if (curPnl >= parseFloat(takeProfit)) {
          toast.success(`🎯 Take Profit! +$${curPnl.toFixed(2)}`);
          shouldBreak = true;
        }
        if (curPnl <= -parseFloat(stopLoss)) {
          toast.error(`🛑 Stop Loss! $${curPnl.toFixed(2)}`);
          shouldBreak = true;
        }
        if (curBalance < tradeStake) {
          toast.error('Insufficient balance');
          shouldBreak = true;
        }

        return { curPnl, curBalance, tradeStake, step, isRecovery, shouldBreak };
      } catch (err: any) {
        updateLog(logId, { result: 'Loss', pnl: 0, exitDigit: '-', switchInfo: `Error: ${err.message}` });
        if (!turboMode) await new Promise(r => setTimeout(r, 2000));
        return { curPnl, curBalance, tradeStake, step, isRecovery, shouldBreak: false };
      }
    };

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

      /* Strategy gating */
      if (inRecovery && strategyEnabled) {
        setBotStatus('waiting_pattern');
        let matched = false;
        let matchedSymbol = '';
        while (runningRef.current && !matched) {
          if (scannerActive) {
            const found = findScannerMatchForMarket(2);
            if (found) { matched = true; matchedSymbol = found; }
          } else {
            if (checkStrategyForMarket(cfg.symbol, 2)) { matched = true; matchedSymbol = cfg.symbol; }
          }
          if (!matched) {
            await new Promise<void>(r => { if (turboMode) requestAnimationFrame(() => r()); else setTimeout(r, 500); });
          }
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
          if (!matched) {
            await new Promise<void>(r => { if (turboMode) requestAnimationFrame(() => r()); else setTimeout(r, 500); });
          }
        }
        if (!runningRef.current) break;
        setBotStatus('pattern_matched');
        tradeSymbol = cfg.symbol;
        if (!turboMode) await new Promise(r => setTimeout(r, 300));
      } else {
        setBotStatus(mkt === 1 ? 'trading_m1' : 'recovery');
        tradeSymbol = cfg.symbol;
      }

      /* Virtual Hook */
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
          addLog(vLogId, {
            time: vNow, market: 'VH', symbol: tradeSymbol,
            contract: cfg.contract, stake: 0, martingaleStep: 0,
            exitDigit: '...', result: 'Pending', pnl: 0, balance: localBalance,
            switchInfo: `Virtual #${virtualTradeNum} (losses: ${consecLosses}/${requiredLosses})`,
          });

          const vResult = await simulateVirtualContract(cfg.contract, cfg.barrier, tradeSymbol);
          if (!runningRef.current) break;

          if (vResult.won) {
            consecLosses = 0;
            setVhConsecLosses(0);
            setVhFakeWins(prev => prev + 1);
            updateLog(vLogId, { exitDigit: String(vResult.digit), result: 'V-Win', switchInfo: `Virtual WIN → Losses reset (0/${requiredLosses})` });
          } else {
            consecLosses++;
            setVhConsecLosses(consecLosses);
            setVhFakeLosses(prev => prev + 1);
            updateLog(vLogId, { exitDigit: String(vResult.digit), result: 'V-Loss', switchInfo: `Virtual LOSS (${consecLosses}/${requiredLosses})` });
          }
        }

        if (!runningRef.current) break;

        setVhStatus('confirmed');
        toast.success(`🎣 Hook confirmed! ${requiredLosses} consecutive losses detected → Executing ${realCount} real trade(s)`);

        for (let ri = 0; ri < realCount && runningRef.current; ri++) {
          const result = await executeRealTrade(cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake);
          if (!result) break;
          localPnl = result.curPnl;
          localBalance = result.curBalance;
          cStake = result.tradeStake;
          mStep = result.step;
          inRecovery = result.isRecovery;
          if (result.shouldBreak) { runningRef.current = false; break; }
        }

        setVhStatus('idle');
        setVhConsecLosses(0);
        if (!runningRef.current) break;
        continue;
      }

      const result = await executeRealTrade(cfg, tradeSymbol, cStake, mStep, mkt, localBalance, localPnl, baseStake);
      if (!result) break;
      localPnl = result.curPnl;
      localBalance = result.curBalance;
      cStake = result.tradeStake;
      mStep = result.step;
      inRecovery = result.isRecovery;

      if (result.shouldBreak) break;
      if (!turboMode) await new Promise(r => setTimeout(r, 400));
    }

    setIsRunning(false);
    runningRef.current = false;
    setBotStatus('idle');
  }, [isAuthorized, isRunning, balance, stake, m1Enabled, m2Enabled, m1Contract, m2Contract,
    m1Barrier, m2Barrier, m1Symbol, m2Symbol, martingaleOn, martingaleMultiplier, martingaleMaxSteps,
    takeProfit, stopLoss, strategyEnabled, strategyM1Enabled, m1StrategyMode, m2StrategyMode,
    scannerActive, findScannerMatchForMarket, checkStrategyForMarket, addLog, updateLog, turboMode,
    m1HookEnabled, m2HookEnabled, m1VirtualLossCount, m2VirtualLossCount, m1RealCount, m2RealCount, recordLoss, activeAccount]);

  const stopBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    setBotStatus('idle');
  }, []);

  const statusConfig: Record<BotStatus, { icon: string; label: string; color: string }> = {
    idle: { icon: '⚪', label: 'IDLE', color: 'text-muted-foreground' },
    trading_m1: { icon: '🟢', label: 'TRADING M1', color: 'text-profit' },
    recovery: { icon: '🟣', label: 'RECOVERY MODE', color: 'text-purple-400' },
    waiting_pattern: { icon: '🟡', label: 'WAITING PATTERN', color: 'text-warning' },
    pattern_matched: { icon: '✅', label: 'PATTERN MATCHED', color: 'text-profit' },
    virtual_hook: { icon: '🎣', label: 'VIRTUAL HOOK', color: 'text-primary' },
  };

  const status = statusConfig[botStatus];
  const winRate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : '0.0';

  const activeSymbol = currentMarket === 1 ? m1Symbol : m2Symbol;
  const activeDigits = (tickMapRef.current.get(activeSymbol) || []).slice(-8);
  const activeMarketCount = Array.from(tickMapRef.current.keys()).filter(k => (tickMapRef.current.get(k)?.length || 0) > 0).length;

  return (
    <div className="space-y-2 max-w-7xl mx-auto p-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-4 py-3">
        <h1 className="text-base font-bold text-foreground flex items-center gap-2">
          <Scan className="w-4 h-4 text-primary" /> Pro Scanner Bot + Signal Forge
        </h1>
        <div className="flex items-center gap-2">
          <Badge className={`${status.color} text-[10px]`}>{status.icon} {status.label}</Badge>
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-warning animate-pulse font-mono">
              P/L: ${netProfit.toFixed(2)}
            </Badge>
          )}
        </div>
      </div>

      {/* SIGNAL FORGE - IMMEDIATE SIGNALS SECTION */}
      <div className="bg-gradient-to-r from-primary/10 via-purple-500/10 to-orange-500/10 border-2 border-primary/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary animate-pulse" />
            <h2 className="text-lg font-bold text-foreground">⚡ SIGNAL FORGE · ELITE PATTERN SIGNALS</h2>
            <Badge variant="default" className="text-[10px] bg-primary">LIVE</Badge>
          </div>
          <div className="flex gap-2">
            <Select value={signalMarketGroup} onValueChange={(v: any) => setSignalMarketGroup(v)}>
              <SelectTrigger className="h-8 text-xs w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">🌐 All Markets</SelectItem>
                <SelectItem value="vol">📊 Volatility</SelectItem>
                <SelectItem value="jump">🦘 Jump</SelectItem>
                <SelectItem value="bull">🐂 RDBULL</SelectItem>
                <SelectItem value="bear">🐻 RDBEAR</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
              Updates every 3s
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {topSignals.length === 0 ? (
            <div className="col-span-full text-center py-10 text-muted-foreground">
              <Signal className="w-10 h-10 mx-auto mb-2 opacity-50" />
              <p className="text-sm">🔮 Analyzing {activeMarketCount} markets for patterns...</p>
              <p className="text-xs mt-1">Fetching tick data - signals appear within 3 seconds</p>
            </div>
          ) : (
            topSignals.map((sig, idx) => {
              const strengthPercent = Math.min(95, Math.max(35, Math.floor(sig.strength * 100)));
              const bgGradient = sig.direction === 'up' 
                ? 'from-green-500/20 to-emerald-600/10 border-green-500/40' 
                : sig.direction === 'down'
                ? 'from-red-500/20 to-rose-600/10 border-red-500/40'
                : 'from-orange-500/20 to-yellow-600/10 border-orange-500/40';
              
              return (
                <div key={`${sig.symbol}_${sig.type}_${idx}`} 
                  className={`bg-gradient-to-br ${bgGradient} rounded-xl p-3 border-2 transition-all hover:scale-[1.02] cursor-pointer`}>
                  <div className="flex items-center justify-between mb-2">
                    <Badge className="text-[10px] bg-black/40 text-white font-mono">
                      #{idx + 1} · {sig.symbol}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] font-bold">
                      {sig.type}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    {sig.direction === 'up' ? 
                      <TrendingUp className="w-5 h-5 text-green-400" /> : 
                      <TrendingDown className="w-5 h-5 text-red-400" />
                    }
                    <span className="text-xl font-bold">{sig.name}</span>
                  </div>
                  <div className="text-[11px] font-mono bg-black/30 rounded-lg p-2 mb-2 break-all">
                    <span className="text-muted-foreground">Pattern:</span>{' '}
                    <span className="font-bold text-primary">{sig.pattern}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-2">
                    {sig.detail}
                  </div>
                  <div className="mt-2">
                    <div className="flex justify-between text-[9px] mb-1">
                      <span>Signal Strength</span>
                      <span className="font-bold text-primary">{strengthPercent}%</span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-500 ${
                        strengthPercent > 70 ? 'bg-gradient-to-r from-green-500 to-green-400' :
                        strengthPercent > 50 ? 'bg-gradient-to-r from-yellow-500 to-orange-400' :
                        'bg-gradient-to-r from-orange-500 to-red-500'
                      }`} style={{ width: `${strengthPercent}%` }} />
                    </div>
                  </div>
                  <div className="text-[8px] text-muted-foreground mt-2 text-right">
                    {sig.wins}+ wins recorded
                  </div>
                </div>
              );
            })
          )}
        </div>
        
        {/* Market Status */}
        <div className="flex justify-between items-center mt-3 pt-2 border-t border-border/30">
          <div className="text-[9px] text-muted-foreground">
            📊 Active: {activeMarketCount}/{ALL_SYMBOLS.length} markets · 
            Ticks: {ticksCaptured}
          </div>
          <div className="text-[8px] text-muted-foreground">
            Last update: {lastSignalUpdate.toLocaleTimeString()}
          </div>
        </div>
      </div>

      {/* Scanner + Turbo + Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Eye className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold">Scanner</span>
              <Badge variant={scannerActive ? 'default' : 'secondary'} className="text-[9px]">
                {scannerActive ? 'ON' : 'OFF'}
              </Badge>
            </div>
            <Switch checked={scannerActive} onCheckedChange={setScannerActive} disabled={isRunning} />
          </div>
          <div className="flex flex-wrap gap-0.5">
            {ALL_SYMBOLS.slice(0, 8).map(sym => {
              const count = tickCounts[sym] || 0;
              return (
                <Badge key={sym} variant="outline"
                  className={`text-[8px] h-4 px-1 ${count > 0 ? 'border-primary/50 text-primary' : 'text-muted-foreground'}`}>
                  {sym}
                </Badge>
              );
            })}
            <Badge variant="outline" className="text-[8px]">+{ALL_SYMBOLS.length - 8}</Badge>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Zap className={`w-3.5 h-3.5 ${turboMode ? 'text-profit' : 'text-muted-foreground'}`} />
              <span className="text-xs font-semibold">Turbo Mode</span>
            </div>
            <Button size="sm" variant={turboMode ? 'default' : 'outline'}
              className="h-6 text-[9px] px-2" onClick={() => setTurboMode(!turboMode)} disabled={isRunning}>
              {turboMode ? '⚡ ON' : 'OFF'}
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px]">Latency</div>
              <div className="font-mono text-[10px] font-bold">{turboLatency}ms</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px]">Ticks</div>
              <div className="font-mono text-[10px] font-bold">{ticksCaptured}</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px]">Missed</div>
              <div className="font-mono text-[10px] text-loss">{ticksMissed}</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold">Stats</span>
            <span className="font-mono text-sm font-bold">${balance.toFixed(2)}</span>
          </div>
          <div className="grid grid-cols-3 gap-1 text-center">
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px]">W/L</div>
              <div className="font-mono text-[10px]"><span className="text-profit">{wins}</span>/<span className="text-loss">{losses}</span></div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px]">P/L</div>
              <div className={`font-mono text-[10px] ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>${netProfit.toFixed(2)}</div>
            </div>
            <div className="bg-muted/50 rounded p-1">
              <div className="text-[8px]">Win Rate</div>
              <div className="font-mono text-[10px]">{winRate}%</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main 2-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-2">
        {/* LEFT: Config Column */}
        <div className="lg:col-span-4 space-y-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-1 gap-2">
            {/* Market 1 */}
            <div className="bg-card border-2 border-profit/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-profit flex items-center gap-1"><Home className="w-3.5 h-3.5" /> M1 — Home</h3>
                <Switch checked={m1Enabled} onCheckedChange={setM1Enabled} disabled={isRunning} />
              </div>
              <Select value={m1Symbol} onValueChange={setM1Symbol} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={m1Contract} onValueChange={setM1Contract} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {needsBarrier(m1Contract) && (
                <Input type="number" min="0" max="9" value={m1Barrier} onChange={e => setM1Barrier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
              )}
              <div className="border-t border-border/30 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-primary flex items-center gap-1"><Anchor className="w-3 h-3" /> Virtual Hook</span>
                  <Switch checked={m1HookEnabled} onCheckedChange={setM1HookEnabled} disabled={isRunning} />
                </div>
                {m1HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <Input type="number" placeholder="V-Losses" value={m1VirtualLossCount} onChange={e => setM1VirtualLossCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} />
                    <Input type="number" placeholder="Real Trades" value={m1RealCount} onChange={e => setM1RealCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} />
                  </div>
                )}
              </div>
            </div>

            {/* Market 2 */}
            <div className="bg-card border-2 border-purple-500/30 rounded-xl p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-purple-400 flex items-center gap-1"><RefreshCw className="w-3.5 h-3.5" /> M2 — Recovery</h3>
                <Switch checked={m2Enabled} onCheckedChange={setM2Enabled} disabled={isRunning} />
              </div>
              <Select value={m2Symbol} onValueChange={setM2Symbol} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ALL_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={m2Contract} onValueChange={setM2Contract} disabled={isRunning}>
                <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              {needsBarrier(m2Contract) && (
                <Input type="number" min="0" max="9" value={m2Barrier} onChange={e => setM2Barrier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
              )}
              <div className="border-t border-border/30 pt-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] font-semibold text-primary flex items-center gap-1"><Anchor className="w-3 h-3" /> Virtual Hook</span>
                  <Switch checked={m2HookEnabled} onCheckedChange={setM2HookEnabled} disabled={isRunning} />
                </div>
                {m2HookEnabled && (
                  <div className="grid grid-cols-2 gap-1.5 mt-1">
                    <Input type="number" placeholder="V-Losses" value={m2VirtualLossCount} onChange={e => setM2VirtualLossCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} />
                    <Input type="number" placeholder="Real Trades" value={m2RealCount} onChange={e => setM2RealCount(e.target.value)} className="h-6 text-[10px]" disabled={isRunning} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Risk */}
          <div className="bg-card border border-border rounded-xl p-2.5 space-y-1.5">
            <h3 className="text-xs font-semibold flex items-center gap-1"><Shield className="w-3.5 h-3.5" /> Risk</h3>
            <div className="grid grid-cols-3 gap-1.5">
              <Input type="number" placeholder="Stake" value={stake} onChange={e => setStake(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
              <Input type="number" placeholder="TP" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
              <Input type="number" placeholder="SL" value={stopLoss} onChange={e => setStopLoss(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-[10px]">Martingale</label>
              <Switch checked={martingaleOn} onCheckedChange={setMartingaleOn} disabled={isRunning} />
            </div>
            {martingaleOn && (
              <div className="grid grid-cols-2 gap-1.5">
                <Input type="number" placeholder="Multiplier" value={martingaleMultiplier} onChange={e => setMartingaleMultiplier(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
                <Input type="number" placeholder="Max Steps" value={martingaleMaxSteps} onChange={e => setMartingaleMaxSteps(e.target.value)} className="h-7 text-xs" disabled={isRunning} />
              </div>
            )}
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-[10px]">
                <input type="checkbox" checked={strategyM1Enabled} onChange={e => setStrategyM1Enabled(e.target.checked)} disabled={isRunning} />
                Strategy M1
              </label>
              <label className="flex items-center gap-1 text-[10px]">
                <input type="checkbox" checked={strategyEnabled} onChange={e => setStrategyEnabled(e.target.checked)} disabled={isRunning} />
                Strategy M2
              </label>
            </div>
          </div>

          {/* Strategy Config */}
          {(strategyEnabled || strategyM1Enabled) && (
            <div className="bg-card border border-warning/30 rounded-xl p-2.5">
              <h3 className="text-xs font-semibold text-warning mb-1">Strategy Config</h3>
              {strategyM1Enabled && (
                <div className="mb-2 p-1.5 border border-profit/20 rounded">
                  <div className="flex gap-1 mb-1">
                    <Button size="sm" variant={m1StrategyMode === 'pattern' ? 'default' : 'outline'} className="h-5 text-[9px]" onClick={() => setM1StrategyMode('pattern')}>Pattern</Button>
                    <Button size="sm" variant={m1StrategyMode === 'digit' ? 'default' : 'outline'} className="h-5 text-[9px]" onClick={() => setM1StrategyMode('digit')}>Digit</Button>
                  </div>
                  {m1StrategyMode === 'pattern' ? (
                    <Textarea placeholder="Pattern (E/O) e.g. EEO" value={m1Pattern} onChange={e => setM1Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))} className="h-12 text-[10px]" disabled={isRunning} />
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <Select value={m1DigitCondition} onValueChange={setM1DigitCondition}>
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="==">==</SelectItem><SelectItem value=">">{'>'}</SelectItem><SelectItem value="<">{'<'}</SelectItem></SelectContent>
                      </Select>
                      <Input type="number" value={m1DigitCompare} onChange={e => setM1DigitCompare(e.target.value)} className="h-6 text-[10px]" />
                      <Input type="number" value={m1DigitWindow} onChange={e => setM1DigitWindow(e.target.value)} className="h-6 text-[10px]" />
                    </div>
                  )}
                </div>
              )}
              {strategyEnabled && (
                <div className="p-1.5 border border-destructive/20 rounded">
                  <div className="flex gap-1 mb-1">
                    <Button size="sm" variant={m2StrategyMode === 'pattern' ? 'default' : 'outline'} className="h-5 text-[9px]" onClick={() => setM2StrategyMode('pattern')}>Pattern</Button>
                    <Button size="sm" variant={m2StrategyMode === 'digit' ? 'default' : 'outline'} className="h-5 text-[9px]" onClick={() => setM2StrategyMode('digit')}>Digit</Button>
                  </div>
                  {m2StrategyMode === 'pattern' ? (
                    <Textarea placeholder="Pattern (E/O)" value={m2Pattern} onChange={e => setM2Pattern(e.target.value.toUpperCase().replace(/[^EO]/g, ''))} className="h-12 text-[10px]" disabled={isRunning} />
                  ) : (
                    <div className="grid grid-cols-3 gap-1">
                      <Select value={m2DigitCondition} onValueChange={setM2DigitCondition}>
                        <SelectTrigger className="h-6 text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="==">==</SelectItem><SelectItem value=">">{'>'}</SelectItem><SelectItem value="<">{'<'}</SelectItem></SelectContent>
                      </Select>
                      <Input type="number" value={m2DigitCompare} onChange={e => setM2DigitCompare(e.target.value)} className="h-6 text-[10px]" />
                      <Input type="number" value={m2DigitWindow} onChange={e => setM2DigitWindow(e.target.value)} className="h-6 text-[10px]" />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Save/Load Config */}
          <div className="bg-card border border-border rounded-xl p-2.5">
            <h3 className="text-xs font-semibold mb-1">💾 Bot Config</h3>
            <Input placeholder="Bot name" value={botName} onChange={e => setBotName(e.target.value)} className="h-7 text-xs mb-2" disabled={isRunning} />
            <div className="grid grid-cols-2 gap-1.5">
              <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={isRunning || !botName.trim()} onClick={() => {
                const config = { version: 1, botName, m1: { enabled: m1Enabled, symbol: m1Symbol, contract: m1Contract, barrier: m1Barrier }, m2: { enabled: m2Enabled, symbol: m2Symbol, contract: m2Contract, barrier: m2Barrier }, risk: { stake, martingaleOn, martingaleMultiplier, martingaleMaxSteps, takeProfit, stopLoss }, strategy: { m1Enabled: strategyM1Enabled, m2Enabled: strategyEnabled, m1Mode: m1StrategyMode, m2Mode: m2StrategyMode, m1Pattern, m2Pattern }, scanner: { active: scannerActive }, turbo: { enabled: turboMode } };
                const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `${botName.trim()}_${Date.now()}.json`; a.click();
                URL.revokeObjectURL(url);
                toast.success('Config saved!');
              }}><Download className="w-3 h-3" /> Save</Button>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" disabled={isRunning} onClick={() => {
                const input = document.createElement('input');
                input.type = 'file'; input.accept = '.json';
                input.onchange = (ev: any) => {
                  const file = ev.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (e) => {
                    try {
                      const cfg = JSON.parse(e.target?.result as string);
                      if (cfg.m1?.enabled !== undefined) setM1Enabled(cfg.m1.enabled);
                      if (cfg.m1?.symbol) setM1Symbol(cfg.m1.symbol);
                      if (cfg.m1?.contract) setM1Contract(cfg.m1.contract);
                      if (cfg.m1?.barrier) setM1Barrier(cfg.m1.barrier);
                      if (cfg.m2?.enabled !== undefined) setM2Enabled(cfg.m2.enabled);
                      if (cfg.m2?.symbol) setM2Symbol(cfg.m2.symbol);
                      if (cfg.m2?.contract) setM2Contract(cfg.m2.contract);
                      if (cfg.m2?.barrier) setM2Barrier(cfg.m2.barrier);
                      if (cfg.risk?.stake) setStake(cfg.risk.stake);
                      if (cfg.risk?.takeProfit) setTakeProfit(cfg.risk.takeProfit);
                      if (cfg.risk?.stopLoss) setStopLoss(cfg.risk.stopLoss);
                      if (cfg.risk?.martingaleOn !== undefined) setMartingaleOn(cfg.risk.martingaleOn);
                      if (cfg.strategy?.m1Enabled !== undefined) setStrategyM1Enabled(cfg.strategy.m1Enabled);
                      if (cfg.strategy?.m2Enabled !== undefined) setStrategyEnabled(cfg.strategy.m2Enabled);
                      if (cfg.strategy?.m1Mode) setM1StrategyMode(cfg.strategy.m1Mode);
                      if (cfg.strategy?.m2Mode) setM2StrategyMode(cfg.strategy.m2Mode);
                      if (cfg.strategy?.m1Pattern !== undefined) setM1Pattern(cfg.strategy.m1Pattern);
                      if (cfg.strategy?.m2Pattern !== undefined) setM2Pattern(cfg.strategy.m2Pattern);
                      if (cfg.scanner?.active !== undefined) setScannerActive(cfg.scanner.active);
                      if (cfg.turbo?.enabled !== undefined) setTurboMode(cfg.turbo.enabled);
                      if (cfg.botName) setBotName(cfg.botName);
                      toast.success('Config loaded!');
                    } catch { toast.error('Invalid config'); }
                  };
                  reader.readAsText(file);
                };
                input.click();
              }}><Upload className="w-3 h-3" /> Load</Button>
            </div>
          </div>
        </div>

        {/* RIGHT: Digit Stream + Activity Log */}
        <div className="lg:col-span-8 space-y-2">
          {/* Digit Stream */}
          <div className="bg-card border border-border rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <h3 className="text-[10px] font-semibold">Live Digits — {activeSymbol}</h3>
              <span className="text-[9px] text-muted-foreground">Win Rate: {winRate}%</span>
            </div>
            <div className="flex gap-1 justify-center">
              {activeDigits.length === 0 ? (
                <span className="text-[10px] text-muted-foreground">Waiting for ticks...</span>
              ) : activeDigits.map((d, i) => (
                <div key={i} className={`w-8 h-10 rounded-lg flex flex-col items-center justify-center text-xs font-mono font-bold border ${i === activeDigits.length - 1 ? 'ring-2 ring-primary' : ''} ${d >= 5 ? 'bg-loss/10 border-loss/30 text-loss' : 'bg-profit/10 border-profit/30 text-profit'}`}>
                  <span className="text-sm">{d}</span>
                  <span className="text-[7px]">{d >= 5 ? 'O' : 'U'}{d % 2 === 0 ? 'E' : 'O'}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Trade Summary */}
          <div className="grid grid-cols-5 gap-1.5">
            <div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px]">Trades</div><div className="font-mono text-xs font-bold">{wins + losses}</div></div>
            <div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px]">Wins</div><div className="font-mono text-xs text-profit">{wins}</div></div>
            <div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px]">Losses</div><div className="font-mono text-xs text-loss">{losses}</div></div>
            <div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px]">P/L</div><div className={`font-mono text-xs ${netProfit >= 0 ? 'text-profit' : 'text-loss'}`}>${netProfit.toFixed(2)}</div></div>
            <div className="bg-card border rounded-lg p-2 text-center"><div className="text-[8px]">Stake</div><div className="font-mono text-xs">${currentStake.toFixed(2)}{martingaleStep > 0 && <span className="text-warning ml-0.5">M{martingaleStep}</span>}</div></div>
          </div>

          {/* Control Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={startBot} disabled={isRunning || !isAuthorized || balance < parseFloat(stake)} className="h-12 bg-profit hover:bg-profit/90"><Play className="w-4 h-4 mr-2" /> START BOT</Button>
            <Button onClick={stopBot} disabled={!isRunning} variant="destructive" className="h-12"><StopCircle className="w-4 h-4 mr-2" /> STOP</Button>
          </div>

          {/* Activity Log */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-2.5 py-2 border-b flex justify-between">
              <h3 className="text-xs font-semibold">Activity Log</h3>
              <Button variant="ghost" size="sm" onClick={clearLog} className="h-6 w-6 p-0"><Trash2 className="w-3 h-3" /></Button>
            </div>
            <div className="max-h-[300px] overflow-auto">
              <table className="w-full text-[10px]">
                <thead className="sticky top-0 bg-muted/50"><tr><th className="p-1">Time</th><th>Mkt</th><th>Symbol</th><th>Type</th><th>Stake</th><th>Digit</th><th>Result</th><th>P/L</th></tr></thead>
                <tbody>
                  {logEntries.length === 0 ? (
                    <tr><td colSpan={8} className="text-center py-6 text-muted-foreground">No trades yet</td></tr>
                  ) : logEntries.map(e => (
                    <tr key={e.id} className="border-t"><td className="p-1 font-mono">{e.time}</td>
                      <td className={`p-1 font-bold ${e.market === 'M1' ? 'text-profit' : e.market === 'VH' ? 'text-primary' : 'text-purple-400'}`}>{e.market}</td>
                      <td className="p-1">{e.symbol}</td><td className="p-1">{e.contract.replace('DIGIT', '')}</td>
                      <td className="p-1 text-right">{e.market === 'VH' ? 'FAKE' : `$${e.stake.toFixed(2)}`}</td>
                      <td className="p-1 text-center font-mono">{e.exitDigit}</td>
                      <td className="p-1 text-center"><span className={`px-1 py-0.5 rounded-full text-[8px] ${e.result === 'Win' || e.result === 'V-Win' ? 'bg-profit/20 text-profit' : e.result === 'Loss' || e.result === 'V-Loss' ? 'bg-loss/20 text-loss' : 'bg-warning/20 text-warning'}`}>{e.result === 'Pending' ? '...' : e.result}</span></td>
                      <td className={`p-1 text-right ${e.pnl > 0 ? 'text-profit' : e.pnl < 0 ? 'text-loss' : ''}`}>{e.result === 'Pending' ? '...' : e.market === 'VH' ? '-' : `${e.pnl > 0 ? '+' : ''}${e.pnl.toFixed(2)}`}</td>
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
