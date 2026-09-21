// Sourcify verify panel: the unverified-contract affordance in the
// Contract view (toggle renders only in the unverified branch), and the
// panel's own behavior — client-side metadata.json requirement, file
// chips, submission result mapping (success banner + refetch, verbatim
// sourcify refusals, admin-token/502/offline attributions). The HTTP
// layer and the query hooks are mocked — no network.
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, View, createRoutes } from '@native-router/react';

import Contract from '@/views/Contract';
import { SourcifyVerifyPanel } from '@/views/Contract/SourcifyVerifyPanel';
import { post } from '@/util/http';
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
  };
});

const mockReconnect = vi.fn(async (): Promise<{ url: string } | null> => null);
vi.mock('@/hooks/ServiceDiscoveryContext', () => ({
  useServiceDiscovery: () => ({ reconnect: mockReconnect }),
}));

const ADDRESS = '0xabc0000000000000000000000000000000000001';

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

const verifiedSourceResponse = {
  contractSource: {
    ...unverifiedSourceResponse.contractSource,
    name: 'TestToken',
    verificationStatus: 'verified',
    verificationSource: 'sourcify',
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

const metadataFile = () =>
  new File([JSON.stringify({ compiler: { version: '0.8.20' } })], 'metadata.json', {
    type: 'application/json',
  });
const sourceFile = () =>
  new File(['pragma solidity ^0.8.20;\ncontract Storage {}\n'], 'contracts/Storage.sol');

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
  vi.mocked(post).mockReset();
  vi.mocked(post).mockResolvedValue({});
  mockReconnect.mockReset();
  mockReconnect.mockResolvedValue(null);
  vi.mocked(useContractSource).mockReturnValue(mockHookResult(unverifiedSourceResponse));
  vi.mocked(useContractCreation).mockReturnValue(mockHookResult({ found: false }));
  vi.mocked(useStorageLayout).mockReturnValue(mockHookResult(undefined));
});

describe('Contract view - verify affordance', () => {
  it('offers the in-page panel in the unverified branch and opens it', async () => {
    const user = userEvent.setup();
    renderAt(`/chain/1/contract/${ADDRESS}`);

    const toggle = await screen.findByRole('button', { name: 'Verify in this page' });
    await user.click(toggle);

    expect(await screen.findByRole('button', { name: 'Verify via Sourcify' })).toBeVisible();
    expect(screen.getByLabelText('Verification files')).toBeInTheDocument();
  });

  it('renders no verify affordance for a verified contract', async () => {
    vi.mocked(useContractSource).mockReturnValue(mockHookResult(verifiedSourceResponse));
    renderAt(`/chain/1/contract/${ADDRESS}`);

    await screen.findByText('TestToken');
    expect(
      screen.queryByRole('button', { name: 'Verify in this page' }),
    ).not.toBeInTheDocument();
  });
});

describe('SourcifyVerifyPanel', () => {
  const renderPanel = () =>
    render(
      <SourcifyVerifyPanel chainId={1} address={ADDRESS} onVerified={vi.fn()} />,
    );

  const upload = async (user: ReturnType<typeof userEvent.setup>, files: File[]) => {
    const input = screen.getByLabelText('Verification files');
    await user.upload(input, files);
  };

  it('disables submit until metadata.json is among the picked files', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('button', { name: 'Verify via Sourcify' })).toBeDisabled();

    await upload(user, [sourceFile()]);

    expect(screen.getByRole('button', { name: 'Verify via Sourcify' })).toBeDisabled();
    expect(screen.getByText(/metadata\.json is required/)).toBeInTheDocument();
    expect(screen.getAllByTestId('verify-file-chip')).toHaveLength(1);
    expect(post).not.toHaveBeenCalled();
  });

  it('enables submit once metadata.json and sources are picked, and removes chips', async () => {
    const user = userEvent.setup();
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);

    expect(screen.getByRole('button', { name: 'Verify via Sourcify' })).toBeEnabled();
    expect(screen.getByText('metadata.json')).toBeInTheDocument();
    expect(screen.getByText(/contracts\/Storage\.sol/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove metadata.json' }));

    expect(screen.getByRole('button', { name: 'Verify via Sourcify' })).toBeDisabled();
    expect(screen.getByText(/metadata\.json is required/)).toBeInTheDocument();
  });

  it('refuses oversized bundles client-side', async () => {
    const user = userEvent.setup();
    renderPanel();

    await upload(user, [metadataFile(), new File(['x'.repeat(2 * 1024 * 1024 + 1)], 'big.sol')]);

    expect(screen.getByRole('button', { name: 'Verify via Sourcify' })).toBeDisabled();
    expect(screen.getByText(/the limit is 2 MB/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it('submits the bundle and shows the success banner plus refetch on verified', async () => {
    const onVerified = vi.fn();
    const user = userEvent.setup();
    vi.mocked(post).mockResolvedValue({ verified: true, status: 'perfect' });
    render(<SourcifyVerifyPanel chainId={1} address={ADDRESS} onVerified={onVerified} />);

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    expect(await screen.findByText('Verified (perfect) — source refreshed')).toBeInTheDocument();
    expect(onVerified).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(`/api/chains/1/contracts/${ADDRESS}/verify`, {
      files: {
        'metadata.json': JSON.stringify({ compiler: { version: '0.8.20' } }),
        'contracts/Storage.sol': 'pragma solidity ^0.8.20;\ncontract Storage {}\n',
      },
    });
  });

  it('renders a sourcify refusal verbatim', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockResolvedValue({
      verified: false,
      kind: 'rejected',
      message: 'The onchain and recompiled bytecodes don\'t match.',
    });
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    expect(
      await screen.findByText('The onchain and recompiled bytecodes don\'t match.'),
    ).toBeInTheDocument();
  });

  it('names the chain-unsupported outcome in plain words', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockResolvedValue({
      verified: false,
      kind: 'unsupported_chain',
      message: 'The chain with chainId 9429413 is not supported',
    });
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    expect(
      await screen.findByText(
        'Sourcify does not support this chain: The chain with chainId 9429413 is not supported',
      ),
    ).toBeInTheDocument();
  });

  it('shows the admin-token hint on 403', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValue(new ApiError('Forbidden', 403));
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    expect(
      await screen.findByText(/Requires admin token — set it via ⚙️ RPC → Admin token/),
    ).toBeInTheDocument();
  });

  it('attributes a 502 to the sourcify round trip and invites a retry', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValue(
      new ApiError('Sourcify server error (HTTP 502).', 502),
    );
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    expect(
      await screen.findByText(/Sourcify server error \(HTTP 502\)\. Try again in a moment\./),
    ).toBeInTheDocument();
  });

  it('attributes a connection failure to the explorer API', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValue(new ApiError('backend unconnected', 0));
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    expect(await screen.findByText(/explorer API is unreachable/)).toBeInTheDocument();
  });

  it('re-enables submit after a failed submission', async () => {
    const user = userEvent.setup();
    vi.mocked(post).mockRejectedValueOnce(new ApiError('nope', 500));
    renderPanel();

    await upload(user, [metadataFile(), sourceFile()]);
    await user.click(screen.getByRole('button', { name: 'Verify via Sourcify' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Verify via Sourcify' })).toBeEnabled(),
    );
  });
});
