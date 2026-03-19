import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { css } from "@linaria/core";
import { formatEther, formatGwei } from "viem";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
} from "../components/ui/Card";
import TopNavigation from "../components/TopNavigation";
import { getChainInfo, getChainSymbol } from "@/config/chains";
import {
  formatNumber,
  formatAddress,
  formatHash,
  formatRelativeTime,
  formatEth,
} from "@/utils/format";
import { PageContainer } from "@/components/ui/PageLayout";
import { LoadingState } from "@/components/ui/LoadingState";
import {
  getLatestBlocks,
  getBlockTransactions,
  type RpcBlock,
  type RpcTransaction,
} from "@/utils/blockRpcData";
import { createRpcClient } from "@/utils/realTimeData";

const MAX_LIST_ITEMS = 10;
const POLL_INTERVAL = 12_000;

// --- styles ---

const hero = css`
  text-align: center;
  padding: var(--haze-space-8) 0 var(--haze-space-4);
`;

const titleStyle = css`
  font-size: 36px;
  font-weight: var(--haze-weight-bold);
  margin: 0 0 var(--haze-space-2) 0;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;

  @media (max-width: 768px) {
    font-size: 28px;
  }
`;

const subtitleStyle = css`
  font-size: var(--haze-text-base);
  color: var(--haze-color-text-muted);
  margin: 0;
`;

const statsBar = css`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--haze-space-4);
  margin: var(--haze-space-6) 0;
`;

const statItem = css`
  text-align: center;
  padding: var(--haze-space-4);
`;

const statValueStyle = css`
  font-size: 22px;
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  margin-bottom: 2px;
`;

const statLabelStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const columnsLayout = css`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--haze-space-5);
  margin-top: var(--haze-space-4);

  @media (max-width: 900px) {
    grid-template-columns: 1fr;
  }
`;

const listItem = css`
  display: flex;
  align-items: flex-start;
  gap: var(--haze-space-3);
  padding: var(--haze-space-3) 0;
  border-bottom: 1px solid var(--haze-color-border);

  &:last-child {
    border-bottom: none;
  }
`;

const listIcon = css`
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-primary-subtle);
  color: var(--haze-color-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-bold);
`;

const listBody = css`
  flex: 1;
  min-width: 0;
`;

const listRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: var(--haze-space-2);
`;

const listPrimary = css`
  font-weight: var(--haze-weight-semibold);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-primary);
  text-decoration: none;

  &:hover {
    text-decoration: underline;
  }
`;

const listSecondary = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const listMeta = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  white-space: nowrap;
`;

const listValue = css`
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text);
  font-family: var(--haze-font-mono, monospace);
`;

const viewAllLink = css`
  display: block;
  text-align: center;
  padding: var(--haze-space-3);
  color: var(--haze-color-primary);
  text-decoration: none;
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  border-top: 1px solid var(--haze-color-border);

  &:hover {
    background: var(--haze-color-primary-subtle);
  }
`;

const cardHeaderRow = css`
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

// --- component ---

export default function HomePage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();

  const currentChainId = chainId ? parseInt(chainId) : 1;
  const chainInfo = getChainInfo(currentChainId);
  const symbol = getChainSymbol(currentChainId);

  const [blocks, setBlocks] = useState<RpcBlock[]>([]);
  const [transactions, setTransactions] = useState<RpcTransaction[]>([]);
  const [latestBlockNumber, setLatestBlockNumber] = useState<bigint | null>(
    null
  );
  const [gasPrice, setGasPrice] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);

  const prevBlockNumberRef = useRef<bigint | null>(null);

  useEffect(() => {
    if (!chainInfo) {
      navigate("/chain/1", { replace: true });
    }
  }, [chainInfo, navigate]);

  // Initial load: fetch 10 blocks + their transactions
  const initialLoad = useCallback(async () => {
    try {
      setLoading(true);
      const [blockData, client] = await Promise.all([
        getLatestBlocks(currentChainId, MAX_LIST_ITEMS),
        createRpcClient(currentChainId),
      ]);

      setBlocks(blockData.blocks);
      setLatestBlockNumber(blockData.latestBlockNumber);
      prevBlockNumberRef.current = blockData.latestBlockNumber;

      const gp = await client.getGasPrice().catch(() => null);
      setGasPrice(gp);

      // Collect transactions from the fetched blocks
      const latestBlock = blockData.blocks[0];
      if (latestBlock) {
        const txs = await getBlockTransactions(
          currentChainId,
          BigInt(latestBlock.number)
        ).catch(() => []);
        setTransactions(txs.slice(0, MAX_LIST_ITEMS));
      }
    } catch (err) {
      console.error("Failed to load homepage data:", err);
    } finally {
      setLoading(false);
    }
  }, [currentChainId]);

  // Poll: fetch only the latest block and prepend
  const poll = useCallback(async () => {
    try {
      const client = await createRpcClient(currentChainId);
      const currentBlockNumber = await client.getBlockNumber();

      // Update gas price
      const gp = await client.getGasPrice().catch(() => null);
      setGasPrice(gp);

      const prev = prevBlockNumberRef.current;
      if (prev !== null && currentBlockNumber <= prev) return;

      // Fetch only the new block
      const block = await client.getBlock({ blockNumber: currentBlockNumber });
      const newBlock: RpcBlock = {
        number: block.number.toString(),
        hash: block.hash!,
        parentHash: block.parentHash,
        timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
        miner:
          ((block as Record<string, unknown>).miner as string) ?? "",
        gasUsed: block.gasUsed.toString(),
        gasLimit: block.gasLimit.toString(),
        baseFeePerGas: block.baseFeePerGas?.toString(),
        transactionCount: block.transactions.length,
        sizeBytes: Number(block.size),
      };

      setBlocks((prev) => [newBlock, ...prev].slice(0, MAX_LIST_ITEMS));
      setLatestBlockNumber(currentBlockNumber);
      prevBlockNumberRef.current = currentBlockNumber;

      // Fetch transactions from the new block
      if (block.transactions.length > 0) {
        const txs = await getBlockTransactions(
          currentChainId,
          currentBlockNumber
        ).catch(() => []);

        if (txs.length > 0) {
          setTransactions((prev) =>
            [...txs, ...prev].slice(0, MAX_LIST_ITEMS)
          );
        }
      }
    } catch (err) {
      console.error("Poll error:", err);
    }
  }, [currentChainId]);

  useEffect(() => {
    initialLoad();
  }, [initialLoad]);

  useEffect(() => {
    if (loading) return;
    const id = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [poll, loading]);

  const handleChainChange = (newChainId: number) => {
    // Reset state on chain change
    setBlocks([]);
    setTransactions([]);
    setLatestBlockNumber(null);
    setGasPrice(null);
    prevBlockNumberRef.current = null;
    navigate(`/chain/${newChainId}`, { replace: true });
  };

  if (!chainInfo) return null;

  const gasUsedPercent =
    blocks[0]
      ? (
          (Number(blocks[0].gasUsed) / Number(blocks[0].gasLimit)) *
          100
        ).toFixed(1)
      : null;

  return (
    <>
      <TopNavigation
        currentChainId={currentChainId}
        onChainChange={handleChainChange}
      />
      <PageContainer>
        <div className={hero}>
          <h1 className={titleStyle}>{chainInfo.name} Explorer</h1>
          <p className={subtitleStyle}>
            Chain ID: {chainInfo.id} · {symbol}
          </p>
        </div>

        {/* Stats bar */}
        <div className={statsBar}>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {latestBlockNumber !== null
                ? formatNumber(latestBlockNumber)
                : "—"}
            </div>
            <div className={statLabelStyle}>Latest Block</div>
          </Card>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {gasPrice !== null
                ? `${parseFloat(formatGwei(gasPrice)).toFixed(2)} Gwei`
                : "—"}
            </div>
            <div className={statLabelStyle}>Gas Price</div>
          </Card>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {blocks[0]
                ? formatNumber(blocks[0].transactionCount)
                : "—"}
            </div>
            <div className={statLabelStyle}>Txns in Latest Block</div>
          </Card>
          <Card className={statItem}>
            <div className={statValueStyle}>
              {gasUsedPercent !== null ? `${gasUsedPercent}%` : "—"}
            </div>
            <div className={statLabelStyle}>Gas Used</div>
          </Card>
        </div>

        {loading && <LoadingState message="Loading blockchain data..." />}

        {!loading && (
          <div className={columnsLayout}>
            {/* Latest Blocks */}
            <Card>
              <CardHeader>
                <div className={cardHeaderRow}>
                  <CardTitle>Latest Blocks</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {blocks.map((block) => (
                  <div key={block.number} className={listItem}>
                    <div className={listIcon}>Bk</div>
                    <div className={listBody}>
                      <div className={listRow}>
                        <Link
                          to={`/chain/${currentChainId}/block/${block.number}`}
                          className={listPrimary}
                        >
                          {formatNumber(block.number)}
                        </Link>
                        <span className={listMeta}>
                          {formatRelativeTime(block.timestamp)}
                        </span>
                      </div>
                      <div className={listRow}>
                        <span className={listSecondary}>
                          Miner{" "}
                          <Link
                            to={`/chain/${currentChainId}/address/${block.miner}`}
                            className={listPrimary}
                            style={{ fontWeight: "normal" }}
                          >
                            {formatAddress(block.miner, 4)}
                          </Link>
                        </span>
                        <span className={listValue}>
                          {block.transactionCount} txns
                        </span>
                      </div>
                      {block.baseFeePerGas && (
                        <div className={listSecondary}>
                          Base fee:{" "}
                          {parseFloat(
                            formatGwei(BigInt(block.baseFeePerGas))
                          ).toFixed(4)}{" "}
                          Gwei · Size: {formatNumber(block.sizeBytes ?? 0)} B
                        </div>
                      )}
                    </div>
                  </div>
                ))}
                <Link
                  to={`/chain/${currentChainId}/blocks`}
                  className={viewAllLink}
                >
                  View all blocks →
                </Link>
              </CardContent>
            </Card>

            {/* Latest Transactions */}
            <Card>
              <CardHeader>
                <div className={cardHeaderRow}>
                  <CardTitle>Latest Transactions</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                {transactions.map((tx) => (
                  <div key={tx.hash} className={listItem}>
                    <div className={listIcon}>Tx</div>
                    <div className={listBody}>
                      <div className={listRow}>
                        <Link
                          to={`/chain/${currentChainId}/tx/${tx.hash}`}
                          className={listPrimary}
                        >
                          {formatHash(tx.hash, 6)}
                        </Link>
                        <span className={listMeta}>
                          {tx.timestamp
                            ? formatRelativeTime(tx.timestamp)
                            : `Block ${formatNumber(tx.blockNumber)}`}
                        </span>
                      </div>
                      <div className={listRow}>
                        <span className={listSecondary}>
                          From{" "}
                          <Link
                            to={`/chain/${currentChainId}/address/${tx.fromAddress}`}
                            className={listPrimary}
                            style={{ fontWeight: "normal" }}
                          >
                            {formatAddress(tx.fromAddress, 4)}
                          </Link>
                          {tx.toAddress && (
                            <>
                              {" → "}
                              <Link
                                to={`/chain/${currentChainId}/address/${tx.toAddress}`}
                                className={listPrimary}
                                style={{ fontWeight: "normal" }}
                              >
                                {formatAddress(tx.toAddress, 4)}
                              </Link>
                            </>
                          )}
                        </span>
                      </div>
                      <div className={listRow}>
                        <span className={listValue}>
                          {formatEth(tx.value)} {symbol}
                        </span>
                        {tx.gasUsed && tx.effectiveGasPrice && (
                          <span className={listSecondary}>
                            Fee:{" "}
                            {parseFloat(
                              formatEther(
                                BigInt(tx.gasUsed) *
                                  BigInt(tx.effectiveGasPrice)
                              )
                            ).toFixed(6)}{" "}
                            {symbol}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {transactions.length === 0 && (
                  <div className={listSecondary} style={{ padding: "20px 0", textAlign: "center" }}>
                    No transactions in recent blocks
                  </div>
                )}
                <Link
                  to={`/chain/${currentChainId}/transactions`}
                  className={viewAllLink}
                >
                  View all transactions →
                </Link>
              </CardContent>
            </Card>
          </div>
        )}
      </PageContainer>
    </>
  );
}
