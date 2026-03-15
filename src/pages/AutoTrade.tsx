import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { useTickLoader } from '@/hooks/useTickLoader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, DollarSign, Volume2, TrendingUp, TrendingDown, CircleDot, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

// Supported markets
const SUPPORTED_MARKETS = [
  // Volatility Indices
  'R_10', 'R_25', 'R_50', 'R_75', 'R_100',
  // 1HZ Volatility
  '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V',
  // Jump Indices
  'JD10', 'JD25', 'JD50', 'JD75', 'JD100',
  // Boom & Crash
  'BOOM300', 'BOOM500', 'BOOM1000',
  'CRASH300', 'CRASH500', 'CRASH1000',
  // Bear & Bull
  'RDBEAR', 'RDBULL'
];

// Bot definitions
const BOT_STRATEGIES = [
  {
    id: 'bot1',
    name: 'OVER 1 BOT',
    type: 'over1',
    contractType: 'DIGITOVER',
    barrier: 1,
    recoveryType: 'over3',
    marketCondition: (digits: number[]) => {
      const counts = getDigitCounts(digits);
      const sorted = getSortedDigits(counts);
      return sorted[0] > 4 && sorted[1] > 4 && sorted[9] > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d <= 1);
    }
  },
  {
    id: 'bot2',
    name: 'UNDER 8 BOT',
    type: 'under8',
    contractType: 'DIGITUNDER',
    barrier: 8,
    recoveryType: 'under6',
    marketCondition: (digits: number[]) => {
      const counts = getDigitCounts(digits);
      const sorted = getSortedDigits(counts);
      return sorted[0] < 6 && sorted[1] < 6 && sorted[9] < 6;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d >= 8);
    }
  },
  {
    id: 'bot3',
    name: 'EVEN BOT',
    type: 'even',
    contractType: 'DIGITEVEN',
    marketCondition: (digits: number[]) => {
      const counts = getDigitCounts(digits);
      const sorted = getSortedDigits(counts);
      return sorted[0] % 2 === 0 && sorted[1] % 2 === 0 && sorted[9] % 2 === 0;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 1);
    }
  },
  {
    id: 'bot4',
    name: 'ODD BOT',
    type: 'odd',
    contractType: 'DIGITODD',
    marketCondition: (digits: number[]) => {
      const counts = getDigitCounts(digits);
      const sorted = getSortedDigits(counts);
      return sorted[0] % 2 === 1 && sorted[1] % 2 === 1 && sorted[2] % 2 === 1;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d % 2 === 0);
    }
  },
  {
    id: 'bot5',
    name: 'OVER 3 BOT',
    type: 'over3',
    contractType: 'DIGITOVER',
    barrier: 3,
    marketCondition: (digits: number[]) => {
      const counts = getDigitCounts(digits);
      const sorted = getSortedDigits(counts);
      return sorted[0] > 4 && sorted[1] > 4 && sorted[9] > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d <= 2);
    }
  },
  {
    id: 'bot6',
    name: 'UNDER 6 BOT',
    type: 'under6',
    contractType: 'DIGITUNDER',
    barrier: 6,
    marketCondition: (digits: number[]) => {
      const counts = getDigitCounts(digits);
      const sorted = getSortedDigits(counts);
      return sorted[0] < 5 && sorted[1] < 5 && sorted[9] < 5;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d >= 7);
    }
  }
];

// Helper functions
const getDigitCounts = (digits: number[]): Record<number, number> => {
  const counts: Record<number, number> = {};
  for (let i = 0; i <= 9; i++) counts[i] = 0;
  digits.forEach(d => counts[d]++);
  return counts;
};

const getSortedDigits = (counts: Record<number, number>): number[] => {
  return [...Array(10).keys()].sort((a, b) => counts[b] - counts[a]);
};

const getMarketDisplay = (market: string): string => {
  if (market.startsWith('1HZ')) return `⚡ ${market}`;
  if (market.startsWith('R_')) return `📈 ${market}`;
  if (market.startsWith('BOOM')) return `💥 ${market}`;
  if (market.startsWith('CRASH')) return `📉 ${market}`;
  if (market.startsWith('JD')) return `🦘 ${market}`;
  if (market === 'RDBEAR') return `🐻 Bear Market`;
  if (market === 'RDBULL') return `🐂 Bull Market`;
  return market;
};

// Voice alert system
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private synth: SpeechSynthesis | null = null;
  private voices: SpeechSynthesisVoice[] = [];

  private constructor() {
    if (typeof window !== 'undefined') {
      this.synth = window.speechSynthesis;
      this.loadVoices();
    }
  }

  static getInstance(): VoiceAlertSystem {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  private loadVoices() {
    if (!this.synth) return;
    
    const load = () => {
      this.voices = this.synth!.getVoices().filter(voice => 
        voice.lang.includes('en') && voice.name.toLowerCase().includes('deep')
      );
      
      if (this.voices.length === 0) {
        this.voices = this.synth!.getVoices().filter(voice => 
          voice.lang.includes('en')
        );
      }
    };

    load();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = load;
    }
  }

  speak(text: string) {
    if (!this.synth) return;

    const utterance = new SpeechSynthesisUtterance(text);
    
    if (this.voices.length > 0) {
      utterance.voice = this.voices[0];
    }
    
    utterance.rate = 0.8;
    utterance.pitch = 0.6;
    utterance.volume = 1;
    
    this.synth.speak(utterance);
  }

  scanningAlert() {
    this.speak("Scanning the markets for money… stay ready.");
  }

  signalFound() {
    this.speak("Signal found. Prepare to trade.");
  }
}

interface Signal {
  market: string;
  botId: string;
  botName: string;
  botType: string;
  status: 'monitoring' | 'entry_ready' | 'trading';
  digits: number[];
}

interface MarketData {
  digits: number[];
  lastUpdate: number;
}

export default function AutoTradeScanner() {
  const { isAuthorized, balance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [currentMarket, setCurrentMarket] = useState('');
  const [signals, setSignals] = useState<Signal[]>([]);
  const [marketData, setMarketData] = useState<Record<string, MarketData>>({});
  const [activeTradeId, setActiveTradeId] = useState<string | null>(null);
  const [stake, setStake] = useState(0.5);
  const [multiplier, setMultiplier] = useState(2);
  
  const voiceSystem = VoiceAlertSystem.getInstance();
  const scanIntervalRef = useRef<NodeJS.Timeout>();
  const marketSubscriptions = useRef<Record<string, boolean>>({});

  // Load ticks for a specific market
  const loadMarketTicks = useCallback(async (market: string): Promise<number[]> => {
    return new Promise((resolve) => {
      const ticks: number[] = [];
      let count = 0;
      
      const unsubscribe = derivApi.onMessage((data: any) => {
        if (data.tick && data.tick.symbol === market) {
          const digit = Math.floor(data.tick.quote) % 10;
          ticks.push(digit);
          count++;
          
          setCurrentMarket(`${market} (${count}/1000)`);
          setScanProgress((count / 1000) * 100);
          
          if (count >= 1000) {
            unsubscribe();
            setMarketData(prev => ({
              ...prev,
              [market]: {
                digits: ticks.slice(-1000),
                lastUpdate: Date.now()
              }
            }));
            resolve(ticks.slice(-1000));
          }
        }
      });
      
      derivApi.subscribeTicks(market);
    });
  }, []);

  // Analyze market for bot matches
  const analyzeMarket = useCallback((market: string, digits: number[]) => {
    const matchedSignals: Signal[] = [];
    
    BOT_STRATEGIES.forEach(bot => {
      if (bot.marketCondition(digits)) {
        matchedSignals.push({
          market,
          botId: bot.id,
          botName: bot.name,
          botType: bot.type,
          status: 'monitoring',
          digits: [...digits]
        });
      }
    });
    
    return matchedSignals;
  }, []);

  // Start scanning all markets
  const startScan = useCallback(async () => {
    if (isScanning) return;
    
    setIsScanning(true);
    setSignals([]);
    setScanProgress(0);
    
    voiceSystem.scanningAlert();
    
    // Start scanning interval for voice alerts
    scanIntervalRef.current = setInterval(() => {
      voiceSystem.scanningAlert();
    }, 20000);
    
    const allSignals: Signal[] = [];
    
    try {
      for (let i = 0; i < SUPPORTED_MARKETS.length; i++) {
        const market = SUPPORTED_MARKETS[i];
        
        // Load 1000 ticks
        const digits = await loadMarketTicks(market);
        
        // Analyze market
        const marketSignals = analyzeMarket(market, digits);
        allSignals.push(...marketSignals);
        
        // If signals found, voice alert
        if (marketSignals.length > 0) {
          voiceSystem.signalFound();
        }
      }
      
      // Update signals (one per bot)
      const uniqueSignals = allSignals.reduce((acc, signal) => {
        if (!acc.find(s => s.botId === signal.botId)) {
          acc.push(signal);
        }
        return acc;
      }, [] as Signal[]);
      
      setSignals(uniqueSignals);
      
      if (uniqueSignals.length === 0) {
        toast.info('No signals found in any market');
      } else {
        toast.success(`Found ${uniqueSignals.length} trading signals!`);
      }
      
    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setCurrentMarket('');
      if (scanIntervalRef.current) {
        clearInterval(scanIntervalRef.current);
      }
    }
  }, [isScanning, loadMarketTicks, analyzeMarket, voiceSystem]);

  // Monitor entry conditions for signals
  useEffect(() => {
    if (signals.length === 0) return;
    
    const unsubscribes: (() => void)[] = [];
    
    signals.forEach(signal => {
      if (signal.status !== 'monitoring') return;
      
      const bot = BOT_STRATEGIES.find(b => b.id === signal.botId);
      if (!bot) return;
      
      const unsubscribe = derivApi.onMessage((data: any) => {
        if (data.tick && data.tick.symbol === signal.market) {
          const newDigit = Math.floor(data.tick.quote) % 10;
          
          setSignals(prev => prev.map(s => {
            if (s.market === signal.market && s.botId === signal.botId) {
              const updatedDigits = [...s.digits.slice(-999), newDigit];
              
              // Check entry condition
              if (bot.entryCondition(updatedDigits)) {
                return {
                  ...s,
                  status: 'entry_ready',
                  digits: updatedDigits
                };
              }
              
              return {
                ...s,
                digits: updatedDigits
              };
            }
            return s;
          }));
        }
      });
      
      unsubscribes.push(unsubscribe);
    });
    
    // Subscribe to ticks for all signal markets
    signals.forEach(signal => {
      if (!marketSubscriptions.current[signal.market]) {
        derivApi.subscribeTicks(signal.market);
        marketSubscriptions.current[signal.market] = true;
      }
    });
    
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [signals]);

  // Execute trade
  const executeTrade = useCallback(async (signal: Signal) => {
    if (!isAuthorized || activeTradeId) return;
    if (balance < stake) {
      toast.error('Insufficient balance');
      return;
    }
    
    const bot = BOT_STRATEGIES.find(b => b.id === signal.botId);
    if (!bot) return;
    
    try {
      setActiveTradeId(`${signal.botId}-${Date.now()}`);
      
      const params: any = {
        contract_type: bot.contractType,
        symbol: signal.market,
        duration: 1,
        duration_unit: 't',
        basis: 'stake',
        amount: stake,
      };
      
      if (bot.barrier !== undefined) {
        params.barrier = bot.barrier.toString();
      }
      
      const { contractId } = await derivApi.buyContract(params);
      const result = await derivApi.waitForContractResult(contractId);
      
      if (result.status === 'won') {
        toast.success(`Trade won! +$${result.profit.toFixed(2)}`);
      } else {
        toast.error(`Trade lost: -$${Math.abs(result.profit).toFixed(2)}`);
        
        // Recovery logic
        setStake(prev => Math.round(prev * multiplier * 100) / 100);
      }
      
      // Update signal status back to monitoring
      setSignals(prev => prev.map(s => 
        s.market === signal.market && s.botId === signal.botId
          ? { ...s, status: 'monitoring' }
          : s
      ));
      
    } catch (error) {
      console.error('Trade error:', error);
      toast.error('Trade failed');
    } finally {
      setActiveTradeId(null);
    }
  }, [isAuthorized, balance, activeTradeId, stake, multiplier]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Dollar Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        {[...Array(50)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute text-green-500/10"
            initial={{
              x: Math.random() * window.innerWidth,
              y: -100,
              rotate: Math.random() * 360,
              scale: Math.random() * 0.5 + 0.5,
            }}
            animate={{
              y: window.innerHeight + 100,
              rotate: Math.random() * 720,
            }}
            transition={{
              duration: Math.random() * 10 + 15,
              repeat: Infinity,
              ease: "linear",
              delay: Math.random() * 10,
            }}
          >
            <DollarSign className="w-12 h-12" />
          </motion.div>
        ))}
      </div>

      {/* Main Content */}
      <div className="relative z-10 container mx-auto px-4 py-8">
        {/* Header */}
        <motion.div
          initial={{ y: -50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="text-center mb-8"
        >
          <h1 className="text-4xl font-bold bg-gradient-to-r from-green-400 to-yellow-400 bg-clip-text text-transparent mb-2">
            🤖 Auto Trade Scanner
          </h1>
          <p className="text-green-400/60">Scan all markets for profitable opportunities</p>
        </motion.div>

        {/* Balance & Stake Controls */}
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="max-w-md mx-auto mb-8 bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl p-4"
        >
          <div className="flex justify-between items-center mb-4">
            <span className="text-green-400/60">Balance:</span>
            <span className="text-2xl font-bold text-green-400">${balance?.toFixed(2) || '0.00'}</span>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-green-400/60 mb-1">Stake ($)</label>
              <input
                type="number"
                value={stake}
                onChange={(e) => setStake(parseFloat(e.target.value) || 0.5)}
                step="0.1"
                min="0.1"
                className="w-full bg-black/50 border border-green-500/30 rounded-lg px-3 py-2 text-green-400 focus:outline-none focus:border-green-400"
              />
            </div>
            <div>
              <label className="block text-xs text-green-400/60 mb-1">Multiplier</label>
              <input
                type="number"
                value={multiplier}
                onChange={(e) => setMultiplier(parseFloat(e.target.value) || 2)}
                step="0.1"
                min="1.1"
                className="w-full bg-black/50 border border-green-500/30 rounded-lg px-3 py-2 text-green-400 focus:outline-none focus:border-green-400"
              />
            </div>
          </div>
        </motion.div>

        {/* Scan Button */}
        <motion.div
          className="flex justify-center mb-12"
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
        >
          <Button
            onClick={startScan}
            disabled={isScanning || !isAuthorized}
            className="relative w-64 h-64 rounded-full bg-gradient-to-r from-green-500 to-yellow-500 hover:from-green-600 hover:to-yellow-600 text-white text-2xl font-bold shadow-2xl shadow-green-500/50"
          >
            <div className="absolute inset-0 rounded-full animate-ping bg-green-400/20" />
            <div className="relative flex flex-col items-center">
              {isScanning ? (
                <>
                  <Loader2 className="w-16 h-16 mb-4 animate-spin" />
                  <span>SCANNING...</span>
                  <span className="text-sm mt-2">{currentMarket}</span>
                  <div className="w-48 h-2 bg-black/30 rounded-full mt-4 overflow-hidden">
                    <motion.div
                      className="h-full bg-white"
                      initial={{ width: 0 }}
                      animate={{ width: `${scanProgress}%` }}
                      transition={{ duration: 0.1 }}
                    />
                  </div>
                </>
              ) : (
                <>
                  <DollarSign className="w-16 h-16 mb-4" />
                  <span>SCAN</span>
                  <span className="text-sm mt-2">All Markets</span>
                </>
              )}
            </div>
          </Button>
        </motion.div>

        {/* Signals Container */}
        <motion.div
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="max-w-4xl mx-auto"
        >
          <h2 className="text-2xl font-bold text-green-400 mb-4 flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-yellow-400" />
            Live Signals
            <Sparkles className="w-6 h-6 text-yellow-400" />
          </h2>

          {signals.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="bg-black/40 backdrop-blur-xl border border-red-500/20 rounded-xl p-12 text-center"
            >
              <p className="text-4xl font-bold text-red-400/60 mb-2">🚫</p>
              <p className="text-2xl font-bold text-red-400">NO SIGNAL FOUND</p>
              <p className="text-red-400/60 mt-2">Click SCAN to analyze all markets</p>
            </motion.div>
          ) : (
            <div className="grid gap-4">
              {signals.map((signal, index) => {
                const bot = BOT_STRATEGIES.find(b => b.id === signal.botId);
                return (
                  <motion.div
                    key={`${signal.market}-${signal.botId}`}
                    initial={{ x: -50, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    transition={{ delay: index * 0.1 }}
                    className={`bg-black/40 backdrop-blur-xl border rounded-xl p-6 ${
                      signal.status === 'entry_ready' 
                        ? 'border-yellow-400 ring-2 ring-yellow-400/50' 
                        : 'border-green-500/20'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className={`p-3 rounded-xl ${
                          signal.botType.includes('over') ? 'bg-blue-500/20' :
                          signal.botType.includes('under') ? 'bg-orange-500/20' :
                          signal.botType === 'even' ? 'bg-green-500/20' :
                          'bg-purple-500/20'
                        }`}>
                          {signal.botType.includes('over') ? (
                            <TrendingUp className="w-6 h-6 text-blue-400" />
                          ) : signal.botType.includes('under') ? (
                            <TrendingDown className="w-6 h-6 text-orange-400" />
                          ) : (
                            <CircleDot className="w-6 h-6 text-green-400" />
                          )}
                        </div>
                        <div>
                          <h3 className="text-xl font-bold text-green-400">
                            {getMarketDisplay(signal.market)}
                          </h3>
                          <p className="text-green-400/60">BOT: {signal.botName}</p>
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <Badge className={`text-sm px-3 py-1 ${
                          signal.status === 'entry_ready' 
                            ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30 animate-pulse'
                            : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                        }`}>
                          STATUS: {signal.status === 'entry_ready' ? '🚀 ENTRY READY' : '⏳ WAITING ENTRY'}
                        </Badge>
                        
                        {signal.status === 'entry_ready' && (
                          <Button
                            onClick={() => executeTrade(signal)}
                            disabled={activeTradeId !== null}
                            className="mt-2 bg-green-500/20 hover:bg-green-500/30 text-green-400 border border-green-500/30"
                          >
                            <DollarSign className="w-4 h-4 mr-1" />
                            Trade Now (${stake.toFixed(2)})
                          </Button>
                        )}
                      </div>
                    </div>

                    {/* Last digits preview */}
                    <div className="mt-4 flex items-center gap-2 text-xs text-green-400/60">
                      <span>Last digits:</span>
                      {signal.digits.slice(-5).map((digit, i) => (
                        <span key={i} className="font-mono text-green-400 bg-black/30 px-2 py-1 rounded">
                          {digit}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Voice Status */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="fixed bottom-4 right-4 flex items-center gap-2 bg-black/60 backdrop-blur border border-green-500/20 rounded-lg px-3 py-2"
        >
          <Volume2 className="w-4 h-4 text-green-400 animate-pulse" />
          <span className="text-xs text-green-400/60">Voice alerts active</span>
        </motion.div>
      </div>
    </div>
  );
}
