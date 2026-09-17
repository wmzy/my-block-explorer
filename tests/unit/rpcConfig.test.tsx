import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useControl } from 'react-use-control';
import RpcConfig from '@/components/RpcConfig';
import { toast } from 'sonner';
import { ApiError } from '@/util/apiError';
import { clearAdminToken, getAdminToken, setAdminToken } from '@/util/adminAuth';

// The dialog's data flow is the contract here, not the transport: the
// service layer is stubbed so the 403/notice/refetch interplay and the
// localStorage-backed token wiring are directly observable.
const { mockGetRpcConfigs, mockSaveRpcConfig, mockDeleteRpcConfig, mockTestRpcConnection } =
  vi.hoisted(() => ({
    mockGetRpcConfigs: vi.fn(),
    mockSaveRpcConfig: vi.fn(),
    mockDeleteRpcConfig: vi.fn(),
    mockTestRpcConnection: vi.fn(),
  }));

vi.mock('@/utils/rpcConfigService', () => ({
  getRpcConfigs: mockGetRpcConfigs,
  saveRpcConfig: mockSaveRpcConfig,
  deleteRpcConfig: mockDeleteRpcConfig,
  testRpcConnection: mockTestRpcConnection,
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

// A passing RPC probe so handleSaveConfig reaches the save call.
const PASSING_TEST_RESULT = {
  status: 'success',
  latency: 12,
  detectedChainId: 1,
  supportsHistory: true,
  maxEventRange: 5000,
};

// RpcConfig takes a Control<boolean> for its open state; a tiny harness
// supplies one created from a plain `true` initial value (the one-prop
// ControlOrValue form), mirroring how views drive the modal.
function OpenRpcConfig() {
  const [, , control] = useControl<boolean>(true);
  return <RpcConfig open={control} chainId={1} />;
}

// Drives the custom-RPC form through 测试并保存.
async function submitCustomRpc() {
  fireEvent.click(screen.getByRole('button', { name: '添加自定义RPC' }));
  fireEvent.change(screen.getByLabelText('节点名称'), { target: { value: 'My node' } });
  fireEvent.change(screen.getByLabelText('RPC URL'), { target: { value: 'https://rpc.example' } });
  fireEvent.click(screen.getByRole('button', { name: '测试并保存' }));
}

describe('RpcConfig admin gating', () => {
  beforeEach(() => {
    mockGetRpcConfigs.mockReset().mockResolvedValue([]);
    mockSaveRpcConfig.mockReset().mockResolvedValue(undefined);
    mockDeleteRpcConfig.mockReset().mockResolvedValue(undefined);
    mockTestRpcConnection.mockReset().mockResolvedValue(PASSING_TEST_RESULT);
    clearAdminToken();
  });

  it('shows the current config without an admin token (reads are open)', async () => {
    mockGetRpcConfigs.mockResolvedValue([CUSTOM_CONFIG]);

    render(<OpenRpcConfig />);

    expect(await screen.findByText('https://rpc.example')).toBeInTheDocument();
    expect(screen.getByLabelText('Admin token (stored in this browser)')).toBeInTheDocument();
    expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
  });

  it('falls back to the default-node state without a notice when the config fetch fails', async () => {
    mockGetRpcConfigs.mockRejectedValue(new Error('network down'));

    render(<OpenRpcConfig />);

    expect(await screen.findByText(/使用默认RPC节点/)).toBeInTheDocument();
    // Reads are open server-side, so a load failure is not the admin gate
    // and must not show the save-scoped token notice.
    expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
  });

  it('shows the save-scoped notice and server message when saving 403s, then clears it after a token save and retry', async () => {
    mockSaveRpcConfig
      .mockRejectedValueOnce(new ApiError('Invalid admin token.', 403))
      .mockResolvedValueOnce(undefined);

    render(<OpenRpcConfig />);
    await screen.findByText(/使用默认RPC节点/);

    await submitCustomRpc();

    // 403 on save: notice points at the token field (not at the config
    // list), and the server's message surfaces verbatim.
    expect(await screen.findByText(/Saving requires an admin token/)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Invalid admin token.');

    // Entering a token drops the stale notice...
    fireEvent.change(screen.getByLabelText('Admin token (stored in this browser)'), {
      target: { value: 'secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getAdminToken()).toBe('secret-token');
    });
    await waitFor(() => {
      expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
    });

    // ...and the retried save now succeeds.
    fireEvent.click(screen.getByRole('button', { name: '测试并保存' }));
    await waitFor(() => {
      expect(mockSaveRpcConfig).toHaveBeenCalledTimes(2);
    });
    expect(toast.success).toHaveBeenCalledWith('RPC configuration saved successfully!');
    expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
  });

  it('shows the notice when deleting the config 403s', async () => {
    mockGetRpcConfigs.mockResolvedValue([CUSTOM_CONFIG]);
    mockDeleteRpcConfig.mockRejectedValue(new ApiError('Invalid admin token.', 403));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<OpenRpcConfig />);
    await screen.findByText('https://rpc.example');

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));

    expect(await screen.findByText(/Saving requires an admin token/)).toBeInTheDocument();
  });

  it('stores the entered token and refetches configs after save', async () => {
    mockGetRpcConfigs.mockResolvedValueOnce([]).mockResolvedValueOnce([CUSTOM_CONFIG]);

    render(<OpenRpcConfig />);
    await screen.findByText(/使用默认RPC节点/);

    fireEvent.change(screen.getByLabelText('Admin token (stored in this browser)'), {
      target: { value: 'secret-token' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(getAdminToken()).toBe('secret-token');
    });

    // The refetch picked up the config list.
    await waitFor(() => {
      expect(mockGetRpcConfigs).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText('https://rpc.example')).toBeInTheDocument();
  });

  it('clears the stored token and refetches the config list', async () => {
    setAdminToken('secret-token');
    mockGetRpcConfigs.mockResolvedValue([CUSTOM_CONFIG]);

    render(<OpenRpcConfig />);
    expect(await screen.findByText('https://rpc.example')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    await waitFor(() => {
      expect(getAdminToken()).toBeNull();
    });
    await waitFor(() => {
      expect(mockGetRpcConfigs).toHaveBeenCalledTimes(2);
    });
    // No gate on reads, so no notice appears.
    expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
  });
});
