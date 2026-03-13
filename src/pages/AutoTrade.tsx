import { useState, useRef, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { derivApi } from '@/services/deriv-api';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Play, StopCircle, Pause, TrendingUp, TrendingDown, CircleDot, RefreshCw, Trash2, DollarSign, Volume2 } from 'lucide-react';

interface DigitFrequency {
  digit: number;
  count: number;
}

interface MarketAnalysis {
  symbol: string;
  mostAppearing: number;
  secondMost: number;
  thirdMost: number;
  leastAppearing: number;
  digitFrequencies: DigitFrequency[];
  evenCount: number;
  oddCount: number;
  over1Condition: boolean;
  under8Condition: boolean;
  evenCondition: boolean;
  oddCondition: boolean;
  over3Condition: boolean;
  under6Condition: boolean;
}

interface BotMatch {
  market: string;
  botType: string;
  botName: string;
  analysis: MarketAnalysis;
  entryCondition: boolean;
  monitoring: boolean;
}

interface BotStrategy {
  id: string;
  name: string;
  type: 'over1' | 'under8' | 'even' | 'odd' | 'over3' | 'under6';
  contractType: string;
  barrier?: number;
  condition: (analysis: MarketAnalysis) => boolean;
  entryCondition: (digits: number[]) => boolean;
  recoveryLogic: string;
}

const ALL_MARKETS = [
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

const BOT_STRATEGIES: BotStrategy[] = [
  {
    id: 'bot1',
    name: 'OVER 1 BOT',
    type: 'over1',
    contractType: 'DIGITOVER',
    barrier: 1,
    recoveryLogic: 'Over 3',
    condition: (analysis: MarketAnalysis) => {
      return analysis.mostAppearing > 4 && 
             analysis.secondMost > 4 && 
             analysis.leastAppearing > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d < 2);
    }
  },
  {
    id: 'bot2',
    name: 'UNDER 8 BOT',
    type: 'under8',
    contractType: 'DIGITUNDER',
    barrier: 8,
    recoveryLogic: 'Under 6',
    condition: (analysis: MarketAnalysis) => {
      return analysis.mostAppearing < 6 && 
             analysis.secondMost < 6 && 
             analysis.leastAppearing < 6;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 2) return false;
      const lastTwo = digits.slice(-2);
      return lastTwo.every(d => d > 7);
    }
  },
  {
    id: 'bot3',
    name: 'EVEN BOT',
    type: 'even',
    contractType: 'DIGITEVEN',
    recoveryLogic: 'None',
    condition: (analysis: MarketAnalysis) => {
      return analysis.mostAppearing % 2 === 0 &&
             analysis.secondMost % 2 === 0 &&
             analysis.leastAppearing % 2 === 0;
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
    recoveryLogic: 'None',
    condition: (analysis: MarketAnalysis) => {
      return analysis.mostAppearing % 2 === 1 &&
             analysis.secondMost % 2 === 1 &&
             analysis.thirdMost % 2 === 1;
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
    recoveryLogic: 'None',
    condition: (analysis: MarketAnalysis) => {
      return analysis.mostAppearing > 4 &&
             analysis.secondMost > 4 &&
             analysis.leastAppearing > 4;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d < 3);
    }
  },
  {
    id: 'bot6',
    name: 'UNDER 6 BOT',
    type: 'under6',
    contractType: 'DIGITUNDER',
    barrier: 6,
    recoveryLogic: 'None',
    condition: (analysis: MarketAnalysis) => {
      return analysis.mostAppearing < 5 &&
             analysis.secondMost < 5 &&
             analysis.leastAppearing < 5;
    },
    entryCondition: (digits: number[]) => {
      if (digits.length < 3) return false;
      const lastThree = digits.slice(-3);
      return lastThree.every(d => d > 6);
    }
  }
];

// Voice Alert System
class VoiceAlertSystem {
  private static instance: VoiceAlertSystem;
  private synthesis: SpeechSynthesis | null = null;
  private speaking: boolean = false;

  private constructor() {
    if (typeof window !== 'undefined') {
      this.synthesis = window.speechSynthesis;
    }
  }

  static getInstance(): VoiceAlertSystem {
    if (!VoiceAlertSystem.instance) {
      VoiceAlertSystem.instance = new VoiceAlertSystem();
    }
    return VoiceAlertSystem.instance;
  }

  speak(text: string, isScary: boolean = true) {
    if (!this.synthesis || this.speaking) return;

    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configure for deep, scary voice
    if (isScary) {
      utterance.pitch = 0.3; // Very low pitch
      utterance.rate = 0.8; // Slower rate
      utterance.volume = 1;
      
      // Try to find a deep voice
      const voices = this.synthesis.getVoices();
      const deepVoice = voices.find(voice => 
        voice.name.includes('Daniel') || 
        voice.name.includes('Deep') || 
        voice.name.includes('Male')
      );
      if (deepVoice) utterance.voice = deepVoice;
    }

    utterance.onend = () => {
      this.speaking = false;
    };

    utterance.onerror = () => {
      this.speaking = false;
    };

    this.speaking = true;
    this.synthesis.speak(utterance);
  }

  scanAnnouncement() {
    this.speak("Scanning the markets for money… stay ready.", true);
  }

  signalFound() {
    this.speak("Signal found. Prepare to trade.", true);
  }
}

// Background animation component
const DollarBackground = () => {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {[...Array(20)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute text-green-500/10 font-bold text-4xl"
          initial={{ 
            x: Math.random() * window.innerWidth,
            y: window.innerHeight + 100,
            rotate: Math.random() * 360
          }}
          animate={{ 
            y: -100,
            rotate: Math.random() * 720
          }}
          transition={{
            duration: 10 + Math.random() * 20,
            repeat: Infinity,
            delay: Math.random() * 10,
            ease: "linear"
          }}
        >
          $
        </motion.div>
      ))}
    </div>
  );
};

export default function AutoTrade() {
  const { isAuthorized, balance } = useAuth();
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [matchedSignals, setMatchedSignals] = useState<BotMatch[]>([]);
  const [noSignal, setNoSignal] = useState(false);
  const [marketDigits, setMarketDigits] = useState<Record<string, number[]>>({});
  const [activeBots, setActiveBots] = useState<Record<string, boolean>>({});
  const [botStatus, setBotStatus] = useState<Record<string, string>>({});

  const voiceSystem = useRef(VoiceAlertSystem.getInstance());
  const scanIntervalRef = useRef<NodeJS.Timeout>();
  const voiceIntervalRef = useRef<NodeJS.Timeout>();

  // Fetch ticks for a single market
  const fetchTicks = async (market: string): Promise<number[]> => {
    try {
      const ticks = await derivApi.getTicks(market, 1000);
      return ticks.map((tick: any) => {
        const quote = tick.quote.toString();
        return parseInt(quote.charAt(quote.length - 1));
      });
    } catch (error) {
      console.error(`Error fetching ticks for ${market}:`, error);
      return [];
    }
  };

  // Analyze digit frequencies
  const analyzeDigits = (digits: number[]): MarketAnalysis => {
    if (digits.length < 1000) {
      throw new Error('Insufficient tick data');
    }

    // Count frequencies
    const frequencies: DigitFrequency[] = Array.from({ length: 10 }, (_, i) => ({
      digit: i,
      count: digits.filter(d => d === i).length
    }));

    // Sort by count descending
    frequencies.sort((a, b) => b.count - a.count);

    // Count even/odd
    const evenCount = digits.filter(d => d % 2 === 0).length;
    const oddCount = digits.filter(d => d % 2 === 1).length;

    return {
      symbol: '',
      mostAppearing: frequencies[0].digit,
      secondMost: frequencies[1].digit,
      thirdMost: frequencies[2].digit,
      leastAppearing: frequencies[9].digit,
      digitFrequencies: frequencies,
      evenCount,
      oddCount,
      over1Condition: frequencies[0].digit > 4 && frequencies[1].digit > 4 && frequencies[9].digit > 4,
      under8Condition: frequencies[0].digit < 6 && frequencies[1].digit < 6 && frequencies[9].digit < 6,
      evenCondition: frequencies[0].digit % 2 === 0 && frequencies[1].digit % 2 === 0 && frequencies[9].digit % 2 === 0,
      oddCondition: frequencies[0].digit % 2 === 1 && frequencies[1].digit % 2 === 1 && frequencies[2].digit % 2 === 1,
      over3Condition: frequencies[0].digit > 4 && frequencies[1].digit > 4 && frequencies[9].digit > 4,
      under6Condition: frequencies[0].digit < 5 && frequencies[1].digit < 5 && frequencies[9].digit < 5
    };
  };

  // Detect bot signals from analysis
  const detectBotSignals = (analysis: MarketAnalysis): string[] => {
    const matchedBots: string[] = [];

    BOT_STRATEGIES.forEach(bot => {
      if (bot.condition(analysis)) {
        matchedBots.push(bot.id);
      }
    });

    return matchedBots;
  };

  // Monitor entry conditions for a bot on a market
  const monitorEntry = async (market: string, bot: BotStrategy, onTrigger: () => void) => {
    let monitoring = true;
    setActiveBots(prev => ({ ...prev, [`${market}-${bot.id}`]: true }));

    while (monitoring && activeBots[`${market}-${bot.id}`]) {
      const digits = marketDigits[market] || [];
      
      if (digits.length > 0 && bot.entryCondition(digits)) {
        onTrigger();
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    setActiveBots(prev => ({ ...prev, [`${market}-${bot.id}`]: false }));
  };

  // Main scan function
  const startScan = useCallback(async () => {
    if (isScanning) return;

    setIsScanning(true);
    setNoSignal(false);
    setMatchedSignals([]);
    setScanProgress(0);

    // Start voice announcements
    voiceSystem.current.scanAnnouncement();
    
    voiceIntervalRef.current = setInterval(() => {
      voiceSystem.current.scanAnnouncement();
    }, 20000);

    const newMarketDigits: Record<string, number[]> = {};
    const newMatches: BotMatch[] = [];
    const usedBots = new Set<string>();

    try {
      // Scan all markets
      for (let i = 0; i < ALL_MARKETS.length; i++) {
        const market = ALL_MARKETS[i];
        
        // Update progress
        setScanProgress(Math.round(((i + 1) / ALL_MARKETS.length) * 100));

        // Fetch ticks
        const digits = await fetchTicks(market);
        if (digits.length >= 1000) {
          newMarketDigits[market] = digits;

          // Analyze digits
          const analysis = analyzeDigits(digits);
          analysis.symbol = market;

          // Detect matching bots
          const matchingBotIds = detectBotSignals(analysis);

          // Add matches (only one per bot)
          for (const botId of matchingBotIds) {
            if (!usedBots.has(botId)) {
              const bot = BOT_STRATEGIES.find(b => b.id === botId)!;
              usedBots.add(botId);
              
              newMatches.push({
                market,
                botType: bot.type,
                botName: bot.name,
                analysis,
                entryCondition: false,
                monitoring: false
              });

              // Start monitoring this match
              setBotStatus(prev => ({ 
                ...prev, 
                [`${market}-${botId}`]: 'WAITING ENTRY' 
              }));

              monitorEntry(market, bot, () => {
                setBotStatus(prev => ({ 
                  ...prev, 
                  [`${market}-${botId}`]: 'TRIGGERED' 
                }));
                toast.success(`${bot.name} triggered on ${market}!`);
              });

              break; // Only take first matching bot for this market
            }
          }
        }
      }

      setMarketDigits(newMarketDigits);
      
      if (newMatches.length > 0) {
        setMatchedSignals(newMatches);
        voiceSystem.current.signalFound();
        toast.success(`Found ${newMatches.length} trading signals!`);
      } else {
        setNoSignal(true);
        toast.info('NO SIGNAL FOUND');
      }

    } catch (error) {
      console.error('Scan error:', error);
      toast.error('Scan failed');
    } finally {
      setIsScanning(false);
      setScanProgress(100);
      
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
    }
  }, [isScanning]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (voiceIntervalRef.current) {
        clearInterval(voiceIntervalRef.current);
      }
    };
  }, []);

  // Get market display name
  const getMarketDisplay = (market: string) => {
    if (market.startsWith('1HZ')) return `⚡ ${market}`;
    if (market.startsWith('R_')) return `📈 ${market}`;
    if (market.startsWith('BOOM')) return `💥 ${market}`;
    if (market.startsWith('CRASH')) return `📉 ${market}`;
    if (market.startsWith('JD')) return `🦘 ${market}`;
    if (market === 'RDBEAR') return `🐻 Bear Market`;
    if (market === 'RDBULL') return `🐂 Bull Market`;
    return market;
  };

  return (
    <div className="relative min-h-screen bg-background overflow-hidden">
      <DollarBackground />

      <div className="relative z-10 container mx-auto p-4 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8">
          <motion.h1 
            className="text-4xl font-bold mb-2 bg-gradient-to-r from-green-400 to-blue-500 bg-clip-text text-transparent"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
          >
            Automated Trading Scanner
          </motion.h1>
          <p className="text-muted-foreground">Scan all markets • Detect opportunities • Trade automatically</p>
        </div>

        {/* Balance Display */}
        <div className="bg-card/50 backdrop-blur-sm border border-border rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm text-muted-foreground">Account Balance</span>
              <div className="text-2xl font-bold">${balance?.toFixed(2) || '0.00'}</div>
            </div>
            <Badge variant={isAuthorized ? "default" : "destructive"} className="text-xs">
              {isAuthorized ? 'Connected' : 'Not Connected'}
            </Badge>
          </div>
        </div>

        {/* SCAN BUTTON - Large central button */}
        <div className="flex justify-center mb-8">
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <Button
              onClick={startScan}
              disabled={isScanning || !isAuthorized}
              size="lg"
              className="relative w-64 h-64 rounded-full bg-gradient-to-r from-green-500 to-blue-600 hover:from-green-600 hover:to-blue-700 shadow-2xl"
            >
              <div className="absolute inset-0 rounded-full bg-white/20 animate-ping" />
              <div className="relative flex flex-col items-center">
                {isScanning ? (
                  <>
                    <Loader2 className="w-16 h-16 mb-2 animate-spin" />
                    <span className="text-2xl font-bold">SCANNING...</span>
                    <span className="text-sm mt-2">{scanProgress}%</span>
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-16 h-16 mb-2" />
                    <span className="text-2xl font-bold">SCAN</span>
                    <span className="text-sm mt-2">All Markets</span>
                  </>
                )}
              </div>
            </Button>
          </motion.div>
        </div>

        {/* Progress Bar */}
        {isScanning && (
          <div className="mb-8">
            <div className="flex justify-between text-xs text-muted-foreground mb-1">
              <span>Scanning {ALL_MARKETS.length} markets...</span>
              <span>{scanProgress}%</span>
            </div>
            <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
              <motion.div 
                className="h-full bg-gradient-to-r from-green-400 to-blue-500"
                initial={{ width: 0 }}
                animate={{ width: `${scanProgress}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
          </div>
        )}

        {/* NO SIGNAL FOUND Message */}
        {noSignal && (
          <motion.div 
            className="text-center py-12"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className="text-6xl mb-4">🔍</div>
            <h2 className="text-3xl font-bold text-muted-foreground">NO SIGNAL FOUND</h2>
            <p className="text-muted-foreground mt-2">Try scanning again in a few minutes</p>
          </motion.div>
        )}

        {/* SIGNAL CONTAINER - Display matched signals */}
        {matchedSignals.length > 0 && (
          <motion.div 
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {matchedSignals.map((signal, index) => {
              const statusKey = `${signal.market}-${signal.botType}`;
              const status = botStatus[statusKey] || 'WAITING ENTRY';
              
              return (
                <motion.div
                  key={`${signal.market}-${signal.botType}`}
                  className="bg-card/80 backdrop-blur-sm border-2 border-green-500/50 rounded-xl p-4 shadow-lg"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.1 }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-lg font-bold">{getMarketDisplay(signal.market)}</h3>
                      <Badge variant="outline" className="mt-1">
                        {signal.botName}
                      </Badge>
                    </div>
                    <div className={`px-3 py-1 rounded-full text-xs font-bold ${
                      status === 'TRIGGERED' 
                        ? 'bg-green-500 text-white animate-pulse' 
                        : 'bg-yellow-500/20 text-yellow-500'
                    }`}>
                      {status}
                    </div>
                  </div>

                  {/* Digit Analysis */}
                  <div className="bg-muted/30 rounded-lg p-3 text-sm">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <span className="text-muted-foreground">Most:</span>
                        <span className="ml-2 font-mono font-bold">{signal.analysis.mostAppearing}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">2nd Most:</span>
                        <span className="ml-2 font-mono font-bold">{signal.analysis.secondMost}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">3rd Most:</span>
                        <span className="ml-2 font-mono font-bold">{signal.analysis.thirdMost}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Least:</span>
                        <span className="ml-2 font-mono font-bold">{signal.analysis.leastAppearing}</span>
                      </div>
                    </div>

                    {/* Digit Distribution */}
                    <div className="grid grid-cols-5 gap-1 mt-2">
                      {signal.analysis.digitFrequencies.slice(0, 5).map((f, i) => (
                        <div key={i} className="text-center">
                          <div className="text-xs text-muted-foreground">{f.digit}</div>
                          <div className="w-full h-1 bg-green-500/20 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-green-500"
                              style={{ width: `${(f.count / 1000) * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Recovery Logic */}
                  {BOT_STRATEGIES.find(b => b.type === signal.botType)?.recoveryLogic !== 'None' && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Recovery: {BOT_STRATEGIES.find(b => b.type === signal.botType)?.recoveryLogic}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Status Footer */}
        <div className="mt-8 text-center text-xs text-muted-foreground">
          <div className="flex items-center justify-center gap-4">
            <span>🎯 Scanning all markets automatically</span>
            <span>•</span>
            <span>🤖 6 bots ready</span>
            <span>•</span>
            <span className="flex items-center">
              <Volume2 className="w-3 h-3 mr-1" />
              Voice alerts active
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
