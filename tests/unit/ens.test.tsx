// Observable behavior of the ENS reverse-resolution service: mainnet-pinned
// lookups regardless of the viewing chain, gated invalid args, and the
// never-throw contract — unresolved names and RPC failures both settle as
// data null. A reverse record only displays after its forward record
// points back at the same address, so spoofed reverse records settle as
// null too.
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

// A fixture with hex letters, so case-insensitive address matching is
// observable (the all-digit fixture cannot show it).
const letteredAddress = '0xAbCdEf0123456789AbCdEf0123456789AbCdEf01';

/** Partial client carrying the actions under test. The legacy single-action
 * form keeps the hook suite's call sites untouched; an omitted forward
 * resolver defaults to a record pointing back at the test address, so
 * reverse-only clients still ride a verified round-trip. */
const clientWith = (
  actions:
    | { getEnsName?: PublicClient['getEnsName']; getEnsAddress?: PublicClient['getEnsAddress'] }
    | PublicClient['getEnsName'],
): PublicClient => {
  const { getEnsName, getEnsAddress } =
    typeof actions === 'function' ? { getEnsName: actions, getEnsAddress: undefined } : actions;
  return {
    getEnsName,
    getEnsAddress: getEnsAddress ?? vi.fn().mockResolvedValue(testAddress),
  } as unknown as PublicClient;
};

describe('fetchEnsName', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalid args resolve undefined without touching the RPC', async () => {
    expect(await fetchEnsName(undefined)).toBeUndefined();
    expect(await fetchEnsName('')).toBeUndefined();
    expect(mockedCreateRpcClient).not.toHaveBeenCalled();
  });

  // A dead reverse resolver gives no answer to trust, and with no name in
  // hand there is nothing to verify — no speculative forward lookup.
  it('a reverse-lookup RPC failure settles as null, without a forward lookup', async () => {
    const getEnsAddress = vi.fn();
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({
        getEnsName: vi.fn().mockRejectedValue(new Error('reverse resolver down')),
        getEnsAddress,
      }),
    );

    expect(await fetchEnsName(testAddress)).toBeNull();
    expect(getEnsAddress).not.toHaveBeenCalled();
  });

  // No reverse record means no candidate name; the forward record must not
  // be consulted speculatively.
  it('an address with no reverse record settles as null, without a forward lookup', async () => {
    const getEnsAddress = vi.fn();
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({ getEnsName: vi.fn().mockResolvedValue(null), getEnsAddress }),
    );

    expect(await fetchEnsName(testAddress)).toBeNull();
    expect(getEnsAddress).not.toHaveBeenCalled();
  });

  // The verified happy path: the name's forward record points back at the
  // queried address, with reverse and forward reusing one mainnet client.
  it('a name whose forward record points back at the address is returned', async () => {
    const getEnsAddress = vi.fn().mockResolvedValue(testAddress);
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({ getEnsName: vi.fn().mockResolvedValue('vitalik.eth'), getEnsAddress }),
    );

    expect(await fetchEnsName(testAddress)).toBe('vitalik.eth');
    expect(getEnsAddress).toHaveBeenCalledWith({ name: 'vitalik.eth' });
    expect(mockedCreateRpcClient).toHaveBeenCalledTimes(1);
    expect(mockedCreateRpcClient).toHaveBeenCalledWith(1);
  });

  // Forward matching is case-insensitive: a checksummed address is still
  // the queried one, differing only in hex-letter case.
  it('a forward record in different letter case still verifies the name', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({
        getEnsName: vi.fn().mockResolvedValue('letters.eth'),
        getEnsAddress: vi.fn().mockResolvedValue(letteredAddress.toLowerCase()),
      }),
    );

    expect(await fetchEnsName(letteredAddress)).toBe('letters.eth');
  });

  // If the forward check itself fails there is no way to verify the name —
  // showing it would reintroduce the spoofing the check exists to block.
  it('a forward-lookup RPC failure settles as null, not the unverified name', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({
        getEnsName: vi.fn().mockResolvedValue('vitalik.eth'),
        getEnsAddress: vi.fn().mockRejectedValue(new Error('forward resolver down')),
      }),
    );

    expect(await fetchEnsName(testAddress)).toBeNull();
  });

  // A name with no live forward record cannot be tied to the address.
  it('a name without a forward record settles as null', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({
        getEnsName: vi.fn().mockResolvedValue('expired.eth'),
        getEnsAddress: vi.fn().mockResolvedValue(null),
      }),
    );

    expect(await fetchEnsName(testAddress)).toBeNull();
  });

  // The spoofing core case: a forged reverse record claiming a name owned
  // by a different address must not display just because the reverse
  // lookup answered.
  it('a name owned by a different address settles as null (blocks spoofed reverse records)', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWith({
        getEnsName: vi.fn().mockResolvedValue('vitalik.eth'),
        getEnsAddress: vi.fn().mockResolvedValue('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
      }),
    );

    expect(await fetchEnsName(testAddress)).toBeNull();
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
