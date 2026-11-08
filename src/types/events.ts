/**
 * ABI event-related type definitions
 * Block tags and event decoding
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

// ============================================
// Event decoding types (EventDecodingService)
// ============================================

// Base event parameter type
export type EventParameter = {
  name: string;
  type: string;
  indexed: boolean;
  internalType?: string;
};

// Decoded event data
export type DecodedEventData = Record<string, unknown>;

// Event decoding error
export class EventDecodingError extends Error {
  constructor(
    message: string,
    public readonly blockHash?: string,
    public readonly logIndex?: number,
    public readonly chainId?: number,
    public readonly cause?: Error,
  ) {
    super(message);
    this.name = 'EventDecodingError';
  }
}

// Validation result
export type ValidationResult = {
  valid: boolean;
  error?: string;
  sanitizedValue?: unknown;
};

// Event data validator
export type EventDataValidator = {
  validate(param: EventParameter, value: unknown): ValidationResult;
};

// Event data converter
export type EventDataTransformer = {
  transform(param: EventParameter, value: unknown): unknown;
  reverseTransform(param: EventParameter, value: unknown): unknown;
};

// Decoded event
export type DecodedEvent = {
  // Basic info
  chainId: number;
  contractAddress: `0x${string}`;
  eventName: string;
  eventSignature: `0x${string}`;

  // Transaction info
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionIndex: number;
  logIndex: number;

  // Timestamp info — null when the block timestamp could not be fetched; never a
  // fabricated placeholder.
  blockTimestamp: number | null;

  // Decoded data
  args: DecodedEventData;
  rawTopics: readonly `0x${string}`[];
  rawData: `0x${string}`;

  // Processing info
  indexedAt: Date;
  processingErrors?: string[];
};
