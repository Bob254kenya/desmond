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
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Play, StopCircle, Pause, Bot, Activity, TrendingUp, TrendingDown, CircleDot } from 'lucide-react';

interface BotState {
  id: string;
  name: string;
  type: 'over3' | 'under6' | 'even' | 'odd';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  contractType: string;
  barrier?: number;
  lastSignal?: string;
}

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

// Analysis functions for each bot
const analyzeOver3 = (digits: number[]): boolean => {
  if (digits.length < 100) return false;
  const last100 = digits.slice(-100);
  const over3Count = last100.filter(d => d > 3).length;
  const underOrEqual3Count = last100.filter(d => d <= 3).length;
  return over3Count > underOrEqual3Count + 5; // 5 more over 3 than under/equal 3
};

const analyzeUnder6 = (digits: number[]): boolean => {
  if (digits.length < 100) return false;
  const last100 = digits.slice(-100);
  const under6Count = last100.filter(d => d < 6).length;
  const over5Count = last100.filter(d => d > 5).length;
  return under6Count > over5Count + 5; // 5 more under 6 than over 5
};

const analyzeEven = (digits: number[]): boolean => {
  if (digits.length < 100) return false;
  const last100 = digits.slice(-100);
  const evenCount = last100.filter(d => d % 2 === 0).length;
  const oddCount = last100.filter(d => d % 2 === 1).length;
  return evenCount > oddCount + 10; // at least 10 more even than odd
};

const analyzeOdd = (digits: number[]): boolean => {
  if (digits.length < 100) return false;
  const last100 = digits.slice(-100);
  const oddCount = last100.filter(d => d % 2 === 1).length;
  const evenCount = last100.filter(d => d % 2 === 0).length;
  return oddCount > evenCount + 10; // at least 10 more odd than even
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);

  // Global settings
  const [config, setConfig] = useState<TradeConfigState>({
    market: 'R_100', contractType: 'DIGITOVER', digit: '4', stake: '0.5',
    martingale: true, multiplier: '2', stopLoss: '30', takeProfit: '3', maxTrades: '100',
  });

  const [tickRange, setTickRange] = useState<number>(100);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const tradeIdRef = useRef(0);

  // Four independent bots
  const [bots, setBots] = useState<BotState[]>([
    { id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITOVER', barrier: 3 },
    { id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITUNDER', barrier: 6 },
    { id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITEVEN' },
    { id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITODD' },
  ]);

  // Refs for each bot's running state
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  const { digits, prices, isLoading, tickCount } = useTickLoader(config.market, 1000);
  const analysisDigits = digits.slice(-tickRange);
  const lastDigit = digits.length > 0 ? digits[digits.length - 1] : null;

  // Update bot signals based on analysis
  useEffect(() => {
    if (digits.length < 100) return;

    setBots(prev => prev.map(bot => {
      let signal = false;
      switch (bot.type) {
        case 'over3': signal = analyzeOver3(digits); break;
        case 'under6': signal = analyzeUnder6(digits); break;
        case 'even': signal = analyzeEven(digits); break;
        case 'odd': signal = analyzeOdd(digits); break;
      }
      return { ...bot, lastSignal: signal ? '✅ READY' : '⏳ WAITING' };
    }));
  }, [digits]);

  // Trading loop for a specific bot
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    const stakeNum = parseFloat(config.stake);
    if (balance < stakeNum) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    // Update bot running state
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isRunning: true, isPaused: false, currentStake: stakeNum } : b));
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = stakeNum;
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(config.maxTrades);
    const sl = parseFloat(config.stopLoss);
    const tp = parseFloat(config.takeProfit);
    const mult = parseFloat(config.multiplier);
    const botConfig = bots.find(b => b.id === botId)!;

    while (botRunningRefs.current[botId] && tradeCount < maxTradeCount) {
      // Check if paused
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Check stop loss / take profit
      if (totalPnl <= -sl) {
        toast.error(`${bot.name}: Stop Loss hit! $${totalPnl.toFixed(2)}`);
        speakMessage(`${bot.name} stopped: loss limit reached`);
        break;
      }
      if (totalPnl >= tp) {
        toast.success(`${bot.name}: Take Profit hit! +$${totalPnl.toFixed(2)}`);
        speakMessage(`${bot.name} take profit reached`);
        break;
      }

      // Check if condition is met for this bot type
      let conditionMet = false;
      switch (botConfig.type) {
        case 'over3': conditionMet = analyzeOver3(digits); break;
        case 'under6': conditionMet = analyzeUnder6(digits); break;
        case 'even': conditionMet = analyzeEven(digits); break;
        case 'odd': conditionMet = analyzeOdd(digits); break;
      }

      if (!conditionMet) {
        // Wait for next tick if condition not met
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      // Wait for next tick before placing trade
      try {
        await waitForNextTick(config.market);

        // Check if another bot is trading (prevent multiple simultaneous trades)
        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // Prepare contract parameters
        const params: any = {
          contract_type: botConfig.contractType,
          symbol: config.market,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        // Add barrier for Over/Under bots
        if (botConfig.barrier !== undefined) {
          params.barrier = botConfig.barrier.toString();
        }

        // Place trade
        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: config.market,
          contract: botConfig.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: botConfig.name
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        // Update trade log
        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));

        totalPnl += pnl;
        tradeCount++;

        // Update bot state
        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: tradeCount,
              currentStake: config.martingale && !won ? Math.round(stake * mult * 100) / 100 : stakeNum
            };
          }
          return b;
        }));

        // Martingale logic for next stake
        if (config.martingale) {
          if (won) stake = stakeNum;
          else stake = Math.round(stake * mult * 100) / 100;
        } else {
          stake = stakeNum;
        }

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 500)); // Small delay between trades

      } catch (err: any) {
        setActiveTradeId(null);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        } else {
          console.error(`Trade error for ${bot.name}:`, err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    // Stop the bot
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isRunning: false, isPaused: false } : b));
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, config, balance, digits, activeTradeId, bots]);

  // Bot control functions
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    // Reset stake to initial value
    setBots(prev => prev.map(b => b.id === botId ? { ...b, currentStake: parseFloat(config.stake) } : b));
    
    // Start the bot in a non-blocking way
    setTimeout(() => runBot(botId), 0);
  };

  const pauseBot = (botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b));
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isRunning: false, isPaused: false } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ ...b, isRunning: false, isPaused: false })));
  };

  const handleConfigChange = useCallback(<K extends keyof TradeConfigState>(key: K, val: TradeConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  // Get bot icon based on type
  const getBotIcon = (type: string) => {
    switch(type) {
      case 'over3': return <TrendingUp className="w-4 h-4" />;
      case 'under6': return <TrendingDown className="w-4 h-4" />;
      case 'even': return <CircleDot className="w-4 h-4" />;
      case 'odd': return <CircleDot className="w-4 h-4" />;
      default: return <Bot className="w-4 h-4" />;
    }
  };

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">🤖 Deriv 4‑Bot Digit Trading System</h1>
          <p className="text-sm text-muted-foreground">Independent bots • Martingale • 1-tick duration • Shared API</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-warning">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading ticks...
            </div>
          ) : (
            <Badge variant="outline" className="text-xs">{tickCount} ticks • Last digit: {lastDigit ?? '—'}</Badge>
          )}
          <Button variant="destructive" size="sm" onClick={stopAllBots} disabled={!bots.some(b => b.isRunning)}>
            <StopCircle className="w-4 h-4 mr-1" /> Stop All
          </Button>
        </div>
      </div>

      {/* Stats Panel */}
      <StatsPanel 
        trades={trades} 
        balance={balance} 
        currentStake={parseFloat(config.stake)} 
        market={config.market} 
        currency={activeAccount?.currency || 'USD'} 
      />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Column - Settings & Analysis Tools */}
        <div className="lg:col-span-3 space-y-4">
          {/* Trading Config */}
          <TradeConfig
            config={config} 
            onChange={handleConfigChange}
            isRunning={bots.some(b => b.isRunning)} 
            isPaused={false}
            isAuthorized={isAuthorized && balance >= parseFloat(config.stake || '0')}
            currency={activeAccount?.currency || 'USD'}
            onStart={() => {}} // Disabled, using individual bot starts
            onPause={() => {}}
            onStop={stopAllBots}
          />

          {/* Analysis Window */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Analysis Window</h3>
              <span className="text-xs font-mono text-primary">{tickRange} ticks</span>
            </div>
            <Slider 
              min={1} 
              max={1000} 
              step={1} 
              value={[tickRange]}
              onValueChange={([v]) => setTickRange(v)} 
              disabled={bots.some(b => b.isRunning)} 
            />
          </div>

          {/* Live Indicators */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3">Market Status</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Trades:</span>
                <span className="font-mono">{activeTradeId ? '🔴 1' : '⚫ 0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Connection:</span>
                <span className="text-success">✅ Connected</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Running Bots:</span>
                <span className="font-mono">{bots.filter(b => b.isRunning).length}/4</span>
              </div>
            </div>
          </div>
        </div>

        {/* Middle Column - Digit Display & Analysis */}
        <div className="lg:col-span-4 space-y-4">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <DigitDisplay digits={analysisDigits.slice(-30)} barrier={parseInt(config.digit)} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <PercentagePanel 
              digits={analysisDigits} 
              barrier={parseInt(config.digit)} 
              selectedDigit={parseInt(config.digit)} 
              onSelectDigit={d => handleConfigChange('digit', String(d))} 
            />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <SignalAlerts 
              digits={analysisDigits} 
              barrier={parseInt(config.digit)} 
              soundEnabled={soundEnabled} 
              onSoundToggle={setSoundEnabled} 
            />
          </motion.div>
        </div>

        {/* Right Column - Four Bots Grid */}
        <div className="lg:col-span-5 space-y-4">
          {/* Bots Grid */}
          <div className="grid grid-cols-2 gap-3">
            {bots.map((bot) => (
              <motion.div
                key={bot.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`bg-card border rounded-xl p-3 space-y-2 ${
                  bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
                }`}
              >
                {/* Bot Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`p-1.5 rounded-lg ${
                      bot.type === 'over3' ? 'bg-blue-500/20 text-blue-400' :
                      bot.type === 'under6' ? 'bg-orange-500/20 text-orange-400' :
                      bot.type === 'even' ? 'bg-green-500/20 text-green-400' :
                      'bg-purple-500/20 text-purple-400'
                    }`}>
                      {getBotIcon(bot.type)}
                    </div>
                    <div>
                      <h4 className="font-bold text-sm">{bot.name}</h4>
                      <p className="text-[10px] text-muted-foreground">
                        {bot.contractType} {bot.barrier !== undefined ? `| Barrier ${bot.barrier}` : ''}
                      </p>
                    </div>
                  </div>
                  <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                    {bot.isRunning ? (bot.isPaused ? '⏸️ PAUSED' : '▶️ RUN') : '⏹️ STOP'}
                  </Badge>
                </div>

                {/* Bot Stats */}
                <div className="grid grid-cols-2 gap-1 text-[10px]">
                  <div>
                    <span className="text-muted-foreground">P&L:</span>
                    <span className={`ml-1 font-mono ${
                      bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                    }`}>
                      ${bot.totalPnl.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Trades:</span>
                    <span className="ml-1 font-mono">{bot.trades}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Stake:</span>
                    <span className="ml-1 font-mono">${bot.currentStake.toFixed(2)}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Signal:</span>
                    <span className={`ml-1 font-mono ${
                      bot.lastSignal?.includes('✅') ? 'text-profit' : 'text-muted-foreground'
                    }`}>
                      {bot.lastSignal || '⏳'}
                    </span>
                  </div>
                </div>

                {/* Bot Controls */}
                <div className="flex gap-1 mt-2">
                  {!bot.isRunning ? (
                    <Button
                      onClick={() => startBot(bot.id)}
                      disabled={!isAuthorized || balance < parseFloat(config.stake) || activeTradeId !== null}
                      size="sm"
                      className="flex-1 h-7 text-xs"
                      variant="default"
                    >
                      <Play className="w-3 h-3 mr-1" /> Start
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => pauseBot(bot.id)}
                        size="sm"
                        variant="outline"
                        className="flex-1 h-7 text-xs"
                      >
                        <Pause className="w-3 h-3 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                      </Button>
                      <Button
                        onClick={() => stopBot(bot.id)}
                        size="sm"
                        variant="destructive"
                        className="flex-1 h-7 text-xs"
                      >
                        <StopCircle className="w-3 h-3 mr-1" /> Stop
                      </Button>
                    </>
                  )}
                </div>
              </motion.div>
            ))}
          </div>

          {/* Trade Log */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
            <div className="bg-card border border-border rounded-xl p-3">
              <h3 className="text-sm font-semibold mb-2">📋 Live Trade Log</h3>
              <div className="space-y-1 max-h-[300px] overflow-y-auto">
                {trades.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No trades yet</p>
                ) : (
                  trades.map((trade, idx) => (
                    <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">{trade.time}</span>
                        {trade.bot && (
                          <Badge variant="outline" className="text-[8px] px-1 py-0">{trade.bot}</Badge>
                        )}
                        <span className="font-mono">{trade.contract}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">${trade.stake.toFixed(2)}</span>
                        <span className={`font-mono w-16 text-right ${
                          trade.result === 'Win' ? 'text-profit' : trade.result === 'Loss' ? 'text-loss' : ''
                        }`}>
                          {trade.result === 'Win' ? `+$${trade.pnl.toFixed(2)}` : 
                           trade.result === 'Loss' ? `-$${Math.abs(trade.pnl).toFixed(2)}` : 
                           '⏳'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
