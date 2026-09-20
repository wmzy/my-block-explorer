// resolveEnsAddress outcome split: an Ethereum RPC that never answers
// settles as 'failed' (retryable), while a client-construction failure —
// this explorer has no usable Ethereum RPC endpoint — settles as the
// distinct 'no-rpc'. Collapsing the two would put a Retry button on a
// failure no retry can cure; the UI branches on exactly this distinction.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PublicClient } from 'viem';

import { resolveEnsAddress } from '@/services/ensForward';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData');

const mockedCreateRpcClient = vi.mocked(createRpcClient);

const clientWithGetEnsAddress = (
  getEnsAddress: PublicClient['getEnsAddress'],
): PublicClient => ({ getEnsAddress }) as unknown as PublicClient;

describe('resolveEnsAddress outcome split', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('client construction failure settles as no-rpc (not retryable)', async () => {
    mockedCreateRpcClient.mockRejectedValue(new Error('no Ethereum RPC configured'));

    expect(await resolveEnsAddress('vitalik.eth')).toEqual({ status: 'no-rpc' });
  });

  it('an RPC error after construction settles as failed (retryable)', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWithGetEnsAddress(vi.fn().mockRejectedValue(new Error('resolver down'))),
    );

    expect(await resolveEnsAddress('vitalik.eth')).toEqual({ status: 'failed' });
  });

  it('a null answer still settles as not-found (definitive)', async () => {
    mockedCreateRpcClient.mockResolvedValue(
      clientWithGetEnsAddress(vi.fn().mockResolvedValue(null)),
    );

    expect(await resolveEnsAddress('nosuchname.eth')).toEqual({ status: 'not-found' });
  });

  it('never consults the RPC after construction failed', async () => {
    mockedCreateRpcClient.mockRejectedValue(new Error('no Ethereum RPC configured'));

    await resolveEnsAddress('vitalik.eth');

    // One construction attempt, and nothing else — a broken client must
    // not be dereferenced for the lookup.
    expect(mockedCreateRpcClient).toHaveBeenCalledTimes(1);
    expect(mockedCreateRpcClient).toHaveBeenCalledWith(1);
  });
});
