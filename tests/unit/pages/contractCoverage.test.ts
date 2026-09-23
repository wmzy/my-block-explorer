// deriveContractCoverage unit tests: the Contract page's badge summary is
// a pure fold over source-ABI verification state, the local events index
// provenance, and the (lazily visited) storage-layout lookup.
import { describe, it, expect } from 'vitest';
import { deriveContractCoverage, type ContractCoverageInputs } from '@/views/Contract/coverage';

// Verified contract, storage tab not opened yet: source/ABI and storage
// are cached-immutable channels, but events ride the local index — the
// discovered level wins the aggregate, so the chip never reads "live".
const verified: ContractCoverageInputs = {
  source: { loading: false, failed: false, verificationStatus: 'verified' },
  storage: { visited: false, loading: false, failed: false, found: false, inferred: false },
};

const lines = (inputs: ContractCoverageInputs) => deriveContractCoverage(inputs).detail;

describe('deriveContractCoverage', () => {
  it('aggregates a verified, storage-unvisited page to discovered', () => {
    const summary = deriveContractCoverage(verified);
    expect(summary.level).toBe('discovered');
    expect(summary.label).toBe('Data coverage: discovered');
  });

  it('lists one detail line per source in fixed order', () => {
    expect(lines(verified)).toEqual([
      'Source & ABI: verified — cached verification artifacts (immutable once indexed)',
      expect.stringContaining('Events: your local event index (DuckDB)'),
      expect.stringContaining('Storage layout: cached server-side'),
    ]);
  });

  it('names the events line as index provenance with the tab pointer, never full-history', () => {
    const events = lines(verified)[1];
    expect(events).toContain('configured indexing ranges only');
    expect(events).toContain('Events tab shows the live coverage bar');
  });

  it('maps an unverified contract to unavailable with a constructive line', () => {
    const summary = deriveContractCoverage({
      ...verified,
      source: { loading: false, failed: false, verificationStatus: 'unverified' },
    });
    expect(summary.level).toBe('unavailable');
    expect(summary.detail[0]).toContain('Source & ABI: not verified');
    expect(summary.detail[0]).toContain('paste a custom ABI');
    expect(summary.detail[0]).toContain('verify at Sourcify');
  });

  it('keeps partially verified source on the cached level', () => {
    const summary = deriveContractCoverage({
      ...verified,
      source: { loading: false, failed: false, verificationStatus: 'partial' },
    });
    expect(summary.level).toBe('discovered'); // events still dominates
    expect(summary.detail[0]).toContain('partially verified');
  });

  it('treats an unknown verification status as partial, never verified', () => {
    const summary = deriveContractCoverage({
      ...verified,
      source: { loading: false, failed: false, verificationStatus: undefined },
    });
    expect(summary.detail[0]).toContain('verification status unknown');
    // 'sampled' sits between discovered and partial in severity — the
    // unknown-status line must outrank the events index.
    expect(summary.level).toBe('partial');

    const unrecognized = deriveContractCoverage({
      ...verified,
      source: { loading: false, failed: false, verificationStatus: 'manual' },
    });
    expect(unrecognized.detail[0]).toContain('verification status unknown');
  });

  it('maps source loading and lookup failure to partial/unavailable', () => {
    const loading = deriveContractCoverage({
      ...verified,
      source: { loading: true, failed: false, verificationStatus: undefined },
    });
    expect(loading.level).toBe('partial');
    expect(loading.detail[0]).toContain('loading verification status');

    const failed = deriveContractCoverage({
      ...verified,
      source: { loading: false, failed: true, verificationStatus: undefined },
    });
    expect(failed.level).toBe('unavailable');
    expect(failed.detail[0]).toContain('verification lookup failed');
  });

  it('reflects the visited storage states once the tab has been opened', () => {
    const found = deriveContractCoverage({
      ...verified,
      storage: { visited: true, loading: false, failed: false, found: true, inferred: false },
    });
    expect(found.detail[2]).toContain('cached verification artifact');
    expect(found.level).toBe('discovered');

    const inferred = deriveContractCoverage({
      ...verified,
      storage: { visited: true, loading: false, failed: false, found: true, inferred: true },
    });
    expect(inferred.detail[2]).toContain('inferred from bytecode');
    expect(inferred.detail[2]).toContain('not verified artifacts');

    const missing = deriveContractCoverage({
      ...verified,
      storage: { visited: true, loading: false, failed: false, found: false, inferred: false },
    });
    expect(missing.level).toBe('unavailable');
    expect(missing.detail[2]).toContain('not available for this contract');

    const failedLookup = deriveContractCoverage({
      ...verified,
      storage: { visited: true, loading: false, failed: true, found: false, inferred: false },
    });
    expect(failedLookup.level).toBe('unavailable');
    expect(failedLookup.detail[2]).toContain('lookup failed');

    const loading = deriveContractCoverage({
      ...verified,
      storage: { visited: true, loading: true, failed: false, found: false, inferred: false },
    });
    expect(loading.level).toBe('partial');
    expect(loading.detail[2]).toContain('Storage layout: loading');
  });
});
