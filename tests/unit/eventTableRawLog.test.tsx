/**
 * Focused component tests: EventTable's per-row raw-log disclosure —
 * lazy mount only while expanded, the verbatim indexed log fields
 * (topics as topic0..topicN rows, data hex in a scrollable mono pre,
 * block/tx links, log index, emitting address with a copy button),
 * topic0's resolved-name chip vs the /signatures lookup link for
 * undecoded rows, keyboard operability of the toggle, and the honest
 * "Raw log not stored" degrade for rows that predate raw-log storage.
 * The indexed rows arrive through the same mocked '@/util/http' channel
 * the table always uses — no network, no DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

import EventTable from '@/components/events/EventTable';
import { get } from '@/util/http';

vi.mock('@/util/http', () => ({
  get: vi.fn(),
}));

const ADDRESS = '0x1234567890123456789012345678901234567890';

// keccak256("Transfer(address,address,uint256)") — a real topic0 so the
// fixture mirrors production rows.
const TRANSFER_TOPIC0 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const TOPIC_A1 = `0x${'11'.repeat(32)}`;
const TOPIC_A2 = `0x${'22'.repeat(32)}`;
const DATA_A = `0x${'ab'.repeat(64)}`;
const TX_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOPIC_B0 = `0x${'cd'.repeat(32)}`;
const TX_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const TX_C = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

// jsdom ships no navigator.clipboard; copy tests stub the async API
// directly (RawJson test pattern) and reset afterwards.
const stubClipboard = (writeText?: (text: string) => Promise<void>) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
};

const mockRows = (rows: Array<Record<string, unknown>>) => {
  vi.mocked(get).mockResolvedValue({ events: rows, total: rows.length, page: 1, totalPages: 1 });
};

// TypedLink needs router context (useRouter throws bare); the stub routes
// keep every disclosure link target resolvable.
const RouteStub = () => <span data-testid="route-stub" />;
const stubRoutes = createRoutes([
  // component is a resolver returning the view component (same shape as
  // the real route table's `component: () => import(...)`).
  { path: '/chain/:chainId/block/:blockNumber', component: () => RouteStub },
  { path: '/chain/:chainId/tx/:txHash', component: () => RouteStub },
  { path: '/signatures', component: () => RouteStub },
]);

const renderTable = () =>
  render(
    <MemoryRouter routes={stubRoutes}>
      <EventTable chainId={1} contractAddress={ADDRESS as `0x${string}`} />
    </MemoryRouter>,
  );

describe('EventTable raw-log disclosure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubClipboard(undefined);
  });

  afterEach(() => {
    stubClipboard(undefined);
  });

  it('renders nothing until toggled, then mounts the disclosure lazily and unmounts on collapse', async () => {
    mockRows([
      {
        blockNumber: 123,
        blockTimestamp: 1700000000,
        transactionHash: TX_A,
        logIndex: 4,
        eventName: 'Transfer',
        topic0: TRANSFER_TOPIC0,
        topic1: TOPIC_A1,
        topic2: TOPIC_A2,
        topic3: null,
        data: DATA_A,
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 123, log index 4' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Lazy: the collapsed row carries no disclosure content in the DOM.
    expect(screen.queryByTestId('raw-log-disclosure')).toBeNull();

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.getByTestId('raw-log-disclosure')).toBeInTheDocument());
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    await waitFor(() => expect(screen.queryByTestId('raw-log-disclosure')).toBeNull());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('discloses the verbatim raw log: block/tx links, log index, topics, name chip, data hex', async () => {
    mockRows([
      {
        blockNumber: 123,
        blockTimestamp: 1700000000,
        transactionHash: TX_A,
        logIndex: 4,
        eventName: 'Transfer',
        topic0: TRANSFER_TOPIC0,
        topic1: TOPIC_A1,
        topic2: TOPIC_A2,
        topic3: null,
        data: DATA_A,
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 123, log index 4' });
    fireEvent.click(toggle);
    const disclosure = await screen.findByTestId('raw-log-disclosure');

    // Identity links point at the block and tx pages.
    expect(within(disclosure).getByRole('link', { name: '123' }).getAttribute('href')).toBe(
      '/chain/1/block/123',
    );
    const txLink = within(disclosure).getByTitle(TX_A);
    expect(txLink.getAttribute('href')).toBe(`/chain/1/tx/${TX_A}`);
    // Log index rides the meta row verbatim.
    expect(within(disclosure).getByText('4')).toBeInTheDocument();

    // Topics render as topic0..topicN rows with their raw values; topic3
    // (null in the fixture row) stays absent.
    expect(within(disclosure).getByText(TRANSFER_TOPIC0)).toBeInTheDocument();
    expect(within(disclosure).getByText(TOPIC_A1)).toBeInTheDocument();
    expect(within(disclosure).getByText(TOPIC_A2)).toBeInTheDocument();
    expect(within(disclosure).queryByText('topic3')).toBeNull();

    // topic0 carries the resolved event-name chip; the data hex lands in
    // the mono pre next to its copy button.
    expect(within(disclosure).getByText('Transfer')).toBeInTheDocument();
    expect(within(disclosure).getByTestId('raw-log-data').textContent).toBe(DATA_A);
    expect(within(disclosure).getByRole('button', { name: 'Copy data' })).toBeInTheDocument();
  });

  it('links an undecoded topic0 to the signature lookup instead of a name chip', async () => {
    mockRows([
      {
        blockNumber: 124,
        blockTimestamp: 1700000001,
        transactionHash: TX_B,
        logIndex: 7,
        eventName: 'Unknown',
        topic0: TOPIC_B0,
        topic1: null,
        topic2: null,
        topic3: null,
        data: '0x',
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 124, log index 7' });
    fireEvent.click(toggle);
    await screen.findByTestId('raw-log-disclosure');

    const lookup = screen.getByRole('link', { name: 'Look up topic0' });
    expect(lookup.getAttribute('href')).toBe(`/signatures?q=${TOPIC_B0}`);
  });

  it('degrades honestly when the row stores no raw fields at all', async () => {
    mockRows([
      {
        blockNumber: 125,
        blockTimestamp: 1700000002,
        transactionHash: TX_C,
        logIndex: 9,
        eventName: 'Transfer',
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 125, log index 9' });
    fireEvent.click(toggle);

    // Stated absence, never an error — and no topic/data sections at all.
    await screen.findByText('Raw log not stored for this row');
    expect(screen.queryByTestId('raw-log-disclosure')).toBeNull();
    expect(screen.queryByTestId('raw-log-data')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Look up topic0' })).toBeNull();
  });

  it('copies the emitting address and the data hex through the async clipboard API', async () => {
    mockRows([
      {
        blockNumber: 123,
        blockTimestamp: 1700000000,
        transactionHash: TX_A,
        logIndex: 4,
        eventName: 'Transfer',
        topic0: TRANSFER_TOPIC0,
        topic1: null,
        topic2: null,
        topic3: null,
        data: DATA_A,
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 123, log index 4' });
    fireEvent.click(toggle);
    await screen.findByTestId('raw-log-disclosure');

    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);

    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Copy data' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(DATA_A));
  });

  it('reports a failed clipboard copy honestly on the button', async () => {
    mockRows([
      {
        blockNumber: 123,
        blockTimestamp: 1700000000,
        transactionHash: TX_A,
        logIndex: 4,
        eventName: 'Transfer',
        topic0: TRANSFER_TOPIC0,
        data: DATA_A,
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 123, log index 4' });
    fireEvent.click(toggle);
    await screen.findByTestId('raw-log-disclosure');

    stubClipboard(vi.fn(() => Promise.reject(new Error('denied'))));

    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy failed' })).toBeInTheDocument(),
    );
  });

  it('operates the disclosure from the keyboard (Enter expands, Enter collapses)', async () => {
    mockRows([
      {
        blockNumber: 123,
        blockTimestamp: 1700000000,
        transactionHash: TX_A,
        logIndex: 4,
        eventName: 'Transfer',
        topic0: TRANSFER_TOPIC0,
        data: DATA_A,
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();
    const user = userEvent.setup();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 123, log index 4' });
    toggle.focus();
    await user.keyboard('{Enter}');
    await screen.findByTestId('raw-log-disclosure');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByTestId('raw-log-disclosure')).toBeNull());
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('uses the row contractAddress as the emitting address when the row carries one', async () => {
    const rowEmitter = '0x9999999999999999999999999999999999999999';
    const txD = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
    mockRows([
      {
        blockNumber: 126,
        blockTimestamp: 1700000003,
        transactionHash: txD,
        logIndex: 2,
        eventName: 'Transfer',
        contractAddress: rowEmitter,
        topic0: TRANSFER_TOPIC0,
        data: DATA_A,
        decodedArgs: '{}',
        isFinalized: true,
      },
    ]);
    renderTable();

    const toggle = await screen.findByRole('button', { name: 'Raw log for block 126, log index 2' });
    fireEvent.click(toggle);
    await screen.findByTestId('raw-log-disclosure');

    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard(writeText);
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(rowEmitter));
  });
});
