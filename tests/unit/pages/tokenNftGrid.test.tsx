// Observable behavior of the Token page's Items (discovered) grid: the
// nftMetadata service's honesty states ARE the tile states (ok renders
// image + name; none renders an id-only tile with a "no metadata" chip;
// unavailable renders an id-only tile with an "unavailable" chip plus a
// per-tile retry that genuinely re-resolves that one item), clicking a
// tile copies its token id (no navigation), 1155 amount/burned lines
// render from the derivation, and the mandatory cap caveat renders in
// every non-empty state.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import NftGrid from '@/views/Token/NftGrid';
import type { NftItem } from '@/views/Token/nftItems';
import {
  fetchNftMetadataBatch,
  nftMetadataKey,
  useNftMetadata,
  type NftMetadataOutcome,
} from '@/services/nftMetadata';

vi.mock('@/services/nftMetadata', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/nftMetadata')>();
  return {
    ...actual,
    useNftMetadata: vi.fn(),
    fetchNftMetadataBatch: vi.fn(),
  };
});

const mockUseNftMetadata = vi.mocked(useNftMetadata);
const mockFetchBatch = vi.mocked(fetchNftMetadataBatch);

const CHAIN_ID = 1;
const CONTRACT = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

const item721 = (tokenId: string): NftItem => ({
  standard: 'erc721',
  tokenId,
  amount: 1n,
  burned: false,
});

const item1155 = (tokenId: string, amount: bigint, burned = false): NftItem => ({
  standard: 'erc1155',
  tokenId,
  amount,
  burned,
});

// Resolves the mocked hook with an outcome map for the given items.
const settleMetadata = (items: readonly NftItem[], outcomeFor: (tokenId: string) => NftMetadataOutcome) => {
  const map = new Map<string, NftMetadataOutcome>();
  for (const item of items) map.set(nftMetadataKey(CONTRACT, item.tokenId), outcomeFor(item.tokenId));
  mockUseNftMetadata.mockReturnValue(map);
};

beforeEach(() => {
  mockUseNftMetadata.mockReset();
  mockFetchBatch.mockReset();
  // jsdom has no clipboard; tests that exercise copy install their own.
  Object.defineProperty(navigator, 'clipboard', {
    value: undefined,
    configurable: true,
  });
});

describe('NftGrid metadata honesty states', () => {
  it('renders an ok item image and name with its id', () => {
    const items = [item721('7')];
    settleMetadata(items, () => ({
      status: 'ok',
      name: 'Cool Ape #7',
      image: 'https://example.com/7.png',
      description: null,
    }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={items} />);

    const image = screen.getByTestId('nft-tile-image');
    expect(image).toHaveAttribute('src', 'https://example.com/7.png');
    expect(screen.getByTestId('nft-tile-name')).toHaveTextContent('Cool Ape #7');
    expect(screen.getByTestId('nft-tile-id')).toHaveTextContent('#7');
    // Full id rides the tile, truncation or not.
    expect(screen.getByTestId('nft-item-tile')).toHaveAttribute('data-token-id', '7');
  });

  it('renders an id-only tile with a no-metadata chip for the none outcome', () => {
    const items = [item721('7')];
    settleMetadata(items, () => ({ status: 'none' }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={items} />);

    expect(screen.getByTestId('nft-tile-chip-none')).toHaveTextContent('no metadata');
    expect(screen.queryByTestId('nft-tile-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-tile-chip-unavailable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-tile-retry')).not.toBeInTheDocument();
  });

  it('degrades an ok item without image/name to an id-only tile (no chips)', () => {
    const items = [item721('7')];
    settleMetadata(items, () => ({
      status: 'ok',
      name: null,
      image: null,
      description: 'text-only metadata is real metadata',
    }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={items} />);

    expect(screen.getByTestId('nft-tile-id')).toHaveTextContent('#7');
    expect(screen.queryByTestId('nft-tile-image')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-tile-name')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-tile-chip-none')).not.toBeInTheDocument();
  });

  it('renders an unavailable chip plus a per-tile retry that re-resolves one item', async () => {
    const items = [item721('7'), item721('8')];
    settleMetadata(items, tokenId => (tokenId === '7' ? { status: 'ok', name: 'Resolved', image: null, description: null } : { status: 'unavailable' }));
    mockFetchBatch.mockResolvedValue(
      new Map([[nftMetadataKey(CONTRACT, '8'), { status: 'ok', name: 'After retry', image: null, description: null }]]),
    );
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={items} />);

    expect(screen.getByTestId('nft-tile-chip-unavailable')).toHaveTextContent('metadata unavailable');
    fireEvent.click(screen.getByTestId('nft-tile-retry'));

    await waitFor(() => {
      const tile8 = screen
        .getAllByTestId('nft-item-tile')
        .find(tile => tile.dataset.tokenId === '8');
      expect(tile8?.querySelector('[data-testid="nft-tile-name"]')).toHaveTextContent(
        'After retry',
      );
    });
    // The retry resolved exactly the one unavailable item — never a batch.
    expect(mockFetchBatch).toHaveBeenCalledTimes(1);
    expect(mockFetchBatch).toHaveBeenCalledWith(CHAIN_ID, [
      { contract: CONTRACT, tokenId: '8', standard: 'erc721' },
    ]);
    expect(screen.queryByTestId('nft-tile-chip-unavailable')).not.toBeInTheDocument();
  });

  it('keeps the unavailable chip when the retry stays unavailable', async () => {
    const items = [item721('8')];
    settleMetadata(items, () => ({ status: 'unavailable' }));
    mockFetchBatch.mockResolvedValue(new Map());
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={items} />);

    fireEvent.click(screen.getByTestId('nft-tile-retry'));
    await waitFor(() => {
      expect(mockFetchBatch).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByTestId('nft-tile-chip-unavailable')).toBeInTheDocument();
    // The retry button stays usable — 'unavailable' is never final.
    expect(screen.getByTestId('nft-tile-retry')).toBeEnabled();
  });

  it('shimmers the metadata slot while the batch is in flight (ids still visible)', () => {
    mockUseNftMetadata.mockReturnValue(undefined);
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={[item721('7')]} />);

    expect(screen.getByTestId('nft-tile-id')).toHaveTextContent('#7');
    expect(screen.queryByTestId('nft-tile-chip-none')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-tile-chip-unavailable')).not.toBeInTheDocument();
    expect(screen.queryByTestId('nft-tile-image')).not.toBeInTheDocument();
  });
});

describe('NftGrid tiles', () => {
  it('copies the token id on tile click, confirming in place (no navigation)', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    settleMetadata([item721('7')], () => ({ status: 'none' }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={[item721('7')]} />);

    fireEvent.click(screen.getByTestId('nft-item-tile'));
    await screen.findByText('copied ✓');
    expect(writeText).toHaveBeenCalledWith('7');
  });

  it('stays quiet when the clipboard is unavailable (never a false confirmation)', () => {
    settleMetadata([item721('7')], () => ({ status: 'none' }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={[item721('7')]} />);

    fireEvent.click(screen.getByTestId('nft-item-tile'));
    expect(screen.queryByText('copied ✓')).not.toBeInTheDocument();
    expect(screen.getByTestId('nft-tile-id')).toHaveTextContent('#7');
  });

  it('does not copy when the retry button inside the tile is clicked', () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    settleMetadata([item721('8')], () => ({ status: 'unavailable' }));
    mockFetchBatch.mockResolvedValue(new Map());
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={[item721('8')]} />);

    fireEvent.click(screen.getByTestId('nft-tile-retry'));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('renders the 1155 net amount line and the burned marker', () => {
    const items = [item1155('5', 40n), item1155('9', 0n, true), item1155('11', 0n)];
    settleMetadata(items, () => ({ status: 'none' }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={items} />);

    expect(screen.getByTestId('nft-tile-amount')).toHaveTextContent('× 40');
    expect(screen.getByTestId('nft-tile-burned')).toHaveTextContent('burned');
    // A zero net without a burn renders no amount line (never "× 0" as a
    // fabricated supply).
    expect(screen.queryByText('× 0')).not.toBeInTheDocument();
  });
});

describe('NftGrid section chrome', () => {
  it('always carries the discovered-items cap caveat', () => {
    settleMetadata([item721('7')], () => ({ status: 'none' }));
    render(<NftGrid chainId={CHAIN_ID} contract={CONTRACT} items={[item721('7')]} />);
    expect(screen.getByTestId('nft-items-caveat')).toHaveTextContent(
      'Showing up to 24 items discovered from scanned transfers — not the full collection supply.',
    );
  });
});
