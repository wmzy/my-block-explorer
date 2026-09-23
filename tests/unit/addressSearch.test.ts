// URL-driven state of the address page: the shared schema's parse
// semantics (deep-link survival and degradation for ?page=/?window=/
// ?ttPage=/?ttWindow=/?itDepth=/?tab=) plus the pure derivations the
// view and the transfers/internal tabs consume (effective activity tab,
// beyond-data convergence, effective internal-tx trace depth).
import { describe, it, expect } from 'vitest';
import {
  addressSearchSchema,
  effectiveActivityTab,
  effectiveInternalTxDepth,
  shouldPinTransfersPage,
} from '@/views/Address/search';
import {
  DEFAULT_INTERNAL_TX_DEPTH,
  MAX_INTERNAL_TX_DEPTH,
  MIN_INTERNAL_TX_DEPTH,
} from '@/utils/internalTxScan';

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
      itDepth: undefined,
      tab: 'transfers',
    });
  });

  it('defaults every key on an empty search', () => {
    expect(parse('')).toEqual({
      page: 1,
      window: undefined,
      ttPage: 1,
      ttWindow: undefined,
      itDepth: undefined,
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

  describe('?itDepth=', () => {
    it('keeps any positive integer — out-of-range values clamp downstream, not here', () => {
      // Unlike ?ttWindow= (out-of-range → undefined → default), an
      // explicit-but-extreme depth is still an intent to widen/narrow:
      // the schema lets it through and the effective derivation clamps.
      expect(parse('itDepth=25').itDepth).toBe(25);
      expect(parse('itDepth=42').itDepth).toBe(42);
      expect(parse('itDepth=9').itDepth).toBe(9);
      expect(parse('itDepth=5000').itDepth).toBe(5000);
    });

    it('degrades structurally invalid values to undefined (the scan default)', () => {
      expect(parse('itDepth=abc').itDepth).toBeUndefined();
      expect(parse('itDepth=2.5').itDepth).toBeUndefined();
      expect(parse('itDepth=').itDepth).toBeUndefined();
      expect(parse('itDepth=-3').itDepth).toBeUndefined();
      expect(parse('itDepth=0').itDepth).toBeUndefined();
    });

    it('is independent from the transfers tab\'s ?ttWindow= key', () => {
      const parsed = parse('ttWindow=500000&itDepth=50');
      expect(parsed.ttWindow).toBe(500_000);
      expect(parsed.itDepth).toBe(50);
    });
  });
});

describe('effectiveInternalTxDepth', () => {
  it('derives the scan default when the param is absent or malformed', () => {
    expect(effectiveInternalTxDepth(undefined)).toBe(DEFAULT_INTERNAL_TX_DEPTH);
  });

  it('lets an explicit in-range depth win over the default', () => {
    expect(effectiveInternalTxDepth(42)).toBe(42);
    expect(effectiveInternalTxDepth(MIN_INTERNAL_TX_DEPTH)).toBe(MIN_INTERNAL_TX_DEPTH);
    expect(effectiveInternalTxDepth(MAX_INTERNAL_TX_DEPTH)).toBe(MAX_INTERNAL_TX_DEPTH);
  });

  it('silently clamps out-of-range depths into the supported range', () => {
    // The ?ttWindow= clamp precedent: an extreme shared link still
    // widens/narrows the sweep instead of snapping back to the default.
    expect(effectiveInternalTxDepth(9)).toBe(MIN_INTERNAL_TX_DEPTH);
    expect(effectiveInternalTxDepth(1)).toBe(MIN_INTERNAL_TX_DEPTH);
    expect(effectiveInternalTxDepth(201)).toBe(MAX_INTERNAL_TX_DEPTH);
    expect(effectiveInternalTxDepth(5000)).toBe(MAX_INTERNAL_TX_DEPTH);
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
