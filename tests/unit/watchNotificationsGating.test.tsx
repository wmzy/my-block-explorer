// src/index.tsx watch-notification wiring (wireWatchNotifications): the
// SSE subscription is permission-GATED at subscription time — 'denied'
// and 'default' never open the stream (the old code subscribed always
// and dropped events inside notify()), 'granted' subscribes, and the
// Permissions API's per-status 'change' event re-evaluates immediately
// both ways (no engine dispatches a document-level 'permissionchange').
// The chain poll that re-resolves the remembered chain runs ONLY while
// granted, and the api-base change trigger is preserved end-to-end.
//
// src/index.tsx is an import-once app entry (module-scope createRoot +
// app-lifetime listeners), so this suite is one ordered scenario around
// a single import with fake timers — a second import would stack a
// second 'change' listener on the shared Permissions double.
//
// Driven through the REAL modules (vi.mock aliases do not reliably reach
// this module graph's imports): the real apiBase module's setApiBase
// fires the real onApiBaseChange listeners, the real remembered-chain
// key drives the real Landing helpers, and the real subscribeWatchEvents
// opens the FakeEventSource global — only react-dom/client is stubbed so
// the module-scope createRoot does not mount the app.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { setApiBase } from '@/util/apiBase';
import type { LiveWatchEvent } from '@/services/liveChain';

vi.mock('react-dom/client', () => ({ createRoot: () => ({ render: vi.fn() }) }));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  closed = false;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, Set<(event: { data: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }
}

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn();
  static instances: Array<{ title: string; tag: string | undefined }> = [];
  title: string;
  tag: string | undefined;
  constructor(title: string, options?: { tag?: string }) {
    this.title = title;
    this.tag = options?.tag;
    FakeNotification.instances.push({ title, tag: options?.tag });
  }
}

const BASE = 'http://backend.test';
const CHAIN_KEY = 'be:lastChainId';

// Minimal Permissions-API double: index.tsx queries the notifications
// status once at import and attaches its re-evaluate to the status's
// 'change' event — the only real permission-flip signal (jsdom ships no
// navigator.permissions, so the double stands in for it).
const permissionChangeListeners = new Set<() => void>();
const permissionsDouble = {
  query: () =>
    Promise.resolve({
      addEventListener: (_type: 'change', listener: () => void) => {
        permissionChangeListeners.add(listener);
      },
    }),
};

const dispatchPermissionChange = (): void => {
  for (const listener of permissionChangeListeners) listener();
};

const streamUrls = (): string[] => FakeEventSource.instances.map(source => source.url);

describe('watch notification SSE gating (src/index.tsx wireWatchNotifications)', () => {
  beforeAll(async () => {
    vi.useFakeTimers();
    const rootEl = document.createElement('div');
    rootEl.id = 'root';
    document.body.appendChild(rootEl);
    localStorage.setItem(CHAIN_KEY, '1');
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('Notification', FakeNotification);
    // Install BEFORE the import: the module wires its status 'change'
    // listener at import time.
    Object.assign(navigator, { permissions: permissionsDouble });
    FakeNotification.permission = 'default';
    // The global setup file set a base; own it from here on. Import with
    // permission 'default' and a perfectly valid base+chain — the gate
    // must keep the stream closed anyway.
    setApiBase(BASE);
    await import('@/index');
  });

  afterAll(() => {
    // Tear down in dependency order: the final setApiBase fires the live
    // evaluate one last time, so the Notification/EventSource stubs must
    // still exist (flip to denied first so it fully stops), and only then
    // drop the stubs and the fake clock.
    FakeNotification.permission = 'denied';
    setApiBase('');
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'permissions');
  });

  it('never subscribes while permission is default/denied — even with base+chain present, even across poll ticks', () => {
    expect(FakeEventSource.instances).toHaveLength(0);

    // Re-evaluations while still 'default' must not open anything.
    dispatchPermissionChange();
    expect(FakeEventSource.instances).toHaveLength(0);

    // Denied is the same honest state: no stream, no work.
    FakeNotification.permission = 'denied';
    dispatchPermissionChange();
    expect(FakeEventSource.instances).toHaveLength(0);

    // And no poll churn behind the back while ungranted.
    vi.advanceTimersByTime(30_000);
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('subscribes on the permissionchange flip to granted (current chain, one stream)', async () => {
    FakeNotification.permission = 'granted';
    dispatchPermissionChange();

    expect(streamUrls()).toEqual([`${BASE}/api/chains/1/blocks/stream`]);
    expect(FakeEventSource.instances[0].closed).toBe(false);

    // Poll ticks while granted + unchanged chain do not re-subscribe.
    vi.advanceTimersByTime(10_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('raises one browser Notification per log frame, deduped by chain:txHash:logIndex', async () => {
    const { watchEventKey } = await import('@/services/watch');
    const frame: LiveWatchEvent = {
      kind: 'log',
      chainId: 1,
      address: '0x1234567890abcdef1234567890abcdef12345678',
      blockNumber: '101',
      txHash: '0xabc0000000000000000000000000000000000000000000000000000000000def',
      logIndex: 7,
      topic0: null,
      message: null,
      at: '2026-09-30T00:00:00.000Z',
    };
    const source = FakeEventSource.instances[0];
    const wire = JSON.stringify(frame);

    source.emit('watch', wire);
    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe('Watch activity');
    expect(FakeNotification.instances[0].tag).toBe(watchEventKey(frame));

    // Re-delivery of the same event never double-notifies.
    source.emit('watch', wire);
    expect(FakeNotification.instances).toHaveLength(1);

    // Gap markers stay in the panel feed — no Notification.
    const gapFrame: LiveWatchEvent = {
      ...frame,
      kind: 'gap',
      txHash: null,
      logIndex: null,
    };
    source.emit('watch', JSON.stringify(gapFrame));
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('keeps the api-base trigger: base loss closes the stream, arrival re-opens it', () => {
    setApiBase('');
    expect(FakeEventSource.instances[0].closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);

    setApiBase(BASE);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(streamUrls()[1]).toBe(`${BASE}/api/chains/1/blocks/stream`);
    expect(FakeEventSource.instances[1].closed).toBe(false);
  });

  it('re-subscribes through the poll when the remembered chain changes (while granted)', () => {
    localStorage.setItem(CHAIN_KEY, '11155111');
    vi.advanceTimersByTime(5_000);

    expect(FakeEventSource.instances).toHaveLength(3);
    expect(streamUrls()[2]).toBe(`${BASE}/api/chains/11155111/blocks/stream`);
    expect(FakeEventSource.instances[1].closed).toBe(true);
    expect(FakeEventSource.instances[2].closed).toBe(false);
  });

  it('revoking permission tears the subscription and the poll back down', () => {
    FakeNotification.permission = 'denied';
    dispatchPermissionChange();

    expect(FakeEventSource.instances[2].closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(3);

    // No poll churn while revoked: a remembered-chain change is not even
    // observed, nothing re-opens.
    localStorage.setItem(CHAIN_KEY, '1');
    vi.advanceTimersByTime(30_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    // Granting again comes straight back through permissionchange.
    FakeNotification.permission = 'granted';
    dispatchPermissionChange();
    expect(FakeEventSource.instances).toHaveLength(4);
    expect(streamUrls()[3]).toBe(`${BASE}/api/chains/1/blocks/stream`);
  });
});
