// Approval-scan service: the address-level ERC-20 approvals surface.
//
// Read-only discovery over public RPC (no indexer behind it): an adaptive
// eth_getLogs sweep of standard Approval logs (topic0 = the Approval
// signature; the viewed address pinned into the indexed owner topic slot)
// derives DISTINCT (token, spender) pairs, then one batched Multicall3
// read of allowance(owner, spender) per pair at the head block reports
// the CURRENT grant. Honesty contract (project-wide): discovery is
// window-limited — `windowBlocks` says how deep the sweep went and
// coverage says whether it finished; a missing pair is never proof of
// absence. Allowances are BigInt-exact decimal strings; values at or
// above 2^128 (the common "unlimited" convention, max-uint included) are
// flagged isMax.
//
// The adaptive chunk sweep (halve on provider range caps, double on clean
// chunks, provider-ceiling memory against succeed→double→fail
// oscillation) mirrors TokenTransferService's scan; its retryable-error
// classification is reused by import (isRetryableChunkError) so the two
// scans classify provider limits identically. The generic loop itself is
// module-private there, and the Approval query shape (args.owner filter,
// single event) does not fit its Transfer-only query table, so the loop
// is re-stated here against the same constant ladder rather than forked
// blind: any tuning change should be applied to both files.
import {
  decodeEventLog,
  parseAbi,
  type AbiEvent,
  type Address,
} from 'viem';
import { rpcManager } from './RpcManager';
import {
  isRetryableChunkError,
  type ScanLog,
} from './TokenTransferService';
import { createLogger } from '../server/logger';

// The scan-log shape is shared with the transfers scan — re-exported so
// consumers (and tests) of the approvals surface import one canonical type.
export type { ScanLog } from './TokenTransferService';

const logger = createLogger('approval-scan-service');

/** One live approval row: a distinct (token, spender) pair with its current grant. */
export type DiscoveredApproval = {
  // Lowercase contract addresses (API contract; checksumming is a view concern).
  token: string;
  spender: string;
  // Current allowance at the head block, decimal string, BigInt-exact.
  allowance: string;
  // True when the grant is effectively unlimited (>= 2^128 — covers the
  // max-uint sentinel 2^256-1 and the other huge "infinite" conventions).
  isMax: boolean;
};

/**
 * Scan coverage honesty:
 * - 'complete': the whole requested window was swept. NEVER a claim about
 *   full chain history — the window limit is the caveat, carried by
 *   windowBlocks.
 * - 'partial': the call/time budget ran out mid-window — older approvals
 *   inside the window may be missing.
 * - 'scan-failed': the scan aborted (hard provider error or a hung call).
 *   Rows, if any, are what earlier chunks found before the abort.
 */
export type ApprovalScanCoverage = 'complete' | 'partial' | 'scan-failed';

export type ApprovalsResult = {
  approvals: DiscoveredApproval[];
  // First-scan time of the ~60s cache entry (a cache hit does not reset
  // it; freshness = scan age, not serve age).
  scannedAt: string;
  // Effective discovery window in blocks (clamped 1..50M).
  windowBlocks: number;
  coverage: ApprovalScanCoverage;
  // TOTAL distinct (token, spender) pairs discovered in the window,
  // before the read cap — the honest denominator for the truncation note.
  pairCount: number;
  // True when pairCount exceeded the allowance-read cap (only the first
  // MAX_APPROVAL_PAIRS pairs, newest-first, are read and returned).
  truncated: boolean;
  // Present when the pairs were discovered but the allowance multicall
  // failed at transport level — approvals is then empty, honestly.
  reason?: 'allowance-read-failed';
};

// Minimal structural slice of viem's PublicClient consumed by the scan
// and the allowance reads. Same philosophy as TokenTransferService's
// TransferScanClient: tests inject plain stub objects, and viem's getLogs
// has NO raw `topics` parameter (silently dropped → unfiltered firehose),
// so topic filtering happens exclusively via `event` + `args`.
export type ApprovalLogsArgs = {
  fromBlock: bigint;
  toBlock: bigint;
  event: AbiEvent;
  // Owner filter: viem pads the viewed address into the indexed owner
  // topic slot (topic1) of the Approval signature.
  args?: { owner?: Address };
};

export type MulticallContractCall = {
  address: Address;
  abi: unknown;
  functionName: string;
  args: readonly unknown[];
};

export type ApprovalScanClient = {
  getLogs: (args: ApprovalLogsArgs) => Promise<ScanLog[]>;
  getBlockNumber: () => Promise<bigint>;
  multicall: (args: {
    contracts: readonly MulticallContractCall[];
    allowFailure: boolean;
    multicallAddress: Address;
  }) => Promise<unknown[]>;
};

// Window + chunk ladder: identical values to TokenTransferService's scan
// (see the header comment — tune both together).
const DEFAULT_WINDOW_BLOCKS = 100_000;
const MAX_WINDOW_BLOCKS = 50_000_000;
const MIN_WINDOW_BLOCKS = 1;
const INITIAL_CHUNK_BLOCKS = 5_000;
const MIN_CHUNK_BLOCKS = 10;
const MAX_CHUNK_BLOCKS = 10_000;
// Honesty budgets: stop after this many getLogs calls or this much
// elapsed time and report coverage 'partial' instead of blocking forever.
const DEFAULT_MAX_SCAN_CALLS = 40;
const DEFAULT_SCAN_TIMEOUT_MS = 25_000;
// Grace for the hard race guard (TokenTransferService pattern): the
// cooperative elapsed check fires first whenever time progresses.
const SCAN_TIMEOUT_GRACE_MS = 5_000;
// Deterministic response cache: one canonical result per
// (chain, address, window) for ~60s, like the transfers scan cache.
const APPROVALS_CACHE_TTL_MS = 60_000;
const APPROVALS_CACHE_MAX_ENTRIES = 20;
// Allowance-read cap: the first MAX_APPROVAL_PAIRS discovered pairs
// (newest-first) get an allowance() read; beyond that the response is
// truncated=true and pairCount carries the honest total.
export const MAX_APPROVAL_PAIRS = 100;
// Multicall3 batch size for the allowance reads: 100 aggregated calls in
// one eth_call can exceed some providers' response budgets, so the cap is
// split into batches of 50.
const MULTICALL_BATCH_SIZE = 50;
// Canonical Multicall3 deployment (same constant as services/
// tokenMetadata.ts and the Address view; the backend client is not tied
// to a single chain type, so the address must be passed explicitly).
const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

// "Unlimited" threshold: grants at or above 2^128 read as Max. Covers the
// max-uint sentinel (2^256-1) and the large fixed "infinite" values some
// routers write; anything below still fits a plausible human-typed amount.
const MAX_ALLOWANCE_THRESHOLD = 2n ** 128n;

// The standard ERC-20 Approval shape, parsed once. viem's getLogs builds
// the on-wire topic vector from `event` + `args` (topic0 from the
// signature, the owner into topic1).
const APPROVAL_EVENT = parseAbi([
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
])[0] as AbiEvent;

const ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
]);

// decodeEventLog with a dynamic AbiEvent[] loses the literal-ABI generic,
// so args arrive untyped; narrow defensively (strict:false already admits
// malformed third-party logs).
type DecodedApprovalArgs = {
  owner?: Address;
  spender?: Address;
  value?: bigint;
};

// One decoded Approval log → a distinct-pair contribution, or null for
// pending/malformed logs (pure defense — a topic0-filtered scan only sees
// matching signatures).
type DiscoveredPair = {
  token: string;
  spender: string;
  // Newest block this pair was last seen at (ordering for the read cap:
  // the most recent approvals are the ones worth showing first).
  lastBlock: number;
};

const decodeApprovalLog = (log: ScanLog): DiscoveredPair | null => {
  if (log.blockNumber === null) return null;
  try {
    const decoded = decodeEventLog({
      abi: [APPROVAL_EVENT],
      data: log.data,
      topics: log.topics,
      strict: false,
    });
    const { owner, spender } = (decoded.args ?? {}) as DecodedApprovalArgs;
    if (!owner || !spender) return null;
    return {
      token: log.address.toLowerCase(),
      spender: spender.toLowerCase(),
      lastBlock: Number(log.blockNumber),
    };
  } catch {
    return null;
  }
};

// Narrows one viem multicall outcome to its uint256 value. With
// allowFailure, viem wraps each result as { status: 'success', result }
// or { status: 'failure', error }; test doubles may hand back a bare
// null for a reverted call. Anything unrecognized decodes to null.
const readMulticallAllowance = (outcome: unknown): bigint | null => {
  if (typeof outcome === 'object' && outcome !== null && 'status' in outcome) {
    const o = outcome as { status?: unknown; result?: unknown };
    if (o.status === 'success' && typeof o.result === 'bigint') return o.result;
  }
  return null;
};

// Hard race guard for a provider call that never settles (typed so the
// caller can distinguish it from real provider errors).
class ScanTimeoutError extends Error {}

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ScanTimeoutError(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

type ScanOutcome = {
  pairs: DiscoveredPair[];
  covered: boolean;
  failed: boolean;
};

type ApprovalsCacheEntry = {
  expiresAt: number;
  scannedAt: string;
  approvals: DiscoveredApproval[];
  coverage: ApprovalScanCoverage;
  pairCount: number;
  truncated: boolean;
  reason?: 'allowance-read-failed';
};

type ApprovalScanServiceDeps = {
  // Structural rpcManager stand-in (TokenTransferService pattern): the
  // real RpcManager's getClient returns viem's PublicClient whose method
  // types are wider than this scan needs — the singleton wiring narrows
  // through one cast, and tests inject plain stub clients directly.
  rpcManager: { getClient: (chainId: number) => Promise<ApprovalScanClient> };
  // Deterministic-budget injection points for tests.
  now?: () => number;
  maxScanCalls?: number;
  scanTimeoutMs?: number;
};

const createApprovalScanService = (deps: ApprovalScanServiceDeps) => {
  const { rpcManager } = deps;
  const now = deps.now ?? Date.now;
  const maxScanCalls = deps.maxScanCalls ?? DEFAULT_MAX_SCAN_CALLS;
  const scanTimeoutMs = deps.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;

  // Bounded LRU (Map insertion order; reads re-insert, oversize inserts
  // evict the oldest key) — TokenTransferService's transfers cache shape.
  const approvalsCache = new Map<string, ApprovalsCacheEntry>();

  const readApprovalsCache = (key: string): ApprovalsCacheEntry | null => {
    const entry = approvalsCache.get(key);
    if (!entry) return null;
    if (now() > entry.expiresAt) {
      approvalsCache.delete(key);
      return null;
    }
    approvalsCache.delete(key);
    approvalsCache.set(key, entry);
    return entry;
  };

  const writeApprovalsCache = (
    key: string,
    entry: Omit<ApprovalsCacheEntry, 'expiresAt' | 'scannedAt'>,
  ): string => {
    // Scan time is captured once per entry: later cache hits keep
    // reporting it (freshness = scan age, not serve age).
    const scannedAt = new Date(now()).toISOString();
    approvalsCache.delete(key);
    approvalsCache.set(key, { ...entry, expiresAt: now() + APPROVALS_CACHE_TTL_MS, scannedAt });
    while (approvalsCache.size > APPROVALS_CACHE_MAX_ENTRIES) {
      const oldest = approvalsCache.keys().next().value;
      if (oldest === undefined) break;
      approvalsCache.delete(oldest);
    }
    return scannedAt;
  };

  // On-demand eth_getLogs sweep, newest chunk first, over
  // [latest - window + 1 .. latest]: ONE owner-filtered Approval query
  // per chunk. Halves the chunk on provider range/cap errors (via the
  // SHARED isRetryableChunkError classification), doubles it after clean
  // chunks under the provider ceiling, stops at the call/time budget.
  // A non-retryable provider error breaks out with failed=true instead of
  // throwing, so the pairs earlier chunks found are not lost.
  const scanApprovalPairs = async (
    client: ApprovalScanClient,
    chainId: number,
    address: Address,
    effectiveWindow: number,
  ): Promise<ScanOutcome> => {
    const latest = await client.getBlockNumber();
    const window = BigInt(effectiveWindow);
    const oldest = latest >= window ? latest - window + 1n : 0n;
    const owner = address.toLowerCase() as Address;
    const discovered = new Map<string, DiscoveredPair>();
    const startedAt = now();
    let upper = latest;
    let chunkSize = INITIAL_CHUNK_BLOCKS;
    // Highest chunk size this provider is known to REJECT (range caps):
    // growth after a clean chunk stays below it (anti-oscillation memory,
    // TokenTransferService pattern).
    let providerCeiling = MAX_CHUNK_BLOCKS;
    let calls = 0;
    let covered = false;
    let failed = false;

    while (!covered) {
      if (calls >= maxScanCalls || now() - startedAt >= scanTimeoutMs) break;
      const lower = upper - BigInt(chunkSize) + 1n > oldest
        ? upper - BigInt(chunkSize) + 1n
        : oldest;
      const fromBlock = lower;
      const toBlock = upper;
      calls += 1;
      try {
        const logs = await client.getLogs({ fromBlock, toBlock, event: APPROVAL_EVENT, args: { owner } });
        for (const log of logs) {
          const pair = decodeApprovalLog(log);
          if (!pair) continue;
          const key = `${pair.token}:${pair.spender}`;
          const existing = discovered.get(key);
          // Chunks walk newest-first, so the first sighting is already
          // the newest; keep it (lastBlock only matters for ordering).
          if (existing === undefined) discovered.set(key, pair);
        }
      } catch (error) {
        if (!isRetryableChunkError(error)) {
          // Hard provider error: keep what earlier chunks found and say
          // the scan failed — never throw the discovery away.
          failed = true;
          const detail = error instanceof Error ? error.message : String(error);
          logger.warn(
            `Approval scan for ${address} on chain ${chainId} aborted ` +
            `(${detail}); keeping ${discovered.size} pairs found so far`,
          );
          break;
        }
        providerCeiling = chunkSize - 1;
        chunkSize = Math.max(Math.floor(chunkSize / 2), MIN_CHUNK_BLOCKS);
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Approval scan chunk for ${address} on chain ${chainId} rejected ` +
          `(${detail}); halving to ${chunkSize} blocks`,
        );
        continue;
      }
      if (lower <= oldest) {
        covered = true;
        break;
      }
      upper = lower - 1n;
      chunkSize = Math.min(chunkSize * 2, providerCeiling, MAX_CHUNK_BLOCKS);
    }

    // Newest pair first (the most recent approvals are the ones worth
    // showing when the read cap truncates); token:spender as the
    // deterministic tiebreak.
    const pairs = [...discovered.values()].sort(
      (a, b) => b.lastBlock - a.lastBlock || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0),
    );
    logger.info(
      `Approval scan for ${address} on chain ${chainId}: window=${effectiveWindow}, ` +
      `getLogs calls=${calls}, pairs=${pairs.length}, ` +
      `coverage=${failed ? 'scan-failed' : covered ? 'complete' : 'partial'}`,
    );
    return { pairs, covered, failed };
  };

  // Batched Multicall3 allowance reads for the given pairs at head.
  // Per-call reverts (allowance() is not standard on the discovered
  // token) decode to null and the pair is dropped — pairCount still
  // counts it. A grant of zero is an approval that is not currently
  // live; showing it as a row would overstate the surface, so those are
  // omitted too (documented in the UI caveat).
  const readAllowances = async (
    client: ApprovalScanClient,
    owner: Address,
    pairs: readonly DiscoveredPair[],
  ): Promise<DiscoveredApproval[]> => {
    const rows: DiscoveredApproval[] = [];
    for (let i = 0; i < pairs.length; i += MULTICALL_BATCH_SIZE) {
      const batch = pairs.slice(i, i + MULTICALL_BATCH_SIZE);
      const outcomes = await client.multicall({
        contracts: batch.map((pair) => ({
          address: pair.token as Address,
          abi: ALLOWANCE_ABI,
          functionName: 'allowance',
          args: [owner, pair.spender as Address],
        })),
        allowFailure: true,
        multicallAddress: MULTICALL3_ADDRESS,
      });
      outcomes.forEach((outcome, j) => {
        const pair = batch[j];
        if (pair === undefined) return;
        const allowance = readMulticallAllowance(outcome);
        if (allowance === null || allowance <= 0n) return;
        rows.push({
          token: pair.token,
          spender: pair.spender,
          allowance: allowance.toString(),
          isMax: allowance >= MAX_ALLOWANCE_THRESHOLD,
        });
      });
    }
    return rows;
  };

  const service = {
    /**
     * On-demand ERC-20 approval list for an address: distinct
     * (token, spender) pairs discovered in the window's Approval logs,
     * each with its CURRENT allowance read at head through Multicall3.
     * No DuckDB writes, no token metadata reads — symbol/decimals are
     * the frontend's job (services/tokenMetadata.ts is React/frontend-
     * RPC bound, deliberately not reused server-side; the response
     * carries raw lowercase token addresses).
     *
     * `refresh` bypasses the cache read (a fresh scan even while a
     * not-yet-expired entry exists) and overwrites the entry — the
     * semantic behind an explicit Retry.
     */
    getApprovals: async (
      chainId: number,
      address: Address,
      windowBlocks?: number,
      refresh = false,
    ): Promise<ApprovalsResult> => {
      // Explicit windows clamp into [1, MAX]; undefined uses the default.
      const effectiveWindow = windowBlocks === undefined
        ? DEFAULT_WINDOW_BLOCKS
        : Math.min(Math.max(Math.trunc(windowBlocks), MIN_WINDOW_BLOCKS), MAX_WINDOW_BLOCKS);
      const owner = address.toLowerCase() as Address;
      const cacheKey = `${chainId}:${owner}:${effectiveWindow}`;

      // Cache-bypass refresh: skip the read entirely so an explicit
      // Retry always re-scans.
      const cached = refresh ? null : readApprovalsCache(cacheKey);
      if (cached) {
        logger.info(`Serving cached approval scan for ${address} on chain ${chainId}`);
        return {
          approvals: cached.approvals,
          scannedAt: cached.scannedAt,
          windowBlocks: effectiveWindow,
          coverage: cached.coverage,
          pairCount: cached.pairCount,
          truncated: cached.truncated,
          ...(cached.reason !== undefined ? { reason: cached.reason } : {}),
        };
      }

      const client = await rpcManager.getClient(chainId);
      const outcome = await withTimeout(
        scanApprovalPairs(client, chainId, owner, effectiveWindow),
        scanTimeoutMs + SCAN_TIMEOUT_GRACE_MS,
        'Approval scan',
      ).catch((error: unknown): ScanOutcome => {
        // A hung provider call is a budget outcome, not a server error:
        // report an honest empty scan-failed instead of failing the
        // request (TokenTransferService pattern).
        if (error instanceof ScanTimeoutError) {
          logger.warn(
            `Approval scan for ${address} on chain ${chainId} hung; ` +
            `returning empty scan-failed result`,
          );
          return { pairs: [], covered: false, failed: true };
        }
        throw error;
      });

      // The read cap applies to the allowance reads, newest-first; the
      // honest totals ride pairCount/truncated.
      const readPairs = outcome.pairs.slice(0, MAX_APPROVAL_PAIRS);
      const truncated = outcome.pairs.length > readPairs.length;
      let approvals: DiscoveredApproval[] = [];
      let reason: 'allowance-read-failed' | undefined;
      if (readPairs.length > 0) {
        try {
          approvals = await readAllowances(client, owner, readPairs);
        } catch (error) {
          // Transport-level multicall failure: the discovery stands, the
          // current values do not — say so instead of serving a list
          // that would read as "no live approvals".
          const detail = error instanceof Error ? error.message : String(error);
          logger.warn(
            `Allowance reads for ${address} on chain ${chainId} failed (${detail}); ` +
            `reporting discovery without current values`,
          );
          reason = 'allowance-read-failed';
        }
      }

      const coverage: ApprovalScanCoverage = outcome.failed
        ? 'scan-failed'
        : outcome.covered
          ? 'complete'
          : 'partial';
      const scannedAt = writeApprovalsCache(cacheKey, {
        approvals,
        coverage,
        pairCount: outcome.pairs.length,
        truncated,
        ...(reason !== undefined ? { reason } : {}),
      });
      return {
        approvals,
        scannedAt,
        windowBlocks: effectiveWindow,
        coverage,
        pairCount: outcome.pairs.length,
        truncated,
        ...(reason !== undefined ? { reason } : {}),
      };
    },

    /** Drop all cached scan results (test isolation). */
    clearApprovalsCache: (): void => {
      approvalsCache.clear();
    },
  };

  return service;
};

export type ApprovalScanService = ReturnType<typeof createApprovalScanService>;
export { createApprovalScanService };

export const approvalScanService = createApprovalScanService({
  rpcManager: rpcManager as unknown as ApprovalScanServiceDeps['rpcManager'],
});
