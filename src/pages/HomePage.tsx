import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { css } from "@linaria/core";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";
import { Badge, StatusBadge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { apiClient } from "../api/client";
import { formatNumber, formatRelativeTime } from "@/shared/utils/format";

const hero = css`
  text-align: center;
  margin-bottom: 48px;
`;

const title = css`
  font-size: 48px;
  font-weight: 800;
  margin: 0 0 16px 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;

  @media (max-width: 768px) {
    font-size: 36px;
  }
`;

const subtitle = css`
  font-size: 20px;
  color: #64748b;
  margin: 0;

  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
  margin-bottom: 32px;
`;

const statCard = css`
  text-align: center;
`;

const statValue = css`
  font-size: 32px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 8px;

  @media (prefers-color-scheme: dark) {
    color: #e2e8f0;
  }
`;

const statLabel = css`
  font-size: 14px;
  color: #64748b;

  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

const chainGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 24px;
`;

const chainCard = css`
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.15s ease;

  &:hover {
    border-color: #3b82f6;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  @media (prefers-color-scheme: dark) {
    border-color: #334155;

    &:hover {
      border-color: #60a5fa;
    }
  }
`;

const chainHeader = css`
  display: flex;
  justify-content: between;
  align-items: center;
  margin-bottom: 12px;
`;

const chainName = css`
  font-weight: 600;
  font-size: 16px;
  color: #1e293b;

  @media (prefers-color-scheme: dark) {
    color: #e2e8f0;
  }
`;

const chainStats = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  font-size: 13px;
  color: #64748b;

  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

export function HomePage() {
  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchOverview = async () => {
      try {
        setLoading(true);
        const data = await apiClient.getOverviewStats();
        setOverview(data);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load overview"
        );
        console.error("Failed to fetch overview:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();

    // 每30秒更新一次
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div>
        <div className={hero}>
          <h1 className={title}>Block Explorer</h1>
          <p className={subtitle}>多链区块链浏览器</p>
        </div>

        <div
          className={css`
            text-align: center;
            color: #64748b;
          `}
        >
          正在加载统计数据...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <div className={hero}>
          <h1 className={title}>Block Explorer</h1>
          <p className={subtitle}>多链区块链浏览器</p>
        </div>

        <Card>
          <CardContent>
            <div
              className={css`
                text-align: center;
                color: #ef4444;
              `}
            >
              加载失败: {error}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <div className={hero}>
        <h1 className={title}>Block Explorer</h1>
        <p className={subtitle}>
          现代化的多链区块链浏览器，支持 Ethereum、Polygon、BSC 等主流网络
        </p>
      </div>

      {/* 总体统计 */}
      <div className={grid}>
        <Card className={statCard}>
          <CardContent>
            <div className={statValue}>{overview?.supportedChains || 0}</div>
            <div className={statLabel}>支持的网络</div>
          </CardContent>
        </Card>

        <Card className={statCard}>
          <CardContent>
            <div className={statValue}>{overview?.indexedChains || 0}</div>
            <div className={statLabel}>已索引网络</div>
          </CardContent>
        </Card>

        <Card className={statCard}>
          <CardContent>
            <div className={statValue}>
              {formatNumber(overview?.totalBlocks || 0)}
            </div>
            <div className={statLabel}>总区块数</div>
          </CardContent>
        </Card>

        <Card className={statCard}>
          <CardContent>
            <div className={statValue}>
              {formatNumber(overview?.totalTransactions || 0)}
            </div>
            <div className={statLabel}>总交易数</div>
          </CardContent>
        </Card>
      </div>

      {/* 链列表 */}
      <Card>
        <CardHeader>
          <CardTitle>支持的区块链网络</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={chainGrid}>
            {overview?.chains?.map((chain: any) => (
              <div key={chain.chainId} className={chainCard}>
                <div className={chainHeader}>
                  <div className={chainName}>{chain.chainName}</div>
                  <StatusBadge status={chain.isIndexed ? "online" : "offline"}>
                    {chain.isIndexed ? "已索引" : "未索引"}
                  </StatusBadge>
                </div>

                <div className={chainStats}>
                  <div>
                    最新区块:{" "}
                    {chain.latestBlock
                      ? formatNumber(chain.latestBlock)
                      : "N/A"}
                  </div>
                  <div>代币: {chain.chainSymbol}</div>
                  <div>已索引区块: {formatNumber(chain.totalBlocks)}</div>
                  <div>交易数: {formatNumber(chain.totalTransactions)}</div>
                </div>

                {chain.isIndexed && (
                  <div
                    className={css`
                      margin-top: 12px;
                    `}
                  >
                    <Button
                      as="a"
                      href={`/chains/${chain.chainId}/blocks`}
                      size="sm"
                      variant="outline"
                      className={css`
                        width: 100%;
                      `}
                    >
                      浏览 {chain.chainName}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 快速搜索 */}
      <Card
        className={css`
          margin-top: 32px;
        `}
      >
        <CardHeader>
          <CardTitle>快速搜索</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={css`
              text-align: center;
            `}
          >
            <p
              className={css`
                color: #64748b;
                margin-bottom: 20px;
              `}
            >
              输入地址、交易哈希或区块号来快速查找区块链数据
            </p>
            <Button as="a" href="/search" size="lg">
              开始搜索
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
