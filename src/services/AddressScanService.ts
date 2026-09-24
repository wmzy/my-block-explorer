/**
 * Address deep-scan job engine — persistent, resumable per-address
 * transaction discovery that upgrades address tx coverage from
 * heuristic-partial to (genesis-anchored) provably complete.
 *
 * WALK MODEL (forward, checkpointed):
 * The walk starts at fromBlock with a baseline balance read at the cursor
 * (block fromBlock - 1; before genesis the balance is definitionally 0).
 * Each step reads the balance at a checkpoint `cursor + batch` blocks
 * ahead. Equal boundary balances verify the whole segment as empty and
 * the cursor jumps to the checkpoint. A differing segment is binary-
 * searched for the FIRST balance-change block (the same balance-read
 * primitive the heuristic discovery uses — see getBalanceAt in
 * AddressService), that block is scanned for address transactions
 * (findings are persisted), and the cursor advances onto it. Progress is
 * checkpointed to DuckDB after every segment, so resume continues
 * exactly at the cursor.
 *
 * HONESTY MODEL — assumptions behind coverage 'complete':
 * coverage is DERIVED, never stored: 'complete' only when status is
 * 'complete' AND fromBlock === 0 (the genesis anchor — the only bound
 * where "no activity outside the walk" is provable). Within the walk,
 * "equal balance across a segment ⇒ no address transactions in the
 * segment" holds only under these assumptions, which MUST be stated
 * because the product never claims more than it can prove:
 *
 * 1. Every outgoing EVM transaction strictly debits the sender balance by
 *    its gas fee (gasPrice > 0), and every incoming transfer strictly
 *    credits the recipient. A SINGLE transaction therefore can never net
 *    the balance to exactly zero. A segment whose activity nets to
 *    EXACTLY zero (incoming value == outgoing value + gas across TWO OR
 *    MORE transactions in the same checkpoint segment) still evades
 *    detection — the known blind spot of balance-checkpoint discovery.
 *    The same class of miss exists in the heuristic binary search; the
 *    deep scan narrows it to per-segment net-zero activity but cannot
 *    eliminate it without an archive indexer channel.
 * 2. Balance reads are assumed faithful. Providers that silently fail,
 *    round, or cap eth_getBalance responses (some public RPCs serve
 *    rounded balances for old blocks) break the equality check without
 *    any error surfacing — a read that errors loudly flips the job to
 *    'error' (never silently 'complete'), but a read that LIES cannot be
 *    detected from the protocol alone.
 * 3. Public non-archive RPCs reject old balance reads ("historical state
 *    not available"); such provider errors surface verbatim as job
 *    status 'error'.
 *
 * ARCHITECTURE: mirrors EventIndexingService's range jobs — 202-async
 * start (the route returns the freshly-created row immediately; the loop
 * runs in the background), a serial in-process registry per
 * (chain, address) capped at MAX_CONCURRENT_SCAN_JOBS running addresses
 * (excess jobs queue as 'pending' and are pumped when a slot frees), and
 * startup reconciliation that flips rows stranded in 'running' by a dead
 * process to 'error' with a resume hint.
 */

import { and, eq, sql } from 'drizzle-orm';
import { db } from '../database/drizzle';
import {
  addressScanJobs,
  addressScanFindings,
  type AddressScanJobRecord,
  type AddressScanFindingRecord,
} from '../database/schema';
import { rpcManager } from './RpcManager';
// Reuses the heuristic discovery's own primitives — never a reimplementation.
import {
  getBalanceAt,
  scanBlockForAddressTransactions,
  type DiscoveredTransaction,
} from './AddressService';
import { createLogger } from '../server/logger';
import type { Address, PublicClient } from 'viem';

const logger = createLogger('address-scan-service');

// ============================================
// Pure helpers (bounds, conflict, coverage, checkpoint math, DTO)
// ============================================

export type ScanJobStatus = 'pending' | 'running' | 'paused' | 'error' | 'complete';
export type ScanBoundTag = 'earliest' | 'latest';
export type ScanBoundInput = number | ScanBoundTag;

const SCAN_JOB_STATUSES: readonly ScanJobStatus[] = [
  'pending',
  'running',
  'paused',
  'error',
  'complete',
];

export const isScanJobStatus = (value: string): value is ScanJobStatus =>
  SCAN_JOB_STATUSES.includes(value as ScanJobStatus);

/**
 * Pure validation of the POST /scan body: {fromBlock?: number|'earliest'
 * (default 'earliest'), toBlock?: number|'latest' (default 'latest'),
 * force?: boolean}. Numbers must be non-negative integers; the ONLY
 * accepted tags are 'earliest' and 'latest' (anything else — including
 * the event-range tags 'finalized'/'safe' — is an unknown tag here).
 * Ordering is validated on the tag-equivalent scale (earliest = 0,
 * latest = +∞); the post-resolution check against the concrete chain
 * head happens in resolveScanBounds.
 */
export type ScanBodyValidation =
  | { ok: true; fromBlock: ScanBoundInput; toBlock: ScanBoundInput; force: boolean }
  | { ok: false; message: string };

const boundOrderKey = (bound: ScanBoundInput): number =>
  bound === 'earliest' ? 0 : bound === 'latest' ? Number.POSITIVE_INFINITY : bound;

export const validateScanJobBody = (body: unknown): ScanBodyValidation => {
  body ??= {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object' };
  }
  const raw = body as { fromBlock?: unknown; toBlock?: unknown; force?: unknown };

  const parseBound = (
    value: unknown,
    label: string,
    allowedTags: readonly ScanBoundTag[],
  ): { ok: true; value: ScanBoundInput } | { ok: false; message: string } => {
    if (value === undefined) {
      return { ok: true, value: allowedTags.includes('earliest') ? 'earliest' : 'latest' };
    }
    if (typeof value === 'string') {
      if ((allowedTags as readonly string[]).includes(value)) return { ok: true, value: value as ScanBoundTag };
      return {
        ok: false,
        message: `${label} must be a non-negative integer or one of: ${allowedTags.join(', ')}`,
      };
    }
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
      return { ok: true, value };
    }
    return {
      ok: false,
      message: `${label} must be a non-negative integer or one of: ${allowedTags.join(', ')}`,
    };
  };

  const from = parseBound(raw.fromBlock, 'fromBlock', ['earliest']);
  if (!from.ok) return { ok: false, message: from.message };
  const to = parseBound(raw.toBlock, 'toBlock', ['latest']);
  if (!to.ok) return { ok: false, message: to.message };

  if (typeof raw.force !== 'undefined' && typeof raw.force !== 'boolean') {
    return { ok: false, message: 'force must be a boolean' };
  }

  if (boundOrderKey(from.value) > boundOrderKey(to.value)) {
    return {
      ok: false,
      message: `fromBlock (${String(from.value)}) must not be after toBlock (${String(to.value)})`,
    };
  }

  return { ok: true, fromBlock: from.value, toBlock: to.value, force: raw.force === true };
};

/**
 * Resolve tag bounds ONCE at creation to concrete block numbers — stored
 * rows never carry tags (same rule as event ranges). 'latest' resolves to
 * the current chain head; the concrete from > to case (a numeric from
 * beyond the resolved head) is rejected here.
 */
export const resolveScanBounds = async (
  client: PublicClient,
  input: { fromBlock: ScanBoundInput; toBlock: ScanBoundInput },
): Promise<{ ok: true; fromBlock: number; toBlock: number } | { ok: false; message: string }> => {
  const from = input.fromBlock === 'earliest' ? 0n : BigInt(input.fromBlock);
  const to = input.toBlock === 'latest' ? await client.getBlockNumber() : BigInt(input.toBlock);
  if (from > to) {
    return {
      ok: false,
      message: `fromBlock (${from}) must not be after toBlock (${to})`,
    };
  }
  return { ok: true, fromBlock: Number(from), toBlock: Number(to) };
};

/**
 * Pure conflict/force semantics for POST /scan against the existing row:
 * - no row → create
 * - same resolved bounds, no force → idempotent (200)
 * - different bounds, no force → conflict (400 scan_conflict)
 * - force (same or different bounds) → replace: bounds are overwritten
 *   and progress resets
 */
export type ScanJobDecision =
  | { action: 'create' }
  | { action: 'idempotent' }
  | { action: 'replace' }
  | { action: 'conflict'; message: string };

export const decideScanJobCreation = (
  existing: { fromBlock: number; toBlock: number } | null,
  requested: { fromBlock: number; toBlock: number },
  force: boolean,
): ScanJobDecision => {
  if (!existing) return { action: 'create' };
  const sameBounds =
    existing.fromBlock === requested.fromBlock && existing.toBlock === requested.toBlock;
  if (sameBounds && !force) return { action: 'idempotent' };
  if (!force) {
    return {
      action: 'conflict',
      message:
        `A scan job already exists with bounds [${existing.fromBlock}..${existing.toBlock}] ` +
        `(requested [${requested.fromBlock}..${requested.toBlock}]); ` +
        'pass force: true to replace the bounds and reset progress',
    };
  }
  return { action: 'replace' };
};

// Checkpoint math for the FORWARD walk: cursorBlock is the highest
// CONTIGUOUS verified block starting at fromBlock. Before any progress it
// sits at fromBlock - 1 (block -1 for a genesis-anchored walk — no
// on-chain state exists there, balance definitionally 0).
export const initialCursorBlock = (fromBlock: number): number => fromBlock - 1;

export const computeBlocksWalked = (fromBlock: number, cursorBlock: number): number =>
  Math.max(0, cursorBlock - fromBlock + 1);

export const computeBlocksTotal = (fromBlock: number, toBlock: number): number =>
  toBlock - fromBlock + 1;

/**
 * Coverage derivation — the ONLY path to 'complete': the walk finished
 * AND was anchored at genesis (fromBlock === 0), the one bound where "no
 * activity outside the walk" is provable. Everything else stays null.
 */
export const deriveScanCoverage = (
  status: ScanJobStatus,
  fromBlock: number,
): 'complete' | null => (status === 'complete' && fromBlock === 0 ? 'complete' : null);

/**
 * The API job shape (pinned contract). Numeric block fields are plain
 * numbers; updatedAt is ISO-8601 UTC.
 */
export type ScanJobDto = {
  status: ScanJobStatus;
  fromBlock: number;
  toBlock: number;
  cursorBlock: number;
  blocksWalked: number;
  blocksTotal: number;
  txsFound: number;
  errorMessage: string | null;
  coverage: 'complete' | null;
  updatedAt: string;
};

export const toScanJobDto = (row: AddressScanJobRecord): ScanJobDto => {
  const fromBlock = Number(row.fromBlock);
  const toBlock = Number(row.toBlock);
  const cursorBlock = Number(row.cursorBlock);
  const status: ScanJobStatus = isScanJobStatus(row.status) ? row.status : 'error';
  return {
    status,
    fromBlock,
    toBlock,
    cursorBlock,
    blocksWalked: computeBlocksWalked(fromBlock, cursorBlock),
    blocksTotal: computeBlocksTotal(fromBlock, toBlock),
    txsFound: row.txsFound ?? 0,
    errorMessage: row.errorMessage ?? null,
    coverage: deriveScanCoverage(status, fromBlock),
    updatedAt: (row.updatedAt instanceof Date
      ? row.updatedAt
      : new Date(String(row.updatedAt))
    ).toISOString(),
  };
};

// ============================================
// Registry: serial job per (chain, address), capped globally
// ============================================

// At most 2 addresses walk concurrently: each running loop holds one
// long-lived RPC client session and can burst balance reads.
const MAX_CONCURRENT_SCAN_JOBS = 2;

type ScanJobHandle = { abort: boolean; done: Promise<void> };
type QueuedScan = { chainId: number; address: string };

const runningScanJobs = new Map<string, ScanJobHandle>();
const scanQueue: QueuedScan[] = [];

const scanJobKey = (chainId: number, address: string): string =>
  `${chainId}:${address.toLowerCase()}`;

export const isScanJobActive = (chainId: number, address: string): boolean =>
  runningScanJobs.has(scanJobKey(chainId, address));

export const runningScanJobCount = (): number => runningScanJobs.size;

const removeFromScanQueue = (chainId: number, address: string): void => {
  const key = scanJobKey(chainId, address);
  for (let i = scanQueue.length - 1; i >= 0; i--) {
    if (scanJobKey(scanQueue[i].chainId, scanQueue[i].address) === key) scanQueue.splice(i, 1);
  }
};

// Drains the queue as slots free. Entries whose key is already running
// (a live loop for that address exists) are dropped — a later
// ensureScanRunning re-queues if that address still needs a start.
const pumpScanQueue = (): void => {
  while (runningScanJobs.size < MAX_CONCURRENT_SCAN_JOBS && scanQueue.length > 0) {
    const next = scanQueue.shift();
    if (!next) break;
    if (isScanJobActive(next.chainId, next.address)) continue;
    const handle = startScanLoop(next.chainId, next.address);
    handle.done.catch(err =>
      logger.error({ err, chainId: next.chainId, address: next.address }, 'Address scan loop crashed'),
    );
  }
};

/**
 * Fire-and-forget "make sure this address's scan is walking": starts the
 * loop immediately when a slot is free, otherwise (at capacity, or a
 * previous loop for the same address is still draining after
 * force-replace/delete+recreate) queues a start that pumps when a slot
 * frees.
 */
export const ensureScanRunning = (chainId: number, address: string): void => {
  if (isScanJobActive(chainId, address) || runningScanJobs.size >= MAX_CONCURRENT_SCAN_JOBS) {
    const key = scanJobKey(chainId, address);
    if (!scanQueue.some(q => scanJobKey(q.chainId, q.address) === key)) {
      scanQueue.push({ chainId, address });
    }
    return;
  }
  const handle = startScanLoop(chainId, address);
  handle.done.catch(err =>
    logger.error({ err, chainId, address }, 'Address scan loop crashed'),
  );
};

// ============================================
// DB row helpers
// ============================================

export const getScanJobRow = async (
  chainId: number,
  address: string,
): Promise<AddressScanJobRecord | null> => {
  const rows = await db
    .select()
    .from(addressScanJobs)
    .where(
      and(
        eq(addressScanJobs.chainId, chainId),
        eq(addressScanJobs.address, address.toLowerCase()),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
};

export const getScanFindings = async (
  chainId: number,
  address: string,
): Promise<AddressScanFindingRecord[]> =>
  db
    .select()
    .from(addressScanFindings)
    .where(
      and(
        eq(addressScanFindings.chainId, chainId),
        eq(addressScanFindings.address, address.toLowerCase()),
      ),
    );

type ScanJobUpdate = Partial<{
  cursorBlock: bigint;
  txsFound: number;
  status: ScanJobStatus;
  errorMessage: string | null;
}>;

// Loop writes are compare-and-set on status = 'running' whenever the loop
// must not clobber a row a concurrent pause/force-replace/delete already
// moved out of 'running' (a stale draining loop then no-ops instead of
// writing its cursor into a replacement job row).
const updateScanJobRow = async (
  chainId: number,
  address: string,
  updates: ScanJobUpdate,
  options?: { onlyIfRunning?: boolean },
): Promise<void> => {
  const conditions = [
    eq(addressScanJobs.chainId, chainId),
    eq(addressScanJobs.address, address.toLowerCase()),
  ];
  if (options?.onlyIfRunning) conditions.push(eq(addressScanJobs.status, 'running'));
  await db
    .update(addressScanJobs)
    .set({ ...updates, updatedAt: new Date() })
    .where(and(...conditions));
};

const countFindings = async (chainId: number, address: string): Promise<number> => {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(addressScanFindings)
    .where(
      and(
        eq(addressScanFindings.chainId, chainId),
        eq(addressScanFindings.address, address.toLowerCase()),
      ),
    );
  return Number(rows[0]?.count ?? 0);
};

const persistFindings = async (
  chainId: number,
  address: string,
  txs: readonly DiscoveredTransaction[],
): Promise<void> => {
  if (txs.length === 0) return;
  const rows = txs.map(tx => ({
    chainId,
    address: address.toLowerCase(),
    txHash: tx.hash.toLowerCase() as `0x${string}`,
    blockNumber: tx.blockNumber,
  }));
  await db
    .insert(addressScanFindings)
    .values(rows)
    .onConflictDoNothing({
      target: [
        addressScanFindings.chainId,
        addressScanFindings.address,
        addressScanFindings.txHash,
      ],
    });
};

// ============================================
// Findings hydration (read path)
// ============================================

// Transaction envelopes are immutable, so a hydrated finding serves
// forever — the LRU only bounds memory. The walk pre-populates this cache
// as it scans change blocks; read-time misses fill via RPC once.
const hydratedTransactions = new Map<string, DiscoveredTransaction>();
const HYDRATED_CACHE_MAX = 1000;

export const rememberHydratedTransactions = (txs: readonly DiscoveredTransaction[]): void => {
  for (const tx of txs) {
    const key = tx.hash.toLowerCase();
    hydratedTransactions.delete(key);
    hydratedTransactions.set(key, tx);
  }
  while (hydratedTransactions.size > HYDRATED_CACHE_MAX) {
    const oldest = hydratedTransactions.keys().next().value;
    if (oldest === undefined) break;
    hydratedTransactions.delete(oldest);
  }
};

export const clearHydratedTransactionCache = (): void => {
  hydratedTransactions.clear();
};

/**
 * Hydrate persisted finding rows (hash + block number only, per the
 * pinned storage contract) into full DiscoveredTransaction envelopes via
 * immutable RPC data, serving from the LRU where possible. Throws on
 * provider failure — callers degrade gracefully rather than serve
 * fabricated fields.
 */
export const hydrateFindings = async (
  chainId: number,
  address: string,
  findings: readonly AddressScanFindingRecord[],
): Promise<DiscoveredTransaction[]> => {
  if (findings.length === 0) return [];
  const client = await rpcManager.getClient(chainId);
  const out: DiscoveredTransaction[] = [];
  for (const finding of findings) {
    const key = finding.txHash.toLowerCase();
    const cached = hydratedTransactions.get(key);
    if (cached) {
      out.push(cached);
      continue;
    }
    const tx = await client.getTransaction({ hash: key as `0x${string}` });
    const block = await client.getBlock({ blockNumber: tx.blockNumber });
    const hydrated: DiscoveredTransaction = {
      hash: tx.hash,
      blockNumber: tx.blockNumber ?? BigInt(finding.blockNumber),
      fromAddress: tx.from,
      toAddress: tx.to ?? '',
      value: tx.value.toString(),
      timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
    };
    rememberHydratedTransactions([hydrated]);
    out.push(hydrated);
  }
  logger.debug(
    { chainId, address, findings: findings.length, cacheMisses: out.length },
    'Hydrated deep-scan findings',
  );
  return out;
};

// ============================================
// Provider error classification (chunk-ladder lesson)
// ============================================

// Archive-depth errors are permanent for the requested block: shrinking
// the checkpoint batch cannot help, so the job fails immediately with the
// verbatim provider message (never silently 'complete').
const PERMANENT_PROVIDER_ERROR_RE =
  /historical state|missing trie|pruned|archive node|header not found/i;
// Range/throttle-style errors plausibly yield to a smaller checkpoint
// stride (the transfers chunk-ladder/providerCeiling lesson): halve the
// batch and retry the same segment.
const SHRINKABLE_PROVIDER_ERROR_RE =
  /rate.?limit|too many requests|429|exceed|limit|timeout|timed out|econnreset|econnrefused|socket hang up|network|fetch failed/i;

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const isPermanentProviderError = (err: unknown): boolean =>
  PERMANENT_PROVIDER_ERROR_RE.test(errorMessage(err));

const isShrinkableProviderError = (err: unknown): boolean =>
  SHRINKABLE_PROVIDER_ERROR_RE.test(errorMessage(err));

// ============================================
// The walk loop
// ============================================

const INITIAL_CHECKPOINT_BATCH_BLOCKS = 50_000n;
const MIN_CHECKPOINT_BATCH_BLOCKS = 1n;
// Below the linear-scan threshold the first-change search reads balance
// per block (same granularity as the heuristic's SCAN_THRESHOLD).
const LINEAR_SCAN_THRESHOLD_BLOCKS = 64n;
const TRANSIENT_RETRY_DELAY_MS = 150;
// At the minimum batch stride a shrink can no longer help; bounded
// retries absorb a transient hiccup before the job honestly errors.
const MAX_TRANSIENT_RETRIES_AT_MIN_BATCH = 2;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

type FirstBalanceChange = { block: bigint; balance: bigint };

/**
 * First block in (lo, hi] whose balance differs from balance(lo), given
 * the caller verified balance(lo) === loBalance !== balance(hi). Built on
 * the same balance-read primitive as the heuristic discovery
 * (getBalanceAt) — this is the walk-specific first-change variant of
 * AddressService's binarySearchBalanceChanges (which instead enumerates
 * all changes in a range). Narrow ranges fall back to a linear scan.
 */
const findFirstBalanceChange = async (
  client: PublicClient,
  address: Address,
  lo: bigint,
  loBalance: bigint,
  hi: bigint,
): Promise<FirstBalanceChange> => {
  while (hi - lo > LINEAR_SCAN_THRESHOLD_BLOCKS) {
    const mid = (lo + hi) / 2n;
    const midBalance = await getBalanceAt(client, address, mid);
    if (midBalance === loBalance) lo = mid;
    else hi = mid;
  }
  for (let b = lo + 1n; b < hi; b++) {
    const balance = await getBalanceAt(client, address, b);
    if (balance !== loBalance) return { block: b, balance };
  }
  return { block: hi, balance: await getBalanceAt(client, address, hi) };
};

const startScanLoop = (chainId: number, address: string): ScanJobHandle => {
  const key = scanJobKey(chainId, address);
  const existing = runningScanJobs.get(key);
  if (existing) return existing;

  const handle: ScanJobHandle = { abort: false, done: Promise.resolve() };
  // Register synchronously: two racing starts must not both run the walk.
  runningScanJobs.set(key, handle);
  handle.done = runScanWalk(chainId, address, handle)
    .catch(err => {
      logger.error({ err, chainId, address }, 'Address scan walk failed');
    })
    .finally(() => {
      runningScanJobs.delete(key);
      pumpScanQueue();
    });
  return handle;
};

const runScanWalk = async (
  chainId: number,
  address: string,
  handle: ScanJobHandle,
): Promise<void> => {
  const addr = address.toLowerCase() as Address;

  const row = await getScanJobRow(chainId, address);
  // Deleted before the loop started, or already complete.
  if (!row || row.status === 'complete') return;
  // Only deliberate start paths enqueue loops (create/restart/resume);
  // anything else means the row moved on — do not touch it.
  if (row.status !== 'pending' && row.status !== 'paused' && row.status !== 'error') return;

  const snapshot = {
    fromBlock: row.fromBlock,
    toBlock: row.toBlock,
    cursorBlock: row.cursorBlock,
  };

  // Compare-and-set the running flip on the status this loop observed; a
  // row replaced underneath (force-recreate between read and write) keeps
  // its own lifecycle and is verified by the bounds re-read below.
  const where = and(
    eq(addressScanJobs.chainId, chainId),
    eq(addressScanJobs.address, addr),
    eq(addressScanJobs.status, row.status),
  );
  await db
    .update(addressScanJobs)
    .set({ status: 'running', errorMessage: null, updatedAt: new Date() })
    .where(where);

  const afterFlip = await getScanJobRow(chainId, address);
  if (
    afterFlip?.status !== 'running' ||
    afterFlip.fromBlock !== snapshot.fromBlock ||
    afterFlip.toBlock !== snapshot.toBlock
  ) {
    // A force-replace/delete raced the flip: leave the replacement row's
    // lifecycle to its own queued start.
    return;
  }

  const client = await rpcManager.getClient(chainId);

  let cursor = snapshot.cursorBlock;
  const to = snapshot.toBlock;
  let batch = INITIAL_CHECKPOINT_BATCH_BLOCKS;
  let transientRetries = 0;

  // Baseline balance at the cursor. Block -1 (the initial cursor of a
  // genesis-anchored walk) has no on-chain state: balance 0 by definition.
  let baseline =
    cursor < 0n ? 0n : await getBalanceAt(client, addr, cursor);

  const failJob = async (err: unknown): Promise<void> => {
    const message = errorMessage(err);
    logger.error({ err, chainId, address, message }, 'Address scan job errored');
    await updateScanJobRow(chainId, address, { status: 'error', errorMessage: message }, {
      onlyIfRunning: true,
    });
  };

  while (cursor < to && !handle.abort) {
    const segmentEnd = cursor + batch > to ? to : cursor + batch;
    try {
      const endBalance = await getBalanceAt(client, addr, segmentEnd);

      if (endBalance === baseline) {
        // Equal boundary balances: the segment is verified empty, the
        // cursor jumps to the checkpoint (assumptions 1-2 in the module
        // doc — net-zero segment activity evades this check).
        cursor = segmentEnd;
        transientRetries = 0;
        await updateScanJobRow(chainId, address, { cursorBlock: cursor }, { onlyIfRunning: true });
        continue;
      }

      const first = await findFirstBalanceChange(client, addr, cursor, baseline, segmentEnd);
      const block = await client.getBlock({
        blockNumber: first.block,
        includeTransactions: true,
      });
      const txs = block ? scanBlockForAddressTransactions(block, addr) : [];
      if (txs.length > 0) {
        rememberHydratedTransactions(txs);
        await persistFindings(chainId, address, txs);
      }
      cursor = first.block;
      baseline = first.balance;
      transientRetries = 0;
      await updateScanJobRow(
        chainId,
        address,
        { cursorBlock: cursor, ...(txs.length > 0 ? { txsFound: await countFindings(chainId, address) } : {}) },
        { onlyIfRunning: true },
      );
    } catch (err) {
      if (isPermanentProviderError(err)) {
        await failJob(err);
        return;
      }
      if (batch > MIN_CHECKPOINT_BATCH_BLOCKS) {
        // Provider range/throttle errors shrink the checkpoint stride and
        // retry the same segment (chunk-ladder lesson).
        if (isShrinkableProviderError(err)) {
          batch = batch / 2n;
          continue;
        }
        await failJob(err);
        return;
      }
      if (isShrinkableProviderError(err) && transientRetries < MAX_TRANSIENT_RETRIES_AT_MIN_BATCH) {
        transientRetries += 1;
        await sleep(TRANSIENT_RETRY_DELAY_MS * transientRetries);
        continue;
      }
      await failJob(err);
      return;
    }
  }

  if (handle.abort) {
    // Only this loop writes 'paused', and only from 'running' — a
    // concurrently replaced/deleted row keeps its own status.
    await updateScanJobRow(chainId, address, { status: 'paused' }, { onlyIfRunning: true });
    return;
  }

  // cursor === to: the whole [fromBlock..toBlock] range is verified.
  const txsFound = await countFindings(chainId, address);
  await updateScanJobRow(
    chainId,
    address,
    { status: 'complete', cursorBlock: to, txsFound, errorMessage: null },
    { onlyIfRunning: true },
  );
  logger.info(
    { chainId, address, from: snapshot.fromBlock, to, txsFound },
    'Address scan complete',
  );
};

// ============================================
// Job lifecycle operations (route surface)
// ============================================

export type CreateScanJobResult =
  | { outcome: 'created'; job: AddressScanJobRecord; started: Promise<void> | null }
  | { outcome: 'idempotent'; job: AddressScanJobRecord; started: Promise<void> | null }
  | { outcome: 'conflict'; message: string };

/**
 * POST /scan semantics: resolve tag bounds ONCE against the chain, then
 * create / return-idempotent / conflict / force-replace. `started` is the
 * background walk's completion promise when this call started (or
 * restarted) a loop, null when the job queued or no loop was needed —
 * routes ignore it, tests await it for deterministic runs.
 */
export const createOrReplaceScanJob = async (
  chainId: number,
  address: string,
  input: { fromBlock: ScanBoundInput; toBlock: ScanBoundInput; force: boolean },
): Promise<
  { ok: true; result: CreateScanJobResult } | { ok: false; error: 'invalid_bounds'; message: string }
> => {
  const client = await rpcManager.getClient(chainId);
  const resolved = await resolveScanBounds(client, input);
  if (!resolved.ok) return { ok: false, error: 'invalid_bounds', message: resolved.message };
  const { fromBlock, toBlock } = resolved;

  const existing = await getScanJobRow(chainId, address);
  const decision = decideScanJobCreation(
    existing
      ? { fromBlock: Number(existing.fromBlock), toBlock: Number(existing.toBlock) }
      : null,
    { fromBlock, toBlock },
    input.force,
  );

  if (decision.action === 'conflict') {
    return { ok: true, result: { outcome: 'conflict', message: decision.message } };
  }

  if (decision.action === 'idempotent' && existing) {
    // POST = "ensure this scan is running with these bounds": an errored
    // or never-started job restarts from its checkpoint (the recovery
    // path after provider errors and after restart reconciliation). A
    // paused job is left alone — that is what /resume is for.
    if (
      (existing.status === 'pending' || existing.status === 'error') &&
      !isScanJobActive(chainId, address)
    ) {
      ensureScanRunning(chainId, address);
      const handle = runningScanJobs.get(scanJobKey(chainId, address));
      return {
        ok: true,
        result: { outcome: 'idempotent', job: existing, started: handle?.done ?? null },
      };
    }
    return { ok: true, result: { outcome: 'idempotent', job: existing, started: null } };
  }

  // create or force-replace: bounds are (re)written and progress resets.
  if (decision.action === 'replace') {
    // Stop any live loop walking the old bounds; its remaining writes are
    // compare-and-set on 'running' and the replacement row is 'pending',
    // so the draining loop cannot clobber it.
    const handle = runningScanJobs.get(scanJobKey(chainId, address));
    if (handle) handle.abort = true;
    removeFromScanQueue(chainId, address);
    await db
      .delete(addressScanFindings)
      .where(
        and(
          eq(addressScanFindings.chainId, chainId),
          eq(addressScanFindings.address, address.toLowerCase()),
        ),
      );
  }

  const values = {
    chainId,
    address: address.toLowerCase(),
    fromBlock: BigInt(fromBlock),
    toBlock: BigInt(toBlock),
    cursorBlock: BigInt(initialCursorBlock(fromBlock)),
    status: 'pending',
    txsFound: 0,
    errorMessage: null,
    updatedAt: new Date(),
  };
  await db
    .insert(addressScanJobs)
    .values(values)
    .onConflictDoUpdate({
      target: [addressScanJobs.chainId, addressScanJobs.address],
      set: {
        fromBlock: values.fromBlock,
        toBlock: values.toBlock,
        cursorBlock: values.cursorBlock,
        status: values.status,
        txsFound: values.txsFound,
        errorMessage: values.errorMessage,
        updatedAt: values.updatedAt,
      },
    });

  const job = await getScanJobRow(chainId, address);
  if (!job) return { ok: false, error: 'invalid_bounds', message: 'Failed to persist scan job' };

  // 202-async start: the route returns this row immediately; the loop
  // walks in the background (queued behind the cap if needed).
  ensureScanRunning(chainId, address);
  const handle = runningScanJobs.get(scanJobKey(chainId, address));
  return { ok: true, result: { outcome: 'created', job, started: handle?.done ?? null } };
};

/**
 * Pause: flags the live loop; the loop itself writes 'paused' (with the
 * last checkpointed cursor) as soon as the current segment settles.
 * Returns false when no live loop exists for the address.
 */
export const pauseScanJob = (chainId: number, address: string): boolean => {
  const key = scanJobKey(chainId, address);
  // A queued follow-up start must not resurrect the job after the pause.
  removeFromScanQueue(chainId, address);
  const handle = runningScanJobs.get(key);
  if (!handle) return false;
  handle.abort = true;
  return true;
};

export type ResumeScanJobResult =
  | { ok: true; job: AddressScanJobRecord; started: Promise<void> | null }
  | { ok: false; message: string };

/**
 * Resume a paused job from its checkpointed cursor. Only 'paused' rows
 * resume — errored jobs recover by re-POSTing the same bounds (keeps the
 * pinned 400-on-not-paused contract), complete/pending/running rows are
 * state errors.
 */
export const resumeScanJob = async (
  chainId: number,
  address: string,
): Promise<ResumeScanJobResult> => {
  const row = await getScanJobRow(chainId, address);
  if (!row) return { ok: false, message: 'No scan job exists for this address' };
  if (row.status !== 'paused') {
    return { ok: false, message: `Scan job is not paused (status: ${row.status})` };
  }
  if (isScanJobActive(chainId, address)) {
    return { ok: false, message: 'A scan loop is already active for this address' };
  }
  await updateScanJobRow(chainId, address, { status: 'pending', errorMessage: null });
  const updated = await getScanJobRow(chainId, address);
  if (!updated) return { ok: false, message: 'Scan job disappeared during resume' };
  ensureScanRunning(chainId, address);
  const handle = runningScanJobs.get(scanJobKey(chainId, address));
  return { ok: true, job: updated, started: handle?.done ?? null };
};

/**
 * DELETE: idempotent. Stops any live loop, removes queued starts, then
 * deletes the job row AND its findings rows.
 */
export const deleteScanJob = async (chainId: number, address: string): Promise<void> => {
  const key = scanJobKey(chainId, address);
  removeFromScanQueue(chainId, address);
  const handle = runningScanJobs.get(key);
  if (handle) handle.abort = true;
  await db
    .delete(addressScanFindings)
    .where(
      and(
        eq(addressScanFindings.chainId, chainId),
        eq(addressScanFindings.address, address.toLowerCase()),
      ),
    );
  await db
    .delete(addressScanJobs)
    .where(
      and(
        eq(addressScanJobs.chainId, chainId),
        eq(addressScanJobs.address, address.toLowerCase()),
      ),
    );
};

/**
 * Rows stranded in 'running' by a dead process can never recover on
 * their own (the in-memory loop died with the process; resume only
 * accepts 'paused'). Flip them to 'error' with a resume hint, mirroring
 * EventIndexingService.reconcileInterruptedRanges. Idempotent by
 * construction. Startup wiring lives in api-app.ts.
 */
export const reconcileInterruptedAddressScans = async (): Promise<void> => {
  await db
    .update(addressScanJobs)
    .set({
      status: 'error',
      errorMessage: 'Interrupted by server restart — resume to continue',
      updatedAt: new Date(),
    })
    .where(eq(addressScanJobs.status, 'running'));
};
