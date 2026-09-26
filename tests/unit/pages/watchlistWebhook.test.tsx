// Server-side watch panel — webhook surface: the optional Webhook URL
// field (with the honest "Discord webhook detected — sends an embed"
// hint), per-row delivery status + last-at rendering for configured
// webhooks, the clear affordance, and the extended honesty copy. The
// watch service module, live stream, RPC client and API base are all
// mocked — this pins the VIEW contract, not the network.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

const watchMocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  refetch: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('@/util/apiBase', () => ({
  getApiBase: () => 'http://localhost:8201',
  onApiBaseChange: () => () => undefined,
}));

vi.mock('@/services/liveChain', () => ({
  useLiveBlockEvents: () => undefined,
  useWatchEvents: () => undefined,
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

vi.mock('@/services/watch', () => ({
  useWatchSubscriptions: () => ({
    data: watchMocks.rows,
    error: undefined,
    loading: false,
    refetch: watchMocks.refetch,
  }),
  saveWatchSubscription: watchMocks.save,
  deleteWatchSubscription: watchMocks.remove,
  fetchWatchEvents: vi.fn(async () => []),
  watchEventKey: (event: { kind: string; chainId: number; address: string; blockNumber: string }) =>
    `${event.chainId}:${event.kind}:${event.address}:${event.blockNumber}`,
  WATCH_FEED_ITEMS: 10,
}));

import Watchlist from '@/views/Home/Watchlist';

const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const NOW = new Date();
const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  chainId: 1,
  address: ADDRESS,
  label: null,
  lastProcessedBlock: '100',
  webhookUrl: null,
  webhookStatus: null,
  webhookLastAt: null,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

class FakeNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => 'granted');
}

const renderPanel = async () => {
  const Panel = () => <Watchlist chainId={1} live />;
  render(
    <MemoryRouter routes={createRoutes([{ path: '/', component: () => Panel }])} initialEntries={['/']}>
      <View />
    </MemoryRouter>,
  );
  await screen.findByText('Server-side watching (backend)');
};

beforeEach(() => {
  vi.clearAllMocks();
  watchMocks.rows = [];
  watchMocks.save.mockResolvedValue(row());
  vi.stubGlobal('Notification', FakeNotification);
});

describe('ServerWatchPanel — webhook field', () => {
  it('renders the optional Webhook URL input', async () => {
    await renderPanel();
    expect(
      screen.getByPlaceholderText('Webhook URL (optional, Discord supported)'),
    ).toBeInTheDocument();
  });

  it('labels a Discord URL inline and unlables anything else', async () => {
    await renderPanel();
    const input = screen.getByPlaceholderText('Webhook URL (optional, Discord supported)');

    fireEvent.change(input, {
      target: { value: 'https://discord.com/api/webhooks/123/token' },
    });
    expect(screen.getByText('Discord webhook detected — sends an embed')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'https://example.com/hook' } });
    expect(screen.queryByText('Discord webhook detected — sends an embed')).not.toBeInTheDocument();
  });

  it('sends the webhook with the subscription and leaves it out when empty', async () => {
    await renderPanel();
    const address = screen.getByPlaceholderText('0x… address for the backend to watch');
    const webhook = screen.getByPlaceholderText('Webhook URL (optional, Discord supported)');

    fireEvent.change(address, { target: { value: ADDRESS } });
    fireEvent.change(webhook, { target: { value: ' https://example.com/hook ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));

    await waitFor(() => {
      expect(watchMocks.save).toHaveBeenCalledWith(1, ADDRESS, null, 'https://example.com/hook');
    });

    // Empty field = absent key (unchanged), never an accidental clear.
    fireEvent.change(address, { target: { value: ADDRESS } });
    fireEvent.click(screen.getByRole('button', { name: 'Watch' }));
    await waitFor(() => {
      expect(watchMocks.save).toHaveBeenLastCalledWith(1, ADDRESS, null, undefined);
    });
  });
});

describe('ServerWatchPanel — row delivery status', () => {
  it('shows ok status and last-delivery time for a configured webhook', async () => {
    watchMocks.rows = [
      row({
        webhookUrl: 'https://discord.com/api/webhooks/1/t',
        webhookStatus: 'ok',
        webhookLastAt: new Date().toISOString(),
      }),
    ];
    await renderPanel();

    expect(screen.getByText(/webhook ok/)).toBeInTheDocument();
    expect(screen.getByText(/last just now/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear webhook' })).toBeInTheDocument();
  });

  it('shows failed status honestly (with the recorded reason)', async () => {
    watchMocks.rows = [
      row({ webhookUrl: 'https://example.com/hook', webhookStatus: 'failed: HTTP 500' }),
    ];
    await renderPanel();

    expect(screen.getByText(/webhook failed: HTTP 500/)).toBeInTheDocument();
  });

  it('shows pending status before any delivery and no last-at', async () => {
    watchMocks.rows = [row({ webhookUrl: 'https://example.com/hook' })];
    await renderPanel();

    expect(screen.getByText(/webhook pending/)).toBeInTheDocument();
    expect(screen.queryByText(/last /)).not.toBeInTheDocument();
  });

  it('renders no webhook status line for plain subscriptions', async () => {
    watchMocks.rows = [row()];
    await renderPanel();

    expect(screen.queryByText(/webhook/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear webhook' })).not.toBeInTheDocument();
  });

  it('clears the webhook through the explicit per-row action (label preserved)', async () => {
    watchMocks.rows = [
      row({
        label: 'Hot wallet',
        webhookUrl: 'https://example.com/hook',
        webhookStatus: 'ok',
        webhookLastAt: new Date().toISOString(),
      }),
    ];
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Clear webhook' }));
    await waitFor(() => {
      expect(watchMocks.save).toHaveBeenCalledWith(1, ADDRESS, 'Hot wallet', '');
    });
    expect(watchMocks.refetch).toHaveBeenCalled();
  });
});

describe('ServerWatchPanel — honesty copy', () => {
  it('extends the backend-runs caveat to webhook delivery', async () => {
    await renderPanel();
    expect(
      screen.getByText(/Webhook delivery also runs from the backend while it runs/),
    ).toBeInTheDocument();
    expect(screen.getByText(/5s timeout, one retry/)).toBeInTheDocument();
  });
});
