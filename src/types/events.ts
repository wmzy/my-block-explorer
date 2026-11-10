/**
 * ABI event-related type definitions: block tags
 */

// ============================================
// Block tag types
// ============================================

/**
 * Negative sentinel values for special block tags
 * -1 = latest (most recent block)
 * -2 = finalized (finalized block)
 * -3 = safe (safe block)
 * -4 = earliest (genesis block)
 */
export type BlockTagSentinel = -1 | -2 | -3 | -4;

/**
 * Supported block tags
 */
export type BlockTag = 'latest' | 'finalized' | 'safe' | 'earliest';

/**
 * Block tag sentinel constants
 */
export const BLOCK_TAG_SENTINELS: Record<BlockTag, BlockTagSentinel> = {
  latest: -1,
  finalized: -2,
  safe: -3,
  earliest: -4,
} as const;

/**
 * Reverse mapping from sentinels to block tags
 */
export const SENTINEL_TO_TAG: Record<BlockTagSentinel, BlockTag> = {
  [-1]: 'latest',
  [-2]: 'finalized',
  [-3]: 'safe',
  [-4]: 'earliest',
} as const;

/**
 * Block value types accepted by the API
 * Either a number (block number) or a string tag
 */
export type BlockTagInput = number | BlockTag;
