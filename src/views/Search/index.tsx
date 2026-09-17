import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { css } from '@linaria/core';
import { z } from 'zod';
import { Alert, Input } from 'haze-ui';
import { navigate } from '@native-router/core';
import { useRouter, useSearch, TypedLink } from '@native-router/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { getChainName, isChainSupported, POPULAR_CHAINS, searchChains } from '@/config/chains';
import { fetchChainSearch, fetchSearch, type SearchResult } from '@/services/search';
import { detectSearchType, sanitizeInput } from '@/utils/validation';
import { createRpcClient } from '@/utils/realTimeData';
import { formatAddress } from '@/utils/format';
import { LAST_CHAIN_STORAGE_KEY } from '@/views/Home/Landing';
import type { Block, Transaction, AddressInfo } from '@/types/blockchain';

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
  // Chain context the header search forwards (the chain the user was on
  // when searching); the global endpoint echoes what it actually searched.
  chain: z.coerce.number().int().positive().optional().catch(undefined),
});

// The chain the Landing view remembered as "last viewed" (same storage
// key, same validity rule). Mirrors resolveLandingChainPath's parsing so
// the search context and the landing target always agree.
const readRememberedChainId = (): number | undefined => {
  const raw = localStorage.getItem(LAST_CHAIN_STORAGE_KEY);
  const remembered = raw !== null ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isInteger(remembered) && isChainSupported(remembered) ? remembered : undefined;
};

// How long the "Resolved <name> → <address>" confirmation stays up before
// the view navigates to the address page.
const ENS_REDIRECT_DELAY_MS = 1200;

const searchContainer = css`
  max-width: 600px;
  margin: 0 auto;
  padding: var(--haze-space-5);
`;

const searchForm = css`
  display: flex;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-6);
`;

const examples = css`
  margin-top: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const exampleBadges = css`
  margin-top: var(--haze-space-2);
  display: flex;
  flex-wrap: wrap;
  gap: var(--haze-space-2);
`;

const resultCard = css`
  margin-top: var(--haze-space-6);
`;

const chainSelector = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--haze-space-3);
  margin-top: var(--haze-space-4);
`;

const chainOption = css`
  padding: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;

  &:hover {
    border-color: var(--haze-color-primary);
    background-color: var(--haze-color-bg-subtle);
  }
`;

const chainName = css`
  font-weight: var(--haze-weight-medium);
  margin-bottom: var(--haze-space-1);
`;

const chainId = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
`;

const suggestionList = css`
  margin-top: var(--haze-space-3);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const suggestionLink = css`
  color: var(--haze-color-primary);
  text-decoration: none;
  font-family: var(--haze-font-mono);
  overflow-wrap: anywhere;
  width: fit-content;

  &:hover {
    text-decoration: underline;
  }
`;

const chainFilterInput = css`
  margin-bottom: var(--haze-space-3);
`;

const chainToggle = css`
  margin-top: var(--haze-space-4);
  width: 100%;
`;

const exampleQueries = [
  {
    label: 'Address',
    value: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    type: 'address',
  },
  {
    label: 'Tx Hash',
    value: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060',
    type: 'hash',
  },
  { label: 'Block Number', value: '18000000', type: 'block' },
];

// Renders backend suggestion lines, turning the actionable ones into
// TypedLinks on the searched chain's pages: 'Latest block number: N' links
// to block N, bare 0x-hex lines after 'Recent transactions:' link to the
// transaction page, and 'Latest block hash: …' reuses the block number from
// its sibling line (the block detail route only accepts numbers). Every
// other line stays plain text.
const renderSuggestions = (suggestions: string[], chainId: number): ReactNode[] => {
  let inTxSection = false;
  let latestBlockNumber: string | null = null;

  return suggestions.map((line) => {
    const blockNumberMatch = line.match(/^Latest block number:\s*(\d+)$/);
    if (blockNumberMatch) {
      latestBlockNumber = blockNumberMatch[1];
      return (
        <TypedLink
          key={line}
          to={`/chain/${chainId}/block/${blockNumberMatch[1]}`}
          className={suggestionLink}
        >
          {line}
        </TypedLink>
      );
    }

    if (/^Latest block hash:\s*0x[a-fA-F0-9]{64}$/.test(line) && latestBlockNumber !== null) {
      return (
        <TypedLink
          key={line}
          to={`/chain/${chainId}/block/${latestBlockNumber}`}
          className={suggestionLink}
        >
          {line}
        </TypedLink>
      );
    }

    if (line === 'Recent transactions:') {
      inTxSection = true;
      return <div key={line}>{line}</div>;
    }

    if (inTxSection && /^0x[a-fA-F0-9]{64}$/.test(line)) {
      return (
        <TypedLink key={line} to={`/chain/${chainId}/tx/${line}`} className={suggestionLink}>
          {line}
        </TypedLink>
      );
    }

    inTxSection = false;
    return <div key={line}>{line}</div>;
  });
};

export default function Search() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chainFilter, setChainFilter] = useState('');
  const [showAllChains, setShowAllChains] = useState(false);
  // Successful client-side ENS resolution, shown as a brief confirmation
  // before navigating to the address page.
  const [ensResolution, setEnsResolution] = useState<{ name: string; address: string } | null>(
    null,
  );
  const ensRedirectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const router = useRouter();
  const { q: qParam, chain } = useSearch(searchSchema);
  const deepLinkedRef = useRef(false);

  // A pending ENS redirect must not fire after the view unmounted.
  useEffect(
    () => () => {
      if (ensRedirectTimer.current) clearTimeout(ensRedirectTimer.current);
    },
    [],
  );

  // ENS names resolve in the browser against a mainnet client (that is
  // where the ENS registry lives); the resolved address is then viewed on
  // the current chain context. Null (unregistered name) and RPC failures
  // both surface as the same friendly message, never a raw RPC error.
  const resolveEnsName = async (name: string, chainContext?: number): Promise<void> => {
    try {
      const client = await createRpcClient(1);
      const address = await client.getEnsAddress({ name: name.toLowerCase() });
      if (!address) {
        setError(`Could not resolve ENS name "${name}"`);
        return;
      }
      setEnsResolution({ name, address });
      const targetChainId = chainContext ?? 1;
      ensRedirectTimer.current = setTimeout(() => {
        navigate(router, `/chain/${targetChainId}/address/${address}`).catch(() => undefined);
      }, ENS_REDIRECT_DELAY_MS);
    } catch {
      setError(`Could not resolve ENS name "${name}"`);
    }
  };

  const handleSearch = async (searchQuery = query) => {
    // Only truly empty input is rejected here: free text ('unknown' after
    // sanitize/detect) still goes to the global endpoint, which runs the
    // searchAll pass and answers with suggestions instead of a dead end.
    if (!searchQuery.trim()) return;

    const sanitized = sanitizeInput(searchQuery.trim());

    // Explicit chain context, always: the ?chain= param if present, else
    // the chain remembered by the Landing view, else undefined (the
    // endpoint then documents its own mainnet fallback via
    // searchedChainId).
    const chainContext = chain ?? readRememberedChainId();

    if (ensRedirectTimer.current) {
      clearTimeout(ensRedirectTimer.current);
      ensRedirectTimer.current = null;
    }

    setIsSearching(true);
    setError(null);
    setResult(null);
    setEnsResolution(null);

    try {
      // ENS names never hit the backend: detection is local and resolution
      // happens in the browser (see resolveEnsName).
      if (detectSearchType(sanitized) === 'ens') {
        await resolveEnsName(sanitized, chainContext);
        return;
      }

      const searchResult = await fetchSearch(sanitized, chainContext);
      if (!searchResult) return;

      setResult(searchResult);

      // Navigate on the chain the endpoint actually searched when it says
      // so (searchedChainId); the payload's own chainId is only a fallback.
      if (searchResult.found && searchResult.type === 'address' && searchResult.data) {
        const data = searchResult.data as AddressInfo;
        const targetChain = searchResult.searchedChainId ?? data.chainId;
        navigate(router, `/chain/${targetChain}/address/${data.address}`).catch(
          () => undefined,
        );
      } else if (searchResult.found && searchResult.type === 'transaction' && searchResult.data) {
        const data = searchResult.data as Transaction;
        const targetChain = searchResult.searchedChainId ?? data.chainId;
        navigate(router, `/chain/${targetChain}/tx/${data.hash}`).catch(() => undefined);
      } else if (searchResult.found && searchResult.type === 'block' && searchResult.data) {
        const data = searchResult.data as Block;
        const targetChain = searchResult.searchedChainId ?? data.chainId;
        navigate(router, `/chain/${targetChain}/block/${data.number}`).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  // Deep link: ?q=<query> prefills the input and runs the search once on
  // mount. handleSearch is intentionally left out of the deps — it is
  // recreated every render and re-running the search would loop.
  useEffect(() => {
    if (deepLinkedRef.current || !qParam) return;
    deepLinkedRef.current = true;
    setQuery(qParam);
    void handleSearch(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);

  const handleChainSelect = async (selectedChainId: number) => {
    if (!query.trim()) return;

    const sanitized = sanitizeInput(query.trim());
    setIsSearching(true);
    setError(null);

    try {
      const searchResult = await fetchChainSearch(selectedChainId, sanitized);
      if (!searchResult) return;

      if (!searchResult.found || !searchResult.data) {
        // A data-source error is not a definitive miss — say so instead of
        // reporting "no results".
        setError(
          searchResult.degraded
            ? 'Search failed — a data source errored. Try again.'
            : `No results found on ${getChainName(selectedChainId)}`,
        );
        return;
      }

      const chainId = searchResult.chainId ?? selectedChainId;

      if (searchResult.type === 'address') {
        navigate(router, `/chain/${chainId}/address/${sanitized}`).catch(() => undefined);
      } else if (searchResult.type === 'transaction') {
        const data = searchResult.data as Transaction;
        navigate(router, `/chain/${chainId}/tx/${data.hash}`).catch(() => undefined);
      } else if (searchResult.type === 'block') {
        // Navigate by block number — the detail route only accepts numbers,
        // and the query itself may have been a block hash.
        const data = searchResult.data as Block;
        navigate(router, `/chain/${chainId}/block/${data.number}`).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const handleExampleClick = (example: string) => {
    setQuery(example);
    handleSearch(example);
  };

  // Picker list: popular chains first (collapsed default), the full API
  // list behind the toggle, and — when a filter is typed — searchChains
  // over every supported network. searchChains matches on name/ID/symbol
  // but may return id duplicates (viem export aliases); dedupe so card
  // keys stay unique.
  const allChains = result?.supportedChains ?? [];
  const popularChainRefs = useMemo(
    () => POPULAR_CHAINS.map(c => ({ chainId: c.id, name: c.name })),
    [],
  );
  const filteredChainRefs = useMemo(() => {
    const filter = chainFilter.trim();
    if (!filter) return null;
    const seen = new Set<number>();
    return searchChains(filter)
      .filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      })
      .map(c => ({ chainId: c.id, name: c.name }));
  }, [chainFilter]);
  const visibleChains = filteredChainRefs ?? (showAllChains ? allChains : popularChainRefs);

  return (
    <div className={searchContainer}>
      <Card>
        <CardHeader>
          <CardTitle>Blockchain Search</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={e => {
              e.preventDefault();
              handleSearch();
            }}
            className={searchForm}
          >
            <Input
              placeholder="Enter address, tx hash, or block number..."
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <Button loading={isSearching} disabled={!query.trim() || isSearching}>
              Search
            </Button>
          </form>

          <div className={examples}>
            <div>Example searches:</div>
            <div className={exampleBadges}>
              {exampleQueries.map((example, index) => (
                <Badge
                  key={index}
                  variant="default"
                  onClick={() => handleExampleClick(example.value)}
                >
                  {example.label}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <ErrorState message={error} className={resultCard} />}

      {ensResolution && (
        <div className={resultCard}>
          <Alert variant="success">
            Resolved {ensResolution.name} → {formatAddress(ensResolution.address)} — opening the
            address page…
          </Alert>
        </div>
      )}

      {result && !result.found && !result.needsChain && result.degraded && (
        <div className={resultCard}>
          {/* Not-found + degraded means an upstream lookup errored: offer a
              retry instead of a definitive "No results". */}
          <ErrorState
            message="Search failed — a data source errored. Try again."
            onRetry={() => handleSearch(result.query ?? query)}
          />
        </div>
      )}

      {result && !result.found && !result.needsChain && !result.degraded && (
        <div className={resultCard}>
          <ErrorState
            message={
              result.message ?? `No results found for "${result.query ?? query}"`
            }
          />
          {result.suggestions && result.suggestions.length > 0 && (
            <div className={suggestionList}>
              {renderSuggestions(
                result.suggestions,
                result.searchedChainId ?? chain ?? readRememberedChainId() ?? 1,
              )}
            </div>
          )}
        </div>
      )}

      {result?.needsChain && result.supportedChains && (
        <Card className={resultCard}>
          <CardHeader>
            <CardTitle>Select Network</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={css`
                color: var(--haze-color-text-secondary);
                margin-bottom: var(--haze-space-4);
              `}
            >
              Please select a blockchain network to search:
            </p>

            <div className={chainFilterInput}>
              <Input
                placeholder="Filter networks by name, ID, or symbol..."
                value={chainFilter}
                onChange={e => setChainFilter(e.target.value)}
              />
            </div>

            <div className={chainSelector}>
              {visibleChains.map(chain => (
                <div
                  key={chain.chainId}
                  className={chainOption}
                  onClick={() => handleChainSelect(chain.chainId)}
                >
                  <div className={chainName}>{chain.name}</div>
                  <div className={chainId}>
                    Chain ID:
                    {chain.chainId}
                  </div>
                </div>
              ))}
            </div>

            {/* A typed filter searches every supported network directly, so
                the popular/full toggle only applies to the unfiltered view. */}
            {!chainFilter.trim() && (
              <Button
                variant="outline"
                className={chainToggle}
                onClick={() => setShowAllChains(!showAllChains)}
              >
                {showAllChains ? 'Show less' : `Show all ${allChains.length} networks`}
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
