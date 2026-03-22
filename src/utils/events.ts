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

/**
 * Find the earliest block with events for a contract by probing
 * backwards from the latest block in exponentially growing ranges.
 * Returns the earliest event block found, or a reasonable fallback.
 */
export const getContractCreationBlock = async (
  client: unknown,
  contractAddress: string,
): Promise<bigint> => {
  const rpc = client as RpcClient;
  try {
    const latestBlock = await rpc.getBlockNumber();
    const addr = contractAddress as `0x${string}`;

    // Binary-search style: probe at increasing distances from genesis.
    // Find the largest offset where events exist, then use that as the start.
    const offsets = [10_000n, 50_000n, 200_000n, 1_000_000n, 5_000_000n, 10_000_000n, 20_000_000n];
    let earliestFound: bigint | null = null;

    for (const offset of offsets) {
      if (offset > latestBlock) continue;
      const fromBlock = latestBlock - offset;

      try {
        const logs = await rpc.getLogs({
          address: addr,
          fromBlock,
          toBlock: fromBlock + 9_999n,
        });

        if (logs.length > 0) {
          const blockMin = logs.reduce(
            (min, l) => (l.blockNumber < min ? l.blockNumber : min),
            logs[0].blockNumber,
          );
          if (earliestFound === null || blockMin < earliestFound) {
            earliestFound = blockMin;
          }
        }
      } catch {
        // RPC may reject, skip
      }
    }

    // If we found events, use the earliest block found (minus small buffer)
    if (earliestFound !== null) {
      return earliestFound > 100n ? earliestFound - 100n : 0n;
    }

    // Fallback: start from recent blocks
    return latestBlock > 100_000n ? latestBlock - 100_000n : 0n;
  } catch (error) {
    console.warn('Failed to get contract creation block:', error);
    try {
      const latestBlock = await rpc.getBlockNumber();
      return latestBlock > 100_000n ? latestBlock - 100_000n : 0n;
    } catch {
      return 0n;
    }
  }
};

export const getEventNameFromSignature = (eventSignature: string): string => {
  const cached = signatureToNameCache.get(eventSignature);
  if (cached) return cached;
  return 'Unknown';
};
