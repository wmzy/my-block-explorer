import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useControl } from 'react-use-control';
import RpcConfig from '@/components/RpcConfig';
import { ApiError } from '@/util/apiError';
import { clearAdminToken, getAdminToken, setAdminToken } from '@/util/adminAuth';

// The dialog's data flow is the contract here, not the transport: the
// service layer is stubbed so the 403/notice/refetch interplay and the
// localStorage-backed token wiring are directly observable.
const { mockGetRpcConfigs } = vi.hoisted(() => ({
  mockGetRpcConfigs: vi.fn(),
}));

vi.mock('@/utils/rpcConfigService', () => ({
  getRpcConfigs: mockGetRpcConfigs,
  saveRpcConfig: vi.fn(),
  deleteRpcConfig: vi.fn(),
  testRpcConnection: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/config/chains', () => ({
  getChainName: () => 'Ethereum',
}));

const CUSTOM_CONFIG = {
  id: '1',
  chainId: 1,
  name: 'My node',
  url: 'https://rpc.example',
  isCustom: true,
};

// RpcConfig takes a Control<boolean> for its open state; a tiny harness
// supplies one created from a plain `true` initial value (the one-prop
// ControlOrValue form), mirroring how views drive the modal.
function OpenRpcConfig() {
  const [, , control] = useControl<boolean>(true);
  return <RpcConfig open={control} chainId={1} />;
}

describe('RpcConfig admin gating', () => {
  beforeEach(() => {
    mockGetRpcConfigs.mockReset();
    clearAdminToken();
  });

  it('renders the token notice instead of an error when the config fetch 403s', async () => {
    mockGetRpcConfigs.mockRejectedValue(new ApiError('Forbidden', 403));

    render(<OpenRpcConfig />);

    expect(
      await screen.findByText(
        'Admin token required — set it below. Server must have ADMIN_TOKEN configured.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Admin token (stored in this browser)')).toBeInTheDocument();
  });

  it('always renders the token field even when configs load successfully', async () => {
    mockGetRpcConfigs.mockResolvedValue([CUSTOM_CONFIG]);

    render(<OpenRpcConfig />);

    expect(
      await screen.findByLabelText('Admin token (stored in this browser)'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Admin token required/)).not.toBeInTheDocument();
  });

  it('stores the entered token and refetches configs after save', async () => {
    mockGetRpcConfigs
      .mockRejectedValueOnce(new ApiError('Forbidden', 403))
      .mockResolvedValueOnce([CUSTOM_CONFIG]);

    render(<OpenRpcConfig />);

    await screen.findByText(/Admin token required/);

    fireEvent.change(screen.getByLabelText('Admin token (stored in this browser)'), {
      target: { value: 'secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getAdminToken()).toBe('secret-token');
    });

    // The refetch succeeded, so the notice gives way to the loaded config.
    await waitFor(() => {
      expect(screen.queryByText(/Admin token required/)).not.toBeInTheDocument();
    });
    expect(mockGetRpcConfigs).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('https://rpc.example')).toBeInTheDocument();
  });

  it('clears the stored token and reverts to the 403 notice', async () => {
    setAdminToken('secret-token');
    mockGetRpcConfigs
      .mockResolvedValueOnce([CUSTOM_CONFIG])
      .mockRejectedValueOnce(new ApiError('Forbidden', 403));

    render(<OpenRpcConfig />);

    expect(await screen.findByText('https://rpc.example')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(getAdminToken()).toBeNull();
    });
    expect(await screen.findByText(/Admin token required/)).toBeInTheDocument();
    expect(mockGetRpcConfigs).toHaveBeenCalledTimes(2);
  });
});
