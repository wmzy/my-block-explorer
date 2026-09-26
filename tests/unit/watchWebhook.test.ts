// Webhook helpers contract (utils/webhooks.ts): the generic payload
// builder (exact key set, honest eventName/args for known vs unknown
// topic0, bigint→decimal-string args, chain:txHash:logIndex id), the
// Discord message shape, the URL predicate, and the fetch sender's
// never-throw behavior with its ONE-retry wrapper (fetch is stubbed;
// the timeout classification is exercised through a tiny budget).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAddress, getEventSelector, toHex, type Log } from 'viem';
import {
  buildDiscordMessage,
  buildWebhookPayload,
  fetchWebhookSender,
  isDiscordWebhookUrl,
  sendWebhookWithRetry,
  shortWebhookReason,
  summarizeArgsForEmbed,
  toJsonSafeValue,
  webhookEventId,
  WATCH_WEBHOOK_TIMEOUT_MS,
} from '@/utils/webhooks';

const ADDRESS = '0x1111111111111111111111111111111111111111';
const COUNTERPARTY = '0x2222222222222222222222222222222222222222';
const TX_HASH = '0xabc0000000000000000000000000000000000000000000000000000000000def';
const TRANSFER_TOPIC0 = getEventSelector('Transfer(address,address,uint256)');

const paddedAddressTopic = (address: string): `0x${string}` =>
  `0x${'0'.repeat(24)}${address.slice(2)}` as `0x${string}`;

const hexTopic = (hex: string): `0x${string}` => `0x${hex}`;

const transferLog = (over: Partial<Log> = {}): Log =>
  ({
    address: ADDRESS,
    topics: [TRANSFER_TOPIC0, paddedAddressTopic(ADDRESS), paddedAddressTopic(COUNTERPARTY)],
    data: toHex(1_000_000n, { size: 32 }),
    blockNumber: 1_234_567n,
    transactionHash: TX_HASH,
    transactionIndex: 3,
    blockHash: '0xblock00000000000000000000000000000000000000000000000000000d',
    logIndex: 7,
    removed: false,
    ...over,
  }) satisfies Log;

const unknownLog = (): Log =>
  ({
    ...transferLog(),
    topics: [hexTopic('ab'.repeat(32)), hexTopic('11'.repeat(32))],
    data: '0xdeadbeef',
  }) satisfies Log;

describe('webhookEventId — dedupe basis', () => {
  it('formats as chain:txHash:logIndex', () => {
    expect(webhookEventId(1, TX_HASH, 7)).toBe(`1:${TX_HASH}:7`);
  });

  it('degrades pending-log races to the SSE sentinels, not fabricated values', () => {
    expect(webhookEventId(137, null, null)).toBe('137:tx?:-1');
  });
});

describe('buildWebhookPayload — generic shape', () => {
  it('carries exactly the contract keys with decoded args for a known event', () => {
    const at = new Date('2026-09-25T10:00:00.000Z');
    const payload = buildWebhookPayload(1, ADDRESS.toUpperCase(), transferLog(), at);
    expect(Object.keys(payload).sort()).toEqual(
      ['address', 'args', 'blockNumber', 'chainId', 'detectedAt', 'eventName', 'id', 'logIndex', 'transactionHash'].sort(),
    );
    expect(payload.id).toBe(`1:${TX_HASH}:7`);
    expect(payload.chainId).toBe(1);
    expect(payload.address).toBe(ADDRESS);
    expect(payload.eventName).toBe('Transfer');
    expect(payload.blockNumber).toBe('1234567');
    expect(payload.transactionHash).toBe(TX_HASH);
    expect(payload.logIndex).toBe(7);
    expect(payload.detectedAt).toBe('2026-09-25T10:00:00.000Z');
  });

  it('decodes well-known event args with bigints as decimal strings (JSON-safe)', () => {
    const payload = buildWebhookPayload(1, ADDRESS, transferLog());
    expect(payload.args).toEqual({
      from: getAddress(ADDRESS),
      to: getAddress(COUNTERPARTY),
      value: '1000000',
    });
    // The whole payload must survive a JSON round-trip (bigint-free).
    expect(() => JSON.stringify(payload)).not.toThrow();
    expect(JSON.parse(JSON.stringify(payload)).args.value).toBe('1000000');
  });

  it('is honest about unknown signatures: eventName null, raw envelope as args', () => {
    const payload = buildWebhookPayload(137, ADDRESS, unknownLog());
    expect(payload.eventName).toBeNull();
    expect(payload.args).toEqual({
      topics: [`0x${'ab'.repeat(32)}`, `0x${'11'.repeat(32)}`],
      data: '0xdeadbeef',
    });
  });

  it('degrades missing ids the way the feed does (never fabricated)', () => {
    const payload = buildWebhookPayload(
      1,
      ADDRESS,
      transferLog({ blockNumber: null, transactionHash: null, logIndex: null }),
    );
    expect(payload.blockNumber).toBe('0');
    expect(payload.transactionHash).toBeNull();
    expect(payload.logIndex).toBeNull();
    expect(payload.id).toBe('1:tx?:-1');
  });
});

describe('toJsonSafeValue — bigint walker', () => {
  it('stringifies bigints recursively and leaves other values untouched', () => {
    expect(toJsonSafeValue(42n)).toBe('42');
    expect(toJsonSafeValue([1n, { nested: 7n }, 'x'])).toEqual(['1', { nested: '7' }, 'x']);
    expect(toJsonSafeValue('plain')).toBe('plain');
    expect(toJsonSafeValue(null)).toBeNull();
  });
});

describe('isDiscordWebhookUrl — Discord detection', () => {
  it('accepts discord.com/api/webhooks paths (www included)', () => {
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/token')).toBe(true);
    expect(isDiscordWebhookUrl('https://www.discord.com/api/webhooks/123/token')).toBe(true);
    expect(isDiscordWebhookUrl('https://discord.com/api/webhooks/123/token?wait=true')).toBe(true);
  });

  it('rejects everything else — other hosts, non-webhook paths, http, garbage', () => {
    expect(isDiscordWebhookUrl('https://example.com/api/webhooks/123')).toBe(false);
    expect(isDiscordWebhookUrl('https://discord.com/api/v9/channels')).toBe(false);
    expect(isDiscordWebhookUrl('http://discord.com/api/webhooks/123/token')).toBe(false);
    expect(isDiscordWebhookUrl('not a url')).toBe(false);
    expect(isDiscordWebhookUrl('')).toBe(false);
  });
});

describe('buildDiscordMessage — Discord embed shape', () => {
  const payload = buildWebhookPayload(1, ADDRESS, transferLog(), new Date('2026-09-25T10:00:00.000Z'));

  it('sends a one-line content summary plus a titled, linked embed', () => {
    const message = buildDiscordMessage(payload, 'https://etherscan.io/tx/0xabc');
    expect(message.content).not.toContain('\n');
    expect(message.content).toContain(ADDRESS);
    expect(message.content).toContain('Transfer');
    expect(message.content).toContain('1234567');
    expect(message.embeds).toHaveLength(1);
    expect(message.embeds[0].title).toBe('Transfer');
    expect(message.embeds[0].description).toContain('value=1000000');
    expect(message.embeds[0].url).toBe('https://etherscan.io/tx/0xabc');
  });

  it('omits the embed url when there is no tx hash to link to', () => {
    const pending = buildWebhookPayload(
      1,
      ADDRESS,
      transferLog({ transactionHash: null }),
    );
    const message = buildDiscordMessage(pending, null);
    expect(message.embeds[0].url).toBeUndefined();
    expect(message.embeds[0].title).toBe('Transfer');
  });

  it('titles unknown-signature events honestly instead of guessing', () => {
    const unknown = buildWebhookPayload(1, ADDRESS, unknownLog());
    const message = buildDiscordMessage(unknown, null);
    expect(message.embeds[0].title).toBe('Event (unknown signature)');
    expect(message.embeds[0].description).toContain('data=0xdeadbeef');
  });
});

describe('summarizeArgsForEmbed — bounded description', () => {
  it('truncates past the budget with an honest ellipsis', () => {
    const summary = summarizeArgsForEmbed({ data: `0x${'ff'.repeat(2_000)}` });
    expect(summary.length).toBeLessThanOrEqual(900);
    expect(summary.endsWith('…')).toBe(true);
  });
});

describe('shortWebhookReason — bounded reasons', () => {
  it('collapses whitespace and caps length', () => {
    expect(shortWebhookReason('a\n  b')).toBe('a b');
    expect(shortWebhookReason('x'.repeat(200)).length).toBe(80);
  });
});

describe('fetchWebhookSender — never throws', () => {
  const URL_ENDPOINT = 'https://example.com/hook';
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('POSTs a JSON body and reports 2xx as ok', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    const result = await fetchWebhookSender(URL_ENDPOINT, { hello: 'world' });
    expect(result).toEqual({ ok: true, status: 204 });
    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(URL_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.headers['content-type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ hello: 'world' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('maps non-2xx to a short HTTP reason', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 });
    const result = await fetchWebhookSender(URL_ENDPOINT, {});
    expect(result).toEqual({ ok: false, reason: 'HTTP 404' });
  });

  it('classifies an abort within the budget as a timeout', async () => {
    // A fetch implementation that honors the abort signal the way
    // undici does (rejects on abort); a 10ms budget keeps it fast.
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' }));
          });
        }),
    );
    const result = await fetchWebhookSender(URL_ENDPOINT, {}, 10);
    expect(result).toEqual({ ok: false, reason: 'timeout' });
  });

  it('maps a thrown fetch to a short reason instead of throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const result = await fetchWebhookSender(URL_ENDPOINT, {});
    expect(result).toEqual({ ok: false, reason: 'fetch failed' });
  });
});

describe('sendWebhookWithRetry — one retry, then record', () => {
  it('returns the first success without a retry', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const result = await sendWebhookWithRetry('https://x.example/hook', { a: 1 }, sender);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(sender).toHaveBeenCalledTimes(1);
  });

  it('retries exactly once after a failure', async () => {
    const sender = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, reason: 'HTTP 500' })
      .mockResolvedValueOnce({ ok: true, status: 200 });
    const result = await sendWebhookWithRetry('https://x.example/hook', {}, sender);
    expect(result).toEqual({ ok: true, status: 200 });
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('gives up after the single retry and reports the final reason', async () => {
    const sender = vi.fn().mockResolvedValue({ ok: false, reason: 'HTTP 500' });
    const result = await sendWebhookWithRetry('https://x.example/hook', {}, sender);
    expect(result).toEqual({ ok: false, reason: 'HTTP 500' });
    expect(sender).toHaveBeenCalledTimes(2);
  });

  it('propagates a throwing sender (the per-delivery catch lives in WatchService)', async () => {
    // sendWebhookWithRetry trusts the sender's never-throw contract; a
    // broken sender surfaces to WatchService's per-delivery try/catch,
    // which records it as a failed status (watchWebhookDelivery.test.ts).
    const sender = vi.fn().mockRejectedValue(new Error('sender exploded'));
    await expect(sendWebhookWithRetry('https://x.example/hook', {}, sender)).rejects.toThrow(
      'sender exploded',
    );
  });

  it('defaults the per-attempt budget to the 5s contract', () => {
    expect(WATCH_WEBHOOK_TIMEOUT_MS).toBe(5_000);
  });
});
