// OpenInIdeButton contract tests: honest absence when detection yields no
// IDEs (or fails), the intact single-IDE open path, and the toast that
// replaced the silent open failure. The http layer is mocked and haze-ui toasts run on the setup-level mock so
// both the backend calls and the surfaced error are observable.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toast } from 'haze-ui';
import { OpenInIdeButton } from '@/views/Contract/OpenInIdeButton';
import { ApiError } from '@/util/apiError';

const { mockGet, mockPost } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: mockGet,
  post: mockPost,
}));

const ADDRESS = '0xabc0000000000000000000000000000000000001';

describe('OpenInIdeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when no IDEs are detected', async () => {
    mockGet.mockResolvedValue({ ides: [] });

    const { container } = render(<OpenInIdeButton chainId={1} address={ADDRESS} />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders nothing when the detection call fails', async () => {
    mockGet.mockRejectedValue(new Error('network down'));

    const { container } = render(<OpenInIdeButton chainId={1} address={ADDRESS} />);

    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('button')).toBeNull());
  });

  it('opens the single detected IDE directly, without a toast', async () => {
    mockGet.mockResolvedValue({ ides: [{ id: 'vscode', displayName: 'VS Code' }] });
    mockPost.mockResolvedValue({});

    render(<OpenInIdeButton chainId={1} address={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open in VS Code' }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(`/api/chains/1/contracts/${ADDRESS}/open-in-ide`, {
        ide: 'vscode',
      }),
    );
    expect(vi.mocked(toast.danger)).not.toHaveBeenCalled();
  });

  it('surfaces open failures via a toast instead of failing silently', async () => {
    mockGet.mockResolvedValue({ ides: [{ id: 'vscode', displayName: 'VS Code' }] });
    mockPost.mockRejectedValue(new Error('bridge unreachable'));

    render(<OpenInIdeButton chainId={1} address={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open in VS Code' }));

    await waitFor(() =>
      expect(vi.mocked(toast.danger)).toHaveBeenCalledWith('Failed to open in IDE: bridge unreachable'),
    );
  });

  it('points a 403 at the admin-token gate with the established guidance', async () => {
    mockGet.mockResolvedValue({ ides: [{ id: 'vscode', displayName: 'VS Code' }] });
    // The write endpoint requires ADMIN_TOKEN on the server (C-4): the
    // browser has no token set.
    mockPost.mockRejectedValue(new ApiError('admin token required', 403));

    render(<OpenInIdeButton chainId={1} address={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Open in VS Code' }));

    await waitFor(() =>
      expect(vi.mocked(toast.danger)).toHaveBeenCalledWith(
        'Failed to open in IDE: requires admin token — set it via ⚙️ RPC → Admin token. The server must have ADMIN_TOKEN configured.',
      ),
    );
  });
});
