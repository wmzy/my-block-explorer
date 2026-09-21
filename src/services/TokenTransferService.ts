import {
  decodeEventLog,
  parseAbi,
  type AbiEvent,
  type Address,
  type Hex,
} from 'viem';
import { rpcManager } from './RpcManager';
import { createLogger } from '../server/logger';

const logger = createLogger('token-transfer-service');

/**
 * Token transfer event shapes surfaced by the address transfers endpoint.
 * 'erc20-or-erc721': the plain Transfer(address,address,uint256) signature
 * is shared by ERC-20 and ERC-721, and the log alone cannot distinguish
 * them (the frontend resolves decimals/symbol per token contract).
 */
export type TokenTransferStandard = 'erc20-or-erc721' | 'erc1155-single' | 'erc1155-batch';

export type TokenTransfer = {
  txHash: string;
  blockNumber: number;
  logIndex: number;
  token: string;
  standard: TokenTransferStandard;
  from: string;
  to: string;
  value: string;
  tokenIds?: string[];
  amounts?: string[];
  // Relative to the VIEWED address. Participant mode emits 'in'/'out'
  // only; token mode (the viewed address IS the emitting token) also
  // emits 'none' for rows where the contract is neither sender nor
  // recipient (mints, burns, plain user-to-user transfers of the token).
  direction: 'in' | 'out' | 'none';
};

// Which eth_getLogs filter shape a scan uses. 'participant' (default):
// topic-filtered by the viewed address as from/to. 'token': the viewed
// address is the LOG EMITTER (the token contract itself) — filtered by
// the log address with the standard Transfer topic0 set, no participant
// filter, so a token contract's own transfers finally surface on its
// address page (participant topics rarely match the token's own logs).
export type TransferScanMode = 'participant' | 'token';

export type TokenTransfersResult = {
  transfers: TokenTransfer[];
  // Cursor for the next page as a base-10 decimal string of the numeric
  // offset into the cached sorted list; null when the list is exhausted.
  nextCursor: string | null;
  // 'complete': the whole windowBlocks range was scanned.
  // 'partial': the scan budget (call count / elapsed time) ran out first.
  coverage: 'complete' | 'partial';
  windowBlocks: number;
  // FIRST scan time of the cache entry (ISO string). A cache hit within
  // the ~60s TTL reports the original scan's time, so clients can show an
  // honest "scanned X ago" that never resets to zero while cached.
  scannedAt: string;
  // Which filter shape produced these rows — the client embeds it to
  // refuse a mode-switching stale settle from the query-layer store.
  mode: TransferScanMode;
};

// Minimal structural slice of viem's PublicClient consumed by the scan.
// Declared locally so tests inject plain stub objects without depending on
// viem's heavily generic client types.
// NOTE: viem's getLogs has NO raw `topics` parameter — passing one is
// silently dropped and the query goes out UNFILTERED (the exact bug this
// type prevented twice). Topic filtering happens exclusively via
// `event` + `args`; viem builds the topic vector from them.
export type GetLogsArgs = {
  fromBlock: bigint;
  toBlock: bigint;
  event: AbiEvent;
  // Participant filter: { from } scans outgoing, { to } scans incoming —
  // viem pads the indexed address into the right topic slot per event.
  // Token-mode queries carry no participant filter (undefined): topic0
  // alone comes from `event`, and the participant dimension is replaced
  // by `address` below.
  args?: { from?: Address; to?: Address };
  // Log-emitter filter (eth_getLogs `address`): token mode filters by the
  // viewed token contract instead of by participant topics. Absent in
  // participant mode.
  address?: Address;
};

export type ScanLog = {
  address: Address;
  topics: [Hex, ...Hex[]];
  data: Hex;
  blockNumber: bigint | null;
  transactionHash: Hex | null;
  logIndex: number | null;
};

export type TransferScanClient = {
  getLogs: (args: GetLogsArgs) => Promise<ScanLog[]>;
  getBlockNumber: () => Promise<bigint>;
};

// Default scan window (blocks) when no ?window= override is given.
const DEFAULT_WINDOW_BLOCKS = 100_000;
// Hard clamp for an explicit ?window= override.
const MAX_WINDOW_BLOCKS = 50_000_000;
const MIN_WINDOW_BLOCKS = 1;
// Adaptive chunk sizing: start optimistic, halve on provider range/result
// cap errors (floor), double on success (cap). The floor is 10 blocks:
// some free providers (e.g. blastapi) cap topic-filtered eth_getLogs at a
// 10-block range; the adaptive halving must be able to reach that limit.
const INITIAL_CHUNK_BLOCKS = 5_000;
const MIN_CHUNK_BLOCKS = 10;
const MAX_CHUNK_BLOCKS = 10_000;
// Honesty budgets: stop after this many getLogs calls total or this much
// elapsed time and report coverage 'partial' instead of blocking forever.
const DEFAULT_MAX_SCAN_CALLS = 40;
const DEFAULT_SCAN_TIMEOUT_MS = 25_000;
// Grace for the hard race guard: the cooperative elapsed check inside the
// scan loop fires first whenever time actually progresses; the race only
// catches a provider call that hangs outright.
const SCAN_TIMEOUT_GRACE_MS = 5_000;
// Deterministic pagination: one canonical full list per
// (chain, address, window); pages are request-time slices into it.
const TRANSFERS_CACHE_TTL_MS = 60_000;
const TRANSFERS_CACHE_MAX_ENTRIES = 20;

// Provider errors that mean "the requested block range (or result set) is
// too large for this endpoint" — the scan answers them by halving the
// chunk. Anything else aborts the scan and surfaces to the caller.
const RETRYABLE_CHUNK_ERROR = /range|too large|limit|results|exceed|timeout|-32005|-32062/i;

export const isRetryableChunkError = (error: unknown): boolean => {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'number' || typeof code === 'string') {
      if (RETRYABLE_CHUNK_ERROR.test(String(code))) return true;
    }
  }
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return RETRYABLE_CHUNK_ERROR.test(message);
};

// The three transfer event shapes, parsed once. viem's getLogs builds the
// on-wire topic vector from `event` + `args` — raw `topics` are NOT a viem
// parameter (silently dropped; every provider then rejects the unfiltered
// firehose), so the scan MUST go through event/args.
const TRANSFER_EVENT = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
])[0] as AbiEvent;
const TRANSFER_SINGLE_EVENT = parseAbi([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
])[0] as AbiEvent;
const TRANSFER_BATCH_EVENT = parseAbi([
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
])[0] as AbiEvent;

// Scan order matters for self-transfer dedupe: within each event shape the
// outgoing query runs before the incoming one, so a self-transfer
// (from == to == address) is recorded once with direction 'out'.
type ScanQueryKey = 'erc20' | 'single' | 'batch';
type ScanQuery = {
  key: ScanQueryKey;
  direction: 'in' | 'out';
  event: AbiEvent;
  // Participant-mode topic filter; undefined in token mode.
  args?: GetLogsArgs['args'];
  // Token-mode log-emitter filter; undefined in participant mode.
  address?: Address;
};

const scanQueriesFor = (address: Address, mode: TransferScanMode): ScanQuery[] => {
  const lower = address.toLowerCase() as Address;
  if (mode === 'token') {
    // Token-centric: one query per event shape, filtered by the LOG
    // ADDRESS (the viewed contract emits its own Transfer logs) with the
    // standard topic0 set and NO participant filter — the exact scan the
    // participant mode cannot serve (a token's own transfers rarely have
    // the token itself as from/to).
    return [
      { key: 'erc20', direction: 'out', event: TRANSFER_EVENT, address: lower },
      { key: 'single', direction: 'out', event: TRANSFER_SINGLE_EVENT, address: lower },
      { key: 'batch', direction: 'out', event: TRANSFER_BATCH_EVENT, address: lower },
    ];
  }
  return [
    { key: 'erc20', direction: 'out', event: TRANSFER_EVENT, args: { from: lower } },
    { key: 'erc20', direction: 'in', event: TRANSFER_EVENT, args: { to: lower } },
    { key: 'single', direction: 'out', event: TRANSFER_SINGLE_EVENT, args: { from: lower } },
    { key: 'single', direction: 'in', event: TRANSFER_SINGLE_EVENT, args: { to: lower } },
    { key: 'batch', direction: 'out', event: TRANSFER_BATCH_EVENT, args: { from: lower } },
    { key: 'batch', direction: 'in', event: TRANSFER_BATCH_EVENT, args: { to: lower } },
  ];
};

// Decode one log against its event shape. Returns null for logs that are
// pending (null block/tx/logIndex) or whose decoded args are incomplete —
// a topic0-filtered scan only sees matching signatures, so this is pure
// defense against malformed third-party logs.
// decodeEventLog with a dynamic AbiEvent[] loses the literal-ABI generic,
// so args arrive untyped; narrow defensively (strict:false already admits
// malformed logs — every field is optional and validated at each use).
type DecodedTransferArgs = {
  from?: Address;
  to?: Address;
  value?: bigint;
  id?: bigint;
  ids?: readonly bigint[];
  values?: readonly bigint[];
};

const decodeTransferLog = (
  key: ScanQueryKey,
  log: ScanLog,
  direction: 'in' | 'out' | 'none',
): TokenTransfer | null => {
  if (log.blockNumber === null || log.transactionHash === null || log.logIndex === null) {
    return null;
  }
  const base = {
    txHash: log.transactionHash,
    blockNumber: Number(log.blockNumber),
    logIndex: log.logIndex,
    // decodeEventLog checksums address args; the API contract is lowercase.
    token: log.address.toLowerCase(),
    direction,
  };
  try {
    if (key === 'erc20') {
      const decoded = decodeEventLog({
        abi: [TRANSFER_EVENT],
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      const { from, to, value } = (decoded.args ?? {}) as DecodedTransferArgs;
      if (!from || !to || value === undefined) return null;
      return {
        ...base,
        standard: 'erc20-or-erc721',
        from: from.toLowerCase(),
        to: to.toLowerCase(),
        value: value.toString(),
      };
    }
    if (key === 'single') {
      const decoded = decodeEventLog({
        abi: [TRANSFER_SINGLE_EVENT],
        data: log.data,
        topics: log.topics,
        strict: false,
      });
      const { from, to, id, value } = (decoded.args ?? {}) as DecodedTransferArgs;
      if (!from || !to || id === undefined || value === undefined) return null;
      return {
        ...base,
        standard: 'erc1155-single',
        from: from.toLowerCase(),
        to: to.toLowerCase(),
        value: value.toString(),
        tokenIds: [id.toString()],
        amounts: [value.toString()],
      };
    }
    const decoded = decodeEventLog({
      abi: [TRANSFER_BATCH_EVENT],
      data: log.data,
      topics: log.topics,
      strict: false,
    });
    const { from, to, ids, values } = (decoded.args ?? {}) as DecodedTransferArgs;
    if (!from || !to || !ids || !values) return null;
    const tokenIds = ids.map((id) => id.toString());
    const amounts = values.map((amount) => amount.toString());
    // A batch moves several token IDs at once; summing the heterogeneous
    // amounts is meaningless, so `value` carries the count of token IDs.
    return {
      ...base,
      standard: 'erc1155-batch',
      from: from.toLowerCase(),
      to: to.toLowerCase(),
      value: String(tokenIds.length),
      tokenIds,
      amounts,
    };
  } catch {
    return null;
  }
};

// Hard race guard for a provider call that never settles. Typed (not a
// plain Error) so the caller can distinguish it from real provider errors.
class ScanTimeoutError extends Error {}

const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new ScanTimeoutError(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

type ScanOutcome = {
  transfers: TokenTransfer[];
  coverage: 'complete' | 'partial';
};

type TransfersCacheEntry = {
  expiresAt: number;
  transfers: TokenTransfer[];
  coverage: 'complete' | 'partial';
  // First-scan time this entry reports on every cache hit (ISO string).
  scannedAt: string;
};

type TokenTransferServiceDeps = {
  // Structural rpcManager stand-in; the real RpcManager's getClient
  // returns viem's PublicClient whose getLogs types (block tags, topic
  // unions) are wider than this scan needs — the singleton wiring narrows
  // through one cast, and tests inject plain stub clients directly.
  rpcManager: { getClient: (chainId: number) => Promise<TransferScanClient> };
  // Deterministic-budget injection points for tests.
  now?: () => number;
  maxScanCalls?: number;
  scanTimeoutMs?: number;
};

const createTokenTransferService = (deps: TokenTransferServiceDeps) => {
  const { rpcManager } = deps;
  const now = deps.now ?? Date.now;
  const maxScanCalls = deps.maxScanCalls ?? DEFAULT_MAX_SCAN_CALLS;
  const scanTimeoutMs = deps.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS;

  // Bounded LRU: Map preserves insertion order, so reads re-insert to
  // refresh recency and oversize inserts evict the oldest key first.
  const transfersCache = new Map<string, TransfersCacheEntry>();

  const readTransfersCache = (key: string): TransfersCacheEntry | null => {
    const entry = transfersCache.get(key);
    if (!entry) return null;
    if (now() > entry.expiresAt) {
      transfersCache.delete(key);
      return null;
    }
    transfersCache.delete(key);
    transfersCache.set(key, entry);
    return entry;
  };

  const writeTransfersCache = (
    key: string,
    transfers: TokenTransfer[],
    coverage: 'complete' | 'partial',
  ): string => {
    // The scan time is captured once per entry: later cache hits keep
    // reporting it (freshness = scan age, not serve age).
    const scannedAt = new Date(now()).toISOString();
    transfersCache.delete(key);
    transfersCache.set(key, { expiresAt: now() + TRANSFERS_CACHE_TTL_MS, transfers, coverage, scannedAt });
    while (transfersCache.size > TRANSFERS_CACHE_MAX_ENTRIES) {
      const oldest = transfersCache.keys().next().value;
      if (oldest === undefined) break;
      transfersCache.delete(oldest);
    }
    return scannedAt;
  };

  // On-demand eth_getLogs sweep, newest chunk first, over
  // [latest - window + 1 .. latest]. Participant mode: six filtered
  // getLogs per chunk (three event shapes x two directions); token mode:
  // three (one per shape, filtered by the log's emitter address).
  // Halves the chunk on provider range/cap errors, doubles it after clean
  // chunks; stops at the call or time budget and reports coverage
  // 'partial'.
  const scanTransfers = async (
    client: TransferScanClient,
    chainId: number,
    address: Address,
    effectiveWindow: number,
    mode: TransferScanMode,
  ): Promise<ScanOutcome> => {
    const latest = await client.getBlockNumber();
    const window = BigInt(effectiveWindow);
    const oldest = latest >= window ? latest - window + 1n : 0n;
    const addressLower = address.toLowerCase() as Address;
    const queries = scanQueriesFor(address, mode);
    const discovered = new Map<string, TokenTransfer>();
    const startedAt = now();
    let upper = latest;
    let chunkSize = INITIAL_CHUNK_BLOCKS;
    // Highest chunk size this provider is known to REJECT (range caps):
    // growth after a clean chunk stays below it, so a capped provider does
    // not oscillate fail→halve→succeed→double→fail burning the call budget.
    let providerCeiling = MAX_CHUNK_BLOCKS;
    let calls = 0;
    let covered = false;

    while (!covered) {
      if (calls >= maxScanCalls || now() - startedAt >= scanTimeoutMs) break;
      const lower = upper - BigInt(chunkSize) + 1n > oldest
        ? upper - BigInt(chunkSize) + 1n
        : oldest;
      // Per-iteration snapshots: the getLogs closures below must not
      // capture loop-mutated bindings (eslint no-loop-func), and the call
      // budget is counted before dispatch so in-flight calls are included.
      const fromBlock = lower;
      const toBlock = upper;
      calls += queries.length;
      try {
        const results = await Promise.all(
          queries.map(({ event, args, address: emitter }) =>
            // Participant queries keep the exact pre-token-mode call shape
            // (args, never an address key); token queries filter by the
            // emitter with topic0 only (args explicitly absent for viem).
            emitter !== undefined
              ? client.getLogs({ fromBlock, toBlock, event, address: emitter })
              : client.getLogs({ fromBlock, toBlock, event, args }),
          ),
        );
        queries.forEach(({ key, direction }, i) => {
          for (const log of results[i]) {
            let transfer = decodeTransferLog(key, log, direction);
            if (!transfer) continue;
            if (mode === 'token') {
              // Token mode: the query's 'out' was a placeholder —
              // direction is honest per row. The viewed contract
              // participates in some of its own transfers (self-held
              // balance moves), and is neither sender nor recipient in
              // most (mints, burns, user-to-user). 'out' wins ties,
              // matching participant mode's self-transfer convention.
              const resolved: TokenTransfer['direction']
                = transfer.from === addressLower
                  ? 'out'
                  : transfer.to === addressLower
                    ? 'in'
                    : 'none';
              transfer = { ...transfer, direction: resolved };
            }
            const dedupeKey = `${transfer.txHash}:${transfer.logIndex}`;
            // Self-transfers match both direction queries; the outgoing
            // query is processed first, so keep that occurrence.
            if (direction === 'in' && discovered.has(dedupeKey)) continue;
            discovered.set(dedupeKey, transfer);
          }
        });
      } catch (error) {
        if (!isRetryableChunkError(error)) throw error;
        providerCeiling = chunkSize - 1;
        chunkSize = Math.max(Math.floor(chunkSize / 2), MIN_CHUNK_BLOCKS);
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(
          `Transfer scan chunk for ${address} on chain ${chainId} rejected ` +
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

    const transfers = [...discovered.values()].sort(
      (a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex,
    );
    logger.info(
      `Token transfer scan for ${address} on chain ${chainId} (${mode} mode): ` +
      `window=${effectiveWindow}, getLogs calls=${calls}, ` +
      `found=${transfers.length}, coverage=${covered ? 'complete' : 'partial'}`,
    );
    return { transfers, coverage: covered ? 'complete' : 'partial' };
  };

  const sliceResult = (
    transfers: TokenTransfer[],
    coverage: 'complete' | 'partial',
    windowBlocks: number,
    cursor: number,
    limit: number,
    scannedAt: string,
    mode: TransferScanMode,
  ): TokenTransfersResult => ({
    transfers: transfers.slice(cursor, cursor + limit),
    nextCursor: cursor + limit < transfers.length ? String(cursor + limit) : null,
    coverage,
    windowBlocks,
    scannedAt,
    mode,
  });

  const service = {
    /**
     * On-demand token transfer list for an address, newest first. No
     * DuckDB writes and no token metadata reads — symbol/decimals are the
     * frontend's job. `refresh` bypasses the cache read (a fresh scan even
     * while a not-yet-expired entry exists) and overwrites the entry with
     * the re-scan — the semantic behind the tab's Retry/Refresh. `mode`
     * picks the getLogs filter shape: 'participant' (default, the viewed
     * address as Transfer from/to) or 'token' (the viewed contract as the
     * log emitter — its own transfers). Each mode caches separately.
     */
    getTokenTransfers: async (
      chainId: number,
      address: Address,
      cursor = 0,
      limit = 25,
      windowBlocks?: number,
      refresh = false,
      mode: TransferScanMode = 'participant',
    ): Promise<TokenTransfersResult> => {
      // Explicit windows clamp into [1, MAX]; undefined uses the default.
      const effectiveWindow = windowBlocks === undefined
        ? DEFAULT_WINDOW_BLOCKS
        : Math.min(Math.max(Math.trunc(windowBlocks), MIN_WINDOW_BLOCKS), MAX_WINDOW_BLOCKS);
      const cacheKey = `${chainId}:${address.toLowerCase()}:${effectiveWindow}:${mode}`;

      // Cache-bypass refresh: skip the read entirely (even a fresh
      // 'partial' entry) so an explicit Retry always re-scans.
      const cached = refresh ? null : readTransfersCache(cacheKey);
      if (cached) {
        logger.info(`Serving cached transfer scan for ${address} on chain ${chainId} (${mode} mode)`);
        return sliceResult(cached.transfers, cached.coverage, effectiveWindow, cursor, limit, cached.scannedAt, mode);
      }

      const client = await rpcManager.getClient(chainId);
      const outcome = await withTimeout(
        scanTransfers(client, chainId, address, effectiveWindow, mode),
        scanTimeoutMs + SCAN_TIMEOUT_GRACE_MS,
        'Token transfer scan',
      ).catch((error: unknown) => {
        // A hung provider call is a budget outcome, not a server error:
        // report an honest (empty) partial instead of failing the request.
        if (error instanceof ScanTimeoutError) {
          logger.warn(
            `Token transfer scan for ${address} on chain ${chainId} (${mode} mode) hung; ` +
            `returning empty partial result`,
          );
          return { transfers: [], coverage: 'partial' as const };
        }
        throw error;
      });

      const scannedAt = writeTransfersCache(cacheKey, outcome.transfers, outcome.coverage);
      return sliceResult(outcome.transfers, outcome.coverage, effectiveWindow, cursor, limit, scannedAt, mode);
    },

    /** Drop all cached scan results (test isolation). */
    clearTransfersCache: (): void => {
      transfersCache.clear();
    },
  };

  return service;
};

export type TokenTransferService = ReturnType<typeof createTokenTransferService>;
export { createTokenTransferService };

export const tokenTransferService = createTokenTransferService({
  rpcManager: rpcManager as unknown as TokenTransferServiceDeps['rpcManager'],
});
