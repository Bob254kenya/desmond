import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { derivApi } from "@/services/deriv-api";

// ================= MARKETS =================
const MARKETS = [
  "R_10","R_25","R_50","R_75","R_100",
  "1HZ10V","1HZ25V","1HZ50V","1HZ75V","1HZ100V",
  "JD10","JD25","JD50","JD75","JD100",
  "JB10","JB25","JB50","JB75","JB100",
  "R_10","R_25","R_50","R_75","R_100"
];

// ================= TYPES =================
interface Bot {
  id: string;
  market: string;
  type: "A" | "B" | "EVEN";
  entry: number | "EVEN" | "ODD";
  stake: number;
  martingale: number;
  runs: number;
  pnl: number;
  running: boolean;
}

// ================= PAGE =================
export default function DerivBotPage() {
  const [bots, setBots] = useState<Bot[]>([]);
  const botsRef = useRef<Bot[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);

  useEffect(() => {
    botsRef.current = bots;
  }, [bots]);

  // ================= FETCH TICKS =================
  const fetchTicks = async (symbol: string) => {
    try {
      const res = await derivApi.getTickHistory(symbol, 1000);
      return res.map((t: any) => t.quote);
    } catch {
      return [];
    }
  };

  // ================= ANALYSIS =================
  const analyze = (ticks: number[]) => {
    const counts = new Array(10).fill(0);
    ticks.forEach(t => counts[Math.floor(t % 10)]++);

    const total = ticks.length;

    const low = (counts[0] + counts[1] + counts[2]) / total * 100;
    const high = (counts[7] + counts[8] + counts[9]) / total * 100;
    const even = (counts[0]+counts[2]+counts[4]+counts[6]+counts[8]) / total * 100;
    const odd = 100 - even;

    return { low, high, even, odd, counts };
  };

  // ================= CREATE BOTS =================
  const createBot = (market: string, analysis: any) => {
    let type: Bot["type"] | null = null;
    let entry: any = null;

    if (analysis.low < 10) {
      type = "A";
      entry = 0;
    } 
    else if (analysis.high < 10) {
      type = "B";
      entry = 7;
    } 
    else if (analysis.even > 55) {
      type = "EVEN";
      entry = "EVEN";
    }

    if (!type) return;

    setBots(prev => {
      if (prev.find(b => b.market === market && b.type === type)) return prev;

      return [...prev, {
        id: Date.now()+Math.random()+"",
        market,
        type,
        entry,
        stake: 1,
        martingale: 2,
        runs: 3,
        pnl: 0,
        running: false
      }];
    });
  };

  // ================= SCAN ALL =================
  const scan = async () => {
    setScanning(true);

    const results = await Promise.allSettled(
      MARKETS.map(m => fetchTicks(m))
    );

    results.forEach((res, i) => {
      if (res.status === "fulfilled") {
        const analysis = analyze(res.value);
        createBot(MARKETS[i], analysis);
      }
    });

    setScanning(false);
  };

  // ================= WAIT TICK =================
  const waitTick = (symbol: string): Promise<number> => {
    return new Promise(resolve => {
      const unsub = derivApi.onMessage((data: any) => {
        if (data.tick?.symbol === symbol) {
          unsub();
          resolve(data.tick.quote);
        }
      });
    });
  };

  // ================= RUN BOT =================
  const runBot = async (botId: string) => {
    let bot = botsRef.current.find(b => b.id === botId);
    if (!bot) return;

    let stake = bot.stake;
    let pnl = bot.pnl;
    let step = 0;

    setBots(b => b.map(x => x.id === botId ? {...x, running: true} : x));

    while (true) {
      let runCount = 0;

      while (runCount < 3) {
        const tick = await waitTick(bot.market);
        const digit = Math.floor(tick % 10);

        let enter = false;

        if (bot.entry === "EVEN") enter = digit % 2 === 0;
        else if (bot.entry === "ODD") enter = digit % 2 === 1;
        else enter = digit !== bot.entry;

        if (!enter) continue;

        const contract = await derivApi.buyContract({
          symbol: bot.market,
          contract_type: bot.entry === "EVEN" ? "DIGITEVEN" : "DIGITMATCH",
          amount: stake,
          duration: 1,
          duration_unit: "t",
          basis: "stake",
          barrier: typeof bot.entry === "number" ? bot.entry.toString() : undefined
        });

        const result = await derivApi.waitForContractResult(contract.contractId);

        pnl += result.profit;

        setLogs(l => [{
          market: bot.market,
          profit: result.profit
        }, ...l]);

        if (result.status === "won") {
          // STOP ONLY ON PROFIT
          if (pnl > 0) {
            setBots(b => b.map(x => x.id === botId ? {...x, pnl, running:false} : x));
            return;
          }
        } else {
          // MARTINGALE
          step++;
          stake = stake * bot.martingale;
        }

        runCount++;
      }
    }
  };

  // ================= UI =================
  return (
    <div className="p-4 space-y-4">

      {/* HEADER */}
      <div className="flex gap-2">
        <Button onClick={scan} disabled={scanning}>
          {scanning ? "Scanning..." : "Scan 25 Markets"}
        </Button>
      </div>

      {/* BOTS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {bots.map(bot => (
          <Card key={bot.id}>
            <CardContent className="p-4 space-y-2">

              <div className="font-bold">{bot.market}</div>
              <div>Type: {bot.type}</div>
              <div>Entry: {bot.entry}</div>

              <Input
                value={bot.stake}
                type="number"
                onChange={(e)=>
                  setBots(b => b.map(x =>
                    x.id===bot.id ? {...x, stake:+e.target.value} : x
                  ))
                }
              />

              <Button
                onClick={()=>runBot(bot.id)}
                disabled={bot.running}
              >
                {bot.running ? "Running..." : "Start"}
              </Button>

              <div>PnL: {bot.pnl.toFixed(2)}</div>

            </CardContent>
          </Card>
        ))}
      </div>

      {/* LOGS */}
      <Card>
        <CardContent className="p-4">
          <div className="font-bold mb-2">Trade Logs</div>
          {logs.slice(0,10).map((l,i)=>(
            <div key={i}>
              {l.market} → {l.profit}
            </div>
          ))}
        </CardContent>
      </Card>

    </div>
  );
}
