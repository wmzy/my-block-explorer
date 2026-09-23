// Focused jsdom tests for the NFT Holdings per-item metadata previews:
// the section rides the nftMetadata service (mocked here — its own file
// tests resolution) and must degrade honestly per item: 'ok' renders
// thumbnail + name (nulls handled), 'unavailable' a muted chip, 'none'
// nothing beyond the existing sample-id display, and pending renders
// shimmer skeletons INSIDE the metadata slot only. The 24-item preview
// cap must disclose itself instead of implying completeness.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import NftHoldings from '@/views/Address/NftHoldings';
import type { NftMetadataOutcome } from '@/services/nftMetadata';
// Type-only import: erased at runtime, so the vi.mock below is unaffected.
import type { TokenTransfer } from '@/services/tokenTransfers';

// Per-test knob: what useNftMetadata hands the section. `undefined` models
// the in-flight batch; a Map models a settled one.
type NftMetadataMocks = {
  chainId: number;
  holder: string;
  other: string;
  token: string;
  transfers: TokenTransfer[];
  hookResult: Map<string, NftMetadataOutcome> | undefined;
};

const mocks = vi.hoisted((): NftMetadataMocks => ({
  chainId: 1,
  holder: '0x1234567890abcdef1234567890abcdef12345678',
  other: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
  token: '0xcccccccccccccccccccccccccccccccccccccccc',
  transfers: [] as TokenTransfer[],
  hookResult: undefined,
}));

vi.mock('@/services/nftMetadata', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/nftMetadata')>();
  return {
    ...actual,
    useNftMetadata: vi.fn(() => mocks.hookResult),
  };
});

// The metadata service's default reader is never reached (the hook above
// is mocked); this only keeps the shared-signature classification of any
// stray erc20-or-erc721 fixture hermetic.
vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(async () => ({
    readContract: async () => {
      throw new Error('execution reverted');
    },
  })),
}));

// ERC-1155 single transfers give the holder `amount` of `tokenId` — no
// shared-signature classification involved.
function mintRows(ids: readonly string[]): TokenTransfer[] {
  return ids.map((tokenId, index) => ({
    txHash: `0xdead${index}`,
    blockNumber: index + 1,
    logIndex: index,
    token: mocks.token,
    standard: 'erc1155-single' as const,
    from: mocks.other,
    to: mocks.holder,
    tokenIds: [tokenId],
    amounts: ['1'],
    value: '1',
    direction: 'in' as const,
  }));
}

function Host() {
  return (
    <NftHoldings
      transfers={mocks.transfers}
      address={mocks.holder}
      chainId={mocks.chainId}
      loading={false}
    />
  );
}

const routes = createRoutes([
  { path: '/', component: () => Promise.resolve(Host) },
]);

const renderSection = async () => {
  const view = render(
    <MemoryRouter routes={routes} initialEntries={['/']}>
      <View />
    </MemoryRouter>,
  );
  // The route component mounts through an async loader — wait for the
  // section before asserting on it.
  await screen.findByText('NFT Holdings (discovered)');
  return view;
};

const ok = (
  name: string | null,
  image: string | null,
): NftMetadataOutcome => ({ status: 'ok', name, image, description: null });

describe('NftHoldings metadata previews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transfers = [];
    mocks.hookResult = undefined;
    localStorage.clear();
  });

  it('renders thumbnail and name for a resolved item', async () => {
    mocks.transfers = mintRows(['1']);
    mocks.hookResult = new Map([
      [`${mocks.token}:1`, ok('Azumi #1', 'https://ipfs.io/ipfs/img1.png')],
    ]);

    await renderSection();

    const img = screen.getByAltText('Azumi #1');
    expect(img).toHaveAttribute('src', 'https://ipfs.io/ipfs/img1.png');
    expect(screen.getByText('Azumi #1')).toBeInTheDocument();
    expect(screen.getByTitle('Azumi #1')).toBeInTheDocument();
  });

  it('keeps the sample-id display when the item has no metadata (none)', async () => {
    mocks.transfers = mintRows(['1']);
    mocks.hookResult = new Map([[`${mocks.token}:1`, { status: 'none' }]]);

    await renderSection();

    expect(screen.getByText('NFT Holdings (discovered)')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument(); // sample id stays
    expect(screen.queryByTestId('nft-item-chip')).toBeNull();
    expect(screen.queryByText('metadata unavailable')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('shows a muted retryable chip when metadata transport failed', async () => {
    mocks.transfers = mintRows(['2']);
    mocks.hookResult = new Map([[`${mocks.token}:2`, { status: 'unavailable' }]]);

    await renderSection();

    expect(screen.getByText('metadata unavailable')).toBeInTheDocument();
    expect(screen.getByTitle(`token 2`)).toBeInTheDocument();
    expect(screen.queryByTestId('nft-item-chip')).toBeNull();
  });

  it('falls back to a muted placeholder when the item has no image', async () => {
    mocks.transfers = mintRows(['3']);
    mocks.hookResult = new Map([[`${mocks.token}:3`, ok('No Image', null)]]);

    await renderSection();

    expect(screen.getByText('No Image')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByTitle('no image')).toBeInTheDocument();
  });

  it('renders the thumb only (no name span) when a resolved item has no name', async () => {
    mocks.transfers = mintRows(['4']);
    mocks.hookResult = new Map([
      [`${mocks.token}:4`, ok(null, 'https://ipfs.io/ipfs/img4.png')],
    ]);

    await renderSection();

    const img = screen.getByAltText('token 4');
    expect(img).toHaveAttribute('src', 'https://ipfs.io/ipfs/img4.png');
    // One chip, no name text inside it.
    expect(screen.getByTestId('nft-item-chip').textContent).toBe('');
  });

  it('swaps a failed image load to the muted placeholder', async () => {
    mocks.transfers = mintRows(['5']);
    mocks.hookResult = new Map([
      [`${mocks.token}:5`, ok('Broken', 'https://ipfs.io/ipfs/broken.png')],
    ]);

    await renderSection();

    fireEvent.error(screen.getByAltText('Broken'));
    expect(screen.getByTitle('image failed to load')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    // The name row survives the image failure.
    expect(screen.getByText('Broken')).toBeInTheDocument();
  });

  it('skeletonizes only the metadata slot while the batch is in flight', async () => {
    mocks.transfers = mintRows(['6', '7']);

    const { container } = await renderSection();

    // Rows are already fully rendered — nothing waits on the metadata.
    expect(screen.getByText('NFT Holdings (discovered)')).toBeInTheDocument();
    expect(screen.getByText('2 ids · 2 units total')).toBeInTheDocument();
    // One shimmer box per pending item, inside the strip only.
    const shimmers = container.querySelectorAll(`[aria-hidden="true"]`);
    expect(shimmers.length).toBe(2);
    expect(screen.queryByText('metadata unavailable')).toBeNull();
    expect(screen.queryByTestId('nft-item-chip')).toBeNull();
  });

  it('caps previews at 24 items and discloses the cap', async () => {
    mocks.transfers = mintRows(Array.from({ length: 26 }, (_, i) => String(i + 1)));

    const { container } = await renderSection();

    expect(
      screen.getByText('showing first 24 of 26 held items'),
    ).toBeInTheDocument();
    // Pending metadata: exactly 24 skeleton slots, not 26.
    expect(container.querySelectorAll(`[aria-hidden="true"]`).length).toBe(24);
    expect(screen.getByText('26 ids · 26 units total')).toBeInTheDocument();
  });

  it('caps at 24 across contracts and omits the disclosure line at or below the cap', async () => {
    const otherToken = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    mocks.transfers = [
      ...mintRows(Array.from({ length: 20 }, (_, i) => String(i + 1))),
      ...mintRows(['1']).map(row => ({ ...row, token: otherToken })),
    ];
    // 21 owned items total: no cap line, strip items 20 + 1.
    const { container } = await renderSection();

    expect(screen.queryByText(/showing first/)).toBeNull();
    expect(container.querySelectorAll(`[aria-hidden="true"]`).length).toBe(21);
    expect(screen.getByText('20 ids · 20 units total')).toBeInTheDocument();
    expect(screen.getByText('1 id · 1 units total')).toBeInTheDocument();
  });
});
