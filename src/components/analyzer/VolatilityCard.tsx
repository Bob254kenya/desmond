import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';

interface VolatilityCardProps {
  symbol: string;
  tickCount: number;
  mode: 'over' | 'under';
}

/**
 * Extracts last digit from a price using Deriv-standard method:
 * parseFloat → toFixed(2) → last character → parseInt
 * Digit 0 is ALWAYS valid.
 */
function extractDigit(price: number): number {
  const fixed = parseFloat(String(price)).toFixed(2);
  const d = parseInt(fixed.slice(-1), 10);
  if (Number.isNaN(d) || d < 0 || d > 9) return 0;
  return d;
}

export default function VolatilityCard({ symbol, tickCount, mode }: VolatilityCardProps) {
  const [digits, setDigits] = useState<number[]>([]);
  const [activeDigit, setActiveDigit] = useState(5);
  const [status, setStatus] = useState<'connecting' | 'live' | 'error' | 'offline'>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const digitsRef = useRef<number[]>([]);

  // Connect via raw WebSocket (same pattern as reference HTML)
  useEffect(() => {
    digitsRef.current = [];
    setDigits([]);
    setStatus('connecting');

    const ws = new WebSocket('wss://ws.binaryws.com/websockets/v3?app_id=1089');
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('live');
      ws.send(JSON.stringify({
        ticks_history: symbol,
        style: 'ticks',
        count: tickCount,
        end: 'latest',
        subscribe: 1,
      }));
    };

    ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);

      if (data.history) {
        const prices: number[] = data.history.prices || [];
        const extracted = prices.map(extractDigit);
        digitsRef.current = extracted;
        setDigits([...extracted]);
      }

      if (data.tick) {
        const price = parseFloat(data.tick.quote);
        const digit = extractDigit(price);
        if (digit >= 0 && digit <= 9) {
          if (digitsRef.current.length >= 4000) digitsRef.current.shift();
          digitsRef.current.push(digit);
          setDigits([...digitsRef.current]);
        }
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => setStatus('offline');

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [symbol, tickCount]);

  // Analysis computations
  const analysis = useMemo(() => {
    const recentTicks = digits.slice(-tickCount);
    const lastDigits = recentTicks.slice(-30);
    const threshold = activeDigit;
    const total = recentTicks.length || 1;

    // Frequency counts 0-9
    const counts = Array(10).fill(0);
    for (let i = 0; i <= recentTicks.length - 1; i++) {
      const d = recentTicks[i];
      if (d >= 0 && d <= 9) counts[d]++;
    }

    // Sorted for ranking
    const sorted = counts
      .map((c, d) => ({ digit: d, count: c }))
      .sort((a, b) => b.count - a.count);
    const most = sorted[0]?.digit ?? 0;
    const second = sorted[1]?.digit ?? 1;
    const least = sorted[sorted.length - 1]?.digit ?? 9;

    // Over/Under percentages
    let lowCount = 0;
    for (let i = 0; i < threshold; i++) lowCount += counts[i];
    let highCount = 0;
    for (let i = threshold + 1; i <= 9; i++) highCount += counts[i];
    const lowPercent = ((lowCount / total) * 100).toFixed(1);
    const highPercent = ((highCount / total) * 100).toFixed(1);

    // Strong signal detection
    let signalType: 'neutral' | 'over' | 'under' = 'neutral';
    let signalText = 'WAIT / NEUTRAL';
    if (most < threshold && second < threshold) {
      signalType = 'under';
      signalText = `SIGNAL: STRONG TRADE UNDER ${threshold}`;
    } else if (most > threshold && second > threshold) {
      signalType = 'over';
      signalText = `SIGNAL: STRONG TRADE OVER ${threshold}`;
    }

    // Entry triggers
    const winningDigits: number[] = [];
    const losingDigits: number[] = [];
    for (let i = 0; i < recentTicks.length - 1; i++) {
      if (recentTicks[i] === threshold) {
        const next = recentTicks[i + 1];
        if (mode === 'over') {
          if (next > threshold) { if (!winningDigits.includes(next)) winningDigits.push(next); }
          else { if (!losingDigits.includes(next)) losingDigits.push(next); }
        } else {
          if (next < threshold) { if (!winningDigits.includes(next)) winningDigits.push(next); }
          else { if (!losingDigits.includes(next)) losingDigits.push(next); }
        }
      }
    }

    return {
      lastDigits, counts, total, most, second, least,
      lowPercent, highPercent, signalType, signalText,
      winningDigits, losingDigits,
    };
  }, [digits, tickCount, activeDigit, mode]);

  const statusColor = status === 'live' ? 'text-profit' : status === 'error' ? 'text-loss' : 'text-muted-foreground';

  return (
    <div className="bg-card border border-border rounded-xl p-3 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-warning text-sm">{symbol}</h3>
        <span className={`text-[10px] font-mono ${statusColor}`}>
          {status === 'live' && '● '}
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>

      {/* Signal Box */}
      <div className={`rounded-lg p-2.5 text-center text-xs font-bold ${
        analysis.signalType === 'over' ? 'bg-profit/20 text-profit' :
        analysis.signalType === 'under' ? 'bg-loss/20 text-loss' :
        'bg-muted text-muted-foreground'
      }`}>
        {analysis.signalText}
      </div>

      {/* Last 30 digits stream */}
      <div className="grid grid-cols-10 gap-1">
        {analysis.lastDigits.map((d, i) => {
          let colorClass = 'bg-muted text-muted-foreground';
          if (d === activeDigit) {
            colorClass = 'bg-primary text-primary-foreground';
          } else if (d > activeDigit) {
            colorClass = 'bg-profit/30 text-profit';
          } else if (d < activeDigit) {
            colorClass = 'bg-loss/30 text-loss';
          }
          return (
            <div
              key={`${i}-${d}`}
              className={`w-full aspect-square flex items-center justify-center rounded-full text-[11px] font-mono font-bold ${colorClass}`}
            >
              {d}
            </div>
          );
        })}
      </div>

      {/* Digit buttons with frequency % */}
      <div className="grid grid-cols-5 gap-1">
        {Array.from({ length: 10 }, (_, i) => {
          const pct = analysis.total > 0 ? ((analysis.counts[i] / analysis.total) * 100).toFixed(1) : '0.0';
          let btnStyle = 'bg-muted text-foreground';
          if (i === analysis.most) btnStyle = 'bg-profit text-profit-foreground';
          else if (i === analysis.second) btnStyle = 'bg-primary text-primary-foreground';
          else if (i === analysis.least) btnStyle = 'bg-loss text-loss-foreground';

          return (
            <button
              key={i}
              onClick={() => setActiveDigit(i)}
              className={`rounded-lg py-1.5 text-[10px] font-mono font-bold transition-all ${btnStyle} ${
                i === activeDigit ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''
              }`}
            >
              {i} ({pct}%)
            </button>
          );
        })}
      </div>

      {/* Over/Under % */}
      <div className="flex justify-between text-[11px] font-mono bg-muted rounded-lg px-3 py-2">
        <span className="text-loss">Under {activeDigit}: {analysis.lowPercent}%</span>
        <span className="text-profit">Over {activeDigit}: {analysis.highPercent}%</span>
      </div>

      {/* Entry triggers */}
      <div className="bg-muted/50 rounded-lg p-2.5 text-[11px] space-y-1">
        <div>
          {analysis.winningDigits.length > 0
            ? <span className="text-profit">✅ Winning: [{analysis.winningDigits.join(', ')}]</span>
            : <span className="text-muted-foreground">No winning digits yet</span>
          }
        </div>
        <div>
          {analysis.losingDigits.length > 0
            ? <span className="text-loss">❌ Losing: [{analysis.losingDigits.join(', ')}]</span>
            : <span className="text-muted-foreground">No losing digits yet</span>
          }
        </div>
      </div>
    </div>
  );
}
