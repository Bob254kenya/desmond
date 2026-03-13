import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, AlertCircle, ArrowRight, Zap } from 'lucide-react';

interface DigitAnalysis {
  counts: Record<number, number>;
  percentages: Record<number, number>;
  mostAppearing: number;
  secondLeast: number;
  evenPercentage: number;
  oddPercentage: number;
  over3Percentage: number;
  under6Percentage: number;
  lastThreeTicks: number[];
  lastThreeIdentical: boolean;
  signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'NONE';
  confidence: number;
}

interface MarketData {
  symbol: string;
  digits: number[];
  analysis: DigitAnalysis;
  lastUpdate: number;
}

interface BotState {
  id: string;
  name: string;
  type: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6';
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  currentMarket: string;
  status: 'idle' | 'analyzing' | 'waiting_entry' | 'trading' | 'cooldown' | 'switching_market';
  consecutiveLosses: number;
  cooldownRemaining: number;
  lastTradeResult?: 'win' | 'loss';
  marketSwitchCount: number;
  lastSignal?: string;
  signalStrength: number;
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
  signalType?: string;
  marketSwitch?: string;
}

const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'RDBEAR', 'RDBULL', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
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

// Advanced digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < 700) {
    return {
      counts: {},
      percentages: {},
      mostAppearing: -1,
      secondLeast: -1,
      evenPercentage: 0,
      oddPercentage: 0,
      over3Percentage: 0,
      under6Percentage: 0,
      lastThreeTicks: [],
      lastThreeIdentical: false,
      signal: 'NONE',
      confidence: 0
    };
  }

  const last700 = digits.slice(-700);
  const lastThree = digits.slice(-3);
  const lastThreeIdentical = lastThree.length === 3 && lastThree.every(d => d === lastThree[0]);
  
  // Count frequencies
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  last700.forEach(d => counts[d]++);
  
  // Calculate percentages
  const percentages: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) {
    percentages[i] = (counts[i] / 700) * 100;
  }
  
  // Sort digits
  const sortedByCount = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
  const sortedByLeast = [...Array(10).keys()].sort((a, b) => counts[a] - counts[b]);
  
  const mostAppearing = sortedByCount[0];
  const secondLeast = sortedByLeast[1]; // Second least appearing digit
  
  // Calculate group percentages
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const over3Digits = [4,5,6,7,8,9];
  const under6Digits = [0,1,2,3,4,5];
  
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  const over3Count = over3Digits.reduce((sum, d) => sum + counts[d], 0);
  const under6Count = under6Digits.reduce((sum, d) => sum + counts[d], 0);
  
  const evenPercentage = (evenCount / 700) * 100;
  const oddPercentage = (oddCount / 700) * 100;
  const over3Percentage = (over3Count / 700) * 100;
  const under6Percentage = (under6Count / 700) * 100;
  
  // Check last three pattern
  const lastThreeOver3 = lastThree.filter(d => d > 3).length >= 2;
  const lastThreeUnder6 = lastThree.filter(d => d < 6).length >= 2;
  const lastThreeEven = lastThree.filter(d => d % 2 === 0).length >= 2;
  const lastThreeOdd = lastThree.filter(d => d % 2 === 1).length >= 2;
  
  // Determine signal based on strict conditions
  let signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'NONE' = 'NONE';
  let confidence = 0;
  
  // Check EVEN conditions
  if (
    evenPercentage >= 58 &&
    oddPercentage <= 42 &&
    mostAppearing % 2 === 0 &&
    lastThreeEven &&
    secondLeast % 2 === 1 &&
    Math.abs(evenPercentage - 50) > 5 // Safety rule: not between 45-55
  ) {
    signal = 'EVEN';
    confidence = evenPercentage;
  }
  // Check ODD conditions
  else if (
    oddPercentage >= 58 &&
    evenPercentage <= 42 &&
    mostAppearing % 2 === 1 &&
    lastThreeOdd &&
    secondLeast % 2 === 0 &&
    Math.abs(oddPercentage - 50) > 5
  ) {
    signal = 'ODD';
    confidence = oddPercentage;
  }
  // Check OVER 3 conditions
  else if (
    over3Percentage >= 60 &&
    mostAppearing > 3 &&
    lastThreeOver3 &&
    secondLeast < 4 &&
    Math.abs(over3Percentage - 50) > 5
  ) {
    signal = 'OVER_3';
    confidence = over3Percentage;
  }
  // Check UNDER 6 conditions
  else if (
    under6Percentage >= 60 &&
    mostAppearing < 6 &&
    lastThreeUnder6 &&
    secondLeast > 5 &&
    Math.abs(under6Percentage - 50) > 5
  ) {
    signal = 'UNDER_6';
    confidence = under6Percentage;
  }
  
  return {
    counts,
    percentages,
    mostAppearing,
    secondLeast,
    evenPercentage,
    oddPercentage,
    over3Percentage,
    under6Percentage,
    lastThreeTicks: lastThree,
    lastThreeIdentical,
    signal,
    confidence
  };
};

// Find best market for each bot type
const findBestMarketForBot = (
  marketsData: Record<string, MarketData>,
  botType: string
): { market: string; analysis: DigitAnalysis } | null => {
  let bestMarket: string | null = null;
  let bestAnalysis: DigitAnalysis | null = null;
  let highestConfidence = 0;
  
  for (const [symbol, data] of Object.entries(marketsData)) {
    if (data.analysis.signal === botType && data.analysis.confidence > highestConfidence) {
      highestConfidence = data.analysis.confidence;
      bestMarket = symbol;
      bestAnalysis = data.analysis;
    }
  }
  
  return bestMarket && bestAnalysis ? { market: bestMarket, analysis: bestAnalysis } : null;
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [marketsData, setMarketsData] = useState<Record<string, MarketData>>({});
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [globalStake, setGlobalStake] = useState<number>(0.5);
  const [globalMultiplier, setGlobalMultiplier] = useState<number>(2);
  const [globalStopLoss, setGlobalStopLoss] = useState<number>(30);
  const [globalTakeProfit, setGlobalTakeProfit] = useState<number>(5);
  const [lastScanTime, setLastScanTime] = useState<Date | null>(null);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize bots
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'EVEN BOT', type: 'EVEN', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot2', name: 'ODD BOT', type: 'ODD', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot3', name: 'OVER 3 BOT', type: 'OVER_3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    },
    { 
      id: 'bot4', name: 'UNDER 6 BOT', type: 'UNDER_6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0
    }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Load ticks for all markets
  useEffect(() => {
    // This would need to be implemented to actually fetch ticks for all markets
    // For now, we'll simulate with the current market's data
    if (digits.length > 0) {
      VOLATILITY_MARKETS.forEach(market => {
        if (!marketDigitsRef.current[market]) {
          marketDigitsRef.current[market] = [];
        }
      });
      marketDigitsRef.current[selectedMarket] = digits;
    }
  }, [digits, selectedMarket]);

  // Continuous analysis every 10 seconds
  useEffect(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    
    analysisIntervalRef.current = setInterval(() => {
      analyzeAllMarkets();
    }, 10000); // Analyze every 10 seconds
    
    return () => {
      if (analysisIntervalRef.current) {
        clearInterval(analysisIntervalRef.current);
      }
    };
  }, []);

  // Analyze all markets
  const analyzeAllMarkets = useCallback(() => {
    setIsAnalyzing(true);
    
    const newMarketsData: Record<string, MarketData> = {};
    
    for (const market of VOLATILITY_MARKETS) {
      const marketDigits = marketDigitsRef.current[market] || [];
      if (marketDigits.length >= 700) {
        const analysis = analyzeDigits(marketDigits);
        newMarketsData[market] = {
          symbol: market,
          digits: marketDigits.slice(-700),
          analysis,
          lastUpdate: Date.now()
        };
      }
    }
    
    setMarketsData(newMarketsData);
    setLastScanTime(new Date());
    
    // Auto-switch bots to best markets
    setBots(prev => prev.map(bot => {
      const bestMarket = findBestMarketForBot(newMarketsData, bot.type);
      if (bestMarket && bestMarket.market !== bot.currentMarket) {
        return {
          ...bot,
          currentMarket: bestMarket.market,
          marketSwitchCount: bot.marketSwitchCount + 1,
          lastSignal: bestMarket.analysis.signal,
          signalStrength: bestMarket.analysis.confidence
        };
      }
      return bot;
    }));
    
    setIsAnalyzing(false);
  }, []);

  // Get contract type from bot type
  const getContractDetails = (botType: string): { contract: string; barrier?: number } => {
    switch(botType) {
      case 'EVEN': return { contract: 'DIGITEVEN' };
      case 'ODD': return { contract: 'DIGITODD' };
      case 'OVER_3': return { contract: 'DIGITOVER', barrier: 3 };
      case 'UNDER_6': return { contract: 'DIGITUNDER', barrier: 6 };
      default: return { contract: 'DIGITEVEN' };
    }
  };

  // Trading loop
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !isAuthorized) return;

    if (balance < globalStake) {
      toast.error(`Insufficient balance for ${bot.name}`);
      stopBot(botId);
      return;
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: globalStake,
      status: 'analyzing'
    } : b));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = globalStake;
    let totalPnl = bot.totalPnl;
    let tradeCount = bot.trades;
    let wins = bot.wins;
    let losses = bot.losses;
    let consecutiveLosses = 0;
    let cooldownRemaining = 0;
    let currentMarket = bot.currentMarket;
    let marketSwitchCount = bot.marketSwitchCount;

    while (botRunningRefs.current[botId]) {
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Check stop loss / take profit
      if (totalPnl <= -globalStopLoss) {
        toast.error(`${bot.name}: Stop Loss! $${totalPnl.toFixed(2)}`);
        break;
      }
      if (totalPnl >= globalTakeProfit) {
        toast.success(`${bot.name}: Take Profit! +$${totalPnl.toFixed(2)}`);
        break;
      }

      // Handle cooldown (3 ticks after trade)
      if (cooldownRemaining > 0) {
        setBots(prev => prev.map(b => b.id === botId ? { 
          ...b, 
          status: 'cooldown',
          cooldownRemaining 
        } : b));
        await new Promise(r => setTimeout(r, 1000)); // 1 second per tick
        cooldownRemaining--;
        continue;
      }

      // Get current market analysis
      const marketData = marketsData[currentMarket];
      if (!marketData) {
        // Try to find another market with signal
        const bestMarket = findBestMarketForBot(marketsData, bot.type);
        if (bestMarket) {
          currentMarket = bestMarket.market;
          marketSwitchCount++;
          setBots(prev => prev.map(b => b.id === botId ? { 
            ...b, 
            currentMarket,
            marketSwitchCount,
            status: 'switching_market'
          } : b));
          toast.info(`${bot.name} switched to ${currentMarket}`);
        }
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      const analysis = marketData.analysis;
      const lastDigit = marketData.digits.length > 0 ? marketData.digits[marketData.digits.length - 1] : undefined;

      // Update signal info
      setBots(prev => prev.map(b => b.id === botId ? { 
        ...b, 
        lastSignal: analysis.signal,
        signalStrength: analysis.confidence,
        status: analysis.signal === bot.type ? 'waiting_entry' : 'analyzing'
      } : b));

      // Check if current market has signal for this bot type
      if (analysis.signal !== bot.type) {
        // Look for better market
        const bestMarket = findBestMarketForBot(marketsData, bot.type);
        if (bestMarket && bestMarket.market !== currentMarket) {
          currentMarket = bestMarket.market;
          marketSwitchCount++;
          toast.info(`${bot.name} found better signal in ${currentMarket}`);
        }
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // Check last three identical rule
      if (analysis.lastThreeIdentical) {
        toast.warning(`${bot.name}: Last 3 identical, waiting 5 ticks`);
        cooldownRemaining = 5;
        continue;
      }

      // Check if signal is strong enough
      if (analysis.confidence < 58) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading' } : b));

      try {
        await waitForNextTick(currentMarket);

        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        const { contract, barrier } = getContractDetails(bot.type);
        
        const params: any = {
          contract_type: contract,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        if (barrier !== undefined) {
          params.barrier = barrier.toString();
        }

        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          lastDigit,
          signalType: analysis.signal
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));

        totalPnl += pnl;
        tradeCount++;
        
        if (won) {
          wins++;
          consecutiveLosses = 0;
          stake = globalStake; // Reset stake after win
        } else {
          losses++;
          consecutiveLosses++;
          // Martingale on loss
          stake = Math.round(stake * globalMultiplier * 100) / 100;
        }

        // After trade, wait 3 ticks before next trade
        cooldownRemaining = 3;

        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: tradeCount,
              wins,
              losses,
              currentStake: stake,
              consecutiveLosses,
              status: 'cooldown',
              cooldownRemaining,
              lastTradeResult: won ? 'win' : 'loss',
              currentMarket,
              marketSwitchCount
            };
          }
          return b;
        }));

        setActiveTradeId(null);

      } catch (err: any) {
        setActiveTradeId(null);
        if (err.message?.includes('Insufficient balance')) {
          toast.error(`Insufficient balance for ${bot.name}`);
          break;
        } else {
          console.error(`Trade error:`, err);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0
    } : b));
    
    botRunningRefs.current[botId] = false;
  }, [isAuthorized, balance, globalStake, globalMultiplier, globalStopLoss, globalTakeProfit, activeTradeId, bots, marketsData]);

  // Bot controls
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    setTimeout(() => runBot(botId), 0);
  };

  const pauseBot = (botId: string) => {
    botPausedRefs.current[botId] = !botPausedRefs.current[botId];
    setBots(prev => prev.map(b => b.id === botId ? { ...b, isPaused: botPausedRefs.current[botId] } : b));
  };

  const stopBot = (botId: string) => {
    botRunningRefs.current[botId] = false;
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0
    } : b));
  };

  const stopAllBots = () => {
    bots.forEach(bot => {
      botRunningRefs.current[bot.id] = false;
    });
    setBots(prev => prev.map(b => ({ 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'idle',
      cooldownRemaining: 0
    })));
  };

  // Clear all data
  const clearAll = () => {
    setTrades([]);
    setBots(prev => prev.map(bot => ({
      ...bot,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      currentStake: globalStake,
      status: 'idle',
      consecutiveLosses: 0,
      cooldownRemaining: 0,
      marketSwitchCount: 0,
      lastSignal: undefined,
      signalStrength: 0
    })));
    tradeIdRef.current = 0;
    toast.success('All data cleared');
  };

  // Manual analysis trigger
  const runAnalysis = () => {
    analyzeAllMarkets();
    toast.info('Market analysis triggered');
  };

  // Get market display
  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `⚡ ${market}`;
    if (market.startsWith('R_')) return `📊 ${market}`;
    if (market.includes('BOOM')) return `💥 ${market}`;
    if (market.includes('CRASH')) return `📉 ${market}`;
    if (market.includes('RDBEAR')) return `🐻 ${market}`;
    if (market.includes('RDBULL')) return `🐂 ${market}`;
    if (market.includes('JD')) return `🦘 ${market}`;
    return market;
  };

  // Calculate totals
  const totalProfit = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? ((totalWins / totalTrades) * 100).toFixed(1) : '0';

  // Get status color
  const getStatusColor = (status: string) => {
    switch(status) {
      case 'trading': return 'text-green-400';
      case 'waiting_entry': return 'text-yellow-400';
      case 'analyzing': return 'text-blue-400';
      case 'cooldown': return 'text-purple-400';
      case 'switching_market': return 'text-pink-400';
      default: return 'text-gray-400';
    }
  };

  const getStatusIcon = (status: string) => {
    switch(status) {
      case 'trading': return '📈';
      case 'waiting_entry': return '⏳';
      case 'analyzing': return '🔍';
      case 'cooldown': return '⏱️';
      case 'switching_market': return '🔄';
      default: return '⚫';
    }
  };

  return (
    <div className="space-y-4 p-4 bg-background min-h-screen">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold">🤖 Advanced Signal-Based Trading System</h1>
            <p className="text-xs text-muted-foreground">
              Auto-market switching • 700-tick analysis • Strict signal conditions
              {lastScanTime && ` • Last scan: ${lastScanTime.toLocaleTimeString()}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={runAnalysis}
              disabled={isAnalyzing}
            >
              {isAnalyzing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Zap className="w-4 h-4 mr-1" />}
              Analyze Now
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={clearAll}
            >
              <Trash2 className="w-4 h-4 mr-1" /> Clear
            </Button>
            <Button variant="destructive" size="sm" onClick={stopAllBots} disabled={!bots.some(b => b.isRunning)}>
              <StopCircle className="w-4 h-4 mr-1" /> Stop All
            </Button>
          </div>
        </div>

        {/* Global Stats */}
        <div className="grid grid-cols-5 gap-3 text-sm mb-3">
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Balance</div>
            <div className="font-bold text-lg">${balance?.toFixed(2) || '0.00'}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Total P&L</div>
            <div className={`font-bold text-lg ${totalProfit >= 0 ? 'text-profit' : 'text-loss'}`}>
              ${totalProfit.toFixed(2)}
            </div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Win Rate</div>
            <div className="font-bold text-lg">{winRate}%</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Total Trades</div>
            <div className="font-bold text-lg">{totalTrades}</div>
          </div>
          <div className="bg-muted/30 rounded-lg p-2">
            <div className="text-muted-foreground text-xs">Active</div>
            <div className="font-bold text-lg">{bots.filter(b => b.isRunning).length}/4</div>
          </div>
        </div>

        {/* Settings */}
        <div className="grid grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Stake ($)</label>
            <input 
              type="number" 
              value={globalStake} 
              onChange={(e) => setGlobalStake(parseFloat(e.target.value) || 0.5)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              step="0.1"
              min="0.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Multiplier</label>
            <input 
              type="number" 
              value={globalMultiplier} 
              onChange={(e) => setGlobalMultiplier(parseFloat(e.target.value) || 2)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
              step="0.1"
              min="1.1"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Stop Loss ($)</label>
            <input 
              type="number" 
              value={globalStopLoss} 
              onChange={(e) => setGlobalStopLoss(parseFloat(e.target.value) || 30)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Take Profit ($)</label>
            <input 
              type="number" 
              value={globalTakeProfit} 
              onChange={(e) => setGlobalTakeProfit(parseFloat(e.target.value) || 5)}
              className="w-full bg-background border border-border rounded-lg px-2 py-1 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Bots Grid */}
      <div className="grid grid-cols-2 gap-3">
        {bots.map((bot) => {
          const marketData = marketsData[bot.currentMarket];
          
          return (
            <motion.div
              key={bot.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`bg-card border rounded-xl p-3 ${
                bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className={`p-1.5 rounded-lg ${
                    bot.type === 'EVEN' ? 'bg-green-500/20 text-green-400' :
                    bot.type === 'ODD' ? 'bg-purple-500/20 text-purple-400' :
                    bot.type === 'OVER_3' ? 'bg-blue-500/20 text-blue-400' :
                    'bg-orange-500/20 text-orange-400'
                  }`}>
                    {bot.type === 'EVEN' || bot.type === 'ODD' ? 
                      <CircleDot className="w-4 h-4" /> : 
                      bot.type === 'OVER_3' ? <TrendingUp className="w-4 h-4" /> : 
                      <TrendingDown className="w-4 h-4" />}
                  </div>
                  <div>
                    <h4 className="font-bold text-sm">{bot.name}</h4>
                    <p className="text-[9px] text-muted-foreground">
                      Switches: {bot.marketSwitchCount} times
                    </p>
                  </div>
                </div>
                <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                  {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                </Badge>
              </div>

              {/* Current Market & Signal */}
              <div className="bg-muted/30 rounded-lg p-2 mb-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground">Market:</span>
                  <span className="font-mono font-bold">
                    {getMarketDisplay(bot.currentMarket)}
                  </span>
                </div>
                {marketData && (
                  <>
                    <div className="flex justify-between text-[10px] mt-1">
                      <span>Signal:</span>
                      <span className={marketData.analysis.signal === bot.type ? 'text-profit font-bold' : 'text-muted-foreground'}>
                        {marketData.analysis.signal || 'NONE'}
                      </span>
                      <span>Strength:</span>
                      <span className={marketData.analysis.confidence >= 58 ? 'text-profit' : 'text-muted-foreground'}>
                        {marketData.analysis.confidence.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between text-[8px] mt-1">
                      <span>Most: {marketData.analysis.mostAppearing}</span>
                      <span>2nd Least: {marketData.analysis.secondLeast}</span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span>Even: {marketData.analysis.evenPercentage.toFixed(1)}%</span>
                      <span>Odd: {marketData.analysis.oddPercentage.toFixed(1)}%</span>
                    </div>
                    <div className="flex justify-between text-[8px]">
                      <span>Over 3: {marketData.analysis.over3Percentage.toFixed(1)}%</span>
                      <span>Under 6: {marketData.analysis.under6Percentage.toFixed(1)}%</span>
                    </div>
                    <div className="text-[8px] mt-1">
                      Last 3: {marketData.analysis.lastThreeTicks.join(', ')}
                      {marketData.analysis.lastThreeIdentical && ' ⚠️ Identical'}
                    </div>
                  </>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-1 text-[10px] mb-2">
                <div>
                  <span className="text-muted-foreground">P&L:</span>
                  <span className={`ml-1 font-mono ${
                    bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                  }`}>
                    ${bot.totalPnl.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground">W:</span>
                  <span className="ml-1 font-mono text-profit">{bot.wins}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">L:</span>
                  <span className="ml-1 font-mono text-loss">{bot.losses}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Stake:</span>
                  <span className="ml-1 font-mono">${bot.currentStake.toFixed(2)}</span>
                </div>
              </div>

              {/* Status */}
              <div className="flex items-center justify-between text-[10px] mb-2">
                <span className="text-muted-foreground">Status:</span>
                <span className={`font-mono ${getStatusColor(bot.status)}`}>
                  {getStatusIcon(bot.status)} {
                    bot.status === 'trading' ? 'Trading' :
                    bot.status === 'waiting_entry' ? 'Waiting Signal' :
                    bot.status === 'analyzing' ? 'Analyzing' :
                    bot.status === 'cooldown' ? `Cooldown ${bot.cooldownRemaining}` :
                    bot.status === 'switching_market' ? 'Switching Market' :
                    'Idle'
                  }
                </span>
                {bot.cooldownRemaining > 0 && (
                  <span className="text-purple-400">⏱️ {bot.cooldownRemaining}/3</span>
                )}
              </div>

              {/* Controls */}
              <div className="flex gap-1">
                {!bot.isRunning ? (
                  <Button
                    onClick={() => startBot(bot.id)}
                    disabled={!isAuthorized || balance < globalStake || activeTradeId !== null}
                    size="sm"
                    className="flex-1 h-7 text-xs"
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
          );
        })}
      </div>

      {/* Market Signals Dashboard */}
      <div className="bg-card border border-border rounded-xl p-3">
        <h3 className="text-sm font-semibold mb-2">📊 Live Market Signals</h3>
        <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
          {Object.entries(marketsData).length > 0 ? (
            Object.entries(marketsData).map(([symbol, data]) => (
              <div key={symbol} className="bg-muted/30 rounded p-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="font-bold">{getMarketDisplay(symbol)}</span>
                  <Badge className={`text-[8px] ${
                    data.analysis.signal === 'EVEN' ? 'bg-green-500' :
                    data.analysis.signal === 'ODD' ? 'bg-purple-500' :
                    data.analysis.signal === 'OVER_3' ? 'bg-blue-500' :
                    data.analysis.signal === 'UNDER_6' ? 'bg-orange-500' :
                    'bg-gray-500'
                  }`}>
                    {data.analysis.signal || 'NO SIGNAL'}
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-1 mt-1 text-[8px]">
                  <div>Even: {data.analysis.evenPercentage.toFixed(1)}%</div>
                  <div>Odd: {data.analysis.oddPercentage.toFixed(1)}%</div>
                  <div>Over 3: {data.analysis.over3Percentage.toFixed(1)}%</div>
                  <div>Under 6: {data.analysis.under6Percentage.toFixed(1)}%</div>
                  <div>Most: {data.analysis.mostAppearing}</div>
                  <div>2nd Least: {data.analysis.secondLeast}</div>
                  <div colSpan={2}>Last 3: {data.analysis.lastThreeTicks.join(', ')}</div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground col-span-2 text-center py-2">No market data yet. Click Analyze Now.</p>
          )}
        </div>
      </div>

      {/* Trade Log */}
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
                  <Badge variant="outline" className="text-[8px] px-1 py-0">{trade.bot}</Badge>
                  <span className="font-mono text-[10px]">
                    {trade.market.includes('1HZ') ? '⚡' : 
                     trade.market.includes('BOOM') ? '💥' :
                     trade.market.includes('CRASH') ? '📉' :
                     trade.market.includes('RDBEAR') ? '🐻' :
                     trade.market.includes('RDBULL') ? '🐂' :
                     trade.market.includes('JD') ? '🦘' : '📊'} {trade.market}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {trade.signalType && (
                    <Badge className="text-[7px] px-1 py-0 bg-opacity-50">
                      {trade.signalType}
                    </Badge>
                  )}
                  <span className="font-mono text-[10px]">
                    Last: {trade.lastDigit !== undefined ? trade.lastDigit : '—'}
                  </span>
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
    </div>
  );
}
