import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { css } from "@linaria/core";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { apiClient } from "../api/client";
import { detectSearchType, sanitizeInput } from "@/shared/utils/validation";

const searchContainer = css`
  max-width: 600px;
  margin: 0 auto;
`;

const searchForm = css`
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
`;

const searchInput = css`
  flex: 1;
  padding: 12px 16px;
  border: 2px solid #e2e8f0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 0.15s ease;

  &:focus {
    outline: none;
    border-color: #3b82f6;
  }

  @media (prefers-color-scheme: dark) {
    background-color: #1e293b;
    border-color: #334155;
    color: #e2e8f0;

    &:focus {
      border-color: #60a5fa;
    }
  }
`;

const examples = css`
  margin-top: 16px;
  font-size: 14px;
  color: #64748b;

  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

const exampleItem = css`
  display: inline-block;
  margin: 4px 8px 4px 0;
  padding: 4px 8px;
  background-color: #f1f5f9;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.15s ease;

  &:hover {
    background-color: #e2e8f0;
  }

  @media (prefers-color-scheme: dark) {
    background-color: #334155;

    &:hover {
      background-color: #475569;
    }
  }
`;

const resultCard = css`
  margin-top: 24px;
`;

const chainSelector = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-top: 16px;
`;

const chainOption = css`
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: center;

  &:hover {
    border-color: #3b82f6;
    background-color: #f8fafc;
  }

  @media (prefers-color-scheme: dark) {
    border-color: #334155;

    &:hover {
      border-color: #60a5fa;
      background-color: #1e293b;
    }
  }
`;

const exampleQueries = [
  {
    label: "以太坊地址",
    value: "0x742d35Cc6634C0532925a3b8D489319BaAE7fe",
    type: "address",
  },
  {
    label: "交易哈希",
    value: "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060",
    type: "hash",
  },
  { label: "区块号", value: "18000000", type: "block" },
  { label: "ENS域名", value: "vitalik.eth", type: "ens" },
];

export function SearchPage() {
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleSearch = async (searchQuery = query) => {
    if (!searchQuery.trim()) return;

    const sanitized = sanitizeInput(searchQuery.trim());
    const searchType = detectSearchType(sanitized);

    if (searchType === "unknown") {
      setError("无效的搜索格式。请输入有效的地址、交易哈希或区块号。");
      return;
    }

    setIsSearching(true);
    setError(null);
    setResult(null);

    try {
      const searchResult = await apiClient.search(sanitized);
      setResult(searchResult);

      // 如果是确定的结果，直接跳转
      if (searchResult.type === "address" && searchResult.data) {
        navigate(
          `/chains/${searchResult.data.chainId}/addresses/${searchResult.data.address}`
        );
      } else if (searchResult.type === "transaction" && searchResult.data) {
        navigate(
          `/chains/${searchResult.data.chainId}/transactions/${searchResult.data.hash}`
        );
      } else if (searchResult.type === "block" && searchResult.data) {
        navigate(
          `/chains/${searchResult.data.chainId}/blocks/${searchResult.data.number}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败");
    } finally {
      setIsSearching(false);
    }
  };

  const handleChainSelect = async (chainId: number) => {
    if (!query.trim()) return;

    const sanitized = sanitizeInput(query.trim());
    setIsSearching(true);
    setError(null);

    try {
      const searchResult = await apiClient.searchInChain(chainId, sanitized);

      if (searchResult.type === "address") {
        navigate(`/chains/${chainId}/addresses/${sanitized}`);
      } else if (searchResult.type === "transaction") {
        navigate(`/chains/${chainId}/transactions/${sanitized}`);
      } else if (searchResult.type === "block") {
        navigate(`/chains/${chainId}/blocks/${sanitized}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "搜索失败");
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
          <CardTitle>区块链数据搜索</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSearch();
            }}
            className={searchForm}
          >
            <input
              type="text"
              placeholder="输入地址、交易哈希或区块号..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className={searchInput}
            />
            <Button
              type="submit"
              loading={isSearching}
              disabled={!query.trim() || isSearching}
            >
              搜索
            </Button>
          </form>

          <div className={examples}>
            <div>示例搜索：</div>
            <div
              className={css`
                margin-top: 8px;
              `}
            >
              {exampleQueries.map((example, index) => (
                <Badge
                  key={index}
                  variant="default"
                  className={css`
                    ${exampleItem} margin-right: 8px;
                    margin-bottom: 8px;
                    cursor: pointer;
                  `}
                  onClick={() => handleExampleClick(example.value)}
                >
                  {example.label}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className={resultCard}>
          <CardContent>
            <div
              className={css`
                color: #ef4444;
                text-align: center;
              `}
            >
              ❌ {error}
            </div>
          </CardContent>
        </Card>
      )}

      {result && result.type.includes("_select_chain") && (
        <Card className={resultCard}>
          <CardHeader>
            <CardTitle>选择区块链网络</CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={css`
                color: #64748b;
                margin-bottom: 16px;
              `}
            >
              请选择要搜索的区块链网络：
            </p>

            <div className={chainSelector}>
              {result.supportedChains?.map((chain: any) => (
                <div
                  key={chain.chainId}
                  className={chainOption}
                  onClick={() => handleChainSelect(chain.chainId)}
                >
                  <div
                    className={css`
                      font-weight: 500;
                      margin-bottom: 4px;
                    `}
                  >
                    {chain.name}
                  </div>
                  <div
                    className={css`
                      font-size: 12px;
                      color: #64748b;
                    `}
                  >
                    Chain ID: {chain.chainId}
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
