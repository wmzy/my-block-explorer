// External cross-verification links (G4): tx/block/contract detail pages
// link out to the chain's explorer + Routescan (+ EVMole for contracts)
// from the PAGE HEADER — reachable before/without the entity resolving,
// unlike a placement buried in the loaded data card. The Address page
// already carries its links (covered by addressPage tests) and stays
// untouched here. Services and network-adjacent children are mocked; the
// chains mock carries a blockExplorers.default entry so the explorer link
// (not just Routescan) is asserted.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import TransactionDetail from '@/views/Transactions/Detail';
import BlockDetail from '@/views/Blocks/Detail';
import Contract from '@/views/Contract';
import { useContractCreation, useContractSource, useStorageLayout } from '@/services/contracts';
import { useTransactionByHash, useBlockByNumber } from '@/services/chainRpc';
import { post } from '@/util/http';

const TX_HASH = '0xdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678';
const ADDRESS = '0xabc0000000000000000000000000000000000001';
const BLOCK_NUMBER = '18000001';

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) =>
    chainId === 1
      ? {
          id: 1,
          name: 'Ethereum',
          nativeCurrency: { symbol: 'ETH' },
          blockExplorers: { default: { name: 'Etherscan', url: 'https://etherscan.io' } },
        }
      : null,
  getChainName: (chainId: number) => (chainId === 1 ? 'Ethereum' : `Chain ${chainId}`),
  getChainSymbol: () => 'ETH',
  getChainType: () => 'mainnet',
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  POPULAR_CHAINS: [{ id: 137, name: 'Polygon' }],
}));

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain: {currentChainId}</div>
  ),
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(async () => ({ call: vi.fn() })),
}));

vi.mock('@/services/chainRpc', () => ({
  useTransactionByHash: vi.fn(),
  useBlockByNumber: vi.fn(),
}));

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
  useContractCreation: vi.fn(),
  useStorageLayout: vi.fn(),
}));

// The contract view reaches the discovery layer for backend-offline
// recovery; no provider in this harness.
vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ reconnect: vi.fn(async () => null) }),
}));

vi.mock('@/util/http', async importOriginal => {
  const actual = await importOriginal<typeof import('@/util/http')>();
  return { ...actual, get: vi.fn(async () => ({ ides: [] })), post: vi.fn(async () => ({})) };
});

vi.mock('@/components/SourceCodeViewer', () => ({
  SourceCodeViewer: () => <div data-testid="source-viewer" />,
}));

vi.mock('@/components/RpcConfig', () => ({ default: () => <div /> }));

vi.mock('@/components/events/IndexingRangeManager', () => ({
  default: () => <div data-testid="indexing-range-manager" />,
}));

vi.mock('@/components/events/EventStatistics', () => ({
  default: () => <div data-testid="event-statistics" />,
}));

vi.mock('@/components/events/EventTable', () => ({
  default: () => <div data-testid="event-table" />,
}));

vi.mock('@/views/Contract/ContractInteract', () => ({
  ContractInteract: () => <div data-testid="contract-interact" />,
}));

// Keep the finality badge's heads hook quiet; the pure label helper stays
// real.
vi.mock('@/services/blocks', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/blocks')>();
  return { ...actual, useFinalityHeads: vi.fn(() => ({ data: undefined })) };
});

const hookResult = (data: unknown, error?: unknown, loading = false) =>
  ({ data, loading, error, refetch: vi.fn() }) as unknown as never;

function renderView(component: () => ComponentType, pattern: string, initialPath: string) {
  const routes = createRoutes([{ path: pattern, component }]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[initialPath]}>
      <View />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(post).mockResolvedValue({});
  // Views call these unconditionally; tests override what they assert on.
  vi.mocked(useBlockByNumber).mockReturnValue(hookResult(undefined));
  vi.mocked(useTransactionByHash).mockReturnValue(hookResult(undefined));
  vi.mocked(useContractSource).mockReturnValue(hookResult(undefined));
  vi.mocked(useContractCreation).mockReturnValue(hookResult(undefined));
  vi.mocked(useStorageLayout).mockReturnValue(hookResult(undefined));
});

describe('Transaction detail header cross-links', () => {
  const txPath = `/chain/1/tx/${TX_HASH}`;

  it('renders explorer + Routescan tx links in the header for a resolved tx', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult({
        hash: TX_HASH,
        blockNumber: BLOCK_NUMBER,
        transactionIndex: 5,
        fromAddress: ADDRESS,
        toAddress: '0x2222222222222222222222222222222222222222',
        value: '0',
        gasLimit: '50000',
        gasUsed: '30000',
        gasPrice: '20000000000',
        nonce: 42,
        type: 2,
        status: 1,
        inputData: '0x',
        logs: [],
      }),
    );

    renderView(() => TransactionDetail, '/chain/:chainId/tx/:txHash', txPath);

    expect(
      await screen.findByRole('link', { name: /Etherscan/i }),
    ).toHaveAttribute('href', `https://etherscan.io/tx/${TX_HASH}`);
    expect(screen.getByRole('link', { name: /Routescan/i })).toHaveAttribute(
      'href',
      `https://routescan.io/tx/${TX_HASH}`,
    );
  });

  it('keeps the header links available while the tx is still not found (header placement)', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(undefined, new Error('Transaction not found')),
    );

    renderView(() => TransactionDetail, '/chain/:chainId/tx/:txHash', txPath);

    // The not-found card renders below; the cross-links must already be
    // in the header without waiting for data.
    expect(
      await screen.findByRole('link', { name: /Routescan/i }),
    ).toHaveAttribute('href', `https://routescan.io/tx/${TX_HASH}`);
  });
});

describe('Block detail header cross-links', () => {
  const blockPath = `/chain/1/block/${BLOCK_NUMBER}`;

  it('renders explorer + Routescan block links in the header for a resolved block', async () => {
    const { useBlockByNumber } = await import('@/services/chainRpc');
    vi.mocked(useBlockByNumber).mockReturnValue(
      hookResult({
        number: BLOCK_NUMBER,
        hash: '0xblockhash00000000000000000000000000000000000000000000000000000000',
        parentHash: '0xparent0000000000000000000000000000000000000000000000000000000000',
        timestamp: '2026-01-01T00:00:00Z',
        miner: ADDRESS,
        gasUsed: '15000000',
        gasLimit: '30000000',
        transactionCount: 120,
      }),
    );

    renderView(() => BlockDetail, '/chain/:chainId/block/:blockNumber', blockPath);

    expect(
      await screen.findByRole('link', { name: /Etherscan/i }),
    ).toHaveAttribute('href', `https://etherscan.io/block/${BLOCK_NUMBER}`);
    expect(screen.getByRole('link', { name: /Routescan/i })).toHaveAttribute(
      'href',
      `https://routescan.io/block/${BLOCK_NUMBER}`,
    );
  });

  it('renders no external links for an invalid block param', async () => {
    const { useBlockByNumber } = await import('@/services/chainRpc');
    vi.mocked(useBlockByNumber).mockReturnValue(hookResult(undefined));

    renderView(() => BlockDetail, '/chain/:chainId/block/:blockNumber', '/chain/1/block/0x1a');

    await screen.findByText(/Invalid block number/i);
    expect(screen.queryByRole('link', { name: /↗/ })).toBeNull();
  });
});

describe('Contract header cross-links', () => {
  const contractPath = `/chain/1/contract/${ADDRESS}`;

  it('renders explorer + Routescan + EVMole address links in the header', async () => {
    vi.mocked(useContractSource).mockReturnValue(
      hookResult({
        contractSource: {
          chainId: 1,
          address: ADDRESS,
          name: 'TestToken',
          sourceCode: 'pragma solidity ^0.8.0;',
          abi: '[]',
          verificationStatus: 'verified',
          verificationSource: 'sourcify',
        },
      }),
    );
    vi.mocked(useContractCreation).mockReturnValue(hookResult({ found: false }));
    vi.mocked(useStorageLayout).mockReturnValue(hookResult(undefined));

    renderView(() => Contract, '/chain/:chainId/contract/:address', contractPath);

    expect(
      await screen.findByRole('link', { name: /Etherscan/i }),
    ).toHaveAttribute('href', `https://etherscan.io/address/${ADDRESS}`);
    expect(screen.getByRole('link', { name: /Routescan/i })).toHaveAttribute(
      'href',
      `https://routescan.io/address/${ADDRESS}`,
    );
    expect(screen.getByRole('link', { name: /EVMole/i })).toHaveAttribute(
      'href',
      `https://evmole.xyz/#/${ADDRESS}/eth`,
    );
  });

  it('keeps the header links available while the source is still loading (header placement)', async () => {
    // Loading with no data: the old placement lived inside the loaded
    // contract-source card and rendered nothing here.
    vi.mocked(useContractSource).mockReturnValue(hookResult(undefined, undefined, true));
    vi.mocked(useContractCreation).mockReturnValue(hookResult(undefined, undefined, true));
    vi.mocked(useStorageLayout).mockReturnValue(hookResult(undefined));

    renderView(() => Contract, '/chain/:chainId/contract/:address', contractPath);

    expect(
      await screen.findByRole('link', { name: /Routescan/i }),
    ).toHaveAttribute('href', `https://routescan.io/address/${ADDRESS}`);
  });
});
