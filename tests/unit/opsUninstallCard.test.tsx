// The /ops danger-zone contract: the card is part of the dashboard (only
// when the summary loaded), opening it fetches a preview (the shared CLI
// enumeration), every target renders with its size — missing ones say
// "not present" — the Erase button stays disabled until the operator
// types the exact phrase the API demands, and a 202 swaps the dialog to
// the terminal state + toast (the page itself is about to go offline —
// the toast is what survives that flip). The uninstall endpoints sit
// behind the STRICT gate, so failure faces include the zero-config
// 'unconfigured' 403 (in-page uninstall disabled by design; the copy
// offers the terminal alternative). Everything else classifies through
// the page's established error helpers.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, View, createRoutes } from '@native-router/react';
import '@testing-library/jest-dom/vitest';
import Ops, { uninstallErrorText } from '@/views/Ops';
import { ApiError } from '@/util/apiError';
import type { OpsSummary, UninstallPreview } from '@/services/opsSummary';

const { mockUseOpsSummary, mockFetchPreview, mockRequestUninstall } = vi.hoisted(() => ({
  mockUseOpsSummary: vi.fn(),
  mockFetchPreview: vi.fn(),
  mockRequestUninstall: vi.fn(),
}));

vi.mock('@/components/TopNavigation', () => ({
  default: () => <div data-testid="top-navigation" />,
}));

vi.mock('@/views/Home/Landing', () => ({
  readRememberedChainId: () => 1,
}));

vi.mock('@/services/opsSummary', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/opsSummary')>();
  return {
    ...actual,
    useOpsSummary: (...args: unknown[]) => mockUseOpsSummary(...args),
    fetchUninstallPreview: (...args: unknown[]) => mockFetchPreview(...args),
    requestBackendUninstall: (...args: unknown[]) => mockRequestUninstall(...args),
  };
});

const refetch = vi.fn();

const FULL_SUMMARY: OpsSummary = {
  meta: { version: '1.2.3', uptimeSeconds: 60, timestamp: '2026-09-30T10:00:00.000Z' },
  storage: {
    mainDbBytes: 1000,
    perChainDbFiles: [],
    solcCache: { files: 0, bytes: 0 },
  },
  indexing: { total: 0, chains: [] },
  watch: { total: 0, subscriptions: [] },
  rateLimit: { buckets: [] },
  deepScan: { total: 0, byStatus: {} },
};

const PREVIEW: UninstallPreview = {
  targets: [
    {
      kind: 'data-dir',
      path: '/srv/explorer/data',
      label: 'data',
      exists: true,
      bytes: 21_840_000,
      files: 3,
    },
    {
      kind: 'tmp-scratch',
      path: '/tmp/block-explorer-contracts',
      label: '…/block-explorer-contracts',
      exists: false,
      bytes: 0,
      files: 0,
    },
  ],
  existingBytes: 21_840_000,
  existingFiles: 3,
  confirmPhrase: 'uninstall',
};

const routes = createRoutes([{ path: '/ops', component: () => Ops }]);

const renderOps = async () => {
  render(
    <MemoryRouter routes={routes} initialEntries={['/ops']}>
      <View />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Ops Dashboard')).toBeInTheDocument();
};

const openDialog = async () => {
  fireEvent.click(screen.getByTestId('uninstall-button'));
  await waitFor(() => {
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
};

const typePhrase = (phrase: string) => {
  fireEvent.change(screen.getByTestId('uninstall-confirm-input'), {
    target: { value: phrase },
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  mockUseOpsSummary.mockReturnValue({
    data: FULL_SUMMARY,
    loading: false,
    fetching: false,
    error: undefined,
    failureCount: 0,
    stale: false,
    dataUpdatedAt: 123,
    refetch,
  });
  mockFetchPreview.mockResolvedValue(PREVIEW);
  mockRequestUninstall.mockResolvedValue({ status: 'scheduled', graceMs: 1500 });
});

describe('the danger card', () => {
  it('renders as part of a loaded dashboard', async () => {
    await renderOps();
    expect(screen.getByTestId('uninstall-button')).toBeInTheDocument();
    expect(screen.getByText(/The in-server equivalent of/)).toBeInTheDocument();
  });

  it('does not render when the summary failed or is gated', async () => {
    mockUseOpsSummary.mockReturnValue({
      data: undefined,
      loading: false,
      fetching: false,
      error: new ApiError('Invalid admin token.', 403),
      failureCount: 1,
      stale: false,
      dataUpdatedAt: 0,
      refetch,
    });
    await renderOps();
    expect(screen.queryByTestId('uninstall-button')).not.toBeInTheDocument();
  });
});

// Return-type annotation instead of an `as` cast: tsc needs the
// HTMLButtonElement narrowing for `.disabled`, eslint's
// no-unnecessary-type-assertion flags the cast — the helper satisfies both.
const executeButton = (): HTMLButtonElement => screen.getByTestId('uninstall-execute');

describe('preview flow', () => {
  it('opens the dialog, loads the enumeration and renders every target honestly', async () => {
    await renderOps();
    await openDialog();

    await waitFor(() => {
      expect(screen.getByTestId('uninstall-preview')).toBeInTheDocument();
    });
    expect(mockFetchPreview).toHaveBeenCalledTimes(1);
    // Existing target: label + size + file count (row AND total line);
    // missing: said so.
    expect(screen.getByText('data')).toBeInTheDocument();
    expect(screen.getAllByText(/20.83 MB/)).toHaveLength(2);
    expect(screen.getAllByText(/3 files?/)).toHaveLength(2);
    expect(screen.getByText('not present')).toBeInTheDocument();
    // The typed-confirmation instruction names the exact phrase.
    expect(screen.getByText('uninstall', { selector: 'code' })).toBeInTheDocument();
  });

  it('keeps Erase disabled until the phrase matches exactly', async () => {
    await renderOps();
    await openDialog();
    await waitFor(() => {
      expect(screen.getByTestId('uninstall-preview')).toBeInTheDocument();
    });

    const execute = executeButton();
    expect(execute.disabled).toBe(true);
    typePhrase('uninstal');
    expect(execute.disabled).toBe(true);
    typePhrase('uninstall');
    expect(execute.disabled).toBe(false);
  });

  it('disables Erase entirely when nothing exists to delete', async () => {
    mockFetchPreview.mockResolvedValue({
      ...PREVIEW,
      targets: PREVIEW.targets.map(target => ({ ...target, exists: false })),
      existingBytes: 0,
      existingFiles: 0,
    });
    await renderOps();
    await openDialog();

    await waitFor(() => {
      expect(screen.getByText(/Nothing to delete/)).toBeInTheDocument();
    });
    typePhrase('uninstall');
    expect(executeButton().disabled).toBe(true);
  });

  it('classifies a preview failure and offers Retry', async () => {
    mockFetchPreview.mockRejectedValue(new ApiError('Invalid admin token.', 403));
    await renderOps();
    await openDialog();

    const error = await screen.findByTestId('uninstall-error');
    expect(error).toHaveTextContent(/requires an admin token/);

    mockFetchPreview.mockResolvedValue(PREVIEW);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(screen.getByTestId('uninstall-preview')).toBeInTheDocument();
    });
  });

  // The strict gate's zero-config face (no ADMIN_TOKEN on the server): the
  // in-page action is disabled BY DESIGN, so the copy must say so and
  // offer both real ways out instead of a token-field hint that cannot
  // fix a tokenless server.
  it('renders the fail-closed face for an unconfigured server, with the CLI alternative', async () => {
    mockFetchPreview.mockRejectedValue(
      new ApiError(
        'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
        403,
      ),
    );
    await renderOps();
    await openDialog();

    const error = await screen.findByTestId('uninstall-error');
    expect(error).toHaveTextContent(/no ADMIN_TOKEN configured/);
    expect(error).toHaveTextContent(/fails closed/);
    expect(error).toHaveTextContent(/reload this page/);
    expect(error).toHaveTextContent(/my-block-explorer uninstall/);
    // No preview was served, so nothing renders as deletable.
    expect(screen.queryByTestId('uninstall-preview')).not.toBeInTheDocument();
  });
});

describe('execute flow', () => {
  it('sends the verbatim phrase, swaps to the terminal state and toasts', async () => {
    await renderOps();
    await openDialog();
    await waitFor(() => {
      expect(screen.getByTestId('uninstall-preview')).toBeInTheDocument();
    });

    typePhrase('uninstall');
    fireEvent.click(screen.getByTestId('uninstall-execute'));

    await waitFor(() => {
      expect(screen.getByTestId('uninstall-accepted')).toBeInTheDocument();
    });
    expect(mockRequestUninstall).toHaveBeenCalledWith('uninstall');
    // The shared haze-ui toast mock — the terminal toast is what survives
    // the page's upcoming offline flip.
    const { toast } = await import('haze-ui');
    expect(toast.danger).toHaveBeenCalledWith(
      'Erasure scheduled — the backend is shutting down and exits after deleting.',
      { duration: 8000 },
    );
  });

  it('falls back to the confirm state with the classified error on failure', async () => {
    mockRequestUninstall.mockRejectedValue(new ApiError('…retry after 7s.', 429));
    await renderOps();
    await openDialog();
    await waitFor(() => {
      expect(screen.getByTestId('uninstall-preview')).toBeInTheDocument();
    });

    typePhrase('uninstall');
    fireEvent.click(screen.getByTestId('uninstall-execute'));

    await waitFor(() => {
      expect(screen.getByTestId('uninstall-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('uninstall-error')).toHaveTextContent(/retry after 7s/);
    // Back to confirm: the operator can read why and try again.
    expect(screen.getByTestId('uninstall-confirm-input')).toBeInTheDocument();
  });
});

describe('uninstallErrorText — pure classification', () => {
  it('covers the gate faces, the limiter wait and an unreachable backend', () => {
    expect(uninstallErrorText(new ApiError('Invalid admin token.', 403))).toMatch(
      /requires an admin token/,
    );
    // The strict tier's zero-config face: fail-closed by design, with the
    // two real ways out (token + reload, or the CLI).
    expect(
      uninstallErrorText(
        new ApiError(
          'Admin operations are disabled. Set ADMIN_TOKEN on the server to enable them.',
          403,
        ),
      ),
    ).toMatch(/no ADMIN_TOKEN configured.*fails closed.*my-block-explorer uninstall/s);
    expect(uninstallErrorText(new ApiError('…retry after 3s.', 429))).toBe(
      'Too many requests — retry after 3s.',
    );
    expect(uninstallErrorText(new ApiError('Network error', 0))).toMatch(/unreachable/);
    expect(uninstallErrorText(new Error('plain failure'))).toBe('plain failure');
  });
});
