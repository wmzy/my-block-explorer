// URL-driven state of the address page: the shared schema's parse
// semantics (deep-link survival and degradation for ?page=/?window=/
// ?ttPage=/?ttWindow=/?tab=) plus the two pure derivations the view and
// the transfers tab consume (effective activity tab, beyond-data
// convergence).
import { describe, it, expect } from 'vitest';
import {
  addressSearchSchema,
  effectiveActivityTab,
  shouldPinTransfersPage,
} from '@/views/Address/search';

// Same input shape the router feeds the schema (parseSearchInput): a
// plain object of string values from the query string.
const parse = (search: string) =>
  addressSearchSchema.parse(Object.fromEntries(new URLSearchParams(search)));

describe('addressSearchSchema', () => {
  it('parses the full shareable transfers deep link', () => {
    expect(parse('tab=transfers&ttPage=3&ttWindow=500000')).toEqual({
      page: 1,
      window: undefined,
      ttPage: 3,
      ttWindow: 500_000,
      tab: 'transfers',
    });
  });

  it('defaults every key on an empty search', () => {
    expect(parse('')).toEqual({
      page: 1,
      window: undefined,
      ttPage: 1,
      ttWindow: undefined,
      tab: undefined,
    });
  });

  describe('?ttWindow=', () => {
    it('degrades malformed and out-of-range values to the backend default', () => {
      // Same survival guarantees as ?window=: a bad deep link degrades
      // instead of throwing during render.
      expect(parse('ttWindow=abc').ttWindow).toBeUndefined();
      expect(parse('ttWindow=0').ttWindow).toBeUndefined();
      expect(parse('ttWindow=-5').ttWindow).toBeUndefined();
      expect(parse('ttWindow=1.5').ttWindow).toBeUndefined();
      expect(parse('ttWindow=50000001').ttWindow).toBeUndefined();
    });

    it('keeps in-range windows, including the RPC budget cap', () => {
      expect(parse('ttWindow=1').ttWindow).toBe(1);
      expect(parse('ttWindow=50000000').ttWindow).toBe(50_000_000);
    });

    it('is independent from the tx tab\'s ?window= key', () => {
      const parsed = parse('window=400000&ttWindow=500000');
      expect(parsed.window).toBe(400_000);
      expect(parsed.ttWindow).toBe(500_000);
    });
  });

  describe('?tab=', () => {
    it('degrades junk values to undefined (derivation decides the tab)', () => {
      expect(parse('tab=transfers').tab).toBe('transfers');
      expect(parse('tab=transactions').tab).toBe('transactions');
      expect(parse('tab=internal').tab).toBe('internal');
      expect(parse('tab=bogus').tab).toBeUndefined();
    });
  });

  describe('?ttPage=', () => {
    it('coerces to a number and degrades garbage to 1', () => {
      expect(parse('ttPage=4').ttPage).toBe(4);
      expect(parse('ttPage=abc').ttPage).toBe(1);
    });
  });
});

describe('effectiveActivityTab', () => {
  it('lets an explicit ?tab= always win', () => {
    expect(effectiveActivityTab('transactions', 5)).toBe('transactions');
    expect(effectiveActivityTab('transfers', 1)).toBe('transfers');
    expect(effectiveActivityTab('internal', 5)).toBe('internal');
  });

  it('lands a deep-linked transfers page on the transfers tab', () => {
    expect(effectiveActivityTab(undefined, 3)).toBe('transfers');
  });

  it('defaults to the transactions tab otherwise', () => {
    expect(effectiveActivityTab(undefined, 1)).toBe('transactions');
  });
});

describe('shouldPinTransfersPage', () => {
  const settled = { hasData: true, loading: false, hasError: false };

  it('pins a settled empty payload on a page past the first', () => {
    expect(shouldPinTransfersPage(settled, 0, 3)).toBe(true);
  });

  it('never pins the first page, a page with rows, or an unsettled fetch', () => {
    expect(shouldPinTransfersPage(settled, 0, 1)).toBe(false);
    expect(shouldPinTransfersPage(settled, 5, 3)).toBe(false);
    expect(shouldPinTransfersPage({ ...settled, loading: true }, 0, 3)).toBe(false);
    expect(shouldPinTransfersPage({ ...settled, hasData: false }, 0, 3)).toBe(false);
    expect(shouldPinTransfersPage({ ...settled, hasError: true }, 0, 3)).toBe(false);
  });
});
