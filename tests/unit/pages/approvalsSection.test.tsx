// jsdom tests for the Approvals (discovered) section: settled rows with
// metadata-formatted allowances and the Max badge, the mandatory
// window/scan caveat copy, raw fallback when decimals are unknown, the
// honest degraded/empty states, the error state (e.g. rate-limit 429)
// and its inline Retry (a settled error is cached until refetch), the
// revoke.cash external link, and the gated-key null. The HTTP layer
// and the token-metadata hook are mocked — these pin VIEW behavior, not
// the endpoint (covered in approvalsRoute.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { getAddress } from 'viem';
import { MemoryRouter, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import {
  ApprovalSection,
  type ApprovalHistoryEvent,
  type ApprovalsPage,
} from '@/views/Address/approvals';
import { ApiError } from '@/util/apiError';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  // Stand-in for the shared metadata hook: a Map (keyed by lowercase
  // token) once "resolved", undefined while loading.
  metas: undefined as Map<string, { symbol: string | null; decimals: number | null }> | undefined,
}));

vi.mock('@/util/http', () => ({
  get: (...args: unknown[]) => mocks.get(...args),
  longRunningApi: {},
  withSignal: (o: unknown) => o,
  isBackendUnreachable: () => false,
}));

vi.mock('@/services/tokenMetadata', () => ({
  useTokenMetadata: () => mocks.metas,
}));

// Distinct per test: the query layer's cache is keyed by (chainId,
// address, window), so a shared address would serve a stale settle.
const addressOf = (seed: string): string =>
  `0x${seed.padEnd(40, '0').slice(0, 40)}`;

const TOKEN_A = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN_B = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const SPENDER_A = '0xcccccccccccccccccccccccccccccccccccccccc';
const SPENDER_B = '0xdddddddddddddddddddddddddddddddddddddddd';

// Mirror of the view's short-address rendering (block, tx, token, spender
// cells all shorten the same way).
const shortOf = (a: string) => `${a.slice(0, 8)}...${a.slice(-6)}`;

const pageOf = (address: string, overrides: Partial<ApprovalsPage> = {}): ApprovalsPage => ({
  chainId: 1,
  address,
  approvals: [
    { token: TOKEN_A, spender: SPENDER_A, allowance: '1500000000000000000', isMax: false },
    {
      token: TOKEN_B,
      spender: SPENDER_B,
      // max-uint
      allowance: '115792089237316195423570985008687907853269984665640564039457584007913129639935',
      isMax: true,
    },
  ],
  scannedAt: '2026-09-22T00:00:00.000Z',
  windowBlocks: 100_000,
  coverage: 'complete',
  pairCount: 2,
  truncated: false,
  ...overrides,
});

const metasOf = (): Map<string, { symbol: string | null; decimals: number | null }> =>
  new Map([
    [TOKEN_A, { symbol: 'TKN', decimals: 18 }],
    [TOKEN_B, { symbol: 'MAX', decimals: 18 }],
  ]);

// The section's history rows use TypedLink — a Router context is part of
// its rendering contract (the Address page always provides one).
const NullView = () => null;
const hostRoutes = createRoutes([{ path: '/', component: () => NullView }]);

const renderSection = (chainId: number, address: string) =>
  render(
    <MemoryRouter routes={hostRoutes} initialEntries={['/']}>
      <ApprovalSection chainId={chainId} address={address} />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.metas = undefined;
});

describe('ApprovalSection — settled data', () => {
  it('renders rows, the formatted allowance, the Max badge and the mandatory caveat', async () => {
    const address = addressOf('1111');
    mocks.get.mockResolvedValue(pageOf(address));
    mocks.metas = metasOf();

    renderSection(1, address);

    const rows = await screen.findAllByTestId('approval-row');
    expect(rows).toHaveLength(2);
    // Token symbols resolved through the shared metadata cache.
    expect(screen.getByText('TKN')).toBeInTheDocument();
    // Decimals-formatted, BigInt-exact amount with symbol.
    expect(screen.getByText('1.5 TKN')).toBeInTheDocument();
    // Effectively-unlimited grant: badge instead of a formatted amount.
    expect(screen.getByTestId('approval-max-badge')).toHaveTextContent('Max');
    // Mandatory honesty caveat, always present with a list.
    expect(screen.getByTestId('approvals-caveats').textContent).toContain(
      'Discovered from the scanned window; current values read at the latest block',
    );
    expect(screen.getByTestId('approvals-caveats').textContent).toContain(
      'most recent 100,000 blocks',
    );
    // Spenders render shortened with the full address on the title.
    expect(screen.getByText(`${SPENDER_A.slice(0, 8)}...${SPENDER_A.slice(-6)}`)).toBeInTheDocument();
  });

  it('shows the RAW allowance when token decimals are unknown — never a guessed amount', async () => {
    const address = addressOf('2222');
    mocks.get.mockResolvedValue(pageOf(address));
    // Metadata still loading (undefined): raw decimal string fallback.
    mocks.metas = undefined;

    renderSection(1, address);

    await screen.findAllByTestId('approval-row');
    expect(screen.getByText('1500000000000000000')).toBeInTheDocument();
    expect(screen.queryByText(/1\.5 /)).not.toBeInTheDocument();
  });

  it('surfaces the truncation note when the read cap hit and the partial note on partial coverage', async () => {
    const address = addressOf('3333');
    mocks.get.mockResolvedValue(
      pageOf(address, {
        coverage: 'partial',
        pairCount: 250,
        truncated: true,
      }),
    );

    renderSection(1, address);

    await screen.findAllByTestId('approval-row');
    const caveats = screen.getByTestId('approvals-caveats').textContent ?? '';
    expect(caveats).toContain('Showing the first 100 of 250 discovered approvals');
    expect(caveats).toContain('The scan stopped before covering the whole window');
  });

  it('links to revoke.cash for the checksummed address — the only action surface', async () => {
    const address = addressOf('4444');
    mocks.get.mockResolvedValue(pageOf(address));

    renderSection(1, address);

    const link = await screen.findByTestId('approvals-revoke-link');
    expect(link).toHaveAttribute('href', `https://revoke.cash/address/${getAddress(address)}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});

describe('ApprovalSection — honesty states', () => {
  it('says discovery succeeded but current values could not be read (reason degrade)', async () => {
    const address = addressOf('5555');
    mocks.get.mockResolvedValue(
      pageOf(address, { approvals: [], pairCount: 7, reason: 'allowance-read-failed' }),
    );

    renderSection(1, address);

    expect(
      await screen.findByTestId('approvals-degraded'),
    ).toHaveTextContent('Discovered 7 approvals, but current allowances could not be read');
    expect(screen.queryByTestId('approvals-table')).not.toBeInTheDocument();
  });

  it('empty + complete coverage renders an explicit no-approvals copy, not a null', async () => {
    const address = addressOf('6666');
    mocks.get.mockResolvedValue(pageOf(address, { approvals: [], pairCount: 0 }));

    renderSection(1, address);

    expect(await screen.findByTestId('approvals-empty')).toHaveTextContent(
      'No ERC-20 approvals found in the scanned window',
    );
  });

  it('empty + partial coverage never reads as proof of absence', async () => {
    const address = addressOf('7777');
    mocks.get.mockResolvedValue(
      pageOf(address, { approvals: [], pairCount: 0, coverage: 'partial' }),
    );

    renderSection(1, address);

    expect(await screen.findByTestId('approvals-empty')).toHaveTextContent(
      'not proof of absence',
    );
  });

  it('empty + scan-failed says the scan failed', async () => {
    const address = addressOf('8888');
    mocks.get.mockResolvedValue(
      pageOf(address, { approvals: [], pairCount: 0, coverage: 'scan-failed' }),
    );

    renderSection(1, address);

    expect(await screen.findByTestId('approvals-empty')).toHaveTextContent(
      'The approval scan failed',
    );
  });
});

describe('ApprovalSection — loading, error and null', () => {
  it('renders a skeleton while the first fetch is in flight', () => {
    const address = addressOf('9999');
    mocks.get.mockReturnValue(new Promise(() => undefined));

    const { container } = renderSection(1, address);

    expect(screen.getByTestId('approvals-skeleton')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="approvals-table"]')).toBeNull();
  });

  it('renders the degraded state with the server reason on error (rate limit included)', async () => {
    const address = addressOf('aaaa');
    mocks.get.mockRejectedValue(
      new ApiError('Rate limit exceeded for address-approvals; retry after 6s.', 429),
    );

    renderSection(1, address);

    const error = await screen.findByTestId('approvals-error');
    expect(error).toHaveTextContent('Approvals unavailable');
    expect(error).toHaveTextContent('Rate limit exceeded for address-approvals');
  });

  it('offers an inline Retry on a settled error that refetches and recovers', async () => {
    const address = addressOf('cccc');
    mocks.metas = metasOf();
    mocks.get
      .mockRejectedValueOnce(
        new ApiError('Rate limit exceeded for address-approvals; retry after 6s.', 429),
      )
      .mockResolvedValueOnce(pageOf(address));

    renderSection(1, address);

    // The query layer caches the settled error — only refetch re-issues
    // the request (the second fetch below IS the refetch call).
    const error = await screen.findByTestId('approvals-error');
    expect(error).toHaveTextContent('Approvals unavailable');
    expect(mocks.get).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('approvals-retry'));

    // Recovery renders the unchanged success state: rows, not the error.
    expect(await screen.findAllByTestId('approval-row')).toHaveLength(2);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('approvals-error')).not.toBeInTheDocument();
  });

  it('renders null for gated keys (chainId <= 0) — nothing to show, nothing to claim', () => {
    const address = addressOf('bbbb');

    const { container } = renderSection(0, address);

    expect(container.innerHTML).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('ApprovalSection — approval history sub-section', () => {
  const TX_A = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const TX_B = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const TX_C = '0x3333333333333333333333333333333333333333333333333333333333333333';

  const historyOf = (owner: string): ApprovalHistoryEvent[] => [
    {
      kind: 'erc20',
      approvalEvent: 'Approval',
      token: TOKEN_A,
      owner,
      spender: SPENDER_A,
      blockNumber: 19_000_123,
      txHash: TX_A,
      value: '1500000000000000000',
    },
    {
      kind: 'erc721',
      approvalEvent: 'Approval',
      token: TOKEN_B,
      owner,
      spender: SPENDER_B,
      blockNumber: 19_000_100,
      txHash: TX_B,
      value: null,
    },
    {
      kind: 'erc1155',
      approvalEvent: 'ApprovalForAll',
      token: TOKEN_B,
      owner,
      spender: SPENDER_A,
      blockNumber: 19_000_090,
      txHash: TX_C,
      value: null,
    },
  ];

  const expandHistory = () => {
    const header = screen.getByRole('button', { name: /Approval history/ });
    fireEvent.click(header);
    return header;
  };

  it('rides the same fetch collapsed by default and expands on click', async () => {
    const address = addressOf('d1d1');
    mocks.get.mockResolvedValue(pageOf(address, { history: historyOf(address) }));
    mocks.metas = metasOf();

    renderSection(1, address);

    await screen.findAllByTestId('approval-row');
    // Accessible name carries the badge count ("Approval history 3").
    const header = screen.getByRole('button', { name: /Approval history 3/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    // Collapsible contract: content stays mounted but hidden.
    expect(
      screen.getByTestId('approval-history-table').closest('[aria-hidden="true"]'),
    ).not.toBeNull();

    fireEvent.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByTestId('approval-history-table').closest('[aria-hidden="true"]'),
    ).toBeNull();
    expect(screen.getAllByTestId('approval-history-row')).toHaveLength(3);
  });

  it('renders rows with block, tx and token links, spender and per-kind value', async () => {
    const address = addressOf('d2d2');
    mocks.get.mockResolvedValue(pageOf(address, { history: historyOf(address) }));
    mocks.metas = metasOf();

    renderSection(1, address);
    await screen.findAllByTestId('approval-row');
    expandHistory();

    const rows = screen.getAllByTestId('approval-history-row');
    // Newest-first as delivered by the backend.
    expect(rows[0]).toHaveTextContent('19,000,123');

    const [erc20, erc721, erc1155] = rows;
    // Tx TypedLink and token link per row.
    expect(within(erc20).getByRole('link', { name: /0x1111/ })).toHaveAttribute(
      'href',
      `/chain/1/tx/${TX_A}`,
    );
    expect(within(erc20).getByRole('link', { name: 'TKN' })).toHaveAttribute(
      'href',
      `/chain/1/token/${TOKEN_A}`,
    );
    // Decimals-formatted grant amount, as-at-the-time (not the snapshot).
    expect(erc20).toHaveTextContent('1.5 TKN');
    expect(within(erc20).getByText(shortOf(SPENDER_A))).toBeInTheDocument();
    expect(within(erc20).getByText('ERC-20')).toBeInTheDocument();

    // NFT kinds: no value to format — the honest em dash, kind chips say
    // which standard, and the token link uses the resolved symbol (MAX
    // here) with the token-page href.
    expect(within(erc721).getByText('ERC-721')).toBeInTheDocument();
    expect(within(erc721).getByText('—')).toBeInTheDocument();
    expect(within(erc721).getByRole('link', { name: 'MAX' })).toHaveAttribute(
      'href',
      `/chain/1/token/${TOKEN_B}`,
    );
    expect(within(erc1155).getByText('ERC-1155')).toBeInTheDocument();
    expect(within(erc1155).getByText('—')).toBeInTheDocument();
  });

  it('carries the bounded-window caveat and the truncation notice when flagged', async () => {
    const address = addressOf('d3d3');
    mocks.get.mockResolvedValue(
      pageOf(address, { history: historyOf(address), historyTruncated: true }),
    );
    mocks.metas = metasOf();

    renderSection(1, address);
    await screen.findAllByTestId('approval-row');
    expandHistory();

    const caveats = screen.getByTestId('approval-history-caveats').textContent ?? '';
    expect(caveats).toContain('not a complete approval history');
    expect(caveats).toContain('Values are as granted at the time, not current allowances');
    expect(screen.getByTestId('approval-history-truncated')).toHaveTextContent(
      'Showing the first 200 events',
    );
  });

  it('renders no history sub-section when the scan retained no events', async () => {
    const address = addressOf('d4d4');
    mocks.get.mockResolvedValue(pageOf(address));

    renderSection(1, address);

    await screen.findAllByTestId('approval-row');
    expect(screen.queryByTestId('approval-history-table')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Approval history/ })).not.toBeInTheDocument();
    // Same single fetch — the history rides it or does not exist.
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });
});
