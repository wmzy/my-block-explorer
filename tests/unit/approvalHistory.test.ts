// Approval-history retention: the SAME owner-pinned sweep that reduces
// logs to distinct pairs also retains the raw events as a bounded,
// newest-first timeline (cap 200 + historyTruncated flag). These pin the
// event projection — kind mapping straight from the topic vectors, the
// desc (block, logIndex) ordering across the two interleaved queries,
// the cap/truncate honesty, and null values for the NFT kinds — plus the
// revocation rule: an ApprovalForAll(false) log is a REVOCATION and is
// excluded (the wire shape cannot say "unapproved"), while an ERC-20
// value of '0' stays visible. Pair semantics stay pinned by
// approvalScanService.test.ts / approvalScanKinds.test.ts.
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
  createApprovalScanService,
  MAX_APPROVAL_HISTORY_EVENTS,
  type ApprovalScanClient,
  type ScanLog,
} from '@/services/ApprovalScanService';

const OWNER = '0xAbC1111111111111111111111111111111111111' as Address;
const SPENDER_A = '0xDeF2222222222222222222222222222222222222' as Address;
const OPERATOR_B = '0x3333333333333333333333333333333333333333' as Address;
const TOKEN_NFT = '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD' as Address;
const TOKEN_20 = '0xB0B0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0' as Address;

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

// --- harness (approvalScanKinds.test.ts shape) ------------------------------

type HarnessOptions = {
  logs?: ScanLog[];
};

// Mirrors the two owner-pinned eth_getLogs queries; the current-state
// multicall is irrelevant to history (it never feeds it) and reads
// permissive defaults so the pair side stays quiet.
const makeHarness = (options: HarnessOptions = {}) => {
  const client: ApprovalScanClient = {
    getBlockNumber: async () => 10_000n,
    getLogs: async (args) => {
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
    multicall: async (args) =>
      args.contracts.map(() => ({ status: 'success' as const, result: 1n })),
  };

  const service = createApprovalScanService({
    rpcManager: { getClient: async () => client },
    now: () => 0,
    maxScanCalls: 1_000_000,
  });

  return { service };
};

describe('ApprovalScanService - history events', () => {
  it('projects each swept log with its kind, event name and lowercase parties', async () => {
    const { service } = makeHarness({
      logs: [
        erc20Log(TOKEN_20, OWNER, SPENDER_A, 1_500_000_000_000_000_000n, 30, 0),
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 7n, 20, 1),
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 10, 2),
      ],
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.history).toHaveLength(3);
    // Kind and approvalEvent follow straight from the topic vectors: the
    // shared Approval topic0 by topic count, ApprovalForAll by its own.
    expect(result.history.map((event) => [event.kind, event.approvalEvent])).toEqual([
      ['erc20', 'Approval'],
      ['erc721', 'Approval'],
      ['erc1155', 'ApprovalForAll'],
    ]);
    // Wire contract: lowercase parties, raw token address, block and tx.
    expect(result.history[0]).toEqual({
      kind: 'erc20',
      approvalEvent: 'Approval',
      token: TOKEN_20.toLowerCase(),
      owner: OWNER.toLowerCase(),
      spender: SPENDER_A.toLowerCase(),
      blockNumber: 30,
      txHash: txHashOf(30),
      // BigInt-exact decimal string from the log's data word.
      value: '1500000000000000000',
    });
    expect(result.history[1]?.token).toBe(TOKEN_NFT.toLowerCase());
    expect(result.history[2]?.spender).toBe(OPERATOR_B.toLowerCase());
  });

  it('orders newest-first by (block, logIndex) — across the two interleaved queries', async () => {
    // Same block, both families: the higher logIndex leads regardless of
    // which query returned it; delivery order in the array is ascending
    // junk that must not survive.
    const { service } = makeHarness({
      logs: [
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 40, 0),
        erc20Log(TOKEN_20, OWNER, SPENDER_A, 5n, 40, 3),
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 9n, 40, 1),
        erc20Log(TOKEN_20, OWNER, SPENDER_A, 6n, 5, 0),
        // Block 6_500 lands in a NEWER chunk than 40 (chunks walk
        // newest-first over disjoint ranges): the chunk boundary must
        // not reorder events.
        erc20Log(TOKEN_20, OWNER, SPENDER_A, 7n, 6_500, 0),
      ],
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.history.map((event) => [event.blockNumber, event.kind])).toEqual([
      [6_500, 'erc20'],
      [40, 'erc20'],
      [40, 'erc721'],
      [40, 'erc1155'],
      [5, 'erc20'],
    ]);
  });

  it('caps the timeline at 200 newest events and flags the truncation honestly', async () => {
    // 230 same-pair grants: ONE distinct pair (the snapshot dedupes) but
    // 230 raw events (the timeline does not) — the cap keeps the newest
    // MAX_APPROVAL_HISTORY_EVENTS and says the rest were dropped.
    expect(MAX_APPROVAL_HISTORY_EVENTS).toBe(200);
    const logs: ScanLog[] = [];
    for (let i = 0; i < 230; i += 1) {
      logs.push(erc20Log(TOKEN_20, OWNER, SPENDER_A, BigInt(i + 1), i + 1, i));
    }
    const { service } = makeHarness({ logs });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(1);
    expect(result.history).toHaveLength(200);
    expect(result.historyTruncated).toBe(true);
    // Newest-first retention: the newest block leads and the oldest
    // events (blocks 1..30) are the dropped ones.
    expect(result.history[0]?.blockNumber).toBe(230);
    expect(result.history[0]?.value).toBe('230');
    expect(result.history.at(-1)?.blockNumber).toBe(31);
    // Under the cap: no flag, everything retained.
    const small = await makeHarness({ logs: logs.slice(0, 12) })
      .service.getApprovals(1, OWNER);
    expect(small.history).toHaveLength(12);
    expect(small.historyTruncated).toBe(false);
  });

  it('carries value only for ERC-20 — null for the NFT kinds, and never a guessed amount', async () => {
    const { service } = makeHarness({
      logs: [
        erc20Log(TOKEN_20, OWNER, SPENDER_A, 0n, 30, 0),
        erc721Log(TOKEN_NFT, OWNER, SPENDER_A, 7n, 20, 0),
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 10, 0),
        // Malformed ERC-20 data word: no honest amount exists → no event
        // (shape-level failure, not a guessed '0').
        {
          ...erc20Log(TOKEN_20, OWNER, OPERATOR_B, 1n, 5, 0),
          data: '0xdeadbeef',
        },
      ],
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.history.map((event) => [event.kind, event.value])).toEqual([
      // An ERC-20 revocation stays visible — value '0' IS the event.
      ['erc20', '0'],
      ['erc721', null],
      ['erc1155', null],
    ]);
  });

  it('excludes ApprovalForAll revocations — a false flag is never rendered as a grant', async () => {
    const { service } = makeHarness({
      logs: [
        erc1155Log(TOKEN_NFT, OWNER, OPERATOR_B, true, 30, 0),
        // approved=false: the pair is still DISCOVERED (the current-state
        // read sorts it out), but the timeline cannot represent a
        // revocation in its field set — excluded.
        erc1155Log(TOKEN_NFT, OWNER, SPENDER_A, false, 20, 0),
      ],
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(2);
    expect(result.history).toHaveLength(1);
    expect(result.history[0]?.spender).toBe(OPERATOR_B.toLowerCase());
  });

  it('serves the retained history from the scan cache unchanged', async () => {
    const { service } = makeHarness({
      logs: [erc20Log(TOKEN_20, OWNER, SPENDER_A, 42n, 30, 0)],
    });

    const first = await service.getApprovals(1, OWNER);
    const cached = await service.getApprovals(1, OWNER);

    expect(cached.history).toEqual(first.history);
    expect(cached.historyTruncated).toBe(false);
    expect(cached.history[0]?.value).toBe('42');
  });
});
