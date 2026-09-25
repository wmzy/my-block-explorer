// Value-unit preference core (util/units): the pure wei→unit formatting
// edges (BigInt-exact integer readouts, the shared native display
// contract, chain-decimals awareness), the best-effort storage round-trip
// (themePreference idiom), and the change subscription that re-renders
// mounted consumers without a reload (apiBase listener idiom).
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  VALUE_UNIT_STORAGE_KEY,
  formatValueByUnit,
  getValueUnit,
  setValueUnit,
  subscribeValueUnit,
} from '@/util/units';

const ETH = { decimals: 18, symbol: 'ETH' };

describe('formatValueByUnit (native)', () => {
  it('renders zero exactly with the chain symbol', () => {
    expect(formatValueByUnit(0n, ETH, 'native')).toEqual({
      text: '0 ETH',
      unitLabel: 'ETH',
    });
  });

  it('floors 1 wei and 1 gwei at the shared <0.0001 dust floor', () => {
    expect(formatValueByUnit(1n, ETH, 'native').text).toBe('<0.0001 ETH');
    // 1 gwei = 10^9 wei, still below the 10^14 wei floor.
    expect(formatValueByUnit(10n ** 9n, ETH, 'native').text).toBe('<0.0001 ETH');
  });

  it('renders exactly one unit at the shared 4-decimal contract', () => {
    expect(formatValueByUnit(10n ** 18n, ETH, 'native').text).toBe('1.0000 ETH');
  });

  it('renders half a unit', () => {
    expect(formatValueByUnit(5n * 10n ** 17n, ETH, 'native').text).toBe('0.5000 ETH');
  });

  it('scales by the chain decimals instead of assuming 18', () => {
    // A 6-decimal chain: 1.234567 units = 1234567 base units → the same
    // display contract at the chain's own scale (floor at 10^2 base
    // units, 4 decimals of the native figure).
    const sixDec = { decimals: 6, symbol: 'TT' };
    expect(formatValueByUnit(1234567n, sixDec, 'native').text).toBe('1.2346 TT');
    expect(formatValueByUnit(50n, sixDec, 'native').text).toBe('<0.0001 TT');
  });
});

describe('formatValueByUnit (gwei/wei)', () => {
  it('renders 1 gwei exactly in both units', () => {
    expect(formatValueByUnit(10n ** 9n, ETH, 'gwei')).toEqual({
      text: '1 gwei',
      unitLabel: 'gwei',
    });
    expect(formatValueByUnit(10n ** 9n, ETH, 'wei').text).toBe('1,000,000,000 wei');
  });

  it('keeps a 2^60-scale wei figure exact (no Number coercion)', () => {
    // 2^60 = 1152921504606846976 — far beyond 2^53; any Number step would
    // visibly round the wei digits.
    const value = 2n ** 60n;
    expect(formatValueByUnit(value, ETH, 'wei').text).toBe(
      '1,152,921,504,606,846,976 wei',
    );
    // Gwei readout truncates the sub-gwei remainder (integer display).
    expect(formatValueByUnit(value, ETH, 'gwei').text).toBe('1,152,921,504 gwei');
  });

  it('truncates sub-gwei wei in the gwei readout', () => {
    expect(formatValueByUnit(10n ** 9n + 123n, ETH, 'gwei').text).toBe('1 gwei');
  });

  it('groups integer readouts in en-US', () => {
    expect(formatValueByUnit(1234567n * 10n ** 9n, ETH, 'gwei').text).toBe(
      '1,234,567 gwei',
    );
  });
});

describe('getValueUnit / setValueUnit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to native with nothing stored', () => {
    expect(getValueUnit()).toBe('native');
  });

  it('treats an unrecognized stored value as native', () => {
    localStorage.setItem(VALUE_UNIT_STORAGE_KEY, 'parsecs');
    expect(getValueUnit()).toBe('native');
  });

  it('round-trips every unit through storage', () => {
    for (const unit of ['gwei', 'wei', 'native'] as const) {
      setValueUnit(unit);
      expect(localStorage.getItem(VALUE_UNIT_STORAGE_KEY)).toBe(unit);
      expect(getValueUnit()).toBe(unit);
    }
  });

  it('swallows a failing write instead of breaking the click', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded');
    });
    try {
      expect(() => setValueUnit('gwei')).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });

  it('falls back to the session choice when storage is unreadable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('storage unavailable');
    });
    try {
      setValueUnit('gwei');
      expect(getValueUnit()).toBe('gwei');
    } finally {
      getItem.mockRestore();
    }
    // With reads back, the persisted value is authoritative.
    expect(localStorage.getItem(VALUE_UNIT_STORAGE_KEY)).toBe('gwei');
    expect(getValueUnit()).toBe('gwei');
  });
});

describe('subscribeValueUnit', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('notifies subscribers on set and stops after unsubscribe', () => {
    const seen: string[] = [];
    const listener = () => seen.push(getValueUnit());
    const unsubscribe = subscribeValueUnit(listener);

    setValueUnit('gwei');
    expect(seen).toEqual(['gwei']);

    unsubscribe();
    setValueUnit('wei');
    expect(seen).toEqual(['gwei']);
    expect(getValueUnit()).toBe('wei');
  });

  it('fires the listener even when the write cannot persist', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota exceeded');
    });
    const listener = vi.fn();
    const unsubscribe = subscribeValueUnit(listener);
    try {
      setValueUnit('wei');
      expect(listener).toHaveBeenCalledTimes(1);
    } finally {
      setItem.mockRestore();
      unsubscribe();
    }
  });
});
