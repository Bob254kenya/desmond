import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  Loader2, 
  TrendingUp, 
  TrendingDown, 
  CircleDot, 
  Volume2,
  AlertCircle,
  DollarSign,
  Zap,
  Activity,
  BarChart3,
  Target
} from 'lucide-react';

// Market list for scanning
const ALL_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Boom & Crash
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Bear/Bull
  'RDBEAR', 'RDBULL'
];

// Voice alert system
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private synth: SpeechSynthesis | null = null;
  private speaking: boolean = false;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis;
    }
  }

  static getInstance(): VoiceAlertSystem {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  speak(text: string, isDeep: boolean = true) {
    if (!this.synth || this.speaking) return;

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Find a deep voice if available
    const voices = this.synth.getVoices();
    const deepVoice = voices.find(v => 
      v.name.toLowerCase().includes('male') || 
      v.name.toLowerCase().includes('deep')
    );
    
    if (deepVoice) {
      utterance.voice = deepVoice;
    }
    
    utterance.rate = 0.8;
    utterance.pitch = 0.3;
    utterance.volume = 0.9;
    
    utterance.onstart = () => { this.speaking = true; };
    utterance.onend = () => { this.speaking = false; };
    utterance.onerror = () => { this.speaking = false; };
    
    this.synth.speak(utterance);
  }

  stop() {
    if (this.synth) {
      this.synth.cancel();
      this.speaking = false;
    }
  }
}

interface MarketData {
  symbol: string;
  ticks: number[];
  digits: number[];
  frequency: Record<number, number>;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
}

interface BotSignal {
  id: string;
  market: string;
  botType: string;
  botName: string;
  condition: string;
  status: 'waiting' | 'monitoring' | 'triggered' | 'trading';
  entryTriggered: boolean;
  lastDigits: number[];
  contractType: string;
  barrier?: number;
}

const BotConfigs = {
  'OVER-1': {
    name: 'OVER 1 BOT',
    contractType: 'DIGITOVER',
    barrier: 1,
    checkCondition: (freq: MarketData) => {
      return freq.mostAppearing > 4 && 
             freq.secondMost > 4 && 
             freq.leastAppearing > 4;
    },
    checkEntry: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d <= 1);
    }
  },
  'UNDER-8': {
    name: 'UNDER 8 BOT',
    contractType: 'DIGITUNDER',
    barrier: 8,
    checkCondition: (freq: MarketData) => {
      return freq.mostAppearing < 6 && 
             freq.secondMost < 6 && 
             freq.leastAppearing < 6;
    },
    checkEntry: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d >= 8);
    }
  },
  'EVEN': {
    name: 'EVEN BOT',
    contractType: 'DIGITEVEN',
    checkCondition: (freq: MarketData) => {
      return freq.mostAppearing % 2 === 0 &&
             freq.secondMost % 2 === 0 &&
             freq.leastAppearing % 2 === 0;
    },
    checkEntry: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    }
  },
  'ODD': {
    name: 'ODD BOT',
    contractType: 'DIGITODD',
    checkCondition: (freq: MarketData) => {
      return freq.mostAppearing % 2 === 1 &&
             freq.secondMost % 2 === 1 &&
             freq.thirdMost % 2 === 1;
    },
    checkEntry: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    }
  },
  'OVER-3': {
    name: 'OVER 3 BOT',
    contractType: 'DIGITOVER',
    barrier: 3,
    checkCondition: (freq: MarketData) => {
      return freq.mostAppearing > 4 &&
             freq.secondMost > 4 &&
             freq.leastAppearing > 4;
    },
    checkEntry: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d <= 3);
    }
  },
  'UNDER-6': {
    name: 'UNDER 6 BOT',
    contractType: 'DIGITUNDER',
    barrier: 6,
    checkCondition: (freq: MarketData) => {
      return freq.mostAppearing < 5 &&
             freq.secondMost < 5 &&
             freq.leastAppearing < 5;
    },
    checkEntry: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d >= 6);
    }
  }
};

export default function AutoTradeScanner() {
  const { isAuthorized, balance } = useAuth();
  const voiceSystem = useRef(VoiceAlertSystem.getInstance());
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [signals, setSignals] = useState<BotSignal[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [activeBots, setActiveBots] = useState<Record<string, boolean>>({});
  const scanIntervalRef = useRef<NodeJS.Timeout>();
  const voiceIntervalRef = useRef<NodeJS.Timeout>();
  const tickSubscriptions = useRef<Record<string, () => void>>({});

  // Dollar animation component
  const DollarAnimation = () => (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-green-500/20 font-bold text-2xl"
          initial={{
            x: Math.random() * window.innerWidth,
            y: window.innerHeight + 100,
            opacity: 0.3,
            scale: Math.random() * 0.5 + 0.5
          }}
          animate={{
            y: -100,
            opacity: [0.3, 0.6, 0.3],
            rotate: [0, 10, -10, 0]
          }}
          transition={{
            duration: Math.random() * 10 + 10,
            repeat: Infinity,
            delay: Math.random() * 5,
            ease: "linear"
          }}
        >
          $
        </motion.div>
      ))}
    </div>
  );

  // Fetch ticks for a market
  const fetchMarketTicks = async (symbol: string): Promise<MarketData | null> => {
    try {
      const response = await derivApi.getTicks(symbol, 1000);
      if (!response?.ticks) return null;

      const ticks = response.ticks.map((t: any) => t.quote);
      const digits = ticks.map(t => Math.floor(t % 10));
      
      // Calculate frequency
      const frequency: Record<number, number> = {};
      for (let i = 0; i <= 9; i++) frequency[i] = 0;
      digits.forEach(d => frequency[d]++);
      
      const sortedDigits = [...Array(10).keys()].sort((a, b) => frequency[b] - frequency[a]);

      return {
        symbol,
        ticks,
        digits,
        frequency,
        mostAppearing: sortedDigits[0],
        secondMost: sortedDigits[1],
        thirdMost: sortedDigits[2],
        leastAppearing: sortedDigits[9]
      };
    } catch (error) {
      console.error(`Error fetching ticks for ${symbol}:`, error);
      return null;
    }
  };

  // Check if market matches any bot condition
  const findMatchingBots = (data: MarketData): string[] => {
    const matches: string[] = [];
    
    Object.entries(BotConfigs).forEach(([key, config]) => {
      if (config.checkCondition(data)) {
        matches.push(key);
      }
    });

    return matches;
  };

  // Monitor entry conditions for a bot
  const monitorBotEntry = useCallback((signalId: string, market: string, botType: string) => {
    const config = BotConfigs[botType as keyof typeof BotConfigs];
    if (!config) return;

    // Subscribe to real-time ticks
    const unsub = derivApi.onTick(market, (tick: any) => {
      setMarketData(prev => {
        const marketData = prev[market];
        if (!marketData) return prev;

        const newDigit = Math.floor(tick.quote % 10);
        const updatedDigits = [...marketData.digits, newDigit].slice(-1000);

        // Check entry condition
        if (config.checkEntry(updatedDigits)) {
          setSignals(prev => prev.map(s => 
            s.id === signalId ? { ...s, status: 'triggered', lastDigits: updatedDigits.slice(-3) } : s
          ));
          
          // Voice alert for signal found
          voiceSystem.current.speak("Signal found. Prepare to trade.", true);
          
          toast.success(`🎯 Entry signal for ${market} - ${config.name}`);
        }

        return {
          ...prev,
          [market]: { ...marketData, digits: updatedDigits }
        };
      });
    });

    tickSubscriptions.current[signalId] = unsub;
  }, []);

  // Scan all markets
  const startScan = async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setNoSignal(false);
    setSignals([]);
    
    // Stop any existing voice intervals
    if (voiceIntervalRef.current) {
      clearInterval(voiceIntervalRef.current);
    }

    // Start periodic voice alerts during scanning
    voiceIntervalRef.current = setInterval(() => {
      voiceSystem.current.speak("Scanning the markets for money... stay ready.", true);
    }, 20000);

    // Progress animation
    const progressInterval = setInterval(() => {
      setScanProgress(prev => Math.min(prev + 1, 90));
    }, 200);

    const foundSignals: BotSignal[] = [];
    const processedMarkets: Record<string, MarketData> = {};

    // Scan each market
    for (let i = 0; i < ALL_MARKETS.length; i++) {
      const market = ALL_MARKETS[i];
      
      const data = await fetchMarketTicks(market);
      if (data) {
        processedMarkets[market] = data;
        
        // Find matching bots
        const matches = findMatchingBots(data);
        
        matches.forEach(botType => {
          const config = BotConfigs[botType as keyof typeof BotConfigs];
          const signalId = `${market}-${botType}-${Date.now()}`;
          
          const newSignal: BotSignal = {
            id: signalId,
            market,
            botType,
            botName: config.name,
            condition: `Most:${data.mostAppearing}, 2nd:${data.secondMost}, Least:${data.leastAppearing}`,
            status: 'monitoring',
            entryTriggered: false,
            lastDigits: data.digits.slice(-3),
            contractType: config.contractType,
            barrier: config.barrier
          };
          
          foundSignals.push(newSignal);
        });
      }

      // Update progress
      setScanProgress(Math.floor((i + 1) / ALL_MARKETS.length * 100));
    }

    clearInterval(progressInterval);
    setScanProgress(100);
    setMarketData(processedMarkets);

    if (foundSignals.length > 0) {
      setSignals(foundSignals);
      setNoSignal(false);
      
      // Start monitoring each signal
      foundSignals.forEach(signal => {
        monitorBotEntry(signal.id, signal.market, signal.botType);
      });
      
      toast.success(`Found ${foundSignals.length} trading signals!`);
    } else {
      setNoSignal(true);
      voiceSystem.current.speak("No signals found. Keep scanning.", true);
      toast.info('No matching signals found');
    }

    // Cleanup
    setTimeout(() => {
      setIsScanning(false);
      setScanProgress(0);
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
    }, 1000);
  };

  // Cleanup subscriptions on unmount
  useEffect(() => {
    return () => {
      Object.values(tickSubscriptions.current).forEach(unsub => unsub());
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
      voiceSystem.current.stop();
    };
  }, []);

  // Get market icon
  const getMarketIcon = (market: string) => {
    if (market.startsWith('1HZ')) return <Zap className="w-4 h-4" />;
    if (market.startsWith('BOOM')) return <Activity className="w-4 h-4" />;
    if (market.startsWith('CRASH')) return <TrendingDown className="w-4 h-4" />;
    if (market.startsWith('R_')) return <BarChart3 className="w-4 h-4" />;
    return <Target className="w-4 h-4" />;
  };

  // Get bot color
  const getBotColor = (botType: string) => {
    switch(botType) {
      case 'OVER-1': case 'OVER-3': return 'blue';
      case 'UNDER-8': case 'UNDER-6': return 'orange';
      case 'EVEN': return 'green';
      case 'ODD': return 'purple';
      default: return 'gray';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-black text-white">
      <DollarAnimation />
      
      {/* Header */}
      <div className="relative z-10 p-4 border-b border-gray-700 bg-black/50 backdrop-blur-sm">
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-600 rounded-lg">
              <DollarSign className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Money Scanner Pro</h1>
              <p className="text-xs text-gray-400">6-Bot Automated Trading System</p>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <Badge variant="outline" className="px-3 py-1">
              Balance: ${balance?.toFixed(2) || '0.00'}
            </Badge>
            <Button
              onClick={startScan}
              disabled={isScanning || !isAuthorized}
              className="relative overflow-hidden bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white font-bold py-6 px-8 rounded-xl text-lg shadow-lg shadow-green-500/25"
            >
              {isScanning ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  SCANNING...
                </>
              ) : (
                <>
                  <Volume2 className="w-5 h-5 mr-2" />
                  SCAN MARKETS
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      {isScanning && (
        <div className="relative z-10 container mx-auto px-4 mt-4">
          <div className="bg-gray-700 rounded-full h-2 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-green-400 to-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: `${scanProgress}%` }}
              transition={{ duration: 0.3 }}
            />
          </div>
          <p className="text-center text-sm text-gray-400 mt-1">
            Scanning {ALL_MARKETS.length} markets... {scanProgress}%
          </p>
        </div>
      )}

      {/* Main Content */}
      <div className="relative z-10 container mx-auto p-4">
        {/* No Signal Message */}
        <AnimatePresence>
          {noSignal && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-6"
            >
              <Card className="bg-red-500/10 border-red-500/30 p-8 text-center">
                <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
                <h2 className="text-2xl font-bold text-red-400">NO SIGNAL FOUND</h2>
                <p className="text-gray-400 mt-2">No markets match current bot conditions</p>
              </Card>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Signals Grid */}
        {signals.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Target className="w-5 h-5 text-green-400" />
              Active Signals ({signals.length})
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {signals.map((signal) => {
                const color = getBotColor(signal.botType);
                return (
                  <motion.div
                    key={signal.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className={`
                      relative overflow-hidden rounded-xl border-2 p-4
                      ${signal.status === 'triggered' 
                        ? `border-${color}-500 bg-${color}-500/20 animate-pulse` 
                        : 'border-gray-700 bg-gray-800/50'}
                      backdrop-blur-sm
                    `}
                  >
                    {/* Market Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <div className={`p-2 bg-${color}-500/20 rounded-lg`}>
                          {getMarketIcon(signal.market)}
                        </div>
                        <div>
                          <h3 className="font-bold">{signal.market}</h3>
                          <p className="text-xs text-gray-400">Bot: {signal.botName}</p>
                        </div>
                      </div>
                      <Badge className={`
                        ${signal.status === 'triggered' ? 'bg-green-500' : 'bg-yellow-500'}
                      `}>
                        {signal.status === 'triggered' ? '🔔 READY' : '👀 MONITORING'}
                      </Badge>
                    </div>

                    {/* Condition Info */}
                    <div className="bg-black/30 rounded-lg p-2 mb-3 text-xs">
                      <p className="text-gray-400">Market Condition:</p>
                      <p className="font-mono">{signal.condition}</p>
                    </div>

                    {/* Entry Monitoring */}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-400">Last Digits:</span>
                      <div className="flex gap-1">
                        {signal.lastDigits.map((d, i) => (
                          <span 
                            key={i}
                            className={`
                              w-6 h-6 flex items-center justify-center rounded
                              ${signal.status === 'triggered' 
                                ? 'bg-green-500/30 text-green-400' 
                                : 'bg-gray-700'}
                            `}
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Entry Condition */}
                    <div className="mt-2 text-xs text-gray-400">
                      Entry: {signal.botType === 'OVER-1' && 'Two digits ≤ 1'}
                      {signal.botType === 'OVER-3' && 'Three digits ≤ 3'}
                      {signal.botType === 'UNDER-8' && 'Two digits ≥ 8'}
                      {signal.botType === 'UNDER-6' && 'Three digits ≥ 6'}
                      {signal.botType === 'EVEN' && 'Three odd digits'}
                      {signal.botType === 'ODD' && 'Three even digits'}
                    </div>

                    {/* Trade Button (when triggered) */}
                    {signal.status === 'triggered' && (
                      <Button
                        className="w-full mt-3 bg-gradient-to-r from-green-500 to-emerald-600"
                        size="sm"
                      >
                        <Target className="w-4 h-4 mr-2" />
                        ENTER TRADE
                      </Button>
                    )}
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Welcome State */}
        {!isScanning && signals.length === 0 && !noSignal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center py-20"
          >
            <DollarSign className="w-20 h-20 text-gray-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-400 mb-2">Ready to Scan</h2>
            <p className="text-gray-500">
              Click the SCAN MARKETS button to analyze all markets for trading opportunities
            </p>
          </motion.div>
        )}
      </div>

      {/* Bot Legend */}
      <div className="relative z-10 container mx-auto px-4 mt-8">
        <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-4 border border-gray-700">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Bot Strategies
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {Object.entries(BotConfigs).map(([key, config]) => (
              <div key={key} className="text-xs">
                <Badge className={`bg-${getBotColor(key)}-500/20 text-${getBotColor(key)}-400 mb-1`}>
                  {config.name}
                </Badge>
                <p className="text-gray-400">Entry: {key === 'OVER-1' && '2 digits ≤1'}
                  {key === 'OVER-3' && '3 digits ≤3'}
                  {key === 'UNDER-8' && '2 digits ≥8'}
                  {key === 'UNDER-6' && '3 digits ≥6'}
                  {key === 'EVEN' && '3 odds'}
                  {key === 'ODD' && '3 evens'}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
