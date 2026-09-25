// Value-unit preference (Native / Gwei / Wei) behind the transaction
// Value and Transaction Fee rows, stored per browser under 'be:valueUnit'
// (same prefix family as be:theme / be:searchHistory / be:lastChainId).
//
// Idioms follow the two existing single-reader storage modules: reads and
// writes are best-effort like themePreference (an unavailable localStorage
// degrades to the 'native' default and never breaks rendering), and change
// notification is the listener-set shape of util/apiBase — setValueUnit
// wakes every mounted consumer (the UnitToggle and the rows it governs)
// without a reload. This module is the single reader/writer of the key.

import { formatUnits } from 'viem';

export const VALUE_UNIT_STORAGE_KEY = 'be:valueUnit';

export type UnitPreference = 'native' | 'gwei' | 'wei';

const listeners = new Set<() => void>();

// Session memory of the last value written through setValueUnit: the read
// fallback when localStorage is unreadable, so a fully private-mode
// session keeps its in-session choice instead of snapping back to
// 'native' after every toggle (the choice still does not persist).
let lastWritten: UnitPreference | null = null;

/** The stored preference; anything absent or unusable reads as 'native'. */
export function getValueUnit(): UnitPreference {
  try {
    const raw = localStorage.getItem(VALUE_UNIT_STORAGE_KEY);
    return raw === 'gwei' || raw === 'wei' ? raw : 'native';
  } catch {
    return lastWritten ?? 'native';
  }
}

/**
 * Persist a choice (best-effort — see module header) and notify every
 * subscriber. The notification is not conditioned on persistence: a
 * toggle click always flips mounted consumers for the session.
 */
export function setValueUnit(unit: UnitPreference): void {
  lastWritten = unit;
  try {
    localStorage.setItem(VALUE_UNIT_STORAGE_KEY, unit);
  } catch {
    // Quota/private mode — the choice lasts only for this session.
  }
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribe to preference changes. Returns the unsubscribe function. */
export function subscribeValueUnit(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// 1 gwei in wei — a fixed EVM constant, independent of the chain's
// native-currency decimals.
const GWEI_IN_WEI = 10n ** 9n;

// en-US digit grouping for the integer readouts ("1,152,921,504").
// Intl.NumberFormat formats BigInt exactly (no Number coercion — wei
// figures exceed 2^53), which is why the gwei/wei paths never touch
// Number arithmetic.
const groupedInteger = new Intl.NumberFormat('en-US');

export type FormattedValue = {
  /** Complete human string including the unit ("1.0000 ETH", "12 gwei"). */
  text: string;
  /** Machine unit of `text`: the chain symbol, 'gwei', or 'wei'. */
  unitLabel: string;
};

/**
 * Format a wei amount under a unit preference.
 *
 * - native: the shared display contract of formatValue in utils/format
 *   (zero exact, dust floor at the 4th decimal, 4-decimal figures),
 *   generalized to the chain's own decimals — byte-identical to the
 *   pre-toggle Value row on 18-decimal chains.
 * - gwei/wei: the exact integer in that unit, en-US grouped. Gwei
 *   truncates sub-gwei wei (integer readout); the exact wei stays
 *   available to callers, e.g. via the row's title attribute — the same
 *   honesty pattern as the native dust floor.
 */
export function formatValueByUnit(
  valueWei: bigint,
  chain: { decimals: number; symbol: string },
  unit: UnitPreference,
): FormattedValue {
  if (unit === 'native') {
    const { symbol, decimals } = chain;
    if (valueWei === 0n) return { text: `0 ${symbol}`, unitLabel: symbol };
    // 1/10000 of the native unit in integer wei — the display floor,
    // compared exactly (10^14 wei on an 18-decimal chain).
    const dustFloor = 10n ** BigInt(Math.max(decimals - 4, 0));
    if (valueWei < dustFloor) return { text: `<0.0001 ${symbol}`, unitLabel: symbol };
    const figure = Number.parseFloat(formatUnits(valueWei, decimals)).toFixed(4);
    return { text: `${figure} ${symbol}`, unitLabel: symbol };
  }
  const wholeUnits = unit === 'wei' ? valueWei : valueWei / GWEI_IN_WEI;
  return { text: `${groupedInteger.format(wholeUnits)} ${unit}`, unitLabel: unit };
}
