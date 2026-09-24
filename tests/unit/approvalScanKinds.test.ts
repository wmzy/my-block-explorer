// Approval-kind coverage: the pure topic-vector classifier (topic0 names
// the event family; indexed-topic count splits the ERC-20/ERC-721 Approval
// signature collision), and the service-level flow for the NFT kinds —
// ERC-1155 (token, operator) pairs read via isApprovedForAll and ERC-721
// (token, spender, tokenId) triples read via getApproved — including the
// honest drops (unapproved / reverted reads) and mixed-kind Multicall3
// batching. ERC-20 semantics stay pinned by approvalScanService.test.ts.
import { describe, it, expect } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  erc1155Abi,
  numberToHex,
  parseAbiParameters,
  pad,
  type Address,
  type Hex,
} from 'viem';
import {
  classifyApprovalTopics,
  createApprovalScanService,
  type ApprovalLogsArgs,
  type ApprovalScanClient,
  type MulticallContractCall,
  type ScanLog,
} from '@/services/ApprovalScanService';

const OWNER = '0xAbC1111111111111111111111111111111111111' as Address;
const SPENDER_A = '0xDeF2222222222222222222222222222222222222' as Address;
const OPERATOR_B = '0x3333333333333333333333333333333333333333' as Address;
const TOKEN_NFT = '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD' as Address;
const TOKEN_20 = '0xB0B0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0' as Address;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const APPROVAL_TOPIC = encodeEventTopics({ abi: erc20Abi, eventName: 'Approval' })[0];
const APPROVAL_FOR_ALL_TOPIC = encodeEventTopics({
  abi: erc1155Abi,
  eventName: 'ApprovalForAll',
})[0];
// ERC-721 Approval shares the ERC-20 signature hash by construction.
const ERC721_APPROVAL_TOPIC = APPROVAL_TOPIC;

// On-chain topics carry the lowercase address bytes. (The cast is needed
// by tsc — pad wants a 0x-template — and not flagged by eslint.)
const topicAddress = (address: Address): Hex => pad(address.toLowerCase() as Address, { size: 32 });

const txHashOf = (block: number): Hex =>
  `0x${block.toString(16).padStart(64, '0')}`;

const erc20Log = (
  token: Address,
  owner: Address,
  spender: Address,
  value: bigint,
  block: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [APPROVAL_TOPIC, topicAddress(owner), topicAddress(spender)],
  data: encodeAbiParameters(parseAbiParameters('uint256'), [value]),
  blockNumber: BigInt(block),
  transactionHash: txHashOf(block),
  logIndex,
});

// ERC-721 Approval: owner, approved AND tokenId are all indexed → 4 topics.
const erc721Log = (
  token: Address,
  owner: Address,
  approved: Address,
  tokenId: bigint,
  block: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [
    ERC721_APPROVAL_TOPIC,
    topicAddress(owner),
    topicAddress(approved),
    numberToHex(tokenId, { size: 32 }),
  ],
  data: '0x',
  blockNumber: BigInt(block),
  transactionHash: txHashOf(block),
  logIndex,
});

// ERC-1155 ApprovalForAll: owner + operator indexed, the flag in data.
const erc1155Log = (
  token: Address,
  owner: Address,
  operator: Address,
  approved: boolean,
  block: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [APPROVAL_FOR_ALL_TOPIC, topicAddress(owner), topicAddress(operator)],
  data: encodeAbiParameters(parseAbiParameters('bool'), [approved]),
  blockNumber: BigInt(block),
  transactionHash: txHashOf(block),
  logIndex,
});

describe('classifyApprovalTopics - kind from (topic0, topic count)', () => {
  it('classifies the shared Approval topic0 by topic count: 3 = erc20, 4 = erc721', () => {
    const erc20 = classifyApprovalTopics([
      APPROVAL_TOPIC,
      topicAddress(OWNER),
      topicAddress(SPENDER_A),
    ]);
    // Byte-identical topic0 — only the topic count separates the kinds.
    expect(ERC721_APPROVAL_TOPIC).toBe(APPROVAL_TOPIC);
    const erc721 = classifyApprovalTopics([
      ERC721_APPROVAL_TOPIC,
      topicAddress(OWNER),
      topicAddress(SPENDER_A),
      numberToHex(4096n, { size: 32 }),
    ]);

    expect(erc20).toEqual({
      kind: 'erc20',
      owner: OWNER.toLowerCase(),
      spender: SPENDER_A.toLowerCase(),
    });
    expect(erc721).toEqual({
      kind: 'erc721',
      owner: OWNER.toLowerCase(),
      spender: SPENDER_A.toLowerCase(),
      tokenId: '4096',
    });
  });

  it('classifies ApprovalForAll by its own topic0 with 3 topics (operator in topic2)', () => {
    const classified = classifyApprovalTopics([
      APPROVAL_FOR_ALL_TOPIC,
      topicAddress(OWNER),
      topicAddress(OPERATOR_B),
    ]);
    expect(classified).toEqual({
      kind: 'erc1155',
      owner: OWNER.toLowerCase(),
      spender: OPERATOR_B.toLowerCase(),
    });
  });

  it('rejects wrong topic counts for each family', () => {
    // 4 topics under ApprovalForAll's topic0 → not a 1155 shape.
    expect(
      classifyApprovalTopics([
        APPROVAL_FOR_ALL_TOPIC,
        topicAddress(OWNER),
        topicAddress(OPERATOR_B),
        numberToHex(1n, { size: 32 }),
      ]),
    ).toBeNull();
    // 5 topics under the Approval topic0 → not a known shape.
    expect(
      classifyApprovalTopics([
        APPROVAL_TOPIC,
        topicAddress(OWNER),
        topicAddress(SPENDER_A),
        numberToHex(1n, { size: 32 }),
        numberToHex(2n, { size: 32 }),
      ]),
    ).toBeNull();
  });

  it('rejects foreign topic0 and malformed topic shapes without throwing', () => {
    const transferTopic = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer' })[0];
    expect(
      classifyApprovalTopics([transferTopic, topicAddress(OWNER), topicAddress(SPENDER_A)]),
    ).toBeNull();
    // Not a 32-byte topic.
    expect(classifyApprovalTopics(['0xdeadbeef'])).toBeNull();
    expect(classifyApprovalTopics([APPROVAL_TOPIC, '0x1234', topicAddress(SPENDER_A)])).toBeNull();
    // Missing owner/spender slots.
    expect(classifyApprovalTopics([APPROVAL_TOPIC])).toBeNull();
    expect(classifyApprovalTopics([])).toBeNull();
  });
});

// --- service-level harness -------------------------------------------------

type HarnessOptions = {
  logs?: ScanLog[];
  // `token:spender` (lowercase) → current ERC-20 allowance; null = revert;
  // unlisted pairs read 1_000_000n.
  allowances?: Map<string, bigint | null>;
  // `token:tokenId` → address getApproved returns; null = revert;
  // unlisted ids read the zero address (unapproved → dropped).
  approvedOf?: Map<string, Address | null>;
  // `token:operator` (lowercase) → isApprovedForAll; null = revert;
  // unlisted operators read true (approved).
  operatorApproved?: Map<string, boolean | null>;
};

// Mirrors the two owner-pinned eth_getLogs queries (event-decided topic0
// plus the pinned owner topic1) and the per-kind Multicall3 reads.
const makeHarness = (options: HarnessOptions = {}) => {
  const getLogsCalls: ApprovalLogsArgs[] = [];
  const multicallCalls: { contracts: readonly MulticallContractCall[] }[] = [];

  const client: ApprovalScanClient = {
    getBlockNumber: async () => 10_000n,
    getLogs: async (args) => {
      getLogsCalls.push(args);
      const topic0 = encodeEventTopics({ abi: [args.event], eventName: args.event.name })[0];
      return (options.logs ?? []).filter(
        (log) =>
          log.topics[0] === topic0 &&
          (args.args?.owner === undefined || log.topics[1] === topicAddress(args.args.owner)) &&
          log.blockNumber !== null &&
          log.blockNumber >= args.fromBlock &&
          log.blockNumber <= args.toBlock,
      );
    },
    multicall: async (args) => {
      multicallCalls.push({ contracts: args.contracts });
      return args.contracts.map((contract) => {
        if (contract.functionName === 'allowance') {
          const spender = String(contract.args[1] ?? '').toLowerCase();
          const value = options.allowances?.get(`${contract.address.toLowerCase()}:${spender}`);
          if (value === null) return { status: 'failure', error: new Error('reverted') };
          return { status: 'success', result: value ?? 1_000_000n };
        }
        if (contract.functionName === 'getApproved') {
          const tokenId = String(contract.args[0] ?? '');
          const value = options.approvedOf?.get(`${contract.address.toLowerCase()}:${tokenId}`);
          if (value === null) return { status: 'failure', error: new Error('reverted') };
          return { status: 'success', result: value ?? ZERO_ADDRESS };
        }
        // isApprovedForAll
        const operator = String(contract.args[1] ?? '').toLowerCase();
        const value = options.operatorApproved?.get(`${contract.address.toLowerCase()}:${operator}`);
        if (value === null) return { status: 'failure', error: new Error('reverted') };
        return { status: 'success', result: value ?? true };
      });
    },
  };

  const service = createApprovalScanService({
    rpcManager: { getClient: async () => client },
    now: () => 0,
    maxScanCalls: 1_000_000,
  });

  return { service, getLogsCalls, multicallCalls };
};

describe('ApprovalScanService - NFT kinds', () => {
  it('discovers erc1155 operator approvals and reads isApprovedForAll', async () => {
    const { service } = makeHarness({
      logs: [
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 20, 0),
        // A different owner's ApprovalForAll → filtered by the topic slot.
        erc1155Log(TOKEN_NFT, OPERATOR_B, OWNER, true, 25, 1),
      ],
      operatorApproved: new Map([[`${TOKEN_NFT.toLowerCase()}:${OPERATOR_B.toLowerCase()}`, true]]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(1);
    expect(result.approvals).toEqual([
      {
        kind: 'erc1155',
        token: TOKEN_NFT.toLowerCase(),
        spender: OPERATOR_B.toLowerCase(),
        allowance: '1',
        isMax: true,
      },
    ]);
  });

  it('drops erc1155 rows whose isApprovedForAll reads false or reverts (pairCount keeps them)', async () => {
    const { service } = makeHarness({
      logs: [
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 20, 0),
        erc1155Log(TOKEN_NFT, OWNER, SPENDER_A, true, 10, 1),
      ],
      operatorApproved: new Map<string, boolean | null>([
        [`${TOKEN_NFT.toLowerCase()}:${OPERATOR_B.toLowerCase()}`, false],
        [`${TOKEN_NFT.toLowerCase()}:${SPENDER_A.toLowerCase()}`, null],
      ]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(2);
    expect(result.approvals).toEqual([]);
  });

  it('discovers erc721 (token, spender, tokenId) triples via getApproved', async () => {
    const { service } = makeHarness({
      logs: [
        // Two distinct token ids for the same spender → two triples.
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 7n, 30, 0),
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 9n, 20, 1),
        // Re-approval of id 7 (older block) → same triple, deduped.
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 7n, 5, 2),
      ],
      approvedOf: new Map<string, Address | null>([
        [`${TOKEN_NFT.toLowerCase()}:7`, SPENDER_A],
        [`${TOKEN_NFT.toLowerCase()}:9`, SPENDER_A],
      ]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(2);
    // Newest triple first (id 7's newest sighting at block 30). The
    // allowance/isMax fields carry the documented 721 scope values ('1'
    // token granted, not Max).
    expect(result.approvals).toEqual([
      {
        kind: 'erc721',
        token: TOKEN_NFT.toLowerCase(),
        spender: SPENDER_A.toLowerCase(),
        tokenId: '7',
        allowance: '1',
        isMax: false,
      },
      {
        kind: 'erc721',
        token: TOKEN_NFT.toLowerCase(),
        spender: SPENDER_A.toLowerCase(),
        tokenId: '9',
        allowance: '1',
        isMax: false,
      },
    ]);
  });

  it('drops erc721 rows whose getApproved no longer names the spender (or reverts)', async () => {
    const { service } = makeHarness({
      logs: [
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 1n, 30, 0),
        erc721Log(TOKEN_NFT, OWNER, OPERATOR_B, 2n, 20, 1),
        erc721Log(TOKEN_NFT, OWNER, OPERATOR_B, 3n, 10, 2),
      ],
      approvedOf: new Map<string, Address | null>([
        // Revoked (zero address) → dropped.
        [`${TOKEN_NFT.toLowerCase()}:1`, ZERO_ADDRESS],
        // Re-assigned to another address → this spender's row is dead.
        [`${TOKEN_NFT.toLowerCase()}:2`, OWNER],
        // Non-standard token: getApproved reverts.
        [`${TOKEN_NFT.toLowerCase()}:3`, null],
      ]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(3);
    expect(result.approvals).toEqual([]);
  });

  it('scans all three kinds in one pass and batches mixed reads together, newest-first', async () => {
    const { service, getLogsCalls, multicallCalls } = makeHarness({
      logs: [
        erc20Log(TOKEN_20, OWNER, SPENDER_A, 1n, 10, 0),
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 5n, 20, 1),
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 30, 2),
        // Same token+spender as the erc20 pair, but a 721 triple → distinct.
        erc721Log(TOKEN_20, OWNER, SPENDER_A, 6n, 40, 3),
      ],
      approvedOf: new Map<string, Address | null>([
        [`${TOKEN_NFT.toLowerCase()}:5`, SPENDER_A],
        [`${TOKEN_20.toLowerCase()}:6`, SPENDER_A],
      ]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(4);
    expect(result.truncated).toBe(false);
    // Both event families were queried (two queries per chunk).
    const eventNames = new Set(getLogsCalls.map((call) => call.event.name));
    expect(eventNames).toEqual(new Set(['Approval', 'ApprovalForAll']));
    // One mixed batch carrying all three read shapes, newest pair first.
    expect(multicallCalls).toHaveLength(1);
    expect(multicallCalls[0]?.contracts.map((contract) => contract.functionName)).toEqual([
      'getApproved',
      'isApprovedForAll',
      'getApproved',
      'allowance',
    ]);
    // Rows ordered newest-first across kinds; kinds carried per row (NFT
    // rows carry the documented scope values, erc20 the exact amount).
    expect(result.approvals).toEqual([
      {
        kind: 'erc721',
        token: TOKEN_20.toLowerCase(),
        spender: SPENDER_A.toLowerCase(),
        tokenId: '6',
        allowance: '1',
        isMax: false,
      },
      {
        kind: 'erc1155',
        token: TOKEN_NFT.toLowerCase(),
        spender: OPERATOR_B.toLowerCase(),
        allowance: '1',
        isMax: true,
      },
      {
        kind: 'erc721',
        token: TOKEN_NFT.toLowerCase(),
        spender: SPENDER_A.toLowerCase(),
        tokenId: '5',
        allowance: '1',
        isMax: false,
      },
      {
        kind: 'erc20',
        token: TOKEN_20.toLowerCase(),
        spender: SPENDER_A.toLowerCase(),
        allowance: '1000000',
        isMax: false,
      },
    ]);
  });

  it('caps the reads across ALL kinds and reports the honest truncated totals', async () => {
    // 130 mixed pairs (65 tokens × one erc20 pair + one erc1155 operator
    // each), cap 100. Return-typed helper instead of a template-string
    // assertion (tsc needs the 0x-template, eslint flags the cast).
    const tokenAt = (index: number): Address => `0x${index.toString(16).padStart(40, '0')}`;
    const logs: ScanLog[] = [];
    for (let i = 0; i < 65; i += 1) {
      const token = tokenAt(0x3000 + i);
      logs.push(erc20Log(token, OWNER, SPENDER_A, 1n, i + 1, i * 2));
      logs.push(erc1155Log(token, OWNER, OPERATOR_B, true, i + 1, i * 2 + 1));
    }
    const { service, multicallCalls } = makeHarness({ logs });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(130);
    expect(result.truncated).toBe(true);
    expect(result.approvals).toHaveLength(100);
    expect(multicallCalls).toHaveLength(2);
    expect(multicallCalls[0]?.contracts).toHaveLength(50);
    expect(multicallCalls[1]?.contracts).toHaveLength(50);
  });
});
