// deriveAddressCoverage unit tests: the Address page's badge summary is a
// pure fold over per-channel states — these cases pin the mapping from
// hook states (realtime/indexed/tx scan/transfers scan/labels) to levels
// and the relocated caveat sentences that render in the badge detail.
import { describe, it, expect } from 'vitest';
import { deriveAddressCoverage, type AddressCoverageInputs } from '@/views/Address/coverage';

// A fresh, fully-settled page: live RPC fields, indexed details cached,
// heuristic history partially discovered (the realistic steady state —
// the heuristic never claims complete), transfers scan already run,
// labels stored. The partial history channel wins the aggregate, so the
// chip honestly reads "partial", never "live" or "cached".
const settled: AddressCoverageInputs = {
  realtime: { loading: false, failed: false },
  indexed: { loading: false, failed: false },
  txHistory: {
    active: true,
    loading: false,
    failed: false,
    coverage: 'partial',
    searchWindowBlocks: 10_000_000,
  },
  transfersScan: { scanned: true, loading: false, failed: false },
  labels: { loading: false, failed: false },
};

const lines = (inputs: AddressCoverageInputs) => deriveAddressCoverage(inputs).detail;

describe('deriveAddressCoverage', () => {
  it('aggregates a settled partial-history page to partial, never live or cached', () => {
    const summary = deriveAddressCoverage(settled);
    expect(summary.level).toBe('partial');
    expect(summary.label).toBe('Data coverage: partial');
  });

  it('lists one detail line per source in fixed order', () => {
    expect(lines(settled)).toEqual([
      'Balance & nonce: read live from the chain RPC at the latest block',
      expect.stringContaining('Indexed details (verification status, contract name, creation info): cached'),
      expect.stringContaining('Transaction history: external transactions discovered heuristically within the last 10,000,000 blocks'),
      'Token transfers: discovered by an on-demand log scan over a capped block window (ERC-20/721/1155)',
      'Holdings & NFTs: NET aggregates over the discovered transfers — approximations, never a full-indexer holdings list',
      expect.stringContaining('Labels: your personal annotations'),
    ]);
  });

  it('phrases an unknown search window as a capped window', () => {
    const detail = lines({
      ...settled,
      txHistory: { ...settled.txHistory, searchWindowBlocks: undefined },
    });
    expect(detail[2]).toContain('within a capped block window');
  });

  it('keeps an unscanned transfers page at partial with an opt-in line', () => {
    const summary = deriveAddressCoverage({
      ...settled,
      transfersScan: { scanned: false, loading: false, failed: false },
    });
    expect(summary.level).toBe('partial'); // already partial via tx history
    expect(summary.detail[3]).toContain('Token transfers: not scanned yet');
    expect(summary.detail[4]).toContain('Holdings & NFTs: not computed yet');
  });

  it('elevates partial to the aggregate only when it is the worst channel', () => {
    // Complete tx discovery + scanned transfers: discovered aggregate.
    const complete = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, coverage: 'complete' },
    });
    expect(complete.level).toBe('discovered');
    expect(complete.detail[2]).toContain('complete discovery asserted');
    expect(complete.detail[2]).toContain('Internal Txns tab');

    // A deferred scan on an otherwise complete page drags it to partial.
    const deferred = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, coverage: 'complete' },
      transfersScan: { scanned: false, loading: false, failed: false },
    });
    expect(deferred.level).toBe('partial');
  });

  it('maps the nonce-zero partial reason to its own honest wording', () => {
    const detail = lines({
      ...settled,
      txHistory: {
        ...settled.txHistory,
        coverage: 'partial',
        reason: 'no-outgoing-transactions',
      },
    });
    expect(detail[2]).toContain('no outgoing transactions found (nonce is 0)');
    expect(detail[2]).toContain('incoming activity is undetectable');
  });

  it('maps zero-balance and search-failed coverage:none to unavailable', () => {
    const zeroBalance = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, coverage: 'none', reason: 'zero-balance' },
    });
    expect(zeroBalance.level).toBe('unavailable');
    expect(zeroBalance.detail[2]).toContain('needs a non-zero balance');

    const searchFailed = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, coverage: 'none', reason: 'search-failed' },
    });
    expect(searchFailed.level).toBe('unavailable');
    expect(searchFailed.detail[2]).toContain('not an empty result');

    const noCoverage = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, coverage: 'none' },
    });
    expect(noCoverage.level).toBe('unavailable');
    expect(noCoverage.detail[2]).toContain('no coverage from the discovery scan');
  });

  it('treats a pre-coverage cached payload as partial with source unknown', () => {
    const summary = deriveAddressCoverage({
      ...settled,
      txHistory: {
        active: true,
        loading: false,
        failed: false,
        coverage: undefined,
        reason: undefined,
      },
    });
    expect(summary.level).toBe('partial');
    expect(summary.detail[2]).toContain('data source unknown (pre-coverage cache)');
  });

  it('reports a deferred tx scan (transfers-only deep link) as partial', () => {
    const summary = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, active: false },
    });
    expect(summary.level).toBe('partial');
    expect(summary.detail[2]).toContain('scan deferred');
  });

  it('escalates each failing channel to unavailable with its own line', () => {
    const realtime = deriveAddressCoverage({
      ...settled,
      realtime: { loading: false, failed: true },
    });
    expect(realtime.level).toBe('unavailable');
    expect(realtime.detail[0]).toContain('live RPC read failed');

    const indexed = deriveAddressCoverage({
      ...settled,
      indexed: { loading: false, failed: true },
    });
    expect(indexed.level).toBe('unavailable');
    // The relocated offline-notice sentence: what failed AND what keeps
    // working must both survive in the badge detail.
    expect(indexed.detail[1]).toContain('indexing backend is not connected');
    expect(indexed.detail[1]).toContain('still come from the live chain RPC');

    const txFailed = deriveAddressCoverage({
      ...settled,
      txHistory: { ...settled.txHistory, failed: true },
    });
    expect(txFailed.level).toBe('unavailable');
    expect(txFailed.detail[2]).toContain('history search failed');

    const scanFailed = deriveAddressCoverage({
      ...settled,
      transfersScan: { scanned: true, loading: false, failed: true },
    });
    expect(scanFailed.level).toBe('unavailable');
    expect(scanFailed.detail[3]).toContain('Token transfers: scan failed');
    expect(scanFailed.detail[4]).toContain('Holdings & NFTs: unavailable');

    const labelsFailed = deriveAddressCoverage({
      ...settled,
      labels: { loading: false, failed: true },
    });
    expect(labelsFailed.level).toBe('unavailable');
    expect(labelsFailed.detail[5]).toContain('personal annotations are unavailable');
  });

  it('reports in-flight channels as partial rather than guessing their level', () => {
    const summary = deriveAddressCoverage({
      realtime: { loading: true, failed: false },
      indexed: { loading: true, failed: false },
      txHistory: { active: true, loading: true, failed: false },
      transfersScan: { scanned: true, loading: true, failed: false },
      labels: { loading: true, failed: false },
    });
    expect(summary.level).toBe('partial');
    expect(summary.detail[0]).toContain('reading from the live chain RPC');
    expect(summary.detail[1]).toContain('loading from the explorer index');
    expect(summary.detail[2]).toContain('heuristic scan running');
    expect(summary.detail[3]).toContain('log scan running');
    expect(summary.detail[4]).toContain('aggregating as the scan progresses');
    expect(summary.detail[5]).toContain('loading your saved annotation');
  });
});
