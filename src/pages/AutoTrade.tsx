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
import { Loader2, Play, StopCircle, Pause, Bot, Activity, TrendingUp, TrendingDown, CircleDot, Scan, AlertCircle } from 'lucide-react';

interface MarketAnalysis {
  symbol: string;
  digits: number[];
  over3Score: number;
  under6Score: number;
  evenScore: number;
  oddScore: number;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  percentages: Record<number, number>;
}

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
  selectedMarket?: string;
  status: 'idle' | 'scanning' | 'waiting_entry' | 'trading' | 'recovery' | 'stopped';
  consecutiveLosses: number;
  recoveryMode: boolean;
  entryTriggered: boolean;
  runsCompleted: number;
  maxRuns: number;
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

function speakMessage(text: string) {
  try { if ('speechSynthesis' in window) { window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } } catch {}
}

// Advanced market scanner
const scanAllMarkets = async (digitsData: Record<string, number[]>): Promise<Record<string, MarketAnalysis>> => {
  const analysis: Record<string, MarketAnalysis> = {};
  
  for (const [symbol, digits] of Object.entries(digitsData)) {
    if (digits.length < 700) continue;
    
    const last700 = digits.slice(-700);
    const counts: Record<number, number> = {};
    
    // Count digit frequencies
    for (let i = 0; i <= 9; i++) counts[i] = 0;
    last700.forEach(d => counts[d]++);
    
    // Calculate percentages
    const percentages: Record<number, number> = {};
    for (let i = 0; i <= 9; i++) {
      percentages[i] = (counts[i] / 700) * 100;
    }
    
    // Sort digits by frequency
    const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
    
    // Calculate scores for each bot type
    const over3Score = (counts[4] + counts[5] + counts[6] + counts[7] + counts[8] + counts[9]) / 7;
    const under6Score = (counts[0] + counts[1] + counts[2] + counts[3] + counts[4] + counts[5]) / 6;
    
    const evenDigits = [0,2,4,6,8];
    const oddDigits = [1,3,5,7,9];
    const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
    const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
    
    analysis[symbol] = {
      symbol,
      digits: last700,
      over3Score,
      under6Score,
      evenScore: evenCount,
      oddScore: oddCount,
      mostAppearing: sortedDigits[0],
      secondMost: sortedDigits[1],
      thirdMost: sortedDigits[2],
      leastAppearing: sortedDigits[9],
      percentages
    };
  }
  
  return analysis;
};

// Over 3 Bot Scanner
const findBestOver3Market = (analysis: Record<string, MarketAnalysis>): string | null => {
  let bestMarket: string | null = null;
  let bestScore = 0;
  
  for (const [symbol, data] of Object.entries(analysis)) {
    // Check if most appearing is > 3 and second most is also > 3
    if (data.mostAppearing > 3 && data.secondMost > 3 && data.over3Score > 50) {
      if (data.over3Score > bestScore) {
        bestScore = data.over3Score;
        bestMarket = symbol;
      }
    }
  }
  
  return bestMarket;
};

// Under 6 Bot Scanner
const findBestUnder6Market = (analysis: Record<string, MarketAnalysis>): string | null => {
  let bestMarket: string | null = null;
  let bestScore = 0;
  
  for (const [symbol, data] of Object.entries(analysis)) {
    // Most appearing and second most should be below 6
    if (data.mostAppearing < 6 && data.secondMost < 6 && data.under6Score > 50) {
      if (data.under6Score > bestScore) {
        bestScore = data.under6Score;
        bestMarket = symbol;
      }
    }
  }
  
  return bestMarket;
};

// Even Bot Scanner
const findBestEvenMarket = (analysis: Record<string, MarketAnalysis>): string | null => {
  let bestMarket: string | null = null;
  let bestScore = 0;
  
  for (const [symbol, data] of Object.entries(analysis)) {
    // Most appearing, second, and third should be even, least should be even
    const topThreeEven = [data.mostAppearing, data.secondMost, data.thirdMost].every(d => d % 2 === 0);
    const leastEven = data.leastAppearing % 2 === 0;
    
    if (topThreeEven && leastEven && data.evenScore > data.oddScore) {
      if (data.evenScore > bestScore) {
        bestScore = data.evenScore;
        bestMarket = symbol;
      }
    }
  }
  
  return bestMarket;
};

// Odd Bot Scanner
const findBestOddMarket = (analysis: Record<string, MarketAnalysis>): string | null => {
  let bestMarket: string | null = null;
  let bestScore = 0;
  
  for (const [symbol, data] of Object.entries(analysis)) {
    // Most appearing, second, and third should be odd, least should be odd
    const topThreeOdd = [data.mostAppearing, data.secondMost, data.thirdMost].every(d => d % 2 === 1);
    const leastOdd = data.leastAppearing % 2 === 1;
    
    if (topThreeOdd && leastOdd && data.oddScore > data.evenScore) {
      if (data.oddScore > bestScore) {
        bestScore = data.oddScore;
        bestMarket = symbol;
      }
    }
  }
  
  return bestMarket;
};

export default function AutoTrade() {
  const { isAuthorized, activeAccount, balance } = useAuth();
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [marketAnalysis, setMarketAnalysis] = useState<Record<string, MarketAnalysis>>({});
  const [isScanning, setIsScanning] = useState(false);
  const [scannedMarkets, setScannedMarkets] = useState<string[]>([]);

  // Global settings
  const [config, setConfig] = useState<TradeConfigState>({
    market: 'R_100', contractType: 'DIGITOVER', digit: '3', stake: '0.5',
    martingale: true, multiplier: '2', stopLoss: '30', takeProfit: '5', maxTrades: '100',
  });

  const [tickRange, setTickRange] = useState<number>(700);
  const [trades, setTrades] = useState<TradeLog[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const tradeIdRef = useRef(0);

  // Four independent bots with advanced states
  const [bots, setBots] = useState<BotState[]>([
    { 
      id: 'bot1', name: 'OVER 3 BOT', type: 'over3', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITOVER', barrier: 3,
      status: 'idle', consecutiveLosses: 0, recoveryMode: false, entryTriggered: false,
      runsCompleted: 0, maxRuns: 3
    },
    { 
      id: 'bot2', name: 'UNDER 6 BOT', type: 'under6', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITUNDER', barrier: 6,
      status: 'idle', consecutiveLosses: 0, recoveryMode: false, entryTriggered: false,
      runsCompleted: 0, maxRuns: 3
    },
    { 
      id: 'bot3', name: 'EVEN BOT', type: 'even', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITEVEN',
      status: 'idle', consecutiveLosses: 0, recoveryMode: false, entryTriggered: false,
      runsCompleted: 0, maxRuns: 2
    },
    { 
      id: 'bot4', name: 'ODD BOT', type: 'odd', isRunning: false, isPaused: false, 
      currentStake: 0.5, totalPnl: 0, trades: 0, contractType: 'DIGITODD',
      status: 'idle', consecutiveLosses: 0, recoveryMode: false, entryTriggered: false,
      runsCompleted: 0, maxRuns: 2
    },
  ]);

  // Refs for each bot's running state
  const botRunningRefs = useRef<Record<string, boolean>>({});
  const botPausedRefs = useRef<Record<string, boolean>>({});
  const marketDigitsRef = useRef<Record<string, number[]>>({});

  const { digits, prices, isLoading, tickCount } = useTickLoader(config.market, 1000);

  // Scan all markets periodically
  const scanMarkets = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setScannedMarkets([]);
    
    try {
      const analysisResults: Record<string, MarketAnalysis> = {};
      const scanned: string[] = [];
      
      for (const market of VOLATILITY_MARKETS) {
        // Load ticks for each market (simplified - in production you'd load from API)
        const marketDigits = marketDigitsRef.current[market] || [];
        if (marketDigits.length >= 700) {
          const last700 = marketDigits.slice(-700);
          const counts: Record<number, number> = {};
          for (let i = 0; i <= 9; i++) counts[i] = 0;
          last700.forEach(d => counts[d]++);
          
          const percentages: Record<number, number> = {};
          for (let i = 0; i <= 9; i++) {
            percentages[i] = (counts[i] / 700) * 100;
          }
          
          const sortedDigits = [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
          
          const over3Score = (counts[4] + counts[5] + counts[6] + counts[7] + counts[8] + counts[9]) / 7;
          const under6Score = (counts[0] + counts[1] + counts[2] + counts[3] + counts[4] + counts[5]) / 6;
          
          const evenDigits = [0,2,4,6,8];
          const oddDigits = [1,3,5,7,9];
          const evenCount = evenDigits.reduce((sum, d) => sum + counts[d], 0);
          const oddCount = oddDigits.reduce((sum, d) => sum + counts[d], 0);
          
          analysisResults[market] = {
            symbol: market,
            digits: last700,
            over3Score,
            under6Score,
            evenScore: evenCount,
            oddScore: oddCount,
            mostAppearing: sortedDigits[0],
            secondMost: sortedDigits[1],
            thirdMost: sortedDigits[2],
            leastAppearing: sortedDigits[9],
            percentages
          };
          
          scanned.push(market);
        }
      }
      
      setMarketAnalysis(analysisResults);
      setScannedMarkets(scanned);
      
      // Auto-select markets for each bot
      setBots(prev => prev.map(bot => {
        let selectedMarket: string | null = null;
        
        switch (bot.type) {
          case 'over3':
            selectedMarket = findBestOver3Market(analysisResults);
            break;
          case 'under6':
            selectedMarket = findBestUnder6Market(analysisResults);
            break;
          case 'even':
            selectedMarket = findBestEvenMarket(analysisResults);
            break;
          case 'odd':
            selectedMarket = findBestOddMarket(analysisResults);
            break;
        }
        
        if (selectedMarket) {
          return { ...bot, selectedMarket };
        }
        return bot;
      }));
      
      toast.success(`Scanned ${scanned.length} markets`);
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Market scan failed');
    } finally {
      setIsScanning(false);
    }
  }, [isScanning]);

  // Entry condition check for Over 3 bot
  const checkOver3Entry = (digits: number[]): boolean => {
    if (digits.length < 2) return false;
    const lastTwo = digits.slice(-2);
    return lastTwo.every(d => d <= 3);
  };

  // Entry condition check for Under 6 bot
  const checkUnder6Entry = (digits: number[]): boolean => {
    if (digits.length < 2) return false;
    const lastTwo = digits.slice(-2);
    return lastTwo.every(d => d >= 6);
  };

  // Entry condition check for Even bot
  const checkEvenEntry = (digits: number[]): boolean => {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(d => d % 2 === 1); // Wait for three odds before entering even
  };

  // Entry condition check for Odd bot
  const checkOddEntry = (digits: number[]): boolean => {
    if (digits.length < 3) return false;
    const lastThree = digits.slice(-3);
    return lastThree.every(d => d % 2 === 0); // Wait for three evens before entering odd
  };

  // Check if conditions have changed (market no longer favorable)
  const checkConditionsChanged = (bot: BotState, analysis: MarketAnalysis): boolean => {
    if (!analysis) return true;
    
    switch (bot.type) {
      case 'over3':
        return !(analysis.mostAppearing > 3 && analysis.secondMost > 3);
      case 'under6':
        return !(analysis.mostAppearing < 6 && analysis.secondMost < 6);
      case 'even': {
        const topThreeEven = [analysis.mostAppearing, analysis.secondMost, analysis.thirdMost].every(d => d % 2 === 0);
        return !(topThreeEven && analysis.leastAppearing % 2 === 0);
      }
      case 'odd': {
        const topThreeOdd = [analysis.mostAppearing, analysis.secondMost, analysis.thirdMost].every(d => d % 2 === 1);
        return !(topThreeOdd && analysis.leastAppearing % 2 === 1);
      }
      default:
        return false;
    }
  };

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

    // Check if bot has a selected market
    if (!bot.selectedMarket) {
      toast.error(`${bot.name}: No suitable market found. Run scan first.`);
      return;
    }

    // Update bot running state
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: true, 
      isPaused: false, 
      currentStake: stakeNum,
      status: 'scanning',
      runsCompleted: 0,
      entryTriggered: false
    } : b));
    
    botRunningRefs.current[botId] = true;
    botPausedRefs.current[botId] = false;

    let stake = stakeNum;
    let totalPnl = 0;
    let tradeCount = 0;
    const maxTradeCount = parseInt(config.maxTrades);
    const sl = parseFloat(config.stopLoss);
    const tp = parseFloat(config.takeProfit);
    const mult = parseFloat(config.multiplier);
    let runsCompleted = 0;
    let inRecovery = false;
    let consecutiveLosses = 0;
    let entryTriggered = false;

    // Switch to selected market
    const currentMarket = bot.selectedMarket;

    while (botRunningRefs.current[botId] && tradeCount < maxTradeCount) {
      // Check if paused
      if (botPausedRefs.current[botId]) {
        await new Promise(r => setTimeout(r, 500));
        continue;
      }

      // Get current market digits
      const marketDigits = marketDigitsRef.current[currentMarket] || [];
      
      // Check if conditions still favorable
      const currentAnalysis = marketAnalysis[currentMarket];
      if (currentAnalysis && checkConditionsChanged(bot, currentAnalysis) && !inRecovery) {
        if (totalPnl > 0) {
          toast.info(`${bot.name}: Market conditions changed, stopping on profit`);
          break;
        } else {
          toast.warning(`${bot.name}: Market conditions changed, waiting for recovery`);
          inRecovery = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'recovery' } : b));
        }
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

      // Entry condition check based on bot type
      let entryCondition = false;
      if (!entryTriggered && !inRecovery) {
        switch (bot.type) {
          case 'over3':
            entryCondition = checkOver3Entry(marketDigits);
            break;
          case 'under6':
            entryCondition = checkUnder6Entry(marketDigits);
            break;
          case 'even':
            entryCondition = checkEvenEntry(marketDigits);
            break;
          case 'odd':
            entryCondition = checkOddEntry(marketDigits);
            break;
        }
      }

      if (!entryTriggered && !inRecovery) {
        setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'waiting_entry' } : b));
        if (!entryCondition) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        } else {
          entryTriggered = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'trading', entryTriggered: true } : b));
          toast.info(`${bot.name}: Entry condition met! Starting trading sequence`);
        }
      }

      // Check if max runs completed
      if (runsCompleted >= bot.maxRuns && !inRecovery) {
        if (totalPnl > 0) {
          toast.success(`${bot.name}: Completed ${runsCompleted} profitable runs, stopping`);
          break;
        } else {
          // If not profitable, continue in recovery mode
          inRecovery = true;
          setBots(prev => prev.map(b => b.id === botId ? { ...b, status: 'recovery' } : b));
        }
      }

      // Wait for next tick before placing trade
      try {
        await waitForNextTick(currentMarket);

        // Check if another bot is trading
        if (activeTradeId) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }

        // Prepare contract parameters
        const params: any = {
          contract_type: bot.contractType,
          symbol: currentMarket,
          duration: 1,
          duration_unit: 't',
          basis: 'stake',
          amount: stake,
        };

        // Add barrier for Over/Under bots
        if (bot.barrier !== undefined) {
          params.barrier = bot.barrier.toString();
        }

        // Place trade
        const id = ++tradeIdRef.current;
        const now = new Date().toLocaleTimeString();
        const tradeId = `${botId}-${id}`;
        setActiveTradeId(tradeId);

        setTrades(prev => [{
          id,
          time: now,
          market: currentMarket,
          contract: bot.contractType,
          stake,
          result: 'Pending',
          pnl: 0,
          bot: bot.name,
          runNumber: runsCompleted + 1
        }, ...prev].slice(0, 100));

        const { contractId } = await derivApi.buyContract(params);
        const result = await derivApi.waitForContractResult(contractId);
        const won = result.status === 'won';
        const pnl = result.profit;

        // Update trade log
        setTrades(prev => prev.map(t => t.id === id ? { ...t, result: won ? 'Win' : 'Loss', pnl } : t));

        totalPnl += pnl;
        tradeCount++;

        if (won) {
          consecutiveLosses = 0;
          runsCompleted++;
          if (!inRecovery) {
            stake = stakeNum;
          }
        } else {
          consecutiveLosses++;
          if (config.martingale) {
            stake = Math.round(stake * mult * 100) / 100;
          }
        }

        // Update bot state
        setBots(prev => prev.map(b => {
          if (b.id === botId) {
            return {
              ...b,
              totalPnl,
              trades: tradeCount,
              currentStake: stake,
              consecutiveLosses,
              recoveryMode: inRecovery,
              runsCompleted
            };
          }
          return b;
        }));

        setActiveTradeId(null);
        await new Promise(r => setTimeout(r, 500));

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
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      isRunning: false, 
      isPaused: false,
      status: 'stopped',
      runsCompleted: 0,
      entryTriggered: false
    } : b));
    
    botRunningRefs.current[botId] = false;
    
    if (totalPnl > 0) {
      toast.success(`${bot.name} finished with profit: +$${totalPnl.toFixed(2)}`);
    } else {
      toast.info(`${bot.name} finished with P&L: $${totalPnl.toFixed(2)}`);
    }
  }, [isAuthorized, config, balance, marketAnalysis, activeTradeId, bots]);

  // Bot control functions
  const startBot = (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || bot.isRunning) return;
    
    // Reset stake to initial value
    setBots(prev => prev.map(b => b.id === botId ? { 
      ...b, 
      currentStake: parseFloat(config.stake),
      totalPnl: 0,
      trades: 0,
      consecutiveLosses: 0,
      runsCompleted: 0,
      entryTriggered: false
    } : b));
    
    // Start the bot
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
      status: 'stopped',
      runsCompleted: 0,
      entryTriggered: false
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
      status: 'stopped',
      runsCompleted: 0,
      entryTriggered: false
    })));
  };

  const handleConfigChange = useCallback(<K extends keyof TradeConfigState>(key: K, val: TradeConfigState[K]) => {
    setConfig(prev => ({ ...prev, [key]: val }));
  }, []);

  // Get bot status color and icon
  const getBotStatusDisplay = (status: string) => {
    switch(status) {
      case 'scanning': return { color: 'text-blue-400', text: '🔍 Scanning' };
      case 'waiting_entry': return { color: 'text-yellow-400', text: '⏳ Waiting Entry' };
      case 'trading': return { color: 'text-green-400', text: '📈 Trading' };
      case 'recovery': return { color: 'text-orange-400', text: '🔄 Recovery' };
      case 'stopped': return { color: 'text-red-400', text: '⏹️ Stopped' };
      default: return { color: 'text-gray-400', text: '⚫ Idle' };
    }
  };

  // Get bot icon
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
          <h1 className="text-2xl font-bold text-foreground">🤖 Advanced Digit Trading System</h1>
          <p className="text-sm text-muted-foreground">Smart market scanning • Entry conditions • Recovery mode</p>
        </div>
        <div className="flex items-center gap-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-xs text-warning">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading ticks...
            </div>
          ) : (
            <Badge variant="outline" className="text-xs">{tickCount} ticks</Badge>
          )}
          <Button 
            variant="default" 
            size="sm" 
            onClick={scanMarkets}
            disabled={isScanning}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {isScanning ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Scan className="w-4 h-4 mr-1" />}
            Scan Markets
          </Button>
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
            onStart={() => {}} 
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
              min={100} 
              max={1000} 
              step={10} 
              value={[tickRange]}
              onValueChange={([v]) => setTickRange(v)} 
              disabled={bots.some(b => b.isRunning)} 
            />
          </div>

          {/* Market Status */}
          <div className="bg-card border border-border rounded-xl p-4">
            <h3 className="text-sm font-semibold mb-3">Market Status</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Active Trades:</span>
                <span className="font-mono">{activeTradeId ? '🔴 1' : '⚫ 0'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Markets Scanned:</span>
                <span className="font-mono">{scannedMarkets.length}/21</span>
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
            <DigitDisplay digits={digits.slice(-30)} barrier={parseInt(config.digit)} />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
            <PercentagePanel 
              digits={digits} 
              barrier={parseInt(config.digit)} 
              selectedDigit={parseInt(config.digit)} 
              onSelectDigit={d => handleConfigChange('digit', String(d))} 
            />
          </motion.div>
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }}>
            <SignalAlerts 
              digits={digits} 
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
            {bots.map((bot) => {
              const statusDisplay = getBotStatusDisplay(bot.status);
              return (
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
                          {bot.contractType} {bot.barrier !== undefined ? `| B${bot.barrier}` : ''}
                        </p>
                      </div>
                    </div>
                    <Badge variant={bot.isRunning ? "default" : "secondary"} className="text-[9px]">
                      {bot.isRunning ? (bot.isPaused ? '⏸️' : '▶️') : '⏹️'}
                    </Badge>
                  </div>

                  {/* Selected Market & Status */}
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Market:</span>
                    <span className="font-mono font-bold">{bot.selectedMarket || '—'}</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-muted-foreground">Status:</span>
                    <span className={`font-mono ${statusDisplay.color}`}>{statusDisplay.text}</span>
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
                      <span className="text-muted-foreground">Runs:</span>
                      <span className="ml-1 font-mono">{bot.runsCompleted}/{bot.maxRuns}</span>
                    </div>
                  </div>

                  {/* Recovery Indicator */}
                  {bot.recoveryMode && (
                    <div className="text-[9px] text-orange-400 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Recovery mode active
                    </div>
                  )}

                  {/* Bot Controls */}
                  <div className="flex gap-1 mt-2">
                    {!bot.isRunning ? (
                      <Button
                        onClick={() => startBot(bot.id)}
                        disabled={!isAuthorized || balance < parseFloat(config.stake) || activeTradeId !== null || !bot.selectedMarket}
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
              );
            })}
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
                        {trade.runNumber && (
                          <span className="text-[8px] text-muted-foreground">R{trade.runNumber}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px]">{trade.market}</span>
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
