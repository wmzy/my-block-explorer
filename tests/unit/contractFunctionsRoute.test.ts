// Route contract for GET .../contracts/:address/functions: the response
// carries the REAL Cache-Control header ('public, max-age=300') so shared
// caches may hold the (immutable per deployed bytecode) function list —
// this pins the header name after a historical 'X-Cache-Control' typo
// shipped a header no cache ever reads. Services are stubbed at the
// module boundary (same set as contractBodyValidation.test.ts) so no RPC
// or DuckDB access happens.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getContractSource: vi.fn(),
  getContractFunctions: vi.fn(),
}));

vi.mock('@/database/init', () => ({
  db: {},
  contractSources: {},
  addressLabels: {},
}));

vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: { getContractSource: mocks.getContractSource },
}));
vi.mock('@/services/ContractInteractionService', () => ({
  contractInteractionService: { getContractFunctions: mocks.getContractFunctions },
}));

vi.mock('@/services/IdeService', () => ({
  detectInstalledIdes: () => [],
  getDetectedIdesInfo: () => ({}),
  openInIde: vi.fn(),
}));
vi.mock('@/services/BlockService', () => ({ blockService: {} }));
vi.mock('@/services/TransactionService', () => ({ transactionService: {} }));
vi.mock('@/services/AddressService', () => ({ addressService: {} }));

import app from '@/routes/contracts';

const CONTRACT = '0xabc0000000000000000000000000000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getContractSource.mockResolvedValue({
    abi: JSON.stringify([
      { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [], outputs: [] },
    ]),
  });
  mocks.getContractFunctions.mockResolvedValue({ readFunctions: [], writeFunctions: [] });
});

describe('GET .../functions cache headers', () => {
  it('sets the real Cache-Control header (not the X-Cache-Control typo)', async () => {
    const res = await app.request(`/chains/1/contracts/${CONTRACT}/functions`);

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    // The typo'd name must be gone — a stale duplicate would confuse every
    // client that greps for it.
    expect(res.headers.get('X-Cache-Control')).toBeNull();
  });

  it('follows the proxy ABI when the source marks a proxy implementation', async () => {
    mocks.getContractSource.mockResolvedValue({
      isProxy: true,
      implementationContract: {
        abi: JSON.stringify([
          { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [], outputs: [] },
        ]),
      },
    });

    const res = await app.request(`/chains/1/contracts/${CONTRACT}/functions`);

    expect(res.status).toBe(200);
    // The implementation's ABI is what got classified, not the proxy stub's
    // (getValidatedAddress checksums the param — hence the uppercase form).
    expect(mocks.getContractFunctions).toHaveBeenCalledWith(
      1,
      '0xABC0000000000000000000000000000000000001',
      JSON.stringify([
        { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [], outputs: [] },
      ]),
    );
  });
});
