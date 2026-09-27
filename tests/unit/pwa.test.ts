// registerPwa contract: production-only registration, BASE_URL-correct
// script URL, silent failure, and the update flow (waiting worker →
// persistent toast → SKIP_WAITING on click). The service-worker API is
// entirely faked — jsdom ships none of it — and haze-ui's toast runs on
// the setup-level module mock (shared instance, cleared per test).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { toast } from 'haze-ui';
import { registerPwa } from '@/util/pwa';

type FakeWorker = EventTarget & { state: string; postMessage: ReturnType<typeof vi.fn> };

const makeWorker = (state: string): FakeWorker =>
  Object.assign(new EventTarget(), { state, postMessage: vi.fn() });

type FakeRegistration = EventTarget & {
  installing: FakeWorker | null;
};

const fakeServiceWorker = () =>
  Object.assign(new EventTarget(), {
    controller: null as FakeWorker | null,
    register: vi.fn(),
  });

type FakeSW = ReturnType<typeof fakeServiceWorker>;

describe('registerPwa', () => {
  let addEventListenerSpy: ReturnType<typeof vi.spyOn>;
  let loadHandlers: ((...args: unknown[]) => void)[];
  let sw: FakeSW;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('PROD', true);
    loadHandlers = [];
    addEventListenerSpy = vi
      .spyOn(window, 'addEventListener')
      .mockImplementation(((type: string, handler: (...args: unknown[]) => void) => {
        if (type === 'load') loadHandlers.push(handler);
      }) as typeof window.addEventListener);
    sw = fakeServiceWorker();
    Object.defineProperty(navigator, 'serviceWorker', { value: sw, configurable: true });
  });

  afterEach(() => {
    addEventListenerSpy.mockRestore();
    vi.unstubAllEnvs();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
  });

  const fireLoad = () => {
    for (const handler of loadHandlers) handler();
  };

  it('never registers in development builds', () => {
    vi.stubEnv('PROD', false);
    registerPwa();
    expect(loadHandlers).toHaveLength(0);
    expect(sw.register).not.toHaveBeenCalled();
  });

  it('is a no-op without service-worker support', () => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    expect(() => registerPwa()).not.toThrow();
    expect(loadHandlers).toHaveLength(0);
  });

  it('registers the base-prefixed worker script on window load', async () => {
    sw.register.mockResolvedValue({ addEventListener: vi.fn(), installing: null });
    registerPwa();
    expect(sw.register).not.toHaveBeenCalled(); // deferred to load
    fireLoad();
    await vi.waitFor(() => expect(sw.register).toHaveBeenCalledTimes(1));
    expect(sw.register).toHaveBeenCalledWith(`${import.meta.env.BASE_URL}sw.js`);
  });

  it('stays silent when registration fails', async () => {
    sw.register.mockRejectedValue(new Error('no sw for you'));
    registerPwa();
    fireLoad();
    await vi.waitFor(() => expect(sw.register).toHaveBeenCalled());
    // No toast surfaced: the worker is an enhancement, not a feature.
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('offers Reload via a persistent toast when an update finished installing', async () => {
    const waiting = makeWorker('installing');
    const registration: FakeRegistration = Object.assign(new EventTarget(), {
      installing: waiting,
    });
    sw.register.mockResolvedValue(registration);
    registerPwa();
    fireLoad();
    await vi.waitFor(() => expect(sw.register).toHaveBeenCalled());

    // updatefound → installing worker flips to 'installed' while the page
    // is controlled by the old worker.
    sw.controller = makeWorker('activated'); // the previous generation
    registration.dispatchEvent(new Event('updatefound'));
    waiting.state = 'installed';
    waiting.dispatchEvent(new Event('statechange'));

    expect(toast.info).toHaveBeenCalledTimes(1);
    const call = vi.mocked(toast.info).mock.calls.at(0);
    if (call === undefined) throw new Error('update toast call missing');
    const [message, options] = call;
    expect(message).toContain('update');
    expect(options?.duration).toBe(0); // persistent
    expect(options?.action?.label).toBe('Reload');

    // The reload action tells the WAITING worker to take over.
    options?.action?.onClick();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
  });

  it('does not toast on a first install (no controlling worker yet)', async () => {
    const installing = makeWorker('installing');
    const registration: FakeRegistration = Object.assign(new EventTarget(), {
      installing,
    });
    sw.register.mockResolvedValue(registration);
    registerPwa();
    fireLoad();
    await vi.waitFor(() => expect(sw.register).toHaveBeenCalled());

    installing.state = 'installed';
    installing.dispatchEvent(new Event('statechange'));

    expect(toast.info).not.toHaveBeenCalled();
  });
});
