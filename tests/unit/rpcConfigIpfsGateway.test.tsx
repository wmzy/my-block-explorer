// Focused jsdom tests for the IPFS gateway field in the RPC settings
// modal: the field edits the browser-local 'be:ipfsGateway' preference
// the NFT metadata service consumes. Pins the same input pattern as the
// admin-token field (label + input + save), normalization on save
// (trailing slashes trimmed, https:// defaulted), reset-to-default, and
// the disabled states that keep Save honest (nothing to persist).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useControl } from 'react-use-control';
import { MemoryRouter, createRoutes } from '@native-router/react';
import RpcConfig from '@/components/RpcConfig';
import { toast } from 'sonner';
import {
  DEFAULT_IPFS_GATEWAY,
  IPFS_GATEWAY_STORAGE_KEY,
  getIpfsGateway,
  setIpfsGateway,
} from '@/services/nftMetadata';

// Same contract-level stubs as rpcConfig.test.tsx: the dialog's data flow
// is under test, not the transport.
const { mockGetRpcConfigs, mockHttpGet } = vi.hoisted(() => ({
  mockGetRpcConfigs: vi.fn(),
  mockHttpGet: vi.fn(),
}));

vi.mock('@/utils/rpcConfigService', () => ({
  getRpcConfigs: mockGetRpcConfigs,
  saveRpcConfig: vi.fn(),
  deleteRpcConfig: vi.fn(),
  testRpcConnection: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: mockHttpGet,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/config/chains', () => ({
  getChainName: () => 'Ethereum',
}));

// RpcConfig takes a Control<boolean> for its open state. Wrapped in a
// MemoryRouter with the coverage route registered because the modal's
// footer now carries a TypedLink to /about/coverage (needs router context).
const BlankPage = () => null;
function OpenRpcConfig() {
  const [, , control] = useControl<boolean>(true);
  return (
    <MemoryRouter
      routes={createRoutes([{ path: '/about/coverage', component: () => BlankPage }])}
      initialEntries={['/about/coverage']}
    >
      <RpcConfig open={control} chainId={1} />
    </MemoryRouter>
  );
}

const LABEL = 'IPFS gateway (stored in this browser)';

describe('RpcConfig IPFS gateway field', () => {
  beforeEach(() => {
    mockGetRpcConfigs.mockReset().mockResolvedValue([]);
    mockHttpGet.mockReset().mockResolvedValue(undefined);
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    localStorage.clear();
  });

  it('shows the field with the default gateway when nothing is stored', async () => {
    render(<OpenRpcConfig />);

    const input = await screen.findByLabelText(LABEL);
    expect(input).toHaveValue(DEFAULT_IPFS_GATEWAY);
    // Nothing stored → reset has nothing to undo.
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
    // Value equals the stored default → nothing to save.
    expect(screen.getByRole('button', { name: 'Save gateway' })).toBeDisabled();
  });

  it('normalizes on save: trims trailing slashes and defaults the scheme', async () => {
    render(<OpenRpcConfig />);

    fireEvent.change(await screen.findByLabelText(LABEL), {
      target: { value: ' gw.example.com/// ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save gateway' }));

    expect(localStorage.getItem(IPFS_GATEWAY_STORAGE_KEY)).toBe('https://gw.example.com');
    expect(getIpfsGateway()).toBe('https://gw.example.com');
    expect(toast.success).toHaveBeenCalledWith('IPFS gateway saved.');
    // The input reflects the normalized value and Save goes quiet again.
    expect(screen.getByLabelText(LABEL)).toHaveValue('https://gw.example.com');
    expect(screen.getByRole('button', { name: 'Save gateway' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
  });

  it('keeps Save disabled for an empty value', async () => {
    render(<OpenRpcConfig />);

    fireEvent.change(await screen.findByLabelText(LABEL), { target: { value: '   ' } });

    expect(screen.getByRole('button', { name: 'Save gateway' })).toBeDisabled();
    expect(getIpfsGateway()).toBe(DEFAULT_IPFS_GATEWAY);
  });

  it('seeds the field from a stored custom gateway', async () => {
    setIpfsGateway('https://pin.mydomain.dev');

    render(<OpenRpcConfig />);

    expect(await screen.findByLabelText(LABEL)).toHaveValue('https://pin.mydomain.dev');
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeEnabled();
  });

  it('reset removes the stored preference and returns to the default', async () => {
    setIpfsGateway('https://pin.mydomain.dev');

    render(<OpenRpcConfig />);
    fireEvent.click(await screen.findByRole('button', { name: 'Reset to default' }));

    expect(localStorage.getItem(IPFS_GATEWAY_STORAGE_KEY)).toBeNull();
    expect(getIpfsGateway()).toBe(DEFAULT_IPFS_GATEWAY);
    expect(screen.getByLabelText(LABEL)).toHaveValue(DEFAULT_IPFS_GATEWAY);
    expect(toast.success).toHaveBeenCalledWith(
      `IPFS gateway reset to ${DEFAULT_IPFS_GATEWAY}.`,
    );
    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeDisabled();
  });
});
