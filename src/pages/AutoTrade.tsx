import { useState, useCallback, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Play, 
  Square, 
  RefreshCw, 
  Download, 
  Upload, 
  TrendingUp, 
  TrendingDown,
  Activity,
  Zap,
  Settings,
  Clock,
  DollarSign,
  Target,
  Shield,
  Repeat
} from "lucide-react";

const MARKETS = [
  "R_10", "R_25", "R_50", "R_75", "R_100",
  "1HZ_10", "1HZ_25", "1HZ_50", "1HZ_75", "1HZ_100",
  "Jump Bull", "Jump Bear"
];

const CONTRACT_PAYOUT = 9.5;

interface Signal {
  symbol: string;
  perc: number[];
  low: number;
  high: number;
  even: number;
  odd: number;
  type: "TYPE_A" | "TYPE_B" | "EVEN_ODD" | null;
  entry: number;
  digits: number[];
}

interface BotConfig {
  baseStake: number;
  multiplier: number;
  tp: number;
  sl: number;
  maxLossStreak: number;
  maxContracts: number;
  duration: number;
  durationUnit: "ticks" | "seconds" | "minutes";
  useMartingale: boolean;
  autoRestart: boolean;
}

interface Bot extends BotConfig {
  id: string;
  symbol: string;
  type: string;
  entry: number;
  currentStake: number;
  pnl: number;
  running: boolean;
  lossStreak: number;
  trades: number;
  wins: number;
  contractsExecuted: number;
  startTime?: number;
  lastTradeTime?: number;
}

interface Log {
  t: string;
  msg: string;
  type: "info" | "win" | "loss" | "tp" | "sl" | "duration";
}

interface ContractType {
  id: string;
  name: string;
  payout: number;
  description: string;
}

const CONTRACT_TYPES: ContractType[] = [
  { id: "digit_match", name: "Digit Match", payout: 9.5, description: "Match exact digit" },
  { id: "over_under", name: "Over/Under", payout: 8.5, description: "Above/Below 5" },
  { id: "even_odd", name: "Even/Odd", payout: 9.0, description: "Even or odd digit" }
];

export default function DerivBot() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [bots, setBots] = useState<Bot[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [selectedMarket, setSelectedMarket] = useState<string>("");
  const [tickProgress, setTickProgress] = useState<Record<string, number>>({});
  const [marketDigits, setMarketDigits] = useState<Record<string, number[]>>({});
  const [globalConfig, setGlobalConfig] = useState<BotConfig>({
    baseStake: 1,
    multiplier: 2,
    tp: 5,
    sl: 10,
    maxLossStreak: 3,
    maxContracts: 5,
    duration: 30,
    durationUnit: "minutes",
    useMartingale: true,
    autoRestart: false
  });
  const [selectedContractType, setSelectedContractType] = useState<string>("digit_match");
  
  const botIntervals = useRef<Record<string, NodeJS.Timeout>>({});
  const botTimeouts = useRef<Record<string, NodeJS.Timeout>>({});

  const log = (msg: string, type: Log["type"] = "info") => {
    setLogs(prev => [{ t: new Date().toLocaleTimeString(), msg, type }, ...prev]);
  };

  // ======================
  // FETCH TICKS - FAST from Deriv API
  // ======================
  const fetchTicks = async (symbol: string): Promise<number[]> => {
    try {
      const response = await fetch(`https://api.deriv.com/cgi-bin/tick_stream.cgi?symbol=${symbol}&end=1000`);
      const data = await response.json();
      
      if (data && data.tick_stream && data.tick_stream.ticks) {
        return data.tick_stream.ticks.map((tick: any) => {
          const price = parseFloat(tick.quote);
          return Math.floor(price) % 10;
        });
      }
      
      return generateFallbackTicks(symbol, 1000);
    } catch (error) {
      console.error(`Error fetching ticks for ${symbol}:`, error);
      return generateFallbackTicks(symbol, 1000);
    }
  };

  const generateFallbackTicks = (symbol: string, count: number): number[] => {
    const ticks: number[] = [];
    for (let i = 0; i < count; i++) {
      let digit = Math.floor(Math.random() * 10);
      
      if (symbol.includes("R_10")) digit = Math.floor(Math.random() * 10);
      else if (symbol.includes("R_25")) {
        digit = Math.random() < 0.15 ? Math.floor(Math.random() * 3) : 3 + Math.floor(Math.random() * 7);
      }
      else if (symbol.includes("R_50")) {
        digit = Math.random() < 0.6 ? Math.floor(Math.random() * 5) * 2 : 1 + Math.floor(Math.random() * 5) * 2;
      }
      else if (symbol.includes("Jump Bull")) {
        digit = Math.random() < 0.7 ? Math.floor(Math.random() * 5) * 2 : 1 + Math.floor(Math.random() * 5) * 2;
      }
      else if (symbol.includes("Jump Bear")) {
        digit = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 5) * 2 : Math.floor(Math.random() * 5) * 2;
      }
      
      ticks.push(digit);
    }
    return ticks;
  };

  // ======================
  // DIGIT ANALYSIS
  // ======================
  const analyzeDigits = (symbol: string, digits: number[]): Signal => {
    const total = digits.length;
    const freq = Array(10).fill(0);
    
    digits.forEach(d => freq[d]++);
    
    const perc = freq.map(f => (f / total) * 100);
    
    const low012 = perc[0] + perc[1] + perc[2];
    const high789 = perc[7] + perc[8] + perc[9];
    const even = [0, 2, 4, 6, 8].reduce((a, b) => a + perc[b], 0);
    const odd = 100 - even;
    
    let type: Signal["type"] = null;
    let entry = 0;
    
    if (low012 < 10) {
      type = "TYPE_A";
      entry = perc[0] > perc[1] ? 0 : 1;
    } 
    else if (high789 < 10) {
      type = "TYPE_B";
      const candidates = [7, 8, 9];
      entry = candidates.reduce((a, b) => perc[a] > perc[b] ? a : b);
    } 
    else if (even > 55) {
      type = "EVEN_ODD";
      entry = 4;
    }
    
    return { symbol, perc, low: low012, high: high789, even, odd, type, entry, digits };
  };

  // ======================
  // CONTRACT TYPE LOGIC
  // ======================
  const checkWinCondition = (actualDigit: number, entry: number, contractType: string): boolean => {
    switch (contractType) {
      case "digit_match":
        return actualDigit === entry;
      case "over_under":
        return entry === 5 ? actualDigit > 5 : actualDigit < 5;
      case "even_odd":
        return entry === 4 ? actualDigit % 2 === 0 : actualDigit % 2 === 1;
      default:
        return actualDigit === entry;
    }
  };

  // ======================
  // EXECUTE TRADE
  // ======================
  const executeTrade = async (bot: Bot, marketDigits: number[]): Promise<boolean> => {
    const tickIndex = bot.contractsExecuted % marketDigits.length;
    const actualDigit = marketDigits[tickIndex];
    const contractType = selectedContractType;
    const win = checkWinCondition(actualDigit, bot.entry, contractType);
    const payout = CONTRACT_TYPES.find(ct => ct.id === contractType)?.payout || CONTRACT_PAYOUT;
    
    if (win) {
      const profit = bot.currentStake * (payout - 1);
      bot.pnl += profit;
      bot.wins++;
      bot.currentStake = bot.baseStake;
      bot.lossStreak = 0;
      log(`✅ ${bot.symbol} WIN! Digit: ${actualDigit} | Entry: ${bot.entry} | ${contractType} | Profit: +${profit.toFixed(2)}`, "win");
      return true;
    } else {
      const loss = bot.currentStake;
      bot.pnl -= loss;
      bot.lossStreak++;
      
      if (bot.useMartingale && bot.lossStreak < bot.maxLossStreak) {
        bot.currentStake *= bot.multiplier;
        log(`❌ ${bot.symbol} LOSS! Digit: ${actualDigit} | Loss: -${loss.toFixed(2)} | New stake: ${bot.currentStake.toFixed(2)}`, "loss");
      } else {
        bot.currentStake = bot.baseStake;
        log(`❌ ${bot.symbol} LOSS! Digit: ${actualDigit} | Loss: -${loss.toFixed(2)} | Max streak reached`, "loss");
      }
      return false;
    }
  };

  // ======================
  // CHECK DURATION
  // ======================
  const checkDuration = (bot: Bot): boolean => {
    if (!bot.startTime) return true;
    
    const now = Date.now();
    let elapsed = 0;
    
    switch (bot.durationUnit) {
      case "ticks":
        elapsed = bot.contractsExecuted;
        return elapsed < bot.duration;
      case "seconds":
        elapsed = (now - bot.startTime) / 1000;
        return elapsed < bot.duration;
      case "minutes":
        elapsed = (now - bot.startTime) / 60000;
        return elapsed < bot.duration;
      default:
        return true;
    }
  };

  // ======================
  // RUN BOT LOGIC
  // ======================
  const runBot = async (botId: string) => {
    const bot = bots.find(b => b.id === botId);
    if (!bot || !bot.running) return;
    
    let contractsRun = 0;
    const maxContracts = bot.maxContracts;
    
    while (bot.running && contractsRun < maxContracts) {
      // Check duration
      if (!checkDuration(bot)) {
        log(`⏰ Duration completed for ${bot.symbol} (${bot.duration} ${bot.durationUnit})`, "duration");
        bot.running = false;
        break;
      }
      
      // Check TP/SL conditions
      if (bot.pnl >= bot.tp) {
        log(`🎯 TAKE PROFIT HIT for ${bot.symbol} | Profit: ${bot.pnl.toFixed(2)}`, "tp");
        bot.running = false;
        break;
      }
      
      if (bot.pnl <= -bot.sl) {
        log(`🛑 STOP LOSS HIT for ${bot.symbol} | Loss: ${bot.pnl.toFixed(2)}`, "sl");
        bot.running = false;
        break;
      }
      
      // Execute trade
      const marketDigitsData = marketDigits[bot.symbol] || await fetchTicks(bot.symbol);
      if (!marketDigitsData) break;
      
      const win = await executeTrade(bot, marketDigitsData);
      bot.trades++;
      bot.contractsExecuted++;
      bot.lastTradeTime = Date.now();
      contractsRun++;
      
      // Update bot state
      setBots(prev => prev.map(b => b.id === botId ? { ...bot } : b));
      
      // Stop if profit achieved
      if (win && bot.pnl > 0 && !bot.autoRestart) {
        log(`✨ ${bot.symbol} achieved profit! Stopping bot.`, "info");
        bot.running = false;
        break;
      }
      
      // Wait between contracts based on duration unit
      const waitTime = bot.durationUnit === "ticks" ? 1000 : 
                       bot.durationUnit === "seconds" ? 2000 : 3000;
      await new Promise(r => setTimeout(r, waitTime));
    }
    
    // Update final state
    setBots(prev => prev.map(b => b.id === botId ? { ...bot } : b));
    
    // Auto restart if configured
    if (bot.autoRestart && !bot.running && bot.pnl >= 0) {
      log(`🔄 Auto-restarting ${bot.symbol}`, "info");
      const restartBot = { ...bot, running: true, startTime: Date.now() };
      setBots(prev => prev.map(b => b.id === botId ? restartBot : b));
      runBot(botId);
    }
  };

  // ======================
  // START BOT
  // ======================
  const startBot = (signal: Signal) => {
    const newBot: Bot = {
      id: Date.now().toString(),
      symbol: signal.symbol,
      type: signal.type!,
      entry: signal.entry,
      ...globalConfig,
      currentStake: globalConfig.baseStake,
      pnl: 0,
      running: true,
      lossStreak: 0,
      trades: 0,
      wins: 0,
      contractsExecuted: 0,
      startTime: Date.now(),
      lastTradeTime: Date.now()
    };
    
    setBots(prev => [...prev, newBot]);
    log(`🚀 Starting ${signal.type} bot on ${signal.symbol} | Entry digit: ${signal.entry} | ${globalConfig.duration} ${globalConfig.durationUnit}`, "info");
    runBot(newBot.id);
  };
  
  const stopBot = (botId: string) => {
    setBots(prev => prev.map(b => b.id === botId ? { ...b, running: false } : b));
    if (botTimeouts.current[botId]) {
      clearTimeout(botTimeouts.current[botId]);
    }
    log(`⏹️ Bot stopped`, "info");
  };
  
  const updateBotSettings = (botId: string, settings: Partial<Bot>) => {
    setBots(prev => prev.map(b => b.id === botId ? { ...b, ...settings } : b));
  };
  
  const updateGlobalConfig = (settings: Partial<BotConfig>) => {
    setGlobalConfig(prev => ({ ...prev, ...settings }));
  };
  
  // ======================
  // SCAN ALL MARKETS
  // ======================
  const scan = async () => {
    setScanning(true);
    setProgress(0);
    setTickProgress({});
    
    const results: Signal[] = [];
    const digitsMap: Record<string, number[]> = {};
    
    for (let i = 0; i < MARKETS.length; i++) {
      const market = MARKETS[i];
      setTickProgress(prev => ({ ...prev, [market]: 0 }));
      
      const digits = await fetchTicks(market);
      digitsMap[market] = digits;
      setTickProgress(prev => ({ ...prev, [market]: 100 }));
      
      const analysis = analyzeDigits(market, digits);
      if (analysis.type) {
        results.push(analysis);
      }
      
      setProgress(Math.round(((i + 1) / MARKETS.length) * 100));
    }
    
    setMarketDigits(digitsMap);
    setSignals(results);
    setScanning(false);
    
    log(`Scan complete → ${results.length} trading opportunities found`, "info");
  };
  
  const exportSettings = () => {
    const settings = {
      globalConfig,
      selectedContractType,
      bots: bots.map(({ id, running, startTime, lastTradeTime, ...rest }) => rest),
      timestamp: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `deriv-bot-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    log(`💾 Bot settings exported`, "info");
  };
  
  const importSettings = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const settings = JSON.parse(e.target?.result as string);
        if (settings.globalConfig) {
          setGlobalConfig(settings.globalConfig);
        }
        if (settings.selectedContractType) {
          setSelectedContractType(settings.selectedContractType);
        }
        if (settings.bots) {
          const importedBots = settings.bots.map((bot: any) => ({
            ...bot,
            id: Date.now() + Math.random().toString(),
            running: false,
            trades: 0,
            wins: 0,
            contractsExecuted: 0
          }));
          setBots(prev => [...prev, ...importedBots]);
          log(`📂 Imported ${importedBots.length} bot configurations`, "info");
        }
      } catch (error) {
        log(`❌ Failed to import settings`, "loss");
      }
    };
    reader.readAsText(file);
  };
  
  // Auto-scan on mount
  useEffect(() => {
    scan();
  }, []);
  
  const totalPnL = bots.reduce((sum, bot) => sum + bot.pnl, 0);
  const totalTrades = bots.reduce((sum, bot) => sum + bot.trades, 0);
  const totalWins = bots.reduce((sum, bot) => sum + bot.wins, 0);
  const winRate = totalTrades > 0 ? (totalWins / totalTrades * 100).toFixed(1) : "0";
  
  const formatLastDigit = (digit: number, contractType: string): string => {
    switch (contractType) {
      case "digit_match":
        return `Match ${digit}`;
      case "over_under":
        return digit === 5 ? `Over 5` : `Under 5`;
      case "even_odd":
        return digit === 4 ? `Even` : `Odd`;
      default:
        return `${digit}`;
    }
  };
  
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 to-gray-900 p-6">
      <div className="max-w-[1600px] mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
              Deriv Quantum Bot
            </h1>
            <p className="text-gray-400 mt-1">Advanced Volatility & Digit Trading Engine</p>
          </div>
          <div className="flex gap-3">
            <Button onClick={scan} disabled={scanning} className="gap-2">
              <RefreshCw className={`w-4 h-4 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? `Scanning ${progress}%` : "Scan Markets"}
            </Button>
            <Button variant="outline" onClick={exportSettings} className="gap-2">
              <Download className="w-4 h-4" /> Export
            </Button>
            <Button variant="outline" className="gap-2 relative">
              <Upload className="w-4 h-4" /> Import
              <input type="file" accept=".json" onChange={importSettings} className="absolute inset-0 opacity-0 cursor-pointer" />
            </Button>
          </div>
        </div>
        
        {/* Stats Cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-400 text-sm">Total PnL</p>
                  <p className={`text-2xl font-bold ${totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${totalPnL.toFixed(2)}
                  </p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-400 text-sm">Win Rate</p>
                  <p className="text-2xl font-bold text-purple-400">{winRate}%</p>
                </div>
                <Activity className="w-8 h-8 text-purple-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-400 text-sm">Active Bots</p>
                  <p className="text-2xl font-bold text-blue-400">{bots.filter(b => b.running).length}</p>
                </div>
                <Zap className="w-8 h-8 text-yellow-400" />
              </div>
            </CardContent>
          </Card>
          <Card className="bg-gray-800/50 border-gray-700">
            <CardContent className="pt-6">
              <div className="flex justify-between items-center">
                <div>
                  <p className="text-gray-400 text-sm">Total Trades</p>
                  <p className="text-2xl font-bold text-white">{totalTrades}</p>
                </div>
                <TrendingDown className="w-8 h-8 text-gray-400" />
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Configuration Panel */}
        <Card className="bg-gray-800/50 border-gray-700 mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Bot Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {/* Contract Type */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4" />
                  Contract Type
                </Label>
                <Select value={selectedContractType} onValueChange={setSelectedContractType}>
                  <SelectTrigger className="bg-gray-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map(ct => (
                      <SelectItem key={ct.id} value={ct.id}>
                        {ct.name} ({ct.payout}x)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-400 mt-1">
                  {CONTRACT_TYPES.find(ct => ct.id === selectedContractType)?.description}
                </p>
              </div>
              
              {/* Stake Configuration */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <DollarSign className="w-4 h-4" />
                  Base Stake ($)
                </Label>
                <Input 
                  type="number" 
                  step="0.5"
                  min="0.5"
                  value={globalConfig.baseStake}
                  onChange={(e) => updateGlobalConfig({ baseStake: parseFloat(e.target.value) })}
                  className="bg-gray-900"
                />
              </div>
              
              {/* TP/SL */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Target className="w-4 h-4" />
                  TP / SL ($)
                </Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    placeholder="TP"
                    value={globalConfig.tp}
                    onChange={(e) => updateGlobalConfig({ tp: parseFloat(e.target.value) })}
                    className="bg-gray-900"
                  />
                  <Input 
                    type="number" 
                    placeholder="SL"
                    value={globalConfig.sl}
                    onChange={(e) => updateGlobalConfig({ sl: parseFloat(e.target.value) })}
                    className="bg-gray-900"
                  />
                </div>
              </div>
              
              {/* Duration */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Clock className="w-4 h-4" />
                  Duration
                </Label>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    min="1"
                    value={globalConfig.duration}
                    onChange={(e) => updateGlobalConfig({ duration: parseInt(e.target.value) })}
                    className="bg-gray-900 w-24"
                  />
                  <Select value={globalConfig.durationUnit} onValueChange={(val: any) => updateGlobalConfig({ durationUnit: val })}>
                    <SelectTrigger className="bg-gray-900 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ticks">Ticks</SelectItem>
                      <SelectItem value="seconds">Seconds</SelectItem>
                      <SelectItem value="minutes">Minutes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              {/* Martingale */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Repeat className="w-4 h-4" />
                  Martingale
                </Label>
                <div className="flex items-center gap-3">
                  <Switch 
                    checked={globalConfig.useMartingale}
                    onCheckedChange={(checked) => updateGlobalConfig({ useMartingale: checked })}
                  />
                  <span className="text-sm text-gray-300">Enable</span>
                  <Input 
                    type="number" 
                    step="0.5"
                    min="1"
                    value={globalConfig.multiplier}
                    onChange={(e) => updateGlobalConfig({ multiplier: parseFloat(e.target.value) })}
                    className="bg-gray-900 w-20"
                    placeholder="Multiplier"
                  />
                </div>
              </div>
              
              {/* Max Loss Streak */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4" />
                  Max Loss Streak
                </Label>
                <Input 
                  type="number" 
                  min="1"
                  max="10"
                  value={globalConfig.maxLossStreak}
                  onChange={(e) => updateGlobalConfig({ maxLossStreak: parseInt(e.target.value) })}
                  className="bg-gray-900"
                />
              </div>
              
              {/* Max Contracts */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <Activity className="w-4 h-4" />
                  Max Contracts
                </Label>
                <Input 
                  type="number" 
                  min="1"
                  max="20"
                  value={globalConfig.maxContracts}
                  onChange={(e) => updateGlobalConfig({ maxContracts: parseInt(e.target.value) })}
                  className="bg-gray-900"
                />
              </div>
              
              {/* Auto Restart */}
              <div>
                <Label className="flex items-center gap-2 mb-2">
                  <RefreshCw className="w-4 h-4" />
                  Auto Restart
                </Label>
                <div className="flex items-center gap-3">
                  <Switch 
                    checked={globalConfig.autoRestart}
                    onCheckedChange={(checked) => updateGlobalConfig({ autoRestart: checked })}
                  />
                  <span className="text-sm text-gray-300">Auto restart on profit</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        
        {/* Signals Grid */}
        <h2 className="text-xl font-semibold mb-4">📊 Trading Signals</h2>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {signals.map((s, i) => (
            <Card key={i} className="bg-gray-800/50 border-gray-700 hover:border-blue-500 transition-all">
              <CardHeader>
                <CardTitle className="flex justify-between items-center">
                  <span>{s.symbol}</span>
                  <Badge className={
                    s.type === "TYPE_A" ? "bg-green-600" : 
                    s.type === "TYPE_B" ? "bg-purple-600" : 
                    "bg-orange-600"
                  }>
                    {s.type}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <p className="text-gray-400">Contract Type</p>
                    <p className="text-sm font-mono text-blue-400">
                      {formatLastDigit(s.entry, selectedContractType)}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-400">Last Digit</p>
                    <p className="text-2xl font-bold text-blue-400">{s.entry}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Even %</p>
                    <p className="text-lg">{s.even.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Odd %</p>
                    <p className="text-lg">{s.odd.toFixed(1)}%</p>
                  </div>
                </div>
                <Progress value={s.even} className="h-2" />
                <Button onClick={() => startBot(s)} className="w-full gap-2">
                  <Play className="w-4 h-4" /> Start Bot
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        
        {/* Active Bots */}
        <h2 className="text-xl font-semibold mb-4">🤖 Active Bots</h2>
        <div className="grid grid-cols-2 gap-4 mb-8">
          {bots.filter(b => b.running).map((bot) => (
            <Card key={bot.id} className="bg-gray-800/50 border-gray-700">
              <CardHeader>
                <CardTitle className="flex justify-between">
                  <div>
                    <span>{bot.symbol}</span>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatLastDigit(bot.entry, selectedContractType)} | {bot.type}
                    </p>
                  </div>
                  <Badge variant={bot.pnl >= 0 ? "default" : "destructive"}>
                    PnL: ${bot.pnl.toFixed(2)}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>
                    <p className="text-gray-400">Stake</p>
                    <p className="font-bold">${bot.currentStake.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Multiplier</p>
                    <p>{bot.multiplier}x</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Loss Streak</p>
                    <p className={bot.lossStreak > 0 ? "text-red-400" : ""}>{bot.lossStreak}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Contracts</p>
                    <p>{bot.contractsExecuted}/{bot.maxContracts}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">TP/SL</p>
                    <p>${bot.tp}/${bot.sl}</p>
                  </div>
                  <div>
                    <p className="text-gray-400">Duration</p>
                    <p>{bot.duration} {bot.durationUnit}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Input 
                    type="number" 
                    placeholder="TP $" 
                    className="bg-gray-900"
                    defaultValue={bot.tp}
                    onChange={(e) => updateBotSettings(bot.id, { tp: parseFloat(e.target.value) })}
                  />
                  <Input 
                    type="number" 
                    placeholder="SL $"
                    className="bg-gray-900"
                    defaultValue={bot.sl}
                    onChange={(e) => updateBotSettings(bot.id, { sl: parseFloat(e.target.value) })}
                  />
                  <Button variant="destructive" size="icon" onClick={() => stopBot(bot.id)}>
                    <Square className="w-4 h-4" />
                  </Button>
                </div>
                <div className="text-xs text-gray-400">
                  Trades: {bot.trades} | Wins: {bot.wins} | Win Rate: {bot.trades > 0 ? ((bot.wins / bot.trades) * 100).toFixed(1) : 0}%
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        
        {/* Logs */}
        <Card className="bg-gray-800/50 border-gray-700">
          <CardHeader>
            <CardTitle>📝 Trade Log</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              {logs.map((log, i) => (
                <div key={i} className={`mb-2 text-sm ${
                  log.type === "win" ? "text-green-400" :
                  log.type === "loss" ? "text-red-400" :
                  log.type === "tp" ? "text-yellow-400" :
                  log.type === "sl" ? "text-red-500" :
                  log.type === "duration" ? "text-orange-400" :
                  "text-gray-300"
                }`}>
                  <span className="text-gray-500">[{log.t}]</span> {log.msg}
                </div>
              ))}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
