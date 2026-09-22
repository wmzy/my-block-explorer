// jsdom tests for the Approvals (discovered) section: settled rows with
// metadata-formatted allowances and the Max badge, the mandatory
// window/scan caveat copy, raw fallback when decimals are unknown, the
// honest degraded/empty states, the error state (e.g. rate-limit 429),
// the revoke.cash external link, and the gated-key null. The HTTP layer
// and the token-metadata hook are mocked — these pin VIEW behavior, not
// the endpoint (covered in approvalsRoute.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { getAddress } from 'viem';
import '@testing-library/jest-dom/vitest';
import {
  ApprovalSection,
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

const renderSection = (chainId: number, address: string) =>
  render(<ApprovalSection chainId={chainId} address={address} />);

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

  it('renders null for gated keys (chainId <= 0) — nothing to show, nothing to claim', () => {
    const address = addressOf('bbbb');

    const { container } = renderSection(0, address);

    expect(container.innerHTML).toBe('');
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
