/**
 * Event decoding and selector utilities for contract events
 */

import { type Abi, type AbiEvent, toEventSelector, parseAbiItem } from "viem";

const signatureToNameCache = new Map<string, string>();
const nameToSignatureCache = new Map<string, string>();

/**
 * Register ABI events so that signature lookups work dynamically
 * instead of relying on a hardcoded table.
 */
export const registerAbiEvents = (abi: Abi | readonly unknown[]): void => {
  for (const item of abi) {
    const entry = item as Record<string, unknown>;
    if (entry.type !== "event" || typeof entry.name !== "string") continue;
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
    Transfer: "event Transfer(address indexed from, address indexed to, uint256 value)",
    Approval: "event Approval(address indexed owner, address indexed spender, uint256 value)",
    OwnershipTransferred: "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  };

  const sig = wellKnown[eventName];
  if (sig) {
    try {
      const parsed = parseAbiItem(sig) as AbiEvent;
      const selector = toEventSelector(parsed);
      nameToSignatureCache.set(eventName, selector);
      signatureToNameCache.set(selector, eventName);
      return selector;
    } catch { /* fall through */ }
  }

  return "0x" + "0".repeat(64);
};

export const decodeEventData = (
  eventName: string,
  topics: readonly string[],
  data: string
): Record<string, unknown> => {
  try {
    if (eventName === "Transfer" && topics.length >= 2) {
      return {
        from: topics[0],
        to: topics[1],
        value: data && data !== "0x" ? BigInt(data) : undefined,
        raw: { topics, data },
      };
    }

    if (eventName === "Approval" && topics.length >= 2) {
      return {
        owner: topics[0],
        spender: topics[1],
        value: data && data !== "0x" ? BigInt(data) : undefined,
        raw: { topics, data },
      };
    }

    if (eventName === "OwnershipTransferred" && topics.length >= 2) {
      return {
        previousOwner: topics[0],
        newOwner: topics[1],
        raw: { topics, data },
      };
    }

    return {
      topics,
      data,
      raw: { topics, data },
    };
  } catch (error) {
    console.warn("Failed to decode event data:", error);
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
  contractAddress: string
): Promise<bigint> => {
  const rpc = client as RpcClient;
  try {
    const latestBlock = await rpc.getBlockNumber();
    const addr = contractAddress as `0x${string}`;

    // Probe backwards with exponentially growing ranges
    // Start with recent 10k blocks, then 50k, 200k, 1M, etc.
    const ranges = [10_000n, 50_000n, 200_000n, 1_000_000n, 5_000_000n];
    let earliestFound: bigint | null = null;

    for (const rangeSize of ranges) {
      const fromBlock =
        latestBlock > rangeSize ? latestBlock - rangeSize : 0n;

      try {
        const logs = await rpc.getLogs({
          address: addr,
          fromBlock,
          toBlock: fromBlock + 9_999n, // small probe at the start of range
        });

        if (logs.length > 0) {
          earliestFound = logs.reduce(
            (min, l) => (l.blockNumber < min ? l.blockNumber : min),
            logs[0].blockNumber
          );
        }
      } catch {
        // RPC may reject large ranges, continue with next
      }

      if (earliestFound !== null) break;
    }

    // If we found events, use the earliest block found (minus small buffer)
    if (earliestFound !== null) {
      const result = earliestFound > 100n ? earliestFound - 100n : 0n;
      console.log(
        `Contract earliest event block: ${earliestFound} (starting from: ${result})`
      );
      return result;
    }

    // Fallback: start from recent blocks
    const fallback = latestBlock > 100_000n ? latestBlock - 100_000n : 0n;
    console.log(
      `No events found in probes, using fallback block: ${fallback} (latest: ${latestBlock})`
    );
    return fallback;
  } catch (error) {
    console.warn("Failed to get contract creation block:", error);
    try {
      const latestBlock = await rpc.getBlockNumber();
      return latestBlock > 100_000n ? latestBlock - 100_000n : 0n;
    } catch {
      return 0n;
    }
  }
};

export const getEventNameFromSignature = (
  eventSignature: string
): string => {
  const cached = signatureToNameCache.get(eventSignature);
  if (cached) return cached;
  return eventSignature;
};
