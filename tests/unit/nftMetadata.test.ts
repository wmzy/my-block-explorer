// NFT-metadata service tests: {id} substitution, IPFS gateway rewriting,
// field picking, gateway preference persistence, and the batch resolver's
// honesty split (definitive answers cached for the TTL, transport
// failures uncached), in-flight dedupe, and the useNftMetadata hook's
// digest stability. The network edges — the viem client from
// utils/realTimeData and global fetch — are mocked; the service code
// under test is real. Zero network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

import {
  DEFAULT_IPFS_GATEWAY,
  IPFS_GATEWAY_STORAGE_KEY,
  NFT_METADATA_CACHE_TTL_MS,
  fetchNftMetadataBatch,
  getIpfsGateway,
  isContractRevertError,
  normalizeIpfsGateway,
  nftMetadataKey,
  pickNftMetadataFields,
  resetNftMetadataCacheForTests,
  resolveIpfsUri,
  setIpfsGateway,
  substituteUriId,
  useNftMetadata,
  type NftMetadataItem,
  type NftMetadataOutcome,
  type NftUriReader,
  type NftJsonFetcher,
} from '@/services/nftMetadata';
import { createRpcClient } from '@/utils/realTimeData';

vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: vi.fn(),
}));

const CONTRACT = '0xBB00000000000000000000000000000000000001';
const KEY = nftMetadataKey(CONTRACT, '15');
const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const CIDV1 = 'bafkreia1b2c3d4e5f6g7h8i9j0';
const GATEWAY = 'https://gw.example.com';
const HEX_15 = `${'0'.repeat(63)}f`;
const HEX_0 = '0'.repeat(64);

const item721 = (tokenId = '15'): NftMetadataItem => ({
  contract: CONTRACT,
  tokenId,
  standard: 'erc721',
});
const item1155 = (tokenId = '15'): NftMetadataItem => ({
  contract: CONTRACT,
  tokenId,
  standard: 'erc1155',
});

const readUri = vi.fn<NftUriReader>();
const fetchJson = vi.fn<NftJsonFetcher>();
const readContract = vi.fn<
  (args: Record<string, unknown>) => Promise<unknown>
>();

beforeEach(() => {
  vi.clearAllMocks();
  resetNftMetadataCacheForTests();
  localStorage.clear();
  readUri.mockReset();
  fetchJson.mockReset();
  readContract.mockReset();
  vi.mocked(createRpcClient).mockReset();
  vi.mocked(global.fetch).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('substituteUriId', () => {
  it('replaces {id} with the 64-char zero-padded lowercase hex', () => {
    expect(substituteUriId('https://meta.example/t/{id}.json', '15')).toBe(
      `https://meta.example/t/${HEX_15}.json`,
    );
    expect(HEX_15).toHaveLength(64);
    expect(substituteUriId('ipfs://x/{id}', '0')).toBe(`ipfs://x/${HEX_0}`);
  });

  it('returns a URI without {id} unchanged', () => {
    expect(substituteUriId(`ipfs://${CID}/15.json`, '15')).toBe(
      `ipfs://${CID}/15.json`,
    );
    // Even with an unparseable id: no placeholder means nothing to break.
    expect(substituteUriId('https://meta.example/t/15.json', 'abc')).toBe(
      'https://meta.example/t/15.json',
    );
  });

  it('returns null for {id} plus an unparseable token id', () => {
    expect(substituteUriId('https://m.example/{id}.json', 'abc')).toBeNull();
    expect(substituteUriId('https://m.example/{id}.json', '-1')).toBeNull();
    expect(substituteUriId('https://m.example/{id}.json', '1.5')).toBeNull();
    expect(substituteUriId('https://m.example/{id}.json', '')).toBeNull();
  });
});

describe('resolveIpfsUri', () => {
  it('rewrites ipfs:// scheme URIs through the gateway, sub-path kept', () => {
    expect(resolveIpfsUri(`ipfs://${CID}`, DEFAULT_IPFS_GATEWAY)).toBe(
      `${DEFAULT_IPFS_GATEWAY}/ipfs/${CID}`,
    );
    expect(resolveIpfsUri(`ipfs://${CID}/meta.json`, DEFAULT_IPFS_GATEWAY)).toBe(
      `${DEFAULT_IPFS_GATEWAY}/ipfs/${CID}/meta.json`,
    );
    expect(resolveIpfsUri(`ipfs://${CID}`, GATEWAY)).toBe(
      `${GATEWAY}/ipfs/${CID}`,
    );
  });

  it('dedupes the ipfs://ipfs/ double-prefix form', () => {
    expect(resolveIpfsUri(`ipfs://ipfs/${CID}`, GATEWAY)).toBe(
      `${GATEWAY}/ipfs/${CID}`,
    );
  });

  it('rewrites unschemed ipfs/ and /ipfs/ path forms', () => {
    expect(resolveIpfsUri(`ipfs/${CID}`, GATEWAY)).toBe(`${GATEWAY}/ipfs/${CID}`);
    expect(resolveIpfsUri(`/ipfs/${CID}/sub/x.json`, GATEWAY)).toBe(
      `${GATEWAY}/ipfs/${CID}/sub/x.json`,
    );
  });

  it('rewrites unambiguous bare CIDs (CIDv0 and CIDv1 base32)', () => {
    expect(resolveIpfsUri(CID, GATEWAY)).toBe(`${GATEWAY}/ipfs/${CID}`);
    expect(resolveIpfsUri(CIDV1, GATEWAY)).toBe(`${GATEWAY}/ipfs/${CIDV1}`);
  });

  it('passes http(s) and data URIs through unchanged', () => {
    expect(resolveIpfsUri('https://a.example/x.json', GATEWAY)).toBe(
      'https://a.example/x.json',
    );
    expect(resolveIpfsUri('http://a.example/x.json', GATEWAY)).toBe(
      'http://a.example/x.json',
    );
    expect(resolveIpfsUri('data:application/json;base64,e30=', GATEWAY)).toBe(
      'data:application/json;base64,e30=',
    );
  });

  it('resolves garbage and CID-like-but-wrong shapes to null', () => {
    expect(resolveIpfsUri('hello world', GATEWAY)).toBeNull();
    expect(resolveIpfsUri('Qmabc', GATEWAY)).toBeNull();
    // 45 chars: one short of a CIDv0.
    expect(resolveIpfsUri(CID.slice(0, 45), GATEWAY)).toBeNull();
    // CIDv1-shaped but too short after the baf prefix.
    expect(resolveIpfsUri('bafkreia1b2', GATEWAY)).toBeNull();
    expect(resolveIpfsUri('ipfs://', GATEWAY)).toBeNull();
  });
});

describe('pickNftMetadataFields', () => {
  it('picks and trims name/description, keeping the raw image string', () => {
    expect(
      pickNftMetadataFields({
        name: ' Bayc ',
        description: ' An ape ',
        image: `ipfs://${CID}/img.png`,
      }),
    ).toEqual({
      name: 'Bayc',
      description: 'An ape',
      image: `ipfs://${CID}/img.png`,
    });
  });

  it('falls back image → image_url → image_data on the first non-empty', () => {
    expect(
      pickNftMetadataFields({ image: 'a', image_url: 'b', image_data: 'c' })
        ?.image,
    ).toBe('a');
    expect(pickNftMetadataFields({ image: '', image_url: 'b' })?.image).toBe('b');
    expect(
      pickNftMetadataFields({ image: '  ', image_url: ' ', image_data: 'c' })
        ?.image,
    ).toBe('c');
    expect(pickNftMetadataFields({})?.image).toBeNull();
  });

  it('keeps empty/whitespace/non-string fields as honest nulls', () => {
    expect(
      pickNftMetadataFields({ name: '', description: '   ', image: 42 }),
    ).toEqual({ name: null, description: null, image: null });
  });

  it('treats non-plain-object JSON as malformed (null)', () => {
    expect(pickNftMetadataFields([1, 2])).toBeNull();
    expect(pickNftMetadataFields('name')).toBeNull();
    expect(pickNftMetadataFields(null)).toBeNull();
    expect(pickNftMetadataFields(5)).toBeNull();
  });
});

describe('IPFS gateway preference', () => {
  it('normalizes gateway input: trim, strip all trailing slashes, scheme', () => {
    expect(normalizeIpfsGateway('https://x.com/')).toBe('https://x.com');
    expect(normalizeIpfsGateway(' x.com ')).toBe('https://x.com');
    expect(normalizeIpfsGateway('https://x.com//')).toBe('https://x.com');
    expect(normalizeIpfsGateway('')).toBe('');
    expect(normalizeIpfsGateway('   ')).toBe('');
    expect(normalizeIpfsGateway('///')).toBe('');
  });

  it('defaults the gateway when the stored value is unset or empty', () => {
    expect(getIpfsGateway()).toBe(DEFAULT_IPFS_GATEWAY);
    localStorage.setItem(IPFS_GATEWAY_STORAGE_KEY, '   ');
    expect(getIpfsGateway()).toBe(DEFAULT_IPFS_GATEWAY);
  });

  it('persists a normalized gateway and reads it back', () => {
    setIpfsGateway(GATEWAY);
    expect(localStorage.getItem(IPFS_GATEWAY_STORAGE_KEY)).toBe(GATEWAY);
    expect(getIpfsGateway()).toBe(GATEWAY);

    setIpfsGateway(' gw2.example.org/');
    expect(localStorage.getItem(IPFS_GATEWAY_STORAGE_KEY)).toBe(
      'https://gw2.example.org',
    );
  });

  it('clearing the gateway removes the stored key and restores the default', () => {
    setIpfsGateway(GATEWAY);
    setIpfsGateway('');
    expect(localStorage.getItem(IPFS_GATEWAY_STORAGE_KEY)).toBeNull();
    expect(getIpfsGateway()).toBe(DEFAULT_IPFS_GATEWAY);
  });
});

describe('isContractRevertError', () => {
  it('matches revert markers anywhere in the cause chain', () => {
    expect(isContractRevertError(new Error('execution reverted'))).toBe(true);
    const wrapped = new Error('request failed', {
      cause: new Error('VM Exception: reverted'),
    });
    expect(isContractRevertError(wrapped)).toBe(true);
    expect(isContractRevertError(new Error('RPC down'))).toBe(false);
    // Non-Error input falls back to String() (gasHistory errorChainText).
    expect(isContractRevertError('execution reverted')).toBe(true);
    expect(isContractRevertError('RPC down')).toBe(false);
  });
});

describe('fetchNftMetadataBatch', () => {
  it('resolves an ERC-721 item through the gateway and rewrites its image', async () => {
    readUri.mockResolvedValue(`ipfs://${CID}/meta.json`);
    fetchJson.mockResolvedValue({
      name: 'Bayc',
      description: 'An ape',
      image: `ipfs://${CID}/img.png`,
    });

    const out = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(readUri).toHaveBeenCalledWith({
      address: CONTRACT,
      functionName: 'tokenURI',
      tokenId: 15n,
    });
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledWith(
      `${DEFAULT_IPFS_GATEWAY}/ipfs/${CID}/meta.json`,
    );
    expect(out.get(KEY)).toEqual({
      status: 'ok',
      name: 'Bayc',
      description: 'An ape',
      image: `${DEFAULT_IPFS_GATEWAY}/ipfs/${CID}/img.png`,
    });
  });

  it('calls uri(uint256) for ERC-1155 and substitutes {id} in the fetched URL', async () => {
    readUri.mockResolvedValue('https://meta.example/t/{id}.json');
    fetchJson.mockResolvedValue({ name: 'Edition 15' });

    const out = await fetchNftMetadataBatch(1, [item1155()], {
      readUri,
      fetchJson,
    });

    expect(readUri).toHaveBeenCalledWith({
      address: CONTRACT,
      functionName: 'uri',
      tokenId: 15n,
    });
    expect(fetchJson).toHaveBeenCalledWith(
      `https://meta.example/t/${HEX_15}.json`,
    );
    // Sparse metadata (missing image/description) is still real metadata.
    expect(out.get(KEY)).toEqual({
      status: 'ok',
      name: 'Edition 15',
      image: null,
      description: null,
    });
  });

  it('caches a contract revert as none without refetching', async () => {
    readUri.mockRejectedValue(
      new Error('VM Exception while processing transaction: reverted'),
    );

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    const second = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(first.get(KEY)).toEqual({ status: 'none' });
    expect(second.get(KEY)).toEqual({ status: 'none' });
    expect(readUri).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('treats a non-revert readUri failure as retryable unavailable', async () => {
    readUri
      .mockRejectedValueOnce(new Error('RPC down'))
      .mockResolvedValueOnce('https://meta.example/x.json');
    fetchJson.mockResolvedValue({ name: 'ok' });

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    const second = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(first.get(KEY)).toEqual({ status: 'unavailable' });
    expect(second.get(KEY)?.status).toBe('ok');
    expect(readUri).toHaveBeenCalledTimes(2);
  });

  it('treats a fetchJson rejection as retryable unavailable', async () => {
    readUri.mockResolvedValue('https://meta.example/x.json');
    fetchJson
      .mockRejectedValueOnce(new Error('HTTP 500'))
      .mockResolvedValueOnce({ name: 'ok' });

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    const second = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(first.get(KEY)).toEqual({ status: 'unavailable' });
    expect(second.get(KEY)?.status).toBe('ok');
    expect(readUri).toHaveBeenCalledTimes(2);
  });

  it('treats non-object JSON as retryable unavailable', async () => {
    readUri.mockResolvedValue('https://meta.example/x.json');
    fetchJson.mockResolvedValueOnce([1, 2]).mockResolvedValueOnce({ name: 'ok' });

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    const second = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(first.get(KEY)).toEqual({ status: 'unavailable' });
    expect(second.get(KEY)?.status).toBe('ok');
  });

  it('treats a non-string uri return as definitive none, cached', async () => {
    readUri.mockResolvedValue(123n);

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(first.get(KEY)).toEqual({ status: 'none' });
    expect(readUri).toHaveBeenCalledTimes(1);
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it('treats a data: metadata URI as definitive none without fetching', async () => {
    readUri.mockResolvedValue('data:application/json;base64,e30=');

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(first.get(KEY)).toEqual({ status: 'none' });
    expect(fetchJson).not.toHaveBeenCalled();
    expect(readUri).toHaveBeenCalledTimes(1);
  });

  it('treats an unparseable token id as definitive none with no contract call', async () => {
    const key = nftMetadataKey(CONTRACT, 'not-a-number');

    const first = await fetchNftMetadataBatch(1, [item721('not-a-number')], {
      readUri,
      fetchJson,
    });
    await fetchNftMetadataBatch(1, [item721('not-a-number')], {
      readUri,
      fetchJson,
    });

    expect(first.get(key)).toEqual({ status: 'none' });
    expect(readUri).not.toHaveBeenCalled();
  });

  it('serves a second fetch within the TTL from cache', async () => {
    readUri.mockResolvedValue(`ipfs://${CID}/meta.json`);
    fetchJson.mockResolvedValue({ name: 'Bayc' });

    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(readUri).toHaveBeenCalledTimes(1);
    expect(fetchJson).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cache TTL expires', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    readUri.mockResolvedValue('https://meta.example/x.json');
    fetchJson.mockResolvedValue({ name: 'Bayc' });

    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    vi.setSystemTime(new Date(Date.now() + NFT_METADATA_CACHE_TTL_MS + 1000));
    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(readUri).toHaveBeenCalledTimes(2);
  });

  it('keys the cache by gateway: switching the preference refetches', async () => {
    setIpfsGateway(GATEWAY);
    readUri.mockResolvedValue(`ipfs://${CID}/meta.json`);
    fetchJson.mockResolvedValue({ name: 'Bayc' });

    const first = await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });
    expect(fetchJson).toHaveBeenCalledWith(`${GATEWAY}/ipfs/${CID}/meta.json`);

    setIpfsGateway(DEFAULT_IPFS_GATEWAY);
    await fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson });

    expect(readUri).toHaveBeenCalledTimes(2);
    expect(first.get(KEY)?.status).toBe('ok');
  });

  it('shares one resolution between concurrent batches for the same item', async () => {
    readUri.mockResolvedValue('https://meta.example/x.json');
    fetchJson.mockResolvedValue({ name: 'Bayc' });

    const [a, b] = await Promise.all([
      fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson }),
      fetchNftMetadataBatch(1, [item721()], { readUri, fetchJson }),
    ]);

    expect(readUri).toHaveBeenCalledTimes(1);
    expect(a.get(KEY)).toEqual(b.get(KEY));
  });

  it('collapses duplicate items into a single map entry', async () => {
    readUri.mockResolvedValue('https://meta.example/x.json');
    fetchJson.mockResolvedValue({ name: 'Bayc' });

    const out = await fetchNftMetadataBatch(1, [item721(), item721()], {
      readUri,
      fetchJson,
    });

    expect(out.size).toBe(1);
    expect(readUri).toHaveBeenCalledTimes(1);
  });

  it('reads through the default viem client, branching per standard', async () => {
    vi.mocked(createRpcClient).mockResolvedValue({ readContract } as never);
    readContract.mockResolvedValue('https://meta.example/x.json');
    fetchJson.mockResolvedValue({ name: 'N' });

    const out = await fetchNftMetadataBatch(1, [item721()], { fetchJson });

    expect(createRpcClient).toHaveBeenCalledTimes(1);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CONTRACT,
        functionName: 'tokenURI',
        args: [15n],
      }),
    );
    expect(out.get(KEY)).toEqual({
      status: 'ok',
      name: 'N',
      image: null,
      description: null,
    });
  });

  it('resolves every uncached item as unavailable when the client cannot be created', async () => {
    vi.mocked(createRpcClient).mockRejectedValue(new Error('unknown chain'));

    const other = nftMetadataKey('0xcc00000000000000000000000000000000000001', '7');
    const out = await fetchNftMetadataBatch(1, [
      item721(),
      { contract: '0xcc00000000000000000000000000000000000001', tokenId: '7', standard: 'erc721' },
    ]);

    expect(out.get(KEY)).toEqual({ status: 'unavailable' });
    expect(out.get(other)).toEqual({ status: 'unavailable' });
    // One createRpcClient per batch invocation, shared across its items.
    expect(createRpcClient).toHaveBeenCalledTimes(1);

    // Unavailable is uncached: the next batch retries the client.
    await fetchNftMetadataBatch(1, [item721()]);
    expect(createRpcClient).toHaveBeenCalledTimes(2);
  });

  it('returns an empty map without touching the network for chainId <= 0', async () => {
    const out = await fetchNftMetadataBatch(0, [item721()]);

    expect(out.size).toBe(0);
    expect(createRpcClient).not.toHaveBeenCalled();
    expect(readUri).not.toHaveBeenCalled();
  });

  it('returns an empty map without touching the network for an empty item list', async () => {
    const out = await fetchNftMetadataBatch(1, []);

    expect(out.size).toBe(0);
    expect(createRpcClient).not.toHaveBeenCalled();
    expect(readUri).not.toHaveBeenCalled();
  });
});

describe('useNftMetadata', () => {
  const jsonResponse = { name: 'Hook Ape', image: `ipfs://${CID}/img.png` };

  const mockDefaultStack = (): void => {
    vi.mocked(createRpcClient).mockResolvedValue({ readContract } as never);
    readContract.mockResolvedValue(`ipfs://${CID}/meta.json`);
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: async () => jsonResponse,
    } as unknown as Response);
  };

  it('returns a defined empty Map for an empty item list, with no network access', () => {
    const { result } = renderHook(() => useNftMetadata(1, []));

    expect(result.current).toBeDefined();
    expect(result.current?.size).toBe(0);
    expect(createRpcClient).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('loads outcomes keyed by nftMetadataKey through the default adapters', async () => {
    mockDefaultStack();

    const { result } = renderHook(() => useNftMetadata(1, [item721()]));

    // Undefined while the batch is in flight.
    expect(result.current).toBeUndefined();

    await waitFor(() => expect(result.current).toBeDefined());
    const outcome: NftMetadataOutcome | undefined = result.current?.get(KEY);
    expect(outcome).toEqual({
      status: 'ok',
      name: 'Hook Ape',
      description: null,
      image: `${DEFAULT_IPFS_GATEWAY}/ipfs/${CID}/img.png`,
    });
    expect(global.fetch).toHaveBeenCalledWith(
      `${DEFAULT_IPFS_GATEWAY}/ipfs/${CID}/meta.json`,
      expect.anything(),
    );
  });

  it('does not refetch when the parent passes a fresh but equal item array', async () => {
    mockDefaultStack();

    const { result, rerender } = renderHook(
      ({ items }) => useNftMetadata(1, items),
      {
        initialProps: { items: [item721()] },
      },
    );

    await waitFor(() => expect(result.current).toBeDefined());
    expect(readContract).toHaveBeenCalledTimes(1);

    // Same content, new array identity — the digest key is unchanged.
    rerender({ items: [item721()] });
    expect(readContract).toHaveBeenCalledTimes(1);
  });

  it('refetches when the gateway preference changes', async () => {
    mockDefaultStack();

    const { result, rerender } = renderHook(
      ({ items }) => useNftMetadata(1, items),
      {
        initialProps: { items: [item721()] },
      },
    );

    await waitFor(() => expect(result.current).toBeDefined());
    expect(readContract).toHaveBeenCalledTimes(1);

    setIpfsGateway(GATEWAY);
    rerender({ items: [item721()] });
    await waitFor(() => expect(readContract).toHaveBeenCalledTimes(2));
  });
});
