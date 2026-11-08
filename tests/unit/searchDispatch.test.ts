// Shared search-dispatch core contract: the one pipeline both search
// surfaces (topbar box and Search page) dispatch through. These tests pin
// the classification→navigation table (address deep-link, verified
// block/hash, free text to the Search view), the ENS destination choice
// (Ethereum primary, viewing chain as alternate only when it differs),
// and the search-history recording semantics — click time for queries
// whose landing chain is known up front, landing time once a chain is
// verified, never for free text or unresolved ENS names. History is
// asserted through the real localStorage-backed service (the core is its
// only writer); the network edges (per-chain search, ENS RPC, chain RPC
// fallback) are stubbed.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  openEnsSearchDestination,
  recordSearchAtClick,
  recordSearchLanding,
  resolveEnsForSearch,
  runSearchDispatch,
  type SearchDispatchPorts,
  type SearchNotice,
} from '@/services/searchDispatch';
import { SEARCH_HISTORY_STORAGE_KEY } from '@/services/searchHistory';
import { ApiError } from '@/util/apiError';

const { mockFetchChainSearch, mockResolveEnsAddress, mockCreateRpcClient } = vi.hoisted(() => ({
  mockFetchChainSearch: vi.fn(),
  mockResolveEnsAddress: vi.fn(),
  mockCreateRpcClient: vi.fn(),
}));

vi.mock('@/services/search', () => ({
  fetchChainSearch: mockFetchChainSearch,
}));

// Only the RPC-backed resolution is stubbed; the pure destination
// decision stays the real one.
vi.mock('@/services/ensForward', async importOriginal => {
  const actual = await importOriginal<typeof import('@/services/ensForward')>();
  return { ...actual, resolveEnsAddress: mockResolveEnsAddress };
});

// The offline fallback's direct chain probes; the real util/http
// isBackendUnreachable stays in play (a pure predicate over ApiError).
vi.mock('@/utils/realTimeData', () => ({
  createRpcClient: mockCreateRpcClient,
}));

const VITALIK = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';
const TX_HASH = '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060';
const OTHER_HASH = `0x${'ab'.repeat(32)}`;

const storedHistory = (): Array<{ query: string; chainId?: number }> =>
  JSON.parse(localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY) ?? '[]');

// Runs one dispatch with recording ports and returns the spies for
// assertions (navigation targets, notices, history refreshes).
const dispatch = (rawQuery: string, chainId = 137) => {
  const navigate = vi.fn();
  const onNotice = vi.fn();
  const onHistory = vi.fn();
  const ports: SearchDispatchPorts = { navigate, onNotice, onHistory };
  return {
    navigate,
    onNotice,
    onHistory,
    run: () => runSearchDispatch(rawQuery, chainId, ports),
  };
};

describe('runSearchDispatch classification → navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  });

  it('deep-links an address straight to the chain page without any endpoint call', async () => {
    const d = dispatch(VITALIK, 137);

    await d.run();

    expect(d.navigate).toHaveBeenCalledWith(`/chain/137/address/${VITALIK}`);
    expect(mockFetchChainSearch).not.toHaveBeenCalled();
    // The landing records with the chain the address page opens on.
    expect(storedHistory()).toEqual([{ query: VITALIK, chainId: 137 }]);
    expect(d.onHistory).toHaveBeenCalledWith([{ query: VITALIK, chainId: 137 }]);
  });

  it('verifies a block number through the per-chain endpoint and navigates by the canonical number', async () => {
    mockFetchChainSearch.mockResolvedValueOnce({ found: true, type: 'block', data: { number: '42' } });
    const d = dispatch('42', 5000);

    await d.run();

    expect(mockFetchChainSearch).toHaveBeenCalledWith(5000, '42');
    // The verified payload's number (a BigInt-safe string) is canonical.
    expect(d.navigate).toHaveBeenCalledWith('/chain/5000/block/42');
    expect(storedHistory()).toEqual([{ query: '42', chainId: 5000 }]);
  });

  it('navigates a verified transaction hash to the tx page', async () => {
    mockFetchChainSearch.mockResolvedValueOnce({ found: true, type: 'transaction' });
    const d = dispatch(TX_HASH, 1);

    await d.run();

    expect(d.navigate).toHaveBeenCalledWith(`/chain/1/tx/${TX_HASH}`);
    expect(storedHistory()).toEqual([{ query: TX_HASH, chainId: 1 }]);
  });

  it('navigates a hash verified as a block by its number, never by its hash', async () => {
    mockFetchChainSearch.mockResolvedValueOnce({ found: true, type: 'block', data: { number: 42 } });
    const d = dispatch(OTHER_HASH, 1);

    await d.run();

    expect(d.navigate).toHaveBeenCalledWith('/chain/1/block/42');
    expect(storedHistory()).toEqual([{ query: OTHER_HASH, chainId: 1 }]);
  });

  it('sends free text to the Search view with the chain context and records nothing', async () => {
    const d = dispatch('uniswap', 137);

    await d.run();

    expect(d.navigate).toHaveBeenCalledWith(`/search?q=${encodeURIComponent('uniswap')}&chain=137`);
    expect(mockFetchChainSearch).not.toHaveBeenCalled();
    expect(storedHistory()).toEqual([]);
    expect(d.onHistory).not.toHaveBeenCalled();
  });

  it('reports a definitive hash miss without navigating or recording', async () => {
    mockFetchChainSearch.mockResolvedValueOnce({ found: false, degraded: false, type: 'transaction' });
    const d = dispatch(OTHER_HASH, 1);

    await d.run();

    expect(d.onNotice).toHaveBeenCalledWith({ kind: 'miss', query: OTHER_HASH });
    expect(d.navigate).not.toHaveBeenCalled();
    expect(storedHistory()).toEqual([]);
  });

  it('reports a block miss as a block-miss and never words a degraded response as one', async () => {
    mockFetchChainSearch.mockResolvedValueOnce({ found: false, degraded: false, type: 'block' });
    mockFetchChainSearch.mockResolvedValueOnce({ found: false, degraded: true, type: 'block' });

    const miss = dispatch('999999999', 1);
    await miss.run();
    expect(miss.onNotice).toHaveBeenCalledWith({ kind: 'block-miss', query: '999999999' });

    const degraded = dispatch('888888888', 1);
    await degraded.run();
    expect(degraded.onNotice).toHaveBeenCalledWith({ kind: 'failed', query: '888888888' });
  });

  it('reports a backend that answered with an error as a data-source failure, without the RPC fallback', async () => {
    mockFetchChainSearch.mockRejectedValueOnce(new ApiError('HTTP 500', 500));
    const d = dispatch('42', 1);

    await d.run();

    expect(d.onNotice).toHaveBeenCalledWith({ kind: 'failed', query: '42' });
    expect(mockCreateRpcClient).not.toHaveBeenCalled();
    expect(d.navigate).not.toHaveBeenCalled();
    expect(storedHistory()).toEqual([]);
  });

  it('confirms a block against the chain RPC when the backend is unreachable', async () => {
    mockFetchChainSearch.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockResolvedValueOnce({ getBlockNumber: () => Promise.resolve(100n) });
    const d = dispatch('42', 1);

    await d.run();

    expect(mockCreateRpcClient).toHaveBeenCalledWith(1);
    expect(d.navigate).toHaveBeenCalledWith('/chain/1/block/42');
    expect(storedHistory()).toEqual([{ query: '42', chainId: 1 }]);
    expect(d.onNotice).not.toHaveBeenCalled();
  });

  it('keeps the unreachable notice with the fallback note when the RPC check cannot confirm', async () => {
    mockFetchChainSearch.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockResolvedValueOnce({ getBlockNumber: () => Promise.resolve(10n) });
    const d = dispatch('999', 1);

    await d.run();

    expect(d.onNotice).toHaveBeenCalledWith({ kind: 'unreachable', query: '999', fallbackNote: true });
    expect(d.navigate).not.toHaveBeenCalled();
    expect(storedHistory()).toEqual([]);
  });

  it('skips the RPC fallback entirely when the chain has no usable client', async () => {
    mockFetchChainSearch.mockRejectedValueOnce(new ApiError('Network error', 0));
    mockCreateRpcClient.mockRejectedValueOnce(new Error('Unsupported chain ID: 1'));
    const d = dispatch('42', 1);

    await d.run();

    expect(d.onNotice).toHaveBeenCalledWith({ kind: 'unreachable', query: '42', fallbackNote: false });
    expect(d.navigate).not.toHaveBeenCalled();
  });
});

describe('runSearchDispatch input sanitization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  });

  it('prefixes 0x onto a bare 40-hex-digit input before classifying it as an address', async () => {
    const bare = VITALIK.slice(2);
    const d = dispatch(bare, 137);

    await d.run();

    expect(d.navigate).toHaveBeenCalledWith(`/chain/137/address/0x${bare}`);
    // The recorded entry carries the sanitized query, not the raw input.
    expect(storedHistory()).toEqual([{ query: `0x${bare}`, chainId: 137 }]);
  });

  it('trims surrounding whitespace off any query shape', async () => {
    const d = dispatch(`   ${VITALIK}   `, 137);

    await d.run();

    expect(d.navigate).toHaveBeenCalledWith(`/chain/137/address/${VITALIK}`);
  });

  it('treats junk (non-address, non-hash, non-ens) as free text for the Search view', async () => {
    const junk = '  <script>alert(1)</script>  ';
    const d = dispatch(junk, 137);

    await d.run();

    // Junk is escaped into the query param — never executed, never
    // classified as a chain entity, and recorded nowhere.
    expect(d.navigate).toHaveBeenCalledWith(
      `/search?q=${encodeURIComponent('<script>alert(1)</script>')}&chain=137`,
    );
    expect(mockFetchChainSearch).not.toHaveBeenCalled();
    expect(storedHistory()).toEqual([]);
  });
});

describe('ENS resolution and destinations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  });

  it('offers the viewing chain as the alternate destination only when it is not mainnet', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });

    const onOtherChain = await resolveEnsForSearch('vitalik.eth', 137);
    expect(onOtherChain).toEqual({
      status: 'resolved',
      address: VITALIK,
      destinations: { primaryChainId: 1, alternateChainId: 137 },
    });

    const onMainnet = await resolveEnsForSearch('vitalik.eth', 1);
    expect(onMainnet).toEqual({
      status: 'resolved',
      address: VITALIK,
      destinations: { primaryChainId: 1, alternateChainId: null },
    });

    // No viewing chain at all (unscoped search): Ethereum only.
    const unscoped = await resolveEnsForSearch('vitalik.eth', null);
    expect(unscoped).toEqual({
      status: 'resolved',
      address: VITALIK,
      destinations: { primaryChainId: 1, alternateChainId: null },
    });
  });

  it('passes the not-found / failed / no-rpc outcomes through untouched', async () => {
    mockResolveEnsAddress
      .mockResolvedValueOnce({ status: 'not-found' })
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ status: 'no-rpc' });

    expect(await resolveEnsForSearch('a.eth', 137)).toEqual({ status: 'not-found' });
    expect(await resolveEnsForSearch('a.eth', 137)).toEqual({ status: 'failed' });
    expect(await resolveEnsForSearch('a.eth', 137)).toEqual({ status: 'no-rpc' });
  });

  it('surfaces a resolved name as a destination choice without navigating or recording', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });
    const d = dispatch('vitalik.eth', 137);

    await d.run();

    expect(mockResolveEnsAddress).toHaveBeenCalledWith('vitalik.eth');
    expect(d.onNotice).toHaveBeenCalledWith({
      kind: 'ens-resolved',
      query: 'vitalik.eth',
      address: VITALIK,
      destinations: { primaryChainId: 1, alternateChainId: 137 },
    });
    expect(d.navigate).not.toHaveBeenCalled();
    expect(storedHistory()).toEqual([]);
  });

  it('offers no alternate destination in the notice when already on mainnet', async () => {
    mockResolveEnsAddress.mockResolvedValue({ status: 'resolved', address: VITALIK });
    const d = dispatch('vitalik.eth', 1);

    await d.run();

    const notice = d.onNotice.mock.calls[0][0] as SearchNotice;
    expect(notice.kind).toBe('ens-resolved');
    if (notice.kind === 'ens-resolved') {
      expect(notice.destinations).toEqual({ primaryChainId: 1, alternateChainId: null });
    }
  });

  it('reports not-found definitively and both RPC failures as retryable', async () => {
    mockResolveEnsAddress
      .mockResolvedValueOnce({ status: 'not-found' })
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ status: 'no-rpc' });

    const notFound = dispatch('nosuchname.eth', 1);
    await notFound.run();
    expect(notFound.onNotice).toHaveBeenCalledWith({ kind: 'ens-not-found', query: 'nosuchname.eth' });

    const rpcDown = dispatch('vitalik.eth', 1);
    await rpcDown.run();
    expect(rpcDown.onNotice).toHaveBeenCalledWith({ kind: 'ens-failed', query: 'vitalik.eth' });

    // The header folds a missing Ethereum RPC endpoint into the retryable
    // failure notice (the Search page presents it distinctly itself).
    const noRpc = dispatch('vitalik.eth', 1);
    await noRpc.run();
    expect(noRpc.onNotice).toHaveBeenCalledWith({ kind: 'ens-failed', query: 'vitalik.eth' });

    expect(storedHistory()).toEqual([]);
  });

  it('records the opened destination — never a default, never the search chain', () => {
    const navigate = vi.fn();

    const history = openEnsSearchDestination({ name: 'vitalik.eth', address: VITALIK }, 137, navigate);

    expect(navigate).toHaveBeenCalledWith(`/chain/137/address/${VITALIK}`);
    expect(storedHistory()).toEqual([{ query: 'vitalik.eth', chainId: 137 }]);
    expect(history).toEqual([{ query: 'vitalik.eth', chainId: 137 }]);
  });
});

describe('search-history recording semantics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem(SEARCH_HISTORY_STORAGE_KEY);
  });

  it('records at click time with the landing chain for queries whose destination is known up front', () => {
    // Each call returns the newest-first list the dropdown renders (the
    // full post-record history, not just the new entry).
    expect(recordSearchAtClick(VITALIK, 137)).toEqual([{ query: VITALIK, chainId: 137 }]);
    expect(recordSearchAtClick(TX_HASH, 1)).toEqual([
      { query: TX_HASH, chainId: 1 },
      { query: VITALIK, chainId: 137 },
    ]);
    expect(recordSearchAtClick('42', 5000)).toEqual([
      { query: '42', chainId: 5000 },
      { query: TX_HASH, chainId: 1 },
      { query: VITALIK, chainId: 137 },
    ]);

    expect(storedHistory()).toEqual([
      { query: '42', chainId: 5000 },
      { query: TX_HASH, chainId: 1 },
      { query: VITALIK, chainId: 137 },
    ]);
  });

  it('sanitizes the query before the click-time record', () => {
    const bare = TX_HASH.slice(2);

    recordSearchAtClick(`  ${bare}  `, 137);

    expect(storedHistory()).toEqual([{ query: TX_HASH, chainId: 137 }]);
  });

  it('records nothing at click time for free text or ENS names', () => {
    expect(recordSearchAtClick('uniswap', 137)).toBeNull();
    expect(recordSearchAtClick('vitalik.eth', 137)).toBeNull();
    expect(storedHistory()).toEqual([]);
  });

  it('records at landing time with the chain the search actually landed on', () => {
    recordSearchLanding('uniswap', 137);

    expect(storedHistory()).toEqual([{ query: 'uniswap', chainId: 137 }]);

    // A re-run on another chain replaces the entry and moves it to the
    // front — cross-chain hunting leaves one entry per query.
    recordSearchLanding('uniswap', 1);
    expect(storedHistory()).toEqual([{ query: 'uniswap', chainId: 1 }]);
  });
});
