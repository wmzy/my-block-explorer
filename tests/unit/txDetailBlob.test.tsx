// EIP-4844 blob sidecar visibility on the tx detail page: the versioned-
// hash count + list and the single Blobscan external link render for type-3
// transactions only, with an honest "not returned by this RPC" value when
// the RPC omitted the field. Harness mirrors transactionDetailPage.test.tsx
// (minimal native-router setup, services and network-adjacent children
// mocked) so these tests pin only the blob rows' render contract.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom';

import TransactionDetail from '@/views/Transactions/Detail';
import { VALUE_UNIT_STORAGE_KEY, setValueUnit } from '@/util/units';
import { useContractSource } from '@/services/contracts';
import { useTransactionByHash } from '@/services/chainRpc';

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
}));

// The signature-enrichment lookup is optional chrome over the raw hex —
// mocked to "nothing resolved" so these tests pin the blob rows only.
vi.mock('@/services/signatures', () => ({
  useSignatures: vi.fn(() => ({})),
}));

vi.mock('@/services/chainRpc', () => ({
  useTransactionByHash: vi.fn(),
}));

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: ({ currentChainId }: { currentChainId: number }) => (
    <div data-testid="top-navigation">chain: {currentChainId}</div>
  ),
}));

vi.mock('@/components/ui/CopyableHash', () => ({
  CopyableHash: ({
    value,
    truncated,
    href,
  }: {
    value: string;
    truncated?: string;
    href?: string;
  }) => (href ? <a href={href}>{truncated ?? value}</a> : <span>{truncated ?? value}</span>),
}));

vi.mock('@/config/chains', () => ({
  getChainInfo: (chainId: number) => {
    if (chainId === 1) return { id: 1, name: 'Ethereum', nativeCurrency: { symbol: 'ETH' } };
    return null;
  },
  getChainName: (chainId: number) =>
    chainId === 1 ? 'Ethereum' : chainId === 137 ? 'Polygon' : `Chain ${chainId}`,
  getChainSymbol: () => 'ETH',
  // Consumed by the Landing helpers behind UnsupportedChainState.
  isChainSupported: (chainId: number) => chainId === 1,
  getSortedChains: () => [{ id: 1, name: 'Ethereum' }],
  // Quick re-check links in the not-found card (current chain filtered out).
  POPULAR_CHAINS: [
    { id: 1, name: 'Ethereum' },
    { id: 137, name: 'Polygon' },
  ],
}));

const SENDER = '0x1111111111111111111111111111111111111111';
const TOKEN = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const TX_HASH = '0xtxhash0000000000000000000000000000000000000000000000000000000000';

// Versioned blob hashes carry the 0x01 version prefix (Cancun v1 KZG).
const BLOB_HASH_1 = `0x01${'aa'.repeat(31)}`;
const BLOB_HASH_2 = `0x01${'bb'.repeat(31)}`;

// Logs arrive as plain untyped objects on the RPC transaction fixture.
const makeTx = (overrides: Record<string, unknown> = {}) =>
  ({
    hash: TX_HASH,
    blockNumber: '18000001',
    transactionIndex: 5,
    fromAddress: SENDER,
    toAddress: TOKEN,
    value: '0',
    gasLimit: '50000',
    gasUsed: '30000',
    gasPrice: '20000000000',
    nonce: 42,
    type: 2,
    status: 1,
    inputData: '0x',
    logs: [],
    ...overrides,
  }) as never;

const hookResult = (data: unknown, error?: unknown) =>
  ({ data, loading: false, error, refetch: vi.fn() }) as unknown as never;

// The back button's fallback destination.
const TxListStub = () => <div data-testid="tx-list" />;

function renderDetail(path = `/chain/1/tx/${TX_HASH}`) {
  const routes = createRoutes([
    { path: '/chain/:chainId/tx/:txHash', component: () => TransactionDetail },
    { path: '/chain/:chainId/transactions', component: () => TxListStub },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Unit-toggle state spans storage and in-memory subscribers: reset both
  // so every test starts from the native default.
  localStorage.removeItem(VALUE_UNIT_STORAGE_KEY);
  setValueUnit('native');
  vi.mocked(useTransactionByHash).mockReturnValue(hookResult(makeTx()));
  // Unverified contract: no ABI enrichment, no backend round-trip.
  vi.mocked(useContractSource).mockReturnValue(hookResult(undefined));
});

describe('TransactionDetail blob sidecar rows', () => {
  it('renders count, both versioned hashes and the Blobscan link for a type-3 transaction', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(
        makeTx({
          type: 3,
          maxFeePerBlobGas: '50000000000',
          blobVersionedHashes: [BLOB_HASH_1, BLOB_HASH_2],
        }),
      ),
    );

    renderDetail();

    // Page settled on the blob-typed fixture before asserting the rows.
    expect(await screen.findByText('EIP-4844 (Blob)')).toBeInTheDocument();

    // The single external affordance: exact per-tx Blobscan URL, new tab,
    // hardened rel.
    const link = screen.getByRole('link', { name: /^View blobs on Blobscan/ });
    expect(link).toHaveAttribute('href', `https://blobscan.com/tx/${TX_HASH}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // Count line plus both hashes, visible in the value cell.
    expect(screen.getByText('2 blobs')).toBeInTheDocument();
    expect(screen.getByText(BLOB_HASH_1)).toBeInTheDocument();
    expect(screen.getByText(BLOB_HASH_2)).toBeInTheDocument();

    // Honesty note names the destination as external and the RPC limit.
    expect(screen.getByText(/External site, not part of this explorer/)).toBeInTheDocument();

    // The neighboring fee row is untouched by the change.
    expect(screen.getByText('Max Fee Per Blob Gas')).toBeInTheDocument();
  });

  it('renders no blob rows for a type-2 transaction, even one carrying blob fields', async () => {
    // Type stays 2 while the blob fields ride along: pins the type-3 render
    // gate against quirky RPCs that attach blob fields to non-blob txs.
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ blobVersionedHashes: [BLOB_HASH_1, BLOB_HASH_2] })),
    );

    renderDetail();

    expect(await screen.findByText('EIP-1559')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^View blobs on Blobscan/ })).not.toBeInTheDocument();
    expect(screen.queryByText('Blob Versioned Hashes')).not.toBeInTheDocument();
    expect(screen.queryByText('Blob Payloads')).not.toBeInTheDocument();
    expect(screen.queryByText(BLOB_HASH_1)).not.toBeInTheDocument();
    expect(screen.queryByText(BLOB_HASH_2)).not.toBeInTheDocument();
  });

  it('keeps the Blobscan link and states the omission when a type-3 RPC omits the hashes', async () => {
    vi.mocked(useTransactionByHash).mockReturnValue(
      hookResult(makeTx({ type: 3, maxFeePerBlobGas: '50000000000' })),
    );

    renderDetail();

    const link = await screen.findByRole('link', { name: /^View blobs on Blobscan/ });
    expect(link).toHaveAttribute('href', `https://blobscan.com/tx/${TX_HASH}`);

    // The hashes row stays with an honest omission value, not a count.
    expect(screen.getByText('Not returned by this RPC')).toBeInTheDocument();
    expect(screen.queryByText(/^[0-9]+ blobs?$/)).not.toBeInTheDocument();
  });
});
