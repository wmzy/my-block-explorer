// Watchlist panel behavior: storage-backed add/remove with per-tier
// rejection copy, honest notification-permission states, and the
// live-block matching path (cost control + notification firing) with the
// live stream and RPC client mocked. Notification itself is faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { getAddress } from 'viem';
import '@testing-library/jest-dom/vitest';
import Watchlist, { findWatchedMatches } from '@/views/Home/Watchlist';
import { WATCHLIST_STORAGE_KEY } from '@/util/watchlist';

// Captured live-block callback (the panel subscribes through the hook).
let liveBlockHandler: ((block: { number: string; hash: string }) => void) | null = null;

vi.mock('@/services/liveChain', () => ({
  useLiveBlockEvents: (
    _chainId: number,
    onBlock: (block: { number: string; hash: string }) => void,
  ) => {
    liveBlockHandler = onBlock;
  },
}));

const getBlockMock = vi.fn();
const createRpcClientMock = vi.fn();

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: (...args: unknown[]) => createRpcClientMock(...args),
}));

class FakeNotification {
  static instances: FakeNotification[] = [];
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => 'granted');
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.body = options?.body ?? '';
    this.tag = options?.tag ?? '';
    FakeNotification.instances.push(this);
  }
}

const WATCHED = getAddress('0x1111111111111111111111111111111111111111');
const COUNTERPARTY = getAddress('0x2222222222222222222222222222222222222222');
const TX_HASH = '0xtx0000000000000000000000000000000000000000000000000000000000001';

const blockWithTxs = (from: string, to: string | null) => ({
  transactions: [{ hash: TX_HASH, from, to }],
});

// native-router resolves the view asynchronously, so every render is
// followed by an awaited first-content query before sync assertions.
const renderPanel = async (live = true) => {
  const Panel = () => <Watchlist chainId={1} live={live} />;
  const view = render(
    <MemoryRouter routes={createRoutes([{ path: '/', component: () => Panel }])} initialEntries={['/']}>
      <View />
    </MemoryRouter>,
  );
  await screen.findByText('Watchlist');
  return view;
};

const seedWatched = () => {
  localStorage.setItem(WATCHLIST_STORAGE_KEY, JSON.stringify([WATCHED]));
};

const deliverLiveBlock = async (number = '100') => {
  await act(async () => {
    liveBlockHandler?.({ number, hash: '0xblock' });
  });
  // Flush the async block scan.
  await act(async () => {});
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  liveBlockHandler = null;
  FakeNotification.instances = [];
  FakeNotification.permission = 'default';
  FakeNotification.requestPermission.mockResolvedValue('granted');
  vi.stubGlobal('Notification', FakeNotification);
  createRpcClientMock.mockResolvedValue({ getBlock: getBlockMock });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Watchlist panel - entries', () => {
  it('renders stored entries with the honest scope caveat', async () => {
    seedWatched();
    await renderPanel();

    expect(screen.getByTitle(WATCHED)).toBeInTheDocument();
    expect(
      screen.getByText(/checked against live blocks while this page is open — not a background service/),
    ).toBeInTheDocument();
  });

  it('adds a valid address and rejects bad input with tier-specific copy', async () => {
    await renderPanel();

    const input = screen.getByPlaceholderText('0x… address to watch');
    const addButton = screen.getByRole('button', { name: 'Add' });

    fireEvent.change(input, { target: { value: 'not-an-address' } });
    fireEvent.click(addButton);
    expect(screen.getByText(/Not a valid address/)).toBeInTheDocument();

    // Mixed-case body that fails EIP-55.
    fireEvent.change(input, { target: { value: '0x1234567890AbCdEf1234567890abCdEf12345678' } });
    fireEvent.click(addButton);
    expect(screen.getByText(/checksum mismatch/i)).toBeInTheDocument();
    expect(localStorage.getItem(WATCHLIST_STORAGE_KEY)).toBeNull();

    fireEvent.change(input, { target: { value: WATCHED.toLowerCase() } });
    fireEvent.click(addButton);
    expect(screen.getByTitle(WATCHED)).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(WATCHLIST_STORAGE_KEY)!)).toEqual([WATCHED]);

    fireEvent.change(input, { target: { value: WATCHED.toLowerCase() } });
    fireEvent.click(addButton);
    expect(screen.getByText('Already on the watchlist.')).toBeInTheDocument();
  });

  it('removes an entry', async () => {
    seedWatched();
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.queryByTitle(WATCHED)).not.toBeInTheDocument();
    expect(localStorage.getItem(WATCHLIST_STORAGE_KEY)).toBe('[]');
  });
});

describe('Watchlist panel - notification permission', () => {
  it('requests permission via the explicit button and flips the copy', async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Enable notifications' }));

    await waitFor(() => {
      expect(screen.getByText('Notifications on.')).toBeInTheDocument();
    });
    expect(FakeNotification.requestPermission).toHaveBeenCalled();
  });

  it('states the denied state honestly', async () => {
    FakeNotification.permission = 'denied';
    await renderPanel();

    expect(
      screen.getByText(/Blocked by the browser — re-enable site notifications/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).not.toBeInTheDocument();
  });
});

describe('Watchlist panel - live-block matching', () => {
  it('fires one notification and one in-page match for a watched from-address', async () => {
    seedWatched();
    FakeNotification.permission = 'granted';
    await renderPanel();
    getBlockMock.mockResolvedValue(blockWithTxs(WATCHED, COUNTERPARTY));

    await deliverLiveBlock();

    expect(FakeNotification.instances).toHaveLength(1);
    expect(FakeNotification.instances[0].title).toBe('Watchlist activity');
    expect(FakeNotification.instances[0].body).toContain('block 100');
    expect(screen.getByText(/in block 100/)).toBeInTheDocument();
    expect(getBlockMock).toHaveBeenCalledWith(
      expect.objectContaining({ blockNumber: BigInt(100), includeTransactions: true }),
    );
  });

  it('matches a watched to-address too', async () => {
    seedWatched();
    FakeNotification.permission = 'granted';
    await renderPanel();
    getBlockMock.mockResolvedValue(blockWithTxs(COUNTERPARTY, WATCHED));

    await deliverLiveBlock('101');

    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('does not duplicate notifications for a re-delivered block', async () => {
    seedWatched();
    FakeNotification.permission = 'granted';
    await renderPanel();
    getBlockMock.mockResolvedValue(blockWithTxs(WATCHED, COUNTERPARTY));

    await deliverLiveBlock('100');
    await deliverLiveBlock('100');

    expect(FakeNotification.instances).toHaveLength(1);
    expect(getBlockMock).toHaveBeenCalledTimes(1);
  });

  it('records in-page matches without notifications when permission is missing', async () => {
    seedWatched();
    FakeNotification.permission = 'default';
    await renderPanel();
    getBlockMock.mockResolvedValue(blockWithTxs(WATCHED, COUNTERPARTY));

    await deliverLiveBlock();

    expect(FakeNotification.instances).toHaveLength(0);
    expect(screen.getByText(/in block 100/)).toBeInTheDocument();
  });

  it('never fetches the full block while the watchlist is empty (cost control)', async () => {
    await renderPanel();
    getBlockMock.mockResolvedValue(blockWithTxs(WATCHED, COUNTERPARTY));

    await deliverLiveBlock();

    expect(createRpcClientMock).not.toHaveBeenCalled();
    expect(FakeNotification.instances).toHaveLength(0);
  });

  it('skips a block silently when the full-block fetch fails', async () => {
    seedWatched();
    FakeNotification.permission = 'granted';
    await renderPanel();
    getBlockMock.mockRejectedValue(new Error('rpc hiccup'));

    await deliverLiveBlock();

    expect(FakeNotification.instances).toHaveLength(0);
    expect(screen.queryByText(/in block 100/)).not.toBeInTheDocument();
    // ...and the next block still gets its chance.
    getBlockMock.mockResolvedValue(blockWithTxs(WATCHED, COUNTERPARTY));
    await deliverLiveBlock('101');
    expect(FakeNotification.instances).toHaveLength(1);
  });

  it('says matching is inactive when the live stream is down', async () => {
    await renderPanel(false);
    expect(screen.getByText(/Live stream not connected/)).toBeInTheDocument();
  });
});

describe('findWatchedMatches (pure)', () => {
  const watched = new Set([WATCHED.toLowerCase()]);

  it('matches from and to, capped, in scan order', () => {
    const txs = [
      { hash: '0x1', from: COUNTERPARTY, to: WATCHED },
      { hash: '0x2', from: WATCHED, to: COUNTERPARTY },
      { hash: '0x3', from: COUNTERPARTY, to: null },
    ];
    expect(findWatchedMatches(txs, watched, 5)).toEqual([
      { address: WATCHED.toLowerCase(), txHash: '0x1' },
      { address: WATCHED.toLowerCase(), txHash: '0x2' },
    ]);
    expect(findWatchedMatches(txs, watched, 1)).toHaveLength(1);
  });

  it('is case-insensitive and skips contract creations', () => {
    expect(
      findWatchedMatches(
        [{ hash: '0x1', from: WATCHED.toUpperCase(), to: null }],
        watched,
        5,
      ),
    ).toEqual([{ address: WATCHED.toLowerCase(), txHash: '0x1' }]);
  });
});
