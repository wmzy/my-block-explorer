// Server-side watch subscriptions — the backend twin of the browser
// watchlist (util/watchlist.ts). Where the browser panel can only match
// blocks against the stream while its page is open, this service tails
// every subscribed address on-chain from the LOCAL backend process: one
// tick every 4s reads the chain head through the shared RpcManager client
// and, per subscription, one ranged getLogs(address, from..head) since
// that row's cursor. New logs become feed events (ring buffer + push to
// SSE subscribers — routes/watch.ts and the `watch` frames on the block
// stream, routes/stream.ts).
//
// Honesty rules encoded:
// - Watching starts at subscribe time, never history: a fresh row's
//   cursor is baselined at the then-current head on its first tick.
// - GAP CAP: after a backend restart or an RPC outage the head may be
//   far ahead of the cursor. The sweep is a live tail, not an archive
//   walk — only the newest WATCH_GAP_BLOCK_CAP blocks are scanned and one
//   synthetic `gap` marker reports the unchecked range ("monitoring
//   lagged; blocks A–B unchecked") instead of silently pretending
//   completeness.
// - At-least-once delivery: events are published BEFORE the cursor moves,
//   so a failed cursor write replays the same range next tick. The feed
//   and the browser-notification layer dedupe by (chain, txHash,
//   logIndex); a duplicate in the ring buffer is honest about that.
// - A chain without a working RPC client is skipped at tick time (logged
//   once per outage, not every 4s) and refuses new subscriptions with an
//   explicit 400 naming the missing RPC config.
// - No tick failure ever crashes the interval: errors are logged and the
//   tick is skipped; a failed sweep leaves its cursor in place so the
//   next tick retries the same range.
import { and, eq } from 'drizzle-orm';
import type { Log } from 'viem';
// Relative imports on purpose: this module rides the api-app import
// graph (also bundled into vite.config.ts's dev bridge via esbuild, which
// does not resolve the '@/' alias for runtime imports).
import { db, watchSubscriptions, type WatchSubscriptionRecord } from '../database/init';
import { rpcManager } from './RpcManager';
import { getDefaultRpcUrl } from '../config/chains';
import { createLogger } from '../server/logger';

const logger = createLogger('watch-service');

// Tick cadence: one head read per chain-with-subscriptions plus one
// ranged getLogs per subscription whose cursor is behind the head.
export const WATCH_TICK_INTERVAL_MS = 4_000;

// GAP CAP: a sweep never walks more than this many blocks behind the
// head; older blocks are reported as a gap marker instead.
export const WATCH_GAP_BLOCK_CAP = 200;

// Ring buffer size per chain: the GET /watch/events endpoint serves the
// newest of these, newest-first.
export const WATCH_RING_CAPACITY = 100;

// Per-chain subscription cap — mirrors the browser watchlist's
// WATCHLIST_MAX_ENTRIES (util/watchlist.ts) so both halves of the feature
// promise the same budget.
export const WATCH_MAX_SUBSCRIPTIONS_PER_CHAIN = 25;

// Concurrent getLogs calls per tick: bounds the burst a fully-subscribed
// chain can produce every 4 seconds against rate-limited public RPCs.
export const WATCH_GETLOGS_CONCURRENCY = 5;

// Default/cap for GET /chains/:chainId/watch/events?limit=.
export const WATCH_EVENTS_DEFAULT_LIMIT = 25;
export const WATCH_EVENTS_MAX_LIMIT = 100;

// One feed event — the wire shape shared by the ring buffer (GET
// /watch/events), the SSE `watch` frames (routes/stream.ts) and the
// browser-side parser (services/liveChain.ts). Keep all three in sync.
// Bigints travel as decimal strings (the repo-wide SSE/payload
// convention — see BlockStreamPayload).
export type WatchFeedEvent = {
  /** 'log' = an actual on-chain log; 'gap' = synthetic unchecked-range marker. */
  kind: 'log' | 'gap';
  chainId: number;
  /** The watched address (= the log's emitter; getLogs filters by it). Lowercase. */
  address: string;
  /** Decimal string. For gap markers: the top of the unchecked range. */
  blockNumber: string;
  txHash: string | null;
  logIndex: number | null;
  topic0: string | null;
  /** Gap-marker copy; null on log events. */
  message: string | null;
  /** Server clock when the event was produced (ISO string). */
  at: string;
};

// What one subscription does this tick.
export type WatchScanPlan =
  // Head already covered (cursor === head): nothing to do, nothing to
  // persist.
  | { action: 'none' }
  // Cursor unset (fresh subscription — baseline at the current head,
  // watching starts NOW) or head moved backwards (reorg shrank the
  // chain): move the cursor to head without scanning. Baseline rows emit
  // nothing; a reorg resync follows the new branch, mirroring the block
  // stream's baseline rule.
  | { action: 'baseline'; head: bigint }
  // Scan from..to inclusive. When the head-cursor gap exceeded the cap,
  // skippedFrom/skippedTo bound the unchecked older range (else null).
  | {
    action: 'scan';
    from: bigint;
    to: bigint;
    skippedFrom: bigint | null;
    skippedTo: bigint | null;
  };

/**
 * Pure scan planner for one subscription. Gap <= cap → the full missed
 * range; gap > cap → only the newest cap blocks plus the skipped-range
 * bounds for the gap marker. A null cursor and a backwards head both
 * baseline (no scan) — see WatchScanPlan.
 */
export function planSubscriptionScan(
  lastProcessed: bigint | null,
  head: bigint,
  gapCap: bigint | number = WATCH_GAP_BLOCK_CAP,
): WatchScanPlan {
  const cap = BigInt(gapCap);
  if (lastProcessed === null) return { action: 'baseline', head };
  if (head === lastProcessed) return { action: 'none' };
  if (head < lastProcessed) return { action: 'baseline', head };

  const gap = head - lastProcessed;
  if (gap <= cap) {
    return {
      action: 'scan',
      from: lastProcessed + 1n,
      to: head,
      skippedFrom: null,
      skippedTo: null,
    };
  }
  return {
    action: 'scan',
    from: head - cap + 1n,
    to: head,
    skippedFrom: lastProcessed + 1n,
    skippedTo: head - cap,
  };
}

/**
 * Pure log → feed-event shaper. Bigints become decimal strings; missing
 * ids (pending-log race) degrade to null rather than fabricating values.
 */
export function shapeLogEvent(
  chainId: number,
  watchedAddress: string,
  log: Log,
  at: Date = new Date(),
): WatchFeedEvent {
  return {
    kind: 'log',
    chainId,
    address: watchedAddress.toLowerCase(),
    blockNumber: (log.blockNumber ?? 0n).toString(),
    txHash: log.transactionHash ?? null,
    logIndex: log.logIndex ?? null,
    topic0: log.topics[0] ?? null,
    message: null,
    at: at.toISOString(),
  };
}

/**
 * Pure gap marker: the honest "these blocks were never checked" event
 * emitted when a sweep is capped. blockNumber carries the top of the
 * skipped range so the feed sorts it next to the blocks that WERE
 * checked.
 */
export function gapMarkerEvent(
  chainId: number,
  watchedAddress: string,
  skippedFrom: bigint,
  skippedTo: bigint,
  at: Date = new Date(),
): WatchFeedEvent {
  return {
    kind: 'gap',
    chainId,
    address: watchedAddress.toLowerCase(),
    blockNumber: skippedTo.toString(),
    txHash: null,
    logIndex: null,
    topic0: null,
    message: `monitoring lagged; blocks ${skippedFrom.toString()}–${skippedTo.toString()} unchecked`,
    at: at.toISOString(),
  };
}

/**
 * Per-chain ring buffer of the newest feed events, newest-first. Pure
 * data structure (no timers, no IO) so its contract is directly testable.
 */
export class WatchEventRing {
  private readonly events: WatchFeedEvent[] = [];

  constructor(public readonly capacity: number) {}

  /** Prepend one event, evicting past-capacity entries from the tail. */
  push(event: WatchFeedEvent): void {
    this.events.unshift(event);
    if (this.events.length > this.capacity) {
      this.events.length = this.capacity;
    }
  }

  /** The newest `limit` events, newest-first (a copy — callers own it). */
  newestFirst(limit: number): WatchFeedEvent[] {
    return this.events.slice(0, Math.max(0, limit));
  }

  get size(): number {
    return this.events.length;
  }
}

// API row shape for a subscription (routes/watch.ts GET/PUT). Dates and
// bigints become strings on the wire; nulls stay null — a cursor that has
// not baselined yet is honest about watching-not-started.
export type WatchSubscriptionView = {
  chainId: number;
  address: string;
  label: string | null;
  lastProcessedBlock: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Pure row → view shaper (decimal-string block cursor, ISO dates). */
export function toSubscriptionView(row: WatchSubscriptionRecord): WatchSubscriptionView {
  return {
    chainId: row.chainId,
    address: row.address.toLowerCase(),
    label: row.label ?? null,
    lastProcessedBlock:
      row.lastProcessedBlock !== null && row.lastProcessedBlock !== undefined
        ? row.lastProcessedBlock.toString()
        : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : null,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : null,
  };
}

// Upsert outcome: the view on success, or one of the two honest 400s the
// route maps (no working RPC for the chain / per-chain cap reached).
export type WatchUpsertResult =
  | { ok: true; subscription: WatchSubscriptionView }
  | { ok: false; error: 'rpc_unavailable' | 'watch_full'; message: string };

export class WatchService {
  private rings = new Map<number, WatchEventRing>();
  private listeners = new Map<number, Set<(event: WatchFeedEvent) => void>>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  // Chains currently in the "no working RPC client" skip state — used to
  // log the outage once per episode instead of every 4s tick.
  private rpcMissingChains = new Set<number>();

  /** Start the tick interval (idempotent; the interval never keeps the process alive). */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, WATCH_TICK_INTERVAL_MS);
    // Allow the process to exit even if this timer is still running
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /** Stop the tick interval (tests / shutdown). */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.timer !== null;
  }

  /**
   * Push-subscribe to this chain's feed events (the SSE route's per-
   * connection subscription). Events are delivered synchronously, in the
   * order they were produced. Returns the unsubscribe function.
   */
  subscribeChainEvents(
    chainId: number,
    listener: (event: WatchFeedEvent) => void,
  ): () => void {
    let set = this.listeners.get(chainId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(chainId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(chainId);
    };
  }

  /** The newest `limit` feed events for a chain, newest-first. */
  recentEvents(chainId: number, limit: number): WatchFeedEvent[] {
    return this.ringFor(chainId).newestFirst(limit);
  }

  /** All subscriptions on a chain, oldest-first (stable order for the UI). */
  async listSubscriptions(chainId: number): Promise<WatchSubscriptionView[]> {
    const rows = await this
      .selectRows()
      .where(eq(watchSubscriptions.chainId, chainId));
    return rows.map(toSubscriptionView);
  }

  /**
   * Upsert one (chain, address) subscription. A fresh row baselines at
   * the head on its first tick (watching starts now, never history); a
   * re-put only replaces the label and NEVER resets the cursor. Rejects
   * honestly (no working RPC for the chain / per-chain cap) instead of
   * storing a row no tick could ever serve.
   */
  async upsertSubscription(
    chainId: number,
    address: `0x${string}`,
    label: string | null,
  ): Promise<WatchUpsertResult> {
    // Gate 1: the chain must have a usable RPC config — otherwise the
    // subscription could never be served. This names the missing config
    // explicitly (the fix is an RPC URL away).
    const userUrl = rpcManager.getUserRpcConfig(chainId)?.customRpcUrl;
    const effectiveUrl = userUrl ?? getDefaultRpcUrl(chainId);
    if (effectiveUrl === '') {
      return {
        ok: false,
        error: 'rpc_unavailable',
        message:
          `Chain ${chainId} has no RPC URL configured — set one (⚙ RPC panel or POST /api/rpc-configs) before subscribing`,
      };
    }
    try {
      await rpcManager.getClient(chainId);
    } catch {
      return {
        ok: false,
        error: 'rpc_unavailable',
        message:
          `No RPC client available for chain ${chainId} — set a working RPC URL (⚙ RPC panel or POST /api/rpc-configs) before subscribing`,
      };
    }

    const existingRows = await this.selectRows().where(eq(watchSubscriptions.chainId, chainId));
    const existing = existingRows.find(row => row.address === address);
    if (existing === undefined && existingRows.length >= WATCH_MAX_SUBSCRIPTIONS_PER_CHAIN) {
      return {
        ok: false,
        error: 'watch_full',
        message:
          `Watch limit reached for chain ${chainId} (${WATCH_MAX_SUBSCRIPTIONS_PER_CHAIN} addresses) — remove one before adding another`,
      };
    }

    const now = new Date();
    await db
      .insert(watchSubscriptions)
      .values({
        chainId,
        address,
        label,
        lastProcessedBlock: null,
        createdAt: now,
        updatedAt: now,
      })
      // Conflict path updates ONLY the label: the cursor (and createdAt)
      // belong to the subscription's history, not to this edit.
      .onConflictDoUpdate({
        target: [watchSubscriptions.chainId, watchSubscriptions.address],
        set: { label, updatedAt: now },
      });

    return {
      ok: true,
      subscription: {
        chainId,
        address: address.toLowerCase(),
        label,
        lastProcessedBlock:
          existing?.lastProcessedBlock !== null && existing?.lastProcessedBlock !== undefined
            ? existing.lastProcessedBlock.toString()
            : null,
        createdAt:
          existing?.createdAt instanceof Date ? existing.createdAt.toISOString() : now.toISOString(),
        updatedAt: now.toISOString(),
      },
    };
  }

  /**
   * Remove a subscription. Returns false when the row does not exist (the
   * route answers 404 — idempotence would hide typos in the client's key).
   */
  async removeSubscription(chainId: number, address: `0x${string}`): Promise<boolean> {
    const rows = await this
      .selectRows()
      .where(and(eq(watchSubscriptions.chainId, chainId), eq(watchSubscriptions.address, address)));
    if (rows.length === 0) return false;
    await db
      .delete(watchSubscriptions)
      .where(and(eq(watchSubscriptions.chainId, chainId), eq(watchSubscriptions.address, address)));
    return true;
  }

  /**
   * One sweep. Reads all subscriptions, groups by chain, and for every
   * chain with rows: head via the shared RPC client, then per subscription
   * a bounded-concurrency ranged getLogs. Never throws — any failure logs
   * and skips (the whole tick, one chain, or one subscription, each at
   * its own granularity).
   */
  async tick(): Promise<void> {
    if (this.ticking) return; // a slow tick never stacks on itself
    this.ticking = true;
    try {
      const rows = await this.selectRows();
      if (rows.length === 0) return;

      const byChain = new Map<number, WatchSubscriptionRecord[]>();
      for (const row of rows) {
        const list = byChain.get(row.chainId);
        if (list === undefined) byChain.set(row.chainId, [row]);
        else list.push(row);
      }
      for (const [chainId, subs] of byChain) {
        await this.tickChain(chainId, subs);
      }
    } catch (err) {
      logger.warn({ err }, 'Watch tick failed; skipping this tick');
    } finally {
      this.ticking = false;
    }
  }

  private async tickChain(chainId: number, subs: WatchSubscriptionRecord[]): Promise<void> {
    // One head read per chain per tick, shared by every subscription.
    let client: Awaited<ReturnType<typeof rpcManager.getClient>>;
    let head: bigint;
    try {
      client = await rpcManager.getClient(chainId);
      head = await client.getBlockNumber();
      this.rpcMissingChains.delete(chainId);
    } catch (err) {
      if (!this.rpcMissingChains.has(chainId)) {
        logger.warn(
          { err, chainId },
          'Watch tick skipping chain: no working RPC client (a subscription write on such a chain is rejected; configure an RPC URL to resume watching)',
        );
        this.rpcMissingChains.add(chainId);
      }
      return;
    }

    // Bounded worker pool over a shared cursor: at most
    // WATCH_GETLOGS_CONCURRENCY getLogs in flight for this chain.
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < subs.length) {
        const sub = subs[cursor];
        cursor += 1;
        try {
          await this.scanSubscription(client, chainId, sub, head);
        } catch (err) {
          // The cursor did not move for this row: the same range is
          // retried next tick. Events may already have been published —
          // at-least-once, deduped downstream.
          logger.warn(
            { err, chainId, address: sub.address },
            'Watch sweep failed for one subscription; range retried next tick',
          );
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(WATCH_GETLOGS_CONCURRENCY, subs.length) }, () => worker()),
    );
  }

  private async scanSubscription(
    client: Awaited<ReturnType<typeof rpcManager.getClient>>,
    chainId: number,
    sub: WatchSubscriptionRecord,
    head: bigint,
  ): Promise<void> {
    const plan = planSubscriptionScan(sub.lastProcessedBlock ?? null, head);
    if (plan.action === 'none') return;

    if (plan.action === 'baseline') {
      // Fresh row (start watching from NOW) or reorg-shrunk head (follow
      // the new branch): move the cursor, emit nothing.
      await db
        .update(watchSubscriptions)
        .set({ lastProcessedBlock: head, updatedAt: new Date() })
        .where(
          and(eq(watchSubscriptions.chainId, chainId), eq(watchSubscriptions.address, sub.address)),
        );
      return;
    }

    const at = new Date();
    const events: WatchFeedEvent[] = [];
    if (plan.skippedFrom !== null && plan.skippedTo !== null) {
      events.push(gapMarkerEvent(chainId, sub.address, plan.skippedFrom, plan.skippedTo, at));
    }
    const logs = await client.getLogs({
      address: sub.address as `0x${string}`,
      fromBlock: plan.from,
      toBlock: plan.to,
    });
    for (const log of logs) {
      events.push(shapeLogEvent(chainId, sub.address, log, at));
    }

    // Publish BEFORE the cursor moves: a crash between the two replays
    // this range next tick (at-least-once) instead of losing events.
    this.publish(chainId, events);

    await db
      .update(watchSubscriptions)
      .set({ lastProcessedBlock: head, updatedAt: new Date() })
      .where(
        and(eq(watchSubscriptions.chainId, chainId), eq(watchSubscriptions.address, sub.address)),
      );
  }

  // Ring + listener fan-out for one chain's freshly produced events, in
  // chronological order (gap marker first, then logs oldest→newest — the
  // ring's newest-first layout lands the newest log on top).
  private publish(chainId: number, events: WatchFeedEvent[]): void {
    if (events.length === 0) return;
    const ring = this.ringFor(chainId);
    for (const event of events) ring.push(event);
    const set = this.listeners.get(chainId);
    if (set === undefined) return;
    for (const event of events) {
      for (const listener of set) listener(event);
    }
  }

  private ringFor(chainId: number): WatchEventRing {
    let ring = this.rings.get(chainId);
    if (ring === undefined) {
      ring = new WatchEventRing(WATCH_RING_CAPACITY);
      this.rings.set(chainId, ring);
    }
    return ring;
  }

  // Select builder kept separate so unit tests can spy the where() usage
  // through the mocked db without duplicating builder plumbing.
  private selectRows() {
    return db.select().from(watchSubscriptions);
  }
}

// Module-level singleton, the EventIndexingService pattern: one watcher
// per process. The interval itself starts when the route module is
// mounted (routes/watch.ts) — importing this module for its pure helpers
// (tests, stream.ts's subscription surface) stays side-effect free.
export const watchService = new WatchService();
