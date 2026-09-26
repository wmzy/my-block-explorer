// WatchService webhook-delivery wiring: the tick loop's per-event POSTs
// for subscriptions with a webhookUrl (generic payload vs Discord
// embed), the retry budget, honest status recording
// (webhookStatus/webhookLastAt on the row), replay dedupe on the
// chain:txHash:logIndex basis, never-fatal failures — and the pinned
// byte-identity of the zero-webhook path (exactly today's one cursor
// update, no sender calls). db and RpcManager are stubbed; the webhook
// sender is injected as a fake (the seam WatchService's constructor
// exposes for exactly this).
import { describe, it, expect, vi } from 'vitest';
import { getEventSelector, toHex, type Log } from 'viem';

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: unknown; set: Record<string, unknown> }>,
  client: {} as { getBlockNumber: () => Promise<bigint>; getLogs: () => Promise<Log[]> },
}));

vi.mock('@/database/drizzle', () => ({
  db: {
    select: () => ({
      from: () => {
        const query = {
          where: async () => state.rows,
          then: (
            resolve: (value: unknown) => unknown,
            reject: (reason: unknown) => unknown,
          ) => Promise.resolve(state.rows).then(resolve, reject),
        };
        return query;
      },
    }),
    update: (table: unknown) => ({
      set: (fields: Record<string, unknown>) => ({
        where: async () => {
          state.updates.push({ table, set: fields });
        },
      }),
    }),
    insert: () => {
      throw new Error('insert is not part of these tests');
    },
    delete: () => {
      throw new Error('delete is not part of these tests');
    },
  },
}));

vi.mock('@/services/RpcManager', () => ({
  rpcManager: {
    getClient: async () => state.client,
  },
}));

import { WatchService } from '@/services/WatchService';
import type { WebhookSender } from '@/utils/webhooks';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const TX_HASH = '0xabc0000000000000000000000000000000000000000000000000000000000def';
const TRANSFER_TOPIC0 = getEventSelector('Transfer(address,address,uint256)');
const WEBHOOK_URL = 'https://example.com/hook';
const DISCORD_URL = 'https://discord.com/api/webhooks/123/token';

const paddedAddressTopic = (address: string): `0x${string}` =>
  `0x${'0'.repeat(24)}${address.slice(2)}` as `0x${string}`;

const transferLog = (): Log =>
  ({
    address: ADDRESS,
    topics: [TRANSFER_TOPIC0, paddedAddressTopic(ADDRESS), paddedAddressTopic(ADDRESS)],
    data: toHex(5n, { size: 32 }),
    blockNumber: 100n,
    transactionHash: TX_HASH,
    transactionIndex: 0,
    blockHash: '0xblock00000000000000000000000000000000000000000000000000000d',
    logIndex: 7,
    removed: false,
  }) satisfies Log;

// A subscription row due for a 99→100 sweep (one log inside).
const subscriptionRow = (webhookUrl: string | null): Record<string, unknown> => ({
  chainId: 1,
  address: ADDRESS,
  label: null,
  lastProcessedBlock: 99n,
  webhookUrl,
  webhookStatus: null,
  webhookLastAt: null,
  createdAt: new Date('2026-09-25T09:00:00.000Z'),
  updatedAt: new Date('2026-09-25T09:00:00.000Z'),
});

const makeService = (sender: WebhookSender) => new WatchService({ webhookSender: sender });

const primeOneSub = (webhookUrl: string | null): void => {
  state.rows = [subscriptionRow(webhookUrl)];
  state.updates = [];
  state.client = {
    getBlockNumber: async () => 100n,
    getLogs: async () => [transferLog()],
  };
};

const okSender = () => vi.fn().mockResolvedValue({ ok: true, status: 204 });

describe('WatchService webhook delivery — zero-webhook path is unchanged', () => {
  it('never calls the sender and writes exactly the cursor update (pinned)', async () => {
    const sender = okSender();
    primeOneSub(null);
    const service = makeService(sender);

    await service.tick();

    expect(sender).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
    expect(Object.keys(state.updates[0].set).sort()).toEqual(['lastProcessedBlock', 'updatedAt']);
    expect(state.updates[0].set.lastProcessedBlock).toBe(100n);
  });

  it('skips delivery entirely for an empty-string webhookUrl (defensive)', async () => {
    const sender = okSender();
    primeOneSub('');
    await makeService(sender).tick();
    expect(sender).not.toHaveBeenCalled();
  });
});

describe('WatchService webhook delivery — happy path', () => {
  it('POSTs the generic payload once and records ok + lastAt on the row', async () => {
    const sender = okSender();
    primeOneSub(WEBHOOK_URL);
    const service = makeService(sender);

    await service.tick();

    expect(sender).toHaveBeenCalledTimes(1);
    const [url, body] = sender.mock.calls[0];
    expect(url).toBe(WEBHOOK_URL);
    expect((body as { id: string }).id).toBe(`1:${TX_HASH}:7`);
    expect((body as { eventName: string | null }).eventName).toBe('Transfer');
    expect((body as { args: { value: string } }).args.value).toBe('5');

    // Delivery status update first (inside the at-least-once window),
    // then the cursor move.
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0].set.webhookStatus).toBe('ok');
    expect(state.updates[0].set.webhookLastAt).toBeInstanceOf(Date);
    expect(state.updates[1].set.lastProcessedBlock).toBe(100n);
  });

  it('sends the Discord embed shape (content + linked embed) for discord.com webhooks', async () => {
    const sender = okSender();
    primeOneSub(DISCORD_URL);
    await makeService(sender).tick();

    expect(sender).toHaveBeenCalledTimes(1);
    const [url, body] = sender.mock.calls[0];
    expect(url).toBe(DISCORD_URL);
    const message = body as { content: string; embeds: { title: string; url: string }[] };
    expect(typeof message.content).toBe('string');
    expect(message.embeds).toHaveLength(1);
    expect(message.embeds[0].title).toBe('Transfer');
    // Chain 1's default explorer link (config/externalTools).
    expect(message.embeds[0].url).toBe(`https://etherscan.io/tx/${TX_HASH}`);
  });
});

describe('WatchService webhook delivery — honest failures', () => {
  it('retries exactly once, then records failed: <reason> (and still moves the cursor)', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: false, reason: 'HTTP 500' });
    primeOneSub(WEBHOOK_URL);

    await makeService(sender).tick();

    expect(sender).toHaveBeenCalledTimes(2);
    expect(state.updates[0].set.webhookStatus).toBe('failed: HTTP 500');
    expect(state.updates[0].set.webhookLastAt).toBeInstanceOf(Date);
    expect(state.updates[1].set.lastProcessedBlock).toBe(100n);
  });

  it('marks the sweep failed when ANY event stays failed (a later ok must not paint over it)', async () => {
    const secondLog: Log = { ...transferLog(), logIndex: 8 };
    primeOneSub(WEBHOOK_URL);
    state.client = {
      getBlockNumber: async () => 100n,
      getLogs: async () => [transferLog(), secondLog],
    };
    // First event: fail both attempts. Second event: delivered.
    const sender = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'HTTP 429' })
      .mockResolvedValueOnce({ ok: false, reason: 'HTTP 429' })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    await makeService(sender).tick();

    expect(sender).toHaveBeenCalledTimes(3);
    expect(state.updates[0].set.webhookStatus).toBe('failed: HTTP 429');
  });

  it('survives a sender that throws (contract violation): records, never crashes the tick', async () => {
    const sender = vi.fn().mockRejectedValue(new Error('sender exploded'));
    primeOneSub(WEBHOOK_URL);

    await expect(makeService(sender).tick()).resolves.toBeUndefined();

    expect(sender).toHaveBeenCalledTimes(1);
    expect(state.updates[0].set.webhookStatus).toBe('failed: sender exploded');
    expect(state.updates[1].set.lastProcessedBlock).toBe(100n);
  });
});

describe('WatchService webhook delivery — replay dedupe', () => {
  it('does not re-POST ids already delivered when a range replays', async () => {
    const sender = okSender();
    primeOneSub(WEBHOOK_URL);
    const service = makeService(sender);

    await service.tick();
    // The mocked db never persists the cursor, so the second tick
    // replays the SAME range (the at-least-once crash window): the SSE
    // feed sees the events again, but the webhook must not.
    await service.tick();

    expect(sender).toHaveBeenCalledTimes(1);
    // And no second status update — nothing was attempted.
    const statusUpdates = state.updates.filter(update => 'webhookStatus' in update.set);
    expect(statusUpdates).toHaveLength(1);
  });
});

describe('WatchService webhook delivery — fresh subscription baselines without POSTs', () => {
  it('baselines a null-cursor row at the head and delivers nothing', async () => {
    const sender = okSender();
    const row = subscriptionRow(WEBHOOK_URL);
    row.lastProcessedBlock = null;
    state.rows = [row];
    state.updates = [];
    state.client = {
      getBlockNumber: async () => 100n,
      getLogs: async () => [transferLog()],
    };

    await makeService(sender).tick();

    expect(sender).not.toHaveBeenCalled();
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set.lastProcessedBlock).toBe(100n);
  });
});
