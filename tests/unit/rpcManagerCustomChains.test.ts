// RpcManager startup bootstrap for custom chains: rows in custom_chains
// register into the runtime chain registry (getChainInfo resolves the id
// process-wide) AND feed the per-chain RPC fallback exactly the way
// userRpcConfigs rows do — with a user RPC override still winning over
// the chain's own registration URL. Registry reconciliation drops ids
// whose rows disappeared (the DELETE path). A database failure degrades
// to "no custom chains" instead of crashing. The drizzle layer is faked
// (labelsRoutes.test.ts pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getChainInfo } from '@/config/chains';
import { resetCustomChainsForTests } from '@/config/customChains';

const dbState = vi.hoisted(() => ({
  rpcConfigRows: [] as Array<Record<string, unknown>>,
  customChainRows: [] as Array<Record<string, unknown>>,
  // When set, the custom_chains select rejects (failure-path tests).
  failCustomChains: false,
  // Spy for the built-in label seeding hook (mocked module below).
  seedLabels: vi.fn(async () => undefined),
}));

vi.mock('@/database/drizzle', async () => {
  const { userRpcConfigs, customChains } = await import('@/database/schema');
  const S = dbState;

  return {
    db: {
      select: () => {
        // Table identity decides which row set then() resolves.
        let rows: Array<Record<string, unknown>> | undefined;
        let isCustomTable = false;
        const b: Record<string, unknown> = {
          from: (t: unknown) => {
            if (t !== userRpcConfigs && t !== customChains) {
              throw new Error('unexpected select table');
            }
            isCustomTable = t === customChains;
            rows = isCustomTable ? S.customChainRows : S.rpcConfigRows;
            return b;
          },
          where: () => b,
          then: (res: unknown, rej: unknown) => {
            const settle
              = rows === undefined
                ? Promise.resolve([])
                : isCustomTable && S.failCustomChains
                  ? Promise.reject(new Error('table custom_chains does not exist'))
                  : Promise.resolve([...rows]);
            return settle.then(res as never, rej as never);
          },
        };
        return b;
      },
      insert: () => {
        throw new Error('unexpected insert in bootstrap test');
      },
      delete: () => {
        throw new Error('unexpected delete in bootstrap test');
      },
    },
  };
});

import { RpcManager } from '@/services/RpcManager';

// loadUserConfigs also fires built-in label seeding; mocked away so this
// file stays scoped to the custom-chain bootstrap (the seeder has its own
// test file) while keeping the mocked db strict about unexpected tables.
vi.mock('@/database/seedBuiltinLabels', () => ({
  seedBuiltinLabels: dbState.seedLabels,
}));

const ANVIL_ROW = {
  chainId: 31337,
  name: 'Anvil Local',
  symbol: 'ETH',
  rpcUrl: 'http://127.0.0.1:8546',
  decimals: 9,
};

// Awaits the manager's initial config load (getClient awaits it too, but
// a chain that cannot resolve would throw before we care).
const whenConfigsReady = async (manager: RpcManager): Promise<void> => {
  await manager.getClient(31337).catch(() => undefined);
};

beforeEach(() => {
  vi.clearAllMocks();
  dbState.rpcConfigRows.length = 0;
  dbState.customChainRows.length = 0;
  dbState.failCustomChains = false;
  resetCustomChainsForTests();
});

describe('RpcManager custom-chain bootstrap', () => {
  it('registers custom_chains rows and serves their RPC URL', async () => {
    dbState.customChainRows.push(ANVIL_ROW);

    const manager = new RpcManager();
    await whenConfigsReady(manager);

    expect(getChainInfo(31337)?.name).toBe('Anvil Local');
    expect(getChainInfo(31337)?.nativeCurrency.decimals).toBe(9);
    expect(manager.getUserRpcConfig(31337)?.customRpcUrl).toBe('http://127.0.0.1:8546');
  });

  it('a user RPC override for the same id wins over the registration URL', async () => {
    dbState.rpcConfigRows.push({ chainId: 31337, url: 'http://override:9999' });
    dbState.customChainRows.push(ANVIL_ROW);

    const manager = new RpcManager();
    await whenConfigsReady(manager);

    expect(getChainInfo(31337)?.name).toBe('Anvil Local');
    expect(manager.getUserRpcConfig(31337)?.customRpcUrl).toBe('http://override:9999');
  });

  it('reloadConfigs reconciles the registry when a row disappears', async () => {
    dbState.customChainRows.push(ANVIL_ROW);
    const manager = new RpcManager();
    await whenConfigsReady(manager);
    expect(getChainInfo(31337)?.name).toBe('Anvil Local');

    dbState.customChainRows.length = 0;
    await manager.reloadConfigs();

    // viem's own placeholder answer returns once the registration is gone.
    expect(getChainInfo(31337)?.name).toBe('Anvil');
    expect(manager.getUserRpcConfig(31337)).toBeUndefined();
  });

  it('a database failure degrades to no custom chains instead of throwing', async () => {
    dbState.failCustomChains = true;

    const manager = new RpcManager();
    await whenConfigsReady(manager);

    // No registration happened; viem's placeholder still serves and the
    // constructor path never surfaced the error.
    expect(getChainInfo(31337)?.name).toBe('Anvil');
    expect(manager.getUserRpcConfig(31337)).toBeUndefined();
  });

  it('fires built-in label seeding once per config load (first-startup hook)', async () => {
    const manager = new RpcManager();
    await whenConfigsReady(manager);

    expect(dbState.seedLabels).toHaveBeenCalledTimes(1);

    // A reload re-runs the whole bootstrap — the seeder's own
    // first-startup gating makes the repeat call a no-op.
    dbState.seedLabels.mockClear();
    await manager.reloadConfigs();
    expect(dbState.seedLabels).toHaveBeenCalledTimes(1);
  });
});
