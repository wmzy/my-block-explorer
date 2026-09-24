/**
 * AddressScanService walk engine against a real in-memory DuckDB (the
 * adapter auto-applies drizzle/*, so migration 0013's tables exist) and a
 * scripted RPC client: empty-segment advance, change discovery with
 * persisted findings, provider-error honesty (verbatim message, never
 * silently complete), checkpoint persistence and resume-from-cursor,
 * pause, conflict/force semantics, delete, and restart reconciliation.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/database/drizzle', async () => {
  const { createDuckDBAdapter } = await import('@/database/duckdb-postgres-adapter');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const schema = await import('@/database/schema');
  const db = drizzle(createDuckDBAdapter('duckdb://:memory:'), {
    schema,
    casing: 'snake_case',
  });
  return { db, ...schema };
});
vi.mock('@/database/init', async () => await import('@/database/drizzle'));
vi.mock('@/services/ContractSourceService', () => ({ contractSourceService: {} }));

const mocks = vi.hoisted(() => ({
  client: {},
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: { getClient: async () => mocks.client },
}));

import { and, eq } from 'drizzle-orm';
import { db } from '@/database/drizzle';
import { addressScanJobs, addressScanFindings } from '@/database/schema';
import {
  createOrReplaceScanJob,
  deleteScanJob,
  pauseScanJob,
  reconcileInterruptedAddressScans,
  resumeScanJob,
  toScanJobDto,
} from '@/services/AddressScanService';
import { addressService } from '@/services/AddressService';
import type { DiscoveredTransaction } from '@/services/AddressService';
import type { PublicClient } from 'viem';

// Unique per call: tests share one in-memory database, so each test (and
// each row a test inserts) needs its own (chain, address) key.
let addressCounter = 0;
const uniqueAddress = (): `0x${string}` => {
  addressCounter += 1;
  return `0x${addressCounter.toString(16).padStart(40, '0')}`;
};

type BlockSpec = {
  number: bigint;
  timestamp: bigint;
  transactions: Array<{
    hash: string;
    from: string;
    to: string | null;
    value: bigint;
  }>;
};

type ClientSpec = {
  balances: (blockNumber: bigint) => bigint | Promise<bigint>;
  blocks?: Record<string, BlockSpec>;
  head?: bigint;
};

const buildClient = (spec: ClientSpec): PublicClient =>
  ({
    getBlockNumber: vi.fn(async () => spec.head ?? 1000n),
    getBalance: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
      spec.balances(blockNumber),
    ),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) =>
      spec.blocks?.[blockNumber.toString()] ?? {
        number: blockNumber,
        timestamp: 1700000000n,
        transactions: [],
      },
    ),
    getTransaction: vi.fn(),
    getTransactionCount: vi.fn(async () => 1),
    getCode: vi.fn(async () => '0x'),
  }) as unknown as PublicClient;

const getJob = async (chainId: number, address: string) => {
  const rows = await db
    .select()
    .from(addressScanJobs)
    .where(and(eq(addressScanJobs.chainId, chainId), eq(addressScanJobs.address, address)));
  return rows[0] ?? null;
};

const getFindings = async (chainId: number, address: string) =>
  db
    .select()
    .from(addressScanFindings)
    .where(
      and(eq(addressScanFindings.chainId, chainId), eq(addressScanFindings.address, address)),
    );

const balanceCallBlocks = (client: PublicClient): bigint[] => {
  const fn = client.getBalance as unknown as {
    mock: { calls: Array<[{ blockNumber: bigint }]> };
  };
  return fn.mock.calls.map(args => args[0].blockNumber);
};

describe('deep scan walk engine', () => {
  it('advances empty segments checkpoint-by-checkpoint and completes flat walks', async () => {
    const address = uniqueAddress();
    // Zero balance since genesis: every checkpoint pair compares equal,
    // so each 50k-block segment verifies empty in a single read.
    const client = buildClient({ balances: () => 0n, head: 200_000n });
    mocks.client = client;

    const created = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 200_000,
      force: false,
    });
    expect(created.ok).toBe(true);
    if (!created.ok || created.result.outcome !== 'created') throw new Error('not created');
    expect(created.result.job.status).toBe('pending');
    // 202-async start: the loop runs in the background; tests await it.
    expect(created.result.started).not.toBeNull();
    await created.result.started;

    const row = await getJob(1, address);
    expect(row?.status).toBe('complete');
    expect(row?.cursorBlock).toBe(200_000n);
    expect(row?.txsFound).toBe(0);
    // Genesis-anchored completion derives complete coverage.
    expect(toScanJobDto(row).coverage).toBe('complete');
    // Checkpoint efficiency: the baseline at block -1 is definitionally
    // 0 (no read), then one read per segment: 49999, 99999, 149999,
    // 199999, and the final 1-block segment to 200000.
    expect(balanceCallBlocks(client)).toEqual([
      49_999n,
      99_999n,
      149_999n,
      199_999n,
      200_000n,
    ]);
  });

  it('finds the first change block, persists findings, and advances the cursor onto it', async () => {
    const address = uniqueAddress();
    const client = buildClient({
      balances: bn => (bn < 100n ? 0n : 5n),
      blocks: {
        100: {
          number: 100n,
          timestamp: 1700000123n,
          transactions: [
            {
              hash: '0xabc0000000000000000000000000000000000000000000000000000000000f1nd',
              from: `0x${'1'.repeat(40)}`,
              to: address,
              value: 5n,
            },
          ],
        },
      },
    });
    mocks.client = client;

    const created = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 1000,
      force: false,
    });
    if (!created.ok || created.result.outcome !== 'created') throw new Error('not created');
    await created.result.started;

    const row = await getJob(1, address);
    expect(row?.status).toBe('complete');
    expect(row?.cursorBlock).toBe(1000n);
    expect(row?.txsFound).toBe(1);

    const findings = await getFindings(1, address);
    expect(findings).toHaveLength(1);
    expect(findings[0].txHash).toBe(
      '0xabc0000000000000000000000000000000000000000000000000000000000f1nd',
    );
    expect(findings[0].blockNumber).toBe(100n);
  });

  it('surfaces provider archive errors verbatim as status error, never silently complete', async () => {
    const address = uniqueAddress();
    const providerMessage =
      'historical state not available for block 99999 (try an archive node)';
    const client = buildClient({
      balances: bn => {
        if (bn >= 50_000n) throw new Error(providerMessage);
        return 0n;
      },
      head: 200_000n,
    });
    mocks.client = client;

    const created = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 200_000,
      force: false,
    });
    if (!created.ok || created.result.outcome !== 'created') throw new Error('not created');
    await created.result.started;

    const row = await getJob(1, address);
    expect(row?.status).toBe('error');
    // Verbatim provider message.
    expect(row?.errorMessage).toBe(providerMessage);
    // Progress before the failure is checkpointed: the first 50k segment
    // verified empty before the second segment's read failed.
    expect(row?.cursorBlock).toBe(49_999n);
    expect(toScanJobDto(row).coverage).toBeNull();
  });

  it('shrinks the checkpoint batch on throttling range errors and still completes', async () => {
    const address = uniqueAddress();
    let firstSegmentReadFailed = false;
    const client = buildClient({
      balances: bn => {
        // The very first checkpoint read (block 49999 with the default
        // 50k batch) throttles once; smaller strides must succeed.
        if (!firstSegmentReadFailed && bn === 49_999n) {
          firstSegmentReadFailed = true;
          throw new Error('query limit exceeded: 100 req/interval');
        }
        return 0n;
      },
      head: 200_000n,
    });
    mocks.client = client;

    const created = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 200_000,
      force: false,
    });
    if (!created.ok || created.result.outcome !== 'created') throw new Error('not created');
    await created.result.started;

    const row = await getJob(1, address);
    expect(row?.status).toBe('complete');
    // The ladder shrank the stride: the first successful checkpoint lands
    // at 24999 (25k batch), proving the batch halved instead of failing.
    const blocks = balanceCallBlocks(client).filter(bn => bn !== 49_999n);
    expect(blocks[0]).toBe(24_999n);
  });

  it('resumes exactly from the checkpointed cursor, never re-reading below it', async () => {
    const address = uniqueAddress();
    // Simulate a paused mid-walk job: cursor 400, change at 600.
    await db.insert(addressScanJobs).values({
      chainId: 1,
      address,
      fromBlock: 0n,
      toBlock: 1000n,
      cursorBlock: 400n,
      status: 'paused',
      txsFound: 0,
      errorMessage: null,
      updatedAt: new Date(),
    });

    const client = buildClient({
      balances: bn => (bn < 600n ? 0n : 5n),
      blocks: {
        600: {
          number: 600n,
          timestamp: 1700000600n,
          transactions: [
            {
              hash: '0xdef0000000000000000000000000000000000000000000000000000000000f1nd',
              from: `0x${'2'.repeat(40)}`,
              to: address,
              value: 5n,
            },
          ],
        },
      },
    });
    mocks.client = client;

    const resumed = await resumeScanJob(1, address);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) throw new Error('resume failed');
    expect(resumed.job.status).toBe('pending');
    expect(resumed.started).not.toBeNull();
    await resumed.started;

    const row = await getJob(1, address);
    expect(row?.status).toBe('complete');
    expect(row?.cursorBlock).toBe(1000n);
    expect(row?.txsFound).toBe(1);
    // Everything the walk read (baseline at 400, checkpoints, binary
    // search) sits at or above the resume cursor.
    for (const bn of balanceCallBlocks(client)) {
      expect(bn).toBeGreaterThanOrEqual(400n);
    }
    const findings = await getFindings(1, address);
    expect(findings[0].blockNumber).toBe(600n);
  });

  it('pauses the live loop at the last checkpointed segment', async () => {
    const address = uniqueAddress();
    // Balance reads block on manual release, so the test can pause the
    // loop WHILE it is inside the walk (between checkpoint reads).
    const pendingReads: Array<(value: bigint) => void> = [];
    const client = buildClient({
      balances: () =>
        new Promise<bigint>(resolve => {
          pendingReads.push(resolve);
        }),
      head: 200_000n,
    });
    mocks.client = client;

    const created = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 200_000,
      force: false,
    });
    if (!created.ok || created.result.outcome !== 'created') throw new Error('not created');

    // Segment 1's checkpoint read at 49999: release it as empty (0n).
    await vi.waitFor(() => expect(pendingReads.length).toBe(1));
    pendingReads.shift()!(0n);

    // Segment 2's read at 99999 is now in flight; pause mid-walk.
    await vi.waitFor(() => expect(pendingReads.length).toBe(1));
    expect(pauseScanJob(1, address)).toBe(true);
    pendingReads.shift()!(0n);
    await created.result.started;

    // The loop settled segment 2, checkpointed its cursor, then observed
    // the abort and flipped to paused instead of continuing.
    const row = await getJob(1, address);
    expect(row?.status).toBe('paused');
    expect(row?.cursorBlock).toBe(99_999n);
  });

  it('conflicts on different bounds without force and force-resets progress + findings', async () => {
    const address = uniqueAddress();
    mocks.client = buildClient({ balances: () => 1n, head: 1000n });

    const first = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 1000,
      force: false,
    });
    expect(first.ok && first.result.outcome).toBe('created');
    if (first.ok && first.result.outcome === 'created') await first.result.started;

    // Different bounds, no force → conflict.
    const conflict = await createOrReplaceScanJob(1, address, {
      fromBlock: 500,
      toBlock: 1000,
      force: false,
    });
    expect(conflict.ok && conflict.result.outcome).toBe('conflict');

    // Same bounds → idempotent, existing row returned untouched.
    const again = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 1000,
      force: false,
    });
    expect(again.ok && again.result.outcome).toBe('idempotent');

    // A completed genesis job found one finding in the earlier test run;
    // force-replace must wipe findings and reset the cursor.
    await db.insert(addressScanFindings).values({
      chainId: 1,
      address,
      txHash: '0x9990000000000000000000000000000000000000000000000000000000000f1nd',
      blockNumber: 12n,
    });
    const replaced = await createOrReplaceScanJob(1, address, {
      fromBlock: 500,
      toBlock: 1000,
      force: true,
    });
    expect(replaced.ok && replaced.result.outcome).toBe('created');
    if (replaced.ok && replaced.result.outcome === 'created') await replaced.result.started;

    const row = await getJob(1, address);
    expect(row?.fromBlock).toBe(500n);
    expect(row?.toBlock).toBe(1000n);
    expect(row?.cursorBlock).toBe(1000n);
    expect(row?.txsFound).toBe(0);
    expect(await getFindings(1, address)).toHaveLength(0);
  });

  it('restarts an errored job from its checkpoint on an idempotent re-POST', async () => {
    const address = uniqueAddress();
    // Errored mid-walk at cursor 3000 (checkpointed).
    await db.insert(addressScanJobs).values({
      chainId: 1,
      address,
      fromBlock: 0n,
      toBlock: 4000n,
      cursorBlock: 3000n,
      status: 'error',
      txsFound: 0,
      errorMessage: 'provider exploded',
      updatedAt: new Date(),
    });

    mocks.client = buildClient({ balances: () => 3n, head: 4000n });
    const retried = await createOrReplaceScanJob(1, address, {
      fromBlock: 0,
      toBlock: 4000,
      force: false,
    });
    // Same bounds → idempotent outcome, but the errored job restarts.
    expect(retried.ok && retried.result.outcome).toBe('idempotent');
    if (retried.ok && retried.result.outcome === 'idempotent') {
      expect(retried.result.started).not.toBeNull();
      await retried.result.started;
    }

    const row = await getJob(1, address);
    expect(row?.status).toBe('complete');
    expect(row?.errorMessage).toBeNull();
  });

  it('delete removes the job row and its findings; idempotent on repeat', async () => {
    const address = uniqueAddress();
    await db.insert(addressScanJobs).values({
      chainId: 1,
      address,
      fromBlock: 0n,
      toBlock: 10n,
      cursorBlock: -1n,
      status: 'pending',
      txsFound: 0,
      errorMessage: null,
      updatedAt: new Date(),
    });
    await db.insert(addressScanFindings).values({
      chainId: 1,
      address,
      txHash: '0x7770000000000000000000000000000000000000000000000000000000000f1nd',
      blockNumber: 5n,
    });

    await deleteScanJob(1, address);
    await deleteScanJob(1, address);

    expect(await getJob(1, address)).toBeNull();
    expect(await getFindings(1, address)).toHaveLength(0);
  });

  it('caps at 2 concurrent walks and pumps the queued job when a slot frees', async () => {
    const addressA = uniqueAddress();
    const addressB = uniqueAddress();
    const addressC = uniqueAddress();
    // One shared client dispatching per-address manual gates.
    const gates = new Map<string, Array<(value: bigint) => void>>();
    const client = {
      getBlockNumber: vi.fn(async () => 1000n),
      getBalance: vi.fn(
        ({ address }: { address: string; blockNumber: bigint }) =>
          new Promise<bigint>(resolve => {
            const queue = gates.get(address) ?? [];
            queue.push(resolve);
            gates.set(address, queue);
          }),
      ),
      getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({
        number: blockNumber,
        timestamp: 1n,
        transactions: [],
      })),
      getTransaction: vi.fn(),
      getTransactionCount: vi.fn(async () => 1),
      getCode: vi.fn(async () => '0x'),
    } as unknown as PublicClient;
    mocks.client = client;

    const created: Record<string, { started: Promise<void> | null }> = {};
    for (const [label, addr] of [
      ['A', addressA],
      ['B', addressB],
      ['C', addressC],
    ] as const) {
      const result = await createOrReplaceScanJob(1, addr, {
        fromBlock: 0,
        toBlock: 1000,
        force: false,
      });
      if (!result.ok || result.result.outcome !== 'created') throw new Error('not created');
      created[label] = { started: result.result.started };
    }

    // A and B occupy both slots, gated mid-segment; C queues as pending.
    await vi.waitFor(() => expect(gates.get(addressA)).toHaveLength(1));
    await vi.waitFor(() => expect(gates.get(addressB)).toHaveLength(1));
    expect((await getJob(1, addressC))?.status).toBe('pending');
    expect(gates.get(addressC)).toBeUndefined();

    // Complete A: the freed slot pumps C's queued start.
    gates.get(addressA)![0](0n);
    await created.A.started;
    expect((await getJob(1, addressA))?.status).toBe('complete');
    await vi.waitFor(() => expect(gates.get(addressC)).toHaveLength(1));

    gates.get(addressC)![0](0n);
    gates.get(addressB)![0](0n);
    await created.B.started;
    await vi.waitFor(async () => {
      expect((await getJob(1, addressC))?.status).toBe('complete');
    });
    expect((await getJob(1, addressB))?.status).toBe('complete');
  });

  it('reconciles restart-stranded running rows to error with a resume hint', async () => {
    const strandedAddress = uniqueAddress();
    const pausedAddress = uniqueAddress();
    await db.insert(addressScanJobs).values({
      chainId: 1,
      address: strandedAddress,
      fromBlock: 0n,
      toBlock: 10n,
      cursorBlock: 4n,
      status: 'running',
      txsFound: 0,
      errorMessage: null,
      updatedAt: new Date(),
    });
    await db.insert(addressScanJobs).values({
      chainId: 1,
      address: pausedAddress,
      fromBlock: 0n,
      toBlock: 10n,
      cursorBlock: 4n,
      status: 'paused',
      txsFound: 0,
      errorMessage: null,
      updatedAt: new Date(),
    });

    await reconcileInterruptedAddressScans();

    const stranded = await getJob(1, strandedAddress);
    expect(stranded?.status).toBe('error');
    expect(stranded?.errorMessage).toBe(
      'Interrupted by server restart — resume to continue',
    );
    // Other statuses untouched; second run is a no-op.
    await reconcileInterruptedAddressScans();
    expect((await getJob(1, pausedAddress))?.status).toBe('paused');
    expect((await getJob(1, strandedAddress))?.errorMessage).toBe(
      'Interrupted by server restart — resume to continue',
    );
  });
});

describe('getAddressTransactions deep-scan merge (service level)', () => {
  it('serves findings through the heuristic zero-balance skip, with the honesty coverage floor', async () => {
    const address = uniqueAddress();
    // Non-zero nonce (an outgoing tx once existed) but balance 0 now:
    // the heuristic honestly reports coverage 'none' with no list — the
    // persisted deep-scan findings are the only channel that can serve
    // this address's history.
    mocks.client = buildClient({ balances: () => 0n, head: 1000n });

    const finding: DiscoveredTransaction = {
      hash: `0x${'ee'.repeat(32)}`,
      blockNumber: 700n,
      fromAddress: `0x${'3'.repeat(40)}`,
      toAddress: address,
      value: '9',
      timestamp: '2026-09-24T00:00:00.000Z',
    };

    // First call: fresh search path (heuristic skip) + merge.
    const fresh = await addressService.getAddressTransactions(
      1,
      address,
      20,
      0,
      undefined,
      { deepScanFindings: [finding] },
    );
    expect(fresh.transactions.map(tx => tx.hash)).toEqual([finding.hash]);
    expect(fresh.total).toBe(1);
    expect(fresh.reason).toBe('zero-balance');
    // Honesty floor: heuristic 'none' cannot stand while findings are
    // served; 'partial' is the honest verdict short of a route-level
    // complete lift.
    expect(fresh.coverage).toBe('partial');

    // Second call: the cached canonical result serves with the SAME
    // merge semantics (cache stays heuristic-only; findings merge at
    // read time).
    const cached = await addressService.getAddressTransactions(
      1,
      address,
      20,
      0,
      undefined,
      { deepScanFindings: [finding] },
    );
    expect(cached.transactions.map(tx => tx.hash)).toEqual([finding.hash]);
    expect(cached.total).toBe(1);
    expect(cached.coverage).toBe('partial');

    // Without findings the legacy verdict returns: 'none', empty list.
    const legacy = await addressService.getAddressTransactions(1, address, 20, 0, undefined);
    expect(legacy.transactions).toEqual([]);
    expect(legacy.total).toBe(0);
    expect(legacy.coverage).toBe('none');
  });
});
