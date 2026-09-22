// Live block stream route: one server-sent-event connection per client
// tailing the chain head. The server polls eth_blockNumber on the shared
// RpcManager client (~1s) and pushes one `block` event per NEW block, so
// browsers see fresh blocks without a poll loop. SSE here is strictly an
// enhancement: the frontend's polled feed remains the source of truth and
// every EventSource error silently falls back to it (see
// services/liveChain.ts) — nothing on the page depends on this stream.
//
// Honesty rules encoded:
// - Only genuinely new blocks are emitted (the head at connect time is a
//   baseline, not an event), and a stall never triggers an archive walk:
//   gaps wider than MAX_CATCHUP emit only the newest blocks.
// - The miner/validator field is whatever the header carries, verbatim —
//   chains whose RPC reports the zero address (Bor-style PoS) keep it and
//   the frontend renders its "not exposed" note (describeBlockProducer).
// - Giving up (dead RPC) is an explicit `error` event, then a clean close.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import type { Block, PublicClient } from 'viem';
import { createLogger } from '../server/logger';
import { getValidatedChainId } from '../server/validation';
import { rpcManager } from '../services/RpcManager';
import { createRateLimiter } from '../middleware/rate-limit';

const logger = createLogger('stream-routes');

const app = new Hono();

// Head poll cadence. eth_blockNumber is the cheapest call an RPC offers;
// one per second per open stream keeps the tail fresh on 2s-block chains.
export const BLOCK_STREAM_POLL_INTERVAL_MS = 1_000;

// SSE comment sent whenever nothing else was written for this long, so
// proxies and the browser can tell an idle-but-healthy stream from a dead
// one (and the EventSource does not time out).
const BLOCK_STREAM_HEARTBEAT_MS = 15_000;

// After a stall (slow producer, paused process) the head may have moved by
// more than a sane catch-up batch. The stream is a live tail, not an
// archive walk: emit only the newest MAX_CATCHUP blocks and let the
// client's polled feed cover the older ones.
const BLOCK_STREAM_MAX_CATCHUP = 10;

// Transient public-RPC hiccups are normal; a dead endpoint must not hold
// connections open forever. This many consecutive failed head polls give
// up with an explicit error event.
const BLOCK_STREAM_MAX_CONSECUTIVE_ERRORS = 10;

// Cost control: each open stream polls the chain head once per second, so
// connection creation is rate-limited per client. A page opens at most one
// stream; extra browser tabs are the realistic burst — beyond the burst
// the extra streams get a 429 (which the frontend's EventSource surfaces
// as a silent fallback to polling, exactly like any other stream failure).
app.use(
  '/chains/:chainId/blocks/stream',
  createRateLimiter({ name: 'blocks-stream', requestsPerMinute: 12, burst: 6 }),
);

// One SSE `block` event's data payload. Field names/types mirror the
// RpcBlock the Home feed renders (decimal strings for bigint quantities)
// so the frontend can merge a pushed block into the polled list without a
// second fetch. Keep in sync with LiveBlockPayload in
// src/services/liveChain.ts.
type BlockStreamPayload = {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
  miner: string;
  transactionCount: number;
  gasUsed: string;
  gasLimit: string;
  baseFeePerGas?: string;
  sizeBytes?: number;
};

const toPayload = (block: Block): BlockStreamPayload | null => {
  // A block without number/hash cannot be identified downstream (pending
  // head race) — skip it rather than emit a half-identified event.
  if (block.number === null || block.hash === null) return null;
  return {
    number: block.number.toString(),
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp.toString(),
    miner: block.miner,
    transactionCount: block.transactions.length,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
    baseFeePerGas:
      block.baseFeePerGas !== undefined && block.baseFeePerGas !== null
        ? block.baseFeePerGas.toString()
        : undefined,
    sizeBytes: block.size != null ? Number(block.size) : undefined,
  };
};

const errorEvent = (payload: { error: string; message: string }) =>
  JSON.stringify(payload);

// GET /chains/:chainId/blocks/stream — SSE tail of new blocks.
app.get('/chains/:chainId/blocks/stream', c => {
  let chainId: number;
  try {
    chainId = getValidatedChainId(c.req.param('chainId'));
  } catch (e) {
    // Unknown/malformed chain: per the EventSource contract, one `error`
    // event then a clean close. (A bare 400 would reach the browser as an
    // opaque onerror with no body to explain itself.)
    const message =
      e instanceof HTTPException ? e.message : 'Invalid chain ID';
    logger.warn({ message }, 'Block stream requested for an invalid chain');
    return streamSSE(c, async stream => {
      await stream.writeSSE({
        event: 'error',
        data: errorEvent({ error: 'invalid_chain', message }),
      });
    });
  }

  const signal = c.req.raw.signal;

  return streamSSE(c, async stream => {
    let client: PublicClient;
    try {
      client = await rpcManager.getClient(chainId);
    } catch (err) {
      logger.error({ err, chainId }, 'Block stream could not get an RPC client');
      await stream.writeSSE({
        event: 'error',
        data: errorEvent({
          error: 'rpc_unavailable',
          message: `No RPC client available for chain ${chainId}`,
        }),
      });
      return;
    }

    // Head at connect time: the baseline. The first genuinely NEW block
    // (one mined after the stream opened) is the first event.
    let lastEmitted: bigint | null = null;
    let consecutiveErrors = 0;
    let lastWriteMs = Date.now();

    while (!signal.aborted && !stream.aborted && !stream.closed) {
      let head: bigint;
      try {
        head = await client.getBlockNumber();
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        if (consecutiveErrors >= BLOCK_STREAM_MAX_CONSECUTIVE_ERRORS) {
          logger.error(
            { err, chainId, consecutiveErrors },
            'Block stream giving up after repeated head-poll failures',
          );
          await stream.writeSSE({
            event: 'error',
            data: errorEvent({
              error: 'rpc_failed',
              message: `Chain ${chainId} head polls failed ${consecutiveErrors} times in a row`,
            }),
          });
          return;
        }
        await stream.sleep(BLOCK_STREAM_POLL_INTERVAL_MS);
        continue;
      }

      if (lastEmitted === null) {
        lastEmitted = head;
      } else if (head < lastEmitted) {
        // Reorg shrank the head: resync the baseline so the stream follows
        // the new branch (already-emitted blocks on the abandoned branch
        // stay emitted — this is a live tail, not a canonical history).
        logger.warn(
          { chainId, lastEmitted: lastEmitted.toString(), head: head.toString() },
          'Block stream head moved backwards (reorg); resyncing baseline',
        );
        lastEmitted = head;
      } else if (head > lastEmitted) {
        const gap: bigint = head - lastEmitted;
        const from: bigint =
          gap > BigInt(BLOCK_STREAM_MAX_CATCHUP)
            ? head - BigInt(BLOCK_STREAM_MAX_CATCHUP - 1)
            : lastEmitted + 1n;
        for (let n: bigint = from; n <= head; n++) {
          if (signal.aborted || stream.aborted) return;
          try {
            const block = await client.getBlock({ blockNumber: n });
            const payload = toPayload(block);
            if (payload) {
              await stream.writeSSE({ event: 'block', data: JSON.stringify(payload) });
              lastWriteMs = Date.now();
            }
            lastEmitted = n;
          } catch (err) {
            // One unreadable block holds the cursor so the next cycle
            // retries it; the rest of the backlog follows after.
            logger.warn(
              { err, chainId, blockNumber: n.toString() },
              'Block stream could not fetch a new block; will retry next cycle',
            );
            break;
          }
        }
      }

      if (Date.now() - lastWriteMs >= BLOCK_STREAM_HEARTBEAT_MS) {
        await stream.write(`: heartbeat ${Date.now()}\n\n`);
        lastWriteMs = Date.now();
      }

      await stream.sleep(BLOCK_STREAM_POLL_INTERVAL_MS);
    }
  });
});

export default app;
