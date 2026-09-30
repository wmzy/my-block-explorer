// RpcManager log redaction: RPC endpoint URLs — user-configured ones
// above all — routinely embed provider API keys in the path or query
// (Alchemy/Infura style), so the manager's info logs must carry the HOST
// plus a user-config/viem-default discriminator, never the full URL
// (the webhookHostForLog convention from WatchService). An unparseable
// configured URL logs as '<invalid-url>' instead of throwing. The
// drizzle layer is faked (rpcManagerCustomChains.test.ts pattern); viem
// transports are lazy, so no network is touched.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getDefaultRpcUrl } from '@/config/chains';

const logs = vi.hoisted(() => ({
  info: [] as Array<{ module: string; payload: unknown; message: string }>,
}));

vi.mock('@/server/logger', () => ({
  createLogger: (module: string) => ({
    info: (payload: unknown, message: string) => {
      logs.info.push({ module, payload, message });
    },
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  }),
}));

const dbState = vi.hoisted(() => ({
  rpcConfigRows: [] as Array<Record<string, unknown>>,
  customChainRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/database/drizzle', async () => {
  const { userRpcConfigs, customChains } = await import('@/database/schema');
  const S = dbState;

  return {
    db: {
      select: () => {
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
          then: (res: unknown, rej: unknown) =>
            Promise.resolve(rows === undefined ? [] : [...rows]).then(
              res as never,
              rej as never,
            ),
        };
        return b;
      },
      insert: () => {
        throw new Error('unexpected insert in log-redaction test');
      },
      delete: () => {
        throw new Error('unexpected delete in log-redaction test');
      },
    },
  };
});

vi.mock('@/database/seedBuiltinLabels', () => ({
  seedBuiltinLabels: vi.fn(async () => undefined),
}));

import { RpcManager } from '@/services/RpcManager';

const SECRET_URL = 'https://eth-mainnet.g.alchemy.com/v2/SECRET-API-KEY-xyz';

// All rpc-manager info payloads recorded so far, stringified for scanning.
const loggedText = (): string => JSON.stringify(logs.info);

const payloadFor = (message: string): Record<string, unknown> => {
  const hit = logs.info.find(l => l.module === 'rpc-manager' && l.message === message);
  expect(hit, `expected an info log '${message}'`).toBeDefined();
  return hit!.payload as Record<string, unknown>;
};

beforeEach(() => {
  vi.clearAllMocks();
  logs.info.length = 0;
  dbState.rpcConfigRows.length = 0;
  dbState.customChainRows.length = 0;
});

describe('RpcManager log redaction', () => {
  it('logs a user-configured URL as host + discriminator, never the URL or its key', async () => {
    dbState.rpcConfigRows.push({ chainId: 1, url: SECRET_URL });

    const manager = new RpcManager();
    await manager.getClient(1);

    const configLog = payloadFor('RPC config');
    expect(configLog.configFound).toBe(true);
    expect(configLog.rpcSource).toBe('user-config');
    expect(configLog.rpcHost).toBe('eth-mainnet.g.alchemy.com');
    expect(Object.keys(configLog)).not.toContain('customRpc');

    const clientLog = payloadFor('Creating client with RPC URL');
    expect(clientLog.rpcSource).toBe('user-config');
    expect(clientLog.rpcHost).toBe('eth-mainnet.g.alchemy.com');
    expect(Object.keys(clientLog)).not.toContain('rpcUrl');

    // Nothing the manager logged anywhere carries the secret or the path.
    expect(loggedText()).not.toContain('SECRET');
    expect(loggedText()).not.toContain('/v2/');
    expect(loggedText()).not.toContain(SECRET_URL);
  });

  it('labels the viem default as \'viem-default\' with its host', async () => {
    const manager = new RpcManager();
    await manager.getClient(1);

    const clientLog = payloadFor('Creating client with RPC URL');
    expect(clientLog.rpcSource).toBe('viem-default');
    expect(clientLog.rpcHost).toBe(new URL(getDefaultRpcUrl(1)).host);
    expect(loggedText()).not.toContain(getDefaultRpcUrl(1));
  });

  it('logs an unparseable configured URL as \'<invalid-url>\' instead of throwing', async () => {
    dbState.rpcConfigRows.push({ chainId: 1, url: 'not a valid url' });

    const manager = new RpcManager();
    // Client creation may honestly fail on the bad URL; the log fires first.
    await manager.getClient(1).catch(() => undefined);

    const clientLog = payloadFor('Creating client with RPC URL');
    expect(clientLog.rpcSource).toBe('user-config');
    expect(clientLog.rpcHost).toBe('<invalid-url>');
  });
});
