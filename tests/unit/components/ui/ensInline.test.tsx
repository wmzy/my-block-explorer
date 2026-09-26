// EnsInline observable behavior: the address link upgrades in place to a
// verified ENS name (name text, address-route href, full checksummed
// address in the title), unresolved/loading/failure render the same short
// address form the list always showed, and disabled/unchained instances
// never mount the resolution hook at all — the RPC fan-out bound is a
// call-count guarantee.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import { getAddress } from 'viem';
import '@testing-library/jest-dom/vitest';

import { EnsInline, shortAddress } from '@/components/ui/EnsInline';
import { useEnsName } from '@/services/ens';

vi.mock('@/services/ens', () => ({
  useEnsName: vi.fn(),
}));

const mockUseEnsName = vi.mocked(useEnsName);

// All-lowercase fixture (checksum-neutral input) so the EIP-55
// checksumming in the title attribute is observable — getAddress produces
// a mixed-case checksum the raw input lacks.
const ADDRESS = '0xabcdef0123456789abcdef0123456789abcdef01';
const CHECKSUMMED = getAddress(ADDRESS);
const SHORT = shortAddress(ADDRESS);

// TypedLink needs router context; the stub route keeps the link target
// resolvable (badge-test harness pattern).
const Blank = () => <span data-testid="blank" />;
const routes = createRoutes([
  { path: '/chain/:chainId/address/:address', component: () => Promise.resolve(Blank) },
]);

const renderInline = (props: { address: string; chainId?: number; enabled?: boolean }) =>
  render(
    <MemoryRouter routes={routes}>
      <EnsInline address={props.address} chainId={props.chainId} enabled={props.enabled} />
    </MemoryRouter>,
  );

describe('shortAddress', () => {
  it('truncates to 8 leading + 6 trailing chars around an ellipsis', () => {
    expect(shortAddress(ADDRESS)).toBe(`${ADDRESS.slice(0, 8)}...${ADDRESS.slice(-6)}`);
  });

  it('passes short values through untouched and degrades blanks to N/A', () => {
    expect(shortAddress('0x1234')).toBe('0x1234');
    expect(shortAddress('')).toBe('N/A');
  });
});

describe('EnsInline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The unresolved fallback is the default posture of every test unless
    // a case pins a resolved name.
    mockUseEnsName.mockReturnValue({ data: null, loading: false });
  });

  it('renders the resolved name as the link text, address route as target, checksummed address as title', () => {
    mockUseEnsName.mockReturnValue({ data: 'vitalik.eth', loading: false });
    renderInline({ address: ADDRESS, chainId: 1 });

    const link = screen.getByRole('link', { name: 'vitalik.eth' });
    expect(link).toHaveAttribute('href', `/chain/1/address/${ADDRESS}`);
    expect(link).toHaveAttribute('title', CHECKSUMMED);
    // The upgrade replaces the truncated address, not decorates it.
    expect(screen.queryByText(SHORT)).not.toBeInTheDocument();
  });

  it('resolves by default (enabled defaults to true)', () => {
    renderInline({ address: ADDRESS, chainId: 137 });
    expect(mockUseEnsName).toHaveBeenCalledTimes(1);
    expect(mockUseEnsName).toHaveBeenCalledWith(ADDRESS, 137);
  });

  it('renders the formatted address while loading and when unresolved', () => {
    // Loading: data null despite the request in flight.
    mockUseEnsName.mockReturnValue({ data: null, loading: true });
    const { rerender } = render(
      <MemoryRouter routes={routes}>
        <EnsInline address={ADDRESS} chainId={1} />
      </MemoryRouter>,
    );

    let link = screen.getByRole('link', { name: SHORT });
    expect(link).toHaveAttribute('href', `/chain/1/address/${ADDRESS}`);
    expect(link).toHaveAttribute('title', CHECKSUMMED);
    expect(screen.queryByText('vitalik.eth')).not.toBeInTheDocument();

    // Settled as no name (no reverse record / unverifiable / RPC failure).
    mockUseEnsName.mockReturnValue({ data: null, loading: false });
    rerender(
      <MemoryRouter routes={routes}>
        <EnsInline address={ADDRESS} chainId={1} />
      </MemoryRouter>,
    );
    link = screen.getByRole('link', { name: SHORT });
    expect(link).toHaveAttribute('href', `/chain/1/address/${ADDRESS}`);
  });

  it('never mounts the resolution hook when enabled={false}', () => {
    renderInline({ address: ADDRESS, chainId: 1, enabled: false });

    expect(mockUseEnsName).not.toHaveBeenCalled();
    // Still the same link, same target, same hover affordance — only the
    // resolution is skipped.
    const link = screen.getByRole('link', { name: SHORT });
    expect(link).toHaveAttribute('href', `/chain/1/address/${ADDRESS}`);
    expect(link).toHaveAttribute('title', CHECKSUMMED);
  });

  it('degrades to plain text without a link when chainId is undefined', () => {
    renderInline({ address: ADDRESS, chainId: undefined });

    expect(mockUseEnsName).not.toHaveBeenCalled();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    const text = screen.getByTitle(CHECKSUMMED);
    expect(text).toHaveTextContent(SHORT);
  });
});
