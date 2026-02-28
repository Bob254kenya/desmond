import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { derivApi, MARKETS, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import {
  analyzeMarketDigits, validateDigitEligibility,
  getRecoveryAction, type MarketSignal, type RecoveryState,
} from '@/services/smart-signal-engine';
import { digitFrequency, calculateConfidence } from '@/services/bot-engine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Zap, Play, StopCircle, Shield, TrendingUp, AlertTriangle,
  CheckCircle, XCircle, Loader2, Volume2, VolumeX, Settings2,
} from 'lucide-react';
import { type TradeLog } from '@/components/auto-trade/types';
import TradeLogComponent from '@/components/auto-trade/TradeLog';
import DigitDisplay from '@/components/auto-trade/DigitDisplay';
import SmartDigitGrid from '@/components/bots/SmartDigitGrid';
import { toast } from 'sonner';

function waitForNextTick(symbol: string): Promise<{ quote: number; epoch: number }> {
  return new Promise((resolve) => {
    const unsub = derivApi.onMessage((data: any) => {
      if (data.tick && data.tick.symbol === symbol) {
        unsub();
        resolve({ quote: data.tick.quote, epoch: data.tick.epoch });
      }
    });
  });
}

function speakMessage(text: string) {
  try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(text); u.rate = 1; u.pitch = 1; u.volume = 1; window.speechSynthesis.speak(u); } } catch {}
}

// Persist config to localStorage
function loadConfig() {
  try {
    const raw = localStorage.getItem('smartbot_config');
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}
function saveConfig(cfg: any) {
  try { localStorage.setItem('smartbot_config', JSON.stringify(cfg)); } catch {}
}

type StopCondition = 'none' | 'even_runs' | 'on_loss' | 'on_profit';

export default function SmartBotPage() {
  const { isAuthorized, activeAccount, balance } = useAuth();

  const saved = loadConfig();
  const [stake, setStake] = useState(saved?.stake || '1');
  const [multiplier, setMultiplier] = useState(saved?.multiplier || '1.8');
  const [martingaleEnabled, setMartingaleEnabled] = useState(saved?.martingaleEnabled ?? true);
  const [stopLoss, setStopLoss] = useState(saved?.stopLoss || '20');
  const [takeProfit, setTakeProfit] = useState(saved?.takeProfit || '30');
  const [tickCount, setTickCount] = useState(saved?.tickCount || '100');
  const [maxRuns, setMaxRuns] = useState(saved?.maxRuns || '50');
  const [stopCondition, setStopCondition] = useState<StopCondition>(saved?.stopCondition || 'none');
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [editingConfig, setEditingConfig] = useState(false);

  // Save config when it changes
  useEffect(() => {
    saveConfig({ stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, maxRuns, stopCondition });
  }, [stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, maxRuns, stopCondition]);

  // Runtime
  const [isRunning, setIsRunning] = useState(false);
  const runningRef = useRef(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [activeMarket, setActiveMarket] = useState<MarketSymbol | null>(null);
  const [statusLog, setStatusLog] = useState<string[]>([]);
  const [selectedDigit, setSelectedDigit] = useState(4);
  const [liveDigits, setLiveDigits] = useState<Record<string, number[]>>({});
  const [runCount, setRunCount] = useState(0);
  const tradeIdRef = useRef(0);
  const [executingSignal, setExecutingSignal] = useState<string | null>(null);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setStatusLog(prev => [`[${time}] ${msg}`, ...prev].slice(0, 200));
  }, []);

  // Subscribe to ALL markets
  useEffect(() => {
    if (!derivApi.isConnected) return;
    let active = true;
    const handler = (data: any) => {
      if (!data.tick || !active) return;
      const sym = data.tick.symbol as string;
      const d = getLastDigit(data.tick.quote);
      setLiveDigits(prev => ({ ...prev, [sym]: [...(prev[sym] || []), d].slice(-1000) }));
    };
    const unsub = derivApi.onMessage(handler);
    MARKETS.forEach(m => { derivApi.subscribeTicks(m.symbol, () => {}).catch(() => {}); });
    return () => { active = false; unsub(); };
  }, []);

  const computedSignals = useMemo(() => {
    const count = parseInt(tickCount) || 100;
    return MARKETS.map(m => {
      const digs = (liveDigits[m.symbol] || []).slice(-count);
      return analyzeMarketDigits(digs, m.symbol, m.name);
    }).sort((a, b) => b.signalStrength - a.signalStrength);
  }, [liveDigits, tickCount]);

  useEffect(() => {
    const interval = setInterval(() => { setSignals(computedSignals); }, 2000);
    return () => clearInterval(interval);
  }, [computedSignals]);

  const validSignals = signals.filter(s => s.isValid);
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);
  const winCount = trades.filter(t => t.result === 'Win').length;
  const lossCount = trades.filter(t => t.result === 'Loss').length;

  /** Execute a single signal trade */
  const executeSignalTrade = useCallback(async (signal: MarketSignal) => {
    if (!isAuthorized || isRunning) return;
    if (balance < parseFloat(stake)) { toast.error('Insufficient balance — cannot trade'); return; }

    setExecutingSignal(signal.symbol);
    addLog(`⚡ Instant execute: ${signal.marketName} ${signal.suggestedContract} ${signal.suggestedBarrier}`);

    try {
      const baseStake = parseFloat(stake);
      const freshTick = await waitForNextTick(signal.symbol);
      const tickDigit = getLastDigit(freshTick.quote);
      addLog(`🔄 Fresh tick: ${freshTick.quote} → digit ${tickDigit}`);

      const id = ++tradeIdRef.current;
      const now = new Date().toLocaleTimeString();
      setTrades(prev => [{ id, time: now, market: signal.symbol, contract: signal.suggestedContract, stake: baseStake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 200));

      const { contractId, buyPrice } = await derivApi.buyContract({
        contract_type: signal.suggestedContract, symbol: signal.symbol,
        duration: 1, duration_unit: 't', basis: 'stake', amount: baseStake,
        barrier: signal.suggestedBarrier || undefined,
      });

      addLog(`⏳ Contract ${contractId} opened @ ${buyPrice}`);
      const result = await derivApi.waitForContractResult(contractId);
      const won = result.status === 'won';
      addLog(`${won ? '✅ WIN' : '❌ LOSS'} | Profit: ${result.profit.toFixed(2)}`);
      setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl: result.profit } : t));

      if (soundEnabled) {
        try { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = won ? 880 : 440; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200); } catch {}
      }
    } catch (err: any) {
      addLog(`⚠️ Error: ${err.message}`);
    } finally {
      setExecutingSignal(null);
    }
  }, [isAuthorized, isRunning, stake, balance, soundEnabled, addLog]);

  // ─── MAIN SMART BOT LOOP ───
  const startSmartBot = useCallback(async () => {
    if (!isAuthorized || isRunning) return;
    if (balance < parseFloat(stake)) { toast.error('Insufficient balance — Bot halted'); return; }

    setIsRunning(true);
    runningRef.current = true;
    setRunCount(0);
    addLog('🟢 Smart Bot LOADED — Scanning all volatilities...');

    const baseStake = parseFloat(stake);
    const mult = parseFloat(multiplier);
    const sl = parseFloat(stopLoss);
    const tp = parseFloat(takeProfit);
    const maxRunsNum = parseInt(maxRuns) || 999999;
    let localPnl = 0;
    let localRuns = 0;

    const recoveryStates: Record<string, RecoveryState> = {};

    while (runningRef.current) {
      // Balance guard
      const currentStake = recoveryStates[Object.keys(recoveryStates)[0]]?.currentStake || baseStake;
      if (balance < currentStake) {
        addLog('🛑 Insufficient balance — Bot stopped');
        toast.error('Insufficient balance — Bot halted');
        break;
      }

      // Run limit checks
      if (localRuns >= maxRunsNum) {
        addLog(`🏁 Max runs (${maxRunsNum}) reached`);
        toast.info(`Bot stopped: Max ${maxRunsNum} runs reached`);
        break;
      }

      try {
        const count = parseInt(tickCount) || 100;
        const freshSignals = MARKETS.map(m => {
          const digs = (liveDigits[m.symbol] || []).slice(-count);
          return analyzeMarketDigits(digs, m.symbol, m.name);
        }).filter(s => s.isValid).sort((a, b) => b.signalStrength - a.signalStrength);

        if (freshSignals.length === 0) {
          addLog('⏳ No valid signals — scanning...');
          await new Promise(r => setTimeout(r, 3000));
          continue;
        }

        const signal = freshSignals[0];
        setActiveMarket(signal.symbol);
        addLog(`📊 Signal: ${signal.marketName} | STR ${signal.signalStrength} | ${signal.suggestedContract} ${signal.suggestedBarrier}`);

        if (!recoveryStates[signal.symbol]) {
          recoveryStates[signal.symbol] = { inRecovery: false, lastWasLoss: false, baseStake, currentStake: baseStake, consecutiveLosses: 0 };
        }
        const rState = recoveryStates[signal.symbol];

        let contractType = signal.suggestedContract;
        let barrier = signal.suggestedBarrier;

        if (signal.signalStrength >= 4 && (contractType === 'DIGITOVER' || contractType === 'DIGITUNDER')) {
          const recovery = getRecoveryAction(rState, mult, null);
          barrier = recovery.barrier;
        }

        const eligibility = validateDigitEligibility((liveDigits[signal.symbol] || []).slice(-count), contractType, parseInt(barrier) || 0);
        if (!eligibility.eligible) {
          addLog(`❌ Digit validation failed: ${eligibility.reason}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        const freshTick = await waitForNextTick(signal.symbol);
        const tradeStake = martingaleEnabled ? rState.currentStake : baseStake;

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        setTrades(prev => [{ id, time: now, market: signal.symbol, contract: contractType, stake: tradeStake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 200));

        const { contractId, buyPrice } = await derivApi.buyContract({
          contract_type: contractType, symbol: signal.symbol,
          duration: 1, duration_unit: 't', basis: 'stake', amount: tradeStake,
          barrier: barrier || undefined,
        });

        addLog(`⏳ Contract ${contractId} @ ${buyPrice} — waiting...`);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;
        addLog(`${won ? '✅ WIN' : '❌ LOSS'} | Profit: ${pnl.toFixed(2)}`);

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));
        localPnl += pnl;
        localRuns++;
        setRunCount(localRuns);

        if (soundEnabled) {
          try { const ctx = new AudioContext(); const o = ctx.createOscillator(); o.frequency.value = won ? 880 : 440; o.connect(ctx.destination); o.start(); setTimeout(() => { o.stop(); ctx.close(); }, 200); } catch {}
        }

        // Martingale: LOSS → multiply, WIN → reset
        const lastResult = won ? 'won' as const : 'lost' as const;
        if (martingaleEnabled) {
          const recovery = getRecoveryAction(rState, mult, lastResult);
          recoveryStates[signal.symbol] = recovery.newState;
        } else {
          recoveryStates[signal.symbol] = { ...rState, currentStake: baseStake, lastWasLoss: !won, inRecovery: !won, consecutiveLosses: won ? 0 : rState.consecutiveLosses + 1 };
        }

        // Stop condition checks
        if (stopCondition === 'on_loss' && !won) {
          addLog('🏁 Stopped: On Loss condition');
          toast.info('Bot stopped: Loss occurred');
          break;
        }
        if (stopCondition === 'on_profit' && won) {
          addLog('🏁 Stopped: On Profit condition');
          toast.info('Bot stopped: Profit occurred');
          break;
        }
        if (stopCondition === 'even_runs' && localRuns % 2 === 0) {
          addLog(`🏁 Stopped: Even run count (${localRuns})`);
          toast.info(`Bot stopped: ${localRuns} runs (even)`);
          break;
        }

        // SL/TP
        if (localPnl <= -sl) {
          addLog(`🛑 STOP LOSS hit: ${localPnl.toFixed(2)}`);
          toast.error(`🛑 Stop Loss Hit! P/L: $${localPnl.toFixed(2)}`, { duration: 10000 });
          if (soundEnabled) speakMessage('Stop loss hit. Bot stopped.');
          break;
        }
        if (localPnl >= tp) {
          addLog(`🎯 TAKE PROFIT hit: ${localPnl.toFixed(2)}`);
          toast.success(`🎊 Congratulations! Take Profit Hit! +$${localPnl.toFixed(2)}`, { duration: 15000 });
          if (soundEnabled) speakMessage('Congratulations! Your take profit has been hit! Well done!');
          break;
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) {
          toast.error('Insufficient balance — Bot halted');
          break;
        }
        addLog(`⚠️ Error: ${err.message}`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    addLog(`🏁 Session ended. Runs: ${localRuns}, P/L: ${localPnl.toFixed(2)}`);
    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, stake, multiplier, martingaleEnabled, stopLoss, takeProfit, tickCount, maxRuns, stopCondition, liveDigits, balance, soundEnabled, addLog]);

  const stopSmartBot = useCallback(() => {
    runningRef.current = false;
    setIsRunning(false);
    addLog('🔴 Smart Bot STOPPED by user');
  }, [addLog]);

  const activeDigits = activeMarket ? (liveDigits[activeMarket] || []).slice(-30) : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Zap className="w-5 h-5 text-warning" /> Smart Signal Bot
          </h1>
          <p className="text-xs text-muted-foreground">
            Scans all volatilities • API-verified • Continuous scanning
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <Badge variant="outline" className="text-[10px] text-warning animate-pulse">
              Scanning... | Signals: {validSignals.length} | P/L: ${totalPnl.toFixed(2)} | Run {runCount}/{maxRuns}
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => setSoundEnabled(!soundEnabled)} className="h-8">
            {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Persistent Config Bar */}
      <div className="bg-card border border-border rounded-xl p-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="font-mono">Stake: <strong className="text-foreground">${stake}</strong></span>
        <span className="font-mono">TP: <strong className="text-profit">${takeProfit}</strong></span>
        <span className="font-mono">SL: <strong className="text-loss">${stopLoss}</strong></span>
        <span className="font-mono">Martingale: <strong className={martingaleEnabled ? 'text-warning' : 'text-muted-foreground'}>{martingaleEnabled ? `${multiplier}x` : 'OFF'}</strong></span>
        <span className="font-mono">Max Runs: <strong className="text-foreground">{maxRuns}</strong></span>
        <span className="font-mono">Stop: <strong className="text-foreground">{stopCondition === 'none' ? 'Manual' : stopCondition.replace('_', ' ')}</strong></span>
        <Button variant="ghost" size="sm" className="h-6 px-2 ml-auto" onClick={() => setEditingConfig(!editingConfig)}>
          <Settings2 className="w-3 h-3 mr-1" /> {editingConfig ? 'Close' : 'Edit'}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Config Panel */}
        <div className="lg:col-span-3 space-y-4">
          {editingConfig && (
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <h2 className="font-semibold text-foreground text-sm flex items-center gap-1">
                <Shield className="w-4 h-4" /> Bot Configuration
              </h2>
              <div>
                <label className="text-[10px] text-muted-foreground">Base Stake (USD)</label>
                <Input type="number" min="0.35" step="0.01" value={stake} onChange={e => setStake(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-foreground">Martingale on LOSS</label>
                <Switch checked={martingaleEnabled} onCheckedChange={setMartingaleEnabled} disabled={isRunning} />
              </div>
              {martingaleEnabled && (
                <div>
                  <label className="text-[10px] text-muted-foreground">Multiplier</label>
                  <Input type="number" min="1.1" step="0.1" value={multiplier} onChange={e => setMultiplier(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Stop Loss</label>
                  <Input type="number" value={stopLoss} onChange={e => setStopLoss(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">Take Profit</label>
                  <Input type="number" value={takeProfit} onChange={e => setTakeProfit(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Max Runs</label>
                <Input type="number" value={maxRuns} onChange={e => setMaxRuns(e.target.value)} disabled={isRunning} className="h-8 text-xs" />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Stop Condition</label>
                <Select value={stopCondition} onValueChange={v => setStopCondition(v as StopCondition)} disabled={isRunning}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Manual stop only</SelectItem>
                    <SelectItem value="even_runs">Even number of runs</SelectItem>
                    <SelectItem value="on_loss">On Loss</SelectItem>
                    <SelectItem value="on_profit">On Profit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">Tick History Count</label>
                <Select value={tickCount} onValueChange={setTickCount} disabled={isRunning}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['30', '50', '100', '200', '500', '1000'].map(n => (
                      <SelectItem key={n} value={n}>Last {n} ticks</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {!isRunning ? (
            <Button onClick={startSmartBot} disabled={!isAuthorized || balance < parseFloat(stake)}
              className="w-full h-11 text-sm font-bold bg-profit hover:bg-profit/90 text-profit-foreground">
              <Play className="w-4 h-4 mr-2" /> 🟢 LOAD SMART BOT & TRADE
            </Button>
          ) : (
            <Button onClick={stopSmartBot} variant="destructive" className="w-full h-11 text-sm font-bold">
              <StopCircle className="w-4 h-4 mr-2" /> STOP SMART BOT
            </Button>
          )}

          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-warning">
              <Loader2 className="w-3 h-3 animate-spin" /> Bot running — settings locked
            </div>
          )}

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-xs font-semibold text-foreground mb-2">📋 Martingale Rules</h3>
            <div className="space-y-1 text-[10px] text-muted-foreground">
              <div className="flex items-center gap-1"><XCircle className="w-3 h-3 text-loss" /> LOSS → Multiply stake</div>
              <div className="flex items-center gap-1"><CheckCircle className="w-3 h-3 text-profit" /> WIN → Reset to base</div>
              <div className="flex items-center gap-1"><AlertTriangle className="w-3 h-3 text-warning" /> No stacking — wait for API result</div>
            </div>
          </div>
        </div>

        {/* Center: Signals + Digits */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-1">
              <TrendingUp className="w-4 h-4 text-primary" /> Live Signal Scanner
              <Badge variant="outline" className="ml-auto text-[10px]">
                {validSignals.length}/{MARKETS.length} valid
              </Badge>
            </h3>
            <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
              {signals.slice(0, 10).map(s => (
                <div key={s.symbol} className={`flex items-center justify-between p-2 rounded-lg text-xs ${s.isValid ? 'bg-profit/10 border border-profit/30' : 'bg-muted'}`}>
                  <div className="flex items-center gap-2">
                    {s.isValid ? <CheckCircle className="w-3.5 h-3.5 text-profit" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                    <span className="font-mono font-semibold">{s.marketName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.signalStrength >= 6 ? 'default' : 'secondary'} className="text-[9px]">STR: {s.signalStrength}</Badge>
                    {s.isValid && (
                      <>
                        <span className="font-mono text-profit">{s.suggestedContract.replace('DIGIT', '')} {s.suggestedBarrier}</span>
                        <Button size="sm" variant="outline"
                          className="h-6 px-2 text-[10px] font-bold border-profit text-profit hover:bg-profit hover:text-profit-foreground"
                          disabled={isRunning || executingSignal !== null || balance < parseFloat(stake)}
                          onClick={() => executeSignalTrade(s)}>
                          {executingSignal === s.symbol ? <Loader2 className="w-3 h-3 animate-spin" /> : <><Play className="w-3 h-3 mr-1" /> TRADE</>}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {signals.length === 0 && (
                <div className="text-center text-muted-foreground text-xs py-4">Waiting for tick data...</div>
              )}
            </div>
          </div>

          {activeMarket && activeDigits.length > 0 && <DigitDisplay digits={activeDigits} barrier={selectedDigit} />}
          {activeMarket && (liveDigits[activeMarket] || []).length > 10 && (
            <SmartDigitGrid digits={(liveDigits[activeMarket] || []).slice(-200)} barrier={selectedDigit} onSelectDigit={setSelectedDigit} selectedDigit={selectedDigit} />
          )}
        </div>

        {/* Right: Trade Log + Status */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Session</h3>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Balance', value: `$${balance.toFixed(2)}`, color: 'text-foreground' },
                { label: 'Wins', value: winCount, color: 'text-profit' },
                { label: 'Losses', value: lossCount, color: 'text-loss' },
                { label: 'P/L', value: `$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'text-profit' : 'text-loss' },
                { label: 'Runs', value: `${runCount}/${maxRuns}`, color: 'text-foreground' },
                { label: 'Active', value: activeMarket || '—', color: 'text-primary' },
              ].map(s => (
                <div key={s.label} className="bg-muted rounded-lg p-2 text-center">
                  <div className="text-[9px] text-muted-foreground">{s.label}</div>
                  <div className={`font-mono text-xs font-bold ${s.color}`}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          <TradeLogComponent trades={trades} />

          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold text-foreground mb-2">Bot Log</h3>
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {statusLog.map((log, i) => (
                <div key={i} className="text-[10px] text-muted-foreground font-mono leading-relaxed">{log}</div>
              ))}
              {statusLog.length === 0 && (
                <div className="text-[10px] text-muted-foreground text-center py-4">Press "Load Smart Bot & Trade" to begin</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
