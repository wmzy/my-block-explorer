// Ops "Copy diagnostics" contract: buildOpsDiagnostics is the pure payload
// builder for bug reports — the summary's meta (appVersion/backend), every
// section verbatim (degraded sections travel as their honest
// {error:'unavailable'} shape, nothing silently dropped) plus a per-section
// `sections` verdict map; the button wires it through the async clipboard
// API with the codebase's CopyableHash toast contract (success and failure
// both say so). The service layer is stubbed so the view's own wiring is
// what is under test.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import Ops, { buildOpsDiagnostics } from '@/views/Ops';
import type { OpsSummary } from '@/services/opsSummary';

// The view's toast comes from haze-ui's useToast, which returns a CALLABLE.
// The global setup mock's {addToast} shape is not callable — calling it
// would turn every copy into an unhandled rejection — so this file pins
// the callable shape and spies on it.
const { toastFn, mockUseOpsSummary } = vi.hoisted(() => ({
  toastFn: vi.fn(),
  mockUseOpsSummary: vi.fn(),
}));

vi.mock('haze-ui', async () => {
  const React = await import('react');
  return {
    Alert: (props: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'alert' }, props.children),
    useToast: () => toastFn,
  };
});

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('@/services/opsSummary', () => ({
  useOpsSummary: (...args: unknown[]) => mockUseOpsSummary(...args),
}));

// The view only reads the remembered chain for topbar context; pinning it
// keeps the test independent of localStorage state.
vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: () => 1,
}));

const refetch = vi.fn();

const FULL_SUMMARY: OpsSummary = {
  meta: { version: '1.2.3', uptimeSeconds: 3725, timestamp: '2026-09-26T10:00:00.000Z' },
  storage: {
    mainDbBytes: 21_840_000,
    perChainDbFiles: [
      {
        chainType: 'mainnet',
        name: 'ethereum',
        chainId: 1,
        bytes: 1_048_576,
        mtime: '2026-09-25T09:00:00.000Z',
      },
    ],
    solcCache: { files: 3, bytes: 20_971_520 },
  },
  indexing: { total: 3, chains: [{ chainId: 1, total: 3, statuses: { completed: 2, error: 1 } }] },
  watch: {
    total: 1,
    subscriptions: [
      { chainId: 1, address: '0xabc0000000000000000000000000000000000abc', webhookConfigured: false },
    ],
  },
  rateLimit: {
    buckets: [{ name: 'ops-summary', capacity: 6, requestsPerMinute: 6, hits: 10, rejected: 1 }],
  },
  deepScan: { total: 2, byStatus: { complete: 1, error: 1 } },
};

// jsdom ships no navigator.clipboard; the copy tests stub the async API
// directly (rawJson.test.tsx pattern) and reset afterwards.
const stubClipboard = (writeText?: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
};

const summaryQuery = (data: OpsSummary | undefined, error: Error | undefined = undefined) => ({
  data,
  error,
  loading: false,
  fetching: false,
  refetch,
});

const routes = createRoutes([{ path: '/ops', component: () => Ops }]);

const renderOps = async () => {
  render(
    <MemoryRouter routes={routes} initialEntries={['/ops']}>
      <View />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Ops Dashboard')).toBeInTheDocument();
};

beforeEach(() => {
  window.localStorage.clear();
  toastFn.mockClear();
  mockUseOpsSummary.mockReturnValue(summaryQuery(FULL_SUMMARY));
});

afterEach(() => {
  stubClipboard(undefined);
});

describe('buildOpsDiagnostics', () => {
  it('builds the full payload from a healthy summary: meta, sections verdict, section data verbatim', () => {
    const diag = buildOpsDiagnostics(FULL_SUMMARY, () => new Date('2026-09-26T12:00:00.000Z'));

    expect(diag.generatedAt).toBe('2026-09-26T12:00:00.000Z');
    expect(diag.appVersion).toBe('1.2.3');
    expect(diag.backend).toEqual(FULL_SUMMARY.meta);
    expect(diag.sections).toEqual({
      storage: 'ok',
      indexing: 'ok',
      watch: 'ok',
      rateLimit: 'ok',
      deepScan: 'ok',
    });
    // Every section payload travels verbatim — storage sizes included.
    expect(diag.storage).toEqual(FULL_SUMMARY.storage);
    expect(diag.indexing).toEqual(FULL_SUMMARY.indexing);
    expect(diag.watch).toEqual(FULL_SUMMARY.watch);
    expect(diag.rateLimit).toEqual(FULL_SUMMARY.rateLimit);
    expect(diag.deepScan).toEqual(FULL_SUMMARY.deepScan);
  });

  it('marks degraded sections unavailable in the verdict map and keeps their error payload — omits nothing silently', () => {
    const degraded: OpsSummary = {
      ...FULL_SUMMARY,
      watch: { error: 'unavailable' },
      rateLimit: { error: 'unavailable' },
    };
    const diag = buildOpsDiagnostics(degraded);

    expect(diag.sections).toEqual({
      storage: 'ok',
      indexing: 'ok',
      watch: 'unavailable',
      rateLimit: 'unavailable',
      deepScan: 'ok',
    });
    // The degraded sections are still present, honestly, not dropped.
    expect(diag.watch).toEqual({ error: 'unavailable' });
    expect(diag.rateLimit).toEqual({ error: 'unavailable' });
  });

  it('defaults generatedAt to the current clock', () => {
    const before = new Date();
    const diag = buildOpsDiagnostics(FULL_SUMMARY);
    const after = new Date();
    expect(new Date(diag.generatedAt).getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(new Date(diag.generatedAt).getTime()).toBeLessThanOrEqual(after.getTime());
  });
});

describe('Copy diagnostics button', () => {
  it('serializes the built payload through the clipboard and reports success via the toast', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    stubClipboard(writeText);
    await renderOps();

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    // What lands on the clipboard is the builder's JSON, parseable whole.
    const payload = JSON.parse(writeText.mock.calls[0][0]);
    expect(payload.appVersion).toBe('1.2.3');
    expect(payload.sections).toEqual({
      storage: 'ok',
      indexing: 'ok',
      watch: 'ok',
      rateLimit: 'ok',
      deepScan: 'ok',
    });
    expect(payload.storage.mainDbBytes).toBe(21_840_000);
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith('Diagnostics copied to clipboard', {
        variant: 'success',
        duration: 2000,
      }),
    );
  });

  it('reports a rejected clipboard write honestly via the danger toast', async () => {
    stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))));
    await renderOps();

    fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics' }));

    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith('Failed to copy diagnostics', {
        variant: 'danger',
        duration: 2000,
      }),
    );
  });

  it('renders no copy affordance while no summary is loaded (admin gate face)', async () => {
    mockUseOpsSummary.mockReturnValue(
      summaryQuery(undefined, Object.assign(new Error('forbidden'), { status: 403 })),
    );
    await renderOps();

    expect(screen.queryByRole('button', { name: 'Copy diagnostics' })).not.toBeInTheDocument();
  });
});
