// Pure derivation of the Address page's aggregated coverage badge: one
// CoverageSource per data channel, folded by aggregateCoverage (worst
// level wins). Every detail line states what that source's coverage IS —
// these are the relocated long caveat sentences that used to render
// inline on the page; the page keeps only their one-liner chips.
import {
  aggregateCoverage,
  type CoverageSource,
  type CoverageSummary,
} from '@/components/ui/CoverageBadge';

export type AddressCoverageInputs = {
  /** Live RPC balance/nonce read (services/addressRealTime). */
  readonly realtime: { readonly loading: boolean; readonly failed: boolean };
  /** Backend-indexed address details (verification, name, creation). */
  readonly indexed: { readonly loading: boolean; readonly failed: boolean };
  /** Heuristic transaction-history scan (services/addresses). */
  readonly txHistory: {
    /** False while the scan is gated off (a transfers-only deep link). */
    readonly active: boolean;
    readonly loading: boolean;
    readonly failed: boolean;
    readonly coverage?: 'complete' | 'partial' | 'none';
    readonly reason?: string;
    readonly searchWindowBlocks?: number;
    /**
     * Coverage asserted by the persistent deep-scan job riding the tx
     * payload (deepScan.coverage): 'complete' ONLY when a genesis-anchored
     * walk finished — the product's single sanctioned complete path. Any
     * other job state (or no job at all) leaves the levels below
     * untouched.
     */
    readonly deepScanCoverage?: 'complete' | null;
  };
  /** Opt-in token-transfers log scan (shared with the transfers tab). */
  readonly transfersScan: {
    readonly scanned: boolean;
    readonly loading: boolean;
    readonly failed: boolean;
  };
  /** Backend-persisted personal labels. */
  readonly labels: { readonly loading: boolean; readonly failed: boolean };
};

const realtimeSource = ({
  loading,
  failed,
}: AddressCoverageInputs['realtime']): CoverageSource => {
  if (failed) {
    return {
      level: 'unavailable',
      detail: 'Balance & nonce: the live RPC read failed — these values are unavailable right now',
    };
  }
  if (loading) {
    return { level: 'partial', detail: 'Balance & nonce: reading from the live chain RPC…' };
  }
  return {
    level: 'live',
    detail: 'Balance & nonce: read live from the chain RPC at the latest block',
  };
};

const indexedSource = ({
  loading,
  failed,
}: AddressCoverageInputs['indexed']): CoverageSource => {
  if (failed) {
    return {
      level: 'unavailable',
      detail:
        'Indexed details (verification status, contract name, creation info): the explorer\'s indexing backend is not connected — these rows need it, while balance, nonce and the type classification still come from the live chain RPC',
    };
  }
  if (loading) {
    return {
      level: 'partial',
      detail: 'Indexed details (verification status, contract name, creation info): loading from the explorer index…',
    };
  }
  return {
    level: 'cached-immutable',
    detail:
      'Indexed details (verification status, contract name, creation info): cached in the explorer\'s local index — not a live chain read',
  };
};

const windowPhrase = (blocks: number | undefined): string =>
  blocks !== undefined ? `the last ${blocks.toLocaleString()} blocks` : 'a capped block window';

const txHistorySource = ({
  active,
  loading,
  failed,
  coverage,
  reason,
  searchWindowBlocks,
  deepScanCoverage,
}: AddressCoverageInputs['txHistory']): CoverageSource => {
  if (failed) {
    return {
      level: 'unavailable',
      detail: 'Transaction history: the history search failed — retry from the Transactions tab',
    };
  }
  if (!active) {
    return {
      level: 'partial',
      detail: 'Transaction history: scan deferred — it runs on demand from the Transactions tab',
    };
  }
  if (loading) {
    return { level: 'partial', detail: 'Transaction history: heuristic scan running…' };
  }
  // Deep scan lift: a finished genesis-anchored walk proved the external
  // history exhaustive, so this source upgrades to the deep-scan complete
  // claim no matter what the heuristic window alone would say. The only
  // sanctioned complete path in the product — the genesis anchor is what
  // makes "no activity outside the walk" provable.
  if (deepScanCoverage === 'complete') {
    return {
      level: 'discovered',
      detail:
        'Transaction history: complete (deep scan) — every block from genesis was walked verifying balance checkpoints, so no external transaction is missing (internal transfers and token transfers stay in their own tabs)',
    };
  }
  if (coverage === 'complete') {
    return {
      level: 'discovered',
      detail:
        'Transaction history: complete discovery asserted for external transactions — internal transfers (Internal Txns tab) and token transfers (Token Transfers tab) stay outside the scan',
    };
  }
  if (coverage === 'partial') {
    if (reason === 'no-outgoing-transactions') {
      return {
        level: 'partial',
        detail:
          'Transaction history: no outgoing transactions found (nonce is 0) — incoming activity is undetectable without a full indexer',
      };
    }
    return {
      level: 'partial',
      detail: `Transaction history: external transactions discovered heuristically within ${windowPhrase(
        searchWindowBlocks,
      )} — token transfers and internal transfers live in their own tabs and are not included`,
    };
  }
  if (coverage === 'none') {
    if (reason === 'search-failed') {
      return {
        level: 'unavailable',
        detail:
          'Transaction history: search timed out — temporarily unavailable, not an empty result',
      };
    }
    if (reason === 'zero-balance') {
      return {
        level: 'unavailable',
        detail:
          'Transaction history: not scannable — the balance-history heuristic needs a non-zero balance, so incoming activity is invisible to it',
      };
    }
    return { level: 'unavailable', detail: 'Transaction history: no coverage from the discovery scan' };
  }
  // Settled payload without coverage tags (a legacy pre-coverage cache
  // entry): the source is unknown, so the history may be incomplete.
  return {
    level: 'partial',
    detail:
      'Transaction history: data source unknown (pre-coverage cache) — may be incomplete; verify on an external explorer',
  };
};

const transfersScanSource = ({
  scanned,
  loading,
  failed,
}: AddressCoverageInputs['transfersScan']): CoverageSource => {
  if (failed) {
    return {
      level: 'unavailable',
      detail: 'Token transfers: scan failed — see the Token Transfers tab',
    };
  }
  if (!scanned) {
    return {
      level: 'partial',
      detail: 'Token transfers: not scanned yet — opt in from the Overview card or the Token Transfers tab',
    };
  }
  if (loading) {
    return { level: 'partial', detail: 'Token transfers: on-demand log scan running…' };
  }
  return {
    level: 'discovered',
    detail:
      'Token transfers: discovered by an on-demand log scan over a capped block window (ERC-20/721/1155)',
  };
};

// Holdings/NFT aggregate over the SAME scan, so they derive from its state.
const holdingsSource = (scan: AddressCoverageInputs['transfersScan']): CoverageSource => {
  if (scan.failed) {
    return {
      level: 'unavailable',
      detail: 'Holdings & NFTs: unavailable — the transfers scan failed',
    };
  }
  if (!scan.scanned) {
    return {
      level: 'partial',
      detail: 'Holdings & NFTs: not computed yet — they aggregate the token-transfer scan',
    };
  }
  if (scan.loading) {
    return { level: 'partial', detail: 'Holdings & NFTs: aggregating as the scan progresses…' };
  }
  return {
    level: 'discovered',
    detail:
      'Holdings & NFTs: NET aggregates over the discovered transfers — approximations, never a full-indexer holdings list',
  };
};

const labelsSource = ({
  loading,
  failed,
}: AddressCoverageInputs['labels']): CoverageSource => {
  if (failed) {
    return {
      level: 'unavailable',
      detail: 'Labels: the explorer backend is unreachable — personal annotations are unavailable',
    };
  }
  if (loading) {
    return { level: 'partial', detail: 'Labels: loading your saved annotation…' };
  }
  return {
    level: 'cached-immutable',
    detail:
      'Labels: your personal annotations, stored in the explorer\'s local database (editable there, not chain data)',
  };
};

export function deriveAddressCoverage(inputs: AddressCoverageInputs): CoverageSummary {
  return aggregateCoverage([
    realtimeSource(inputs.realtime),
    indexedSource(inputs.indexed),
    txHistorySource(inputs.txHistory),
    transfersScanSource(inputs.transfersScan),
    holdingsSource(inputs.transfersScan),
    labelsSource(inputs.labels),
  ]);
}
