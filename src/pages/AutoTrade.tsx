import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi, MARKETS, type MarketSymbol } from '@/services/deriv-api';
import { getLastDigit } from '@/services/analysis';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import TradeConfig, { type TradeConfigState } from '@/components/auto-trade/TradeConfig';
import DigitDisplay from '@/components/auto-trade/DigitDisplay';
import PercentagePanel from '@/components/auto-trade/PercentagePanel';
import SignalAlerts from '@/components/auto-trade/SignalAlerts';
import StatsPanel from '@/components/auto-trade/StatsPanel';
import TradeLogComponent from '@/components/auto-trade/TradeLog';
import { type TradeLog } from '@/components/auto-trade/types';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Loader2 } from 'lucide-react';

/** Built-in pattern strategies */
const STRATEGIES: { id: string; label: string; check: (d: number[], p: number[]) => boolean; contract: string; barrier: string }[] = [
  { id: 'odd4_up', label: 'Last 4 digits are ODD → Trade DIGITOVER', check: (d) => d.length >= 4 && d.slice(-4).every(x => x % 2 !== 0), contract: 'DIGITOVER', barrier: '1' },
  { id: 'even4_down', label: 'Last 4 digits are EVEN → Trade DIGITUNDER', check: (d) => d.length >= 4 && d.slice(-4).every(x => x % 2 === 0), contract: 'DIGITUNDER', barrier: '6' },
  { id: 'zero_over', label: 'Last digit is 0 → Trade DIGITOVER 0', check: (d) => d.length > 0 && d[d.length - 1] === 0, contract: 'DIGITOVER', barrier: '0' },
  { id: 'rise3_fall', label: '3 consecutive rises → Trade PUT (Fall)', check: (_d, p) => { if (p.length < 4) return false; const t = p.slice(-4); return t[1] > t[0] && t[2] > t[1] && t[3] > t[2]; }, contract: 'PUT', barrier: '' },
  { id: 'fall3_rise', label: '3 consecutive falls → Trade CALL (Rise)', check: (_d, p) => { if (p.length < 4) return false; const t = p.slice(-4); return t[1] < t[0] && t[2] < t[1] && t[3] < t[2]; }, contract: 'CALL', barrier: '' },
  { id: 'over5_under', label: 'Last 5 digits all > 5 → Trade DIGITUNDER', check: (d) => d.length >= 5 && d.slice(-5).every(x => x > 5), contract: 'DIGITUNDER', barrier: '6' },
  { id: 'under4_over', label: 'Last 5 digits all < 4 → Trade DIGITOVER', check: (d) => d.length >= 5 && d.slice(-5).every(x => x < 4), contract: 'DIGITOVER', barrier: '3' },
];

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
  try { if ('speechSynthesis' in window) { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch {}
}

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();

  const [config, setConfig] = useState<TradeConfigState>({
    market: 'R_100', contractType: 'DIGITOVER', digit: '4', stake: '1',
    martingale: false, multiplier: '2', stopLoss: '10', takeProfit: '20', maxTrades: '50',
  });

  // Dual market
  const [market2Enabled, setMarket2Enabled] = useState(false);
  const [market2, setMarket2] = useState<MarketSymbol>('R_75');
  const [activeMarketIdx, setActiveMarketIdx] = useState<1 | 2>(1);

  // Strategy
  const [strategyId, setStrategyId] = useState<string>(STRATEGIES[0].id);

  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [currentStake, setCurrentStake] = useState(1);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const tradeIdRef = useRef(0);

  const currentMarket = activeMarketIdx === 1 ? config.market : market2;
  const { digits, prices, isLoading, tickCount } = useTickLoader(currentMarket, 1000);

  const barrier = parseInt(config.digit);

  const handleConfigChange = useCallback(<K extends keyof TradeConfigState>(key: K, val: TradeConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  const selectedStrategy = STRATEGIES.find(s => s.id === strategyId) || STRATEGIES[0];

  // Main trading loop
  const startTrading = useCallback(async () => {
    if (!isAuthorized || isRunning) return;

    // Balance guard
    const stakeNum = parseFloat(config.stake);
    if (balance < stakeNum) {
      toast.error('Insufficient balance — Bot halted');
      return;
    }

    setIsRunning(true);
    runningRef.current = true;
    pausedRef.current = false;
    setIsPaused(false);

    let stake = stakeNum;
    setCurrentStake(stake);
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(config.maxTrades);
    const sl = parseFloat(config.stopLoss);
    const tp = parseFloat(config.takeProfit);
    const mult = parseFloat(config.multiplier);
    let currentMktIdx: 1 | 2 = 1;

    while (runningRef.current && tradeCount < maxTradeCount) {
      if (pausedRef.current) { await new Promise(r => setTimeout(r, 500)); continue; }

      // Balance check before every trade
      if (balance < stake) {
        toast.error('Insufficient balance — Bot halted');
        runningRef.current = false;
        break;
      }

      try {
        const mkt = currentMktIdx === 1 ? config.market : market2;
        setActiveMarketIdx(currentMktIdx);

        const freshTick = await waitForNextTick(mkt);
        const extractedDigit = getLastDigit(freshTick.quote);

        // Check strategy condition
        const latestDigits = [...digits, extractedDigit].slice(-1000);
        const latestPrices = [...prices, freshTick.quote].slice(-1000);
        const conditionMet = selectedStrategy.check(latestDigits, latestPrices);

        if (!conditionMet) { continue; }

        const contractType = selectedStrategy.contract || config.contractType;
        const tradeBarrier = selectedStrategy.barrier || config.digit;
        const needsBarrier = ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(contractType);

        const params: any = {
          contract_type: contractType, symbol: mkt,
          duration: 1, duration_unit: 't', basis: 'stake', amount: stake,
        };
        if (needsBarrier && tradeBarrier) params.barrier = tradeBarrier;

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();

        setTrades(prev => [{ id, time: now, market: mkt, contract: contractType, stake, result: 'Pending' as const, pnl: 0 }, ...prev].slice(0, 100));

        const { contractId, buyPrice } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));

        totalPnl += pnl;
        tradeCount++;

        // STANDARD MARTINGALE: LOSS → multiply, WIN → reset
        if (config.martingale) {
          if (won) { stake = parseFloat(config.stake); }
          else { stake *= mult; }
        } else { stake = parseFloat(config.stake); }
        setCurrentStake(stake);

        // Dual market switching: loss in M1 → switch to M2, win in M2 → back to M1
        if (market2Enabled) {
          if (!won && currentMktIdx === 1) {
            currentMktIdx = 2;
            toast.info(`Switched to ${MARKETS.find(m => m.symbol === market2)?.name || market2} due to loss`);
          } else if (won && currentMktIdx === 2) {
            currentMktIdx = 1;
            toast.info(`Switched back to ${MARKETS.find(m => m.symbol === config.market)?.name || config.market}`);
          }
        }

        // Stop Loss / Take Profit
        if (totalPnl <= -sl) {
          toast.error(`🛑 Stop Loss Hit! P/L: $${totalPnl.toFixed(2)}`, { duration: 10000 });
          speakMessage('Stop loss hit. Bot stopped.');
          runningRef.current = false;
        }
        if (totalPnl >= tp) {
          toast.success(`🎊 Congratulations! Take Profit Hit! +$${totalPnl.toFixed(2)}`, { duration: 15000 });
          speakMessage('Congratulations! Your take profit has been hit!');
          runningRef.current = false;
        }

        await new Promise(r => setTimeout(r, 500));
      } catch (err: any) {
        if (err.message?.includes('Insufficient balance')) {
          toast.error('Insufficient balance — Bot halted');
          runningRef.current = false;
        } else {
          console.error('Trade error:', err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    setIsRunning(false);
    runningRef.current = false;
  }, [isAuthorized, isRunning, config, balance, market2Enabled, market2, selectedStrategy, digits, prices]);

  const pauseTrading = () => { pausedRef.current = !pausedRef.current; setIsPaused(!isPaused); };
  const stopTrading = () => { runningRef.current = false; setIsRunning(false); setIsPaused(false); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">Digit Trading Bot</h1>
          <p className="text-xs text-muted-foreground">
            API-confirmed results • Standard martingale (LOSS → multiply)
          </p>
        </div>
        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-warning">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Fetching 1000 ticks...
          </div>
        )}
        {!isLoading && (
          <Badge variant="outline" className="text-[10px]">{tickCount} ticks loaded</Badge>
        )}
      </div>

      <StatsPanel trades={trades} balance={balance} currentStake={currentStake} market={currentMarket} currency={activeAccount?.currency || 'USD'} />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        <div className="lg:col-span-3 space-y-4">
          <TradeConfig
            config={config} onChange={handleConfigChange}
            isRunning={isRunning} isPaused={isPaused} isAuthorized={isAuthorized && balance >= parseFloat(config.stake || '0')}
            currency={activeAccount?.currency || 'USD'}
            onStart={startTrading} onPause={pauseTrading} onStop={stopTrading}
          />

          {/* Strategy Selector */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Pattern Strategy</h3>
            <Select value={strategyId} onValueChange={setStrategyId} disabled={isRunning}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STRATEGIES.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground italic">
              IF [{selectedStrategy.label.split('→')[0].trim()}] THEN [{selectedStrategy.label.split('→')[1]?.trim()}] IN [{MARKETS.find(m => m.symbol === currentMarket)?.name}]
            </p>
          </div>

          {/* Dual Market Config */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Dual Market</h3>
              <Switch checked={market2Enabled} onCheckedChange={setMarket2Enabled} disabled={isRunning} />
            </div>
            {market2Enabled && (
              <>
                <div>
                  <label className="text-[10px] text-muted-foreground">Market Two</label>
                  <Select value={market2} onValueChange={v => setMarket2(v as MarketSymbol)} disabled={isRunning}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MARKETS.filter(m => m.symbol !== config.market).map(m => (
                        <SelectItem key={m.symbol} value={m.symbol}>{m.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="text-[10px] text-muted-foreground space-y-1">
                  <p>• Loss in M1 → Switch to M2</p>
                  <p>• Win in M2 → Switch back to M1</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">Active:</span>
                  <Badge variant={activeMarketIdx === 1 ? 'default' : 'secondary'} className="text-[9px]">
                    {activeMarketIdx === 1 ? MARKETS.find(m => m.symbol === config.market)?.name : MARKETS.find(m => m.symbol === market2)?.name}
                  </Badge>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <DigitDisplay digits={digits.slice(-30)} barrier={barrier} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <PercentagePanel digits={digits} barrier={barrier} selectedDigit={barrier} onSelectDigit={d => handleConfigChange('digit', String(d))} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <SignalAlerts digits={digits} barrier={barrier} soundEnabled={soundEnabled} onSoundToggle={setSoundEnabled} />
          </motion.div>
        </div>

        <div className="lg:col-span-5">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            <TradeLogComponent trades={trades} />
          </motion.div>
        </div>
      </div>
    </div>
  );
}
