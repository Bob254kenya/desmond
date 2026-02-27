/**
 * Smart Signal Engine — Scans ALL volatilities for digit dominance.
 * DEFENSIVE: digit 0 always counted. Over=5-9, Under=0-4.
 * MARTINGALE: LOSS → multiply, WIN → reset (STANDARD).
 */

import { type MarketSymbol } from './deriv-api';
import { getLastDigit } from './analysis';
import { digitFrequency } from './bot-engine';

export interface DigitRanking {
  digit: number;
  count: number;
  pct: number;
}

export interface MarketSignal {
  symbol: MarketSymbol;
  marketName: string;
  digits: number[];
  rankings: DigitRanking[];
  most: DigitRanking;
  second: DigitRanking;
  third: DigitRanking;
  least: DigitRanking;
  signalStrength: number;
  isValid: boolean;
  validationReason: string;
  suggestedContract: string;
  suggestedBarrier: string;
  overPct: number;
  underPct: number;
  evenPct: number;
  oddPct: number;
}

/**
 * Analyze a set of digits and produce ranked digit info + signal.
 * Over = digits 5-9, Under = digits 0-4. Zero is always Under + Even.
 */
export function analyzeMarketDigits(
  digits: number[],
  symbol: MarketSymbol,
  marketName: string,
): MarketSignal {
  const len = digits.length || 1;
  const freq = digitFrequency(digits);

  const rankings: DigitRanking[] = [];
  for (let i = 0; i <= 9; i++) {
    rankings.push({ digit: i, count: freq[i], pct: (freq[i] / len) * 100 });
  }
  rankings.sort((a, b) => b.count - a.count);

  const most = rankings[0];
  const second = rankings[1];
  const third = rankings[2];
  const least = rankings[rankings.length - 1];

  // Over=5-9, Under=0-4 (0 is Under), Even includes 0
  const overCount = digits.filter(d => d >= 5).length;
  const underCount = digits.filter(d => d <= 4).length;
  const evenCount = digits.filter(d => d % 2 === 0).length; // 0 is even
  const oddCount = digits.filter(d => d % 2 !== 0).length;

  const overPct = (overCount / len) * 100;
  const underPct = (underCount / len) * 100;
  const evenPct = (evenCount / len) * 100;
  const oddPct = (oddCount / len) * 100;

  // Log digit 0 influence
  if (freq[0] > 0) {
    console.log(`[Signal] ${symbol}: digit 0 freq=${freq[0]}, contributes to Under(${underPct.toFixed(1)}%) & Even(${evenPct.toFixed(1)}%)`);
  }

  const topThreeTotal = most.pct + second.pct + third.pct;
  const imbalance = most.pct - least.pct;

  let strength = 0;
  if (imbalance > 5) strength += 2;
  if (imbalance > 10) strength += 2;
  if (imbalance > 15) strength += 2;
  if (second.pct > 12) strength += 1;
  if (third.pct > 11) strength += 1;
  if (topThreeTotal > 40) strength += 1;
  if (least.pct < 5) strength += 1;
  strength = Math.min(10, strength);

  const isValid = strength >= 4 && second.pct > 11 && third.pct > 10 && imbalance > 6;

  let validationReason = '';
  if (!isValid) {
    if (strength < 4) validationReason = `Strength ${strength} < 4`;
    else if (imbalance <= 6) validationReason = `Imbalance ${imbalance.toFixed(1)}% too low`;
    else validationReason = 'Insufficient digit dominance';
  } else {
    validationReason = `Strength ${strength}, Imbalance ${imbalance.toFixed(1)}%, Top3 ${topThreeTotal.toFixed(1)}%`;
  }

  let suggestedContract = 'DIGITOVER';
  let suggestedBarrier = '1';

  if (isValid) {
    if (overPct > 55) {
      suggestedContract = 'DIGITUNDER';
      suggestedBarrier = '6';
    } else if (underPct > 55) {
      suggestedContract = 'DIGITOVER';
      suggestedBarrier = '1';
    } else if (evenPct > 55) {
      suggestedContract = 'DIGITODD';
      suggestedBarrier = '';
    } else if (oddPct > 55) {
      suggestedContract = 'DIGITEVEN';
      suggestedBarrier = '';
    } else {
      suggestedContract = 'DIGITOVER';
      suggestedBarrier = '1';
    }
  }

  return {
    symbol, marketName, digits, rankings,
    most, second, third, least,
    signalStrength: strength, isValid, validationReason,
    suggestedContract, suggestedBarrier,
    overPct, underPct, evenPct, oddPct,
  };
}

/**
 * Validates digit eligibility before trade execution.
 */
export function validateDigitEligibility(
  digits: number[],
  contractType: string,
  barrier: number,
): { eligible: boolean; reason: string; dominantDigits: number[] } {
  if (digits.length < 10) {
    return { eligible: false, reason: 'Need 10+ ticks for analysis', dominantDigits: [] };
  }

  const len = digits.length;
  const freq = digitFrequency(digits);

  if (contractType === 'DIGITOVER') {
    const aboveDigits = digits.filter(d => d > barrier);
    const abovePct = (aboveDigits.length / len) * 100;
    const dominantAbove = freq
      .map((c, i) => ({ digit: i, count: c }))
      .filter(d => d.digit > barrier)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(d => d.digit);

    if (abovePct < 40) {
      return { eligible: false, reason: `Over ${barrier} only ${abovePct.toFixed(1)}% — need 40%+`, dominantDigits: dominantAbove };
    }
    return { eligible: true, reason: `Over ${barrier} at ${abovePct.toFixed(1)}% ✓`, dominantDigits: dominantAbove };
  }

  if (contractType === 'DIGITUNDER') {
    const belowDigits = digits.filter(d => d < barrier);
    const belowPct = (belowDigits.length / len) * 100;
    const dominantBelow = freq
      .map((c, i) => ({ digit: i, count: c }))
      .filter(d => d.digit < barrier)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(d => d.digit);

    if (belowPct < 40) {
      return { eligible: false, reason: `Under ${barrier} only ${belowPct.toFixed(1)}% — need 40%+`, dominantDigits: dominantBelow };
    }
    return { eligible: true, reason: `Under ${barrier} at ${belowPct.toFixed(1)}% ✓`, dominantDigits: dominantBelow };
  }

  if (contractType === 'DIGITEVEN') {
    const evenCount = digits.filter(d => d % 2 === 0).length; // 0 is even
    const evenPct = (evenCount / len) * 100;
    if (evenPct < 48) {
      return { eligible: false, reason: `Even at ${evenPct.toFixed(1)}% — weak`, dominantDigits: [0, 2, 4, 6, 8] };
    }
    return { eligible: true, reason: `Even at ${evenPct.toFixed(1)}% ✓`, dominantDigits: [0, 2, 4, 6, 8] };
  }

  if (contractType === 'DIGITODD') {
    const oddCount = digits.filter(d => d % 2 !== 0).length;
    const oddPct = (oddCount / len) * 100;
    if (oddPct < 48) {
      return { eligible: false, reason: `Odd at ${oddPct.toFixed(1)}% — weak`, dominantDigits: [1, 3, 5, 7, 9] };
    }
    return { eligible: true, reason: `Odd at ${oddPct.toFixed(1)}% ✓`, dominantDigits: [1, 3, 5, 7, 9] };
  }

  return { eligible: true, reason: 'No digit validation needed', dominantDigits: [] };
}

/**
 * STANDARD MARTINGALE recovery state.
 * LOSS → multiply stake. WIN → reset to base.
 */
export interface RecoveryState {
  inRecovery: boolean;
  lastWasLoss: boolean;
  baseStake: number;
  currentStake: number;
  consecutiveLosses: number;
}

export function getRecoveryAction(
  state: RecoveryState,
  multiplier: number,
  lastResult: 'won' | 'lost' | null,
): { barrier: string; nextStake: number; newState: RecoveryState } {
  const newState = { ...state };

  if (lastResult === 'lost') {
    // LOSS → apply martingale (increase stake)
    newState.inRecovery = true;
    newState.lastWasLoss = true;
    newState.consecutiveLosses = state.consecutiveLosses + 1;
    newState.currentStake = state.currentStake * multiplier;
    console.log(`[Martingale] LOSS → stake increased to ${newState.currentStake.toFixed(2)}`);
  } else if (lastResult === 'won') {
    // WIN → reset stake to base
    newState.currentStake = state.baseStake;
    newState.lastWasLoss = false;
    newState.inRecovery = false;
    newState.consecutiveLosses = 0;
    console.log(`[Martingale] WIN → stake reset to base ${newState.currentStake.toFixed(2)}`);
  }

  // Barrier: normal = OVER 1, recovery = OVER 3
  const barrier = newState.inRecovery ? '3' : '1';

  return {
    barrier,
    nextStake: newState.currentStake,
    newState,
  };
}
