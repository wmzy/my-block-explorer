// Observable behavior of the ENS reverse-resolution service: mainnet-pinned
// lookups regardless of the viewing chain, gated invalid args, and the
// never-throw contract — unresolved names and RPC failures both settle as
// data null.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { PublicClient } from 'viem';

import { clearAllCaches } from '@/util/useQuery';
import { fetchEnsName, useEnsName } from '@/services/ens';
import { resolveEnsAddress } from '@/services/ensForward';
import { createRpcClient } from '@/utils/realTimeData';

// The service's only RPC dependency is the shared client factory; mocking
// it keeps these tests on the query layer's observable behavior.
vi.mock('@/utils/realTimeData');

const mockedCreateRpcClient = vi.mocked(createRpcClient);

const testAddress = '0x1234567890123456789012345678901234567890';

/** Partial client carrying just the action under test. */
const clientWith = (getEnsName: PublicClient['getEnsName']): PublicClient =>
  ({ getEnsName }) as unknown as PublicClient;

describe('fetchEnsName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalid args resolve undefined without touching the RPC', async () => {
    expect(await fetchEnsName(undefined)).toBeUndefined();
    expect(await fetchEnsName('')).toBeUndefined();
    expect(mockedCreateRpcClient).not.toHaveBeenCalled();
  });
});

// Forward resolution (name → address) is what the search surfaces run. Its
// contract is the honesty distinction the UI copies depend on: a null
// answer is a definitive 'not-found', an RPC error is a retryable
// 'failed' — never one blurred outcome for both.
describe('resolveEnsAddress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** Partial client carrying just the action under test. */
  const clientWithGetEnsAddress = (getEnsAddress: PublicClient['getEnsAddress']): PublicClient =>
    ({ getEnsAddress }) as unknown as PublicClient;

  it('resolves against mainnet — where the ENS registry lives', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWithGetEnsAddress(vi.fn().mockResolvedValue('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')),
    );

    const outcome = await resolveEnsAddress('vitalik.eth');

    expect(outcome).toEqual({
      status: 'resolved',
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    });
    expect(mockedCreateRpcClient).toHaveBeenCalledWith(1);
  });

  it('passes the lowercased name to the resolver', async () => {
    const getEnsAddress = vi.fn().mockResolvedValue('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045');
    mockedCreateRpcClient.mockResolvedValue(clientWithGetEnsAddress(getEnsAddress));

    await resolveEnsAddress('Vitalik.ETH');

    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'vitalik.eth' });
  });

  it('a null answer settles as not-found (definitive)', async () => {
    mockedCreateRpcClient.mockResolvedValue(clientWithGetEnsAddress(vi.fn().mockResolvedValue(null)));

    expect(await resolveEnsAddress('nosuchname.eth')).toEqual({ status: 'not-found' });
  });

  it('an RPC error settles as failed (retryable), not not-found', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWithGetEnsAddress(vi.fn().mockRejectedValue(new Error('resolver down'))),
    );

    expect(await resolveEnsAddress('vitalik.eth')).toEqual({ status: 'failed' });
  });

  it('client construction failure also settles as failed', async () => {
    mockedCreateRpcClient.mockRejectedValue(new Error('no mainnet RPC'));

    expect(await resolveEnsAddress('vitalik.eth')).toEqual({ status: 'failed' });
  });
});

describe('useEnsName', () => {
  beforeEach(() => {
    clearAllCaches();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearAllCaches();
  });

  it('starts in the initial-load state and settles the resolved name', async () => {
    const getEnsName = vi.fn().mockResolvedValue('vitalik.eth');
    mockedCreateRpcClient.mockResolvedValue(clientWith(getEnsName));

    const { result } = renderHook(() => useEnsName(testAddress, 1));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe('vitalik.eth');
    expect(getEnsName).toHaveBeenCalledWith({ address: testAddress });
  });

  it('resolves against mainnet regardless of the viewing chain', async () => {
    const getEnsName = vi.fn().mockResolvedValue(null);
    mockedCreateRpcClient.mockResolvedValue(clientWith(getEnsName));

    const { result } = renderHook(() => useEnsName(testAddress, 137));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(mockedCreateRpcClient).toHaveBeenCalledWith(1);
    expect(mockedCreateRpcClient).not.toHaveBeenCalledWith(137);
  });

  it('unregistered reverse record settles as null, not an error', async () => {
    const getEnsName = vi.fn().mockResolvedValue(null);
    mockedCreateRpcClient.mockResolvedValue(clientWith(getEnsName));

    const { result } = renderHook(() => useEnsName(testAddress, 1));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('RPC failure settles as null — the hook never throws', async () => {
    const getEnsName = vi.fn().mockRejectedValue(new Error('ENS resolver down'));
    mockedCreateRpcClient.mockResolvedValue(clientWith(getEnsName));

    const { result } = renderHook(() => useEnsName(testAddress, 1));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('client construction failure also settles as null', async () => {
    mockedCreateRpcClient.mockRejectedValue(new Error('no mainnet RPC'));

    const { result } = renderHook(() => useEnsName(testAddress, 1));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
  });

  it('a gated key (no address) never touches the RPC and reads as null', async () => {
    const { result } = renderHook(() => useEnsName(undefined, 1));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(mockedCreateRpcClient).not.toHaveBeenCalled();
  });
});
