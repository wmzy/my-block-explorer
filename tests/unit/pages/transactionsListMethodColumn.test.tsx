// Transactions list Method column: pure selector extraction and display
// mapping (empty input → honest em-dash, contract creation, truncated
// selector fallback, resolved name + openchain provenance), the column's
// rendering in the view (signature service mocked — the fetch/batching
// behavior lives in signaturesFrontend.test), and the mobile degradation
// rules pinned at the source level (linaria is zero-runtime in jsdom).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import '@testing-library/jest-dom';

import TransactionsList from '@/views/Transactions/List';
import { methodDisplay, pageMethodSelectors } from '@/views/Transactions/methodColumn';
import type { SignatureOutcome } from '@/services/signatures';

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('@/components/ui/CopyableHash', () => ({
  CopyableHash: ({ value }: { value: string }) => <span>{value}</span>,
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) =>
    chainId === 1 ? { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } } : null,
  getChainName: () => 'Ethereum',
  getChainSymbol: () => 'ETH',
  isChainSupported: (chainId: number) => chainId === 1,
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
}));

vi.mock('@/utils/format', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/format')>();
  return { ...actual, formatRelativeTime: () => '5 min ago' };
});

const mockUseLatestTransactions = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/services/chainRpc', () => ({
  useLatestTransactions: (...args: unknown[]) => mockUseLatestTransactions(...args),
}));

vi.mock('@/services/homeFeed', () => ({
  useLatestBlocksFeed: () => ({ data: undefined }),
}));

const mockUseSignaturesBatched = vi.fn<(...args: unknown[]) => unknown>();

vi.mock('@/services/signatures', () => ({
  useSignaturesBatched: (...args: unknown[]) => mockUseSignaturesBatched(...args),
}));

// From/To cells resolve ENS inline; stubbed to the unresolved state so no
// test here touches the query layer or the network.
vi.mock('@/services/ens', () => ({
  useEnsName: () => ({ data: null, loading: false }),
}));

// The minimal row shape the Method column consumes (the RPC transaction
// stub the list renders).
type TxStub = {
  hash: string;
  blockNumber: string;
  fromAddress: string;
  toAddress: string;
  value: string;
  status: number;
  timestamp?: string;
  inputData?: string;
};

const makeTx = (overrides: Partial<TxStub> = {}): TxStub => ({
  hash: `0xtx${Math.random().toString(16).slice(2).padEnd(10, '0')}`,
  blockNumber: '18000001',
  fromAddress: '0x1234567890abcdef1234567890abcdef12345678',
  toAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
  value: '1000000000000000000',
  status: 1,
  timestamp: '2024-01-01T00:00:00Z',
  ...overrides,
});

const found = (signatures: string[]): SignatureOutcome =>
  ({ kind: 'function', signatures, source: 'openchain' }) as const;

const CALL_INPUT = `0xa9059cbb${'00'.repeat(16)}`;
const OTHER_INPUT = `0x23b872dd${'11'.repeat(16)}`;

const renderTransactionsList = () =>
  render(
    <MemoryRouter
      routes={createRoutes([
        { path: '/chain/:chainId/transactions', component: () => TransactionsList },
      ])}
      initialEntries={['/chain/1/transactions']}
    >
      <View />
    </MemoryRouter>,
  );

const serveTransactions = (transactions: TxStub[]) =>
  mockUseLatestTransactions.mockReturnValue({
    data: { transactions, latestBlockNumber: 18000001n },
    loading: false,
    error: undefined,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockUseSignaturesBatched.mockReturnValue({});
});

describe('pageMethodSelectors - what a page resolves', () => {
  it('collects the distinct selectors of calldata-carrying transactions', () => {
    const selectors = pageMethodSelectors([
      makeTx({ inputData: CALL_INPUT }),
      makeTx({ inputData: CALL_INPUT }), // duplicate selector collapses
      makeTx({ inputData: OTHER_INPUT }),
    ]);

    expect(selectors).toEqual(['0xa9059cbb', '0x23b872dd']);
  });

  it('plain transfers contribute nothing: undefined, empty and 0x input', () => {
    expect(
      pageMethodSelectors([makeTx(), makeTx({ inputData: '' }), makeTx({ inputData: '0x' })]),
    ).toEqual([]);
  });

  it('contract creations contribute nothing (init code is not a selector)', () => {
    expect(
      pageMethodSelectors([
        makeTx({ toAddress: '', inputData: CALL_INPUT }),
        makeTx({ inputData: CALL_INPUT }),
      ]),
    ).toEqual(['0xa9059cbb']);
  });

  it('calldata without a valid 4-byte hex selector is skipped', () => {
    expect(
      pageMethodSelectors([makeTx({ inputData: '0x1234' }), makeTx({ inputData: '0xzz059cbbdeadbeef' })]),
    ).toEqual([]);
  });
});

describe('methodDisplay - honest per-row mapping', () => {
  const TO = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';

  it('a plain value transfer (empty input) is an em-dash case, never a fabricated name', () => {
    expect(methodDisplay(undefined, TO, undefined)).toEqual({ kind: 'transfer' });
    expect(methodDisplay('0x', TO, found(['transfer(address,uint256)']))).toEqual({
      kind: 'transfer',
    });
  });

  it('a contract creation shows as creation even with calldata and an outcome', () => {
    expect(methodDisplay(CALL_INPUT, '', found(['deploy(uint256)']))).toEqual({
      kind: 'creation',
    });
  });

  it('input without a valid selector is unparsed', () => {
    expect(methodDisplay('0x1234', TO, undefined)).toEqual({ kind: 'unparsed' });
    expect(methodDisplay('0xzz059cbbdeadbeef', TO, undefined)).toEqual({ kind: 'unparsed' });
  });

  it('pending, notFound and unavailable outcomes all keep the raw selector', () => {
    const notFound: SignatureOutcome = { kind: 'function', signatures: [], notFound: true };
    expect(methodDisplay(CALL_INPUT, TO, undefined)).toEqual({
      kind: 'selector',
      selector: '0xa9059cbb',
    });
    expect(methodDisplay(CALL_INPUT, TO, notFound)).toEqual({
      kind: 'selector',
      selector: '0xa9059cbb',
    });
    expect(methodDisplay(CALL_INPUT, TO, { unavailable: true })).toEqual({
      kind: 'selector',
      selector: '0xa9059cbb',
    });
  });

  it('a resolved candidate maps to the base name plus the full signature', () => {
    expect(methodDisplay(CALL_INPUT, TO, found(['transfer(address,uint256)']))).toEqual({
      kind: 'resolved',
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      moreCount: 0,
    });
  });

  it('multiple candidates keep openchain order: first names the cell, rest counted', () => {
    expect(
      methodDisplay(CALL_INPUT, TO, found(['transfer(address,uint256)', 'foo(address)'])),
    ).toEqual({
      kind: 'resolved',
      name: 'transfer',
      signature: 'transfer(address,uint256)',
      moreCount: 1,
    });
  });

  it('a candidate without parentheses renders verbatim as the name', () => {
    expect(methodDisplay(CALL_INPUT, TO, found(['fallback']))).toEqual({
      kind: 'resolved',
      name: 'fallback',
      signature: 'fallback',
      moreCount: 0,
    });
  });
});

describe('TransactionsList Method column rendering', () => {
  it('renders the Method column header', async () => {
    serveTransactions([makeTx()]);
    renderTransactionsList();

    expect(await screen.findByRole('columnheader', { name: 'Method' })).toBeInTheDocument();
  });

  it('resolves the page once per render with its distinct selectors — never per row', async () => {
    serveTransactions([
      makeTx({ inputData: CALL_INPUT }),
      makeTx({ inputData: CALL_INPUT }),
      makeTx({ inputData: OTHER_INPUT }),
    ]);
    renderTransactionsList();

    expect(await screen.findByRole('columnheader', { name: 'Method' })).toBeInTheDocument();
    // Every rendering pass asks for exactly the page's selector array:
    // one batched lookup for the whole table, not one per row.
    expect(mockUseSignaturesBatched.mock.calls.length).toBeGreaterThan(0);
    for (const call of mockUseSignaturesBatched.mock.calls) {
      expect(call[0]).toEqual(['0xa9059cbb', '0x23b872dd']);
    }
  });

  it('renders the resolved name with the openchain chip, the em-dash transfer and the unresolved selector', async () => {
    serveTransactions([
      makeTx(), // plain transfer
      makeTx({ inputData: CALL_INPUT }), // resolved with two candidates
      makeTx({ inputData: OTHER_INPUT }), // unresolved
    ]);
    mockUseSignaturesBatched.mockReturnValue({
      '0xa9059cbb': found(['transfer(address,uint256)', 'foo(address)']),
    });
    renderTransactionsList();

    // Plain transfer row: em-dash, explanation in the title.
    const transferCell = await screen.findByTitle('No input data');
    expect(transferCell).toHaveTextContent('—');
    // Resolved row: base name, muted extra candidates, provenance chip,
    // full signature in the title.
    const resolvedCell = screen.getByTitle('transfer(address,uint256)');
    expect(resolvedCell).toHaveTextContent('transfer');
    expect(resolvedCell).toHaveTextContent('(+1 more)');
    expect(screen.getByText('openchain')).toBeInTheDocument();
    // Unresolved row: truncated selector, full value in the title.
    const unresolvedCell = screen.getByTitle('0x23b872dd');
    expect(unresolvedCell).toHaveTextContent('0x23b872…');
  });

  it('renders Contract Creation for a deployment transaction', async () => {
    serveTransactions([makeTx({ toAddress: '', inputData: CALL_INPUT })]);
    renderTransactionsList();

    expect(
      await screen.findByTitle('Contract creation — input is deployment code, not a method call'),
    ).toHaveTextContent('Contract Creation');
  });
});

describe('mobile degradation rules exist at the source level', () => {
  const src = (relPath: string): string =>
    readFileSync(resolve(__dirname, '../../..', relPath), 'utf8');

  it('the Method column drops out at the 768px breakpoint', () => {
    const styles = src('src/views/Transactions/methodColumn.tsx');
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('display: none');
  });

  it('the toolbar stacks under the title at the 768px breakpoint', () => {
    const styles = src('src/views/Transactions/List.tsx');
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('flex-direction: column');
  });
});
