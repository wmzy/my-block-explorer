import type { PublicClient } from 'viem';
import type { BlockTag, BlockTagInput, BlockTagSentinel } from '../types/events';
import { BLOCK_TAG_SENTINELS, SENTINEL_TO_TAG } from '../types/events';

export const isBlockTagSentinel = (value: number): value is BlockTagSentinel =>
  value in SENTINEL_TO_TAG;

export const blockTagToSentinel = (tag: BlockTag): BlockTagSentinel => BLOCK_TAG_SENTINELS[tag];

export const sentinelToBlockTag = (sentinel: BlockTagSentinel): BlockTag =>
  SENTINEL_TO_TAG[sentinel];

export const inputToStoredValue = (input: BlockTagInput): number =>
  typeof input === 'string' ? blockTagToSentinel(input) : input;

export const resolveBlockTag = async (
  client: PublicClient,
  sentinel: BlockTagSentinel,
): Promise<bigint> => {
  const tag = sentinelToBlockTag(sentinel);
  if (tag === 'earliest') return 0n;
  const block = await client.getBlock({ blockTag: tag });
  return block.number;
};

export const resolveToBlock = async (
  client: PublicClient,
  storedValue: number,
): Promise<bigint> => {
  if (isBlockTagSentinel(storedValue)) {
    return resolveBlockTag(client, storedValue);
  }
  return BigInt(storedValue);
};
