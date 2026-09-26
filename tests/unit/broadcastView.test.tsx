// Broadcast view contract: the local decode drives every state — a
// cross-chain signature blocks broadcasting with a red warning naming
// both chains (button disabled, title explains), a matching signature
// enables it and a successful sendRawTransaction navigates to the new
// tx page on the viewed chain, undecodable input renders an inline error
// with the button disabled, a pre-EIP-155 legacy transaction stays
// broadcastable under an amber replayability note, an unsigned payload
// shows the unrecoverable-sender note, and an RPC rejection shows the
// node's verbatim message with a reset that never clears the pasted
// bytes. Fixtures are REAL viem-signed transactions (a throwaway
// Hardhat dev key that holds no funds on any network), so the REAL
// decoder — including async sender recovery — is under test, not a stub.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';

import BroadcastPage from '@/views/Broadcast';

const { mockCreateRpcClient, mockSendRawTransaction, mockNavigate } = vi.hoisted(() => ({
  mockCreateRpcClient: vi.fn(),
  mockSendRawTransaction: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

// RPC layer: the client factory is stubbed (the view must obtain its
// client exactly the way sibling RPC views do — via createRpcClient),
// and only sendRawTransaction is replaced in viem/actions; the rest of
// the action surface stays real for anything else in the graph.
vi.mock('@/utils/realTimeData', async importOriginal => {
  const actual = await importOriginal<typeof import('@/utils/realTimeData')>();
  return { ...actual, createRpcClient: mockCreateRpcClient };
});

vi.mock('viem/actions', async importOriginal => {
  const actual = await importOriginal<typeof import('viem/actions')>();
  return { ...actual, sendRawTransaction: mockSendRawTransaction };
});

// The view navigates through the core free function; replacing only it
// keeps the MemoryRouter harness fully real, and the mock must resolve
// because the view chains .catch() onto the returned promise.
vi.mock('@native-router/core', async importOriginal => {
  const actual = await importOriginal<typeof import('@native-router/core')>();
  return { ...actual, navigate: mockNavigate };
});

// Fixtures signed once with Hardhat account #0 (well-known dev key, no
// funds anywhere): mainnet and polygon EIP-1559 transfers, a pre-EIP-
// 155 legacy transfer (chainId null), and an UNSIGNED polygon payload
// (no signature → from null).
const SENDER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const RAW_EIP1559_MAINNET =
  '0x02f873010584773594008506fc23ac00825208941111111111111111111111111111111111111111880de0b6b3a764000080c080a069f768e8bb6ce1be27019da51aec7f0ba6c5cabc7a4b2065b0b6ffc0cb259d00a052a3119abca068a0424498b8a22cc0e15d0b7b2d90edee24d47a92410d15b6b9';
const RAW_EIP1559_POLYGON =
  '0x02f8758189078506fc23ac00850ba43b7400825208941111111111111111111111111111111111111111881bc16d674ec8000080c080a09a2cbe91e9b5240b2826501f2c2b7fec5fff67088bb51e24afa466b3950d207ea041f535de1ff1441fc3c81f4bb80f298f9baa05fa15122e31b140f6a0c296aefb';
const RAW_LEGACY_PRE155 =
  '0xf86c0385174876e8008252089411111111111111111111111111111111111111118806f05b59d3b20000801ba025125f2122f87070ef1729f839ade36f6cbcf880168f5fb45e904b03958a1647a0321e1f89d60ae398a539ce4c3e047b08398fd62f4324868178349afa142e1c04';
const RAW_UNSIGNED_POLYGON =
  '0x02f1818909843b9aca008509502f900082520894111111111111111111111111111111111111111188016345785d8a000080c0';
const TX_HASH = '0xabc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abcd';

const routes = createRoutes([
  { path: '/chain/:chainId/broadcast', component: () => BroadcastPage },
]);

// The router resolves the route component asynchronously, so every test
// must first settle on the page header before interacting with the view.
// The heading role keeps the settle query distinct from the identically
// named Broadcast Transaction button below it.
const renderBroadcast = async (chainId: number) => {
  render(
    <MemoryRouter routes={routes} initialEntries={[`/chain/${chainId}/broadcast`]}>
      <View />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('heading', { name: 'Broadcast Transaction' })).toBeInTheDocument();
};

// The decode is debounced (300ms) and async (sender recovery), so every
// paste must be awaited through its observable consequence, never
// assumed synchronous.
const pasteRaw = (raw: string) => {
  fireEvent.change(screen.getByLabelText('Raw signed transaction'), {
    target: { value: raw },
  });
};

const broadcastButton = () => screen.getByRole('button', { name: 'Broadcast Transaction' });

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateRpcClient.mockResolvedValue({ chainId: 137 });
  mockSendRawTransaction.mockResolvedValue(TX_HASH);
  mockNavigate.mockResolvedValue(undefined);
});

describe('broadcast view honest states', () => {
  it('blocks a transaction signed for another chain: red warning names both chains, button disabled', async () => {
    await renderBroadcast(137);
    pasteRaw(RAW_EIP1559_MAINNET);

    const warning = await screen.findByText(/signed for Ethereum/i);
    expect(warning).toHaveTextContent('Polygon');
    expect(warning).toHaveTextContent('chain ID 1');
    expect(warning).toHaveTextContent('chain ID 137');

    const button = broadcastButton();
    expect(button).toBeDisabled();
    // The disabled control explains itself.
    expect(button).toHaveAttribute('title', expect.stringContaining('Ethereum'));
    expect(mockSendRawTransaction).not.toHaveBeenCalled();
  });

  it('broadcasts a matching transaction and navigates to the new tx page', async () => {
    await renderBroadcast(137);
    pasteRaw(RAW_EIP1559_POLYGON);

    await waitFor(() => expect(broadcastButton()).toBeEnabled());

    fireEvent.click(broadcastButton());

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith(expect.anything(), `/chain/137/tx/${TX_HASH}`),
    );
    // The client comes from the shared chain-aware factory, and the exact
    // pasted bytes are what goes on the wire.
    expect(mockCreateRpcClient).toHaveBeenCalledWith(137);
    expect(mockSendRawTransaction).toHaveBeenCalledWith(expect.anything(), {
      serializedTransaction: RAW_EIP1559_POLYGON,
    });
  });

  it('shows an inline error and keeps broadcasting disabled for undecodable input', async () => {
    await renderBroadcast(137);
    pasteRaw('0xdeadbeef');

    await screen.findByText(/Could not decode the pasted input/i);
    expect(broadcastButton()).toBeDisabled();
    expect(mockSendRawTransaction).not.toHaveBeenCalled();
  });

  it('keeps a pre-EIP-155 legacy transaction broadcastable under an amber note', async () => {
    await renderBroadcast(137);
    pasteRaw(RAW_LEGACY_PRE155);

    await screen.findByText(/Legacy pre-EIP-155 transaction/i);
    // No chain id on the tx → nothing to mismatch against, no red warning.
    expect(screen.queryByText(/signed for/i)).not.toBeInTheDocument();
    await waitFor(() => expect(broadcastButton()).toBeEnabled());
  });

  it('flags an unsigned payload with the unrecoverable-sender note', async () => {
    await renderBroadcast(137);
    pasteRaw(RAW_UNSIGNED_POLYGON);

    await screen.findByText(/Sender could not be recovered/i);
    expect(screen.getByText('Not recoverable')).toBeInTheDocument();
    // Still structurally valid for the viewed chain — broadcasting stays
    // a user decision, not an explorer veto.
    await waitFor(() => expect(broadcastButton()).toBeEnabled());
  });

  it('shows an RPC rejection verbatim and resets the failure without clearing the bytes', async () => {
    mockSendRawTransaction.mockRejectedValue(new Error('nonce too low'));
    await renderBroadcast(137);
    pasteRaw(RAW_EIP1559_POLYGON);

    await waitFor(() => expect(broadcastButton()).toBeEnabled());
    fireEvent.click(broadcastButton());

    // The node's own words survive verbatim, under the classification
    // prefix for this common rejection family.
    const verbatim = await screen.findByText(/Rejected by the RPC node: nonce too low/);
    expect(verbatim.tagName).toBe('CODE');

    // The recovery button clears only the failure state — the pasted
    // bytes are the only copy of the transaction and must survive.
    fireEvent.click(screen.getByRole('button', { name: 'Clear failure' }));
    await waitFor(() =>
      expect(screen.queryByText(/Rejected by the RPC node/)).not.toBeInTheDocument(),
    );
    const textarea = screen.getByLabelText<HTMLTextAreaElement>('Raw signed transaction');
    expect(textarea.value).toBe(RAW_EIP1559_POLYGON);
    expect(screen.getByText(SENDER)).toBeInTheDocument();
  });
});
