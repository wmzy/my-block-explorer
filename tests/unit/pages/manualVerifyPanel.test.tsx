// Manual (local-trust) verify panel: the Contract view surfaces it for
// unverified contracts (alongside the Sourcify panel) and for
// manual-verified ones (badge + manage cell), and the panel's own
// behavior — client-side ABI parse feedback, payload shape, submit
// result mapping (success banner + refetch, admin-token/offline
// attributions, remove flow). The HTTP layer and the query hooks are
// mocked — no network.
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, View, createRoutes } from '@native-router/react';

import Contract from '@/views/Contract';
import { ManualVerifyPanel } from '@/views/Contract/ManualVerifyPanel';
import { post, del } from '@/util/http';
import { ApiError } from '@/util/apiError';
import {
  useContractCreation,
  useContractSource,
  useStorageLayout,
} from '@/services/contracts';

// jsdom implements neither Element.scrollIntoView nor :focus scrolling.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

vi.mock('@/services/contracts', () => ({
  useContractSource: vi.fn(),
  useContractCreation: vi.fn(),
  useStorageLayout: vi.fn(),
}));

vi.mock('@/components/TopNavigation', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-testid': 'top-navigation' }),
  };
});

vi.mock('@/components/SourceCodeViewer', async () => {
  const React = await import('react');
  return {
    SourceCodeViewer: () => React.createElement('div'),
  };
});

vi.mock('@/components/RpcConfig', async () => {
  const React = await import('react');
  return { default: () => React.createElement('div') };
});

vi.mock('@/util/http', async importOriginal => {
  // Keep the real isBackendUnreachable: a pure predicate over ApiError
  // that the panel's offline attribution branch depends on.
  const actual = await importOriginal<typeof import('@/util/http')>();
  return {
    ...actual,
    post: vi.fn(async () => ({})),
    del: vi.fn(async () => ({})),
  };
});

// The view's on-chain proxy probe reaches the browser RPC client; the
// factory mock keeps it out of jsdom (the probe's own behavior is covered
// in contractPage.test.tsx).
vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const mockReconnect = vi.fn(async (): Promise<{ url: string } | null> => null);
vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ reconnect: mockReconnect }),
}));

const ADDRESS = '0xabc0000000000000000000000000000000000001';
const VALID_ABI = '[{"type":"function","name":"get","inputs":[],"outputs":[]}]';

const unverifiedSourceResponse = {
  contractSource: {
    chainId: 1,
    address: ADDRESS,
    sourceCode: '',
    abi: '',
    verificationStatus: 'unverified',
    verificationSource: 'none',
    lastChecked: '2026-01-01T00:00:00Z',
  },
};

const manualSourceResponse = {
  contractSource: {
    ...unverifiedSourceResponse.contractSource,
    verificationStatus: 'verified',
    verificationSource: 'manual',
  },
};

const mockHookResult = (data: unknown) =>
  ({ data, loading: false, error: undefined, refetch: vi.fn() }) as unknown as never;

function renderAt(path: string) {
  const routes = createRoutes([
    { path: '/chain/:chainId/contract/:address', component: () => Contract },
  ]);
  return render(
    <MemoryRouter routes={routes} initialEntries={[path]}>
      <View />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.mocked(post).mockReset();
  vi.mocked(post).mockResolvedValue({});
  vi.mocked(del).mockReset();
  vi.mocked(del).mockResolvedValue({});
  mockReconnect.mockReset();
  mockReconnect.mockResolvedValue(null);
  vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
  vi.mocked(useContractCreation).mockReturnValue(mockHookResult({ found: false }));
  vi.mocked(useStorageLayout).mockReturnValue(mockHookResult(undefined));
});

describe('Contract view - manual trust affordance', () => {
  it('offers the manual panel alongside Sourcify in the unverified branch', async () => {
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await user.click(await screen.findByRole('button', { name: 'Verify in this page' }));

    expect(await screen.findByRole('button', { name: 'Verify via Sourcify' })).toBeVisible();
    expect(
      await screen.findByRole('button', { name: 'Mark as trusted locally' }),
    ).toBeVisible();
  });

  it('shows the Manual (local trust) badge and manage cell for a manual mark', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(manualSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    expect(await screen.findByText('Manual (local trust)')).toBeVisible();
    // The unverified-only Sourcify affordance must not render.
    expect(
      screen.queryByRole('button', { name: 'Verify in this page' }),
    ).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Manage local trust mark' }));

    expect(
      await screen.findByRole('button', { name: 'Remove local trust mark' }),
    ).toBeVisible();
    expect(screen.getByText(/not cryptographic verification/)).toBeInTheDocument();
  });
});

describe('ManualVerifyPanel', () => {
  const renderPanel = (marked = false) =>
    render(
      <ManualVerifyPanel chainId={1} address={ADDRESS} marked={marked} onChanged={vi.fn()} />,
    );

  // Paste semantics (fireEvent.change, the repo's textarea convention):
  // userEvent.type would interpret [/{ as keyboard key descriptors.
  const pasteAbi = (raw: string) => {
    fireEvent.change(screen.getByLabelText('ABI (JSON array, required)'), {
      target: { value: raw },
    });
  };

  it('states the local-trust copy, not cryptographic verification', () => {
    renderPanel();

    expect(screen.getByText(/not cryptographic verification/i)).toBeInTheDocument();
    expect(screen.getByText(/not shared anywhere unless your server is/i)).toBeInTheDocument();
  });

  it('disables submit until the ABI parses as a non-empty array', async () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'Mark as trusted locally' })).toBeDisabled();

    pasteAbi('not json');
    expect(screen.getByRole('button', { name: 'Mark as trusted locally' })).toBeDisabled();
    expect(screen.getByText(/Not valid JSON/)).toBeInTheDocument();

    pasteAbi('{"type":"function"}');
    expect(screen.getByRole('button', { name: 'Mark as trusted locally' })).toBeDisabled();
    expect(screen.getByText(/must be a JSON array/)).toBeInTheDocument();

    pasteAbi('[]');
    expect(screen.getByRole('button', { name: 'Mark as trusted locally' })).toBeDisabled();
    expect(screen.getByText(/at least one entry/)).toBeInTheDocument();

    pasteAbi(VALID_ABI);
    expect(screen.getByRole('button', { name: 'Mark as trusted locally' })).toBeEnabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('submits the pasted payload and shows the success banner plus refetch', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    vi.mocked(post).mockResolvedValue({ verified: true, verificationSource: 'manual' });
    render(<ManualVerifyPanel chainId={1} address={ADDRESS} marked={false} onChanged={onChanged} />);

    pasteAbi(VALID_ABI);
    fireEvent.change(screen.getByLabelText('Contract name (optional)'), {
      target: { value: 'C' },
    });
    await user.click(screen.getByRole('button', { name: 'Mark as trusted locally' }));

    expect(await screen.findByText(/Local trust mark saved/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`/api/chains/1/contracts/${ADDRESS}/verify/manual`, {
      abi: VALID_ABI,
      name: 'C',
    });
  });

  it('shows the admin-token hint on 403', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValue(new ApiError('Forbidden', 403));
    renderPanel();

    pasteAbi(VALID_ABI);
    await user.click(screen.getByRole('button', { name: 'Mark as trusted locally' }));

    expect(
      await screen.findByText(/Requires admin token — set it via ⚙️ RPC → Admin token/),
    ).toBeInTheDocument();
  });

  it('attributes a connection failure to the explorer API', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValue(new ApiError('backend unconnected', 0));
    renderPanel();

    pasteAbi(VALID_ABI);
    await user.click(screen.getByRole('button', { name: 'Mark as trusted locally' }));

    expect(await screen.findByText(/explorer API is unreachable/)).toBeInTheDocument();
  });

  it('remove mode: DELETEs the mark and refetches on success', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    render(<ManualVerifyPanel chainId={1} address={ADDRESS} marked={true} onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Remove local trust mark' }));

    expect(await screen.findByText(/Local trust mark removed/)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(`/api/chains/1/contracts/${ADDRESS}/verify/manual`);
  });

  it('remove mode: names a 404 in plain words without refetching', async () => {
    const onChanged = vi.fn();
    const user = userEvent.setup();
    vi.mocked(del).mockRejectedValue(new ApiError('Not found', 404));
    render(<ManualVerifyPanel chainId={1} address={ADDRESS} marked={true} onChanged={onChanged} />);

    await user.click(await screen.findByRole('button', { name: 'Remove local trust mark' }));

    expect(await screen.findByText(/No manual mark was found/)).toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
