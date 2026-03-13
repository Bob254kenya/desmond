import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2 } from 'lucide-react';

interface MarketAnalysis {
  symbol: string;
  mostAppearing: number;
  secondMost: number;
  leastAppearing: number;
  evenCount: number;
  oddCount: number;
  over3Count: number;
  under6Count: number;
  over8Count: number;
  under3Count: number;
}

interface BotState {
  id: string;
  name: string;
  type: 'over3' | 'under6' | 'even' | 'odd' | 'over1' | 'under8';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  contractType: string;
  barrier?: number;
  selectedMarket?: string;
  status: 'idle' | 'waiting' | 'trading' | 'cooldown';
  consecutiveLosses: number;
  entryTriggered: boolean;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  recoveryMode: boolean;
}

interface TradeLog {
  id: number;
  time: string;
  market: string;
  contract: string;
  stake: number;
  result: 'Pending' | 'Win' | 'Loss';
  pnl: number;
  bot: string;
  lastDigit?: number;
}

// ✅ Only relevant Deriv volatility markets
const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
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

// Market analysis
const analyzeMarket = (digits: number[]): MarketAnalysis => {
  if (digits.length < 700) return {} as MarketAnalysis;
  const last700 = digits.slice(-700);
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  return {
    symbol: '',
    mostAppearing: sortedDigits[0],
    secondMost: sortedDigits[1],
    leastAppearing: sortedDigits[9],
    evenCount: evenDigits.reduce((sum, d) => sum + counts[d], 0),
    oddCount: oddDigits.reduce((sum, d) => sum + counts[d], 0),
    over3Count: [4,5,6,7,8,9].reduce((sum,d)=>sum+counts[d],0),
    under6Count: [0,1,2,3,4,5].reduce((sum,d)=>sum+counts[d],0),
    over8Count: [9].reduce((sum,d)=>sum+counts[d],0),
    under3Count: [0,1,2].reduce((sum,d)=>sum+counts[d],0),
  };
};

// Entry conditions
const checkOver3Entry = (digits: number[]) => digits.slice(-2).every(d => d <= 3);
const checkUnder6Entry = (digits: number[]) => digits.slice(-2).every(d => d >= 6);
const checkOver1Entry = (digits: number[]) => digits.slice(-2).every(d => d <= 1);
const checkUnder8Entry = (digits: number[]) => digits.slice(-2).every(d => d >= 8);
const checkEvenEntry = (digits: number[]) => digits.slice(-3).every(d => d % 2 === 0);
const checkOddEntry = (digits: number[]) => digits.slice(-3).every(d => d % 2 === 1);

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [selectedMarket, setSelectedMarket] = useState<string>('R_100');
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});

  // ✅ Bots
  const [bots, setBots] = useState<BotState[]>([
    { id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 3, status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false },
    { id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 6, status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false },
    { id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITEVEN', status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false },
    { id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITODD', status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false },
    { id: 'bot5', name: 'OVER 1 BOT', type: 'over1', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITOVER', barrier: 1, status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false },
    { id: 'bot6', name: 'UNDER 8 BOT', type: 'under8', isRunning: false, isPaused: false, currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, contractType: 'DIGITUNDER', barrier: 8, status: 'idle', consecutiveLosses: 0, entryTriggered: false, cooldownRemaining: 0, recoveryMode: false },
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // ✅ Subscribe all markets digits
  useEffect(() => {
    const unsubscribers: (() => void)[] = [];
    VOLATILITY_MARKETS.forEach(symbol => {
      if (!marketDigitsRef.current[symbol]) marketDigitsRef.current[symbol] = [];
      const unsub = derivApi.subscribeTicks(symbol, (tick: any) => {
        const digit = Number(tick.quote.toString().slice(-1));
        const arr = marketDigitsRef.current[symbol];
        arr.push(digit);
        if (arr.length > 1000) arr.shift();
      });
      unsubscribers.push(unsub);
    });
    return () => unsubscribers.forEach(u => u());
  }, []);

  // ✅ Scan all markets automatically
  const scanMarket = useCallback(() => {
    if (isScanning) return;
    setIsScanning(true);
    try {
      const analysis: Record<string, MarketAnalysis> = {};
      for (const market of VOLATILITY_MARKETS) {
        const digits = marketDigitsRef.current[market] || [];
        if (digits.length >= 700) {
          const data = analyzeMarket(digits);
          data.symbol = market;
          analysis[market] = data;
        }
      }
      setMarketAnalysis(analysis);

      // Auto-select best markets per bot
      setBots(prev => prev.map(bot => {
        let bestMarket: string | undefined;
        let bestScore = 0;
        for (const [sym, data] of Object.entries(analysis)) {
          let score = 0;
          switch(bot.type) {
            case 'over3': score = data.over3Count; break;
            case 'under6': score = data.under6Count; break;
            case 'over1': score = data.over3Count; break;
            case 'under8': score = data.under6Count; break;
            case 'even': score = data.evenCount; break;
            case 'odd': score = data.oddCount; break;
          }
          if (score > bestScore) { bestScore = score; bestMarket = sym; }
        }
        return { ...bot, selectedMarket: bestMarket || bot.selectedMarket };
      }));

      toast.success('Market scan complete');
    } catch(e) {
      console.error(e);
      toast.error('Scan failed');
    } finally { setIsScanning(false); }
  }, [isScanning]);

  // ✅ Auto-scan every 3s
  useEffect(() => {
    const interval = setInterval(scanMarket, 3000);
    return () => clearInterval(interval);
  }, [scanMarket]);

  // --- Other bot run logic remains unchanged ---
  // Include your `runBot`, `startBot`, `pauseBot`, `stopBot` functions
  // They will now use the `selectedMarket` dynamically set by auto-scan

  return (
    <div className="space-y-4 p-4 bg-background min-h-screen">
      <div className="bg-card border rounded-xl p-4 flex justify-between items-center">
        <h1 className="font-bold text-xl">🤖 6-Bot Auto Trading</h1>
        <Button onClick={scanMarket} size="sm">
          {isScanning ? <Loader2 className="animate-spin w-4 h-4 mr-1"/> : <RefreshCw className="w-4 h-4 mr-1"/>} Scan
        </Button>
      </div>
      {/* You can reuse your bot cards and trade log JSX */}
    </div>
  );
}
