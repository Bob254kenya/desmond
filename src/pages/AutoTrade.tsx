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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ScrollArea } from '@/components/ui/scroll-area';
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
    AlertTriangle
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
    percentages: Record<number, number>;
    low012Percentage: number;
    high789Percentage: number;
    underPercentage: number;
    overPercentage: number;
    evenPercentage: number;
    oddPercentage: number;
    mostFrequentDigit: number;
    leastFrequentDigit: number;
    last10Digits: number[];
    last20Digits: number[];
    last50Digits: number[];
    consecutivePattern: number;
    trend: 'UP' | 'DOWN' | 'SIDEWAYS';
    momentum: number;
    condition: 'NONE' | 'EVEN_TREND' | 'ODD_TREND' | 'EVEN_REVERSAL' | 'ODD_REVERSAL' | 'OVER_TREND' | 'UNDER_TREND' | 'OVER_REVERSAL' | 'UNDER_REVERSAL';
    entryPrediction: number | 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
    confidence: number;
    signalStrength: number;
    volatility: {
        averageChange: number;
        volatilityIndex: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
        trend: 'UP' | 'DOWN' | 'SIDEWAYS';
        score: number;
    };
}

interface Bot {
    id: string;
    name: string;
    category: 'even_odd' | 'over_under';
    strategy: 'trend' | 'reversal' | 'recovery';
    market: string;
    entryType: 'even' | 'odd' | 'over' | 'under' | 'digit';
    entryValue: number | 'EVEN' | 'ODD' | 'OVER' | 'UNDER';
    stake: number;
    duration: number;
    multiplier: number;
    maxSteps: number;
    takeProfit: number;
    stopLoss: number;
    confirmationCount: number;
    requireConsecutive: boolean;
    checkVolatility: boolean;
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
    consecutiveHits: number;
    lastEntrySignal: number | null;
    lastAnalysis: MarketAnalysis | null;
    expanded: boolean;
}

interface Trade {
    id: string;
    botId: string;
    botName: string;
    category: string;
    market: string;
    entryType: string;
    entryValue: string;
    stake: number;
    result: 'win' | 'loss' | 'pending';
    profit: number;
    entryDigit: number;
    resultDigit: number;
    entryPrice: number;
    resultPrice: number;
    timestamp: number;
    duration: number;
    volatility: number;
    confidence: number;
}

// Constants
const DERIV_WS_URL = 'wss://ws.derivws.com/websockets/v3?app_id=1089';

const MARKETS = [
    // Volatility Indices
    { value: 'R_10', label: 'Volatility 10', icon: '📊', group: 'volatility', volatility: 'LOW' },
    { value: 'R_25', label: 'Volatility 25', icon: '📊', group: 'volatility', volatility: 'MEDIUM' },
    { value: 'R_50', label: 'Volatility 50', icon: '📊', group: 'volatility', volatility: 'MEDIUM' },
    { value: 'R_75', label: 'Volatility 75', icon: '📊', group: 'volatility', volatility: 'HIGH' },
    { value: 'R_100', label: 'Volatility 100', icon: '📊', group: 'volatility', volatility: 'EXTREME' },
    
    // 1HZ Indices
    { value: '1HZ10V', label: '1HZ 10', icon: '⚡', group: '1hz', volatility: 'LOW' },
    { value: '1HZ25V', label: '1HZ 25', icon: '⚡', group: '1hz', volatility: 'LOW' },
    { value: '1HZ50V', label: '1HZ 50', icon: '⚡', group: '1hz', volatility: 'MEDIUM' },
    { value: '1HZ75V', label: '1HZ 75', icon: '⚡', group: '1hz', volatility: 'MEDIUM' },
    { value: '1HZ100V', label: '1HZ 100', icon: '⚡', group: '1hz', volatility: 'HIGH' },
    
    // Jump Indices
    { value: 'JD10', label: 'Jump 10', icon: '🦘', group: 'jump', volatility: 'HIGH' },
    { value: 'JD25', label: 'Jump 25', icon: '🦘', group: 'jump', volatility: 'HIGH' },
    { value: 'JD50', label: 'Jump 50', icon: '🦘', group: 'jump', volatility: 'EXTREME' },
    { value: 'JD75', label: 'Jump 75', icon: '🦘', group: 'jump', volatility: 'EXTREME' },
    { value: 'JD100', label: 'Jump 100', icon: '🦘', group: 'jump', volatility: 'EXTREME' },
    
    // Boom & Crash
    { value: 'BOOM300', label: 'Boom 300', icon: '💥', group: 'boom', volatility: 'HIGH' },
    { value: 'BOOM500', label: 'Boom 500', icon: '💥', group: 'boom', volatility: 'HIGH' },
    { value: 'BOOM1000', label: 'Boom 1000', icon: '💥', group: 'boom', volatility: 'MEDIUM' },
    { value: 'CRASH300', label: 'Crash 300', icon: '📉', group: 'crash', volatility: 'HIGH' },
    { value: 'CRASH500', label: 'Crash 500', icon: '📉', group: 'crash', volatility: 'HIGH' },
    { value: 'CRASH1000', label: 'Crash 1000', icon: '📉', group: 'crash', volatility: 'MEDIUM' },
    
    // Bull & Bear
    { value: 'RDBULL', label: 'Bull Market', icon: '🐂', group: 'bull', volatility: 'HIGH' },
    { value: 'RDBEAR', label: 'Bear Market', icon: '🐻', group: 'bear', volatility: 'HIGH' }
];

const BOT_CATEGORIES = {
    even_odd: {
        trend: {
            even: { name: 'Even Trend Bot', color: 'purple', icon: <CircleDot className="w-4 h-4" /> },
            odd: { name: 'Odd Trend Bot', color: 'orange', icon: <Hash className="w-4 h-4" /> }
        },
        reversal: {
            even: { name: 'Even Reversal Bot', color: 'purple', icon: <RefreshCw className="w-4 h-4" /> },
            odd: { name: 'Odd Reversal Bot', color: 'orange', icon: <RefreshCw className="w-4 h-4" /> }
        },
        recovery: {
            even: { name: 'Even Recovery Bot', color: 'purple', icon: <Activity className="w-4 h-4" /> },
            odd: { name: 'Odd Recovery Bot', color: 'orange', icon: <Activity className="w-4 h-4" /> }
        }
    },
    over_under: {
        trend: {
            over: { name: 'Over Trend Bot', color: 'blue', icon: <ArrowUp className="w-4 h-4" /> },
            under: { name: 'Under Trend Bot', color: 'green', icon: <ArrowDown className="w-4 h-4" /> }
        },
        reversal: {
            over: { name: 'Over Reversal Bot', color: 'blue', icon: <RefreshCw className="w-4 h-4" /> },
            under: { name: 'Under Reversal Bot', color: 'green', icon: <RefreshCw className="w-4 h-4" /> }
        },
        recovery: {
            over: { name: 'Over Recovery Bot', color: 'blue', icon: <Activity className="w-4 h-4" /> },
            under: { name: 'Under Recovery Bot', color: 'green', icon: <Activity className="w-4 h-4" /> }
        }
    }
};

const VOLATILITY_ICONS = {
    LOW: <Snowflake className="w-3 h-3 text-blue-400" />,
    MEDIUM: <Wind className="w-3 h-3 text-yellow-400" />,
    HIGH: <Waves className="w-3 h-3 text-orange-400" />,
    EXTREME: <Flame className="w-3 h-3 text-red-400" />
};

// Main Component
export default function DerivTradingBot() {
    const { toast } = useToast();
    
    // State
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [apiToken, setApiToken] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [balance, setBalance] = useState(10000); // Demo balance
    const [demoMode, setDemoMode] = useState(true);
    const [sound, setSound] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState(0);
    const [selectedMarket, setSelectedMarket] = useState('R_100');
    const [marketGroup, setMarketGroup] = useState('all');
    const [analyses, setAnalyses] = useState<Record<string, MarketAnalysis>>({});
    const [bots, setBots] = useState<Bot[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [activeTrade, setActiveTrade] = useState<Trade | null>(null);
    const [selectedTab, setSelectedTab] = useState('bots');
    const [autoCreateBots, setAutoCreateBots] = useState(true);
    const [globalVolatilityCheck, setGlobalVolatilityCheck] = useState(true);
    const [signalAlert, setSignalAlert] = useState(true);
    const [lastSignal, setLastSignal] = useState<{ market: string; type: string; confidence: number } | null>(null);

    // WebSocket Refs
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
    const marketTicksRef = useRef<Record<string, TickData[]>>({});
    const runningBotsRef = useRef<Set<string>>(new Set());
    const pendingRequestsRef = useRef<Map<string, (value: any) => void>>(new Map());
    const requestIdRef = useRef(0);
    const audioContextRef = useRef<AudioContext | null>(null);

    // Initialize 12 Bots
    useEffect(() => {
        const initialBots: Bot[] = [];
        
        // Create 12 bots with different configurations
        
        // EVEN/ODD BOTS
        // 1. Even Trend Bot
        initialBots.push(createBot('even_odd', 'trend', 'even', 'R_100', 1, 5));
        // 2. Odd Trend Bot
        initialBots.push(createBot('even_odd', 'trend', 'odd', 'R_100', 2, 5));
        // 3. Even Reversal Bot
        initialBots.push(createBot('even_odd', 'reversal', 'even', 'R_100', 3, 5));
        // 4. Odd Reversal Bot
        initialBots.push(createBot('even_odd', 'reversal', 'odd', 'R_100', 4, 5));
        // 5. Even Recovery Bot
        initialBots.push(createBot('even_odd', 'recovery', 'even', 'R_100', 5, 5));
        // 6. Odd Recovery Bot
        initialBots.push(createBot('even_odd', 'recovery', 'odd', 'R_100', 6, 5));
        
        // OVER/UNDER BOTS
        // 7. Over Trend Bot
        initialBots.push(createBot('over_under', 'trend', 'over', 'R_100', 7, 5));
        // 8. Under Trend Bot
        initialBots.push(createBot('over_under', 'trend', 'under', 'R_100', 8, 5));
        // 9. Over Reversal Bot
        initialBots.push(createBot('over_under', 'reversal', 'over', 'R_100', 9, 5));
        // 10. Under Reversal Bot
        initialBots.push(createBot('over_under', 'reversal', 'under', 'R_100', 10, 5));
        // 11. Over Recovery Bot
        initialBots.push(createBot('over_under', 'recovery', 'over', 'R_100', 11, 5));
        // 12. Under Recovery Bot
        initialBots.push(createBot('over_under', 'recovery', 'under', 'R_100', 12, 5));
        
        setBots(initialBots);
    }, []);

    // Create Bot Helper
    const createBot = (
        category: 'even_odd' | 'over_under',
        strategy: 'trend' | 'reversal' | 'recovery',
        type: string,
        market: string,
        index: number,
        duration: number
    ): Bot => {
        const config = BOT_CATEGORIES[category][strategy][type as keyof typeof BOT_CATEGORIES[typeof category][typeof strategy]];
        
        let entryType: 'even' | 'odd' | 'over' | 'under' = 'even';
        let entryValue: 'EVEN' | 'ODD' | 'OVER' | 'UNDER' = 'EVEN';
        
        if (category === 'even_odd') {
            entryType = type as 'even' | 'odd';
            entryValue = type === 'even' ? 'EVEN' : 'ODD';
        } else {
            entryType = type as 'over' | 'under';
            entryValue = type === 'over' ? 'OVER' : 'UNDER';
        }
        
        return {
            id: `bot-${index}-${Date.now()}`,
            name: config.name,
            category,
            strategy,
            market,
            entryType,
            entryValue,
            stake: 1,
            duration,
            multiplier: 2,
            maxSteps: 3,
            takeProfit: 20,
            stopLoss: 30,
            confirmationCount: strategy === 'trend' ? 1 : 2,
            requireConsecutive: true,
            checkVolatility: true,
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
            consecutiveHits: 0,
            lastEntrySignal: null,
            lastAnalysis: null,
            expanded: index <= 6
        };
    };

    // Initialize WebSocket Connection
    const connectWebSocket = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return;

        setIsConnecting(true);
        
        try {
            const ws = new WebSocket(DERIV_WS_URL);
            
            ws.onopen = () => {
                console.log('WebSocket connected');
                wsRef.current = ws;
                setIsConnected(true);
                setIsConnecting(false);
                
                toast({
                    title: 'Connected',
                    description: 'WebSocket connection established',
                });
                
                // Subscribe to selected market
                subscribeToMarket(selectedMarket);
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
                setIsConnected(false);
                
                toast({
                    title: 'Connection Error',
                    description: 'Failed to connect to Deriv API',
                    variant: 'destructive',
                });
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);
                setIsConnecting(false);
                
                // Attempt reconnection
                if (reconnectTimeoutRef.current) {
                    clearTimeout(reconnectTimeoutRef.current);
                }
                
                reconnectTimeoutRef.current = setTimeout(() => {
                    connectWebSocket();
                }, 5000);
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('WebSocket connection error:', error);
            setIsConnected(false);
            setIsConnecting(false);
        }
    }, [selectedMarket]);

    // Subscribe to Market
    const subscribeToMarket = useCallback((symbol: string) => {
        if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
        
        // Request historical ticks
        wsRef.current.send(JSON.stringify({
            ticks_history: symbol,
            adjust_start_time: 1,
            count: 1000,
            end: 'latest',
            start: 1,
            style: 'ticks',
            subscribe: 1
        }));
    }, []);

    // Handle WebSocket Messages
    const handleWebSocketMessage = (data: any) => {
        // Handle tick updates
        if (data.tick) {
            handleTickUpdate(data.tick);
        }
        
        // Handle history response
        if (data.history) {
            handleHistoryData(data);
        }
    };

    // Handle History Data
    const handleHistoryData = (data: any) => {
        const symbol = data.echo_req?.ticks_history;
        if (!symbol || !data.history?.prices) return;
        
        const prices = data.history.prices;
        const ticks: TickData[] = prices.map((price: string, index: number) => ({
            quote: parseFloat(price),
            symbol,
            timestamp: Date.now() - (prices.length - index) * 1000,
            digit: Math.floor(parseFloat(price) % 10)
        }));
        
        marketTicksRef.current[symbol] = ticks;
        updateMarketAnalysis(symbol);
    };

    // Handle Tick Updates
    const handleTickUpdate = (tick: any) => {
        const symbol = tick.symbol;
        const quote = tick.quote;
        const digit = Math.floor(quote % 10);
        
        const tickData: TickData = {
            quote,
            symbol,
            timestamp: Date.now(),
            digit
        };
        
        // Store tick in memory
        if (!marketTicksRef.current[symbol]) {
            marketTicksRef.current[symbol] = [];
        }
        
        marketTicksRef.current[symbol].push(tickData);
        
        // Keep only last 1000 ticks
        if (marketTicksRef.current[symbol].length > 1000) {
            marketTicksRef.current[symbol].shift();
        }
        
        // Update analysis
        updateMarketAnalysis(symbol);
    };

    // Update Market Analysis
    const updateMarketAnalysis = (symbol: string) => {
        const ticks = marketTicksRef.current[symbol];
        if (!ticks || ticks.length < 100) return;
        
        const last1000 = ticks.slice(-1000);
        const last100 = ticks.slice(-100);
        const last50 = ticks.slice(-50);
        const last20 = ticks.slice(-20);
        const last10 = ticks.slice(-10);
        
        // Count digits
        const digitCounts: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) digitCounts[i] = 0;
        
        last1000.forEach(tick => {
            digitCounts[tick.digit]++;
        });
        
        // Calculate percentages
        const percentages: Record<number, number> = {};
        for (let i = 0; i <= 9; i++) {
            percentages[i] = (digitCounts[i] / 10);
        }
        
        // Calculate group percentages
        const low012Percentage = (digitCounts[0] + digitCounts[1] + digitCounts[2]) / 10;
        const high789Percentage = (digitCounts[7] + digitCounts[8] + digitCounts[9]) / 10;
        
        // Calculate Over/Under percentages
        let underCount = 0, overCount = 0;
        [0,1,2,3,4].forEach(d => underCount += digitCounts[d]);
        [5,6,7,8,9].forEach(d => overCount += digitCounts[d]);
        
        const underPercentage = underCount / 10;
        const overPercentage = overCount / 10;
        
        // Calculate Even/Odd percentages
        let evenCount = 0, oddCount = 0;
        [0,2,4,6,8].forEach(d => evenCount += digitCounts[d]);
        [1,3,5,7,9].forEach(d => oddCount += digitCounts[d]);
        
        const evenPercentage = evenCount / 10;
        const oddPercentage = oddCount / 10;
        
        // Get recent digits
        const last10Digits = last10.map(t => t.digit);
        const last20Digits = last20.map(t => t.digit);
        const last50Digits = last50.map(t => t.digit);
        
        // Calculate consecutive pattern
        let consecutivePattern = 0;
        for (let i = last10Digits.length - 1; i > 0; i--) {
            if (last10Digits[i] === last10Digits[i-1]) {
                consecutivePattern++;
            } else {
                break;
            }
        }
        
        // Calculate trend and momentum
        const first10Avg = last20.slice(0, 10).reduce((sum, t) => sum + t.quote, 0) / 10;
        const last10Avg = last20.slice(-10).reduce((sum, t) => sum + t.quote, 0) / 10;
        const trend = last10Avg > first10Avg ? 'UP' : last10Avg < first10Avg ? 'DOWN' : 'SIDEWAYS';
        
        // Calculate momentum (rate of change)
        const momentum = ((last10Avg - first10Avg) / first10Avg) * 100;
        
        // Find most/least frequent digits
        let mostFrequentDigit = 0;
        let leastFrequentDigit = 0;
        let maxCount = 0;
        let minCount = 1000;
        
        for (let i = 0; i <= 9; i++) {
            if (digitCounts[i] > maxCount) {
                maxCount = digitCounts[i];
                mostFrequentDigit = i;
            }
            if (digitCounts[i] < minCount) {
                minCount = digitCounts[i];
                leastFrequentDigit = i;
            }
        }
        
        // Determine condition and entry prediction
        let condition: MarketAnalysis['condition'] = 'NONE';
        let entryPrediction: MarketAnalysis['entryPrediction'] = 0;
        let confidence = 0;
        let signalStrength = 0;
        
        // Check for strong signals based on percentages
        
        // EVEN/ODD Trend Signals
        if (evenPercentage > 60) {
            condition = 'EVEN_TREND';
            entryPrediction = 'EVEN';
            confidence = evenPercentage;
            signalStrength = Math.min(100, (evenPercentage - 50) * 2);
        } else if (oddPercentage > 60) {
            condition = 'ODD_TREND';
            entryPrediction = 'ODD';
            confidence = oddPercentage;
            signalStrength = Math.min(100, (oddPercentage - 50) * 2);
        }
        
        // EVEN/ODD Reversal Signals
        if (evenPercentage > 65 && last10.filter(d => d % 2 === 0).length >= 7) {
            condition = 'ODD_REVERSAL';
            entryPrediction = 'ODD';
            confidence = 100 - (evenPercentage - 65) * 2;
            signalStrength = Math.min(100, (evenPercentage - 65) * 2);
        } else if (oddPercentage > 65 && last10.filter(d => d % 2 === 1).length >= 7) {
            condition = 'EVEN_REVERSAL';
            entryPrediction = 'EVEN';
            confidence = 100 - (oddPercentage - 65) * 2;
            signalStrength = Math.min(100, (oddPercentage - 65) * 2);
        }
        
        // OVER/UNDER Trend Signals
        if (overPercentage > 60) {
            condition = 'OVER_TREND';
            entryPrediction = 'OVER';
            confidence = overPercentage;
            signalStrength = Math.min(100, (overPercentage - 50) * 2);
        } else if (underPercentage > 60) {
            condition = 'UNDER_TREND';
            entryPrediction = 'UNDER';
            confidence = underPercentage;
            signalStrength = Math.min(100, (underPercentage - 50) * 2);
        }
        
        // OVER/UNDER Reversal Signals
        if (overPercentage > 65 && last20.filter(d => d >= 5).length >= 14) {
            condition = 'UNDER_REVERSAL';
            entryPrediction = 'UNDER';
            confidence = 100 - (overPercentage - 65) * 2;
            signalStrength = Math.min(100, (overPercentage - 65) * 2);
        } else if (underPercentage > 65 && last20.filter(d => d <= 4).length >= 14) {
            condition = 'OVER_REVERSAL';
            entryPrediction = 'OVER';
            confidence = 100 - (underPercentage - 65) * 2;
            signalStrength = Math.min(100, (underPercentage - 65) * 2);
        }
        
        // Calculate volatility
        const changes: number[] = [];
        for (let i = 1; i < last1000.length; i++) {
            changes.push(Math.abs(last1000[i].quote - last1000[i-1].quote));
        }
        
        const avgChange = changes.reduce((a,b) => a + b, 0) / changes.length;
        
        let volatilityIndex: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME' = 'LOW';
        let volatilityScore = 0;
        
        if (avgChange < 0.5) {
            volatilityIndex = 'LOW';
            volatilityScore = 25;
        } else if (avgChange < 1.5) {
            volatilityIndex = 'MEDIUM';
            volatilityScore = 50;
        } else if (avgChange < 3) {
            volatilityIndex = 'HIGH';
            volatilityScore = 75;
        } else {
            volatilityIndex = 'EXTREME';
            volatilityScore = 100;
        }
        
        const analysis: MarketAnalysis = {
            symbol,
            ticks: last1000,
            digitCounts,
            percentages,
            low012Percentage,
            high789Percentage,
            underPercentage,
            overPercentage,
            evenPercentage,
            oddPercentage,
            mostFrequentDigit,
            leastFrequentDigit,
            last10Digits,
            last20Digits,
            last50Digits,
            consecutivePattern,
            trend,
            momentum,
            condition,
            entryPrediction,
            confidence,
            signalStrength,
            volatility: {
                averageChange: avgChange,
                volatilityIndex,
                trend,
                score: volatilityScore
            }
        };
        
        setAnalyses(prev => ({
            ...prev,
            [symbol]: analysis
        }));
        
        // Check for signals and trigger alert
        if (signalAlert && condition !== 'NONE' && confidence > 70) {
            setLastSignal({
                market: symbol,
                type: condition,
                confidence
            });
            
            if (sound) {
                playSignalSound(condition);
            }
            
            toast({
                title: 'Signal Detected!',
                description: `${symbol}: ${condition} with ${confidence.toFixed(0)}% confidence`,
                variant: confidence > 80 ? 'default' : 'default',
            });
        }
        
        // Auto-create bot if enabled and condition is strong
        if (autoCreateBots && condition !== 'NONE' && confidence > 75) {
            const exists = bots.some(b => b.market === symbol && 
                ((b.category === 'even_odd' && (condition.includes('EVEN') || condition.includes('ODD'))) ||
                 (b.category === 'over_under' && (condition.includes('OVER') || condition.includes('UNDER')))));
            
            if (!exists) {
                // Find appropriate bot category
                if (condition.includes('EVEN') || condition.includes('ODD')) {
                    const type = condition.includes('EVEN') ? 'even' : 'odd';
                    const strategy = condition.includes('TREND') ? 'trend' : 'reversal';
                    const botIndex = bots.length + 1;
                    const newBot = createBot('even_odd', strategy as any, type, symbol, botIndex, 5);
                    setBots(prev => [...prev, newBot]);
                } else if (condition.includes('OVER') || condition.includes('UNDER')) {
                    const type = condition.includes('OVER') ? 'over' : 'under';
                    const strategy = condition.includes('TREND') ? 'trend' : 'reversal';
                    const botIndex = bots.length + 1;
                    const newBot = createBot('over_under', strategy as any, type, symbol, botIndex, 5);
                    setBots(prev => [...prev, newBot]);
                }
            }
        }
    };

    // Play Signal Sound
    const playSignalSound = (type: string) => {
        if (!sound) return;
        
        try {
            if (!audioContextRef.current) {
                audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
            }
            
            const ctx = audioContextRef.current;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.type = 'sine';
            gain.gain.value = 0.1;
            
            if (type.includes('REVERSAL')) {
                // Reversal signal - two beeps
                osc.frequency.value = 880;
                osc.start();
                osc.stop(ctx.currentTime + 0.1);
                
                setTimeout(() => {
                    const osc2 = ctx.createOscillator();
                    const gain2 = ctx.createGain();
                    osc2.connect(gain2);
                    gain2.connect(ctx.destination);
                    osc2.type = 'sine';
                    gain2.gain.value = 0.1;
                    osc2.frequency.value = 440;
                    osc2.start();
                    osc2.stop(ctx.currentTime + 0.1);
                }, 150);
            } else {
                // Trend signal - single beep
                osc.frequency.value = 660;
                osc.start();
                osc.stop(ctx.currentTime + 0.2);
            }
        } catch (error) {
            console.error('Audio error:', error);
        }
    };

    // Check Entry Condition for Bot
    const checkEntryCondition = (bot: Bot, analysis: MarketAnalysis): boolean => {
        const lastTick = analysis.ticks[analysis.ticks.length - 1];
        if (!lastTick) return false;
        
        const lastDigit = lastTick.digit;
        let conditionMet = false;
        
        // Check based on bot category and strategy
        if (bot.category === 'even_odd') {
            const isEven = lastDigit % 2 === 0;
            
            if (bot.strategy === 'trend') {
                // Trend follows the current pattern
                if (bot.entryType === 'even') {
                    conditionMet = isEven;
                } else {
                    conditionMet = !isEven;
                }
            } else if (bot.strategy === 'reversal') {
                // Reversal goes against recent trend
                const last5Even = analysis.last10Digits.slice(-5).filter(d => d % 2 === 0).length;
                
                if (bot.entryType === 'even') {
                    // Look for odd dominance to reverse to even
                    conditionMet = last5Even <= 2 && isEven;
                } else {
                    // Look for even dominance to reverse to odd
                    conditionMet = last5Even >= 3 && !isEven;
                }
            } else if (bot.strategy === 'recovery') {
                // Recovery bot uses consecutive pattern
                const last3Digits = analysis.last10Digits.slice(-3);
                const allSame = last3Digits.every(d => (d % 2 === 0) === isEven);
                
                if (bot.entryType === 'even') {
                    conditionMet = allSame && isEven;
                } else {
                    conditionMet = allSame && !isEven;
                }
            }
        } else if (bot.category === 'over_under') {
            const isOver = lastDigit >= 5;
            
            if (bot.strategy === 'trend') {
                if (bot.entryType === 'over') {
                    conditionMet = isOver;
                } else {
                    conditionMet = !isOver;
                }
            } else if (bot.strategy === 'reversal') {
                const last5Over = analysis.last20Digits.slice(-5).filter(d => d >= 5).length;
                
                if (bot.entryType === 'over') {
                    conditionMet = last5Over <= 2 && isOver;
                } else {
                    conditionMet = last5Over >= 3 && !isOver;
                }
            } else if (bot.strategy === 'recovery') {
                const last3Digits = analysis.last10Digits.slice(-3);
                const allSame = last3Digits.every(d => (d >= 5) === isOver);
                
                if (bot.entryType === 'over') {
                    conditionMet = allSame && isOver;
                } else {
                    conditionMet = allSame && !isOver;
                }
            }
        }
        
        // Require consecutive confirmations
        if (conditionMet && bot.requireConsecutive) {
            const lastNDigits = analysis.last10Digits.slice(-bot.confirmationCount);
            const allMatch = lastNDigits.every(d => {
                if (bot.category === 'even_odd') {
                    return (d % 2 === 0) === (bot.entryType === 'even');
                } else {
                    return (d >= 5) === (bot.entryType === 'over');
                }
            });
            
            conditionMet = allMatch;
        }
        
        // Check volatility if enabled
        if (conditionMet && bot.checkVolatility) {
            const volOk = analysis.volatility.score >= bot.minVolatility && 
                         analysis.volatility.score <= bot.maxVolatility;
            conditionMet = volOk;
        }
        
        // Update consecutive hits
        if (conditionMet) {
            bot.consecutiveHits++;
        } else {
            bot.consecutiveHits = 0;
        }
        
        bot.lastEntrySignal = conditionMet ? Date.now() : null;
        
        return conditionMet;
    };

    // Execute Trade
    const executeTrade = useCallback(async (bot: Bot) => {
        if (!isConnected && !demoMode) {
            toast({
                title: 'Not Connected',
                description: 'Please connect first',
                variant: 'destructive',
            });
            return;
        }
        
        const analysis = analyses[bot.market];
        if (!analysis) return;
        
        const lastTick = analysis.ticks[analysis.ticks.length - 1];
        
        // Determine contract type
        let contractType = '';
        let barrier = '';
        
        if (bot.category === 'even_odd') {
            contractType = bot.entryType === 'even' ? 'DIGITEVEN' : 'DIGITODD';
        } else {
            contractType = bot.entryType === 'over' ? 'DIGITOVER' : 'DIGITUNDER';
        }
        
        try {
            // Simulate trade for demo mode
            if (demoMode) {
                // Simulate price movement
                const randomChange = (Math.random() - 0.5) * analysis.volatility.averageChange;
                const resultPrice = lastTick.quote + randomChange;
                const resultDigit = Math.floor(Math.abs(resultPrice) % 10);
                
                // Determine win/loss
                let won = false;
                
                if (bot.category === 'even_odd') {
                    const isEven = resultDigit % 2 === 0;
                    won = (bot.entryType === 'even' && isEven) || (bot.entryType === 'odd' && !isEven);
                } else {
                    const isOver = resultDigit >= 5;
                    won = (bot.entryType === 'over' && isOver) || (bot.entryType === 'under' && !isOver);
                }
                
                const profit = won ? bot.currentStake * 0.95 : -bot.currentStake;
                
                const trade: Trade = {
                    id: `trade-${Date.now()}-${Math.random()}`,
                    botId: bot.id,
                    botName: bot.name,
                    category: bot.category,
                    market: bot.market,
                    entryType: contractType,
                    entryValue: bot.entryValue.toString(),
                    stake: bot.currentStake,
                    result: won ? 'win' : 'loss',
                    profit,
                    entryDigit: lastTick.digit,
                    resultDigit,
                    entryPrice: lastTick.quote,
                    resultPrice,
                    timestamp: Date.now(),
                    duration: bot.duration,
                    volatility: analysis.volatility.score,
                    confidence: analysis.confidence
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
                        
                        return {
                            ...b,
                            trades: newTrades,
                            wins: newWins,
                            losses: newLosses,
                            totalPnl: newPnl,
                            status: won ? 'watching' : 'recovery',
                            currentStake: won ? b.stake : b.currentStake * b.multiplier,
                            currentRun: won ? b.currentRun + 1 : b.currentRun,
                            recoveryStep: won ? 0 : b.recoveryStep + 1
                        };
                    }
                    return b;
                }));
                
                // Update demo balance
                if (demoMode) {
                    setBalance(prev => prev + profit);
                }
                
                // Play sound
                if (sound) {
                    playSignalSound(won ? 'win' : 'loss');
                }
                
                setTimeout(() => {
                    setActiveTrade(null);
                }, 3000);
                
            } else {
                // Real trade logic would go here
                toast({
                    title: 'Live Trading',
                    description: 'Live trading requires proper API integration',
                });
            }
            
        } catch (error) {
            console.error('Trade execution error:', error);
            toast({
                title: 'Trade Failed',
                description: error.message,
                variant: 'destructive',
            });
        }
    }, [isConnected, demoMode, analyses, sound]);

    // Start Bot
    const startBot = useCallback(async (botId: string) => {
        const bot = bots.find(b => b.id === botId);
        if (!bot) return;
        
        if (runningBotsRef.current.has(botId)) return;
        
        // Check market condition
        const analysis = analyses[bot.market];
        if (!analysis) {
            toast({
                title: 'No Data',
                description: 'Market data not available',
                variant: 'destructive',
            });
            return;
        }
        
        runningBotsRef.current.add(botId);
        
        setBots(prev => prev.map(b => 
            b.id === botId 
                ? { ...b, isRunning: true, status: 'watching' }
                : b
        ));
        
        if (sound) {
            playSignalSound('start');
        }
        
        toast({
            title: 'Bot Started',
            description: `${bot.name} is now running`,
        });
        
        // Bot main loop
        const runBotLoop = async () => {
            let currentBot = bots.find(b => b.id === botId);
            
            while (runningBotsRef.current.has(botId) && currentBot) {
                // Check take profit / stop loss
                if (currentBot.totalPnl >= currentBot.takeProfit) {
                    toast({
                        title: 'Take Profit Reached',
                        description: `Bot stopped with profit: $${currentBot.totalPnl.toFixed(2)}`,
                    });
                    break;
                }
                if (currentBot.totalPnl <= -currentBot.stopLoss) {
                    toast({
                        title: 'Stop Loss Reached',
                        description: `Bot stopped with loss: $${currentBot.totalPnl.toFixed(2)}`,
                        variant: 'destructive',
                    });
                    break;
                }
                
                // Check max runs
                if (currentBot.currentRun >= 3) {
                    toast({
                        title: 'Max Runs Reached',
                        description: 'Bot completed 3 successful runs',
                    });
                    break;
                }
                
                // Check max recovery steps
                if (currentBot.recoveryStep > currentBot.maxSteps) {
                    toast({
                        title: 'Max Recovery Steps',
                        description: 'Bot reached max recovery attempts',
                        variant: 'destructive',
                    });
                    break;
                }
                
                // Update status based on recovery
                setBots(prev => prev.map(b => 
                    b.id === botId 
                        ? { ...b, status: currentBot.recoveryStep > 0 ? 'recovery' : 'watching' }
                        : b
                ));
                
                // Wait for entry condition
                const checkInterval = setInterval(() => {
                    if (!runningBotsRef.current.has(botId)) {
                        clearInterval(checkInterval);
                        return;
                    }
                    
                    const updatedBot = bots.find(b => b.id === botId);
                    const updatedAnalysis = analyses[updatedBot?.market || ''];
                    
                    if (updatedBot && updatedAnalysis && checkEntryCondition(updatedBot, updatedAnalysis)) {
                        clearInterval(checkInterval);
                        executeTrade(updatedBot);
                    }
                }, 500);
                
                // Wait for 10 seconds or until trade completes
                await new Promise(resolve => setTimeout(resolve, 10000));
                clearInterval(checkInterval);
                
                // Update current bot reference
                currentBot = bots.find(b => b.id === botId);
            }
            
            // Stop bot
            runningBotsRef.current.delete(botId);
            setBots(prev => prev.map(b => 
                b.id === botId 
                    ? { ...b, isRunning: false, status: 'stopped' }
                    : b
            ));
            
            if (sound) {
                playSignalSound('stop');
            }
        };
        
        runBotLoop();
        
    }, [bots, analyses, executeTrade, sound]);

    // Stop Bot
    const stopBot = (botId: string) => {
        runningBotsRef.current.delete(botId);
        
        setBots(prev => prev.map(b => 
            b.id === botId 
                ? { ...b, isRunning: false, status: 'stopped' }
                : b
        ));
        
        toast({
            title: 'Bot Stopped',
            description: 'Bot has been stopped',
        });
        
        if (sound) {
            playSignalSound('stop');
        }
    };

    // Stop All Bots
    const stopAllBots = () => {
        runningBotsRef.current.clear();
        
        setBots(prev => prev.map(b => ({ ...b, isRunning: false, status: 'stopped' })));
        
        toast({
            title: 'All Bots Stopped',
            description: 'All trading bots have been stopped',
        });
        
        if (sound) {
            playSignalSound('stop');
        }
    };

    // Start All Bots
    const startAllBots = () => {
        bots.forEach(bot => {
            if (!bot.isRunning) {
                startBot(bot.id);
            }
        });
    };

    // Reset Bot
    const resetBot = (botId: string) => {
        setBots(prev => prev.map(b => 
            b.id === botId 
                ? { 
                    ...b, 
                    totalPnl: 0, 
                    trades: 0, 
                    wins: 0, 
                    losses: 0, 
                    currentRun: 0, 
                    recoveryStep: 0, 
                    currentStake: b.stake,
                    consecutiveHits: 0,
                    lastEntrySignal: null 
                  }
                : b
        ));
    };

    // Clear All Data
    const clearAll = () => {
        stopAllBots();
        setTrades([]);
        
        toast({
            title: 'Cleared',
            description: 'Trade history cleared',
        });
    };

    // Scan Markets
    const scanMarkets = useCallback(async () => {
        if (scanning || !isConnected) return;
        
        setScanning(true);
        setScanProgress(0);
        
        const marketsToScan = marketGroup === 'all' 
            ? MARKETS 
            : MARKETS.filter(m => m.group === marketGroup);
        
        const total = marketsToScan.length;
        let scanned = 0;
        
        for (const market of marketsToScan) {
            try {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify({
                        ticks_history: market.value,
                        adjust_start_time: 1,
                        count: 1000,
                        end: 'latest',
                        start: 1,
                        style: 'ticks'
                    }));
                }
                
                scanned++;
                setScanProgress(Math.round((scanned / total) * 100));
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (error) {
                console.error(`Failed to scan ${market.value}:`, error);
            }
        }
        
        setScanning(false);
        
        toast({
            title: 'Scan Complete',
            description: `Analyzed ${total} markets`,
        });
    }, [isConnected, scanning, marketGroup]);

    // Export Settings
    const exportSettings = () => {
        const settings = {
            bots: bots.map(b => ({
                ...b,
                isRunning: false,
                status: 'idle',
                totalPnl: 0,
                trades: 0,
                wins: 0,
                losses: 0,
                currentRun: 0,
                recoveryStep: 0,
                consecutiveHits: 0,
                currentStake: b.stake
            })),
            autoCreateBots,
            globalVolatilityCheck,
            sound,
            demoMode
        };
        
        const dataStr = JSON.stringify(settings, null, 2);
        const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
        
        const linkElement = document.createElement('a');
        linkElement.setAttribute('href', dataUri);
        linkElement.setAttribute('download', `deriv-bots-${new Date().toISOString().slice(0,10)}.json`);
        linkElement.click();
        
        toast({
            title: 'Settings Exported',
            description: 'Bot configurations saved to file',
        });
    };

    // Import Settings
    const importSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const settings = JSON.parse(e.target?.result as string);
                
                if (settings.bots) {
                    setBots(settings.bots);
                }
                if (settings.autoCreateBots !== undefined) {
                    setAutoCreateBots(settings.autoCreateBots);
                }
                if (settings.globalVolatilityCheck !== undefined) {
                    setGlobalVolatilityCheck(settings.globalVolatilityCheck);
                }
                if (settings.sound !== undefined) {
                    setSound(settings.sound);
                }
                if (settings.demoMode !== undefined) {
                    setDemoMode(settings.demoMode);
                }
                
                toast({
                    title: 'Settings Imported',
                    description: 'Bot configurations loaded successfully',
                });
            } catch (error) {
                toast({
                    title: 'Import Failed',
                    description: 'Invalid settings file',
                    variant: 'destructive',
                });
            }
        };
        reader.readAsText(file);
    };

    // Calculate Statistics
    const totalTrades = trades.filter(t => t.result !== 'pending').length;
    const totalWins = trades.filter(t => t.result === 'win').length;
    const totalLosses = trades.filter(t => t.result === 'loss').length;
    const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;
    const totalPnl = bots.reduce((sum, bot) => sum + bot.totalPnl, 0);
    const activeBots = bots.filter(b => b.isRunning).length;
    const runningBots = bots.filter(b => b.isRunning);
    const stoppedBots = bots.filter(b => !b.isRunning);

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
            runningBotsRef.current.clear();
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
            <div className="max-w-7xl mx-auto space-y-4">
                {/* Header */}
                <Card className="bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-2 shadow-xl">
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-3">
                                <div className="p-2 bg-primary/10 rounded-lg">
                                    <Brain className="h-8 w-8 text-primary" />
                                </div>
                                <div>
                                    <CardTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                                        Deriv Trading Bot System
                                    </CardTitle>
                                    <CardDescription className="text-sm">
                                        12 Advanced Bots • Real-time Analysis • Smart Strategy
                                    </CardDescription>
                                </div>
                            </div>
                            <div className="flex items-center space-x-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSound(!sound)}
                                    className="relative"
                                >
                                    {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
                                </Button>
                                <Badge
                                    variant="outline"
                                    className={`
                                        px-3 py-1
                                        ${isConnected ? 'bg-green-500/10 text-green-500 border-green-500/30' : 
                                          isConnecting ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' : 
                                          'bg-red-500/10 text-red-500 border-red-500/30'}
                                    `}
                                >
                                    {isConnected ? <Wifi className="h-3 w-3 mr-1" /> : <WifiOff className="h-3 w-3 mr-1" />}
                                    {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
                                </Badge>
                            </div>
                        </div>
                    </CardHeader>
                    
                    {/* Status Bar */}
                    <CardContent className="pb-2">
                        <div className="grid grid-cols-5 gap-2 text-sm">
                            <div className="bg-muted/30 rounded-lg p-2">
                                <div className="text-muted-foreground text-xs">Mode</div>
                                <div className="flex items-center space-x-2 mt-1">
                                    <Badge variant={demoMode ? "outline" : "default"} className="text-xs">
                                        {demoMode ? 'DEMO' : 'LIVE'}
                                    </Badge>
                                    <Switch
                                        checked={!demoMode}
                                        onCheckedChange={(v) => setDemoMode(!v)}
                                        className="scale-75"
                                    />
                                </div>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-2">
                                <div className="text-muted-foreground text-xs">Balance</div>
                                <div className={`font-bold text-lg ${balance >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    ${balance.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-2">
                                <div className="text-muted-foreground text-xs">Total P&L</div>
                                <div className={`font-bold text-lg ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                    ${totalPnl.toFixed(2)}
                                </div>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-2">
                                <div className="text-muted-foreground text-xs">Active Bots</div>
                                <div className="font-bold text-lg">{activeBots}/12</div>
                            </div>
                            <div className="bg-muted/30 rounded-lg p-2">
                                <div className="text-muted-foreground text-xs">Win Rate</div>
                                <div className="font-bold text-lg text-green-500">{winRate.toFixed(1)}%</div>
                            </div>
                        </div>
                    </CardContent>

                    {/* Control Bar */}
                    <CardFooter className="flex justify-between pt-2">
                        <div className="flex space-x-2">
                            <Select value={marketGroup} onValueChange={setMarketGroup}>
                                <SelectTrigger className="w-[150px]">
                                    <SelectValue placeholder="Market Group" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Markets</SelectItem>
                                    <SelectItem value="volatility">Volatility</SelectItem>
                                    <SelectItem value="1hz">1HZ Indices</SelectItem>
                                    <SelectItem value="jump">Jump Indices</SelectItem>
                                    <SelectItem value="boom">Boom</SelectItem>
                                    <SelectItem value="crash">Crash</SelectItem>
                                </SelectContent>
                            </Select>
                            
                            <Select value={selectedMarket} onValueChange={setSelectedMarket}>
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="Select Market" />
                                </SelectTrigger>
                                <SelectContent>
                                    {MARKETS.map(market => (
                                        <SelectItem key={market.value} value={market.value}>
                                            <span className="flex items-center">
                                                <span className="mr-2">{market.icon}</span>
                                                {market.label}
                                            </span>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            
                            <Button 
                                variant="default" 
                                size="sm"
                                onClick={scanMarkets}
                                disabled={scanning || !isConnected}
                            >
                                {scanning ? (
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                ) : (
                                    <Scan className="h-4 w-4 mr-2" />
                                )}
                                {scanning ? `Scanning ${scanProgress}%` : 'Scan Markets'}
                            </Button>
                        </div>
                        
                        <div className="flex space-x-2">
                            <Button 
                                variant="outline" 
                                size="sm"
                                onClick={startAllBots}
                                disabled={activeBots === 12}
                            >
                                <Play className="h-4 w-4 mr-2" />
                                Start All
                            </Button>
                            <Button 
                                variant="destructive" 
                                size="sm"
                                onClick={stopAllBots}
                                disabled={activeBots === 0}
                            >
                                <StopCircle className="h-4 w-4 mr-2" />
                                Stop All
                            </Button>
                            <Button variant="outline" size="sm" onClick={exportSettings}>
                                <Download className="h-4 w-4 mr-2" />
                                Export
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => document.getElementById('import-file')?.click()}>
                                <Upload className="h-4 w-4 mr-2" />
                                Import
                            </Button>
                            <input
                                id="import-file"
                                type="file"
                                accept=".json"
                                onChange={importSettings}
                                className="hidden"
                            />
                        </div>
                    </CardFooter>
                </Card>

                {/* Signal Alert */}
                {lastSignal && (
                    <Alert className={`border-2 ${
                        lastSignal.confidence > 80 ? 'border-green-500 bg-green-500/5' : 'border-yellow-500 bg-yellow-500/5'
                    }`}>
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="flex items-center justify-between">
                            <span>
                                <span className="font-bold">{lastSignal.market}</span> - {lastSignal.type} Signal 
                                with <span className="font-bold">{lastSignal.confidence.toFixed(0)}%</span> confidence
                            </span>
                            <Button size="sm" variant="ghost" onClick={() => setLastSignal(null)}>
                                Dismiss
                            </Button>
                        </AlertDescription>
                    </Alert>
                )}

                {/* Main Tabs */}
                <Tabs value={selectedTab} onValueChange={setSelectedTab}>
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="bots">
                            <Brain className="h-4 w-4 mr-2" />
                            Bots ({bots.length})
                        </TabsTrigger>
                        <TabsTrigger value="analysis">
                            <BarChart3 className="h-4 w-4 mr-2" />
                            Analysis
                        </TabsTrigger>
                        <TabsTrigger value="trades">
                            <Activity className="h-4 w-4 mr-2" />
                            Trades ({trades.length})
                        </TabsTrigger>
                    </TabsList>

                    {/* Bots Tab */}
                    <TabsContent value="bots" className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {bots.map(bot => {
                                const analysis = analyses[bot.market];
                                const style = bot.category === 'even_odd' 
                                    ? (bot.entryType === 'even' ? 'purple' : 'orange')
                                    : (bot.entryType === 'over' ? 'blue' : 'green');
                                
                                return (
                                    <Card 
                                        key={bot.id} 
                                        className={`
                                            border-2 transition-all duration-200
                                            ${bot.isRunning ? `border-${style}-500 shadow-lg shadow-${style}-500/20` : 'border-border'}
                                            ${analysis?.confidence > 70 ? 'bg-gradient-to-br from-background to-primary/5' : ''}
                                        `}
                                    >
                                        <CardHeader className="p-3">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center space-x-2">
                                                    <div className={`p-1.5 rounded bg-${style}-500/10`}>
                                                        {bot.category === 'even_odd' ? (
                                                            bot.entryType === 'even' ? 
                                                                <CircleDot className={`h-4 w-4 text-${style}-500`} /> : 
                                                                <Hash className={`h-4 w-4 text-${style}-500`} />
                                                        ) : (
                                                            bot.entryType === 'over' ? 
                                                                <ArrowUp className={`h-4 w-4 text-${style}-500`} /> : 
                                                                <ArrowDown className={`h-4 w-4 text-${style}-500`} />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <CardTitle className="text-sm font-bold">
                                                            {bot.name}
                                                        </CardTitle>
                                                        <CardDescription className="text-xs">
                                                            {bot.market} • {bot.strategy}
                                                        </CardDescription>
                                                    </div>
                                                </div>
                                                <div className="flex items-center space-x-1">
                                                    <Badge variant={bot.isRunning ? "default" : "outline"} className="text-xs">
                                                        {bot.isRunning ? 'RUNNING' : 'STOPPED'}
                                                    </Badge>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-6 w-6 p-0"
                                                        onClick={() => setBots(prev => prev.map(b => 
                                                            b.id === bot.id ? { ...b, expanded: !b.expanded } : b
                                                        ))}
                                                    >
                                                        {bot.expanded ? 
                                                            <ChevronUp className="h-3 w-3" /> : 
                                                            <ChevronDown className="h-3 w-3" />
                                                        }
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardHeader>

                                        <CardContent className="p-3 pt-0">
                                            {/* Stats Grid */}
                                            <div className="grid grid-cols-3 gap-1 mb-2">
                                                <div className="bg-muted/30 rounded p-1.5">
                                                    <div className="text-[10px] text-muted-foreground">P&L</div>
                                                    <div className={`text-xs font-bold ${
                                                        bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'
                                                    }`}>
                                                        ${bot.totalPnl.toFixed(2)}
                                                    </div>
                                                </div>
                                                <div className="bg-muted/30 rounded p-1.5">
                                                    <div className="text-[10px] text-muted-foreground">W/L</div>
                                                    <div className="text-xs font-bold">
                                                        <span className="text-green-500">{bot.wins}</span>
                                                        /<span className="text-red-500">{bot.losses}</span>
                                                    </div>
                                                </div>
                                                <div className="bg-muted/30 rounded p-1.5">
                                                    <div className="text-[10px] text-muted-foreground">Run</div>
                                                    <div className="text-xs font-bold">
                                                        {bot.currentRun}/3
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Status Indicators */}
                                            <div className="flex items-center space-x-2 mb-2">
                                                <Badge 
                                                    variant="outline" 
                                                    className={`
                                                        text-[10px] px-1.5 py-0
                                                        ${bot.status === 'trading' ? 'bg-green-500/10 text-green-500 border-green-500/20' : ''}
                                                        ${bot.status === 'watching' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' : ''}
                                                        ${bot.status === 'recovery' ? 'bg-orange-500/10 text-orange-500 border-orange-500/20' : ''}
                                                        ${bot.status === 'confirming' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' : ''}
                                                    `}
                                                >
                                                    {bot.status === 'trading' && <Activity className="h-3 w-3 mr-1 animate-pulse" />}
                                                    {bot.status === 'watching' && <Eye className="h-3 w-3 mr-1" />}
                                                    {bot.status === 'recovery' && <RefreshCw className="h-3 w-3 mr-1 animate-spin" />}
                                                    {bot.status === 'confirming' && <Timer className="h-3 w-3 mr-1" />}
                                                    {bot.status}
                                                </Badge>
                                                
                                                {bot.consecutiveHits > 0 && (
                                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                        {bot.consecutiveHits}x
                                                    </Badge>
                                                )}
                                            </div>

                                            {/* Signal Strength */}
                                            {analysis && (
                                                <div className="space-y-1 mb-2">
                                                    <div className="flex justify-between text-[10px]">
                                                        <span>Signal Strength</span>
                                                        <span className={`
                                                            ${analysis.signalStrength > 70 ? 'text-green-500' : ''}
                                                            ${analysis.signalStrength > 40 && analysis.signalStrength <= 70 ? 'text-yellow-500' : ''}
                                                            ${analysis.signalStrength <= 40 ? 'text-red-500' : ''}
                                                        `}>
                                                            {analysis.signalStrength.toFixed(0)}%
                                                        </span>
                                                    </div>
                                                    <Progress 
                                                        value={analysis.signalStrength} 
                                                        className="h-1"
                                                        indicatorClassName={
                                                            analysis.signalStrength > 70 ? 'bg-green-500' :
                                                            analysis.signalStrength > 40 ? 'bg-yellow-500' : 'bg-red-500'
                                                        }
                                                    />
                                                </div>
                                            )}

                                            {/* Recovery Progress */}
                                            {bot.recoveryStep > 0 && (
                                                <div className="mb-2">
                                                    <div className="flex justify-between text-[10px] mb-1">
                                                        <span>Recovery Step {bot.recoveryStep}/{bot.maxSteps}</span>
                                                        <span className="text-orange-500">
                                                            Stake: ${bot.currentStake.toFixed(2)}
                                                        </span>
                                                    </div>
                                                    <Progress 
                                                        value={(bot.recoveryStep / bot.maxSteps) * 100} 
                                                        className="h-1 bg-orange-500/20"
                                                        indicatorClassName="bg-orange-500"
                                                    />
                                                </div>
                                            )}

                                            {/* Run Progress */}
                                            <div className="flex space-x-1">
                                                {[1,2,3].map(step => (
                                                    <div
                                                        key={step}
                                                        className={`
                                                            flex-1 h-1 rounded-full
                                                            ${step <= bot.currentRun ? `bg-${style}-500` : 'bg-muted'}
                                                        `}
                                                    />
                                                ))}
                                            </div>

                                            {/* Expanded Settings */}
                                            {bot.expanded && (
                                                <>
                                                    <Separator className="my-3" />
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <Label className="text-[10px]">Stake ($)</Label>
                                                            <Input
                                                                type="number"
                                                                value={bot.stake}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id 
                                                                        ? { ...b, stake: parseFloat(e.target.value) || 0.1 }
                                                                        : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs"
                                                                step="0.1"
                                                                min="0.1"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px]">Duration</Label>
                                                            <Select
                                                                value={bot.duration.toString()}
                                                                onValueChange={v => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id 
                                                                        ? { ...b, duration: parseInt(v) }
                                                                        : b
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
                                                            <Label className="text-[10px]">Multiplier</Label>
                                                            <Input
                                                                type="number"
                                                                value={bot.multiplier}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id 
                                                                        ? { ...b, multiplier: parseFloat(e.target.value) || 1.5 }
                                                                        : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs"
                                                                step="0.1"
                                                                min="1.1"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px]">Max Steps</Label>
                                                            <Input
                                                                type="number"
                                                                value={bot.maxSteps}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id 
                                                                        ? { ...b, maxSteps: parseInt(e.target.value) || 1 }
                                                                        : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs"
                                                                min="1"
                                                                max="5"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px]">Take Profit</Label>
                                                            <Input
                                                                type="number"
                                                                value={bot.takeProfit}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id 
                                                                        ? { ...b, takeProfit: parseFloat(e.target.value) || 0 }
                                                                        : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px]">Stop Loss</Label>
                                                            <Input
                                                                type="number"
                                                                value={bot.stopLoss}
                                                                onChange={e => setBots(prev => prev.map(b => 
                                                                    b.id === bot.id 
                                                                        ? { ...b, stopLoss: parseFloat(e.target.value) || 0 }
                                                                        : b
                                                                ))}
                                                                disabled={bot.isRunning}
                                                                className="h-6 text-xs"
                                                            />
                                                        </div>
                                                        <div className="col-span-2">
                                                            <div className="flex items-center justify-between">
                                                                <Label className="text-[10px]">Consecutive Confirmation</Label>
                                                                <Switch
                                                                    checked={bot.requireConsecutive}
                                                                    onCheckedChange={v => setBots(prev => prev.map(b => 
                                                                        b.id === bot.id 
                                                                            ? { ...b, requireConsecutive: v }
                                                                            : b
                                                                    ))}
                                                                    disabled={bot.isRunning}
                                                                    className="scale-75"
                                                                />
                                                            </div>
                                                            {bot.requireConsecutive && (
                                                                <Input
                                                                    type="number"
                                                                    value={bot.confirmationCount}
                                                                    onChange={e => setBots(prev => prev.map(b => 
                                                                        b.id === bot.id 
                                                                            ? { ...b, confirmationCount: parseInt(e.target.value) || 1 }
                                                                            : b
                                                                    ))}
                                                                    disabled={bot.isRunning}
                                                                    className="h-6 text-xs mt-1"
                                                                    min="1"
                                                                    max="3"
                                                                />
                                                            )}
                                                        </div>
                                                    </div>
                                                </>
                                            )}
                                        </CardContent>

                                        <CardFooter className="p-3 pt-0 flex space-x-2">
                                            {!bot.isRunning ? (
                                                <Button
                                                    className="flex-1 h-7 text-xs"
                                                    onClick={() => startBot(bot.id)}
                                                    disabled={!analysis || analysis.condition === 'NONE'}
                                                >
                                                    <Play className="h-3 w-3 mr-1" />
                                                    Start
                                                </Button>
                                            ) : (
                                                <Button
                                                    variant="destructive"
                                                    className="flex-1 h-7 text-xs"
                                                    onClick={() => stopBot(bot.id)}
                                                >
                                                    <StopCircle className="h-3 w-3 mr-1" />
                                                    Stop
                                                </Button>
                                            )}
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 w-7 p-0"
                                                onClick={() => resetBot(bot.id)}
                                                disabled={bot.isRunning}
                                            >
                                                <RefreshCw className="h-3 w-3" />
                                            </Button>
                                        </CardFooter>
                                    </Card>
                                );
                            })}
                        </div>
                    </TabsContent>

                    {/* Analysis Tab */}
                    <TabsContent value="analysis">
                        <Card>
                            <CardHeader>
                                <CardTitle>Market Analysis</CardTitle>
                                <CardDescription>
                                    Real-time digit frequency and signal analysis
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-[600px]">
                                    <div className="space-y-4">
                                        {MARKETS.map(market => {
                                            const analysis = analyses[market.value];
                                            
                                            return (
                                                <Card key={market.value} className="border">
                                                    <CardHeader className="p-3">
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center space-x-2">
                                                                <span className="text-xl">{market.icon}</span>
                                                                <div>
                                                                    <span className="font-medium">{market.label}</span>
                                                                    <Badge variant="outline" className="ml-2 text-xs">
                                                                        {market.volatility}
                                                                    </Badge>
                                                                </div>
                                                            </div>
                                                            {analysis && analysis.condition !== 'NONE' && (
                                                                <Badge className={`
                                                                    ${analysis.condition.includes('EVEN') ? 'bg-purple-500' : ''}
                                                                    ${analysis.condition.includes('ODD') ? 'bg-orange-500' : ''}
                                                                    ${analysis.condition.includes('OVER') ? 'bg-blue-500' : ''}
                                                                    ${analysis.condition.includes('UNDER') ? 'bg-green-500' : ''}
                                                                `}>
                                                                    {analysis.condition}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </CardHeader>
                                                    <CardContent className="p-3 pt-0">
                                                        {analysis ? (
                                                            <div className="space-y-3">
                                                                {/* Digit Distribution */}
                                                                <div>
                                                                    <div className="text-xs text-muted-foreground mb-1">
                                                                        Digit Distribution (Last 1000)
                                                                    </div>
                                                                    <div className="grid grid-cols-10 gap-1">
                                                                        {[0,1,2,3,4,5,6,7,8,9].map(digit => (
                                                                            <div key={digit} className="text-center">
                                                                                <div className={`
                                                                                    text-xs font-bold
                                                                                    ${digit === analysis.mostFrequentDigit ? 'text-green-500' : ''}
                                                                                    ${digit === analysis.leastFrequentDigit ? 'text-red-500' : ''}
                                                                                `}>
                                                                                    {digit}
                                                                                </div>
                                                                                <div className="text-[8px] text-muted-foreground">
                                                                                    {analysis.percentages[digit]?.toFixed(1)}%
                                                                                </div>
                                                                                <Progress 
                                                                                    value={analysis.percentages[digit]} 
                                                                                    className="h-1 mt-1"
                                                                                    indicatorClassName={
                                                                                        digit === analysis.mostFrequentDigit ? 'bg-green-500' :
                                                                                        digit === analysis.leastFrequentDigit ? 'bg-red-500' : ''
                                                                                    }
                                                                                />
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                {/* Statistics Grid */}
                                                                <div className="grid grid-cols-4 gap-2">
                                                                    <div className="bg-muted/30 rounded p-2">
                                                                        <div className="text-[10px] text-muted-foreground">Even/Odd</div>
                                                                        <div className="flex justify-between text-xs">
                                                                            <span className="text-purple-500">{analysis.evenPercentage.toFixed(1)}%</span>
                                                                            <span className="text-orange-500">{analysis.oddPercentage.toFixed(1)}%</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-muted/30 rounded p-2">
                                                                        <div className="text-[10px] text-muted-foreground">Over/Under</div>
                                                                        <div className="flex justify-between text-xs">
                                                                            <span className="text-blue-500">{analysis.overPercentage.toFixed(1)}%</span>
                                                                            <span className="text-green-500">{analysis.underPercentage.toFixed(1)}%</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-muted/30 rounded p-2">
                                                                        <div className="text-[10px] text-muted-foreground">0-1-2/7-8-9</div>
                                                                        <div className="flex justify-between text-xs">
                                                                            <span className="text-emerald-500">{analysis.low012Percentage.toFixed(1)}%</span>
                                                                            <span className="text-blue-500">{analysis.high789Percentage.toFixed(1)}%</span>
                                                                        </div>
                                                                    </div>
                                                                    <div className="bg-muted/30 rounded p-2">
                                                                        <div className="text-[10px] text-muted-foreground">Confidence</div>
                                                                        <div className={`text-xs font-bold ${
                                                                            analysis.confidence > 70 ? 'text-green-500' :
                                                                            analysis.confidence > 40 ? 'text-yellow-500' : 'text-red-500'
                                                                        }`}>
                                                                            {analysis.confidence.toFixed(0)}%
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                {/* Last 20 Digits */}
                                                                <div>
                                                                    <div className="text-xs text-muted-foreground mb-1">
                                                                        Last 20 Digits
                                                                    </div>
                                                                    <div className="flex space-x-0.5 overflow-x-auto">
                                                                        {analysis.last20Digits.map((digit, i) => (
                                                                            <div
                                                                                key={i}
                                                                                className={`
                                                                                    w-6 h-6 flex items-center justify-center text-xs rounded
                                                                                    ${digit >= 5 ? 'bg-blue-500/20 text-blue-500' : 'bg-green-500/20 text-green-500'}
                                                                                    ${i === analysis.last20Digits.length - 1 ? 'ring-2 ring-primary' : ''}
                                                                                `}
                                                                            >
                                                                                {digit}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>

                                                                {/* Volatility & Trend */}
                                                                <div className="flex items-center justify-between text-xs">
                                                                    <div className="flex items-center space-x-2">
                                                                        {VOLATILITY_ICONS[analysis.volatility.volatilityIndex]}
                                                                        <span>Vol: {analysis.volatility.volatilityIndex}</span>
                                                                        <Badge variant="outline" className="text-[8px]">
                                                                            Δ{analysis.volatility.averageChange.toFixed(2)}
                                                                        </Badge>
                                                                    </div>
                                                                    <div className="flex items-center space-x-2">
                                                                        <Activity className="h-3 w-3" />
                                                                        <span>Trend: {analysis.trend}</span>
                                                                        <Badge variant={analysis.momentum > 0 ? "default" : "destructive"} className="text-[8px]">
                                                                            {analysis.momentum > 0 ? '+' : ''}{analysis.momentum.toFixed(1)}%
                                                                        </Badge>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="text-center text-muted-foreground py-4">
                                                                No data available. Click Scan to analyze.
                                                            </div>
                                                        )}
                                                    </CardContent>
                                                </Card>
                                            );
                                        })}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* Trades Tab */}
                    <TabsContent value="trades">
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                            {/* Trade List */}
                            <Card className="lg:col-span-2">
                                <CardHeader>
                                    <CardTitle>Trade History</CardTitle>
                                    <CardDescription>Last 100 trades</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <ScrollArea className="h-[500px]">
                                        {trades.length === 0 ? (
                                            <div className="text-center text-muted-foreground py-8">
                                                No trades yet
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {trades.map((trade, index) => (
                                                    <div
                                                        key={index}
                                                        className={`
                                                            flex items-center justify-between p-3 rounded-lg
                                                            ${trade.result === 'win' ? 'bg-green-500/10' : ''}
                                                            ${trade.result === 'loss' ? 'bg-red-500/10' : ''}
                                                            ${trade.result === 'pending' ? 'bg-yellow-500/10' : ''}
                                                            ${activeTrade?.id === trade.id ? 'ring-2 ring-primary' : ''}
                                                        `}
                                                    >
                                                        <div className="flex items-center space-x-3">
                                                            <span className="text-xs text-muted-foreground">
                                                                {new Date(trade.timestamp).toLocaleTimeString()}
                                                            </span>
                                                            <Badge variant="outline" className="text-xs">
                                                                {trade.botName}
                                                            </Badge>
                                                            <span className="text-xs">
                                                                {trade.entryDigit} → {trade.resultDigit}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center space-x-3">
                                                            <Badge variant="secondary" className="text-[8px]">
                                                                {trade.confidence.toFixed(0)}%
                                                            </Badge>
                                                            <span className="text-xs font-mono">
                                                                ${trade.stake.toFixed(2)}
                                                            </span>
                                                            <span className={`
                                                                text-xs font-bold w-16 text-right
                                                                ${trade.result === 'win' ? 'text-green-500' : ''}
                                                                ${trade.result === 'loss' ? 'text-red-500' : ''}
                                                                ${trade.result === 'pending' ? 'text-yellow-500' : ''}
                                                            `}>
                                                                {trade.result === 'win' ? `+$${trade.profit.toFixed(2)}` : ''}
                                                                {trade.result === 'loss' ? `-$${Math.abs(trade.profit).toFixed(2)}` : ''}
                                                                {trade.result === 'pending' ? 'Pending' : ''}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </ScrollArea>
                                </CardContent>
                            </Card>

                            {/* Statistics */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Statistics</CardTitle>
                                    <CardDescription>Performance overview</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="space-y-2">
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Total Trades:</span>
                                            <span className="font-bold">{totalTrades}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Wins:</span>
                                            <span className="font-bold text-green-500">{totalWins}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Losses:</span>
                                            <span className="font-bold text-red-500">{totalLosses}</span>
                                        </div>
                                        <Separator />
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Win Rate:</span>
                                            <span className="font-bold text-green-500">{winRate.toFixed(1)}%</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Total P&L:</span>
                                            <span className={`font-bold ${totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                                ${totalPnl.toFixed(2)}
                                            </span>
                                        </div>
                                        <Separator />
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Best Trade:</span>
                                            <span className="font-bold text-green-500">
                                                ${Math.max(...trades.map(t => t.profit), 0).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Worst Trade:</span>
                                            <span className="font-bold text-red-500">
                                                ${Math.min(...trades.map(t => t.profit), 0).toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-muted-foreground">Avg Profit/Trade:</span>
                                            <span className="font-bold">
                                                ${(totalPnl / (totalTrades || 1)).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>

                                    <Separator />

                                    <div>
                                        <h4 className="text-sm font-medium mb-2">Bot Performance</h4>
                                        <div className="space-y-1">
                                            {bots.map(bot => (
                                                <div key={bot.id} className="flex justify-between text-xs">
                                                    <span className="truncate max-w-[150px]">{bot.name}</span>
                                                    <span className={bot.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}>
                                                        ${bot.totalPnl.toFixed(2)}
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <Button 
                                        variant="destructive" 
                                        size="sm" 
                                        className="w-full"
                                        onClick={clearAll}
                                    >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        Clear History
                                    </Button>
                                </CardContent>
                            </Card>
                        </div>
                    </TabsContent>
                </Tabs>
            </div>
        </div>
    );
  }
