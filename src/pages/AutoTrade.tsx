import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const MARKETS = [
  "R_10","R_25","R_50","R_75","R_100",
  "1HZ_10","1HZ_25","1HZ_50","1HZ_75","1HZ_100",
  "JD10","JD25","JD50","JD75","JD100"
];

const CONTRACT_PAYOUT = 9.5;

export default function DerivBot() {
  const [signals, setSignals] = useState<any[]>([]);
  const [bots, setBots] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);

  const log = (msg: string) => {
    setLogs(prev => [{ t: new Date().toLocaleTimeString(), msg }, ...prev]);
  };

  // ======================
  // FETCH TICKS
  // ======================
  const fetchTicks = async (symbol: string) => {
    const res = await fetch(`https://api.deriv.com/ticks?symbol=${symbol}&count=1000`);
    const data = await res.json();
    return data.ticks.map((t: any) =>
      parseInt(t.quote.toString().slice(-1))
    );
  };

  // ======================
  // ANALYSIS
  // ======================
  const analyze = (symbol: string, digits: number[]) => {
    const total = digits.length;
    const freq = Array(10).fill(0);

    digits.forEach(d => freq[d]++);

    const perc = freq.map(f => (f / total) * 100);

    const low = perc[0] + perc[1] + perc[2];
    const high = perc[7] + perc[8] + perc[9];
    const even = [0,2,4,6,8].reduce((a,b)=>a+perc[b],0);
    const odd = 100 - even;

    let type = null;
    let entry = 0;

    if (low < 10) {
      type = "TYPE_A";
      entry = perc[0] > perc[1] ? 0 : 1;
    } else if (high < 10) {
      type = "TYPE_B";
      entry = [7,8,9].reduce((a,b)=>perc[a]>perc[b]?a:b);
    } else if (even > 55) {
      type = "EVEN_ODD";
      entry = 4;
    }

    return { symbol, perc, low, high, even, odd, type, entry };
  };

  // ======================
  // SCAN
  // ======================
  const scan = async () => {
    setScanning(true);
    setProgress(0);

    const results = await Promise.all(
      MARKETS.map(async (m, i) => {
        const digits = await fetchTicks(m);
        setProgress(Math.round(((i+1)/MARKETS.length)*100));
        return analyze(m, digits);
      })
    );

    const filtered = results.filter(r => r.type);
    setSignals(filtered);
    setScanning(false);

    log(`Scan complete → ${filtered.length} signals`);
  };

  // ======================
  // EXECUTE (SIMULATION)
  // ======================
  const execute = async (bot: any) => {
    const digit = Math.floor(Math.random() * 10);
    const win = digit === bot.entry;

    if (win) {
      const profit = bot.currentStake * (CONTRACT_PAYOUT - 1);
      bot.pnl += profit;
      bot.currentStake = bot.baseStake;
      bot.lossStreak = 0;
      log(`✅ ${bot.symbol} WIN +${profit.toFixed(2)}`);
      return true;
    } else {
      bot.pnl -= bot.currentStake;
      bot.lossStreak++;
      bot.currentStake *= bot.multiplier;
      log(`❌ ${bot.symbol} LOSS`);
      return false;
    }
  };

  // ======================
  // RUN BOT
  // ======================
  const runBot = async (id: string) => {
    let bot = bots.find(b => b.id === id);
    if (!bot) return;

    let contracts = 0;

    while (bot.running) {

      if (bot.pnl >= bot.tp) {
        log(`🎯 TP HIT ${bot.symbol}`);
        bot.running = false;
        break;
      }

      if (bot.pnl <= -bot.sl) {
        log(`🛑 SL HIT ${bot.symbol}`);
        bot.running = false;
        break;
      }

      if (contracts >= 3 && bot.pnl > 0) {
        bot.running = false;
        break;
      }

      const win = await execute(bot);

      contracts++;

      if (win && bot.pnl > 0) {
        bot.running = false;
        break;
      }

      await new Promise(r => setTimeout(r, 1200));
    }

    setBots(prev => [...prev]);
  };

  // ======================
  // START BOT
  // ======================
  const startBot = (s: any) => {
    const bot = {
      id: Date.now().toString(),
      symbol: s.symbol,
      type: s.type,
      entry: s.entry,

      baseStake: 1,
      currentStake: 1,
      multiplier: 2,

      tp: 5,
      sl: 10,

      pnl: 0,
      running: true,
      lossStreak: 0
    };

    setBots(prev => [...prev, bot]);
    runBot(bot.id);
  };

  return (
    <div className="p-6 bg-black text-white min-h-screen">
      <h1 className="text-3xl mb-4">Deriv Auto Bot</h1>

      <Button onClick={scan}>
        {scanning ? `Scanning ${progress}%` : "SCAN"}
      </Button>

      {/* SIGNALS */}
      <div className="grid grid-cols-3 gap-4 mt-6">
        {signals.map((s, i) => (
          <Card key={i} className="bg-gray-900">
            <CardContent className="p-4">
              <h2>{s.symbol}</h2>
              <p>{s.type}</p>
              <p>Entry: {s.entry}</p>
              <p>Even: {s.even.toFixed(1)}%</p>

              <Button onClick={() => startBot(s)}>
                Start Bot
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* BOTS */}
      <h2 className="mt-8 text-xl">Active Bots</h2>
      {bots.map((b, i) => (
        <div key={i} className="border p-2 mt-2">
          {b.symbol} | PnL: {b.pnl.toFixed(2)} | Stake: {b.currentStake.toFixed(2)}
        </div>
      ))}

      {/* LOGS */}
      <h2 className="mt-8 text-xl">Logs</h2>
      <div className="h-40 overflow-auto bg-gray-900 p-2">
        {logs.map((l, i) => (
          <div key={i}>{l.t} - {l.msg}</div>
        ))}
      </div>
    </div>
  );
}
