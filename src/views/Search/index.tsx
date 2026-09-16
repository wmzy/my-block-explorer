import { useEffect, useRef, useState } from 'react';
import { css } from '@linaria/core';
import { z } from 'zod';
import { Input } from 'haze-ui';
import { navigate } from '@native-router/core';
import { useRouter, useSearch } from '@native-router/react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ErrorState } from '@/components/ui/ErrorState';
import { getChainName } from '@/config/chains';
import { fetchChainSearch, fetchSearch, type SearchResult } from '@/services/search';
import { detectSearchType, sanitizeInput } from '@/utils/validation';
import type { Block, Transaction, AddressInfo } from '@/types/blockchain';

const searchSchema = z.object({
  q: z.string().optional().catch(undefined),
});

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

export default function Search() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { q: qParam } = useSearch(searchSchema);
  const deepLinkedRef = useRef(false);

  const handleSearch = async (searchQuery = query) => {
    if (!searchQuery.trim()) return;

    const sanitized = sanitizeInput(searchQuery.trim());
    const searchType = detectSearchType(sanitized);

    if (searchType === 'unknown') {
      setError(
        'Invalid search format. Please enter a valid address, transaction hash, or block number.',
      );
      return;
    }

    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      const searchResult = await fetchSearch(sanitized);
      if (!searchResult) return;

      setResult(searchResult);

      if (searchResult.found && searchResult.type === 'address' && searchResult.data) {
        const data = searchResult.data as AddressInfo;
        navigate(router, `/chain/${data.chainId}/address/${data.address}`).catch(
          () => undefined,
        );
      } else if (searchResult.found && searchResult.type === 'transaction' && searchResult.data) {
        const data = searchResult.data as Transaction;
        navigate(router, `/chain/${data.chainId}/tx/${data.hash}`).catch(() => undefined);
      } else if (searchResult.found && searchResult.type === 'block' && searchResult.data) {
        const data = searchResult.data as Block;
        navigate(router, `/chain/${data.chainId}/block/${data.number}`).catch(() => undefined);
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
        setError(`No results found on ${getChainName(selectedChainId)}`);
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

      {result && !result.found && !result.needsChain && (
        <div className={resultCard}>
          <ErrorState message={`No results found for "${result.query ?? query}"`} />
          {result.suggestions && result.suggestions.length > 0 && (
            <div className={suggestionList}>
              {result.suggestions.map(suggestion => (
                <div key={suggestion}>{suggestion}</div>
              ))}
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

            <div className={chainSelector}>
              {result.supportedChains.map(chain => (
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
