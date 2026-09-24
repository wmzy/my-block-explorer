// Pure ERC-20/721/1155 Transfer-event log decoding. No network, no React —
// every function is deterministic and unit-testable in isolation. Decoding
// is best-effort: a malformed log is skipped, never thrown.
import {
  decodeAbiParameters,
  getAddress,
  parseAbiParameters,
  type Hex,
} from 'viem';

export type DecodedTokenTransfer =
  | { kind: 'erc20'; token: string; from: string; to: string; value: string }
  | { kind: 'erc721'; token: string; from: string; to: string; tokenId: string }
  | { kind: 'erc1155_single'; token: string; from: string; to: string; id: string; amount: string }
  | { kind: 'erc1155_batch'; token: string; from: string; to: string; ids: string[]; amounts: string[] };

/** Token standard families a Transfer log's topic shape can evidence. */
export type TokenStandardId = 'erc20' | 'erc721' | 'erc1155';

/** Structural slice of viem's `Log` that this decoder consumes. */
type TransferLog = {
  address: string;
  topics: readonly string[];
  data: string;
};

// topic0 of Transfer(address,address,uint256) — shared by ERC-20 and ERC-721;
// only the indexed-topic count tells them apart (ERC-721 indexes the tokenId).
const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// topic0 of ERC-1155 TransferSingle(address,address,address,uint256,uint256).
const TRANSFER_SINGLE_TOPIC0 = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62';
// topic0 of ERC-1155 TransferBatch(address,address,address,uint256[],uint256[]).
const TRANSFER_BATCH_TOPIC0 = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb';

// Exactly one/two 32-byte ABI words — anything shorter, longer, or non-hex
// is malformed event data and must not decode.
const UINT256_WORD = /^0x[0-9a-fA-F]{64}$/;
const UINT256_WORD_PAIR = /^0x[0-9a-fA-F]{128}$/;

/**
 * Classify a log's token standard from its topic shape alone — the same
 * topic0 whitelist and indexed-topic-count rules `decodeTransferLog`
 * applies: the shared Transfer selector with three topics is ERC-20 (the
 * value rides in data), with four it is ERC-721 (the indexed tokenId is
 * the fourth); the ERC-1155 single/batch selectors are ERC-1155. Anything
 * else (unknown topic0, nonstandard topic count, no topics) returns
 * undefined — the standard is then honestly unknown, never guessed.
 */
export function transferStandardFromTopics(
  topics: readonly string[],
): TokenStandardId | undefined {
  const topic0 = topics[0]?.toLowerCase();
  if (topic0 === undefined) return undefined;
  if (topic0 === TRANSFER_TOPIC0) {
    if (topics.length === 3) return 'erc20';
    if (topics.length === 4) return 'erc721';
    return undefined;
  }
  if (
    (topic0 === TRANSFER_SINGLE_TOPIC0 || topic0 === TRANSFER_BATCH_TOPIC0)
    && topics.length === 4
  ) {
    return 'erc1155';
  }
  return undefined;
}

/**
 * Checksummed address from a 32-byte indexed topic: topics are left-padded
 * words, so the address is the trailing 20 bytes. Throws when the slice is
 * not a valid address (short topic, non-hex bytes…).
 */
function topicAddress(topic: string): string {
  return getAddress(`0x${topic.slice(-40)}`);
}

/** Decimal string of a single 32-byte ABI word; throws on malformed hex. */
function decodeUint256Word(hex: string): string {
  if (!UINT256_WORD.test(hex)) throw new Error('expected a single 32-byte ABI word');
  return BigInt(hex).toString();
}

/** Decimal strings of two consecutive 32-byte ABI words; throws on bad hex. */
function decodeUint256WordPair(hex: string): [string, string] {
  if (!UINT256_WORD_PAIR.test(hex)) throw new Error('expected two 32-byte ABI words');
  return [BigInt(hex.slice(0, 66)).toString(), BigInt(`0x${hex.slice(66)}`).toString()];
}

/**
 * Decode one log against the Transfer topic0 whitelist. Returns null for
 * topic0 values outside the whitelist (or the wrong topic count for the
 * shared ERC-20/721 selector); throws on malformed topics/data so the
 * caller can skip just this log.
 */
function decodeTransferLog(log: TransferLog): DecodedTokenTransfer | null {
  const topic0 = log.topics[0]?.toLowerCase();
  if (topic0 === undefined) return null;

  if (topic0 === TRANSFER_TOPIC0) {
    // Four topics → ERC-721 (tokenId is the fourth); three → ERC-20 (the
    // value lives in the single data word). ERC-721 data is empty.
    if (log.topics.length === 4) {
      return {
        kind: 'erc721',
        token: getAddress(log.address),
        from: topicAddress(log.topics[1]),
        to: topicAddress(log.topics[2]),
        tokenId: decodeUint256Word(log.topics[3]),
      };
    }
    if (log.topics.length === 3) {
      return {
        kind: 'erc20',
        token: getAddress(log.address),
        from: topicAddress(log.topics[1]),
        to: topicAddress(log.topics[2]),
        value: decodeUint256Word(log.data),
      };
    }
    return null;
  }

  if (topic0 === TRANSFER_SINGLE_TOPIC0) {
    if (log.topics.length !== 4) return null;
    // topics[1] is the operator, which the decoded output does not carry.
    const [id, amount] = decodeUint256WordPair(log.data);
    return {
      kind: 'erc1155_single',
      token: getAddress(log.address),
      from: topicAddress(log.topics[2]),
      to: topicAddress(log.topics[3]),
      id,
      amount,
    };
  }

  if (topic0 === TRANSFER_BATCH_TOPIC0) {
    if (log.topics.length !== 4) return null;
    // The two dynamic arrays (ids, values) are ABI-offset-encoded in data.
    const [ids, amounts] = decodeAbiParameters(
      parseAbiParameters('uint256[], uint256[]'),
      log.data as Hex,
    );
    if (ids.length !== amounts.length) throw new Error('ERC-1155 batch arrays disagree in length');
    return {
      kind: 'erc1155_batch',
      token: getAddress(log.address),
      from: topicAddress(log.topics[2]),
      to: topicAddress(log.topics[3]),
      ids: ids.map((id) => id.toString()),
      amounts: amounts.map((amount) => amount.toString()),
    };
  }

  return null;
}

/**
 * Extract every ERC-20/721/1155 Transfer from a receipt-style log list.
 * Classification is a topic0 whitelist; anything else is ignored, not an
 * error. A malformed log (bad hex, truncated data, wrong topic count,
 * non-address topic) is skipped without throwing — the rest of the list
 * still decodes, and input order is preserved. Zero-value transfers and
 * zero-address (mint/burn) parties are legitimate and kept.
 */
export function decodeTokenTransfersFromLogs(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
): DecodedTokenTransfer[] {
  const transfers: DecodedTokenTransfer[] = [];
  for (const log of logs) {
    try {
      const decoded = decodeTransferLog(log);
      if (decoded !== null) transfers.push(decoded);
    } catch {
      // Malformed log — skip it; the remaining logs still decode.
    }
  }
  return transfers;
}
