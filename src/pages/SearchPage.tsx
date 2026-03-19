import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { css } from '@linaria/core';
import { Input } from 'haze-ui';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ErrorState } from '../components/ui/ErrorState';
import { apiClient } from '../api/client';
import { detectSearchType, sanitizeInput } from '@/utils/validation';

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

const exampleQueries = [
  { label: 'Address', value: '0x742d35Cc6634C0532925a3b8D489319BaAE7fe', type: 'address' },
  { label: 'Tx Hash', value: '0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060', type: 'hash' },
  { label: 'Block Number', value: '18000000', type: 'block' },
  { label: 'ENS', value: 'vitalik.eth', type: 'ens' },
];

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSearch = async (searchQuery = query) => {
    if (!searchQuery.trim()) return;

    const sanitized = sanitizeInput(searchQuery.trim());
    const searchType = detectSearchType(sanitized);

    if (searchType === 'unknown') {
      setError('Invalid search format. Please enter a valid address, transaction hash, or block number.');
      return;
    }

    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      const searchResult = await apiClient.search(sanitized);
      setResult(searchResult);

      if (searchResult.type === 'address' && searchResult.data) {
        navigate(`/chain/${searchResult.data.chainId}/address/${searchResult.data.address}`);
      }
      else if (searchResult.type === 'transaction' && searchResult.data) {
        navigate(`/chain/${searchResult.data.chainId}/tx/${searchResult.data.hash}`);
      }
      else if (searchResult.type === 'block' && searchResult.data) {
        navigate(`/chain/${searchResult.data.chainId}/block/${searchResult.data.number}`);
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
    finally {
      setIsSearching(false);
    }
  };

  const handleChainSelect = async (selectedChainId: number) => {
    if (!query.trim()) return;

    const sanitized = sanitizeInput(query.trim());
    setIsSearching(true);
    setError(null);

    try {
      const searchResult = await apiClient.searchInChain(selectedChainId, sanitized);

      if (searchResult.type === 'address') {
        navigate(`/chain/${selectedChainId}/address/${sanitized}`);
      }
      else if (searchResult.type === 'transaction') {
        navigate(`/chain/${selectedChainId}/tx/${sanitized}`);
      }
      else if (searchResult.type === 'block') {
        navigate(`/chain/${selectedChainId}/block/${sanitized}`);
      }
    }
    catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    }
    finally {
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
            onSubmit={(e) => {
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
            <Button
              loading={isSearching}
              disabled={!query.trim() || isSearching}
            >
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

      {result?.type.includes('_select_chain') && (
        <Card className={resultCard}>
          <CardHeader>
            <CardTitle>Select Network</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={css`color: var(--haze-color-text-secondary); margin-bottom: var(--haze-space-4);`}>
              Please select a blockchain network to search:
            </p>

            <div className={chainSelector}>
              {result.supportedChains?.map((chain: any) => (
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
