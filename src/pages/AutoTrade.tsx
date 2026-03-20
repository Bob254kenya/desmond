// AutoTrade.tsx
import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Play,
  StopCircle,
  Pause,
  TrendingUp,
  TrendingDown,
  CircleDot,
  RefreshCw,
  Trash2,
  DollarSign,
  Volume2,
  CheckCircle2,
  Clock,
  Zap,
  Target,
  Activity,
  LineChart,
  Radio,
  ScanLine,
  Sparkles,
  AlertTriangle,
  Download,
  Upload,
  Settings,
  ShieldAlert,
  Loader2
} from 'lucide-react';

// ========================
// Types & Interfaces
// ========================

interface DigitFrequency {
  digit: number;
  count: number;
  percentage: number;
}

interface MarketAnalysis {
  symbol: string;
  displayName: string;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  digitFrequencies: DigitFrequency[];
  evenPercentage: number;
  oddPercentage: number;
  lowDigitsPercentage: number;
  highDigitsPercentage: number;
  overUnderStats: {
    over3: number;
    under6: number;
    over1: number;
    under8: number;
  };
  conditions: {
    typeA: boolean;
    typeB: boolean;
    evenDominant: boolean;
  };
  recommendedEntry: number;
  botType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD' | null;
  contractType: 'DIGITMATCH' | 'DIGITEVEN' | 'DIGITODD';
}

interface BotInstance {
  id: string;
  market: string;
  displayName: string;
  botType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD';
  entryDigit: number;
  stake: number;
  multiplier: number;
  takeProfit: number;
  stopLoss: number;
  contractType: 'DIGITMATCH' | 'DIGITEVEN' | 'DIGITODD';
  duration: number;
  isRunning: boolean;
  isPaused: boolean;
  currentStake: number;
  originalStake: number;
  totalPnl: number;
  trades: number;
  wins: number;
  losses: number;
  consecutiveLosses: number;
  contractsExecuted: number;
  lastTradeResult?: 'win' | 'loss';
  inRecovery: boolean;
  currentCycleLoss: number;
  contractId?: string;
}

interface TradeLog {
  time: string;
  message: string;
  type: 'win' | 'loss' | 'info' | 'error';
  pnl?: number;
}

interface BotSettings {
  stake: number;
  multiplier: number;
  takeProfit: number;
  stopLoss: number;
  duration: number;
}

// ========================
// Constants
// ========================

const ALL_MARKETS = [
  { symbol: 'R_10', name: 'Volatility 10', icon: '📈' },
  { symbol: 'R_25', name: 'Volatility 25', icon: '📈' },
  { symbol: 'R_50', name: 'Volatility 50', icon: '📈' },
  { symbol: 'R_75', name: 'Volatility 75', icon: '📈' },
  { symbol: 'R_100', name: 'Volatility 100', icon: '📈' },
  { symbol: '1HZ_10', name: '1HZ Volatility 10', icon: '⚡' },
  { symbol: '1HZ_25', name: '1HZ Volatility 25', icon: '⚡' },
  { symbol: '1HZ_50', name: '1HZ Volatility 50', icon: '⚡' },
  { symbol: '1HZ_75', name: '1HZ Volatility 75', icon: '⚡' },
  { symbol: '1HZ_100', name: '1HZ Volatility 100', icon: '⚡' },
  { symbol: 'JD10', name: 'Jump 10 Index', icon: '🐂' },
  { symbol: 'JD25', name: 'Jump 25 Index', icon: '🐂' },
  { symbol: 'JD50', name: 'Jump 50 Index', icon: '🐂' },
  { symbol: 'JD75', name: 'Jump 75 Index', icon: '🐂' },
  { symbol: 'JD100', name: 'Jump 100 Index', icon: '🐂' }
];

const CONTRACT_PAYOUT = 9.5;
const TRADE_DELAY_MS = 1500;
const MAX_CYCLE_CONTRACTS = 3;
const MAX_RECOVERY_ATTEMPTS = 5;

// ========================
// Helper Functions
// ========================

const getLastDigit = (quote: number | string): number => {
  const str = quote.toString();
  return parseInt(str.charAt(str.length - 1));
};

const extractDigitsFromTicks = (ticks: any[]): number[] => {
  return ticks.map(tick => getLastDigit(tick.quote));
};

// ========================
// Main Component
// ========================

export default function AutoTrade() {
  const { isAuthorized, balance, authorize } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanningMarket, setScanningMarket] = useState('');
  const [marketAnalyses, setMarketAnalyses] = useState<Record<string, MarketAnalysis>>({});
  const [availableSignals, setAvailableSignals] = useState<MarketAnalysis[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [activeTab, setActiveTab] = useState('signals');
  
  const [botInstances, setBotInstances] = useState<BotInstance[]>([]);
  const [globalSettings, setGlobalSettings] = useState<BotSettings>({
    stake: 1.00,
    multiplier: 2.0,
    takeProfit: 50,
    stopLoss: 25,
    duration: 1
  });
  const [tradeHistory, setTradeHistory] = useState<TradeLog[]>([]);
  const [maxActiveBots, setMaxActiveBots] = useState(5);
  const [maxTotalExposure, setMaxTotalExposure] = useState(100);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  
  const activeBotsRef = useRef<Set<string>>(new Set());
  const botQueuesRef = useRef<Map<string, Promise<void>>>(new Map());

  // ========================
  // Deriv API Integration
  // ========================

  const fetchTicks = useCallback(async (market: string): Promise<number[]> => {
    try {
      const ticks = await derivApi.getTicks(market, 1000);
      return extractDigitsFromTicks(ticks);
    } catch (error) {
      console.error(`Error fetching ticks for ${market}:`, error);
      addTradeLog(`Failed to fetch ticks for ${market}: ${error}`, 'error');
      return [];
    }
  }, []);

  const proposeContract = useCallback(async (
    market: string,
    amount: number,
    contractType: string,
    duration: number,
    barrier?: string
  ) => {
    const proposal = await derivApi.propose({
      amount,
      basis: 'stake',
      contract_type: contractType,
      currency: 'USD',
      duration,
      duration_unit: 't',
      symbol: market,
      ...(barrier && { barrier })
    });
    return proposal;
  }, []);

  const buyContract = useCallback(async (proposalId: string) => {
    const purchase = await derivApi.buy({
      price: 1,
      proposal_id: proposalId
    });
    return purchase;
  }, []);

  const subscribeToContract = useCallback(async (
    contractId: string,
    onUpdate: (profit: number, isSold: boolean) => void
  ) => {
    const subscription = await derivApi.subscribeToContract(contractId);
    subscription.on('data', (data: any) => {
      if (data.contract && data.contract.is_sold) {
        const profit = data.contract.profit / 100; // Convert cents to dollars
        onUpdate(profit, true);
        subscription.unsubscribe();
      } else if (data.contract && data.contract.status === 'open') {
        // Still open, no action
      }
    });
    return subscription;
  }, []);

  const executeRealTrade = useCallback(async (
    bot: BotInstance
  ): Promise<{ success: boolean; profit: number; contractId?: string }> => {
    try {
      // Determine barrier for digit match
      let barrier = undefined;
      let contractType = bot.contractType;
      
      if (bot.botType === 'TYPE_A' || bot.botType === 'TYPE_B') {
        contractType = 'DIGITMATCH';
        barrier = bot.entryDigit.toString();
      } else if (bot.botType === 'EVEN_ODD') {
        // For even/odd, we need to decide which parity to trade
        // Based on analysis, we trade EVEN if even % > 55%
        // This should be determined from market analysis, but for now use stored contract type
        contractType = bot.contractType;
      }
      
      // Step 1: Get proposal
      const proposal = await proposeContract(
        bot.market,
        bot.currentStake,
        contractType,
        bot.duration,
        barrier
      );
      
      if (!proposal || !proposal.id) {
        throw new Error('No proposal received');
      }
      
      // Step 2: Buy contract
      const purchase = await buyContract(proposal.id);
      
      if (!purchase || !purchase.contract_id) {
        throw new Error('Purchase failed');
      }
      
      // Step 3: Subscribe and wait for result
      let profit = 0;
      let isResolved = false;
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          if (!isResolved) {
            reject(new Error('Contract subscription timeout'));
          }
        }, 30000); // 30 second timeout
        
        subscribeToContract(purchase.contract_id, (pnl, isSold) => {
          if (isSold) {
            clearTimeout(timeout);
            profit = pnl;
            isResolved = true;
            resolve();
          }
        }).catch(reject);
      });
      
      return { success: true, profit, contractId: purchase.contract_id };
      
    } catch (error) {
      console.error('Trade execution error:', error);
      addTradeLog(`Trade error on ${bot.displayName}: ${error}`, 'error');
      return { success: false, profit: 0 };
    }
  }, [proposeContract, buyContract, subscribeToContract]);

  // ========================
  // Digit Analysis Engine
  // ========================

  const analyzeDigits = useCallback((symbol: string, digits: number[]): MarketAnalysis => {
    const total = digits.length;
    const freq = Array(10).fill(0);
    digits.forEach(d => freq[d]++);
    
    const percentages = freq.map(c => (c / total) * 100);
    const frequencies: DigitFrequency[] = percentages.map((p, i) => ({ digit: i, count: freq[i], percentage: p }));
    frequencies.sort((a, b) => b.count - a.count);
    
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.filter(d => d % 2 === 1).length;
    const evenPercentage = (evenCount / total) * 100;
    const oddPercentage = (oddCount / total) * 100;
    
    const lowDigitsPercentage = percentages[0] + percentages[1] + percentages[2];
    const conditionTypeA = lowDigitsPercentage < 10;
    
    const highDigitsPercentage = percentages[7] + percentages[8] + percentages[9];
    const conditionTypeB = highDigitsPercentage < 10;
    
    const conditionEvenDominant = evenPercentage > 55;
    
    let recommendedEntry = 0;
    let botType: 'TYPE_A' | 'TYPE_B' | 'EVEN_ODD' | null = null;
    let contractType: 'DIGITMATCH' | 'DIGITEVEN' | 'DIGITODD' = 'DIGITMATCH';
    
    if (conditionTypeA) {
      botType = 'TYPE_A';
      let best = 0;
      if (percentages[1] > percentages[best]) best = 1;
      if (percentages[2] > percentages[best]) best = 2;
      recommendedEntry = best;
      contractType = 'DIGITMATCH';
    } else if (conditionTypeB) {
      botType = 'TYPE_B';
      let best = 7;
      if (percentages[8] > percentages[best]) best = 8;
      if (percentages[9] > percentages[best]) best = 9;
      recommendedEntry = best;
      contractType = 'DIGITMATCH';
    } else if (conditionEvenDominant) {
      botType = 'EVEN_ODD';
      const evens = [0, 2, 4, 6, 8];
      let bestEven = evens.reduce((a, b) => percentages[a] > percentages[b] ? a : b, 4);
      recommendedEntry = bestEven;
      contractType = 'DIGITEVEN';
    }
    
    const marketInfo = ALL_MARKETS.find(m => m.symbol === symbol);
    
    return {
      symbol,
      displayName: marketInfo?.name || symbol,
      mostAppearing: frequencies[0].digit,
      secondMost: frequencies[1].digit,
      thirdMost: frequencies[2].digit,
      leastAppearing: frequencies[9].digit,
      digitFrequencies: frequencies,
      evenPercentage,
      oddPercentage,
      lowDigitsPercentage,
      highDigitsPercentage,
      overUnderStats: {
        over3: digits.filter(d => d > 3).length / total * 100,
        under6: digits.filter(d => d < 6).length / total * 100,
        over1: digits.filter(d => d > 1).length / total * 100,
        under8: digits.filter(d => d < 8).length / total * 100
      },
      conditions: {
        typeA: conditionTypeA,
        typeB: conditionTypeB,
        evenDominant: conditionEvenDominant
      },
      recommendedEntry,
      botType,
      contractType
    };
  }, []);

  // ========================
  // Logging & Stats
  // ========================

  const addTradeLog = useCallback((message: string, type: TradeLog['type'] = 'info', pnl?: number) => {
    const time = new Date().toLocaleTimeString();
    setTradeHistory(prev => [{ time, message, type, pnl }, ...prev].slice(0, 200));
  }, []);

  // ========================
  // Trading Engine with Recovery
  // ========================

  const runBot = useCallback(async (botId: string) => {
    // Prevent concurrent runs for the same bot
    if (botQueuesRef.current.has(botId)) {
      return;
    }
    
    const runPromise = (async () => {
      try {
        // Get current bot state
        let bot = botInstances.find(b => b.id === botId);
        if (!bot || !bot.isRunning || bot.isPaused) return;
        
        // Check TP/SL before starting
        if (bot.totalPnl >= bot.takeProfit) {
          addTradeLog(`🎯 TP HIT for ${bot.displayName} ($${bot.totalPnl.toFixed(2)} >= $${bot.takeProfit})`, 'info');
          setBotInstances(prev => prev.map(b => 
            b.id === botId ? { ...b, isRunning: false } : b
          ));
          return;
        }
        
        if (bot.totalPnl <= -bot.stopLoss) {
          addTradeLog(`🛑 SL HIT for ${bot.displayName} ($${bot.totalPnl.toFixed(2)} <= -$${bot.stopLoss})`, 'info');
          setBotInstances(prev => prev.map(b => 
            b.id === botId ? { ...b, isRunning: false } : b
          ));
          return;
        }
        
        // Check exposure limits
        const activeBots = botInstances.filter(b => b.isRunning && !b.isPaused);
        if (activeBots.length > maxActiveBots) {
          addTradeLog(`Max active bots limit reached (${maxActiveBots}), pausing ${bot.displayName}`, 'info');
          setBotInstances(prev => prev.map(b => 
            b.id === botId ? { ...b, isRunning: false } : b
          ));
          return;
        }
        
        const totalExposure = activeBots.reduce((sum, b) => sum + b.currentStake, 0);
        if (totalExposure + bot.currentStake > maxTotalExposure) {
          addTradeLog(`Max exposure limit reached, pausing ${bot.displayName}`, 'info');
          setBotInstances(prev => prev.map(b => 
            b.id === botId ? { ...b, isRunning: false } : b
          ));
          return;
        }
        
        let contractsExecuted = 0;
        let currentStake = bot.currentStake;
        let currentCycleLoss = 0;
        let recoveryAttempts = 0;
        
        addTradeLog(`🤖 ${bot.displayName} (${bot.botType}) started | Entry: ${bot.entryDigit} | Stake: $${currentStake}`, 'info');
        
        while (contractsExecuted < MAX_CYCLE_CONTRACTS && bot.isRunning && !bot.isPaused) {
          // Re-fetch bot state to ensure it's still active
          const currentBot = botInstances.find(b => b.id === botId);
          if (!currentBot || !currentBot.isRunning || currentBot.isPaused) break;
          bot = currentBot;
          
          // Check TP/SL before each trade
          if (bot.totalPnl >= bot.takeProfit) {
            addTradeLog(`🎯 TP HIT for ${bot.displayName} ($${bot.totalPnl.toFixed(2)} >= $${bot.takeProfit})`, 'info');
            setBotInstances(prev => prev.map(b => 
              b.id === botId ? { ...b, isRunning: false } : b
            ));
            break;
          }
          
          if (bot.totalPnl <= -bot.stopLoss) {
            addTradeLog(`🛑 SL HIT for ${bot.displayName} ($${bot.totalPnl.toFixed(2)} <= -$${bot.stopLoss})`, 'info');
            setBotInstances(prev => prev.map(b => 
              b.id === botId ? { ...b, isRunning: false } : b
            ));
            break;
          }
          
          // Update stake for recovery
          if (recoveryAttempts > 0) {
            currentStake = bot.originalStake * Math.pow(bot.multiplier, recoveryAttempts);
          }
          
          // Execute trade
          addTradeLog(`Executing trade #${contractsExecuted + 1} on ${bot.displayName} with stake $${currentStake.toFixed(2)}`, 'info');
          
          const { success, profit, contractId } = await executeRealTrade({
            ...bot,
            currentStake
          });
          
          if (!success) {
            addTradeLog(`Trade execution failed for ${bot.displayName}`, 'error');
            break;
          }
          
          // Update bot state
          const isWin = profit > 0;
          let newTotalPnl = bot.totalPnl + profit;
          let newWins = bot.wins;
          let newLosses = bot.losses;
          let newConsecutiveLosses = bot.consecutiveLosses;
          
          if (isWin) {
            newWins++;
            newConsecutiveLosses = 0;
            currentCycleLoss = 0;
            addTradeLog(`✅ ${bot.displayName} | WIN +$${profit.toFixed(2)}`, 'win', profit);
          } else {
            newLosses++;
            newConsecutiveLosses++;
            currentCycleLoss += currentStake;
            addTradeLog(`❌ ${bot.displayName} | LOSS -$${currentStake.toFixed(2)}`, 'loss', -currentStake);
          }
          
          contractsExecuted++;
          
          // Update bot in state
          setBotInstances(prev => prev.map(b => 
            b.id === botId ? {
              ...b,
              totalPnl: newTotalPnl,
              trades: b.trades + 1,
              wins: newWins,
              losses: newLosses,
              consecutiveLosses: newConsecutiveLosses,
              contractsExecuted: b.contractsExecuted + 1,
              lastTradeResult: isWin ? 'win' : 'loss',
              currentStake: currentStake,
              contractId: contractId
            } : b
          ));
          
          // Stop if profit achieved
          if (newTotalPnl > 0) {
            addTradeLog(`🏁 ${bot.displayName} | Profit achieved ($${newTotalPnl.toFixed(2)}). Stopping bot.`, 'info');
            setBotInstances(prev => prev.map(b => 
              b.id === botId ? { ...b, isRunning: false } : b
            ));
            break;
          }
          
          // Handle recovery after loss
          if (!isWin && recoveryAttempts < MAX_RECOVERY_ATTEMPTS) {
            recoveryAttempts++;
            addTradeLog(`🔄 ${bot.displayName} | Recovery #${recoveryAttempts} | New stake: $${currentStake.toFixed(2)}`, 'info');
            // Continue loop with increased stake
            continue;
          } else if (!isWin && recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
            addTradeLog(`⚠️ ${bot.displayName} | Max recovery attempts reached. Stopping.`, 'info');
            setBotInstances(prev => prev.map(b => 
              b.id === botId ? { ...b, isRunning: false } : b
            ));
            break;
          }
          
          // Reset recovery if win
          if (isWin) {
            recoveryAttempts = 0;
          }
          
          // Add delay between trades
          await new Promise(r => setTimeout(r, TRADE_DELAY_MS));
        }
        
        // After cycle completion
        const finalBot = botInstances.find(b => b.id === botId);
        if (finalBot && finalBot.isRunning && contractsExecuted >= MAX_CYCLE_CONTRACTS && finalBot.totalPnl <= 0) {
          addTradeLog(`📊 ${finalBot.displayName} | Completed ${MAX_CYCLE_CONTRACTS} contracts without profit. Stopping.`, 'info');
          setBotInstances(prev => prev.map(b => 
            b.id === botId ? { ...b, isRunning: false } : b
          ));
        }
        
      } finally {
        botQueuesRef.current.delete(botId);
        activeBotsRef.current.delete(botId);
      }
    })();
    
    botQueuesRef.current.set(botId, runPromise);
    await runPromise;
  }, [botInstances, executeRealTrade, addTradeLog, maxActiveBots, maxTotalExposure]);

  // ========================
  // Bot Management
  // ========================

  const startBot = useCallback((analysis: MarketAnalysis, customSettings?: Partial<BotSettings>) => {
    if (!isAuthorized) {
      toast.error('Please connect your Deriv account first');
      return;
    }
    
    const settings = { ...globalSettings, ...customSettings };
    
    if ((balance || 0) < settings.stake) {
      toast.error('Insufficient balance');
      return;
    }
    
    const botTypeName = analysis.botType === 'TYPE_A' ? 'Type A' :
                        analysis.botType === 'TYPE_B' ? 'Type B' :
                        'Even/Odd';
    
    const newBot: BotInstance = {
      id: `${analysis.symbol}-${Date.now()}-${Math.random()}`,
      market: analysis.symbol,
      displayName: analysis.displayName,
      botType: analysis.botType!,
      entryDigit: analysis.recommendedEntry,
      stake: settings.stake,
      multiplier: settings.multiplier,
      takeProfit: settings.takeProfit,
      stopLoss: settings.stopLoss,
      contractType: analysis.contractType,
      duration: settings.duration,
      isRunning: true,
      isPaused: false,
      currentStake: settings.stake,
      originalStake: settings.stake,
      totalPnl: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      consecutiveLosses: 0,
      contractsExecuted: 0,
      inRecovery: false,
      currentCycleLoss: 0
    };
    
    setBotInstances(prev => [...prev, newBot]);
    addTradeLog(`🚀 Started ${botTypeName} bot on ${analysis.displayName} | Entry: ${analysis.recommendedEntry} | Stake: $${settings.stake} | TP: $${settings.takeProfit} | SL: $${settings.stopLoss}`, 'info');
    
    // Start bot after a short delay to ensure state is updated
    setTimeout(() => runBot(newBot.id), 500);
  }, [isAuthorized, balance, globalSettings, addTradeLog, runBot]);

  const stopBot = useCallback((botId: string) => {
    setBotInstances(prev => prev.map(bot => 
      bot.id === botId ? { ...bot, isRunning: false } : bot
    ));
    const bot = botInstances.find(b => b.id === botId);
    if (bot) {
      addTradeLog(`⏹️ Stopped bot on ${bot.displayName}`, 'info');
    }
  }, [botInstances, addTradeLog]);

  const togglePauseBot = useCallback((botId: string) => {
    setBotInstances(prev => prev.map(bot =>
      bot.id === botId ? { ...bot, isPaused: !bot.isPaused } : bot
    ));
    const bot = botInstances.find(b => b.id === botId);
    if (bot) {
      addTradeLog(`${bot.isPaused ? '▶️ Resumed' : '⏸️ Paused'} bot on ${bot.displayName}`, 'info');
    }
  }, [addTradeLog]);

  // ========================
  // Market Scanning (Parallel)
  // ========================

  const startScan = useCallback(async () => {
    if (isScanning) return;
    if (!isAuthorized) {
      toast.error('Please connect your Deriv account first');
      return;
    }
    
    setIsScanning(true);
    setNoSignal(false);
    setAvailableSignals([]);
    setMarketAnalyses({});
    
    const newAnalyses: Record<string, MarketAnalysis> = {};
    const newSignals: MarketAnalysis[] = [];
    
    try {
      // Parallel fetch with progress tracking
      const results = await Promise.all(
        ALL_MARKETS.map(async (market, index) => {
          setScanningMarket(market.symbol);
          setScanProgress(Math.round(((index + 1) / ALL_MARKETS.length) * 100));
          
          const digits = await fetchTicks(market.symbol);
          if (digits.length >= 1000) {
            const analysis = analyzeDigits(market.symbol, digits);
            return { market: market.symbol, analysis };
          }
          return null;
        })
      );
      
      // Process results
      for (const result of results) {
        if (result) {
          newAnalyses[result.market] = result.analysis;
          if (result.analysis.botType) {
            newSignals.push(result.analysis);
          }
        }
      }
      
      setMarketAnalyses(newAnalyses);
      setAvailableSignals(newSignals);
      
      if (newSignals.length > 0) {
        toast.success(`Found ${newSignals.length} trading signals!`);
        addTradeLog(`🔍 Scan complete | Found ${newSignals.length} markets with favorable conditions`, 'info');
      } else {
        setNoSignal(true);
        toast.info('NO SIGNAL FOUND');
        addTradeLog(`🔍 Scan complete | No favorable conditions detected`, 'info');
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
      addTradeLog(`Scan failed: ${error}`, 'error');
    } finally {
      setIsScanning(false);
      setScanningMarket('');
      setScanProgress(100);
    }
  }, [isScanning, isAuthorized, fetchTicks, analyzeDigits, addTradeLog]);

  // ========================
  // Export/Import Settings
  // ========================

  const exportSettings = useCallback(() => {
    try {
      const settings = {
        globalSettings,
        maxActiveBots,
        maxTotalExposure,
        version: '1.0'
      };
      const dataStr = JSON.stringify(settings, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `deriv-bot-settings-${new Date().toISOString().slice(0, 19)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Settings exported successfully');
    } catch (error) {
      toast.error('Failed to export settings');
    }
  }, [globalSettings, maxActiveBots, maxTotalExposure]);

  const importSettings = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const settings = JSON.parse(e.target?.result as string);
        if (settings.globalSettings) {
          setGlobalSettings(settings.globalSettings);
        }
        if (typeof settings.maxActiveBots === 'number') {
          setMaxActiveBots(settings.maxActiveBots);
        }
        if (typeof settings.maxTotalExposure === 'number') {
          setMaxTotalExposure(settings.maxTotalExposure);
        }
        toast.success('Settings imported successfully');
      } catch (error) {
        toast.error('Invalid settings file');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  }, []);

  // ========================
  // Statistics & Memoized Values
  // ========================

  const totalStats = useMemo(() => ({
    activeBots: botInstances.filter(b => b.isRunning && !b.isPaused).length,
    totalPnl: botInstances.reduce((sum, bot) => sum + bot.totalPnl, 0),
    totalTrades: botInstances.reduce((sum, bot) => sum + bot.trades, 0),
    totalWins: botInstances.reduce((sum, bot) => sum + bot.wins, 0),
    totalLosses: botInstances.reduce((sum, bot) => sum + bot.losses, 0),
    winRate: (() => {
      const totalTrades = botInstances.reduce((sum, bot) => sum + bot.trades, 0);
      const totalWins = botInstances.reduce((sum, bot) => sum + bot.wins, 0);
      return totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    })(),
    totalExposure: botInstances
      .filter(b => b.isRunning && !b.isPaused)
      .reduce((sum, b) => sum + b.currentStake, 0)
  }), [botInstances]);

  // ========================
  // UI Helpers
  // ========================

  const getBotColor = useCallback((botType: string | null) => {
    if (botType === 'TYPE_A') return 'border-emerald-500/50 bg-emerald-500/10';
    if (botType === 'TYPE_B') return 'border-blue-500/50 bg-blue-500/10';
    if (botType === 'EVEN_ODD') return 'border-purple-500/50 bg-purple-500/10';
    return 'border-gray-500/50';
  }, []);

  const getBotIcon = useCallback((botType: string | null) => {
    if (botType === 'TYPE_A') return <TrendingUp className="w-5 h-5 text-emerald-400" />;
    if (botType === 'TYPE_B') return <TrendingDown className="w-5 h-5 text-blue-400" />;
    if (botType === 'EVEN_ODD') return <CircleDot className="w-5 h-5 text-purple-400" />;
    return <Zap className="w-5 h-5" />;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      // Stop all bots on unmount
      setBotInstances(prev => prev.map(bot => ({ ...bot, isRunning: false })));
    };
  }, []);

  // ========================
  // Render
  // ========================

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-gray-900 to-gray-950">
      <div className="relative z-10 container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <motion.div 
          className="text-center mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-5xl font-bold mb-3 bg-gradient-to-r from-emerald-400 via-cyan-400 to-purple-600 bg-clip-text text-transparent">
            Deriv Auto Trading Bot
          </h1>
          <p className="text-gray-400 text-lg">Digit Analysis • 3-Contract Runs • Martingale Recovery • Real Trading</p>
        </motion.div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Balance</p>
                  <p className="text-2xl font-bold text-white">${balance?.toFixed(2) || '0.00'}</p>
                </div>
                <DollarSign className="w-8 h-8 text-emerald-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Active Bots</p>
                  <p className="text-2xl font-bold text-white">{totalStats.activeBots}</p>
                </div>
                <Zap className="w-8 h-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Total P&L</p>
                  <p className={`text-2xl font-bold ${totalStats.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    ${totalStats.totalPnl.toFixed(2)}
                  </p>
                </div>
                <LineChart className="w-8 h-8 text-blue-400" />
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-400">Win Rate</p>
                  <p className="text-2xl font-bold text-white">{totalStats.winRate.toFixed(1)}%</p>
                </div>
                <Target className="w-8 h-8 text-purple-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Settings Bar */}
        <Card className="bg-gray-800/50 border-gray-700 mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-400">Stake:</Label>
                <Input
                  type="number"
                  value={globalSettings.stake}
                  onChange={(e) => setGlobalSettings(prev => ({ ...prev, stake: parseFloat(e.target.value) || 0.5 }))}
                  step="0.5"
                  min="0.5"
                  className="w-24 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-400">Multiplier:</Label>
                <Input
                  type="number"
                  value={globalSettings.multiplier}
                  onChange={(e) => setGlobalSettings(prev => ({ ...prev, multiplier: parseFloat(e.target.value) || 2 }))}
                  step="0.2"
                  min="1.2"
                  className="w-24 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-400">TP ($):</Label>
                <Input
                  type="number"
                  value={globalSettings.takeProfit}
                  onChange={(e) => setGlobalSettings(prev => ({ ...prev, takeProfit: parseFloat(e.target.value) || 10 }))}
                  step="5"
                  min="0"
                  className="w-24 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-400">SL ($):</Label>
                <Input
                  type="number"
                  value={globalSettings.stopLoss}
                  onChange={(e) => setGlobalSettings(prev => ({ ...prev, stopLoss: parseFloat(e.target.value) || 5 }))}
                  step="5"
                  min="0"
                  className="w-24 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-sm text-gray-400">Duration (ticks):</Label>
                <Input
                  type="number"
                  value={globalSettings.duration}
                  onChange={(e) => setGlobalSettings(prev => ({ ...prev, duration: parseInt(e.target.value) || 1 }))}
                  min="1"
                  max="10"
                  className="w-20 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex-1" />
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={exportSettings}>
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <Button variant="outline" size="sm" onClick={() => document.getElementById('import-settings')?.click()}>
                  <Upload className="w-4 h-4 mr-2" />
                  Import
                </Button>
                <input
                  id="import-settings"
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={importSettings}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Risk Management Panel */}
        <Card className="bg-gray-800/50 border-gray-700 mb-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-yellow-400" />
                <Label className="text-sm text-gray-400">Max Active Bots:</Label>
                <Input
                  type="number"
                  value={maxActiveBots}
                  onChange={(e) => setMaxActiveBots(parseInt(e.target.value) || 1)}
                  min="1"
                  max="20"
                  className="w-20 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <Label className="text-sm text-gray-400">Max Exposure ($):</Label>
                <Input
                  type="number"
                  value={maxTotalExposure}
                  onChange={(e) => setMaxTotalExposure(parseFloat(e.target.value) || 50)}
                  step="10"
                  min="10"
                  className="w-24 h-8 bg-gray-700 border-gray-600"
                />
              </div>
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <span className="text-sm text-gray-400">Current Exposure:</span>
                <span className="text-white font-bold">${totalStats.totalExposure.toFixed(2)}</span>
              </div>
              <Badge variant="outline" className="border-emerald-500 text-emerald-400">
                <Volume2 className="w-3 h-3 mr-1" />
                {MAX_CYCLE_CONTRACTS} Contracts • Stop on Profit
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Scan Button */}
        <div className="flex justify-center mb-8">
          <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
            <Button
              onClick={startScan}
              disabled={isScanning || !isAuthorized}
              size="lg"
              className="relative w-64 h-64 rounded-full bg-gradient-to-r from-emerald-500 via-cyan-500 to-purple-600 hover:from-emerald-600 hover:via-cyan-600 hover:to-purple-700 shadow-2xl"
            >
              <div className="absolute inset-0 rounded-full bg-white/20 animate-ping opacity-75" />
              <div className="relative flex flex-col items-center">
                {isScanning ? (
                  <>
                    <Loader2 className="w-16 h-16 mb-3 animate-spin text-white" />
                    <span className="text-2xl font-bold text-white">SCANNING</span>
                    <span className="text-lg mt-2 text-white/90">{scanProgress}%</span>
                    <span className="text-xs mt-1 text-white/70">{scanningMarket}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-16 h-16 mb-3 text-white" />
                    <span className="text-2xl font-bold text-white">SCAN</span>
                    <span className="text-sm mt-2 text-white/80">{ALL_MARKETS.length} Markets</span>
                  </>
                )}
              </div>
            </Button>
          </motion.div>
        </div>

        {/* Scan Progress */}
        {isScanning && (
          <div className="mb-8">
            <Progress value={scanProgress} className="h-2 bg-gray-700" />
          </div>
        )}

        {/* No Signal Message */}
        <AnimatePresence>
          {noSignal && !isScanning && (
            <motion.div 
              className="text-center py-12"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className="text-7xl mb-4">🔍</div>
              <h2 className="text-4xl font-bold text-gray-400 mb-2">NO SIGNAL FOUND</h2>
              <p className="text-gray-500 text-lg">No markets with digits 0,1,2 {'<10%'} or 7,8,9 {'<10%'} or Even {'>55%'}</p>
              <Button 
                variant="outline" 
                className="mt-4 border-gray-600 text-gray-300"
                onClick={startScan}
                disabled={isScanning}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Scan Again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
          <TabsList className="grid grid-cols-3 w-[400px] mx-auto mb-6 bg-gray-800">
            <TabsTrigger value="signals" className="data-[state=active]:bg-gray-700">Signals ({availableSignals.length})</TabsTrigger>
            <TabsTrigger value="bots" className="data-[state=active]:bg-gray-700">Active Bots ({totalStats.activeBots})</TabsTrigger>
            <TabsTrigger value="logs" className="data-[state=active]:bg-gray-700">Trade Logs ({tradeHistory.length})</TabsTrigger>
          </TabsList>

          {/* Signals Tab */}
          <TabsContent value="signals">
            {availableSignals.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {availableSignals.map((signal, index) => {
                  const isBotActive = botInstances.some(b => b.market === signal.symbol && b.isRunning);
                  
                  return (
                    <motion.div
                      key={signal.symbol}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                    >
                      <Card className={`bg-gray-800/80 border-2 ${getBotColor(signal.botType)} hover:shadow-lg transition-all`}>
                        <CardHeader className="pb-2">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="w-12 h-12 rounded-full bg-gray-700 flex items-center justify-center text-2xl">
                                {ALL_MARKETS.find(m => m.symbol === signal.symbol)?.icon || '📊'}
                              </div>
                              <div>
                                <CardTitle className="text-lg text-white">{signal.displayName}</CardTitle>
                                <Badge className={signal.botType === 'TYPE_A' ? 'bg-emerald-500/20 text-emerald-400' : signal.botType === 'TYPE_B' ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}>
                                  {getBotIcon(signal.botType)}
                                  <span className="ml-1">
                                    {signal.botType === 'TYPE_A' ? 'Type A (0,1,2 <10%)' : 
                                     signal.botType === 'TYPE_B' ? 'Type B (7,8,9 <10%)' : 
                                     'Even/Odd (>55%)'}
                                  </span>
                                </Badge>
                              </div>
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
                            <div className="grid grid-cols-3 gap-2 text-center mb-3">
                              <div>
                                <div className="text-xs text-gray-400">Even %</div>
                                <div className="text-lg font-bold text-white">{signal.evenPercentage.toFixed(1)}%</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Odd %</div>
                                <div className="text-lg font-bold text-white">{signal.oddPercentage.toFixed(1)}%</div>
                              </div>
                              <div>
                                <div className="text-xs text-gray-400">Entry</div>
                                <div className="text-lg font-bold text-emerald-400">{signal.recommendedEntry}</div>
                              </div>
                            </div>
                            
                            <div className="flex justify-between text-xs mb-2">
                              <span className="text-gray-400">0,1,2: <span className={signal.lowDigitsPercentage < 10 ? 'text-emerald-400' : 'text-gray-300'}>{signal.lowDigitsPercentage.toFixed(1)}%</span></span>
                              <span className="text-gray-400">7,8,9: <span className={signal.highDigitsPercentage < 10 ? 'text-emerald-400' : 'text-gray-300'}>{signal.highDigitsPercentage.toFixed(1)}%</span></span>
                            </div>
                            
                            <div className="space-y-1">
                              {signal.digitFrequencies.slice(0, 5).map((f, i) => (
                                <div key={i} className="flex items-center gap-2">
                                  <span className="text-xs text-gray-400 w-4">{f.digit}</span>
                                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                    <motion.div 
                                      className={`h-full ${signal.botType === 'TYPE_A' ? 'bg-emerald-500' : signal.botType === 'TYPE_B' ? 'bg-blue-500' : 'bg-purple-500'}`}
                                      initial={{ width: 0 }}
                                      animate={{ width: `${f.percentage}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-gray-400">{f.percentage.toFixed(1)}%</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {!isBotActive ? (
                            <Button 
                              className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800"
                              onClick={() => startBot(signal)}
                              disabled={!isAuthorized}
                            >
                              <Play className="w-4 h-4 mr-2" />
                              Start Bot
                            </Button>
                          ) : (
                            <Button className="w-full bg-gray-600 cursor-not-allowed" disabled>
                              <CheckCircle2 className="w-4 h-4 mr-2" />
                              Already Active
                            </Button>
                          )}
                        </CardContent>
                      </Card>
                    </motion.div>
                  );
                })}
              </div>
            ) : (
              !noSignal && !isScanning && (
                <div className="text-center py-12 text-gray-500">
                  <Radio className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg">Click SCAN to analyze all markets for trading signals.</p>
                  <p className="text-sm mt-2">Looking for: digits 0,1,2 {'<10%'} OR digits 7,8,9 {'<10%'} OR Even% {'>55%'}</p>
                </div>
              )
            )}
          </TabsContent>

          {/* Active Bots Tab */}
          <TabsContent value="bots">
            {botInstances.filter(b => b.isRunning).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {botInstances.filter(b => b.isRunning).map((bot) => (
                  <motion.div key={bot.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <Card className={`bg-gray-800/80 border-2 ${getBotColor(bot.botType)}`}>
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <div className={`p-2 rounded-lg ${bot.botType === 'TYPE_A' ? 'bg-emerald-500/20' : bot.botType === 'TYPE_B' ? 'bg-blue-500/20' : 'bg-purple-500/20'}`}>
                              {getBotIcon(bot.botType)}
                            </div>
                            <div>
                              <CardTitle className="text-white">{bot.displayName}</CardTitle>
                              <p className="text-xs text-gray-400">
                                {bot.botType === 'TYPE_A' ? 'Type A' : bot.botType === 'TYPE_B' ? 'Type B' : 'Even/Odd'} 
                                {bot.inRecovery && ' • RECOVERY'}
                              </p>
                            </div>
                          </div>
                          <Badge className={bot.isPaused ? 'bg-yellow-500' : 'bg-emerald-500'}>
                            {bot.isPaused ? 'PAUSED' : 'RUNNING'}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent>
                        <div className="grid grid-cols-4 gap-2 mb-3">
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">P&L</div>
                            <div className={`font-bold ${bot.totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              ${bot.totalPnl.toFixed(2)}
                            </div>
                          </div>
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">Trades</div>
                            <div className="font-bold text-white">{bot.trades}</div>
                          </div>
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">Wins</div>
                            <div className="font-bold text-emerald-400">{bot.wins}</div>
                          </div>
                          <div className="bg-gray-900/50 rounded p-2 text-center">
                            <div className="text-xs text-gray-400">Losses</div>
                            <div className="font-bold text-red-400">{bot.losses}</div>
                          </div>
                        </div>

                        <div className="bg-gray-900/50 rounded-lg p-3 mb-3">
                          <div className="flex justify-between items-center">
                            <span className="text-gray-400">Entry:</span>
                            <span className="font-bold text-xl text-emerald-400">{bot.entryDigit}</span>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-400">Current Stake:</span>
                            <span className="font-bold text-white">${bot.currentStake.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-400">TP/SL:</span>
                            <span className="font-bold text-white">${bot.takeProfit}/-${bot.stopLoss}</span>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <span className="text-gray-400">Consecutive Losses:</span>
                            <span className="font-bold text-white">{bot.consecutiveLosses}</span>
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            className={`flex-1 ${bot.isPaused ? 'border-yellow-500 text-yellow-400' : 'border-gray-600'}`}
                            onClick={() => togglePauseBot(bot.id)}
                          >
                            {bot.isPaused ? (
                              <><Play className="w-4 h-4 mr-2" />Resume</>
                            ) : (
                              <><Pause className="w-4 h-4 mr-2" />Pause</>
                            )}
                          </Button>
                          <Button
                            variant="destructive"
                            className="flex-1"
                            onClick={() => stopBot(bot.id)}
                          >
                            <StopCircle className="w-4 h-4 mr-2" />
                            Stop
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-gray-500">
                <Zap className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p className="text-lg">No active bots. Start a bot from the Signals tab.</p>
              </div>
            )}
          </TabsContent>

          {/* Trade Logs Tab */}
          <TabsContent value="logs">
            <Card className="bg-gray-800/80 border-gray-700">
              <CardHeader className="pb-2">
                <div className="flex justify-between items-center">
                  <CardTitle className="text-white text-lg">Trade History</CardTitle>
                  <Button variant="outline" size="sm" onClick={() => setTradeHistory([])}>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Clear
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 max-h-[500px] overflow-y-auto">
                  {tradeHistory.length > 0 ? (
                    tradeHistory.map((log, idx) => (
                      <div key={idx} className={`border-l-4 p-3 rounded-r-lg ${
                        log.type === 'win' ? 'border-emerald-500 bg-emerald-500/10' :
                        log.type === 'loss' ? 'border-red-500 bg-red-500/10' :
                        log.type === 'error' ? 'border-red-400 bg-red-500/5' :
                        'border-cyan-500 bg-cyan-500/10'
                      }`}>
                        <div className="flex gap-2 items-start">
                          <span className="text-xs text-gray-400 min-w-[70px]">{log.time}</span>
                          <span className="text-sm text-gray-200 flex-1">{log.message}</span>
                          {log.pnl !== undefined && (
                            <span className={`text-xs font-bold ${log.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {log.pnl >= 0 ? `+$${log.pnl.toFixed(2)}` : `-$${Math.abs(log.pnl).toFixed(2)}`}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-center py-8 text-gray-500">
                      <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
                      <p>No trade history yet</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
