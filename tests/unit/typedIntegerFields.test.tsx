// User-TYPED numeric fields must not be prefix-parsed. parseInt('1e5')
// is 100000, parseInt('0x89') is 137, parseInt(' 7') is 7 and
// parseInt('20abc') is 20 — every one of those is a value the user never
// typed, silently substituted into a field that then drives a real
// request. The query-param instances of this class were fixed earlier
// (parseStrictInteger in utils/validation.ts); this file pins the
// remaining, TYPED-input surfaces, where the project convention is
// explicit: junk degrades to "no filter"/"invalid", never to a
// plausible-but-wrong number.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EventFilterPanel } from '@/components/events/EventFilterPanel';
import { searchChains } from '@/config/chains';
import { parseStrictInteger } from '@/utils/validation';

describe('parseStrictInteger (the shared strict parser)', () => {
  it('rejects the inputs parseInt silently accepted', () => {
    // Each of these is a DIFFERENT number under parseInt than the user typed.
    expect(parseStrictInteger('1e5')).toBeNull(); // 100000
    expect(parseStrictInteger('0x10')).toBeNull(); // 16
    expect(parseStrictInteger(' 7')).toBeNull(); // 7
    expect(parseStrictInteger('20abc')).toBeNull(); // 20
    expect(parseStrictInteger('1.9')).toBeNull(); // 1
    expect(parseStrictInteger('12 34')).toBeNull(); // 12
    expect(parseStrictInteger('-5')).toBeNull(); // -5 (caller decides the bound)
    expect(parseStrictInteger('')).toBeNull();
    expect(parseStrictInteger('abc')).toBeNull();
  });

  it('accepts plain decimal integers only', () => {
    expect(parseStrictInteger('0')).toBe(0);
    expect(parseStrictInteger('7')).toBe(7);
    expect(parseStrictInteger('20000000')).toBe(20_000_000);
    expect(parseStrictInteger(42)).toBe(42);
  });

  it('rejects integers beyond exact float precision', () => {
    // A block number that cannot round-trip must not become a rounded
    // neighbour that addresses a different block.
    expect(parseStrictInteger('9007199254740993')).toBeNull();
  });
});

describe('EventFilterPanel block bounds', () => {
  const renderPanel = (onFiltersChange: (filters: unknown) => void) =>
    render(
      <EventFilterPanel
        abiEvents={[]}
        initialFilters={{}}
        onApply={vi.fn()}
        onFiltersChange={onFiltersChange as never}
      />,
    );

  it('does not prefix-parse a typed From Block into a filter', () => {
    const onFiltersChange = vi.fn();
    renderPanel(onFiltersChange);

    // '1e5' is not block 100000.
    fireEvent.change(screen.getByPlaceholderText('Start block'), { target: { value: '1e5' } });

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: undefined }),
    );
  });

  it('does not prefix-parse a typed To Block into a filter', () => {
    const onFiltersChange = vi.fn();
    renderPanel(onFiltersChange);

    // A number input rejects letters in the DOM, but '1e5' is valid input
    // markup (scientific notation) and parseInt reads it as block 100000 —
    // a bound the user never typed.
    fireEvent.change(screen.getByPlaceholderText('End block'), { target: { value: '1e5' } });

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ toBlock: undefined }));
  });

  it('keeps a real numeric From Block', () => {
    const onFiltersChange = vi.fn();
    renderPanel(onFiltersChange);

    fireEvent.change(screen.getByPlaceholderText('Start block'), { target: { value: '100000' } });

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ fromBlock: 100_000 }),
    );
  });

  it('treats block 0 as a real bound, not an absent one', () => {
    const onFiltersChange = vi.fn();
    renderPanel(onFiltersChange);

    // Genesis is a real filter; an empty string is the only "no bound".
    fireEvent.change(screen.getByPlaceholderText('Start block'), { target: { value: '0' } });

    expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ fromBlock: 0 }));
  });
});

describe('chain search numeric query', () => {
  it('does not treat a hex-typed query as the decimal chain id it parses to', () => {
    // '0x89' is a hex literal, not the chain id 137 (Polygon). parseInt
    // accepted the radix prefix, so typing it exact-matched Polygon and
    // ranked it FIRST — a chain the user never named.
    const results = searchChains('0x89');
    expect(results[0]?.id).not.toBe(137);
  });

  it('does not treat scientific notation as a chain id', () => {
    // parseInt('1e5') === 100000; no such chain exists, so the exact tier
    // must simply not fire.
    expect(searchChains('1e5').every(chain => chain.id !== 100_000)).toBe(true);
  });

  it('still exact-matches a real chain id typed as digits', () => {
    expect(searchChains('137')[0]?.id).toBe(137);
  });

  it('keeps the substring tier: a partial id still finds the chain', () => {
    // Typing '1337' to find chain 1337 is the feature the substring tier
    // serves; it is driven by the raw string, never by a parsed number.
    expect(searchChains('1337')[0]?.id).toBe(1337);
  });
});
