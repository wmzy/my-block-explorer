/**
 * Event decoding and selector utilities for contract events
 */

import { type Abi, type AbiEvent, toEventSelector, parseAbiItem } from 'viem';

const signatureToNameCache = new Map<string, string>();
const nameToSignatureCache = new Map<string, string>();

/**
 * Register ABI events so that signature lookups work dynamically
 * instead of relying on a hardcoded table.
 */
export const registerAbiEvents = (abi: Abi | readonly unknown[]): void => {
  for (const item of abi) {
    const entry = item as Record<string, unknown>;
    if (entry.type !== 'event' || typeof entry.name !== 'string') continue;
    try {
      const selector = toEventSelector(entry as AbiEvent);
      signatureToNameCache.set(selector, entry.name);
      nameToSignatureCache.set(entry.name, selector);
    } catch {
      // skip malformed entries
    }
  }
};

export const getEventSelectorFromName = (eventName: string): string => {
  const cached = nameToSignatureCache.get(eventName);
  if (cached) return cached;

  const wellKnown: Record<string, string> = {
    Transfer: 'event Transfer(address indexed from, address indexed to, uint256 value)',
    Approval: 'event Approval(address indexed owner, address indexed spender, uint256 value)',
    OwnershipTransferred:
      'event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)',
  };

  const sig = wellKnown[eventName];
  if (sig) {
    try {
      const parsed = parseAbiItem(sig) as AbiEvent;
      const selector = toEventSelector(parsed);
      nameToSignatureCache.set(eventName, selector);
      signatureToNameCache.set(selector, eventName);
      return selector;
    } catch {
      /* fall through */
    }
  }

  return `0x${'0'.repeat(64)}`;
};

export const decodeEventData = (
  eventName: string,
  topics: readonly string[],
  data: string,
): Record<string, unknown> => {
  try {
    // topics[0] is the event signature selector, indexed params start at topics[1]
    if (eventName === 'Transfer' && topics.length >= 3) {
      return {
        from: topics[1],
        to: topics[2],
        value: data && data !== '0x' ? BigInt(data) : undefined,
        raw: { topics, data },
      };
    }

    if (eventName === 'Approval' && topics.length >= 3) {
      return {
        owner: topics[1],
        spender: topics[2],
        value: data && data !== '0x' ? BigInt(data) : undefined,
        raw: { topics, data },
      };
    }

    if (eventName === 'OwnershipTransferred' && topics.length >= 3) {
      return {
        previousOwner: topics[1],
        newOwner: topics[2],
        raw: { topics, data },
      };
    }

    return {
      topics,
      data,
      raw: { topics, data },
    };
  } catch (error) {
    console.warn('Failed to decode event data:', error);
    return {
      topics,
      data,
      raw: { topics, data },
    };
  }
};

type RpcClient = {
  getBlockNumber: () => Promise<bigint>;
  getLogs: (args: {
    address: `0x${string}`;
    fromBlock: bigint;
    toBlock: bigint;
  }) => Promise<Array<{ blockNumber: bigint }>>;
};

// One getLogs window size. Public providers commonly cap a single getLogs
// range, so the walk asks in windows this size rather than one huge span.
const CREATION_PROBE_WINDOW = 10_000n;

/**
 * Find the earliest block that can hold events for a contract, or null
 * when that cannot be established.
 *
 * The answer is a BOUNDARY the indexing ranges treat as authoritative:
 * `createRangeAll` starts full-history indexing at it, and `addIndexingRange`
 * REJECTS a user's earlier `fromBlock` when it is below it. So an
 * over-estimated "creation block" does not merely mislabel a row: it
 * silently drops every event between the real creation block and the
 * estimate, and it blocks the user from correcting it by hand.
 *
 * The walk therefore goes DOWN contiguously from the head, halving the
 * remaining gap at each step and always re-anchoring on the boundary
 * just found. Every block from the head down to the first hit is covered
 * with no gap, so a hit genuinely bounds the earliest event; an empty
 * window only means "no events in THIS window" and never concludes
 * anything about the ones below it.
 *
 * The result is deliberately a *bound*, not a guess at the deployment
 * block: it is the start of the oldest window that produced a hit, less
 * a small buffer so the window's own first block is inside the range.
 * If the walk reaches block 0 having proved the whole chain was covered,
 * the contract's events start at genesis as far as we can tell and 0 is
 * the honest answer. Anything short of a completed walk — an RPC error,
 * a head below one window, or a window that fails — returns null, which
 * every caller already handles ("creation block unknown"): `createRangeAll`
 * indexes from genesis instead of from a fabricated start, and
 * `addIndexingRange` skips the clamp rather than inventing a boundary.
 */
export const getContractCreationBlock = async (
  client: unknown,
  contractAddress: string,
): Promise<bigint | null> => {
  const rpc = client as RpcClient;
  const addr = contractAddress as `0x${string}`;

  try {
    const latestBlock = await rpc.getBlockNumber();

    // Smallest span we will even attempt: below one window the walk
    // cannot distinguish "no events" from "not probed".
    if (latestBlock + 1n < CREATION_PROBE_WINDOW) return null;

    let searchHigh = latestBlock;
    // Span of the window to probe next, measured back from `searchHigh`.
    // It starts at ONE window, not the whole chain: a first probe of
    // [0..head] would hit for any active contract and immediately pin
    // the boundary at genesis — the opposite error. Every empty window
    // doubles it (capped by what is left to cover), so the walk descends
    // contiguously and each step covers at least as much as the last.
    let span = CREATION_PROBE_WINDOW;

    while (span >= CREATION_PROBE_WINDOW) {
      const fromBlock = searchHigh - span + 1n;
      const toBlock = searchHigh;

      let logs: Array<{ blockNumber: bigint }>;
      try {
        logs = await rpc.getLogs({ address: addr, fromBlock, toBlock });
      } catch {
        // A rejected window proves nothing; an incomplete walk must not
        // be reported as a boundary.
        return null;
      }

      if (logs.length > 0) {
        // The oldest window that hit: its start bounds the earliest
        // event. Stop here — everything below is unprobed and may or may
        // not hold events, and the caller can index from this bound.
        return fromBlock > 100n ? fromBlock - 100n : 0n;
      }

      // Empty window: the next probe must still ABUT this one, or the
      // gap between them would go unexamined and an older hit could be
      // missed (the defect the sparse-offset walk had).
      searchHigh = fromBlock - 1n;
      // Grow the next window, but never past what is actually left to
      // cover: `searchHigh + 1` is the top block still unprobed, and a
      // window longer than that would re-probe blocks we just proved
      // empty (and could run past genesis).
      span = span * 2n;
      if (span > searchHigh + 1n) span = searchHigh + 1n;
    }

    // The whole chain below the head was probed and no events were found
    // anywhere. That proves the contract has no indexed events, NOT that
    // it was deployed at genesis — so the creation block is still
    // UNKNOWN. Returning 0 here would be the same fabrication as the
    // `latest - 100_000` guess it replaces: it would pin a boundary no
    // evidence supports, and `createRangeFirst` would build a range at
    // blocks 0..N for a contract with nothing to index there. Null is
    // the honest answer, and every caller already handles it.
    return null;
  } catch {
    return null;
  }
};

export const getEventNameFromSignature = (eventSignature: string): string => {
  const cached = signatureToNameCache.get(eventSignature);
  if (cached) return cached;
  return 'Unknown';
};
