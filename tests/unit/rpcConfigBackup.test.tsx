// Focused jsdom tests for the "Backup & restore" section of the RPC
// settings modal: structure (export/restore controls), the export flow
// (gather → download → honest toast, notes surfaced when server data
// was skipped), and the import flow (parse rejection message vs the
// confirmation listing exactly what will be restored, then execution
// with the per-section summary rendered from the report). The backup
// service is stubbed at its module boundary — the pure format layer
// (util/localBackup.ts) runs real, so the plan handed to executeRestore
// is asserted against actual merge-planner output.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { useControl } from 'react-use-control';
import { MemoryRouter, createRoutes } from '@native-router/react';
import RpcConfig from '@/components/RpcConfig';
import { toast } from 'sonner';
import { BACKUP_VERSION, serializeBackup, type BackupParts, type RestorePlan } from '@/util/localBackup';

const { mockGetRpcConfigs, mockCollectBackupParts, mockExportBackupFile, mockExecuteRestore } =
  vi.hoisted(() => ({
    mockGetRpcConfigs: vi.fn(),
    mockCollectBackupParts: vi.fn(),
    mockExportBackupFile: vi.fn(),
    mockExecuteRestore: vi.fn(),
  }));

vi.mock('@/utils/rpcConfigService', () => ({
  getRpcConfigs: mockGetRpcConfigs,
  saveRpcConfig: vi.fn(),
  deleteRpcConfig: vi.fn(),
  testRpcConnection: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/config/chains', () => ({
  getChainName: () => 'Ethereum',
}));

vi.mock('@/services/backupRestore', () => ({
  collectBackupParts: mockCollectBackupParts,
  exportBackupFile: mockExportBackupFile,
  executeRestore: mockExecuteRestore,
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

const PARTS: BackupParts = {
  labels: [
    {
      chainId: 1,
      address: '0x1234567890abcdef1234567890abcdef12345678',
      label: 'Cold wallet',
      note: null,
      source: 'user',
      updatedAt: null,
    },
  ],
  customChains: [
    { chainId: 31337, name: 'Anvil', symbol: 'ETH', decimals: 18, rpcUrl: 'http://127.0.0.1:8545' },
  ],
  browser: {
    watchlist: ['0x1234567890abcdef1234567890abcdef12345678'],
    theme: 'dark',
    ipfsGateway: 'https://pin.mydomain.dev',
    customAbis: [
      { key: 'custom-abi:1:0x1234567890abcdef1234567890abcdef12345678', abi: '[]' },
    ],
    privateNotes: [],
  },
};

const backupFileInput = (): HTMLInputElement => {
  const input = document.querySelector('input[type="file"]');
  if (input === null) throw new Error('backup file input not rendered');
  return input as HTMLInputElement;
};

const chooseFile = async (input: HTMLInputElement, content: string): Promise<void> => {
  const file = new File([content], 'explorer-backup.json', { type: 'application/json' });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => expect(input.value).toBe(''));
};

beforeEach(() => {
  mockGetRpcConfigs.mockReset().mockResolvedValue([]);
  mockCollectBackupParts.mockReset();
  mockExportBackupFile.mockReset();
  mockExecuteRestore.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  localStorage.clear();
});

describe('RpcConfig backup section — structure & export', () => {
  it('renders the section with export/restore controls and a hidden file input', async () => {
    render(<OpenRpcConfig />);

    expect(await screen.findByText('Backup & restore')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Restore from file…' })).toBeEnabled();
    const input = backupFileInput();
    expect(input).not.toBeVisible();
    expect(input.accept).toContain('json');
  });

  it('exports: gathers parts, downloads the file, toasts success', async () => {
    mockCollectBackupParts.mockResolvedValue(PARTS);
    render(<OpenRpcConfig />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export backup' }));

    await waitFor(() => expect(mockExportBackupFile).toHaveBeenCalledTimes(1));
    expect(mockCollectBackupParts).toHaveBeenCalledTimes(1);
    expect(mockExportBackupFile).toHaveBeenCalledWith(PARTS);
    expect(toast.success).toHaveBeenCalledWith('Backup exported to explorer-backup.json.');
    // Back to idle once the download lands.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Export backup' })).toBeEnabled());
  });

  it('surfaces the export notes (honest attribution) in the toast', async () => {
    mockCollectBackupParts.mockResolvedValue({
      ...PARTS,
      notes: ['server data skipped — backend unreachable'],
    });
    render(<OpenRpcConfig />);

    fireEvent.click(await screen.findByRole('button', { name: 'Export backup' }));

    await waitFor(() => expect(mockExportBackupFile).toHaveBeenCalledTimes(1));
    expect(toast.success).toHaveBeenCalledWith(
      'Backup exported — with notes:\nserver data skipped — backend unreachable',
    );
  });
});

describe('RpcConfig backup section — import', () => {
  it('rejects a non-JSON file with the parse error and no confirmation', async () => {
    render(<OpenRpcConfig />);

    await chooseFile(backupFileInput(), 'this is not json{');

    const message = await screen.findByTestId('backup-message');
    expect(message).toHaveTextContent('The file is not valid JSON.');
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
    expect(mockExecuteRestore).not.toHaveBeenCalled();
  });

  it('rejects a wrong-version file with the unknown-version error', async () => {
    render(<OpenRpcConfig />);

    // One past the highest supported version — pinned relative to the
    // exporter so a future bump keeps this test a genuine reject case
    // (a hardcoded 2 stopped being unsupported when v2 shipped).
    const future = { ...serializeBackup(PARTS), version: BACKUP_VERSION + 1 };
    await chooseFile(backupFileInput(), JSON.stringify(future));

    const message = await screen.findByTestId('backup-message');
    expect(message).toHaveTextContent('Unsupported backup format version');
  });

  it('lists the exact write plan for confirmation, then executes and summarizes', async () => {
    mockExecuteRestore.mockResolvedValue({
      storage: { written: 4, failures: [] },
      labels: { attempted: 1, restored: 1, adminDenied: false, failures: [] },
      chains: {
        attempted: 1,
        registered: 0,
        adminDenied: false,
        failures: [{ name: 'Anvil', message: 'RPC probe failed' }],
      },
    });
    render(<OpenRpcConfig />);

    // Empty browser → every browser part is a planned write.
    await chooseFile(backupFileInput(), JSON.stringify(serializeBackup(PARTS)));

    const confirm = await screen.findByTestId('restore-confirm');
    expect(confirm).toHaveTextContent('1 address label(s) will be saved to the backend');
    expect(confirm).toHaveTextContent('1 custom chain(s) will be re-registered');
    expect(confirm).toHaveTextContent('4 browser preference key(s) will be written');

    fireEvent.click(screen.getByRole('button', { name: 'Restore now' }));

    await waitFor(() => expect(mockExecuteRestore).toHaveBeenCalledTimes(1));
    const plan = mockExecuteRestore.mock.calls[0][0] as RestorePlan;
    expect(plan.labelPuts).toHaveLength(1);
    expect(plan.chainPosts).toEqual([
      {
        chainId: 31337,
        input: { rpcUrl: 'http://127.0.0.1:8545', name: 'Anvil', symbol: 'ETH', decimals: 18 },
      },
    ]);
    expect(plan.storageWrites.map(w => w.key)).toEqual([
      'be:watchlist',
      'be:theme',
      'be:ipfsGateway',
      'custom-abi:1:0x1234567890abcdef1234567890abcdef12345678',
    ]);

    const report = await screen.findByTestId('restore-report');
    expect(report).toHaveTextContent('Browser preferences: 4 written');
    expect(report).toHaveTextContent('reload the page to apply them');
    expect(report).toHaveTextContent('Labels: 1 of 1 restored');
    expect(report).toHaveTextContent('Custom chains: 0 of 1 registered');
    expect(report).toHaveTextContent('Anvil: RPC probe failed');
    // The confirmation is gone once the report lands.
    expect(screen.queryByTestId('restore-confirm')).toBeNull();
  });

  it('carries the backup file notes into the confirmation', async () => {
    render(<OpenRpcConfig />);

    const withNotes = serializeBackup({
      ...PARTS,
      notes: ['server data skipped — backend unreachable'],
    });
    await chooseFile(backupFileInput(), JSON.stringify(withNotes));

    const confirm = await screen.findByTestId('restore-confirm');
    expect(confirm).toHaveTextContent('server data skipped — backend unreachable');
    // A plan with work stays actionable.
    expect(screen.getByRole('button', { name: 'Restore now' })).toBeEnabled();
  });

  it('cancel dismisses the confirmation without executing', async () => {
    render(<OpenRpcConfig />);

    await chooseFile(backupFileInput(), JSON.stringify(serializeBackup(PARTS)));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('restore-confirm')).toBeNull();
    expect(mockExecuteRestore).not.toHaveBeenCalled();
  });
});
