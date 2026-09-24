import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeAbiParameters,
  encodeEventTopics,
  erc1155Abi,
  erc20Abi,
  pad,
  parseAbiParameters,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import {
  createTokenTransferService,
  isRetryableChunkError,
  tokenTransferService,
  type GetLogsArgs,
  type ScanLog,
  type TransferScanClient,
} from '@/services/TokenTransferService';

// Mixed-case addresses on purpose: the service must lowercase before
// building topic filters (on-chain topics are lowercase hex) and in the
// emitted from/to/token fields.
const OWNER = '0xAbC1111111111111111111111111111111111111' as Address;
const OTHER = '0xDeF2222222222222222222222222222222222222' as Address;
const OPERATOR = '0x3333333333333333333333333333333333333333' as Address;
const TOKEN = '0xAaBbCcDdEeFf00112233445566778899aAbBcCdD' as Address;

const ERC20_TOPIC = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer' })[0];
const SINGLE_TOPIC = encodeEventTopics({ abi: erc1155Abi, eventName: 'TransferSingle' })[0];
const BATCH_TOPIC = encodeEventTopics({ abi: erc1155Abi, eventName: 'TransferBatch' })[0];

// On-chain topics carry the lowercase address bytes.
const topicAddress = (address: Address): Hex => pad(address.toLowerCase() as Address, { size: 32 });

const logOf = (
  topics: [Hex, ...Hex[]],
  data: Hex,
  blockNumber: number,
  logIndex: number,
): ScanLog => ({
  address: TOKEN,
  topics,
  data,
  blockNumber: BigInt(blockNumber),
  transactionHash: `0xtx${blockNumber}x${logIndex}` as Hex,
  logIndex,
});

const erc20Log = (
  from: Address,
  to: Address,
  value: bigint,
  blockNumber: number,
  logIndex: number,
): ScanLog =>
  logOf(
    [ERC20_TOPIC, topicAddress(from), topicAddress(to)],
    encodeAbiParameters(parseAbiParameters('uint256'), [value]),
    blockNumber,
    logIndex,
  );

// ERC-721 shape of the SHARED Transfer selector: the tokenId is the
// fourth indexed topic and data stays empty (the ERC-20 value word never
// exists on the wire for this shape). toHex — NOT pad — because a topic
// word on the wire is a hex string (pad(bigint) would emit bytes).
const erc721Log = (
  from: Address,
  to: Address,
  tokenId: bigint,
  blockNumber: number,
  logIndex: number,
): ScanLog =>
  logOf(
    [ERC20_TOPIC, topicAddress(from), topicAddress(to), toHex(tokenId, { size: 32 })],
    '0x',
    blockNumber,
    logIndex,
  );

const singleLog = (
  operator: Address,
  from: Address,
  to: Address,
  id: bigint,
  amount: bigint,
  blockNumber: number,
  logIndex: number,
): ScanLog =>
  logOf(
    [SINGLE_TOPIC, topicAddress(operator), topicAddress(from), topicAddress(to)],
    encodeAbiParameters(parseAbiParameters('uint256, uint256'), [id, amount]),
    blockNumber,
    logIndex,
  );

const batchLog = (
  operator: Address,
  from: Address,
  to: Address,
  ids: bigint[],
  values: bigint[],
  blockNumber: number,
  logIndex: number,
): ScanLog =>
  logOf(
    [BATCH_TOPIC, topicAddress(operator), topicAddress(from), topicAddress(to)],
    encodeAbiParameters(parseAbiParameters('uint256[], uint256[]'), [ids, values]),
    blockNumber,
    logIndex,
  );

// Mirrors viem's event+args filtering: topic0 comes from the event
// signature the query carries (parseAbi events carry no hash field, so it
// is derived here the same way viem does), and from/to match the indexed
// slot per event family — the shared Transfer selector keeps from/to in
// topics[1]/[2] whatever the topic count (an ERC-721 log appends the
// tokenId as topics[3]; viem's positional null-wildcard topic vector
// matches the fourth topic at those same slots), while ERC-1155
// Single/Batch keep the operator in topics[1] and from/to in topics[2]/t3
// (the operator slot is never direction-filtered). topicAddress is
// defined above with the log fixtures.
const signatureOf = (event: GetLogsArgs['event']): Hex =>
  encodeEventTopics({ abi: [event], eventName: event.name })[0];

const matchesFilter = (log: ScanLog, args: GetLogsArgs): boolean => {
  if (log.topics[0] !== signatureOf(args.event)) return false;
  // Token mode: the emitter address is the filter — no participant topics.
  if (args.address !== undefined) {
    return log.address.toLowerCase() === args.address.toLowerCase();
  }
  const isTransferFamily = args.event.name === 'Transfer';
  const wantFrom = args.args?.from !== undefined ? topicAddress(args.args.from) : null;
  const wantTo = args.args?.to !== undefined ? topicAddress(args.args.to) : null;
  const fromTopic = isTransferFamily ? log.topics[1] : log.topics[2];
  const toTopic = isTransferFamily ? log.topics[2] : log.topics[3];
  if (wantFrom !== null && fromTopic !== wantFrom) return false;
  if (wantTo !== null && toTopic !== wantTo) return false;
  return true;
};

const inRange = (log: ScanLog, args: GetLogsArgs): boolean =>
  log.blockNumber !== null && log.blockNumber >= args.fromBlock && log.blockNumber <= args.toBlock;

// Builds a service wired to an in-memory client that mirrors eth_getLogs
// filtering over the given logs. The clock is frozen and the call budget
// generous, so coverage depends only on what each test overrides.
const makeHarness = (options: {
  logs?: ScanLog[];
  latest?: bigint;
  maxScanCalls?: number;
  // Reject any getLogs whose block range exceeds this many blocks, with a
  // provider-shaped "range too large" error.
  rejectRangeAbove?: bigint;
}) => {
  const calls: GetLogsArgs[] = [];
  const client: TransferScanClient = {
    getBlockNumber: async () => options.latest ?? 1_000n,
    getLogs: async (args) => {
      calls.push(args);
      if (
        options.rejectRangeAbove !== undefined &&
        args.toBlock - args.fromBlock + 1n > options.rejectRangeAbove
      ) {
        throw new Error(
          `block range too large: ${args.toBlock - args.fromBlock + 1n} blocks exceeds provider limit`,
        );
      }
      return (options.logs ?? []).filter((log) => matchesFilter(log, args) && inRange(log, args));
    },
  };
  const service = createTokenTransferService({
    rpcManager: { getClient: async () => client },
    now: () => 0,
    maxScanCalls: options.maxScanCalls ?? 1_000_000,
  });
  return { service, calls };
};

beforeEach(() => {
  tokenTransferService.clearTransfersCache();
});

describe('TokenTransferService - merge, sort and self-transfer dedupe', () => {
  it('merges every event shape and direction, sorted desc by (blockNumber, logIndex)', async () => {
    const logs = [
      erc20Log(OWNER, OTHER, 1000n, 900, 0), // outgoing ERC-20
      erc20Log(OTHER, OWNER, 2000n, 900, 1), // incoming ERC-20
      singleLog(OPERATOR, OTHER, OWNER, 7n, 5n, 800, 0), // incoming ERC-1155 single
      batchLog(OPERATOR, OWNER, OTHER, [1n, 2n], [3n, 4n], 700, 3), // outgoing ERC-1155 batch
      erc20Log(OWNER, OWNER, 42n, 600, 2), // self-transfer
    ];
    const { service } = makeHarness({ logs, latest: 1_000n });

    const result = await service.getTokenTransfers(1, OWNER, 0, 25);

    expect(result.coverage).toBe('complete');
    expect(result.windowBlocks).toBe(100_000);
    expect(result.nextCursor).toBeNull();
    expect(result.transfers.map((t) => [t.blockNumber, t.logIndex])).toEqual([
      [900, 1],
      [900, 0],
      [800, 0],
      [700, 3],
      [600, 2],
    ]);
    expect(result.transfers.map((t) => t.direction)).toEqual(['in', 'out', 'in', 'out', 'out']);

    const [incoming, outgoing, single, batch, self] = result.transfers;

    expect(outgoing.standard).toBe('erc20-or-erc721');
    expect(outgoing.logStandard).toBe('erc20');
    expect(outgoing.value).toBe('1000');
    expect(outgoing.from).toBe(OWNER.toLowerCase());
    expect(outgoing.to).toBe(OTHER.toLowerCase());
    expect(outgoing.token).toBe(TOKEN.toLowerCase());
    expect(outgoing.txHash).toBe('0xtx900x0');

    expect(incoming.value).toBe('2000');

    expect(single.standard).toBe('erc1155-single');
    expect(single.logStandard).toBe('erc1155');
    expect(single.tokenIds).toEqual(['7']);
    expect(single.amounts).toEqual(['5']);
    expect(single.value).toBe('5');

    expect(batch.standard).toBe('erc1155-batch');
    expect(batch.logStandard).toBe('erc1155');
    expect(batch.tokenIds).toEqual(['1', '2']);
    expect(batch.amounts).toEqual(['3', '4']);
    // Batch `value` carries the token-ID count (documented choice).
    expect(batch.value).toBe('2');

    // The self-transfer surfaced in both direction scans but is kept
    // exactly once, as the outgoing occurrence.
    expect(self.direction).toBe('out');
    expect(self.from).toBe(OWNER.toLowerCase());
    expect(self.to).toBe(OWNER.toLowerCase());
    expect(self.value).toBe('42');
    expect(result.transfers.filter((t) => t.blockNumber === 600)).toHaveLength(1);
  });

  it('keeps ERC-721-shaped Transfer logs (4 topics, empty data) as rows with the tokenId as value', async () => {
    // Regression shape: viem decodes no `value` for a 4-topic log against
    // the ERC-20 event, so these rows used to be dropped as undecodable —
    // the exact family the ?ttStandard=erc721 filter chip needs on screen.
    const tokenId = 2n ** 128n + 1n; // deliberately beyond Number.MAX_SAFE_INTEGER
    const logs = [
      erc721Log(OTHER, OWNER, 77n, 900, 0), // incoming
      erc721Log(OWNER, OTHER, tokenId, 800, 1), // outgoing
    ];
    const { service } = makeHarness({ logs, latest: 1_000n });

    const result = await service.getTokenTransfers(1, OWNER, 0, 25);

    expect(result.transfers).toHaveLength(2);
    // Both directions surface: the positional topic vector matches the
    // fourth topic at the same from/to slots as the 3-topic shape.
    expect(result.transfers.map((t) => t.direction)).toEqual(['in', 'out']);
    const [incoming, outgoing] = result.transfers;
    for (const row of [incoming, outgoing]) {
      expect(row.standard).toBe('erc20-or-erc721');
      expect(row.logStandard).toBe('erc721');
      expect(row.tokenIds).toBeUndefined();
    }
    expect(incoming.value).toBe('77');
    expect(incoming.from).toBe(OTHER.toLowerCase());
    expect(incoming.to).toBe(OWNER.toLowerCase());
    expect(outgoing.value).toBe('340282366920938463463374607431768211457');
    expect(outgoing.from).toBe(OWNER.toLowerCase());
    expect(outgoing.to).toBe(OTHER.toLowerCase());
  });

  it('skips a 4-topic Transfer log whose tokenId topic is not parseable hex', async () => {
    const garbage: ScanLog = {
      ...erc721Log(OTHER, OWNER, 77n, 900, 0),
      topics: [ERC20_TOPIC, topicAddress(OTHER), topicAddress(OWNER), '0xnot-hex'],
    };
    const { service } = makeHarness({ logs: [garbage, erc20Log(OWNER, OTHER, 5n, 800, 0)], latest: 1_000n });

    const result = await service.getTokenTransfers(1, OWNER, 0, 25);

    // Only the healthy neighbour survives — a malformed log is skipped,
    // never thrown.
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].value).toBe('5');
    expect(result.transfers[0].logStandard).toBe('erc20');
  });
});

describe('TokenTransferService - adaptive chunk sizing', () => {
  it('halves the chunk on range-capped errors down to the 10-block floor, then completes', async () => {
    const { service, calls } = makeHarness({ latest: 10_000n, rejectRangeAbove: 300n });

    const result = await service.getTokenTransfers(1, OWNER, 0, 25, 10_000);

    expect(result.coverage).toBe('complete');
    expect(result.windowBlocks).toBe(10_000);
    expect(result.transfers).toEqual([]);

    const ranges = calls.map((call) => call.toBlock - call.fromBlock + 1n);
    // First attempt uses the full initial chunk.
    expect(ranges[0]).toBe(5_000n);
    // Rejections halve: 5000 -> 2500 -> 1250 -> 625 -> 312 -> 156, and
    // 156 is the first size under the provider's 300 cap. Descent STOPS
    // there — once a size works the scan keeps progressing at it.
    for (const size of ['5000', '2500', '1250', '625', '312', '156']) {
      expect(ranges.map(String)).toContain(size);
    }
    expect(ranges.every((range) => range >= 10n)).toBe(true);
    // The first range the provider accepts is the halved size below its cap.
    const firstAcceptedIdx = ranges.findIndex((range) => range <= 300n);
    expect(ranges[firstAcceptedIdx]).toBe(156n);
    // Growth after clean chunks stays below the discovered ceiling
    // (ceiling = last rejected size - 1 = 311): no runaway re-attempts of
    // rejected sizes burning the call budget.
    expect(
      ranges.slice(firstAcceptedIdx).every((range) => range <= 311n),
    ).toBe(true);
  });
});

describe('TokenTransferService - coverage honesty', () => {
  it('reports partial when the call budget runs out before the window is covered', async () => {
    const logs = [erc20Log(OWNER, OTHER, 10n, 499_999, 0)];
    const { service, calls } = makeHarness({
      logs,
      latest: 500_000n,
      maxScanCalls: 40, // production default
    });

    const result = await service.getTokenTransfers(1, OWNER, 0, 25, 500_000);

    expect(result.coverage).toBe('partial');
    expect(result.windowBlocks).toBe(500_000);
    // Discovered transfers are still returned alongside the honest flag.
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].blockNumber).toBe(499_999);
    // The budget check runs between chunks of 6 calls: 36 calls started
    // chunk 7, the next check stopped the scan at 42.
    expect(calls).toHaveLength(42);
  });

  it('reports partial when the elapsed-time budget runs out', async () => {
    // A clock that advances 10s per read: the first budget check passes,
    // the third one (30s after start) stops the scan.
    let clock = 0;
    const now = () => {
      clock += 10_000;
      return clock;
    };
    const client: TransferScanClient = {
      getBlockNumber: async () => 500_000n,
      getLogs: async () => [],
    };
    const service = createTokenTransferService({
      rpcManager: { getClient: async () => client },
      now,
      maxScanCalls: 1_000_000,
    });

    const result = await service.getTokenTransfers(1, OWNER, 0, 25, 500_000);

    expect(result.coverage).toBe('partial');
    expect(result.transfers).toEqual([]);
  });

  it('propagates non-range provider errors instead of swallowing them as partial', async () => {
    const failing: TransferScanClient = {
      getBlockNumber: async () => 100n,
      getLogs: async () => {
        throw new Error('connection refused');
      },
    };
    const service = createTokenTransferService({
      rpcManager: { getClient: async () => failing },
      now: () => 0,
    });

    await expect(service.getTokenTransfers(1, OWNER, 0, 25)).rejects.toThrow('connection refused');
  });
});

describe('TokenTransferService - token mode', () => {
  it('filters by the log address with the topic0 set only — no participant topics', async () => {
    // Logs emitted by TOKEN between OTHERS: participant topics can never
    // match them — exactly the rows the token-centric scan exists for
    // (logOf fixtures all carry address: TOKEN).
    const logs = [
      erc20Log(OPERATOR, OTHER, 500n, 950, 0),
      singleLog(OPERATOR, OTHER, OWNER, 1n, 1n, 949, 1),
      batchLog(OPERATOR, OWNER, OTHER, [7n], [2n], 948, 2),
    ];
    const { service, calls } = makeHarness({ logs, latest: 1_000n });

    const result = await service.getTokenTransfers(1, TOKEN, 0, 25, undefined, false, 'token');

    // One query per event shape (no direction split), one chunk covering
    // [0..1000] (default window exceeds the chain tip).
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.address).toBe(TOKEN.toLowerCase());
      expect(call.args).toBeUndefined();
      expect(call.fromBlock).toBe(0n);
      expect(call.toBlock).toBe(1_000n);
    }
    // All three shapes surface with the emitting token as `token`.
    expect(result.mode).toBe('token');
    expect(result.coverage).toBe('complete');
    expect(result.transfers.map((t) => t.standard)).toEqual([
      'erc20-or-erc721',
      'erc1155-single',
      'erc1155-batch',
    ]);
    for (const transfer of result.transfers) {
      expect(transfer.token).toBe(TOKEN.toLowerCase());
    }
  });

  it('resolves direction per row from the viewed contract participation', async () => {
    const logs = [
      erc20Log(TOKEN, OTHER, 10n, 900, 0), // contract sends its own token → out
      erc20Log(OTHER, TOKEN, 20n, 899, 1), // contract receives → in
      erc20Log(OTHER, OPERATOR, 30n, 898, 2), // mint-style: neither → none
      erc20Log(TOKEN, TOKEN, 40n, 897, 3), // self-transfer → out (participant convention)
    ];
    const { service } = makeHarness({ logs, latest: 1_000n });

    const result = await service.getTokenTransfers(1, TOKEN, 0, 25, undefined, false, 'token');

    expect(result.transfers.map((t) => t.direction)).toEqual(['out', 'in', 'none', 'out']);
  });

  it('participant mode keeps its six topic-filtered calls with no address filter', async () => {
    const { service, calls } = makeHarness({ logs: [], latest: 1_000n });

    await service.getTokenTransfers(1, OWNER, 0, 25);

    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call.address).toBeUndefined();
      expect(call.args).toBeDefined();
    }
    expect(calls.filter((call) => call.args?.from === OWNER.toLowerCase())).toHaveLength(3);
    expect(calls.filter((call) => call.args?.to === OWNER.toLowerCase())).toHaveLength(3);
  });

  it('caches the two modes separately and reports the mode on every result', async () => {
    // Emitted by TOKEN between two other addresses: token mode finds it,
    // participant mode for the same (chain, address, window) cannot.
    const logs = [erc20Log(OTHER, OPERATOR, 5n, 500, 0)];
    const { service, calls } = makeHarness({ logs, latest: 1_000n });

    const tokenResult = await service.getTokenTransfers(1, TOKEN, 0, 25, undefined, false, 'token');
    expect(tokenResult.mode).toBe('token');
    expect(tokenResult.transfers).toHaveLength(1);
    const callsAfterTokenScan = calls.length;

    const participantResult = await service.getTokenTransfers(1, TOKEN, 0, 25);
    expect(participantResult.mode).toBe('participant');
    expect(participantResult.transfers).toHaveLength(0);
    // A genuinely new scan (six more calls), not a cache re-serve.
    expect(calls.length).toBe(callsAfterTokenScan + 6);

    // Re-requesting token mode serves ITS cache entry — no new calls.
    const cachedToken = await service.getTokenTransfers(1, TOKEN, 0, 25, undefined, false, 'token');
    expect(calls.length).toBe(callsAfterTokenScan + 6);
    expect(cachedToken.transfers).toHaveLength(1);
    expect(cachedToken.mode).toBe('token');
  });
});

describe('TokenTransferService - cursor pagination over the cached list', () => {
  it('serves later pages from the cache with zero extra getLogs calls', async () => {
    const logs = [
      erc20Log(OWNER, OTHER, 3n, 900, 0),
      erc20Log(OTHER, OWNER, 2n, 800, 0),
      erc20Log(OWNER, OWNER, 1n, 700, 0),
    ];
    const { service, calls } = makeHarness({ logs, latest: 1_000n });

    const page1 = await service.getTokenTransfers(1, OWNER, 0, 2);
    expect(page1.transfers.map((t) => t.blockNumber)).toEqual([900, 800]);
    expect(page1.nextCursor).toBe('2');
    expect(calls).toHaveLength(6); // one chunk = 6 getLogs (3 shapes x 2 directions)

    const page2 = await service.getTokenTransfers(1, OWNER, 2, 2);
    expect(page2.transfers.map((t) => t.blockNumber)).toEqual([700]);
    expect(page2.transfers[0].direction).toBe('out');
    expect(page2.nextCursor).toBeNull();
    expect(calls).toHaveLength(6); // served entirely from the cache

    // Cursor beyond the list end: empty page, no rescan.
    const page3 = await service.getTokenTransfers(1, OWNER, 10, 2);
    expect(page3.transfers).toEqual([]);
    expect(page3.nextCursor).toBeNull();
    expect(calls).toHaveLength(6);
  });
});

describe('TokenTransferService - cache-bypass refresh', () => {
  it('re-scans on refresh, overwriting a cached partial entry (Retry is not a placebo)', async () => {
    // Mutable log set: a matching log appears INSIDE the first chunk's
    // range only after the initial scan ran and cached its (partial,
    // empty) result.
    const logs: ScanLog[] = [];
    const { service, calls } = makeHarness({ logs, latest: 500_000n, maxScanCalls: 6 });

    // Budget-limited first scan: one 6-call chunk of the 100k window →
    // partial, empty, cached.
    const first = await service.getTokenTransfers(1, OWNER, 0, 25);
    expect(first.coverage).toBe('partial');
    expect(first.windowBlocks).toBe(100_000);
    expect(first.transfers).toEqual([]);
    expect(calls).toHaveLength(6);

    // Placebo proof: a plain re-read re-serves the cached partial entry
    // (zero new getLogs) even though a matching log now exists in the
    // already-scanned range.
    logs.push(erc20Log(OWNER, OTHER, 5n, 498_000, 0));
    const placebo = await service.getTokenTransfers(1, OWNER, 0, 25);
    expect(placebo.transfers).toEqual([]);
    expect(placebo.coverage).toBe('partial');
    expect(calls).toHaveLength(6);

    // refresh: the cache read is skipped, the scan re-runs, and the new
    // outcome overwrites the cached entry.
    const refreshed = await service.getTokenTransfers(1, OWNER, 0, 25, undefined, true);
    expect(refreshed.coverage).toBe('partial');
    expect(refreshed.transfers).toHaveLength(1);
    expect(refreshed.transfers[0].blockNumber).toBe(498_000);
    expect(refreshed.transfers[0].value).toBe('5');
    expect(calls).toHaveLength(12);

    // Subsequent plain reads serve the overwritten entry — the re-scan
    // became the cache, not a one-off side channel.
    const after = await service.getTokenTransfers(1, OWNER, 0, 25);
    expect(after.transfers).toHaveLength(1);
    expect(after.transfers[0].blockNumber).toBe(498_000);
    expect(calls).toHaveLength(12);
  });
});

describe('TokenTransferService - window clamping', () => {
  it('clamps an explicit window into 1..50_000_000 and echoes the effective value', async () => {
    const { service } = makeHarness({ latest: 1_000n });

    const clampedLow = await service.getTokenTransfers(1, OWNER, 0, 25, 0);
    expect(clampedLow.windowBlocks).toBe(1);
    expect(clampedLow.coverage).toBe('complete');

    const clampedHigh = await service.getTokenTransfers(1, OWNER, 0, 25, 99_999_999);
    expect(clampedHigh.windowBlocks).toBe(50_000_000);
    expect(clampedHigh.coverage).toBe('complete');
  });
});

describe('TokenTransferService - scan freshness (scannedAt)', () => {
  it('reports the first scan time on every ~60s cache hit and advances it only on re-scan', async () => {
    let clock = 1_700_000_000_000;
    const now = () => clock;
    const client: TransferScanClient = {
      getBlockNumber: async () => 1_000n,
      getLogs: async () => [],
    };
    const service = createTokenTransferService({
      rpcManager: { getClient: async () => client },
      now,
      maxScanCalls: 1_000_000,
    });

    const first = await service.getTokenTransfers(1, OWNER, 0, 25);
    expect(first.scannedAt).toBe(new Date(1_700_000_000_000).toISOString());

    // 30s later, inside the TTL: the cache hit reports the FIRST scan's
    // time — the age grows instead of resetting to zero.
    clock += 30_000;
    const cached = await service.getTokenTransfers(1, OWNER, 0, 25);
    expect(cached.scannedAt).toBe(first.scannedAt);

    // An explicit refresh re-scans, so the freshness clock restarts.
    clock += 30_000;
    const refreshed = await service.getTokenTransfers(1, OWNER, 0, 25, undefined, true);
    expect(refreshed.scannedAt).toBe(new Date(1_700_000_060_000).toISOString());
  });
});

describe('isRetryableChunkError', () => {
  it('recognizes range/cap errors by message and JSON-RPC code', () => {
    expect(isRetryableChunkError(new Error('query returned more than 10000 results'))).toBe(true);
    expect(isRetryableChunkError(new Error('block range too large'))).toBe(true);
    expect(isRetryableChunkError(new Error('request timeout after 30s'))).toBe(true);
    expect(isRetryableChunkError({ code: -32062 })).toBe(true);
    expect(isRetryableChunkError({ code: -32005 })).toBe(true);
    expect(isRetryableChunkError(new Error('connection refused'))).toBe(false);
  });
});

describe('exported singleton', () => {
  it('exposes getTokenTransfers and clearTransfersCache', () => {
    expect(typeof tokenTransferService.getTokenTransfers).toBe('function');
    expect(typeof tokenTransferService.clearTransfersCache).toBe('function');
  });
});
