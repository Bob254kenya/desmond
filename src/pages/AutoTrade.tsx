import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, Zap } from 'lucide-react';

interface DigitAnalysis {
  counts: Record<number, number>;
  percentages: Record<number, number>;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  secondLeast: number;
  evenPercentage: number;
  oddPercentage: number;
  over3Percentage: number;
  under6Percentage: number;
  over5Percentage: number;
  under5Percentage: number;
  over7Percentage: number;
  under7Percentage: number;
  lastTwelveTicks: number[];
  lastThreeTicks: number[];
  lastThreeIdentical: boolean;
  signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_7' | 'NONE';
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
  type: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_7';
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
  selectedDigit?: number;
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
}

const VOLATILITY_MARKETS = [
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  'RDBEAR', 'RDBULL', 'JD10', 'JD25', 'JD50', 'JD75', 'JD100'
];

// Simulated tick data for development (remove in production)
const generateMockTicks = (market: string, count: number): number[] => {
  const ticks: number[] = [];
  for (let i = 0; i < count; i++) {
    ticks.push(Math.floor(Math.random() * 10));
  }
  return ticks;
};

// Advanced digit analysis function
const analyzeDigits = (digits: number[]): DigitAnalysis => {
  if (digits.length < 100) {
    return {
      counts: {},
      percentages: {},
      mostAppearing: -1,
      secondMost: -1,
      thirdMost: -1,
      leastAppearing: -1,
      secondLeast: -1,
      evenPercentage: 0,
      oddPercentage: 0,
      over3Percentage: 0,
      under6Percentage: 0,
      over5Percentage: 0,
      under5Percentage: 0,
      over7Percentage: 0,
      under7Percentage: 0,
      lastTwelveTicks: [],
      lastThreeTicks: [],
      lastThreeIdentical: false,
      signal: 'NONE',
      confidence: 0
    };
  }

  const last700 = digits.slice(-700);
  const lastTwelve = digits.slice(-12);
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
  const secondMost = sortedByCount[1];
  const thirdMost = sortedByCount[2];
  const leastAppearing = sortedByCount[9];
  const secondLeast = sortedByLeast[1];
  
  // Calculate group percentages
  const evenDigits = [0,2,4,6,8];
  const oddDigits = [1,3,5,7,9];
  const over3Digits = [4,5,6,7,8,9];
  const under6Digits = [0,1,2,3,4,5];
  const over5Digits = [6,7,8,9];
  const under5Digits = [0,1,2,3,4];
  const over7Digits = [8,9];
  const under7Digits = [0,1,2,3,4,5,6];
  
  const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
  const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
  const over3Count = over3Digits.reduce((sum, d) => sum + counts[d], 0);
  const under6Count = under6Digits.reduce((sum, d) => sum + counts[d], 0);
  const over5Count = over5Digits.reduce((sum, d) => sum + counts[d], 0);
  const under5Count = under5Digits.reduce((sum, d) => sum + counts[d], 0);
  const over7Count = over7Digits.reduce((sum, d) => sum + counts[d], 0);
  const under7Count = under7Digits.reduce((sum, d) => sum + counts[d], 0);
  
  const evenPercentage = (evenCount / 700) * 100;
  const oddPercentage = (oddCount / 700) * 100;
  const over3Percentage = (over3Count / 700) * 100;
  const under6Percentage = (under6Count / 700) * 100;
  const over5Percentage = (over5Count / 700) * 100;
  const under5Percentage = (under5Count / 700) * 100;
  const over7Percentage = (over7Count / 700) * 100;
  const under7Percentage = (under7Count / 700) * 100;
  
  // Check last three pattern
  const lastThreeOver3 = lastThree.filter(d => d > 3).length >= 2;
  const lastThreeUnder6 = lastThree.filter(d => d < 6).length >= 2;
  const lastThreeOver5 = lastThree.filter(d => d > 5).length >= 2;
  const lastThreeUnder5 = lastThree.filter(d => d < 5).length >= 2;
  const lastThreeOver7 = lastThree.filter(d => d > 7).length >= 2;
  const lastThreeUnder7 = lastThree.filter(d => d < 7).length >= 2;
  const lastThreeEven = lastThree.filter(d => d % 2 === 0).length >= 2;
  const lastThreeOdd = lastThree.filter(d => d % 2 === 1).length >= 2;
  
  // Determine signal based on conditions
  let signal: 'EVEN' | 'ODD' | 'OVER_3' | 'UNDER_6' | 'OVER_5' | 'UNDER_5' | 'OVER_7' | 'UNDER_7' | 'NONE' = 'NONE';
  let confidence = 0;
  
  if (evenPercentage >= 58 && oddPercentage <= 42 && mostAppearing % 2 === 0 && lastThreeEven) {
    signal = 'EVEN';
    confidence = evenPercentage;
  }
  else if (oddPercentage >= 58 && evenPercentage <= 42 && mostAppearing % 2 === 1 && lastThreeOdd) {
    signal = 'ODD';
    confidence = oddPercentage;
  }
  else if (over3Percentage >= 60 && mostAppearing > 3 && lastThreeOver3) {
    signal = 'OVER_3';
    confidence = over3Percentage;
  }
  else if (under6Percentage >= 60 && mostAppearing < 6 && lastThreeUnder6) {
    signal = 'UNDER_6';
    confidence = under6Percentage;
  }
  else if (over5Percentage >= 60 && mostAppearing > 5 && lastThreeOver5) {
    signal = 'OVER_5';
    confidence = over5Percentage;
  }
  else if (under5Percentage >= 60 && mostAppearing < 5 && lastThreeUnder5) {
    signal = 'UNDER_5';
    confidence = under5Percentage;
  }
  else if (over7Percentage >= 60 && mostAppearing > 7 && lastThreeOver7) {
    signal = 'OVER_7';
    confidence = over7Percentage;
  }
  else if (under7Percentage >= 60 && mostAppearing < 7 && lastThreeUnder7) {
    signal = 'UNDER_7';
    confidence = under7Percentage;
  }
  
  return {
    counts,
    percentages,
    mostAppearing,
    secondMost,
    thirdMost,
    leastAppearing,
    secondLeast,
    evenPercentage,
    oddPercentage,
    over3Percentage,
    under6Percentage,
    over5Percentage,
    under5Percentage,
    over7Percentage,
    under7Percentage,
    lastTwelveTicks: lastTwelve,
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
  const [selectedDigit, setSelectedDigit] = useState<number>(5);
  const [showDigitAnalysis, setShowDigitAnalysis] = useState<boolean>(false);
  
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const tradeIdRef = useRef(0);
  const marketDigitsRef = useRef<Record<string, number[]>>({});
  const analysisIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize bots with more types
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
    },
    { 
      id: 'bot5', name: 'OVER 5 BOT', type: 'OVER_5', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 5
    },
    { 
      id: 'bot6', name: 'UNDER 5 BOT', type: 'UNDER_5', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 5
    },
    { 
      id: 'bot7', name: 'OVER 7 BOT', type: 'OVER_7', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 7
    },
    { 
      id: 'bot8', name: 'UNDER 7 BOT', type: 'UNDER_7', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, wins: 0, losses: 0, 
      currentMarket: 'R_100', status: 'idle', consecutiveLosses: 0, 
      cooldownRemaining: 0, marketSwitchCount: 0, signalStrength: 0,
      selectedDigit: 7
    }
  ]);

  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});

  // Initialize with mock data for development
  useEffect(() => {
    // Generate mock data for all markets
    VOLATILITY_MARKETS.forEach(market => {
      if (!marketDigitsRef.current[market]) {
        marketDigitsRef.current[market] = generateMockTicks(market, 1000);
      }
    });
    
    // Initial analysis
    analyzeAllMarkets();
  }, []);

  // Continuous analysis every 30 seconds
  useEffect(() => {
    if (analysisIntervalRef.current) {
      clearInterval(analysisIntervalRef.current);
    }
    
    analysisIntervalRef.current = setInterval(() => {
      analyzeAllMarkets();
    }, 30000);
    
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
      if (marketDigits.length >= 100) {
        const analysis = analyzeDigits(marketDigits);
        newMarketsData[market] = {
          symbol: market,
          digits: marketDigits.slice(-100),
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
  const getContractDetails = (botType: string, selectedDigit?: number): { contract: string; barrier?: number } => {
    switch(botType) {
      case 'EVEN': return { contract: 'DIGITEVEN' };
      case 'ODD': return { contract: 'DIGITODD' };
      case 'OVER_3': return { contract: 'DIGITOVER', barrier: 3 };
      case 'UNDER_6': return { contract: 'DIGITUNDER', barrier: 6 };
      case 'OVER_5': return { contract: 'DIGITOVER', barrier: selectedDigit || 5 };
      case 'UNDER_5': return { contract: 'DIGITUNDER', barrier: selectedDigit || 5 };
      case 'OVER_7': return { contract: 'DIGITOVER', barrier: selectedDigit || 7 };
      case 'UNDER_7': return { contract: 'DIGITUNDER', barrier: selectedDigit || 7 };
      default: return { contract: 'DIGITEVEN' };
    }
  };

  // Trading loop (simplified for demo)
  const runBot = useCallback(async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot) return;

    toast.info(`${bot.name} started (demo mode - no real trades)`);
    
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      status: 'analyzing'
    } : b));
    
    botRunningRefs.current[botId] = true;
  }, []);

  // Bot controls
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    runBot(botId);
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
      status: 'idle'
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
      status: 'idle'
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
              Auto-market switching • 700-tick analysis • 8 Bots
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
              {isAnalyzing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
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
            <div className="font-bold text-lg">${balance?.toFixed(2) || '10000.00'}</div>
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
            <div className="font-bold text-lg">{bots.filter(b => b.isRunning).length}/8</div>
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

      {/* Digit Selection Bar */}
      <div className="bg-card border border-border rounded-xl p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">🔢 Digit Analysis</h3>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={() => setShowDigitAnalysis(!showDigitAnalysis)}
            className="text-xs"
          >
            {showDigitAnalysis ? 'Hide' : 'Show'} Details
          </Button>
        </div>
        
        <div className="flex gap-1 mb-3">
          {[0,1,2,3,4,5,6,7,8,9].map((digit) => (
            <Button
              key={digit}
              variant={selectedDigit === digit ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedDigit(digit)}
              className="flex-1 text-xs h-8"
            >
              {digit}
            </Button>
          ))}
        </div>

        {showDigitAnalysis && Object.entries(marketsData).length > 0 && (
          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
            {Object.entries(marketsData).slice(0, 4).map(([symbol, data]) => (
              <div key={symbol} className="bg-muted/30 rounded p-2 text-[10px]">
                <div className="font-bold mb-1">{getMarketDisplay(symbol)}</div>
                <div className="grid grid-cols-2 gap-1">
                  <div>Digit {selectedDigit}: {data.analysis.percentages[selectedDigit]?.toFixed(1)}%</div>
                  <div>Over {selectedDigit}: {data.analysis.over5Percentage.toFixed(1)}%</div>
                  <div>Under {selectedDigit}: {data.analysis.under5Percentage.toFixed(1)}%</div>
                  <div>Even: {data.analysis.evenPercentage.toFixed(1)}%</div>
                  <div>Odd: {data.analysis.oddPercentage.toFixed(1)}%</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bots Grid */}
      <div className="grid grid-cols-4 gap-2">
        {bots.map((bot) => {
          const marketData = marketsData[bot.currentMarket];
          
          return (
            <motion.div
              key={bot.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`bg-card border rounded-lg p-2 ${
                bot.isRunning ? 'border-primary ring-1 ring-primary/20' : 'border-border'
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1">
                  <div className={`p-1 rounded-lg ${
                    bot.type.includes('EVEN') ? 'bg-green-500/20 text-green-400' :
                    bot.type.includes('ODD') ? 'bg-purple-500/20 text-purple-400' :
                    bot.type.includes('OVER') ? 'bg-blue-500/20 text-blue-400' :
                    'bg-orange-500/20 text-orange-400'
                  }`}>
                    {bot.type.includes('EVEN') || bot.type.includes('ODD') ? 
                      <CircleDot className="w-3 h-3" /> : 
                      bot.type.includes('OVER') ? <TrendingUp className="w-3 h-3" /> : 
                      <TrendingDown className="w-3 h-3" />}
                  </div>
                  <h4 className="font-bold text-xs">{bot.name}</h4>
                </div>
                <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[7px] px-1">
                  {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                </Badge>
              </div>

              {/* Market & Signal */}
              <div className="bg-muted/30 rounded p-1 mb-1 text-[8px]">
                <div className="flex justify-between">
                  <span>Market:</span>
                  <span className="font-mono font-bold">
                    {getMarketDisplay(bot.currentMarket)}
                  </span>
                </div>
                {marketData && (
                  <>
                    <div className="flex justify-between">
                      <span>Signal:</span>
                      <span className={marketData.analysis.signal === bot.type ? 'text-profit font-bold' : ''}>
                        {marketData.analysis.signal || 'NONE'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Most:</span>
                      <span>{marketData.analysis.mostAppearing}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>2nd Least:</span>
                      <span>{marketData.analysis.secondLeast}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 gap-x-1 text-[8px] mb-1">
                <div>
                  <span>P&L:</span>
                  <span className={`ml-1 font-mono ${
                    bot.totalPnl > 0 ? 'text-profit' : bot.totalPnl < 0 ? 'text-loss' : ''
                  }`}>
                    ${bot.totalPnl.toFixed(2)}
                  </span>
                </div>
                <div>
                  <span>W:</span>
                  <span className="ml-1 font-mono text-profit">{bot.wins}</span>
                </div>
                <div>
                  <span>L:</span>
                  <span className="ml-1 font-mono text-loss">{bot.losses}</span>
                </div>
                <div>
                  <span>Stake:</span>
                  <span className="ml-1 font-mono">${bot.currentStake.toFixed(2)}</span>
                </div>
              </div>

              {/* Controls */}
              <div className="flex gap-1">
                {!bot.isRunning ? (
                  <Button
                    onClick={() => startBot(bot.id)}
                    size="sm"
                    className="flex-1 h-6 text-[8px] px-1"
                  >
                    <Play className="w-2 h-2 mr-1" /> Start
                  </Button>
                ) : (
                  <>
                    <Button
                      onClick={() => pauseBot(bot.id)}
                      size="sm"
                      variant="outline"
                      className="flex-1 h-6 text-[8px] px-1"
                    >
                      <Pause className="w-2 h-2 mr-1" /> {bot.isPaused ? 'Resume' : 'Pause'}
                    </Button>
                    <Button
                      onClick={() => stopBot(bot.id)}
                      size="sm"
                      variant="destructive"
                      className="flex-1 h-6 text-[8px] px-1"
                    >
                      <StopCircle className="w-2 h-2 mr-1" /> Stop
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
        <div className="grid grid-cols-2 gap-2 max-h-80 overflow-y-auto">
          {Object.entries(marketsData).length > 0 ? (
            Object.entries(marketsData).map(([symbol, data]) => (
              <div key={symbol} className="bg-muted/30 rounded p-2 text-xs">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-bold">{getMarketDisplay(symbol)}</span>
                  <Badge className={`text-[8px] ${
                    data.analysis.signal === 'EVEN' ? 'bg-green-500' :
                    data.analysis.signal === 'ODD' ? 'bg-purple-500' :
                    data.analysis.signal === 'OVER_3' ? 'bg-blue-500' :
                    data.analysis.signal === 'UNDER_6' ? 'bg-orange-500' :
                    data.analysis.signal === 'OVER_5' ? 'bg-cyan-500' :
                    data.analysis.signal === 'UNDER_5' ? 'bg-pink-500' :
                    data.analysis.signal === 'OVER_7' ? 'bg-indigo-500' :
                    data.analysis.signal === 'UNDER_7' ? 'bg-amber-500' :
                    'bg-gray-500'
                  }`}>
                    {data.analysis.signal || 'NO SIGNAL'}
                  </Badge>
                </div>
                
                {/* Last 12 Digits */}
                <div className="mb-1">
                  <span className="text-[8px] text-muted-foreground">Last 12: </span>
                  <span className="font-mono text-[10px]">
                    {data.analysis.lastTwelveTicks.join(' ')}
                  </span>
                </div>
                
                {/* Most Appearing & Second Least */}
                <div className="grid grid-cols-2 gap-1 text-[8px] mb-1">
                  <div>Most: <span className="font-bold">{data.analysis.mostAppearing}</span> ({data.analysis.percentages[data.analysis.mostAppearing]?.toFixed(1)}%)</div>
                  <div>2nd Most: <span className="font-bold">{data.analysis.secondMost}</span></div>
                  <div>3rd Most: <span className="font-bold">{data.analysis.thirdMost}</span></div>
                  <div>2nd Least: <span className="font-bold">{data.analysis.secondLeast}</span></div>
                </div>
                
                {/* Digit Percentages */}
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {[0,1,2,3,4].map(d => (
                    <div key={d} className="text-[7px] text-center">
                      {d}: {data.analysis.percentages[d]?.toFixed(0)}%
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-5 gap-1 mb-1">
                  {[5,6,7,8,9].map(d => (
                    <div key={d} className="text-[7px] text-center">
                      {d}: {data.analysis.percentages[d]?.toFixed(0)}%
                    </div>
                  ))}
                </div>
                
                {/* Comparisons for selected digit */}
                <div className="grid grid-cols-2 gap-1 text-[8px] mt-1 pt-1 border-t border-border/50">
                  <div>Over {selectedDigit}: {selectedDigit === 5 ? data.analysis.over5Percentage.toFixed(1) : 
                                                 selectedDigit === 7 ? data.analysis.over7Percentage.toFixed(1) : 
                                                 data.analysis.over5Percentage.toFixed(1)}%</div>
                  <div>Under {selectedDigit}: {selectedDigit === 5 ? data.analysis.under5Percentage.toFixed(1) : 
                                                  selectedDigit === 7 ? data.analysis.under7Percentage.toFixed(1) : 
                                                  data.analysis.under5Percentage.toFixed(1)}%</div>
                  <div>Even: {data.analysis.evenPercentage.toFixed(1)}%</div>
                  <div>Odd: {data.analysis.oddPercentage.toFixed(1)}%</div>
                  <div>Over 3: {data.analysis.over3Percentage.toFixed(1)}%</div>
                  <div>Under 6: {data.analysis.under6Percentage.toFixed(1)}%</div>
                </div>
              </div>
            ))
          ) : (
            <p className="text-muted-foreground col-span-2 text-center py-4">No market data yet. Click Analyze Now.</p>
          )}
        </div>
      </div>

      {/* Trade Log */}
      <div className="bg-card border border-border rounded-xl p-3">
        <h3 className="text-sm font-semibold mb-2">📋 Live Trade Log</h3>
        <div className="space-y-1 max-h-[200px] overflow-y-auto">
          {trades.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">No trades yet</p>
          ) : (
            trades.map((trade, idx) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1 border-b border-border/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-[10px]">{trade.time}</span>
                  <Badge variant="outline" className="text-[7px] px-1 py-0">{trade.bot}</Badge>
                  <span className="font-mono text-[8px]">
                    {trade.market.includes('1HZ') ? '⚡' : 
                     trade.market.includes('BOOM') ? '💥' :
                     trade.market.includes('CRASH') ? '📉' :
                     trade.market.includes('RDBEAR') ? '🐻' :
                     trade.market.includes('RDBULL') ? '🐂' :
                     trade.market.includes('JD') ? '🦘' : '📊'}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {trade.signalType && (
                    <Badge className="text-[6px] px-1 py-0 bg-opacity-50">
                      {trade.signalType}
                    </Badge>
                  )}
                  <span className="font-mono text-[8px]">
                    Last: {trade.lastDigit ?? '—'}
                  </span>
                  <span className="font-mono text-[8px]">${trade.stake.toFixed(2)}</span>
                  <span className={`font-mono text-[8px] w-12 text-right ${
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
