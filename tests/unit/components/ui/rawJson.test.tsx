// RawJsonCard: the detail pages' raw-RPC appendix card — lazy fetch on
// first expand, per-section retry, honest note placeholders, clipboard
// copy, and abort-on-collapse — pinned end-to-end at the component layer
// with stub fetchers (no network, no RPC client).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RawJsonCard, type RawJsonFetcher } from '@/components/ui/RawJson';

const txRaw = { hash: '0xabc', from: '0x1111', nonce: '0x1' };
const receiptRaw = { status: '0x1', gasUsed: '0x5208', logs: [] };

// jsdom ships no navigator.clipboard; tests that exercise copy stub the
// async API directly (CustomAbiPanel test pattern) and reset afterwards.
const stubClipboard = (writeText?: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
};

const renderCard = (fetchers: RawJsonFetcher[]) =>
  render(<RawJsonCard title="Raw JSON" fetchers={fetchers} />);

const expand = () => fireEvent.click(screen.getByTestId('raw-json-header'));

describe('RawJsonCard', () => {
  afterEach(() => {
    stubClipboard(undefined);
  });

  it('fetches nothing while collapsed, then every section once on first expand', async () => {
    const loadTx = vi.fn((_signal?: AbortSignal) => Promise.resolve(txRaw));
    const loadReceipt = vi.fn(() => Promise.resolve(receiptRaw));
    renderCard([
      { label: 'Transaction', load: loadTx },
      { label: 'Receipt', load: loadReceipt },
    ]);

    // Collapsed mount: zero fetches.
    expect(loadTx).not.toHaveBeenCalled();
    expect(loadReceipt).not.toHaveBeenCalled();

    expand();

    await waitFor(() => expect(loadTx).toHaveBeenCalledTimes(1));
    expect(loadReceipt).toHaveBeenCalledTimes(1);
    // Each load receives its section's abort signal.
    expect(loadTx.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);

    await waitFor(() =>
      expect(screen.getAllByTestId('raw-json-payload')).toHaveLength(2),
    );
    const payloads = screen.getAllByTestId('raw-json-payload');
    expect(payloads[0]?.textContent).toBe(JSON.stringify(txRaw, null, 2));
    expect(payloads[1]?.textContent).toBe(JSON.stringify(receiptRaw, null, 2));
  });

  it('caches settled payloads across collapse/expand without refetching', async () => {
    const loadTx = vi.fn(() => Promise.resolve(txRaw));
    renderCard([{ label: 'Transaction', load: loadTx }]);

    expand();
    expect(await screen.findByTestId('raw-json-payload')).toBeInTheDocument();

    expand(); // collapse — content hidden, state kept
    // jsdom applies no Linaria CSS, so collapse is asserted through the
    // wrapper's aria-hidden flag (what display:none would enforce).
    expect(screen.getByTestId('raw-json-payload').closest('[aria-hidden]')).toHaveAttribute(
      'aria-hidden',
      'true',
    );

    expand(); // re-expand — the settled payload is reused, not refetched
    expect(await screen.findByTestId('raw-json-payload')).toBeInTheDocument();
    expect(loadTx).toHaveBeenCalledTimes(1);
  });

  it('aborts an in-flight request on collapse and refetches on re-expand', async () => {
    // Never settles on its own: only the abort path can end it.
    const never = vi.fn(
      (_signal?: AbortSignal) => new Promise<never>(() => undefined),
    );
    renderCard([{ label: 'Transaction', load: never }]);

    expand();
    await waitFor(() => expect(never).toHaveBeenCalledTimes(1));
    const signal = never.mock.calls[0]?.[0];

    expand(); // collapse mid-flight
    expect(signal?.aborted).toBe(true);

    expand(); // nothing settled, so the next expand refetches
    await waitFor(() => expect(never).toHaveBeenCalledTimes(2));
  });

  it('degrades a failed section to a retryable error without touching siblings', async () => {
    const loadReceipt = vi
      .fn<() => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('gateway timeout'))
      .mockResolvedValueOnce(receiptRaw);
    const loadTx = vi.fn(() => Promise.resolve(txRaw));
    renderCard([
      { label: 'Transaction', load: loadTx },
      { label: 'Receipt', load: loadReceipt },
    ]);

    expand();

    expect(await screen.findByText('gateway timeout')).toBeVisible();
    // Per-section retry affordance, named for its section.
    fireEvent.click(screen.getByRole('button', { name: 'Retry Receipt' }));

    await waitFor(() =>
      expect(screen.getAllByTestId('raw-json-payload')).toHaveLength(2),
    );
    const payloads = screen.getAllByTestId('raw-json-payload');
    expect(payloads[1]?.textContent).toBe(JSON.stringify(receiptRaw, null, 2));
    // The healthy sibling was never re-fetched by the retry.
    expect(loadTx).toHaveBeenCalledTimes(1);
    expect(loadReceipt).toHaveBeenCalledTimes(2);
  });

  it('renders a noted section as an honest placeholder that never fetches', async () => {
    const loadReceipt = vi.fn(() => Promise.resolve(receiptRaw));
    const loadTx = vi.fn(() => Promise.resolve(txRaw));
    renderCard([
      { label: 'Transaction', load: loadTx },
      {
        label: 'Receipt',
        load: loadReceipt,
        note: 'No receipt yet — the transaction is still pending',
      },
    ]);

    expand();

    expect(await screen.findByText('No receipt yet — the transaction is still pending')).toBeVisible();
    // The pending receipt section fetched nothing and offers no retry —
    // a stated absence, not a failure.
    expect(loadReceipt).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry Receipt' })).not.toBeInTheDocument();
    // Its sibling still fetched normally.
    expect(await screen.findAllByTestId('raw-json-payload')).toHaveLength(1);
  });

  it('copies a settled payload through the async clipboard API', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);
    renderCard([{ label: 'Transaction', load: vi.fn(() => Promise.resolve(txRaw)) }]);

    expand();
    await screen.findByTestId('raw-json-payload');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(txRaw, null, 2)),
    );
    expect(await screen.findByRole('button', { name: 'Copied ✓' })).toBeVisible();
  });

  it('reports a failed clipboard copy honestly on the button', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('permission denied');
    });
    stubClipboard(writeText);
    renderCard([{ label: 'Transaction', load: vi.fn(() => Promise.resolve(txRaw)) }]);

    expand();
    await screen.findByTestId('raw-json-payload');

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeVisible();
  });
});
