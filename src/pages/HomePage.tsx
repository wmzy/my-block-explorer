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
import { Button } from "../components/ui/Button";
import TopNavigation from "../components/TopNavigation";
import RpcErrorAlert from "../components/RpcErrorAlert";
import { apiClient } from "../api/client";
import { getChainInfo } from "@/config/chains";
import { formatNumber } from "@/utils/format";
import type { RpcError } from "../types/rpc";

const pageContainer = css`
  max-width: 1000px;
  margin: 0 auto;
  padding: 20px;
`;

const hero = css`
  text-align: center;
  margin-bottom: 40px;
`;

const titleStyle = css`
  font-size: 42px;
  font-weight: 800;
  margin: 0 0 12px 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;

  @media (max-width: 768px) {
    font-size: 32px;
  }
`;

const subtitleStyle = css`
  font-size: 18px;
  color: #64748b;
  margin: 0;
`;

const grid = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 20px;
  margin-bottom: 32px;
`;

const statCard = css`
  text-align: center;
`;

const statValue = css`
  font-size: 28px;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 6px;
`;

const statLabel = css`
  font-size: 14px;
  color: #64748b;
`;

const chainGrid = css`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 20px;
`;

const chainCardStyle = css`
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  transition: all 0.15s ease;

  &:hover {
    border-color: #3b82f6;
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }
`;

const chainHeaderStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
`;

const chainNameStyle = css`
  font-weight: 600;
  font-size: 16px;
  color: #1e293b;
`;

const chainStatsStyle = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  font-size: 13px;
  color: #64748b;
`;

const quickLinksStyle = css`
  display: flex;
  gap: 12px;
  margin-top: 32px;

  a {
    flex: 1;
    display: block;
    padding: 16px;
    text-align: center;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    color: #4f46e5;
    text-decoration: none;
    font-weight: 500;
    transition: all 0.15s ease;

    &:hover {
      border-color: #4f46e5;
      background: #f5f3ff;
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
      <div className={pageContainer}>
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

        {/* Quick links for current chain */}
        <div className={quickLinksStyle}>
          <Link to={`/chain/${currentChainId}/blocks`}>Blocks</Link>
          <Link to={`/chain/${currentChainId}/transactions`}>Transactions</Link>
        </div>

        {loading && (
          <Card className={css`margin-top: 32px;`}>
            <CardContent>
              <div className={css`text-align: center; color: #64748b;`}>
                Loading overview...
              </div>
            </CardContent>
          </Card>
        )}

        {error && !loading && (
          <Card className={css`margin-top: 32px;`}>
            <CardContent>
              <div className={css`text-align: center; color: #ef4444;`}>
                {error}
              </div>
            </CardContent>
          </Card>
        )}

        {overview && !loading && (
          <>
            <div className={`${grid} ${css`margin-top: 32px;`}`}>
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
                    {overview.indexedChains || 0}
                  </div>
                  <div className={statLabel}>Indexed Chains</div>
                </CardContent>
              </Card>
              <Card className={statCard}>
                <CardContent>
                  <div className={statValue}>
                    {formatNumber(overview.totalBlocks || 0)}
                  </div>
                  <div className={statLabel}>Total Blocks</div>
                </CardContent>
              </Card>
              <Card className={statCard}>
                <CardContent>
                  <div className={statValue}>
                    {formatNumber(overview.totalTransactions || 0)}
                  </div>
                  <div className={statLabel}>Total Transactions</div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Supported Chains</CardTitle>
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
                            status={chain.isIndexed ? "online" : "offline"}
                          >
                            {chain.isIndexed ? "Indexed" : "Not Indexed"}
                          </StatusBadge>
                        </div>
                        <div className={chainStatsStyle}>
                          <div>
                            Latest Block:{" "}
                            {chain.latestBlock
                              ? formatNumber(chain.latestBlock)
                              : "N/A"}
                          </div>
                          <div>Symbol: {chain.chainSymbol}</div>
                          <div>
                            Indexed Blocks: {formatNumber(chain.totalBlocks)}
                          </div>
                          <div>
                            Transactions:{" "}
                            {formatNumber(chain.totalTransactions)}
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
      </div>
    </>
  );
}
