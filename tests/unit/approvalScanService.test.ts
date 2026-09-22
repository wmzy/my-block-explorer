// ApprovalScanService contract tests: distinct-pair derivation from
// owner-filtered Approval logs, the 100-pair allowance-read cap with
// honest truncation totals, Multicall3 batching, the ~60s scan cache with
// refresh bypass and first-scan scannedAt, and the adaptive chunk sweep —
// whose provider-ceiling behavior reuses TokenTransferService's shared
// isRetryableChunkError classification (asserted here by CONFIGURATION:
// an injected provider error that the shared classifier calls retryable
// halves the chunk, one it calls fatal aborts with 'scan-failed').
import { describe, it, expect } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc20Abi,
  pad,
  parseAbiParameters,
  type Address,
  type Hex,
} from 'viem';
import {
  createApprovalScanService,
  MAX_APPROVAL_PAIRS,
  type ApprovalLogsArgs,
  type ApprovalScanClient,
  type ApprovalsResult,
  type MulticallContractCall,
  type ScanLog,
} from '@/services/ApprovalScanService';

const OWNER = '0xAbC1111111111111111111111111111111111111' as Address;
const SPENDER_A = '0xDeF2222222222222222222222222222222222222' as Address;
const SPENDER_B = '0x3333333333333333333333333333333333333333' as Address;
const TOKEN_A = '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD' as Address;
const TOKEN_B = '0xB0B0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0' as Address;

const APPROVAL_TOPIC = encodeEventTopics({ abi: erc20Abi, eventName: 'Approval' })[0];

// On-chain topics carry the lowercase address bytes.
const topicAddress = (address: Address): Hex => pad(address.toLowerCase() as Address, { size: 32 });

const logOf = (
  token: Address,
  owner: Address,
  spender: Address,
  value: bigint,
  blockNumber: number,
  logIndex: number,
): ScanLog => ({
  address: token,
  topics: [APPROVAL_TOPIC, topicAddress(owner), topicAddress(spender)],
  data: encodeAbiParameters(parseAbiParameters('uint256'), [value]),
  blockNumber: BigInt(blockNumber),
  transactionHash: `0x${blockNumber.toString(16).padStart(64, '0')}`,
  logIndex,
});

// Mirrors viem's event+args filtering: topic0 from the Approval signature
// the query carries, and the indexed owner pinned into topic1.
const matchesFilter = (log: ScanLog, args: ApprovalLogsArgs): boolean => {
  if (log.topics[0] !== APPROVAL_TOPIC) return false;
  if (args.args?.owner !== undefined && log.topics[1] !== topicAddress(args.args.owner)) {
    return false;
  }
  return log.blockNumber !== null && log.blockNumber >= args.fromBlock && log.blockNumber <= args.toBlock;
};

type HarnessOptions = {
  logs?: ScanLog[];
  latest?: bigint;
  maxScanCalls?: number;
  // Reject any getLogs whose block range exceeds this many blocks with a
  // provider-shaped "range too large" error (retryable per the shared
  // classifier).
  rejectRangeAbove?: bigint;
  // Throw this NON-retryable error from getLogs after N successful calls.
  failAfter?: number;
  failError?: Error;
  // Pair key `token:spender` (lowercase) → current allowance; null marks
  // a reverted allowance() call; unlisted pairs read 1_000_000n.
  allowances?: Map<string, bigint | null>;
  // Transport-level failure of every multicall.
  multicallError?: Error;
};

// Builds a service wired to an in-memory client that mirrors eth_getLogs
// filtering and Multicall3 allowance reads over the given fixtures. The
// clock starts frozen at 0 and is mutable for cache tests.
const makeHarness = (options: HarnessOptions = {}) => {
  let t = 0;
  const getLogsCalls: ApprovalLogsArgs[] = [];
  let rejections = 0;
  let successes = 0;
  const multicallCalls: { contracts: readonly MulticallContractCall[] }[] = [];
  let successfulChunkMax = 0n;

  const client: ApprovalScanClient = {
    getBlockNumber: async () => options.latest ?? 10_000n,
    getLogs: async (args) => {
      if (options.rejectRangeAbove !== undefined && args.toBlock - args.fromBlock + 1n > options.rejectRangeAbove) {
        rejections += 1;
        throw new Error(
          `block range too large: ${args.toBlock - args.fromBlock + 1n} blocks exceeds provider limit`,
        );
      }
      if (options.failAfter !== undefined && successes >= options.failAfter) {
        throw options.failError ?? new Error('invalid request: nonsense');
      }
      successes += 1;
      getLogsCalls.push(args);
      successfulChunkMax = successfulChunkMax > args.toBlock - args.fromBlock + 1n
        ? successfulChunkMax
        : args.toBlock - args.fromBlock + 1n;
      return (options.logs ?? []).filter((log) => matchesFilter(log, args));
    },
    multicall: async (args) => {
      if (options.multicallError !== undefined) throw options.multicallError;
      multicallCalls.push({ contracts: args.contracts });
      return args.contracts.map((contract) => {
        const spender = String(contract.args[1] ?? '').toLowerCase();
        const key = `${contract.address.toLowerCase()}:${spender}`;
        const value = options.allowances?.get(key);
        if (value === null) {
          return { status: 'failure', error: new Error('execution reverted') };
        }
        return { status: 'success', result: value ?? 1_000_000n };
      });
    },
  };

  const service = createApprovalScanService({
    rpcManager: { getClient: async () => client },
    now: () => t,
    maxScanCalls: options.maxScanCalls ?? 1_000_000,
  });

  return {
    service,
    getLogsCalls,
    multicallCalls,
    counts: {
      get rejections() { return rejections; },
      get successes() { return successes; },
      get successfulChunkMax() { return successfulChunkMax; },
    },
    setNow: (next: number) => { t = next; },
  };
};

const pairKey = (token: Address, spender: Address): string =>
  `${token.toLowerCase()}:${spender.toLowerCase()}`;

describe('ApprovalScanService - distinct pair derivation', () => {
  it('derives distinct (token, spender) pairs, newest-first, and reads each allowance once', async () => {
    const { service, multicallCalls } = makeHarness({
      logs: [
        // Same pair twice (blocks 20 and 10) → one pair, ordered by its
        // NEWEST sighting.
        logOf(TOKEN_A, OWNER, SPENDER_A, 5n, 20, 0),
        logOf(TOKEN_A, OWNER, SPENDER_A, 3n, 10, 1),
        logOf(TOKEN_A, OWNER, SPENDER_B, 7n, 15, 2),
        logOf(TOKEN_B, OWNER, SPENDER_A, 9n, 12, 3),
        // Different owner → filtered out by the topic slot entirely.
        logOf(TOKEN_A, SPENDER_B, SPENDER_A, 11n, 18, 4),
      ],
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.coverage).toBe('complete');
    expect(result.windowBlocks).toBe(100_000);
    expect(result.pairCount).toBe(3);
    expect(result.truncated).toBe(false);
    // Newest first: SPENDER_A on TOKEN_A (block 20), then SPENDER_B
    // (block 15), then TOKEN_B (block 12).
    expect(result.approvals.map((row) => `${row.token}:${row.spender}`)).toEqual([
      pairKey(TOKEN_A, SPENDER_A),
      pairKey(TOKEN_A, SPENDER_B),
      pairKey(TOKEN_B, SPENDER_A),
    ]);
    // One aggregated read per pair — all three in the single first batch.
    expect(multicallCalls).toHaveLength(1);
    expect(multicallCalls[0]?.contracts).toHaveLength(3);
    expect(result.approvals.every((row) => row.allowance === '1000000')).toBe(true);
  });

  it('omits zero grants and flags effectively-unlimited allowances as isMax', async () => {
    const { service } = makeHarness({
      logs: [
        logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 40, 0),
        logOf(TOKEN_A, OWNER, SPENDER_B, 1n, 30, 1),
        logOf(TOKEN_B, OWNER, SPENDER_A, 1n, 20, 2),
        logOf(TOKEN_B, OWNER, SPENDER_B, 1n, 10, 3),
      ],
      allowances: new Map<string, bigint | null>([
        // Revoked to zero → omitted from rows, still counted in pairCount.
        [pairKey(TOKEN_A, SPENDER_A), 0n],
        // Max-uint sentinel → Max.
        [pairKey(TOKEN_A, SPENDER_B), 2n ** 256n - 1n],
        // The common "unlimited" convention (>= 2^128) → Max.
        [pairKey(TOKEN_B, SPENDER_A), 2n ** 130n],
        // A plausible human amount → kept, not Max.
        [pairKey(TOKEN_B, SPENDER_B), 5n],
      ]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(4);
    const bySpender = new Map(result.approvals.map((row) => [row.spender, row]));
    expect(bySpender.has(SPENDER_A.toLowerCase())).toBe(true); // TOKEN_B row survived
    expect(result.approvals).toHaveLength(3);
    expect(result.approvals.find((r) => r.token === TOKEN_A.toLowerCase())?.isMax).toBe(true);
    expect(result.approvals.find((r) => r.token === TOKEN_B.toLowerCase() && r.spender === SPENDER_A.toLowerCase())?.isMax).toBe(true);
    expect(result.approvals.find((r) => r.spender === SPENDER_B.toLowerCase() && r.token === TOKEN_B.toLowerCase())?.isMax).toBe(false);
    expect(result.approvals.every((row) => /^\d+$/.test(row.allowance))).toBe(true);
  });

  it('drops pairs whose allowance() reverts without failing the response', async () => {
    const { service } = makeHarness({
      logs: [
        logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 20, 0),
        logOf(TOKEN_A, OWNER, SPENDER_B, 1n, 10, 1),
      ],
      allowances: new Map<string, bigint | null>([
        // Non-standard token: allowance() reverts.
        [pairKey(TOKEN_A, SPENDER_A), null],
      ]),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.pairCount).toBe(2);
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]?.spender).toBe(SPENDER_B.toLowerCase());
    expect(result.reason).toBeUndefined();
  });
});

describe('ApprovalScanService - read cap and truncation', () => {
  // 130 distinct pairs, one per block (1..130): block number doubles as
  // the recency ordering, so the cap keeps blocks 130..31.
  const manyPairs = (): ScanLog[] =>
    Array.from({ length: 130 }, (_, i) =>
      logOf(
        `0x${(0x1000 + i).toString(16).padStart(40, '0')}`,
        OWNER,
        `0x${(0x2000 + i).toString(16).padStart(40, '0')}`,
        1n,
        i + 1,
        i,
      ),
    );

  it('caps allowance reads at 100 newest pairs in batches of 50 and reports honest totals', async () => {
    const { service, multicallCalls } = makeHarness({ logs: manyPairs() });

    const result = await service.getApprovals(1, OWNER);

    expect(MAX_APPROVAL_PAIRS).toBe(100);
    expect(result.pairCount).toBe(130);
    expect(result.truncated).toBe(true);
    expect(result.approvals).toHaveLength(100);
    // Batching: two multicalls of 50, newest pair first.
    expect(multicallCalls).toHaveLength(2);
    expect(multicallCalls[0]?.contracts).toHaveLength(50);
    expect(multicallCalls[1]?.contracts).toHaveLength(50);
    const firstToken = multicallCalls[0]?.contracts[0]?.address.toLowerCase();
    expect(firstToken).toBe(`0x${(0x1000 + 129).toString(16).padStart(40, '0')}`);
    // Blocks 130..31 (pairs 129..30) were read; the 30 oldest were not.
    const readTokens = new Set(
      multicallCalls.flatMap((call) => call.contracts.map((c) => c.address.toLowerCase())),
    );
    expect(readTokens.has(`0x${(0x1000 + 30).toString(16).padStart(40, '0')}`)).toBe(true);
    expect(readTokens.has(`0x${(0x1000 + 29).toString(16).padStart(40, '0')}`)).toBe(false);
  });
});

describe('ApprovalScanService - adaptive chunk sizing (shared classification)', () => {
  it('halves on provider range caps, stays under the learned ceiling, and still completes', async () => {
    // Provider rejects any range above 4_000 blocks. The initial 5_000
    // chunk is rejected (retryable per the SHARED classifier), halves to
    // 2_500, and growth after clean chunks stays under the learned
    // provider ceiling — without that memory the chunk would oscillate
    // back up and burn the default 40-call budget before covering the
    // window.
    const { service, counts } = makeHarness({
      logs: [logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 9_999, 0)],
      rejectRangeAbove: 4_000n,
      maxScanCalls: 40,
    });

    const result = await service.getApprovals(1, OWNER);

    expect(counts.rejections).toBeGreaterThan(0);
    expect(counts.successfulChunkMax).toBeLessThanOrEqual(4_000n);
    expect(result.coverage).toBe('complete');
    expect(result.pairCount).toBe(1);
  });

  it('aborts with scan-failed on a NON-retryable provider error, keeping earlier finds', async () => {
    const { service } = makeHarness({
      logs: [logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 9_999, 0)],
      // First chunk succeeds (finds the log), the second call hits a
      // fatal provider error — not range-shaped, so the shared
      // classifier must NOT retry it.
      failAfter: 1,
      failError: new Error('invalid request: nonsense'),
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.coverage).toBe('scan-failed');
    expect(result.pairCount).toBe(1);
    expect(result.approvals).toHaveLength(1);
    expect(result.approvals[0]?.token).toBe(TOKEN_A.toLowerCase());
  });

  it('reports partial when the call budget runs out mid-window', async () => {
    const { service } = makeHarness({
      latest: 1_000_000n,
      maxScanCalls: 2,
    });

    const result = await service.getApprovals(1, OWNER);

    expect(result.coverage).toBe('partial');
    expect(result.pairCount).toBe(0);
  });
});

describe('ApprovalScanService - scan cache and refresh', () => {
  it('serves a ~60s cache and keeps reporting the FIRST scan time', async () => {
    const { service, getLogsCalls, setNow } = makeHarness({
      logs: [logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 100, 0)],
    });

    const first = await service.getApprovals(1, OWNER);
    setNow(1_000);
    const cached = await service.getApprovals(1, OWNER);

    expect(cached.scannedAt).toBe(first.scannedAt);
    expect(cached.scannedAt).toBe(new Date(0).toISOString());
    // No re-scan on the cache hit.
    expect(getLogsCalls.length).toBeGreaterThan(0);
    const callsAfterHit = getLogsCalls.length;

    // Past the TTL the entry is gone: a new scan with a new scannedAt.
    setNow(61_000);
    const rescanned = await service.getApprovals(1, OWNER);
    expect(rescanned.scannedAt).toBe(new Date(61_000).toISOString());
    expect(getLogsCalls.length).toBeGreaterThan(callsAfterHit);
  });

  it('refresh=1 bypasses a fresh entry and overwrites it (new first-scan time)', async () => {
    const { service, getLogsCalls, setNow } = makeHarness({
      logs: [logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 100, 0)],
    });

    await service.getApprovals(1, OWNER);
    const callsAfterFirst = getLogsCalls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    setNow(5_000);
    const refreshed = await service.getApprovals(1, OWNER, undefined, true);
    expect(getLogsCalls.length).toBeGreaterThan(callsAfterFirst);
    expect(refreshed.scannedAt).toBe(new Date(5_000).toISOString());

    // The overwrite is now the served entry: same scannedAt, no rescan.
    const served = await service.getApprovals(1, OWNER);
    const callsAfterRefresh = getLogsCalls.length;
    expect(served.scannedAt).toBe(refreshed.scannedAt);
    expect(getLogsCalls.length).toBe(callsAfterRefresh);
  });

  it('keys the cache by (chain, address, window) and clamps the window', async () => {
    const { service, getLogsCalls } = makeHarness({
      logs: [logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 100, 0)],
    });

    const clampedLow = await service.getApprovals(1, OWNER, 0);
    expect(clampedLow.windowBlocks).toBe(1);
    const clampedHigh = await service.getApprovals(1, OWNER, 999_999_999);
    expect(clampedHigh.windowBlocks).toBe(50_000_000);

    // Different window → different cache key → a fresh scan; same window
    // again → served from the entry written by that scan.
    const callsAfterClamps = getLogsCalls.length;
    const again = await service.getApprovals(1, OWNER, 999_999_999);
    expect(again.windowBlocks).toBe(50_000_000);
    expect(getLogsCalls.length).toBe(callsAfterClamps);
  });
});

describe('ApprovalScanService - allowance read honesty', () => {
  it('reports allowance-read-failed when the multicall transport fails', async () => {
    const { service } = makeHarness({
      logs: [logOf(TOKEN_A, OWNER, SPENDER_A, 1n, 100, 0)],
      multicallError: new Error('fetch failed'),
    });

    const result: ApprovalsResult = await service.getApprovals(1, OWNER);

    expect(result.coverage).toBe('complete');
    expect(result.pairCount).toBe(1);
    expect(result.approvals).toEqual([]);
    expect(result.reason).toBe('allowance-read-failed');
  });
});
