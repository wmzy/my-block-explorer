// Value-unit preference (Native / Gwei / Wei) behind the transaction
// Value and Transaction Fee rows, stored per browser under the manifest
// key (same prefix family as the theme and the search history).
//
// Idioms follow the two existing single-reader storage modules: reads and
// writes are best-effort like themePreference (an unavailable localStorage
// degrades to the 'native' default and never breaks rendering), and change
// notification is the listener-set shape of util/apiBase — setValueUnit
// wakes every mounted consumer (the UnitToggle and the rows it governs)
// without a reload. This module is the single reader/writer of the key.

import { readStorageItem, writeStorageItem } from '@/util/storageAccess';
import { VALUE_UNIT_STORAGE_KEY } from '@/util/storageKeys';
import { formatValueAmount } from '@/utils/format';

// Canonical literal lives in the manifest (util/storageKeys.ts);
// re-exported so existing consumers keep this import point.
export { VALUE_UNIT_STORAGE_KEY };

export type UnitPreference = 'native' | 'gwei' | 'wei';

const listeners = new Set<() => void>();

// Session memory of the last value written through setValueUnit: the read
// fallback when localStorage is unreadable, so a fully private-mode
// session keeps its in-session choice instead of snapping back to
// 'native' after every toggle (the choice still does not persist).
let lastWritten: UnitPreference | null = null;

/** The stored preference; anything absent or unusable reads as 'native'. */
export function getValueUnit(): UnitPreference {
  const raw = readStorageItem(VALUE_UNIT_STORAGE_KEY);
  if (raw === 'gwei' || raw === 'wei') return raw;
  // The guarded read collapses "storage threw" and "nothing stored" into
  // null — lastWritten is the session memory for both halves of that
  // case: an unreadable browser AND a write that could not persist keep
  // the in-session choice instead of snapping back to 'native' after
  // every toggle. A stored-but-invalid string ('parsecs', hand-edited)
  // is authoritative absence: 'native'.
  if (raw === null) return lastWritten ?? 'native';
  return 'native';
}

/**
 * Persist a choice (best-effort — see module header) and notify every
 * subscriber. The notification is not conditioned on persistence: a
 * toggle click always flips mounted consumers for the session.
 */
export function setValueUnit(unit: UnitPreference): void {
  lastWritten = unit;
  writeStorageItem(VALUE_UNIT_STORAGE_KEY, unit);
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
 * - native: formatValueAmount in utils/format — the same numeric core
 *   formatValue renders the tx surfaces with (zero exact, dust floor at
 *   the 4th decimal, 4-decimal figures), byte-identical to the
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
    // The shared numeric display contract (utils/format.formatValueAmount
    // — the same core formatValue renders the tx surfaces with): exact
    // zero, "<0.0001" dust floor, 4 exact decimals over the chain's OWN
    // decimals, raw wei fallback on an invalid decimals.
    return { text: `${formatValueAmount(valueWei, decimals)} ${symbol}`, unitLabel: symbol };
  }
  const wholeUnits = unit === 'wei' ? valueWei : valueWei / GWEI_IN_WEI;
  return { text: `${groupedInteger.format(wholeUnits)} ${unit}`, unitLabel: unit };
}
