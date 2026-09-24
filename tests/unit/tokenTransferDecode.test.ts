import { describe, it, expect } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from 'viem';
import {
  decodeTokenTransfersFromLogs,
  transferStandardFromTopics,
} from '@/utils/tokenTransferDecode';

// Addresses are derived through getAddress so the expected checksummed
// forms below are viem's, not hand-transcribed ones.
const TOKEN = getAddress('0x5fbdb2315678afecb367f032d93f642f64180aa3');
const SENDER = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
const RECIPIENT = getAddress('0x70997970c51812dc3a010c7d01b50e0d17dc79c8');
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
const ERC20_VALUE = 1234500000000000000n; // 1.2345 tokens at 18 decimals

const erc20TransferAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);
const erc721TransferAbi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);
const erc1155SingleAbi = parseAbi([
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
]);
const erc1155BatchAbi = parseAbi([
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
]);

// encodeEventTopics returns a loose tuple (indexed array/struct topics may be
// null); every event here only indexes addresses and uints, so widen to a
// plain string list matching the receipt-log input shape.
function topicsOf(parameters: Parameters<typeof encodeEventTopics>[0]): string[] {
  return encodeEventTopics(parameters) as string[];
}

// Log builders mirror receipt shape. The token address is lowercase on
// purpose — the decoder must checksum it in the output.
const erc20Log = (from: Hex, to: Hex, value: bigint) => ({
  address: TOKEN.toLowerCase(),
  topics: topicsOf({ abi: erc20TransferAbi, eventName: 'Transfer', args: { from, to } }),
  data: encodeAbiParameters([{ type: 'uint256' }], [value]),
});

const erc721Log = (from: Hex, to: Hex, tokenId: bigint) => ({
  address: TOKEN.toLowerCase(),
  topics: topicsOf({
    abi: erc721TransferAbi,
    eventName: 'Transfer',
    args: { from, to, tokenId },
  }),
  data: '0x',
});

const erc1155SingleLog = (from: Hex, to: Hex, id: bigint, value: bigint) => ({
  address: TOKEN.toLowerCase(),
  topics: topicsOf({
    abi: erc1155SingleAbi,
    eventName: 'TransferSingle',
    args: { operator: SENDER, from, to },
  }),
  data: encodeAbiParameters(parseAbiParameters('uint256, uint256'), [id, value]),
});

const erc1155BatchLog = (from: Hex, to: Hex, ids: readonly bigint[], values: readonly bigint[]) => ({
  address: TOKEN.toLowerCase(),
  topics: topicsOf({
    abi: erc1155BatchAbi,
    eventName: 'TransferBatch',
    args: { operator: SENDER, from, to },
  }),
  data: encodeAbiParameters(parseAbiParameters('uint256[], uint256[]'), [ids, values]),
});

// A left-padded 32-byte word body (no 0x), for hand-rolling malformed data.
const wordBody = (value: bigint): string => value.toString(16).padStart(64, '0');

describe('decodeTokenTransfersFromLogs', () => {
  it('returns an empty array for an empty log list', () => {
    expect(decodeTokenTransfersFromLogs([])).toEqual([]);
  });

  it('decodes an ERC-20 Transfer (3 topics, value word in data) with a decimal amount', () => {
    const decoded = decodeTokenTransfersFromLogs([erc20Log(SENDER, RECIPIENT, ERC20_VALUE)]);
    expect(decoded).toEqual([
      { kind: 'erc20', token: TOKEN, from: SENDER, to: RECIPIENT, value: '1234500000000000000' },
    ]);
  });

  it('keeps zero-value ERC-20 transfers and zero-address mint/burn parties', () => {
    const decoded = decodeTokenTransfersFromLogs([erc20Log(ZERO_ADDRESS, RECIPIENT, 0n)]);
    expect(decoded).toEqual([
      { kind: 'erc20', token: TOKEN, from: ZERO_ADDRESS, to: RECIPIENT, value: '0' },
    ]);
  });

  it('decodes an ERC-721 Transfer (4 topics, empty data) with the tokenId from topics[3]', () => {
    const tokenId = 2n ** 128n + 1n; // deliberately beyond Number.MAX_SAFE_INTEGER
    const decoded = decodeTokenTransfersFromLogs([erc721Log(SENDER, RECIPIENT, tokenId)]);
    expect(decoded).toEqual([
      { kind: 'erc721', token: TOKEN, from: SENDER, to: RECIPIENT, tokenId: '340282366920938463463374607431768211457' },
    ]);
  });

  it('decodes an ERC-1155 TransferSingle from its two data words', () => {
    const decoded = decodeTokenTransfersFromLogs([erc1155SingleLog(SENDER, RECIPIENT, 7n, 10n)]);
    expect(decoded).toEqual([
      { kind: 'erc1155_single', token: TOKEN, from: SENDER, to: RECIPIENT, id: '7', amount: '10' },
    ]);
  });

  it('decodes an ERC-1155 TransferBatch into paired, order-preserving arrays', () => {
    const decoded = decodeTokenTransfersFromLogs([
      erc1155BatchLog(SENDER, RECIPIENT, [7n, 9n], [10n, 20n]),
    ]);
    expect(decoded).toEqual([
      { kind: 'erc1155_batch', token: TOKEN, from: SENDER, to: RECIPIENT, ids: ['7', '9'], amounts: ['10', '20'] },
    ]);
  });

  it('ignores logs with an unknown topic0 and anonymous logs without topics', () => {
    const unknownTopic = { address: TOKEN, topics: [`0x${'ab'.repeat(32)}`], data: '0x' };
    const anonymous = {
      address: TOKEN,
      topics: [],
      data: encodeAbiParameters([{ type: 'uint256' }], [1n]),
    };
    expect(decodeTokenTransfersFromLogs([unknownTopic, anonymous])).toEqual([]);
  });

  it('skips malformed logs without throwing while valid neighbours still decode', () => {
    const validTopics = topicsOf({
      abi: erc20TransferAbi,
      eventName: 'Transfer',
      args: { from: SENDER, to: RECIPIENT },
    });
    const truncatedData = encodeAbiParameters([{ type: 'uint256' }], [ERC20_VALUE]).slice(0, -2); // 31 bytes
    const nonHexData = `0x${'zz'.repeat(32)}`;
    const shortAddressTopic = [validTopics[0], '0x1234', validTopics[2]]; // topics[1] not 20-byte-extractable
    // 5 topics: neither the 3-topic ERC-20 nor the 4-topic ERC-721 shape.
    const wrongTopicCount = [...validTopics, validTopics[0], validTopics[0]];
    // Offsets claim the second array starts at byte 1024, far past the end.
    const firstArrayOnly = encodeAbiParameters([{ type: 'uint256[]' }], [[7n]]).slice(2);
    const lyingBatchData = `0x${wordBody(64n)}${wordBody(1024n)}${firstArrayOnly}`;

    const decoded = decodeTokenTransfersFromLogs([
      erc20Log(SENDER, RECIPIENT, ERC20_VALUE),
      { address: TOKEN, topics: validTopics, data: truncatedData },
      { address: TOKEN, topics: validTopics, data: nonHexData },
      { address: TOKEN, topics: shortAddressTopic, data: encodeAbiParameters([{ type: 'uint256' }], [1n]) },
      { address: TOKEN, topics: wrongTopicCount, data: encodeAbiParameters([{ type: 'uint256' }], [1n]) },
      { address: TOKEN, topics: erc1155BatchLog(SENDER, RECIPIENT, [7n], [10n]).topics, data: lyingBatchData },
      erc1155SingleLog(SENDER, RECIPIENT, 7n, 10n),
    ]);

    expect(decoded).toEqual([
      { kind: 'erc20', token: TOKEN, from: SENDER, to: RECIPIENT, value: '1234500000000000000' },
      { kind: 'erc1155_single', token: TOKEN, from: SENDER, to: RECIPIENT, id: '7', amount: '10' },
    ]);
  });

  it('preserves input order across a mixed list', () => {
    const decoded = decodeTokenTransfersFromLogs([
      erc20Log(SENDER, RECIPIENT, 1n),
      erc1155BatchLog(RECIPIENT, SENDER, [1n], [2n]),
      erc721Log(RECIPIENT, SENDER, 3n),
      erc1155SingleLog(SENDER, RECIPIENT, 4n, 5n),
      { address: TOKEN, topics: [`0x${'ee'.repeat(32)}`], data: '0x' }, // ignored tail
    ]);
    expect(decoded.map((transfer) => transfer.kind)).toEqual([
      'erc20',
      'erc1155_batch',
      'erc721',
      'erc1155_single',
    ]);
    expect(decoded[1].from).toBe(RECIPIENT); // batch keeps its own from/to
  });
});

describe('transferStandardFromTopics', () => {
  // Same fixture family as the decoder cases above: real viem-encoded
  // topic vectors, so the shapes pinned here are the wire shapes.
  it('splits the shared Transfer selector by indexed-topic count', () => {
    expect(transferStandardFromTopics(erc20Log(SENDER, RECIPIENT, 1n).topics)).toBe('erc20');
    expect(transferStandardFromTopics(erc721Log(SENDER, RECIPIENT, 3n).topics)).toBe('erc721');
  });

  it('classifies both ERC-1155 selector shapes as erc1155', () => {
    expect(transferStandardFromTopics(erc1155SingleLog(SENDER, RECIPIENT, 4n, 5n).topics)).toBe('erc1155');
    expect(transferStandardFromTopics(erc1155BatchLog(SENDER, RECIPIENT, [1n], [2n]).topics)).toBe('erc1155');
  });

  it('returns undefined for unknown topic0 values and topicless logs', () => {
    expect(transferStandardFromTopics([`0x${'ab'.repeat(32)}`])).toBeUndefined();
    expect(transferStandardFromTopics([])).toBeUndefined();
  });

  it('returns undefined for nonstandard topic counts on known selectors', () => {
    const transferTopics = topicsOf({
      abi: erc20TransferAbi,
      eventName: 'Transfer',
      args: { from: SENDER, to: RECIPIENT },
    });
    // Five topics: neither the 3-topic ERC-20 nor the 4-topic ERC-721 shape.
    expect(
      transferStandardFromTopics([...transferTopics, transferTopics[0], transferTopics[0]]),
    ).toBeUndefined();
    // TransferSingle missing its operator slot (3 topics, not 4).
    const singleTopics = topicsOf({
      abi: erc1155SingleAbi,
      eventName: 'TransferSingle',
      args: { operator: SENDER, from: SENDER, to: RECIPIENT },
    });
    expect(transferStandardFromTopics(singleTopics.slice(1))).toBeUndefined();
  });

  it('tolerates a mixed-case topic0 like the decoder does', () => {
    const topics = erc20Log(SENDER, RECIPIENT, 1n).topics;
    expect(transferStandardFromTopics([topics[0].toUpperCase(), ...topics.slice(1)])).toBe('erc20');
  });
});
