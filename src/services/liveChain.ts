// Live block stream service: browser-side EventSource wrapper over the
// backend's SSE tail (GET /api/chains/:chainId/blocks/stream) plus the
// silent polling fallback around it.
//
// The contract with every consumer: SSE is an ENHANCEMENT, never a
// dependency. The Home page's polled feed stays the source of truth; while
// the stream is healthy the lists get fresher heads and the feed badge
// says "Live", and the moment anything goes wrong (stream unsupported,
// backend without the route, network error, 429, unknown chain) the mode
// drops to 'polling' silently — one console.warn, no user-facing error.
//
// One EventSource per chainId is shared by every subscriber on the page
// (the blocks list and the watchlist both tail the same stream), so the
// manager below owns connection lifetime with a refcount.
import { useEffect, useRef, useState } from 'react';
import { getApiBase, onApiBaseChange } from '@/util/apiBase';
import type { RpcBlock } from '@/utils/blockRpcData';

// One SSE `block` event's data payload — mirrors the route's
// BlockStreamPayload (src/routes/stream.ts) and the RpcBlock field
// conventions (decimal strings for bigint quantities).
export type LiveBlockPayload = {
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

// 'live' only once a pushed block has actually arrived — never merely
// because a connection opened (an open-but-silent stream is the polling
// page's world until it proves itself).
export type LiveChainMode = 'polling' | 'live';

export type LiveChainState = {
  mode: LiveChainMode;
  /** Newest-first rolling window of pushed blocks. */
  blocks: LiveBlockPayload[];
};

// Rolling window size: matches the Home feed's list (HOME_FEED_ITEMS in
// homeFeed.ts) so a live-mode merge never changes list length.
export const LIVE_BLOCK_WINDOW = 10;

// Delivered-block dedupe memory: enough to make replays and EventSource
// re-deliveries harmless forever in practice, tiny to keep.
const SEEN_NUMBERS_CAP = 256;

// The state before any stream exists (and after one gives up): blocks come
// only from the polled feed. Reference-stable so React state identity
// means something.
const POLLING_ONLY_STATE: LiveChainState = { mode: 'polling', blocks: [] };

const isLiveBlockPayload = (value: unknown): value is LiveBlockPayload => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.number === 'string' && /^\d+$/.test(v.number)
    && typeof v.hash === 'string'
    && typeof v.parentHash === 'string'
    && typeof v.timestamp === 'string'
    && typeof v.miner === 'string'
    && typeof v.transactionCount === 'number'
    && typeof v.gasUsed === 'string'
    && typeof v.gasLimit === 'string'
  );
};

type LiveStreamEntry = {
  chainId: number;
  state: LiveChainState;
  refs: number;
  stateListeners: Set<(state: LiveChainState) => void>;
  blockListeners: Set<(block: LiveBlockPayload) => void>;
  source: EventSource | null;
  /** Permanent downgrade for this entry after an error (same API base). */
  gaveUp: boolean;
  /** Block numbers already delivered to listeners (replay guard). */
  seen: Set<string>;
};

const entries = new Map<number, LiveStreamEntry>();

const liveStreamUrl = (chainId: number): string =>
  `${getApiBase()}/api/chains/${chainId}/blocks/stream`;

// Whether a stream may be attempted at all right now. The degraded-mode
// guard mirrors util/http.ts: with no discovered backend the URL would go
// same-origin and (in dev) hit the vite bridge, whose response buffering
// breaks SSE — better to stay honestly on polling than to hang a request.
const streamPossible = (): boolean =>
  getApiBase() !== '' && typeof EventSource !== 'undefined';

const broadcastState = (entry: LiveStreamEntry): void => {
  for (const listener of entry.stateListeners) listener(entry.state);
};

const closeSource = (entry: LiveStreamEntry): void => {
  if (entry.source === null) return;
  entry.source.close();
  entry.source = null;
};

const handleBlockEvent = (entry: LiveStreamEntry, data: unknown): void => {
  if (!isLiveBlockPayload(data)) return;
  if (entry.seen.has(data.number)) return;
  entry.seen.add(data.number);
  if (entry.seen.size > SEEN_NUMBERS_CAP) entry.seen.clear();

  entry.state = {
    mode: 'live',
    blocks: [
      data,
      ...entry.state.blocks.filter(b => b.number !== data.number),
    ].slice(0, LIVE_BLOCK_WINDOW),
  };
  broadcastState(entry);
  for (const listener of entry.blockListeners) listener(data);
};

const giveUp = (entry: LiveStreamEntry, reason: string): void => {
  // Honest trace, silent UI: the polling feed takes over seamlessly.
  console.warn(`liveChain: falling back to polling (${reason})`);
  entry.gaveUp = true;
  closeSource(entry);
  if (entry.state.mode !== 'polling') {
    entry.state = { mode: 'polling', blocks: entry.state.blocks };
    broadcastState(entry);
  }
};

const openStream = (entry: LiveStreamEntry): void => {
  if (entry.source !== null || entry.gaveUp) return;
  if (!streamPossible()) return;

  const source = new EventSource(liveStreamUrl(entry.chainId));

  source.addEventListener('block', event => {
    let data: unknown;
    try {
      data = JSON.parse((event as MessageEvent<string>).data);
    } catch {
      return; // A malformed frame never reaches the list or the watchlist.
    }
    handleBlockEvent(entry, data);
  });

  // The server's explicit terminal event (unknown chain, dead RPC): log
  // the message, then let the close below do the downgrade — the browser
  // fires onerror when the server ends the stream.
  source.addEventListener('error', event => {
    const data = (event as MessageEvent<string>).data;
    if (typeof data === 'string' && data.length > 0) {
      console.warn(`liveChain: block stream error event: ${data}`);
    }
  });

  source.onerror = () => {
    // Any failure — connection refused, 404/429 status, mid-stream drop —
    // downgrades to polling for the rest of this entry's life. Native
    // EventSource would auto-reconnect; a permanent silent fallback is the
    // deterministic, honest choice (the polled feed is the source of
    // truth and never goes away).
    giveUp(entry, 'stream error');
  };

  entry.source = source;
};

const acquire = (chainId: number): LiveStreamEntry => {
  const existing = entries.get(chainId);
  if (existing) {
    existing.refs++;
    return existing;
  }
  const entry: LiveStreamEntry = {
    chainId,
    state: POLLING_ONLY_STATE,
    refs: 1,
    stateListeners: new Set(),
    blockListeners: new Set(),
    source: null,
    gaveUp: false,
    seen: new Set(),
  };
  entries.set(chainId, entry);
  openStream(entry);
  return entry;
};

const release = (chainId: number): void => {
  const entry = entries.get(chainId);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  closeSource(entry);
  entries.delete(chainId);
};

// Late discovery / manual base switches: streams open when a base appears,
// close when it disappears, and an error verdict is forgotten when the
// base CHANGES (a different backend is a genuinely new world — but the
// same base never re-opens after giving up, so nothing can loop).
onApiBaseChange(() => {
  const base = getApiBase();
  for (const entry of entries.values()) {
    if (base === '') {
      closeSource(entry);
      entry.gaveUp = false;
      if (entry.state.mode !== 'polling') {
        entry.state = { mode: 'polling', blocks: entry.state.blocks };
        broadcastState(entry);
      }
      continue;
    }
    entry.gaveUp = false;
    openStream(entry);
  }
});

/**
 * Subscribe to the live-chain state (mode + rolling block window) for one
 * chain. The listener fires immediately with the current state. Returns
 * the unsubscribe function. `chainId <= 0` (unsupported-chain guard) is a
 * permanent polling subscription that never opens a connection.
 */
export function subscribeLiveChain(
  chainId: number,
  listener: (state: LiveChainState) => void,
): () => void {
  if (!(chainId > 0)) {
    listener(POLLING_ONLY_STATE);
    return () => undefined;
  }
  const entry = acquire(chainId);
  entry.stateListeners.add(listener);
  listener(entry.state);
  return () => {
    entry.stateListeners.delete(listener);
    release(chainId);
  };
}

/**
 * Subscribe to every NEW pushed block for one chain (shared EventSource
 * with subscribeLiveChain; already-delivered numbers are never re-sent, so
 * a consumer cannot see the same block twice).
 */
export function subscribeLiveBlockEvents(
  chainId: number,
  onBlock: (block: LiveBlockPayload) => void,
): () => void {
  if (!(chainId > 0)) return () => undefined;
  const entry = acquire(chainId);
  entry.blockListeners.add(onBlock);
  return () => {
    entry.blockListeners.delete(onBlock);
    release(chainId);
  };
}

/** Live-chain state hook: `{ mode, blocks }` for one chain. */
export function useLiveBlocks(chainId: number): LiveChainState {
  const [state, setState] = useState<LiveChainState>(POLLING_ONLY_STATE);
  useEffect(() => subscribeLiveChain(chainId, setState), [chainId]);
  return state;
}

/**
 * Per-block callback hook (latest-ref semantics: the callback may change
 * every render; the shared subscription is keyed only on chainId).
 */
export function useLiveBlockEvents(
  chainId: number,
  onBlock: (block: LiveBlockPayload) => void,
): void {
  const onBlockRef = useRef(onBlock);
  onBlockRef.current = onBlock;
  useEffect(
    () => subscribeLiveBlockEvents(chainId, block => onBlockRef.current(block)),
    [chainId],
  );
}

/** A pushed block, in the RpcBlock shape the Home list renders. */
export const liveBlockToRpcBlock = (block: LiveBlockPayload): RpcBlock => ({
  number: block.number,
  hash: block.hash,
  parentHash: block.parentHash,
  timestamp: block.timestamp,
  miner: block.miner,
  gasUsed: block.gasUsed,
  gasLimit: block.gasLimit,
  baseFeePerGas: block.baseFeePerGas,
  transactionCount: block.transactionCount,
  sizeBytes: block.sizeBytes,
});

/**
 * Pure merge of the polled feed with the live window: every distinct
 * block number appears once, newest first, capped. Live entries win over
 * polled ones with the same number (they are the newer read of the same
 * block); a polled list that is momentarily ahead of the stream still
 * sorts to the head, so the merge is correct regardless of which channel
 * saw the newest block first.
 */
export function mergeLiveBlocks(
  feedBlocks: RpcBlock[],
  liveBlocks: LiveBlockPayload[],
  cap: number,
): RpcBlock[] {
  const byNumber = new Map<string, RpcBlock>();
  for (const block of feedBlocks) byNumber.set(block.number, block);
  for (const block of liveBlocks) byNumber.set(block.number, liveBlockToRpcBlock(block));
  return [...byNumber.values()]
    .sort((a, b) => {
      const left = BigInt(a.number);
      const right = BigInt(b.number);
      if (left > right) return -1;
      if (left < right) return 1;
      return 0;
    })
    .slice(0, Math.max(0, cap));
}
