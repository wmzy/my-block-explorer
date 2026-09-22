// Focused jsdom tests for the NFT Holdings (discovered) section: the
// component receives already-fetched participant-mode rows and never
// fetches transfers itself; only the shared-signature metadata reads hit
// the (mocked) RPC client, per-token, through the same module cache the
// transfers tab uses. Pins clean absence (ERC-20-only / first-scan
// loading), row rendering (links, badges, exact counts, sample ids),
// the mandatory window caveat, and the honest clamp/unclassified notes.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom/vitest';
import NftHoldings from '@/views/Address/NftHoldings';
// Type-only import: erased at runtime, so the vi.mock below is unaffected.
import type { TokenTransfer } from '@/services/tokenTransfers';

// Metadata behavior knob per token: 'erc20' (symbol+decimals), 'erc721'
// (symbol only), 'unknown' (both revert). The hoisted factory's explicit
// return type types the empty initializer without an `as` assertion
// (eslint's no-unnecessary-type-assertion and tsc disagree on that one)
// and without referencing module-level values (vi.hoisted runs first).
type TokenBehavior = 'erc20' | 'erc721' | 'unknown';

type NftHoldingsMocks = {
  chainId: number;
  holder: string;
  other: string;
  token721: string;
  token1155: string;
  tokenErc20: string;
  tokenUnknown: string;
  token721Long: string;
  transfers: TokenTransfer[];
  loading: boolean;
  behavior: Record<string, TokenBehavior>;
  readCalls: string[];
};

const mocks = vi.hoisted((): NftHoldingsMocks => {
  const chainId = 1;
  const holder = '0x1234567890abcdef1234567890abcdef12345678';
  const other = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
  // Distinct fixture tokens per behavior (the metadata cache keyed by
  // `${chainId}:${token}` is module-level and shared across tests).
  const token721 = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const token1155 = '0xcccccccccccccccccccccccccccccccccccccccc';
  const tokenErc20 = '0xdddddddddddddddddddddddddddddddddddddddd';
  const tokenUnknown = '0xffffffffffffffffffffffffffffffffffffffff';
  const token721Long = '0x9999999999999999999999999999999999999999';
  return {
    chainId,
    holder,
    other,
    token721,
    token1155,
    tokenErc20,
    tokenUnknown,
    token721Long,
    transfers: [] as TokenTransfer[],
    loading: false,
    // Metadata behavior knob per token: 'erc20' (symbol+decimals), 'erc721'
    // (symbol only), 'unknown' (both revert).
    behavior: {},
    readCalls: [] as string[],
  };
});

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(async () => ({
    readContract: async (call: { address: string; functionName: string }) => {
      mocks.readCalls.push(`${call.address}:${call.functionName}`);
      const behavior = mocks.behavior[call.address] ?? 'unknown';
      if (behavior === 'erc20') {
        if (call.functionName === 'symbol') return 'TKN';
        return 18;
      }
      if (behavior === 'erc721') {
        if (call.functionName === 'symbol') return 'PUNK';
        // No decimals() on the contract → the ERC-721 signal.
        throw new Error('execution reverted');
      }
      throw new Error('execution reverted');
    },
  })),
}));

function transferRow(fields: Partial<TokenTransfer>): TokenTransfer {
  return {
    txHash: '0xdead',
    blockNumber: 1,
    logIndex: 0,
    token: mocks.token721,
    standard: 'erc20-or-erc721',
    from: mocks.other,
    to: mocks.holder,
    value: '0',
    direction: 'in',
    ...fields,
  };
}

function Host() {
  return (
    <NftHoldings
      transfers={mocks.transfers}
      address={mocks.holder}
      chainId={mocks.chainId}
      loading={mocks.loading}
    />
  );
}

const routes = createRoutes([
  { path: '/', component: () => Promise.resolve(Host) },
]);

const renderSection = () =>
  render(
    <MemoryRouter routes={routes} initialEntries={['/']}>
      <View />
    </MemoryRouter>,
  );

// Waits until the shared-signature metadata reads for a token settled
// (both symbol and decimals attempted), so absence assertions test the
// RESOLVED classification, not the still-pending one.
const waitForMetaReads = (token: string) =>
  waitFor(() => {
    const calls = mocks.readCalls.filter(call => call.startsWith(`${token}:`));
    expect(calls).toEqual(
      expect.arrayContaining([`${token}:symbol`, `${token}:decimals`]),
    );
  });

const CAVEAT = 'Discovered from the scanned transfer window — may be incomplete.';

describe('NftHoldings section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transfers = [];
    mocks.loading = false;
    mocks.behavior = {
      [mocks.token721]: 'erc721',
      [mocks.token721Long]: 'erc721',
      [mocks.tokenErc20]: 'erc20',
    };
    mocks.readCalls = [];
  });

  it('renders one row per NFT contract: link, badge, exact counts, samples, caveat', async () => {
    mocks.transfers = [
      // ERC-721: four ids received → heldCount 4, samples 1/7/9 (+1 more).
      transferRow({ value: '1', blockNumber: 10 }),
      transferRow({ value: '7', blockNumber: 20 }),
      transferRow({ value: '9', blockNumber: 30 }),
      transferRow({ value: '10', blockNumber: 40 }),
      // ERC-1155: single (id 5, 10) + batch (ids 1/2, 4/8) → 3 ids, 22 units.
      transferRow({
        token: mocks.token1155,
        standard: 'erc1155-single',
        tokenIds: ['5'],
        amounts: ['10'],
        value: '10',
        blockNumber: 50,
      }),
      transferRow({
        token: mocks.token1155,
        standard: 'erc1155-batch',
        tokenIds: ['1', '2'],
        amounts: ['4', '8'],
        value: '12',
        blockNumber: 51,
      }),
    ];
    const { container } = renderSection();

    expect(await screen.findByText('NFT Holdings (discovered)')).toBeInTheDocument();
    // Contract links route to the contract page.
    expect(screen.getByText('0xbbbbbb...bbbbbb').closest('a')).toHaveAttribute(
      'href',
      `/chain/1/contract/${mocks.token721}`,
    );
    expect(screen.getByText('0xcccccc...cccccc').closest('a')).toHaveAttribute(
      'href',
      `/chain/1/contract/${mocks.token1155}`,
    );
    // Standard badges and exact held counts.
    expect(screen.getByText('ERC-721')).toBeInTheDocument();
    expect(screen.getByText('ERC-1155')).toBeInTheDocument();
    expect(screen.getByText('4 token ids')).toBeInTheDocument();
    expect(screen.getByText('3 ids · 22 units total')).toBeInTheDocument();
    // Sample ids: first three (numeric order) with the +N overflow marker.
    expect(screen.getByText('1, 7, 9 +1 more')).toBeInTheDocument();
    expect(screen.getByText('1, 2, 5')).toBeInTheDocument();
    // Sorted by heldCount desc: the 721 contract's block row comes first.
    expect(screen.getAllByText(/last activity block/).map(el => el.textContent)).toEqual([
      'last activity block 40',
      'last activity block 51',
    ]);
    // The mandatory caveat ships with every rendered section.
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
    expect(container).not.toBeEmptyDOMElement();
  });

  it('renders nothing for ERC-20-only rows (clean absence, resolved classification)', async () => {
    mocks.transfers = [
      transferRow({ token: mocks.tokenErc20, value: '1500' }),
      transferRow({ token: mocks.tokenErc20, value: '20', from: mocks.holder, to: mocks.other }),
    ];
    const { container } = renderSection();

    // Wait for the metadata classification to settle as ERC-20 first —
    // then absence is the settled verdict, not a pending one.
    await waitForMetaReads(mocks.tokenErc20);
    await waitFor(() => {
      expect(screen.queryByText('NFT Holdings (discovered)')).toBeNull();
      expect(container).toBeEmptyDOMElement();
    });
  });

  it('renders nothing while the first scan is in flight without rows', () => {
    mocks.loading = true;
    mocks.transfers = [];
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
    // No metadata reads either: there is nothing to classify yet.
    expect(mocks.readCalls).toEqual([]);
  });

  it('discloses the clamp when an id nets negative in-window', async () => {
    mocks.transfers = [
      transferRow({
        token: mocks.token1155,
        standard: 'erc1155-single',
        tokenIds: ['4'],
        amounts: ['10'],
        value: '10',
        from: mocks.holder,
        to: mocks.other,
        blockNumber: 5,
      }),
      transferRow({
        token: mocks.token1155,
        standard: 'erc1155-single',
        tokenIds: ['4'],
        amounts: ['2'],
        value: '2',
        blockNumber: 6,
      }),
      transferRow({
        token: mocks.token1155,
        standard: 'erc1155-single',
        tokenIds: ['6'],
        amounts: ['1'],
        value: '1',
        blockNumber: 7,
      }),
    ];
    renderSection();

    expect(await screen.findByText('1 id · 1 units total')).toBeInTheDocument();
    expect(
      screen.getByText(
        'more units sent than received within the window — affected ids shown as not held',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(CAVEAT)).toBeInTheDocument();
  });

  it('notes unclassified shared-signature transfers beside real NFT rows', async () => {
    mocks.transfers = [
      transferRow({ value: '5' }),
      // Both metadata reads revert → standard stays unknown → excluded note.
      transferRow({ token: mocks.tokenUnknown, value: '8' }),
    ];
    renderSection();

    expect(await screen.findByText('1 token id')).toBeInTheDocument();
    expect(
      screen.getByText(
        '1 transfer with unresolved token standard (ERC-20 vs ERC-721) excluded.',
      ),
    ).toBeInTheDocument();
  });

  it('truncates long sample ids and carries the full value in the title', async () => {
    const longId = '340282366920938463463374607431768211456'; // 2^128
    mocks.transfers = [transferRow({ value: longId })];
    renderSection();

    expect(await screen.findByText('34028236...68211456')).toBeInTheDocument();
    expect(screen.getByTitle(longId)).toBeInTheDocument();
  });
});

describe('NftHoldings mobile degradation', () => {
  // Linaria is zero-runtime: jsdom sees class names but never applies
  // CSS — the pins below keep the stacking rules from being silently
  // dropped (the responsiveLayout suite's approach).
  const src = readFileSync(
    resolve(__dirname, '../../../src/views/Address/NftHoldings.tsx'),
    'utf8',
  );

  it('stacks/left-aligns rows at phone width instead of overflowing', () => {
    expect(src.match(/@media \(max-width: 768px\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src).toContain('flex-wrap: wrap');
    expect(src).toContain('justify-content: flex-start');
  });
});
