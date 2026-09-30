// RpcManager getClient in-flight dedupe: concurrent first-touch callers
// must share ONE createClient invocation — the pre-fix check-then-act let
// every racer build its own client and silently discard the losers' while
// their requests still held them. A failed creation shares one RpcError
// with every awaiter and is retried on the next call (the in-flight entry
// is dropped on settle, never poisoning the chain), and reloadConfigs
// drops cached clients only AFTER the new configs land (atomic swap).
// The drizzle layer is faked (rpcManagerCustomChains.test.ts pattern).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicClient } from 'viem';
import { resetCustomChainsForTests } from '@/config/customChains';

vi.mock('@/database/drizzle', () => ({
  db: {
    // Both config tables read as empty: no user RPC rows, no custom
    // chains — getClient falls back to viem's default for chain 1.
    select: () => {
      const chainable = {
        from: () => chainable,
        where: () => chainable,
        then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
      };
      return chainable;
    },
    insert: () => {
      throw new Error('unexpected insert in dedupe test');
    },
    delete: () => {
      throw new Error('unexpected delete in dedupe test');
    },
  },
}));

// Startup label seeding is out of scope here (own test file).
vi.mock('@/database/seedBuiltinLabels', () => ({
  seedBuiltinLabels: vi.fn(async () => undefined),
}));

import { RpcManager } from '@/services/RpcManager';

// createClient is private; the spy goes through a minimal structural
// view of the instance (no `as any`).
const spyCreateClient = (manager: RpcManager) =>
  vi.spyOn(
    manager as unknown as { createClient: (chainId: number) => Promise<PublicClient> },
    'createClient',
  );

beforeEach(() => {
  vi.clearAllMocks();
  resetCustomChainsForTests();
});

describe('RpcManager - concurrent getClient dedupe', () => {
  it('shares one createClient between concurrent first-touch callers', async () => {
    const manager = new RpcManager();
    const createClient = spyCreateClient(manager);

    const [a, b, c] = await Promise.all([
      manager.getClient(1),
      manager.getClient(1),
      manager.getClient(1),
    ]);

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(b).toBe(c);

    // Cached afterwards: no further creation.
    await manager.getClient(1);
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it('shares one rejection with every awaiter and retries afterwards', async () => {
    const manager = new RpcManager();
    const createClient = spyCreateClient(manager);
    createClient.mockRejectedValueOnce(new Error('boom'));

    await expect(Promise.all([manager.getClient(1), manager.getClient(1)])).rejects.toThrow(
      'Failed to create RPC client for chain 1',
    );
    expect(createClient).toHaveBeenCalledTimes(1);

    // The failed in-flight entry was cleaned up on settle: the next call
    // retries creation instead of joining the dead promise.
    await expect(manager.getClient(1)).resolves.toBeDefined();
    expect(createClient).toHaveBeenCalledTimes(2);
  });

  it('drops cached clients only after reloadConfigs lands new configs', async () => {
    const manager = new RpcManager();
    const createClient = spyCreateClient(manager);

    await manager.getClient(1);
    expect(createClient).toHaveBeenCalledTimes(1);

    // The reload swaps the config map first and clears the client cache
    // after the load — a fresh creation follows on the next touch.
    await manager.reloadConfigs();
    await manager.getClient(1);
    expect(createClient).toHaveBeenCalledTimes(2);
  });
});
