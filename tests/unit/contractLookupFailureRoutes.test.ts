// A contract lookup that FAILED was answered as a factual verdict.
//
// Since the 2026-09-20 fix, `getContractSource()` returning null means
// exactly one thing: the address has no deployed code, and the routes
// turn that into 404 `not_a_contract` so the frontend can render "This
// address is not a contract". But the service's own outer catch also
// returned null for EVERY internal failure — a DuckDB read error, a
// serialization throw, a failed cache write — so any outage in those
// steps was reported to the user as an EOA verdict on a real contract,
// with the true cause visible only in the log.
//
// The two sibling shapes in the same service are the same defect on the
// other two surfaces: an unreadable contract's parsed function list came
// back as an empty list ("this contract has no functions") and an
// unreadable contract directory came back as all-zero stats ("0
// contracts on this chain").
//
// Nothing here needs the network: the services are stubbed at the module
// boundary and the REAL route stack is driven through app.request, so the
// assertions read the status codes and bodies the API actually serves.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getContractSource: vi.fn(),
  getContractFunctions: vi.fn(),
  getContractStats: vi.fn(),
}));

vi.mock('@/database/init', () => ({
  db: {},
  contractSources: {},
  contractCreationInfo: {},
  addressLabels: {},
}));
vi.mock('@/services/ContractSourceService', () => ({
  contractSourceService: {
    getContractSource: mocks.getContractSource,
    getContractFunctions: mocks.getContractFunctions,
    getContractStats: mocks.getContractStats,
  },
}));
vi.mock('@/services/ContractInteractionService', () => ({
  contractInteractionService: { getContractFunctions: vi.fn() },
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

const CHAIN_ID = 1;
const CONTRACT = '0xabc0000000000000000000000000000000000001';

const get = (path: string) => app.request(path);
const sourcePath = `/chains/${CHAIN_ID}/contracts/${CONTRACT}/source`;
const abiPath = `/chains/${CHAIN_ID}/contracts/${CONTRACT}/abi`;
const statsPath = `/chains/${CHAIN_ID}/contracts/stats`;

const dbFailure = () => new Error('Failed query: Catalog Error: Table with address does not exist');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('a failed contract lookup is never reported as a factual answer', () => {
  it('answers 404 not_a_contract ONLY for an address without deployed code', async () => {
    // The EOA verdict, which the service signals with null.
    mocks.getContractSource.mockResolvedValue(null);

    const response = await get(sourcePath);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.code).toBe('not_a_contract');
  });

  it('does not report an unreadable contract as an EOA on the source route', async () => {
    mocks.getContractSource.mockResolvedValue(null);
    // …and the failure the old service also answered with null.
    mocks.getContractSource.mockRejectedValue(dbFailure());

    const response = await get(sourcePath);
    const body = await response.json();

    expect(response.status).not.toBe(404);
    expect(body.code).not.toBe('not_a_contract');
    expect(response.status).toBe(500);
  });

  it('does not report an unreadable contract as an EOA on the abi route', async () => {
    mocks.getContractSource.mockResolvedValue(null);
    mocks.getContractFunctions.mockResolvedValue({ functions: [], events: [], errors: [] });
    mocks.getContractSource.mockRejectedValue(dbFailure());

    const response = await get(abiPath);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).not.toBe('not_a_contract');
  });

  it('does not report an unreadable function list as "this contract has no functions"', async () => {
    mocks.getContractSource.mockResolvedValue({ abi: '[]', verificationStatus: 'verified' });
    mocks.getContractFunctions.mockRejectedValue(dbFailure());

    const response = await get(abiPath);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.functions).toBeUndefined();
  });

  it('does not report an unreadable contract directory as zero contracts', async () => {
    mocks.getContractStats.mockRejectedValue(dbFailure());

    const response = await get(statsPath);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.stats).toBeUndefined();
  });
});
