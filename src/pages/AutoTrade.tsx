import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import {
    Activity,
    AlertCircle,
    BarChart3,
    Brain,
    ChevronDown,
    ChevronUp,
    CircleDot,
    Copy,
    Download,
    Eye,
    Gauge,
    Hash,
    Loader2,
    LogOut,
    Play,
    Plus,
    RefreshCw,
    Save,
    Scan,
    Settings,
    StopCircle,
    Timer,
    TrendingDown,
    TrendingUp,
    Trash2,
    Upload,
    Volume2,
    VolumeX,
    Waves,
    Wind,
    XCircle,
    Zap,
    Target,
    Clock,
    Flame,
    Snowflake,
    Wifi,
    WifiOff,
    ArrowUp,
    ArrowDown,
    Minus,
    CheckCircle2,
    AlertTriangle,
    MoveUp,
    MoveDown
} from 'lucide-react';

// Types
interface TickData {
    quote: number;
    symbol: string;
    timestamp: number;
    digit: number;
}

interface MarketAnalysis {
    symbol: string;
    ticks: TickData[];
    digitCounts: Record<number, number>;
    digitPercentages: Record<number, number>;
    evenPercentage: number;
    oddPercentage: number;
    overPercentage: number;
    underPercentage: number;
    last50Digits: number[];
    last20Digits: number[];
    last10Digits: number[];
    currentEvenStreak: number;
    currentOddStreak: number;
    currentOverStreak: number;
    currentUnderStreak: number;
    momentum20: number;
    trend50: 'UP' | 'DOWN' | 'SIDEWAYS';
    signal: {
        type: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'NONE';
        confidence: number;
        strength: 'STRONG' | 'MEDIUM' | 'WEAK';
        mode: 'TREND' | 'REVERSAL';
    };
    volatility: {
        averageChange: number;
        level: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
        score: number;
    };
}

interface Bot {
    id: string;
    name: string;
    type: 'even' | 'odd' | 'over' | 'under';
    mode: 'trend' | 'reversal';
    market: string;
    stake: number;
    duration: number;
    multiplier: number;
    maxSteps: number;
    takeProfit: number;
    stopLoss: number;
    useMartingale: boolean;
    useEntryFilter: boolean;
    minVolatility: number;
    maxVolatility: number;
    isRunning: boolean;
    status: 'idle' | 'watching' | 'confirming' | 'trading' | 'recovery' | 'stopped';
    currentStake: number;
    totalPnl: number;
    trades: number;
    wins: number;
    losses: number;
    currentRun: number;
    recoveryStep: number;
    consecutiveOpposite: number;
    lastEntrySignal: number | null;
    lastAnalysis: MarketAnalysis | null;
    expanded: boolean;
    enabled: boolean;
}

interface Trade {
    id: string;
    botId: string;
    botName: string;
    type: string;
    mode: string;
    market: string;
    entry: string;
    stake: number;
    result: 'win' | 'loss' | 'pending';
    profit: number;
    entryDigit: number;
    resultDigit: number;
    timestamp: number;
    confidence: number;
}

// Constants
const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

const MARKETS = [
    { value: 'R_10', label: 'Volatility 10', icon: '📊', volatility: 'LOW' },
    { value: 'R_25', label: 'Volatility 25', icon: '📊', volatility: 'MEDIUM' },
    { value: 'R_50', label: 'Volatility 50', icon: '📊', volatility: 'MEDIUM' },
    { value: 'R_75', label: 'Volatility 75', icon: '📊', volatility: 'HIGH' },
    { value: 'R_100', label: 'Volatility 100', icon: '📊', volatility: 'EXTREME' },
    { value: '1HZ10V', label: '1HZ 10', icon: '⚡', volatility: 'LOW' },
    { value: '1HZ25V', label: '1HZ 25', icon: '⚡', volatility: 'LOW' },
    { value: '1HZ50V', label: '1HZ 50', icon: '⚡', volatility: 'MEDIUM' },
    { value: '1HZ75V', label: '1HZ 75', icon: '⚡', volatility: 'MEDIUM' },
    { value: '1HZ100V', label: '1HZ 100', icon: '⚡', volatility: 'HIGH' },
    { value: 'BOOM300', label: 'Boom 300', icon: '💥', volatility: 'HIGH' },
    { value: 'CRASH300', label: 'Crash 300', icon: '📉', volatility: 'HIGH' }
];

const BOT_TYPES = [
    { id: 'bot1', type: 'over', mode: 'trend', name: 'Over Bot (Trend)', icon: <ArrowUp className="w-4 h-4" />, color: 'blue' },
    { id: 'bot2', type: 'over', mode: 'reversal', name: 'Over Bot (Recovery)', icon: <RefreshCw className="w-4 h-4" />, color: 'blue' },
    { id: 'bot3', type: 'even', mode: 'trend', name: 'Even Bot', icon: <CircleDot className="w-4 h-4" />, color: 'purple' },
    { id: 'bot4', type: 'odd', mode: 'trend', name: 'Odd Bot', icon: <Hash className="w-4 h-4" />, color: 'orange' },
    { id: 'bot5', type: 'over', mode: 'trend', name: 'Over Bot', icon: <MoveUp className="w-4 h-4" />, color: 'green' },
    { id: 'bot6', type: 'under', mode: 'trend', name: 'Under Bot', icon: <MoveDown className="w-4 h-4" />, color: 'red' }
];

const VOLATILITY_ICONS = {
    LOW: <Snowflake className="w-3 h-3 text-blue-400" />,
    MEDIUM: <Wind className="w-3 h-3 text-yellow-400" />,
    HIGH: <Waves className="w-3 h-3 text-orange-400" />,
    EXTREME: <Zap className="w-3 h-3 text-red-400" />
};

// Main Component
export default function DerivTradingBot() {
    const { toast } = useToast();
    
    // State
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [balance, setBalance] = useState(10000);
    const [demoMode, setDemoMode] = useState(true);
    const [sound, setSound] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [selectedMarket, setSelectedMarket] = useState('R_100');
    const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
    const [bots, setBots] = useState<Bot[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [activeTrade, setActiveTrade] = useState<Trade | null>(null);
    const [selectedTab, setSelectedTab] = useState('bots');
    const [globalVolatility, setGlobalVolatility] = useState({ min: 0, max: 100 });
    const [lastDigit, setLastDigit] = useState<number | null>(null);

    // WebSocket Refs
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
    const ticksRef = useRef<TickData[]>([]);
    const runningBotsRef = useRef<Set<string>>(new Set());

    // Initialize 6 bots
    useEffect(() => {
        const initialBots: Bot[] = [
            // Bot 1: Over Bot (Trend)
            {
                id: 'bot1',
                name: 'Over Bot (Trend)',
                type: 'over',
                mode: 'trend',
                market: 'R_100',
                stake: 1,
                duration: 5,
                multiplier: 2,
                maxSteps: 3,
                takeProfit: 20,
                stopLoss: 30,
                useMartingale: true,
                useEntryFilter: true,
                minVolatility: 0,
                maxVolatility: 100,
                isRunning: false,
                status: 'idle',
                currentStake: 1,
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveOpposite: 0,
                lastEntrySignal: null,
                lastAnalysis: null,
                expanded: true,
                enabled: true
            },
            // Bot 2: Over Bot (Recovery)
            {
                id: 'bot2',
                name: 'Over Bot (Recovery)',
                type: 'over',
                mode: 'reversal',
                market: 'R_100',
                stake: 1,
                duration: 5,
                multiplier: 2,
                maxSteps: 3,
                takeProfit: 20,
                stopLoss: 30,
                useMartingale: true,
                useEntryFilter: true,
                minVolatility: 0,
                maxVolatility: 100,
                isRunning: false,
                status: 'idle',
                currentStake: 1,
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveOpposite: 0,
                lastEntrySignal: null,
                lastAnalysis: null,
                expanded: true,
                enabled: true
            },
            // Bot 3: Even Bot
            {
                id: 'bot3',
                name: 'Even Bot',
                type: 'even',
                mode: 'trend',
                market: 'R_100',
                stake: 1,
                duration: 5,
                multiplier: 2,
                maxSteps: 3,
                takeProfit: 20,
                stopLoss: 30,
                useMartingale: true,
                useEntryFilter: true,
                minVolatility: 0,
                maxVolatility: 100,
                isRunning: false,
                status: 'idle',
                currentStake: 1,
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveOpposite: 0,
                lastEntrySignal: null,
                lastAnalysis: null,
                expanded: true,
                enabled: true
            },
            // Bot 4: Odd Bot
            {
                id: 'bot4',
                name: 'Odd Bot',
                type: 'odd',
                mode: 'trend',
                market: 'R_100',
                stake: 1,
                duration: 5,
                multiplier: 2,
                maxSteps: 3,
                takeProfit: 20,
                stopLoss: 30,
                useMartingale: true,
                useEntryFilter: true,
                minVolatility: 0,
                maxVolatility: 100,
                isRunning: false,
                status: 'idle',
                currentStake: 1,
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveOpposite: 0,
                lastEntrySignal: null,
                lastAnalysis: null,
                expanded: true,
                enabled: true
            },
            // Bot 5: Over Bot
            {
                id: 'bot5',
                name: 'Over Bot',
                type: 'over',
                mode: 'trend',
                market: 'R_100',
                stake: 1,
                duration: 5,
                multiplier: 2,
                maxSteps: 3,
                takeProfit: 20,
                stopLoss: 30,
                useMartingale: true,
                useEntryFilter: true,
                minVolatility: 0,
                maxVolatility: 100,
                isRunning: false,
                status: 'idle',
                currentStake: 1,
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveOpposite: 0,
                lastEntrySignal: null,
                lastAnalysis: null,
                expanded: true,
                enabled: true
            },
            // Bot 6: Under Bot
            {
                id: 'bot6',
                name: 'Under Bot',
                type: 'under',
                mode: 'trend',
                market: 'R_100',
                stake: 1,
                duration: 5,
                multiplier: 2,
                maxSteps: 3,
                takeProfit: 20,
                stopLoss: 30,
                useMartingale: true,
                useEntryFilter: true,
                minVolatility: 0,
                maxVolatility: 100,
                isRunning: false,
                status: 'idle',
                currentStake: 1,
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveOpposite: 0,
                lastEntrySignal: null,
                lastAnalysis: null,
                expanded: true,
                enabled: true
            }
        ];
        
        setBots(initialBots);
    }, []);

    // Connect WebSocket
    const connectWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setIsConnecting(true);
        
        try {
            const ws = new WebSocket(DERIV_WS_URL);
            
            ws.onopen = () => {
                wsRef.current = ws;
                setIsConnected(true);
                setIsConnecting(false);
                
                // Subscribe to selected market
                subscribeToMarket(selectedMarket);
                
                toast({
                    title: 'Connected',
                    description: 'WebSocket connection established',
                });
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };

            ws.onerror = () => {
                setIsConnected(false);
                setIsConnecting(false);
            };

            ws.onclose = () => {
                setIsConnected(false);
                setIsConnecting(false);
                
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                }
                
                reconnectTimeoutRef.current = setTimeout(() => {
                    connectWebSocket();
                }, 5000);
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('Connection error:', error);
            setIsConnected(false);
            setIsConnecting(false);
        }
    }, [selectedMarket]);

    // Subscribe to market
    const subscribeToMarket = (symbol: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        wsRef.current.send(JSON.stringify({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: 1000,
            end: 'latest',
            start: 1,
            style: 'ticks',
            subscribe: 1
        }));
    };

    // Handle WebSocket messages
    const handleWebSocketMessage = (data: any) => {
        if (data.tick) {
            handleTick(data.tick);
        } else if (data.history) {
            handleHistory(data);
        }
    };

    // Handle history data
    const handleHistory = (data: any) => {
        if (!data.history?.prices) return;
        
        const prices = data.history.prices;
        const ticks: TickData[] = prices.map((price: string, index: number) => ({
            quote: parseFloat(price),
            symbol: data.echo_req.ticks_history,
            timestamp: Date.now() - (prices.length - index) * 1000,
            digit: Math.floor(parseFloat(price) % 10)
        }));
        
        ticksRef.current = ticks;
        updateAnalysis();
    };

    // Handle live tick
    const handleTick = (tick: any) => {
        const digit = Math.floor(tick.quote % 10);
        
        setLastDigit(digit);
        
        const newTick: TickData = {
            quote: tick.quote,
            symbol: tick.symbol,
            timestamp: Date.now(),
            digit
        };
        
        ticksRef.current.push(newTick);
        if (ticksRef.current.length > 1000) {
            ticksRef.current.shift();
        }
        
        updateAnalysis();
    };

    // Update analysis
    const updateAnalysis = () => {
        const ticks = ticksRef.current;
        if (ticks.length < 100) return;

        const last1000 = ticks.slice(-1000);
        const last50 = ticks.slice(-50);
        const last20 = ticks.slice(-20);
        const last10 = ticks.slice(-10);

        // Count digits
        const digitCounts: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) digitCounts[i] = 0;
        
        last1000.forEach(t => digitCounts[t.digit]++);

        // Calculate percentages
        const digitPercentages: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) {
            digitPercentages[i] = (digitCounts[i] / 10);
        }

        // Even/Odd percentages
        let evenCount = 0, oddCount = 0;
        [0,2,4,6,8].forEach(d => evenCount += digitCounts[d]);
        [1,3,5,7,9].forEach(d => oddCount += digitCounts[d]);
        
        const evenPercentage = evenCount / 10;
        const oddPercentage = oddCount / 10;

        // Over/Under percentages
        let overCount = 0, underCount = 0;
        [5,6,7,8,9].forEach(d => overCount += digitCounts[d]);
        [0,1,2,3,4].forEach(d => underCount += digitCounts[d]);
        
        const overPercentage = overCount / 10;
        const underPercentage = underCount / 10;

        // Current streaks
        let evenStreak = 0, oddStreak = 0, overStreak = 0, underStreak = 0;
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit % 2 === 0) evenStreak++;
            else break;
        }
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit % 2 === 1) oddStreak++;
            else break;
        }
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit >= 5) overStreak++;
            else break;
        }
        
        for (let i = last10.length - 1; i >= 0; i--) {
            if (last10[i].digit <= 4) underStreak++;
            else break;
        }

        // Momentum (last 20 ticks)
        const first10Avg = last20.slice(0, 10).reduce((sum, t) => sum + t.quote, 0) / 10;
        const last10Avg = last20.slice(-10).reduce((sum, t) => sum + t.quote, 0) / 10;
        const momentum20 = ((last10Avg - first10Avg) / first10Avg) * 100;

        // Trend (last 50 ticks)
        const first25Avg = last50.slice(0, 25).reduce((sum, t) => sum + t.quote, 0) / 25;
        const last25Avg = last50.slice(-25).reduce((sum, t) => sum + t.quote, 0) / 25;
        const trend50 = last25Avg > first25Avg ? 'UP' : last25Avg < first25Avg ? 'DOWN' : 'SIDEWAYS';

        // Volatility
        const changes: number[] = [];
        for (let i = 1; i < last1000.length; i++) {
            changes.push(Math.abs(last1000[i].quote - last1000[i-1].quote));
        }
        const avgChange = changes.reduce((a,b) => a + b, 0) / changes.length;
        
        let volatilityLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
        let volatilityScore = 0;
        
        if (avgChange < 0.5) {
            volatilityLevel = 'LOW';
            volatilityScore = 25;
        } else if (avgChange < 1.5) {
            volatilityLevel = 'MEDIUM';
            volatilityScore = 50;
        } else if (avgChange < 3) {
            volatilityLevel = 'HIGH';
            volatilityScore = 75;
        } else {
            volatilityLevel = 'EXTREME';
            volatilityScore = 100;
        }

        // Determine signal
        let signalType: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' | 'NONE' = 'NONE';
        let confidence = 0;
        let strength: 'STRONG' | 'MEDIUM' | 'WEAK' = 'WEAK';
        let mode: 'TREND' | 'REVERSAL' = 'TREND';

        // Check Even/Odd signals
        if (evenPercentage >= 65) {
            signalType = 'ODD';
            mode = 'REVERSAL';
            confidence = Math.min(100, evenPercentage);
        } else if (oddPercentage >= 65) {
            signalType = 'EVEN';
            mode = 'REVERSAL';
            confidence = Math.min(100, oddPercentage);
        } else if (evenPercentage >= 55) {
            signalType = 'EVEN';
            mode = 'TREND';
            confidence = evenPercentage;
        } else if (oddPercentage >= 55) {
            signalType = 'ODD';
            mode = 'TREND';
            confidence = oddPercentage;
        }
        
        // Check Over/Under signals (override if stronger)
        if (overPercentage >= 65) {
            signalType = 'UNDER';
            mode = 'REVERSAL';
            confidence = Math.max(confidence, overPercentage);
        } else if (underPercentage >= 65) {
            signalType = 'OVER';
            mode = 'REVERSAL';
            confidence = Math.max(confidence, underPercentage);
        } else if (overPercentage >= 55 && confidence < overPercentage) {
            signalType = 'OVER';
            mode = 'TREND';
            confidence = overPercentage;
        } else if (underPercentage >= 55 && confidence < underPercentage) {
            signalType = 'UNDER';
            mode = 'TREND';
            confidence = underPercentage;
        }

        // Determine strength
        if (confidence >= 70) strength = 'STRONG';
        else if (confidence >= 55) strength = 'MEDIUM';
        else strength = 'WEAK';

        const analysis: MarketAnalysis = {
            symbol: selectedMarket,
            ticks: last1000,
            digitCounts,
            digitPercentages,
            evenPercentage,
            oddPercentage,
            overPercentage,
            underPercentage,
            last50Digits: last50.map(t => t.digit),
            last20Digits: last20.map(t => t.digit),
            last10Digits: last10.map(t => t.digit),
            currentEvenStreak: evenStreak,
            currentOddStreak: oddStreak,
            currentOverStreak: overStreak,
            currentUnderStreak: underStreak,
            momentum20,
            trend50,
            signal: {
                type: signalType,
                confidence,
                strength,
                mode
            },
            volatility: {
                averageChange: avgChange,
                level: volatilityLevel,
                score: volatilityScore
            }
        };

        setAnalysis(analysis);
        checkBotEntries(analysis);
    };

    // Check entry conditions for all bots
    const checkBotEntries = (analysis: MarketAnalysis) => {
        setBots(prev => prev.map(bot => {
            if (!bot.isRunning || !bot.enabled) return bot;

            // Check volatility range
            if (analysis.volatility.score < bot.minVolatility || 
                analysis.volatility.score > bot.maxVolatility) {
                return bot;
            }

            const lastDigits = analysis.last10Digits;
            const currentDigit = lastDigits[lastDigits.length - 1];
            
            // Determine what we're looking for
            let targetCondition: boolean;
            let oppositeCondition: boolean;
            
            if (bot.type === 'even') {
                targetCondition = currentDigit % 2 === 0;
                oppositeCondition = currentDigit % 2 === 1;
            } else if (bot.type === 'odd') {
                targetCondition = currentDigit % 2 === 1;
                oppositeCondition = currentDigit % 2 === 0;
            } else if (bot.type === 'over') {
                targetCondition = currentDigit >= 5;
                oppositeCondition = currentDigit <= 4;
            } else { // under
                targetCondition = currentDigit <= 4;
                oppositeCondition = currentDigit >= 5;
            }

            // Check if we should enter based on mode
            let shouldEnter = false;
            
            if (bot.mode === 'trend') {
                // Trend mode: look for target
                shouldEnter = targetCondition;
                
                // Reset opposite counter if we see target
                if (targetCondition) {
                    bot.consecutiveOpposite = 0;
                } else if (oppositeCondition) {
                    bot.consecutiveOpposite++;
                }
            } else {
                // Reversal mode: look for 2 consecutive opposites then target
                if (oppositeCondition) {
                    bot.consecutiveOpposite++;
                } else {
                    bot.consecutiveOpposite = 0;
                }
                
                if (bot.consecutiveOpposite >= 2 && targetCondition) {
                    shouldEnter = true;
                    bot.consecutiveOpposite = 0;
                }
            }

            // Apply entry filter if enabled
            if (bot.useEntryFilter && shouldEnter) {
                // Check confidence based on bot type
                if (bot.type === 'even' || bot.type === 'odd') {
                    const relevantPercentage = bot.type === 'even' ? 
                        analysis.evenPercentage : analysis.oddPercentage;
                    shouldEnter = relevantPercentage >= (bot.mode === 'trend' ? 55 : 65);
                } else {
                    const relevantPercentage = bot.type === 'over' ? 
                        analysis.overPercentage : analysis.underPercentage;
                    shouldEnter = relevantPercentage >= (bot.mode === 'trend' ? 55 : 65);
                }
            }

            if (shouldEnter) {
                bot.status = 'confirming';
                bot.lastEntrySignal = Date.now();
                
                // Execute trade
                executeTrade(bot, analysis);
            } else {
                bot.status = 'watching';
            }

            return bot;
        }));
    };

    // Execute trade
    const executeTrade = (bot: Bot, analysis: MarketAnalysis) => {
        if (!demoMode && !isConnected) {
            toast({
                title: 'Not Connected',
                description: 'Cannot execute live trade',
                variant: 'destructive',
            });
            return;
        }

        const lastTick = analysis.ticks[analysis.ticks.length - 1];
        
        // Simulate trade result
        setTimeout(() => {
            const resultDigit = Math.floor(Math.random() * 10);
            let won = false;
            
            if (bot.type === 'even') {
                won = resultDigit % 2 === 0;
            } else if (bot.type === 'odd') {
                won = resultDigit % 2 === 1;
            } else if (bot.type === 'over') {
                won = resultDigit >= 5;
            } else { // under
                won = resultDigit <= 4;
            }

            const profit = won ? bot.currentStake * 0.95 : -bot.currentStake;

            const trade: Trade = {
                id: `trade-${Date.now()}-${Math.random()}`,
                botId: bot.id,
                botName: bot.name,
                type: bot.type,
                mode: bot.mode,
                market: bot.market,
                entry: bot.type,
                stake: bot.currentStake,
                result: won ? 'win' : 'loss',
                profit,
                entryDigit: lastTick.digit,
                resultDigit,
                timestamp: Date.now(),
                confidence: analysis.signal.confidence
            };

            setActiveTrade(trade);
            setTrades(prev => [trade, ...prev].slice(0, 100));

            // Update bot stats
            setBots(prev => prev.map(b => {
                if (b.id === bot.id) {
                    const newTrades = b.trades + 1;
                    const newWins = won ? b.wins + 1 : b.wins;
                    const newLosses = won ? b.losses : b.losses + 1;
                    const newPnl = b.totalPnl + profit;

                    // Update stake based on martingale
                    let newStake = b.stake;
                    let newRecoveryStep = 0;
                    
                    if (b.useMartingale) {
                        if (won) {
                            newStake = b.stake;
                            newRecoveryStep = 0;
                        } else {
                            newRecoveryStep = b.recoveryStep + 1;
                            if (newRecoveryStep <= b.maxSteps) {
                                newStake = b.stake * Math.pow(b.multiplier, newRecoveryStep);
                            }
                        }
                    }

                    return {
                        ...b,
                        trades: newTrades,
                        wins: newWins,
                        losses: newLosses,
                        totalPnl: newPnl,
                        currentStake: newStake,
                        recoveryStep: newRecoveryStep,
                        currentRun: won ? b.currentRun + 1 : b.currentRun,
                        status: 'watching'
                    };
                }
                return b;
            }));

            // Update balance
            if (demoMode) {
                setBalance(prev => prev + profit);
            }

            setTimeout(() => {
                setActiveTrade(null);
            }, 3000);
        }, 2000);
    };

    // Start bot
    const startBot = (botId: string) => {
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                runningBotsRef.current.add(botId);
                return { 
                    ...b, 
                    isRunning: true, 
                    status: 'watching',
                    currentStake: b.stake,
                    recoveryStep: 0,
                    consecutiveOpposite: 0
                };
            }
            return b;
        }));

        toast({
            title: 'Bot Started',
            description: 'Bot is now watching for signals',
        });
    };

    // Stop bot
    const stopBot = (botId: string) => {
        runningBotsRef.current.delete(botId);
        
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                return { ...b, isRunning: false, status: 'stopped' };
            }
            return b;
        }));
    };

    // Start all bots
    const startAllBots = () => {
        bots.forEach(bot => {
            if (bot.enabled && !bot.isRunning) {
                startBot(bot.id);
            }
        });
    };

    // Stop all bots
    const stopAllBots = () => {
        runningBotsRef.current.clear();
        
        setBots(prev => prev.map(b => ({
            ...b,
            isRunning: false,
            status: 'stopped'
        })));
    };

    // Toggle bot enabled
    const toggleBotEnabled = (botId: string) => {
        setBots(prev => prev.map(b => {
            if (b.id === botId) {
                if (b.isRunning) {
                    stopBot(botId);
                }
                return { ...b, enabled: !b.enabled };
            }
            return b;
        }));
    };

    // Calculate stats
    const totalTrades = trades.filter(t => t.result !== 'pending').length;
    const totalWins = trades.filter(t => t.result === 'win').length;
    const totalPnl = bots.reduce((sum, b) => sum + b.totalPnl, 0);
    const activeBots = bots.filter(b => b.isRunning).length;
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

    // Connect on mount
    useEffect(() => {
        connectWebSocket();
        
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
        };
    }, []);

    // Change market
    useEffect(() => {
        if (isConnected) {
            subscribeToMarket(selectedMarket);
        }
    }, [selectedMarket, isConnected]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 p-4">
            <div className="max-w-7xl mx-auto space-y-4">
                {/* Header */}
                <Card className="bg-white/95 backdrop-blur border-2">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                                <Brain className="h-8 w-8 text-primary" />
                                <div>
                                    <CardTitle className="text-xl font-bold">
                                        Deriv Trading Bot - 6 Bots System
                                    </CardTitle>
                                    <CardDescription>
                                        Even/Odd • Over/Under • Smart Entry Filters
                                    </CardDescription>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Button variant="ghost" size="sm" onClick={() => setSound(!sound)}>
                                    {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                                </Button>
                                <Badge variant={isConnected ? "default" : "destructive"}>
                                    {isConnected ? '● LIVE' : '○ OFFLINE'}
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>

                    {/* Stats Bar */}
                    <CardContent className="pb-2">
                        <div className="grid grid-cols-5 gap-2">
                            <div className="bg-muted/30 rounded p-2">
                                <div className="text-xs text-muted-foreground">Mode</div>
                                <div className="flex items-center space-x-2">
                                    <Badge variant={demoMode ? "outline" : "default"}>
                                        {demoMode ? 'DEMO' : 'LIVE'}
                                    </Badge>
                                    <Switch checked={!demoMode} onCheckedChange={(v) => setDemoMode(!v)} />
                                </div>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <div className="text-xs text-muted-foreground">Balance</div>
                                <div className="font-bold text-green-500">${balance.toFixed(2)}</div>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <div className="text-xs text-muted-foreground">Total P&L</div>
                                <div className={totalPnl >= 0 ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>
                                    ${totalPnl.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <div className="text-xs text-muted-foreground">Active Bots</div>
                                <div className="font-bold">{activeBots}/6</div>
                            </div>
                            <div className="bg-muted/30 rounded p-2">
                                <div className="text-xs text-muted-foreground">Win Rate</div>
                                <div className="font-bold text-green-500">{winRate.toFixed(1)}%</div>
                            </div>
                        </div>
                    </CardContent>

                    {/* Controls */}
                    <CardFooter className="flex justify-between">
                        <div className="flex space-x-2">
                            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                                <SelectTrigger className="w-[200px]">
                                    <SelectValue placeholder="Select Market" />
                                </SelectTrigger>
                                <SelectContent>
                                    {MARKETS.map(m => (
                                        <SelectItem key={m.value} value={m.value}>
                                            {m.icon} {m.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            
                            <Button variant="outline" size="sm" onClick={startAllBots}>
                                <Play className="h-4 w-4 mr-2" />
                                Start All
                            </Button>
                            <Button variant="destructive" size="sm" onClick={stopAllBots}>
                                <StopCircle className="h-4 w-4 mr-2" />
                                Stop All
                            </Button>
                        </div>

                        <div className="flex items-center space-x-4">
                            <div className="flex items-center space-x-2">
                                <Label className="text-xs">Min Vol</Label>
                                <Input 
                                    type="number"
                                    value={globalVolatility.min}
                                    onChange={(e) => setGlobalVolatility(prev => ({ ...prev, min: parseInt(e.target.value) || 0 }))}
                                    className="w-16 h-7 text-xs"
                                    min="0"
                                    max="100"
                                />
                            </div>
                            <div className="flex items-center space-x-2">
                                <Label className="text-xs">Max Vol</Label>
                                <Input 
                                    type="number"
                                    value={globalVolatility.max}
                                    onChange={(e) => setGlobalVolatility(prev => ({ ...prev, max: parseInt(e.target.value) || 100 }))}
                                    className="w-16 h-7 text-xs"
                                    min="0"
                                    max="100"
                                />
                            </div>
                        </div>
                    </CardFooter>
                </Card>

                {/* Live Analysis Display */}
                {analysis && (
                    <Card className="bg-white/95 border-2 border-primary/20">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-lg">Live Analysis - {selectedMarket}</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-4 gap-4">
                                {/* Digit Distribution */}
                                <div>
                                    <div className="text-xs text-muted-foreground mb-2">Digit Distribution</div>
                                    <div className="grid grid-cols-5 gap-1">
                                        {[0,1,2,3,4,5,6,7,8,9].map(d => (
                                            <div key={d} className="text-center">
                                                <div className="text-xs font-bold">{d}</div>
                                                <Progress 
                                                    value={analysis.digitPercentages[d]} 
                                                    className="h-1"
                                                />
                                                <div className="text-[8px] text-muted-foreground">
                                                    {analysis.digitPercentages[d].toFixed(1)}%
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* Percentages */}
                                <div>
                                    <div className="text-xs text-muted-foreground mb-2">Statistics</div>
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-xs">Even:</span>
                                            <span className="text-xs font-bold text-purple-500">
                                                {analysis.evenPercentage.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs">Odd:</span>
                                            <span className="text-xs font-bold text-orange-500">
                                                {analysis.oddPercentage.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs">Over (5-9):</span>
                                            <span className="text-xs font-bold text-blue-500">
                                                {analysis.overPercentage.toFixed(1)}%
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-xs">Under (0-4):</span>
                                            <span className="text-xs font-bold text-green-500">
                                                {analysis.underPercentage.toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Current Signal */}
                                <div>
                                    <div className="text-xs text-muted-foreground mb-2">Current Signal</div>
                                    {analysis.signal.type !== 'NONE' ? (
                                        <div className="space-y-2">
                                            <Badge className={`
                                                text-sm px-3 py-1
                                                ${analysis.signal.type === 'EVEN' ? 'bg-purple-500' : ''}
                                                ${analysis.signal.type === 'ODD' ? 'bg-orange-500' : ''}
                                                ${analysis.signal.type === 'OVER' ? 'bg-blue-500' : ''}
                                                ${analysis.signal.type === 'UNDER' ? 'bg-green-500' : ''}
                                            `}>
                                                BUY {analysis.signal.type}
                                            </Badge>
                                            <div className="flex items-center space-x-2">
                                                <span className="text-xs">Confidence:</span>
                                                <Progress value={analysis.signal.confidence} className="w-20 h-2" />
                                                <span className="text-xs font-bold">
                                                    {analysis.signal.confidence.toFixed(0)}%
                                                </span>
                                            </div>
                                            <Badge variant="outline" className="text-xs">
                                                {analysis.signal.mode} • {analysis.signal.strength}
                                            </Badge>
                                        </div>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">No signal</div>
                                    )}
                                </div>

                                {/* Streaks & Volatility */}
                                <div>
                                    <div className="text-xs text-muted-foreground mb-2">Streaks</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <div className="text-[10px]">Even: {analysis.currentEvenStreak}</div>
                                            <div className="text-[10px]">Odd: {analysis.currentOddStreak}</div>
                                        </div>
                                        <div>
                                            <div className="text-[10px]">Over: {analysis.currentOverStreak}</div>
                                            <div className="text-[10px]">Under: {analysis.currentUnderStreak}</div>
                                        </div>
                                        <div className="col-span-2 mt-2">
                                            <div className="flex items-center space-x-1">
                                                {VOLATILITY_ICONS[analysis.volatility.level]}
                                                <span className="text-xs">Vol: {analysis.volatility.level}</span>
                                                <Badge variant="outline" className="text-[8px]">
                                                    Δ{analysis.volatility.averageChange.toFixed(2)}
                                                </Badge>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Last 20 Digits */}
                            <div className="mt-4">
                                <div className="text-xs text-muted-foreground mb-2">Last 20 Digits</div>
                                <div className="flex space-x-1">
                                    {analysis.last20Digits.map((d, i) => (
                                        <div
                                            key={i}
                                            className={`
                                                w-6 h-6 flex items-center justify-center text-xs rounded
                                                ${d >= 5 ? 'bg-blue-500/20' : 'bg-green-500/20'}
                                                ${i === analysis.last20Digits.length - 1 ? 'ring-2 ring-primary' : ''}
                                            `}
                                        >
                                            {d}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                )}

                {/* Bots Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {bots.map((bot, index) => {
                        const botConfig = BOT_TYPES[index];
                        
                        return (
                            <Card key={bot.id} className={`
                                border-2 transition-all
                                ${bot.enabled ? `border-${botConfig.color}-500/50` : 'border-gray-300'}
                                ${bot.isRunning ? `shadow-lg shadow-${botConfig.color}-500/20` : ''}
                            `}>
                                <CardHeader className="p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center space-x-2">
                                            <div className={`p-1.5 rounded bg-${botConfig.color}-500/10`}>
                                                {botConfig.icon}
                                            </div>
                                            <div>
                                                <CardTitle className="text-sm font-bold">
                                                    {bot.name}
                                                </CardTitle>
                                                <CardDescription className="text-xs">
                                                    {bot.mode} • {bot.market}
                                                </CardDescription>
                                            </div>
                                        </div>
                                        <div className="flex items-center space-x-1">
                                            <Switch
                                                checked={bot.enabled}
                                                onCheckedChange={() => toggleBotEnabled(bot.id)}
                                                className="scale-75"
                                            />
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0"
                                                onClick={() => setBots(prev => prev.map(b => 
                                                    b.id === bot.id ? { ...b, expanded: !b.expanded } : b
                                                ))}
                                            >
                                                {bot.expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>

                                <CardContent className="p-3 pt-0">
                                    {/* Status */}
                                    <div className="flex items-center justify-between mb-2">
                                        <Badge variant={bot.isRunning ? "default" : "outline"} className="text-xs">
                                            {bot.isRunning ? bot.status.toUpperCase() : 'STOPPED'}
                                        </Badge>
                                        <div className="flex items-center space-x-1">
                                            <span className="text-xs">P&L:</span>
                                            <span className={bot.totalPnl >= 0 ? 'text-green-500 font-bold' : 'text-red-500 font-bold'}>
                                                ${bot.totalPnl.toFixed(2)}
                                            </span>
                                        </div>
                                    </div>

                                    {/* Stats */}
                                    <div className="grid grid-cols-3 gap-1 mb-2">
                                        <div className="bg-muted/30 rounded p-1">
                                            <div className="text-[8px] text-muted-foreground">Trades</div>
                                            <div className="text-xs font-bold">{bot.trades}</div>
                                        </div>
                                        <div className="bg-muted/30 rounded p-1">
                                            <div className="text-[8px] text-muted-foreground">Wins</div>
                                            <div className="text-xs font-bold text-green-500">{bot.wins}</div>
                                        </div>
                                        <div className="bg-muted/30 rounded p-1">
                                            <div className="text-[8px] text-muted-foreground">Losses</div>
                                            <div className="text-xs font-bold text-red-500">{bot.losses}</div>
                                        </div>
                                    </div>

                                    {/* Recovery Progress */}
                                    {bot.recoveryStep > 0 && (
                                        <div className="mb-2">
                                            <div className="flex justify-between text-[8px]">
                                                <span>Recovery Step {bot.recoveryStep}/{bot.maxSteps}</span>
                                                <span className="text-orange-500">${bot.currentStake.toFixed(2)}</span>
                                            </div>
                                            <Progress value={(bot.recoveryStep / bot.maxSteps) * 100} className="h-1" />
                                        </div>
                                    )}

                                    {/* Run Progress */}
                                    <div className="flex space-x-1">
                                        {[1,2,3].map(step => (
                                            <div
                                                key={step}
                                                className={`flex-1 h-1 rounded-full ${
                                                    step <= bot.currentRun ? `bg-${botConfig.color}-500` : 'bg-muted'
                                                }`}
                                            />
                                        ))}
                                    </div>

                                    {/* Expanded Settings */}
                                    {bot.expanded && (
                                        <>
                                            <Separator className="my-2" />
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <Label className="text-[8px]">Stake ($)</Label>
                                                    <Input
                                                        type="number"
                                                        value={bot.stake}
                                                        onChange={e => setBots(prev => prev.map(b => 
                                                            b.id === bot.id ? { ...b, stake: parseFloat(e.target.value) || 0.1 } : b
                                                        ))}
                                                        disabled={bot.isRunning}
                                                        className="h-6 text-xs"
                                                        step="0.1"
                                                        min="0.1"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-[8px]">Duration</Label>
                                                    <Select
                                                        value={bot.duration.toString()}
                                                        onValueChange={v => setBots(prev => prev.map(b => 
                                                            b.id === bot.id ? { ...b, duration: parseInt(v) } : b
                                                        ))}
                                                        disabled={bot.isRunning}
                                                    >
                                                        <SelectTrigger className="h-6 text-xs">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {[1,2,3,4,5,6,7,8,9,10].map(d => (
                                                                <SelectItem key={d} value={d.toString()} className="text-xs">
                                                                    {d} ticks
                                                                </SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label className="text-[8px]">Take Profit</Label>
                                                    <Input
                                                        type="number"
                                                        value={bot.takeProfit}
                                                        onChange={e => setBots(prev => prev.map(b => 
                                                            b.id === bot.id ? { ...b, takeProfit: parseFloat(e.target.value) || 0 } : b
                                                        ))}
                                                        disabled={bot.isRunning}
                                                        className="h-6 text-xs"
                                                    />
                                                </div>
                                                <div>
                                                    <Label className="text-[8px]">Stop Loss</Label>
                                                    <Input
                                                        type="number"
                                                        value={bot.stopLoss}
                                                        onChange={e => setBots(prev => prev.map(b => 
                                                            b.id === bot.id ? { ...b, stopLoss: parseFloat(e.target.value) || 0 } : b
                                                        ))}
                                                        disabled={bot.isRunning}
                                                        className="h-6 text-xs"
                                                    />
                                                </div>
                                                <div className="col-span-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-[8px]">Martingale</Label>
                                                        <Switch
                                                            checked={bot.useMartingale}
                                                            onCheckedChange={v => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, useMartingale: v } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="scale-75"
                                                        />
                                                    </div>
                                                    {bot.useMartingale && (
                                                        <div className="grid grid-cols-2 gap-2 mt-2">
                                                            <div>
                                                                <Label className="text-[8px]">Multiplier</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={bot.multiplier}
                                                                    onChange={e => setBots(prev => prev.map(b => 
                                                                        b.id === bot.id ? { ...b, multiplier: parseFloat(e.target.value) || 1.5 } : b
                                                                    ))}
                                                                    disabled={bot.isRunning}
                                                                    className="h-6 text-xs"
                                                                    step="0.1"
                                                                    min="1.1"
                                                                />
                                                            </div>
                                                            <div>
                                                                <Label className="text-[8px]">Max Steps</Label>
                                                                <Input
                                                                    type="number"
                                                                    value={bot.maxSteps}
                                                                    onChange={e => setBots(prev => prev.map(b => 
                                                                        b.id === bot.id ? { ...b, maxSteps: parseInt(e.target.value) || 1 } : b
                                                                    ))}
                                                                    disabled={bot.isRunning}
                                                                    className="h-6 text-xs"
                                                                    min="1"
                                                                    max="5"
                                                                />
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="col-span-2">
                                                    <div className="flex items-center justify-between">
                                                        <Label className="text-[8px]">Entry Filter</Label>
                                                        <Switch
                                                            checked={bot.useEntryFilter}
                                                            onCheckedChange={v => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, useEntryFilter: v } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="scale-75"
                                                        />
                                                    </div>
                                                </div>
                                                <div className="col-span-2">
                                                    <Label className="text-[8px]">Volatility Range</Label>
                                                    <div className="flex items-center space-x-2">
                                                        <Input
                                                            type="number"
                                                            value={bot.minVolatility}
                                                            onChange={e => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, minVolatility: parseInt(e.target.value) || 0 } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs"
                                                            min="0"
                                                            max="100"
                                                            placeholder="Min"
                                                        />
                                                        <span>-</span>
                                                        <Input
                                                            type="number"
                                                            value={bot.maxVolatility}
                                                            onChange={e => setBots(prev => prev.map(b => 
                                                                b.id === bot.id ? { ...b, maxVolatility: parseInt(e.target.value) || 100 } : b
                                                            ))}
                                                            disabled={bot.isRunning}
                                                            className="h-6 text-xs"
                                                            min="0"
                                                            max="100"
                                                            placeholder="Max"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    )}
                                </CardContent>

                                <CardFooter className="p-3 pt-0">
                                    {!bot.isRunning ? (
                                        <Button
                                            className="w-full h-7 text-xs"
                                            onClick={() => startBot(bot.id)}
                                            disabled={!bot.enabled || !analysis}
                                        >
                                            <Play className="h-3 w-3 mr-1" />
                                            Start Bot
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="destructive"
                                            className="w-full h-7 text-xs"
                                            onClick={() => stopBot(bot.id)}
                                        >
                                            <StopCircle className="h-3 w-3 mr-1" />
                                            Stop Bot
                                        </Button>
                                    )}
                                </CardFooter>
                            </Card>
                        );
                    })}
                </div>

                {/* Trades Tab */}
                <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                    <TabsList>
                        <TabsTrigger value="bots">Bots</TabsTrigger>
                        <TabsTrigger value="trades">Trade History ({trades.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="trades">
                        <Card>
                            <CardHeader>
                                <CardTitle>Trade History</CardTitle>
                                <CardDescription>Last 100 trades</CardDescription>
                            </CardHeader>
                            <CardContent>
                                {trades.length === 0 ? (
                                    <div className="text-center text-muted-foreground py-8">
                                        No trades yet
                                    </div>
                                ) : (
                                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                                        {trades.map((trade, i) => (
                                            <div
                                                key={i}
                                                className={`
                                                    flex items-center justify-between p-2 rounded text-xs
                                                    ${trade.result === 'win' ? 'bg-green-500/10' : 'bg-red-500/10'}
                                                    ${activeTrade?.id === trade.id ? 'ring-2 ring-primary' : ''}
                                                `}
                                            >
                                                <div className="flex items-center space-x-2">
                                                    <span className="text-muted-foreground">
                                                        {new Date(trade.timestamp).toLocaleTimeString()}
                                                    </span>
                                                    <Badge variant="outline" className="text-[8px]">
                                                        {trade.botName}
                                                    </Badge>
                                                    <span>
                                                        {trade.entryDigit} → {trade.resultDigit}
                                                    </span>
                                                </div>
                                                <div className="flex items-center space-x-3">
                                                    <span className="text-muted-foreground">
                                                        ${trade.stake.toFixed(2)}
                                                    </span>
                                                    <span className={trade.result === 'win' ? 'text-green-500' : 'text-red-500'}>
                                                        {trade.result === 'win' ? '+' : '-'}${Math.abs(trade.profit).toFixed(2)}
                                                    </span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
}
