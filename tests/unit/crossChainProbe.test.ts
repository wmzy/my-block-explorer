// crossChainProbe unit tests: the pure selection/ordering logic against
// the real chain config, and the probe/fan-out against a mocked
// utils/realTimeData client (the repo's standard service-test seam) plus
// a mocked custom-chain registry service. Pinned contracts: candidate
// selection (exclusion, custom append, cap, dedupe), the code ?? '0x'
// EOA/contract classification incl. the EIP-7702 designator, per-call
// timeout → explicit failed, bounded-pool fan-out that NEVER rejects,
// and display ordering that never compares raw balances.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import {
  PROBE_CALL_BUDGET_MS,
  PROBE_MAX_CHAINS,
  PROBE_POPULAR_CHAIN_COUNT,
  orderProbeResults,
  probeAddressAcrossChains,
  probeAddressOnChain,
  selectProbeChains,
  type ProbeOutcome,
} from '@/services/crossChainProbe';
import { createRpcClient } from '@/utils/realTimeData';
import { listCustomChains } from '@/config/customChains';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

// The custom-chain service (backend fetch + registry mirror) is replaced
// with settled fixtures: the probe only needs the registry snapshot
// AFTER the one-shot load resolves.
vi.mock('@/services/customChains', () => ({
  ensureCustomChainsLoaded: vi.fn(async () => undefined),
  listCustomChains: vi.fn(() => customChainFixtures),
}));

vi.mock('@/config/customChains', () => ({
  // The service reads the registry from the config module; services/
  // customChains only provides the one-shot backend load. Both mocks
  // read the same hoisted, lazily-mutated fixtures below.
  listCustomChains: vi.fn(() => customChainFixtures),
}));

// Registry fixtures shared with the hoisted mock factory below: the
// array is mutated per case, the factory's closure reads it lazily.
const customChainFixtures = vi.hoisted(() => [] as {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
}[]);

const ADDRESS = getAddress(`0x${'ab'.repeat(20)}`);

// The first five POPULAR_CHAINS after mainnet (polygon, bsc, arbitrum,
// base, optimism) — pinned against the real config so a popularity
// reorder surfaces here, not in the UI.
const POPULAR_HEAD_EXCLUDING_MAINNET = [137, 56, 42161, 8453, 10];

// Minimal client stand-in: only the two calls the probe makes.
const clientWith = (
  getBalance: (args: { address: `0x${string}` }) => Promise<bigint>,
  getCode: (args: { address: `0x${string}` }) => Promise<string | undefined>,
) => ({ getBalance, getCode }) as never;

const okOutcome = (chainId: number, balance: bigint): ProbeOutcome => ({
  status: 'ok',
  chainId,
  balance,
  isContract: false,
});

describe('selectProbeChains', () => {
  beforeEach(() => {
    customChainFixtures.length = 0;
  });

  it('targets the first five popular chains, excluding the viewed one', () => {
    expect(selectProbeChains(1, [])).toEqual(POPULAR_HEAD_EXCLUDING_MAINNET);
  });

  it('lets the next popular chain slide in when the viewed one is popular', () => {
    // Viewing polygon: mainnet takes its slot, the head stays five long.
    expect(selectProbeChains(137, [])).toEqual([1, 56, 42161, 8453, 10]);
  });

  it('appends registered custom chains up to the cap of six, in chainId order', () => {
    customChainFixtures.push(
      { chainId: 42168, name: 'Later', symbol: 'LTR', decimals: 18, rpcUrl: 'http://x' },
      { chainId: 31337, name: 'Anvil', symbol: 'ETH', decimals: 18, rpcUrl: 'http://y' },
    );
    const selected = selectProbeChains(1, customChainFixtures);
    expect(selected).toEqual([...POPULAR_HEAD_EXCLUDING_MAINNET, 31337]);
    expect(selected).toHaveLength(PROBE_MAX_CHAINS);
  });

  it('dedupes customs against popular picks and the viewed chain', () => {
    customChainFixtures.push(
      // 137 is already a popular pick; 1 is the viewed chain.
      { chainId: 137, name: 'Dupe', symbol: 'D', decimals: 18, rpcUrl: 'http://x' },
      { chainId: 1, name: 'Current', symbol: 'C', decimals: 18, rpcUrl: 'http://x' },
      { chainId: 31337, name: 'Anvil', symbol: 'ETH', decimals: 18, rpcUrl: 'http://y' },
    );
    expect(selectProbeChains(1, customChainFixtures)).toEqual([
      ...POPULAR_HEAD_EXCLUDING_MAINNET,
      31337,
    ]);
  });

  it('keeps the popular head at the configured size regardless of customs', () => {
    expect(PROBE_POPULAR_CHAIN_COUNT).toBe(5);
    // Viewing a chain outside the popular list leaves the head untouched.
    expect(selectProbeChains(99999, []).slice(0, PROBE_POPULAR_CHAIN_COUNT)).toEqual(
      [1, ...POPULAR_HEAD_EXCLUDING_MAINNET.slice(0, 4)],
    );
  });
});

describe('probeAddressOnChain', () => {
  beforeEach(() => {
    vi.mocked(createRpcClient).mockReset();
    vi.mocked(createRpcClient).mockResolvedValue(
      clientWith(
        () => Promise.resolve(1_500_000_000_000_000_000n),
        () => Promise.resolve(undefined),
      ),
    );
  });

  it('classifies a plain EOA: viem folds successful 0x getCode into undefined', async () => {
    const outcome = await probeAddressOnChain(137, ADDRESS);
    expect(outcome).toEqual({
      status: 'ok',
      chainId: 137,
      balance: 1_500_000_000_000_000_000n,
      isContract: false,
    });
  });

  it('classifies an explicit 0x code read as an EOA too', async () => {
    vi.mocked(createRpcClient).mockResolvedValue(
      clientWith(
        () => Promise.resolve(0n),
        () => Promise.resolve('0x'),
      ),
    );
    const outcome = await probeAddressOnChain(56, ADDRESS);
    expect(outcome).toEqual({ status: 'ok', chainId: 56, balance: 0n, isContract: false });
  });

  it('classifies deployed bytecode as a contract', async () => {
    vi.mocked(createRpcClient).mockResolvedValue(
      clientWith(
        () => Promise.resolve(0n),
        () => Promise.resolve('0x6080604052348015600f57600080fd'),
      ),
    );
    const outcome = await probeAddressOnChain(42161, ADDRESS);
    expect(outcome).toEqual({ status: 'ok', chainId: 42161, balance: 0n, isContract: true });
  });

  it('classifies the EIP-7702 delegated-EOA designator as contract (it HAS code)', async () => {
    vi.mocked(createRpcClient).mockResolvedValue(
      clientWith(
        () => Promise.resolve(0n),
        () => Promise.resolve(`0xef0100${'cd'.repeat(20)}`),
      ),
    );
    const outcome = await probeAddressOnChain(8453, ADDRESS);
    expect(outcome).toEqual({ status: 'ok', chainId: 8453, balance: 0n, isContract: true });
  });

  it('settles failed with the RPC error message when getBalance rejects', async () => {
    vi.mocked(createRpcClient).mockResolvedValue(
      clientWith(
        () => Promise.reject(new Error('HTTP 429 Too Many Requests')),
        () => Promise.resolve('0x'),
      ),
    );
    const outcome = await probeAddressOnChain(10, ADDRESS);
    expect(outcome).toEqual({
      status: 'failed',
      chainId: 10,
      reason: 'HTTP 429 Too Many Requests',
    });
  });

  it('settles failed when the client itself cannot be created', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('Unsupported chain ID: 999'));
    const outcome = await probeAddressOnChain(999, ADDRESS);
    expect(outcome).toEqual({
      status: 'failed',
      chainId: 999,
      reason: 'Unsupported chain ID: 999',
    });
  });

  it('settles failed when the call exceeds the budget (timeout)', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(createRpcClient).mockResolvedValue(
        clientWith(
          // A hung RPC node: never answers.
          () => new Promise<bigint>(() => undefined),
          () => Promise.resolve('0x'),
        ),
      );
      const pending = probeAddressOnChain(137, ADDRESS);
      await vi.advanceTimersByTimeAsync(PROBE_CALL_BUDGET_MS);
      const outcome = await pending;
      expect(outcome.status).toBe('failed');
      if (outcome.status === 'failed') {
        expect(outcome.reason).toContain('timed out');
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('probeAddressAcrossChains', () => {
  beforeEach(() => {
    customChainFixtures.length = 0;
    vi.mocked(createRpcClient).mockReset();
  });

  it('returns one outcome per candidate in stable selection order', async () => {
    customChainFixtures.push({
      chainId: 31337,
      name: 'Anvil',
      symbol: 'ETH',
      decimals: 18,
      rpcUrl: 'http://127.0.0.1:8545',
    });
    vi.mocked(createRpcClient).mockImplementation(async (chainId: number) =>
      clientWith(
        () => Promise.resolve(BigInt(chainId)),
        () => Promise.resolve(undefined),
      ),
    );

    const outcomes = await probeAddressAcrossChains(1, ADDRESS);

    expect(outcomes.map(outcome => outcome.chainId)).toEqual([
      ...POPULAR_HEAD_EXCLUDING_MAINNET,
      31337,
    ]);
    // The registry snapshot is read after the one-shot load resolves.
    expect(listCustomChains).toHaveBeenCalled();
    for (const outcome of outcomes) {
      expect(outcome).toEqual(okOutcome(outcome.chainId, BigInt(outcome.chainId)));
    }
  });

  it('turns a per-chain client-creation failure into that chain’s failed slot', async () => {
    vi.mocked(createRpcClient).mockImplementation(async (chainId: number) => {
      if (chainId === 56) throw new Error('no transport');
      return clientWith(
        () => Promise.resolve(1n),
        () => Promise.resolve(undefined),
      );
    });

    const outcomes = await probeAddressAcrossChains(1, ADDRESS);

    expect(outcomes).toHaveLength(POPULAR_HEAD_EXCLUDING_MAINNET.length);
    expect(outcomes[1]).toEqual({ status: 'failed', chainId: 56, reason: 'no transport' });
    expect(outcomes.filter(outcome => outcome.status === 'ok')).toHaveLength(4);
  });

  it('never rejects: universal client failure resolves all-failed', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('offline'));
    const outcomes = await probeAddressAcrossChains(1, ADDRESS);
    expect(outcomes).toHaveLength(POPULAR_HEAD_EXCLUDING_MAINNET.length);
    expect(outcomes.every(outcome => outcome.status === 'failed')).toBe(true);
  });

  it('fans out through a bounded pool of three', async () => {
    const started: number[] = [];
    let active = 0;
    let maxActive = 0;
    const release = new Map<number, () => void>();
    vi.mocked(createRpcClient).mockImplementation(async (chainId: number) =>
      clientWith(
        () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          started.push(chainId);
          return new Promise<bigint>(resolve => {
            release.set(chainId, () => {
              active -= 1;
              resolve(1n);
            });
          });
        },
        () => Promise.resolve(undefined),
      ),
    );

    const settled = probeAddressAcrossChains(1, ADDRESS);
    const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
    await tick();

    // Exactly the first three candidates are in flight...
    expect(started).toEqual(POPULAR_HEAD_EXCLUDING_MAINNET.slice(0, 3));
    // ...and one more starts only after a slot frees.
    release.get(137)!();
    await tick();
    expect(started).toEqual([...POPULAR_HEAD_EXCLUDING_MAINNET.slice(0, 3), 8453]);
    expect(maxActive).toBeLessThanOrEqual(3);

    for (const chainId of POPULAR_HEAD_EXCLUDING_MAINNET) {
      release.get(chainId)?.();
    }
    expect(await settled).toHaveLength(POPULAR_HEAD_EXCLUDING_MAINNET.length);
    expect(maxActive).toBe(3);
  });
});

describe('orderProbeResults', () => {
  it('orders USD-known outcomes by value descending, unknowns after', () => {
    const outcomes: ProbeOutcome[] = [
      okOutcome(10, 5n),
      okOutcome(56, 1n),
      okOutcome(137, 2n),
      { status: 'failed', chainId: 42161, reason: 'x' },
    ];
    const ordered = orderProbeResults(outcomes, chainId =>
      chainId === 137 ? 5 : chainId === 56 ? 50 : null,
    );
    expect(ordered.map(outcome => outcome.chainId)).toEqual([56, 137, 10, 42161]);
  });

  it('tiebreaks equal USD values (and all-unknown sets) by chainId', () => {
    const outcomes = [okOutcome(137, 9n), okOutcome(10, 1n), okOutcome(56, 4n)];
    expect(
      orderProbeResults(outcomes, () => null).map(o => o.chainId),
    ).toEqual([10, 56, 137]);
    expect(
      orderProbeResults(outcomes, () => 7).map(o => o.chainId),
    ).toEqual([10, 56, 137]);
  });

  it('treats a non-finite USD value as unknown, never as a sortable number', () => {
    const outcomes = [okOutcome(137, 1n), okOutcome(56, 1n)];
    const ordered = orderProbeResults(outcomes, chainId =>
      chainId === 137 ? Number.NaN : null,
    );
    expect(ordered.map(outcome => outcome.chainId)).toEqual([56, 137]);
  });

  it('never compares raw balances: identical USD values order by chainId regardless of balance', () => {
    const outcomes = [okOutcome(137, 1_000_000n), okOutcome(56, 1n)];
    const ordered = orderProbeResults(outcomes, () => 3);
    expect(ordered.map(outcome => outcome.chainId)).toEqual([56, 137]);
  });
});
