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
// service layer and the http helper are stubbed so the 403/notice/refetch
// interplay, the token verification outcomes, and the localStorage-backed
// token wiring are directly observable.
const { mockGetRpcConfigs, mockSaveRpcConfig, mockDeleteRpcConfig, mockTestRpcConnection, mockHttpGet } =
  vi.hoisted(() => ({
    mockGetRpcConfigs: vi.fn(),
    mockSaveRpcConfig: vi.fn(),
    mockDeleteRpcConfig: vi.fn(),
    mockTestRpcConnection: vi.fn(),
    mockHttpGet: vi.fn(),
  }));

vi.mock('@/utils/rpcConfigService', () => ({
  getRpcConfigs: mockGetRpcConfigs,
  saveRpcConfig: mockSaveRpcConfig,
  deleteRpcConfig: mockDeleteRpcConfig,
  testRpcConnection: mockTestRpcConnection,
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

// The transport's degraded-mode fast reject (see util/http's
// backendUnconnected): status 0 with the diagnosis as the message.
const BACKEND_UNCONNECTED = new ApiError(
  'Backend not connected — indexed data unavailable',
  0,
);

// RpcConfig takes a Control<boolean> for its open state; a tiny harness
// supplies one created from a plain `true` initial value (the one-prop
// ControlOrValue form), mirroring how views drive the modal.
function OpenRpcConfig() {
  const [, , control] = useControl<boolean>(true);
  return <RpcConfig open={control} chainId={1} />;
}

// Drives the custom-RPC form through Test & save.
async function submitCustomRpc() {
  fireEvent.click(screen.getByRole('button', { name: 'Add custom RPC' }));
  fireEvent.change(screen.getByLabelText('Node name'), { target: { value: 'My node' } });
  fireEvent.change(screen.getByLabelText('RPC URL'), { target: { value: 'https://rpc.example' } });
  fireEvent.click(screen.getByRole('button', { name: 'Test & save' }));
}

// Enters an admin token and clicks Save (which triggers server verification).
async function saveAdminToken(token: string) {
  fireEvent.change(screen.getByLabelText('Admin token (stored in this browser)'), {
    target: { value: token },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
}

describe('RpcConfig admin gating', () => {
  beforeEach(() => {
    mockGetRpcConfigs.mockReset().mockResolvedValue([]);
    mockSaveRpcConfig.mockReset().mockResolvedValue(undefined);
    mockDeleteRpcConfig.mockReset().mockResolvedValue(undefined);
    mockTestRpcConnection.mockReset().mockResolvedValue(PASSING_TEST_RESULT);
    mockHttpGet.mockReset().mockResolvedValue(undefined);
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

    expect(await screen.findByText(/Using the default RPC node/)).toBeInTheDocument();
    // Reads are open server-side, so a load failure is not the admin gate
    // and must not show the save-scoped token notice.
    expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
  });

  it('warns that saved configs affect every user of the backend, with the form open or closed', async () => {
    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    const hint = 'Saved RPC configs apply to this backend for ALL users, not just this browser.';
    expect(screen.getByText(hint)).toBeInTheDocument();

    // The hint stays next to the custom-endpoint form once it opens.
    fireEvent.click(screen.getByRole('button', { name: 'Add custom RPC' }));
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('shows the save-scoped notice and server message when saving 403s, then clears it after a token save and retry', async () => {
    mockSaveRpcConfig
      .mockRejectedValueOnce(new ApiError('Invalid admin token.', 403))
      .mockResolvedValueOnce(undefined);

    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    await submitCustomRpc();

    // 403 on save: notice points at the token field (not at the config
    // list), and the server's message surfaces verbatim.
    expect(await screen.findByText(/Saving requires an admin token/)).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('Invalid admin token.');

    // Entering a token drops the stale notice...
    await saveAdminToken('secret-token');

    await waitFor(() => {
      expect(getAdminToken()).toBe('secret-token');
    });
    await waitFor(() => {
      expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
    });

    // ...and the retried save now succeeds.
    fireEvent.click(screen.getByRole('button', { name: 'Test & save' }));
    await waitFor(() => {
      expect(mockSaveRpcConfig).toHaveBeenCalledTimes(2);
    });
    expect(toast.success).toHaveBeenCalledWith('RPC configuration saved successfully!');
    expect(screen.queryByText(/Saving requires an admin token/)).not.toBeInTheDocument();
  });

  it('shows the real degraded-mode cause instead of generic network advice when saving without a backend', async () => {
    mockSaveRpcConfig.mockRejectedValueOnce(BACKEND_UNCONNECTED);

    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    await submitCustomRpc();

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Backend not connected — indexed data unavailable');
    });
    expect(toast.error).not.toHaveBeenCalledWith(
      'Failed to save configuration. Please check your network connection.',
    );
  });

  it('shows the notice when deleting the config 403s', async () => {
    mockGetRpcConfigs.mockResolvedValue([CUSTOM_CONFIG]);
    mockDeleteRpcConfig.mockRejectedValue(new ApiError('Invalid admin token.', 403));
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<OpenRpcConfig />);
    await screen.findByText('https://rpc.example');

    fireEvent.click(screen.getByRole('button', { name: 'Revert to default' }));

    expect(await screen.findByText(/Saving requires an admin token/)).toBeInTheDocument();
  });

  it('verifies the token against the server and toasts success when it is accepted', async () => {
    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    await saveAdminToken('secret-token');

    // Verification hits an admin-gated endpoint via the http layer, which
    // attaches the just-stored token.
    await waitFor(() => {
      expect(mockHttpGet).toHaveBeenCalledWith('/api/performance/events');
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Admin token saved & verified.');
    });
    expect(getAdminToken()).toBe('secret-token');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('toasts the honest both-causes message when the server rejects the token with 403', async () => {
    mockHttpGet.mockRejectedValueOnce(new ApiError('Invalid admin token.', 403));

    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    await saveAdminToken('wrong-token');

    // A 403 cannot distinguish a wrong token from a server with no
    // ADMIN_TOKEN configured (the gate fails closed) — the toast must
    // say exactly that instead of pretending verification succeeded.
    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Token saved, but the server rejected it — wrong token, or the server has no ADMIN_TOKEN configured.',
      );
    });
    expect(toast.success).not.toHaveBeenCalledWith('Admin token saved & verified.');
    // The token stays stored: the user may fix the server side next.
    expect(getAdminToken()).toBe('wrong-token');
  });

  it('surfaces the backend-not-connected message verbatim when verification cannot reach the server', async () => {
    mockHttpGet.mockRejectedValueOnce(BACKEND_UNCONNECTED);

    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    await saveAdminToken('secret-token');

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Backend not connected — indexed data unavailable');
    });
    expect(toast.success).not.toHaveBeenCalledWith('Admin token saved & verified.');
  });

  it('stores the entered token and refetches configs after save', async () => {
    mockGetRpcConfigs.mockResolvedValueOnce([]).mockResolvedValueOnce([CUSTOM_CONFIG]);

    render(<OpenRpcConfig />);
    await screen.findByText(/Using the default RPC node/);

    await saveAdminToken('secret-token');

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
