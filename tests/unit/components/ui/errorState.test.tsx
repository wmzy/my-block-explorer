// BackendOfflineState (the ErrorState backend-offline variant): renders the
// attribution + self-help path instead of a raw error message, and only
// offers the retry-connection action when the hosting surface wires one —
// a plain Retry is pointless while the API base is unset.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { BackendOfflineState, ErrorState } from '@/components/ui/ErrorState';

describe('BackendOfflineState', () => {
  it('attributes the failure to the backend and shows the start command', () => {
    render(<BackendOfflineState />);

    expect(screen.getByText(/Backend offline — indexed data unavailable/)).toBeInTheDocument();
    // The self-help path: what needs the backend, how to start it, and
    // where the setup panel lives.
    expect(screen.getByText(/indexing backend, not from the chain RPC/)).toBeInTheDocument();
    expect(screen.getByText('npx my-block-explorer --port 8201')).toBeInTheDocument();
    expect(screen.getByText(/open the setup panel from the banner at the top/)).toBeInTheDocument();
  });

  it('renders no retry action when the surface wires no connection retry', () => {
    render(<BackendOfflineState />);

    // No dead retry: without a reconnect handler there is no button at all
    // (a plain data Retry would fast-fail while the API base is unset).
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders the retry-connection action when provided and forwards clicks', async () => {
    const user = userEvent.setup();
    const onRetryConnection = vi.fn();
    render(<BackendOfflineState onRetryConnection={onRetryConnection} />);

    await user.click(screen.getByRole('button', { name: 'Retry connection' }));

    expect(onRetryConnection).toHaveBeenCalledTimes(1);
  });

  it('disables the retry action while a discovery attempt is pending', () => {
    render(<BackendOfflineState onRetryConnection={vi.fn()} retryConnectionPending />);

    const button = screen.getByRole('button', { name: 'Retrying…' });
    expect(button).toBeDisabled();
  });

  it('keeps the plain ErrorState variant untouched (raw message + retry)', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ErrorState message="something broke" onRetry={onRetry} />);

    expect(screen.getByText('something broke')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
