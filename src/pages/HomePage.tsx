import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { css } from "@linaria/core";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";
import { StatusBadge } from "../components/ui/Badge";
import TopNavigation from "../components/TopNavigation";
import RpcErrorAlert from "../components/RpcErrorAlert";
import { apiClient } from "../api/client";
import { getChainInfo } from "@/config/chains";
import { formatNumber } from "@/utils/format";
import { PageContainer } from "@/components/ui/PageLayout";
import { LoadingState } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import type { RpcError } from "../types/rpc";

const hero = css`
  text-align: center;
  margin-bottom: var(--haze-space-10);
`;

const titleStyle = css`
  font-size: 42px;
  font-weight: var(--haze-weight-bold);
  margin: 0 0 var(--haze-space-3) 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;

  @media (max-width: 768px) {
    font-size: 32px;
  }
`;

const subtitleStyle = css`
  font-size: var(--haze-text-lg);
  color: var(--haze-color-text-muted);
  margin: 0;
`;

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--haze-space-5);
  margin-bottom: var(--haze-space-8);
  margin-top: var(--haze-space-8);
`;

const statCard = css`
  text-align: center;
`;

const statValue = css`
  font-size: 28px;
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  margin-bottom: var(--haze-space-1);
`;

const statLabel = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

const chainGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--haze-space-4);
  margin-top: var(--haze-space-5);
`;

const chainCardStyle = css`
  padding: var(--haze-space-4);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  transition: all 0.15s ease;

  &:hover {
    border-color: var(--haze-color-primary);
    transform: translateY(-2px);
    box-shadow: var(--haze-shadow-md);
  }
`;

const chainHeaderStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--haze-space-3);
`;

const chainNameStyle = css`
  font-weight: var(--haze-weight-semibold);
  font-size: var(--haze-text-base);
  color: var(--haze-color-text);
`;

const chainStatsStyle = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--haze-space-2);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const quickLinksStyle = css`
  display: flex;
  gap: var(--haze-space-3);
  margin-top: var(--haze-space-8);

  a {
    flex: 1;
    display: block;
    padding: var(--haze-space-4);
    text-align: center;
    background: var(--haze-color-bg);
    border: 1px solid var(--haze-color-border);
    border-radius: var(--haze-radius-lg);
    color: var(--haze-color-primary);
    text-decoration: none;
    font-weight: var(--haze-weight-medium);
    transition: all 0.15s ease;

    &:hover {
      border-color: var(--haze-color-primary);
      background: var(--haze-color-primary-subtle);
    }
  }
`;

export default function HomePage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();

  const currentChainId = chainId ? parseInt(chainId) : 1;
  const chainInfo = getChainInfo(currentChainId);

  const [overview, setOverview] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rpcError, setRpcError] = useState<RpcError | null>(null);

  useEffect(() => {
    if (!chainInfo) {
      navigate("/chain/1", { replace: true });
    }
  }, [chainInfo, navigate]);

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
      } finally {
        setLoading(false);
      }
    };

    fetchOverview();
    const interval = setInterval(fetchOverview, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}`, { replace: true });
  };

  if (!chainInfo) {
    return null;
  }

  return (
    <>
      <TopNavigation
        currentChainId={currentChainId}
        onChainChange={handleChainChange}
      />
      <PageContainer narrow>
        {rpcError && (
          <RpcErrorAlert
            error={rpcError}
            onConfigureRpc={() => setRpcError(null)}
            onDismiss={() => setRpcError(null)}
          />
        )}

        <div className={hero}>
          <h1 className={titleStyle}>Block Explorer</h1>
          <p className={subtitleStyle}>
            {chainInfo.name} • Chain ID: {chainInfo.id} •{" "}
            {chainInfo.nativeCurrency.symbol}
          </p>
        </div>

        <div className={quickLinksStyle}>
          <Link to={`/chain/${currentChainId}/blocks`}>Blocks</Link>
          <Link to={`/chain/${currentChainId}/transactions`}>Transactions</Link>
        </div>

        {loading && <LoadingState message="Loading overview..." />}

        {error && !loading && <ErrorState message={error} />}

        {overview && !loading && (
          <>
            <div className={grid}>
              <Card className={statCard}>
                <CardContent>
                  <div className={statValue}>
                    {overview.supportedChains || 0}
                  </div>
                  <div className={statLabel}>Supported Chains</div>
                </CardContent>
              </Card>
              <Card className={statCard}>
                <CardContent>
                  <div className={statValue}>
                    {overview.connectedChains || 0}
                  </div>
                  <div className={statLabel}>Connected Chains</div>
                </CardContent>
              </Card>
              <Card className={statCard}>
                <CardContent>
                  <div className={statValue}>
                    {overview.indexedChains || 0}
                  </div>
                  <div className={statLabel}>Indexed Chains</div>
                </CardContent>
              </Card>
              <Card className={statCard}>
                <CardContent>
                  <div className={statValue}>
                    {formatNumber(overview.totalIndexedBlocks || 0)}
                  </div>
                  <div className={statLabel}>Indexed Blocks</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Popular Chains</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={chainGrid}>
                  {overview.chains?.map((chain: any) => (
                    <Link
                      key={chain.chainId}
                      to={`/chain/${chain.chainId}`}
                      style={{ textDecoration: "none", color: "inherit" }}
                    >
                      <div className={chainCardStyle}>
                        <div className={chainHeaderStyle}>
                          <div className={chainNameStyle}>
                            {chain.chainName}
                          </div>
                          <StatusBadge
                            status={chain.rpcConnected ? "online" : "offline"}
                          >
                            {chain.rpcConnected ? "Connected" : "Offline"}
                          </StatusBadge>
                        </div>
                        <div className={chainStatsStyle}>
                          <div>
                            Latest Block:{" "}
                            {chain.latestBlockNumber
                              ? formatNumber(chain.latestBlockNumber)
                              : "N/A"}
                          </div>
                          <div>Symbol: {chain.chainSymbol}</div>
                          <div>
                            Indexed Blocks:{" "}
                            {formatNumber(chain.indexedBlocks || 0)}
                          </div>
                          <div>
                            Indexed Txns:{" "}
                            {formatNumber(chain.indexedTransactions || 0)}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </PageContainer>
    </>
  );
}
