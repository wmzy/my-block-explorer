// Approval-scan service: the address-level token-approval surface.
//
// Read-only discovery over public RPC (no indexer behind it): an adaptive
// eth_getLogs sweep of the standard approval events — the Approval
// signature (which ERC-20 and ERC-721 SHARE: same topic0, distinguished
// by indexed-topic count — ERC-20 indexes owner+spender with the value in
// data, ERC-721 indexes owner+approved+tokenId) plus ERC-1155's
// ApprovalForAll — with the viewed address pinned into the indexed owner
// topic slot, derives DISTINCT approvals, then one batched Multicall3
// read per approval at the head block reports the CURRENT state:
// allowance(owner, spender) for ERC-20, getApproved(tokenId) for ERC-721
// (live only while it still names the discovered spender), and
// isApprovedForAll(owner, operator) for ERC-1155. Honesty contract
// (project-wide): discovery is window-limited — `windowBlocks` says how
// deep the sweep went and coverage says whether it finished; a missing
// approval is never proof of absence. ERC-20 allowances are BigInt-exact
// decimal strings; values at or above 2^128 (the common "unlimited"
// convention, max-uint included) are flagged isMax.
//
// The adaptive chunk sweep (halve on provider range caps, double on clean
// chunks, provider-ceiling memory against succeed→double→fail
// oscillation) mirrors TokenTransferService's scan; its retryable-error
// classification is reused by import (isRetryableChunkError) so the two
// scans classify provider limits identically. The generic loop itself is
// module-private there, and the Approval query shape (args.owner filter,
// two events) does not fit its Transfer-only query table, so the loop
// is re-stated here against the same constant ladder rather than forked
// blind: any tuning change should be applied to both files.
import {
  getEventSelector,
  parseAbi,
  type AbiEvent,
  type Address,
  type Hex,
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

/** Approval standard a discovered row belongs to. */
export type ApprovalKind = 'erc20' | 'erc721' | 'erc1155';

/**
 * One live approval row (API contract, additive across kinds):
 * - erc20: a distinct (token, spender) pair with its current allowance.
 * - erc721: a distinct (token, spender, tokenId) triple whose current
 *   getApproved(tokenId) still names the spender.
 * - erc1155: a distinct (token, operator) pair currently approved for all.
 * ERC-20 rows are byte-compatible with the pre-kind response modulo the
 * added `kind` field. `allowance`/`isMax` are REQUIRED for wire-shape
 * stability but their semantics are kind-dependent SCOPE values, not
 * chain-read amounts, for the NFT kinds (views must render per kind —
 * this explorer never shows them for 721/1155 rows):
 * - erc20: the exact current allowance; isMax = grant >= 2^128.
 * - erc721: '1' — the approval covers exactly one token id; isMax false.
 * - erc1155: '1' — the operator grant is binary; isMax true because its
 *   scope spans EVERY token id of the contract (unbounded).
 */
export type DiscoveredApproval = {
  kind: ApprovalKind;
  // Lowercase contract addresses (API contract; checksumming is a view concern).
  token: string;
  // Approved address — spender (erc20/erc721) or operator (erc1155).
  spender: string;
  // ERC-721 only: the approved token id (decimal string, BigInt-exact).
  tokenId?: string;
  // See the type doc: exact ERC-20 amount, or the per-kind scope value.
  allowance: string;
  isMax: boolean;
};

/**
 * One raw approval event from the sweep, retained for the history
 * timeline (a DIFFERENT projection of the same discovery: not deduped to
 * distinct pairs, so repeated grants each keep their own row). Newest
 * block first, capped at MAX_APPROVAL_HISTORY_EVENTS with
 * `historyTruncated` saying so — the same window-bounded honesty as the
 * pair list, never a claim of complete history.
 *
 * Honesty note on revocations: an ApprovalForAll log with approved=false
 * in its data (and an ERC-721 Approval naming the zero address) is a
 * REVOCATION, not a grant — the field set below cannot represent that
 * distinction, so ApprovalForAll revocations are excluded at decode time
 * rather than rendered as grants. ERC-20 revocations stay: their value
 * ('0') is carried and visible.
 */
export type ApprovalHistoryEvent = {
  kind: ApprovalKind;
  // 'Approval' for the ERC-20/ERC-721 signature, 'ApprovalForAll' for
  // ERC-1155 (its own topic0).
  approvalEvent: 'Approval' | 'ApprovalForAll';
  // Lowercase contract address (API contract; checksumming is a view
  // concern).
  token: string;
  // The indexed owner (topic1) — lowercase; equals the scanned address.
  owner: string;
  // The approved address (topic2): spender (erc20/erc721) or operator
  // (erc1155) — lowercase.
  spender: string;
  blockNumber: number;
  txHash: string;
  // ERC-20 only: the granted amount from the log data, BigInt-exact
  // decimal string ('0' for a revocation). null for the NFT kinds —
  // their grant scope is not a value.
  value: string | null;
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
  // Raw approval events retained from the SAME sweep (no re-scan):
  // newest-first, capped at MAX_APPROVAL_HISTORY_EVENTS. Same
  // window-bounded honesty as the pairs — never a complete history.
  history: ApprovalHistoryEvent[];
  // True when the sweep saw more raw events than the history cap keeps.
  historyTruncated: boolean;
  // First-scan time of the ~60s cache entry (a cache hit does not reset
  // it; freshness = scan age, not serve age).
  scannedAt: string;
  // Effective discovery window in blocks (clamped 1..50M).
  windowBlocks: number;
  coverage: ApprovalScanCoverage;
  // TOTAL distinct approvals discovered in the window across ALL kinds,
  // before the read cap — the honest denominator for the truncation note.
  pairCount: number;
  // True when pairCount exceeded the read cap (only the first
  // MAX_APPROVAL_PAIRS approvals, newest-first, are read and returned).
  truncated: boolean;
  // Present when approvals were discovered but the current-state reads
  // (allowance / getApproved / isApprovedForAll) failed at transport
  // level — approvals is then empty, honestly. The literal is pinned by
  // the route/view contract and predates the NFT kinds.
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
  // topic slot (topic1) of whichever event signature the query carries.
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
// Honesty budgets: stop after this many scan steps (one step = one chunk's
// event queries — Approval plus ApprovalForAll) or this much elapsed time
// and report coverage 'partial' instead of blocking forever.
const DEFAULT_MAX_SCAN_CALLS = 40;
const DEFAULT_SCAN_TIMEOUT_MS = 25_000;
// Grace for the hard race guard (TokenTransferService pattern): the
// cooperative elapsed check fires first whenever time progresses.
const SCAN_TIMEOUT_GRACE_MS = 5_000;
// Deterministic response cache: one canonical result per
// (chain, address, window) for ~60s, like the transfers scan cache.
const APPROVALS_CACHE_TTL_MS = 60_000;
const APPROVALS_CACHE_MAX_ENTRIES = 20;
// Allowance-read cap: the first MAX_APPROVAL_PAIRS discovered approvals
// (newest-first, across ALL kinds) get a current-state read; beyond that
// the response is truncated=true and pairCount carries the honest total.
export const MAX_APPROVAL_PAIRS = 100;
// Raw-event history cap: the newest MAX_APPROVAL_HISTORY_EVENTS approval
// events from the sweep are retained for the timeline; historyTruncated
// says when more were seen. Events are NOT deduped to pairs, so the cap
// is what keeps the payload bounded on approval-heavy addresses.
export const MAX_APPROVAL_HISTORY_EVENTS = 200;
// Multicall3 batch size for the current-state reads: 100 aggregated calls
// in one eth_call can exceed some providers' response budgets, so the cap
// is split into batches of 50 (mixed-kind batches — ordering follows the
// discovered-pair order).
const MULTICALL_BATCH_SIZE = 50;
// Canonical Multicall3 deployment (same constant as services/
// tokenMetadata.ts and the Address view; the backend client is not tied
// to a single chain type, so the address must be passed explicitly).
const MULTICALL3_ADDRESS: Address = '0xcA11bde05977b3631167028862bE2a173976CA11';

// "Unlimited" threshold: grants at or above 2^128 read as Max. Covers the
// max-uint sentinel (2^256-1) and the large fixed "infinite" values some
// routers write; anything below still fits a plausible human-typed amount.
const MAX_ALLOWANCE_THRESHOLD = 2n ** 128n;

// The two query shapes, parsed once. viem's getLogs builds the on-wire
// topic vector from `event` + `args` (topic0 from the signature, the
// owner into topic1). The ERC-20-shaped Approval query ALSO returns
// ERC-721 Approval logs: providers prefix-match topic vectors, and both
// standards share topic0 — classification by topic count happens below.
// The ApprovalForAll query is separate (its own topic0).
const APPROVAL_EVENT = parseAbi([
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
])[0] as AbiEvent;
const APPROVAL_FOR_ALL_EVENT = parseAbi([
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
])[0] as AbiEvent;

// ApprovalForAll's own topic0: keccak of the ERC-1155 signature.
const APPROVAL_TOPIC0: Hex = getEventSelector('Approval(address,address,uint256)');
const APPROVAL_FOR_ALL_TOPIC0: Hex = getEventSelector('ApprovalForAll(address,address,bool)');

// A well-formed 32-byte log topic.
const TOPIC_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// The indexed address living in one topic slot (lowercase), or null when
// the topic is not a well-formed padded address.
const addressFromTopic = (topic: Hex): Address | null => {
  const address = `0x${topic.slice(-40)}`.toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(address) ? (address as Address) : null;
};

/** One approval log classified purely from its topic vector. */
export type ClassifiedApprovalLog = {
  kind: ApprovalKind;
  // The indexed owner (topic1) — lowercase.
  owner: Address;
  // The approved address (topic2): spender for ERC-20/ERC-721, operator
  // for ERC-1155 — lowercase.
  spender: Address;
  // ERC-721 only: the approved token id from topic3, decimal string.
  tokenId?: string;
};

/**
 * Pure kind classification of one approval-family log by (topic0, indexed
 * topic count): the shared Approval topic0 with 3 topics is an ERC-20
 * Approval (value rides in data), with 4 topics an ERC-721 Approval
 * (owner, approved, tokenId all indexed); ApprovalForAll's topic0 with 3
 * topics is ERC-1155. Anything else — foreign topic0, wrong topic count,
 * malformed topics — is null, never a throw.
 */
export const classifyApprovalTopics = (
  topics: readonly Hex[],
): ClassifiedApprovalLog | null => {
  const [topic0, ownerTopic, spenderTopic, tokenIdTopic] = topics;
  if (topic0 === undefined || !TOPIC_PATTERN.test(topic0)) return null;
  if (ownerTopic === undefined || spenderTopic === undefined) return null;
  if (!TOPIC_PATTERN.test(ownerTopic) || !TOPIC_PATTERN.test(spenderTopic)) return null;
  const owner = addressFromTopic(ownerTopic);
  const spender = addressFromTopic(spenderTopic);
  if (owner === null || spender === null) return null;

  if (topic0 === APPROVAL_TOPIC0) {
    if (tokenIdTopic === undefined) {
      // 3 topics: owner + spender indexed, value in data → ERC-20.
      return { kind: 'erc20', owner, spender };
    }
    if (topics.length !== 4 || !TOPIC_PATTERN.test(tokenIdTopic)) return null;
    try {
      // 4 topics: owner + approved + tokenId indexed → ERC-721.
      return { kind: 'erc721', owner, spender, tokenId: BigInt(tokenIdTopic).toString() };
    } catch {
      return null;
    }
  }
  if (topic0 === APPROVAL_FOR_ALL_TOPIC0) {
    // operator + bool approved: the operator is indexed, the flag in data.
    if (topics.length !== 3) return null;
    return { kind: 'erc1155', owner, spender };
  }
  return null;
};

const ALLOWANCE_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
]);
const ERC721_GET_APPROVED_ABI = parseAbi([
  'function getApproved(uint256 tokenId) view returns (address)',
]);
const ERC1155_IS_APPROVED_FOR_ALL_ABI = parseAbi([
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
]);

// One decoded approval log → a distinct-approval contribution, or null
// for pending/malformed logs (pure defense — topic0-filtered scans only
// see matching signatures; the classifier does the shape work).
type DiscoveredPair = {
  kind: ApprovalKind;
  token: string;
  spender: string;
  // ERC-721 only: decimal string token id.
  tokenId?: string;
  // Newest block this approval was last seen at (ordering for the read
  // cap: the most recent approvals are the ones worth showing first).
  lastBlock: number;
};

const pairMapKey = (pair: DiscoveredPair): string =>
  `${pair.kind}:${pair.token}:${pair.spender}:${pair.tokenId ?? ''}`;

// Deterministic tiebreak for same-block discoveries (the cap keeps the
// first MAX_APPROVAL_PAIRS — equal recency must not be arbitrary).
const pairSortKey = (pair: DiscoveredPair): string =>
  `${pair.token}:${pair.spender}:${pair.tokenId ?? ''}`;

// One classified log → a distinct-approval contribution (the classifier
// has done the shape work; pending/malformed logs were filtered before
// this point).
const pairFromLog = (log: ScanLog, classified: ClassifiedApprovalLog): DiscoveredPair => ({
  kind: classified.kind,
  token: log.address.toLowerCase(),
  spender: classified.spender,
  ...(classified.tokenId !== undefined ? { tokenId: classified.tokenId } : {}),
  lastBlock: Number(log.blockNumber ?? 0),
});

// A well-formed 32-byte data word (the non-indexed ERC-20 amount / the
// ERC-1155 bool). Anything else is malformed on the wire.
const DATA_WORD_PATTERN = /^0x[0-9a-fA-F]{64}$/;

// One classified log → a raw history event, or null when it cannot be
// placed on the timeline honestly: pending logs (no block/tx), an
// ApprovalForAll REVOCATION (approved=false rides in the data — see the
// ApprovalHistoryEvent doc: never rendered as a grant), malformed data
// words, or an ERC-20 amount that did not decode (value stays null only
// for shape-level failures; a decoded '0' is a visible revocation).
const historyEventFromLog = (
  log: ScanLog,
  classified: ClassifiedApprovalLog,
): ApprovalHistoryEvent | null => {
  if (log.blockNumber === null || log.transactionHash === null) return null;
  if (classified.kind === 'erc1155') {
    if (!DATA_WORD_PATTERN.test(log.data)) return null;
    if (BigInt(log.data) === 0n) return null;
  }
  let value: string | null = null;
  if (classified.kind === 'erc20') {
    if (!DATA_WORD_PATTERN.test(log.data)) return null;
    value = BigInt(log.data).toString();
  }
  return {
    kind: classified.kind,
    approvalEvent: classified.kind === 'erc1155' ? 'ApprovalForAll' : 'Approval',
    token: log.address.toLowerCase(),
    owner: classified.owner,
    spender: classified.spender,
    blockNumber: Number(log.blockNumber),
    txHash: log.transactionHash.toLowerCase(),
    value,
  };
};

// Unwraps one viem multicall outcome's result. With allowFailure, viem
// wraps each result as { status: 'success', result } or
// { status: 'failure', error }; test doubles may hand back a bare null
// for a reverted call. Anything unsuccessful decodes to null.
const readMulticallResult = (outcome: unknown): unknown => {
  if (typeof outcome === 'object' && outcome !== null && 'status' in outcome) {
    const o = outcome as { status?: unknown; result?: unknown };
    if (o.status === 'success') return o.result;
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
  // Raw events retained at the sweep boundary (newest-first, capped).
  history: ApprovalHistoryEvent[];
  historyTruncated: boolean;
  covered: boolean;
  failed: boolean;
};

type ApprovalsCacheEntry = {
  expiresAt: number;
  scannedAt: string;
  approvals: DiscoveredApproval[];
  history: ApprovalHistoryEvent[];
  historyTruncated: boolean;
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
  // [latest - window + 1 .. latest]: TWO owner-filtered queries per chunk
  // (the shared Approval signature + ERC-1155 ApprovalForAll). Halves the
  // chunk on provider range/cap errors (via the SHARED
  // isRetryableChunkError classification), doubles it after clean chunks
  // under the provider ceiling, stops at the call/time budget.
  // A non-retryable provider error breaks out with failed=true instead of
  // throwing, so the approvals earlier chunks found are not lost.
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
    // Raw-event retention (same sweep, no re-scan): events buffer per
    // STEP (one chunk = the Approval query + the ApprovalForAll query)
    // and flush once both returned, merging the two interleaved result
    // sets into ONE desc (block, logIndex) ordering. Steps cover
    // disjoint descending ranges, so flushed appends keep the running
    // list newest-first. The seen-key set makes re-delivered logs
    // idempotent — halved retries re-query overlapping ranges.
    const history: ApprovalHistoryEvent[] = [];
    let historyTruncated = false;
    const seenEventKeys = new Set<string>();
    type StepEvent = { event: ApprovalHistoryEvent; order: number; key: string };
    const flushStepEvents = (events: StepEvent[]): void => {
      if (events.length === 0) return;
      // Provider responses are ascending; the timeline is desc.
      events.sort((a, b) => b.event.blockNumber - a.event.blockNumber || b.order - a.order);
      for (const { event, key } of events) {
        if (seenEventKeys.has(key)) continue;
        seenEventKeys.add(key);
        if (history.length >= MAX_APPROVAL_HISTORY_EVENTS) {
          // Older than (or displacing past) the cap: dropped, and the
          // flag says so. (Deliberate non-goal: a halved retry can
          // surface newer ApprovalForAll events after the cap filled
          // with Approval ones — those drop too, flagged, never
          // fabricated.)
          historyTruncated = true;
          continue;
        }
        history.push(event);
      }
    };
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
      // This step's raw-event buffer: flushed once both queries of the
      // chunk returned (or on a hard abort — see the catch).
      let stepEvents: StepEvent[] = [];
      try {
        // One step, two owner-pinned queries: the Approval signature
        // (ERC-20 shape — the provider's prefix topic match also returns
        // the ERC-721 logs sharing topic0, split by topic count in the
        // classifier) and ERC-1155's ApprovalForAll. Both cover the SAME
        // chunk, so a retryable rejection halves the chunk for both — and
        // each query's PAIRS are recorded the moment it returns, so a
        // failure on the second never discards the first's discoveries.
        // Raw events ride the same boundary (classified once, projected
        // twice: distinct pairs + bounded history) — no second sweep.
        const record = (logs: readonly ScanLog[]): void => {
          for (const log of logs) {
            if (log.blockNumber === null) continue;
            const classified = classifyApprovalTopics(log.topics);
            if (classified === null) continue;
            const pair = pairFromLog(log, classified);
            const key = pairMapKey(pair);
            const existing = discovered.get(key);
            // Chunks walk newest-first, so the first sighting is already
            // the newest; keep it (lastBlock only matters for ordering).
            if (existing === undefined) discovered.set(key, pair);
            const event = historyEventFromLog(log, classified);
            if (event !== null) {
              stepEvents.push({
                event,
                // (block, logIndex) orders events deterministically
                // WITHIN the step — the two queries interleave there.
                // Pending shapes were filtered above; the fallback only
                // defensive-orders a log without an index.
                order: log.logIndex ?? Number.MAX_SAFE_INTEGER,
                // A log's identity: block + logIndex + tx. The spender is
                // deliberately NOT in the key — two same-kind grants in
                // one tx are two events — while logIndex keeps
                // re-delivered logs (halved retries) idempotent.
                key: `${event.blockNumber}:${log.logIndex ?? ''}:${event.txHash}`,
              });
            }
          }
        };
        record(await client.getLogs({ fromBlock, toBlock, event: APPROVAL_EVENT, args: { owner } }));
        record(
          await client.getLogs({
            fromBlock,
            toBlock,
            event: APPROVAL_FOR_ALL_EVENT,
            args: { owner },
          }),
        );
      } catch (error) {
        if (!isRetryableChunkError(error)) {
          // Hard provider error: keep what earlier chunks found and say
          // the scan failed — never throw the discovery away. The first
          // query's buffered events flush too (genuinely seen — the same
          // never-discard rule as its pairs).
          failed = true;
          const detail = error instanceof Error ? error.message : String(error);
          logger.warn(
            `Approval scan for ${address} on chain ${chainId} aborted ` +
            `(${detail}); keeping ${discovered.size} pairs found so far`,
          );
          flushStepEvents(stepEvents);
          break;
        }
        // Retryable rejection: discard the step's buffered events — the
        // halved retry (and the chunks after it) re-query this range and
        // re-deliver its logs; the dedup keys absorb the overlap. (The
        // pairs stay: they were recorded the moment their query
        // returned.)
        stepEvents = [];
        providerCeiling = chunkSize - 1;
        chunkSize = Math.max(Math.floor(chunkSize / 2), MIN_CHUNK_BLOCKS);
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Approval scan chunk for ${address} on chain ${chainId} rejected ` +
          `(${detail}); halving to ${chunkSize} blocks`,
        );
        continue;
      }
      flushStepEvents(stepEvents);
      if (lower <= oldest) {
        covered = true;
        break;
      }
      upper = lower - 1n;
      chunkSize = Math.min(chunkSize * 2, providerCeiling, MAX_CHUNK_BLOCKS);
    }

    // Newest approval first (the most recent approvals are the ones worth
    // showing when the read cap truncates); token:spender:tokenId as the
    // deterministic tiebreak.
    const pairs = [...discovered.values()].sort(
      (a, b) =>
        b.lastBlock - a.lastBlock ||
        (pairSortKey(a) < pairSortKey(b) ? -1 : pairSortKey(a) > pairSortKey(b) ? 1 : 0),
    );
    logger.info(
      `Approval scan for ${address} on chain ${chainId}: window=${effectiveWindow}, ` +
      `scan steps=${calls}, approvals=${pairs.length}, ` +
      `history events=${history.length}${historyTruncated ? ' (truncated)' : ''}, ` +
      `coverage=${failed ? 'scan-failed' : covered ? 'complete' : 'partial'}`,
    );
    return { pairs, history, historyTruncated, covered, failed };
  };

  // The Multicall3 current-state read one discovered approval maps onto
  // (per kind); null only for an internally inconsistent pair (721
  // without a token id — the classifier guarantees one).
  const pairReadSpec = (
    pair: DiscoveredPair,
    owner: Address,
  ): { pair: DiscoveredPair; call: MulticallContractCall } | null => {
    if (pair.kind === 'erc721') {
      if (pair.tokenId === undefined) return null;
      return {
        pair,
        call: {
          address: pair.token as Address,
          abi: ERC721_GET_APPROVED_ABI,
          functionName: 'getApproved',
          args: [BigInt(pair.tokenId)],
        },
      };
    }
    if (pair.kind === 'erc1155') {
      return {
        pair,
        call: {
          address: pair.token as Address,
          abi: ERC1155_IS_APPROVED_FOR_ALL_ABI,
          functionName: 'isApprovedForAll',
          args: [owner, pair.spender],
        },
      };
    }
    return {
      pair,
      call: {
        address: pair.token as Address,
        abi: ALLOWANCE_ABI,
        functionName: 'allowance',
        args: [owner, pair.spender],
      },
    };
  };

  // Narrows one current-state outcome to a live row, per kind:
  // - erc20: allowance(owner, spender) — a zero grant is an approval that
  //   is not currently live; omitted (documented in the UI caveat).
  // - erc721: getApproved(tokenId) — live only while it still names the
  //   discovered spender (zero address or another address = revoked).
  // - erc1155: isApprovedForAll(owner, operator) — live only on true.
  // Per-call reverts (the read is not standard on the discovered token)
  // decode to null and the approval is dropped — pairCount still counts
  // it (the same honesty rule across kinds).
  const rowForOutcome = (
    pair: DiscoveredPair,
    outcome: unknown,
  ): DiscoveredApproval | null => {
    const result = readMulticallResult(outcome);
    if (pair.kind === 'erc721') {
      if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(result)) return null;
      if (result.toLowerCase() !== pair.spender) return null;
      return {
        kind: 'erc721',
        token: pair.token,
        spender: pair.spender,
        tokenId: pair.tokenId ?? '0',
        // Scope values (see DiscoveredApproval): one token id granted.
        allowance: '1',
        isMax: false,
      };
    }
    if (pair.kind === 'erc1155') {
      if (result !== true) return null;
      return {
        kind: 'erc1155',
        token: pair.token,
        spender: pair.spender,
        // Scope values (see DiscoveredApproval): binary grant over every
        // token id — unbounded scope reads as Max.
        allowance: '1',
        isMax: true,
      };
    }
    if (typeof result !== 'bigint' || result <= 0n) return null;
    return {
      kind: 'erc20',
      token: pair.token,
      spender: pair.spender,
      allowance: result.toString(),
      isMax: result >= MAX_ALLOWANCE_THRESHOLD,
    };
  };

  // Batched Multicall3 current-state reads for the given approvals at
  // head — one mixed-kind list per batch (per-kind read specs merged into
  // the existing batching).
  const readCurrentValues = async (
    client: ApprovalScanClient,
    owner: Address,
    pairs: readonly DiscoveredPair[],
  ): Promise<DiscoveredApproval[]> => {
    const specs = [];
    for (const pair of pairs) {
      const spec = pairReadSpec(pair, owner);
      if (spec !== null) specs.push(spec);
    }
    const rows: DiscoveredApproval[] = [];
    for (let i = 0; i < specs.length; i += MULTICALL_BATCH_SIZE) {
      const batch = specs.slice(i, i + MULTICALL_BATCH_SIZE);
      const outcomes = await client.multicall({
        contracts: batch.map((spec) => spec.call),
        allowFailure: true,
        multicallAddress: MULTICALL3_ADDRESS,
      });
      outcomes.forEach((outcome, j) => {
        const spec = batch[j];
        if (spec === undefined) return;
        const row = rowForOutcome(spec.pair, outcome);
        if (row !== null) rows.push(row);
      });
    }
    return rows;
  };

  const service = {
    /**
     * On-demand approval list for an address: distinct approvals across
     * ERC-20, ERC-721 and ERC-1155 discovered in the window's approval
     * logs, each with its CURRENT state read at head through Multicall3
     * (allowance / getApproved / isApprovedForAll per kind).
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
          history: cached.history,
          historyTruncated: cached.historyTruncated,
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
          return { pairs: [], history: [], historyTruncated: false, covered: false, failed: true };
        }
        throw error;
      });

      // The read cap applies to the current-state reads, newest-first
      // across all kinds; the honest totals ride pairCount/truncated.
      const readPairs = outcome.pairs.slice(0, MAX_APPROVAL_PAIRS);
      const truncated = outcome.pairs.length > readPairs.length;
      let approvals: DiscoveredApproval[] = [];
      let reason: 'allowance-read-failed' | undefined;
      if (readPairs.length > 0) {
        try {
          approvals = await readCurrentValues(client, owner, readPairs);
        } catch (error) {
          // Transport-level multicall failure: the discovery stands, the
          // current values do not — say so instead of serving a list
          // that would read as "no live approvals".
          const detail = error instanceof Error ? error.message : String(error);
          logger.warn(
            `Current-state reads for ${address} on chain ${chainId} failed (${detail}); ` +
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
        history: outcome.history,
        historyTruncated: outcome.historyTruncated,
        coverage,
        pairCount: outcome.pairs.length,
        truncated,
        ...(reason !== undefined ? { reason } : {}),
      });
      return {
        approvals,
        history: outcome.history,
        historyTruncated: outcome.historyTruncated,
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
