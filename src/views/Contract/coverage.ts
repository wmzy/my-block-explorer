// Pure derivation of the Contract page's aggregated coverage badge: one
// CoverageSource per data channel, folded by aggregateCoverage (worst
// level wins). Detail lines carry the per-source provenance caveats; the
// page keeps its event-driven notices inline.
import {
  aggregateCoverage,
  type CoverageSource,
  type CoverageSummary,
} from '@/components/ui/CoverageBadge';

export type ContractCoverageInputs = {
  /** Verified source/ABI from the backend's verification cache. */
  readonly source: {
    readonly loading: boolean;
    readonly failed: boolean;
    readonly verificationStatus?: string;
  };
  /** Storage layout (cached artifact or bytecode inference). */
  readonly storage: {
    /** False until the Storage tab is first opened (lazy, zero fetch). */
    readonly visited: boolean;
    readonly loading: boolean;
    readonly failed: boolean;
    readonly found: boolean;
    /** True when the layout was inferred from bytecode (evmole). */
    readonly inferred: boolean;
  };
};

const sourceAbiSource = ({
  loading,
  failed,
  verificationStatus,
}: ContractCoverageInputs['source']): CoverageSource => {
  if (failed) {
    return {
      level: 'unavailable',
      detail:
        'Source & ABI: the verification lookup failed — the explorer API is unreachable or errored',
    };
  }
  if (loading) {
    return { level: 'partial', detail: 'Source & ABI: loading verification status…' };
  }
  if (verificationStatus === 'verified') {
    return {
      level: 'cached-immutable',
      detail: 'Source & ABI: verified — cached verification artifacts (immutable once indexed)',
    };
  }
  if (verificationStatus === 'partial') {
    return {
      level: 'cached-immutable',
      detail:
        'Source & ABI: partially verified — cached artifacts (immutable once indexed)',
    };
  }
  if (verificationStatus === 'unverified') {
    return {
      level: 'unavailable',
      detail:
        'Source & ABI: not verified — no server source or ABI; paste a custom ABI below or verify at Sourcify (linked in the info card)',
    };
  }
  return { level: 'partial', detail: 'Source & ABI: verification status unknown' };
};

// The events channel rides the local DuckDB event index, whose live
// coverage bar belongs to the Events tab (the panel owns its polling);
// the badge states the provenance and where the number lives.
const eventsSource = (): CoverageSource => ({
  level: 'discovered',
  detail:
    'Events: your local event index (DuckDB) — coverage spans the configured indexing ranges only; the Events tab shows the live coverage bar',
});

const storageLayoutSource = ({
  visited,
  loading,
  failed,
  found,
  inferred,
}: ContractCoverageInputs['storage']): CoverageSource => {
  if (!visited) {
    return {
      level: 'cached-immutable',
      detail:
        'Storage layout: cached server-side — verified layouts or bytecode inference; opens on the Storage tab',
    };
  }
  if (failed) {
    return {
      level: 'unavailable',
      detail: 'Storage layout: unavailable — the lookup failed (see the Storage tab)',
    };
  }
  if (loading) {
    return { level: 'partial', detail: 'Storage layout: loading…' };
  }
  if (found && inferred) {
    return {
      level: 'discovered',
      detail:
        'Storage layout: inferred from bytecode (unverified contract) — names and types are best-effort, not verified artifacts',
    };
  }
  if (found) {
    return {
      level: 'cached-immutable',
      detail: 'Storage layout: cached verification artifact (immutable once indexed)',
    };
  }
  return { level: 'unavailable', detail: 'Storage layout: not available for this contract' };
};

export function deriveContractCoverage(inputs: ContractCoverageInputs): CoverageSummary {
  return aggregateCoverage([
    sourceAbiSource(inputs.source),
    eventsSource(),
    storageLayoutSource(inputs.storage),
  ]);
}
