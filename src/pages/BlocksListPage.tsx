import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getChainInfo, getChainName } from "../config/chains";
import TopNavigation from "../components/TopNavigation";
import { formatNumber, formatRelativeTime } from "@/utils/format";
import { getLatestBlocks, type RpcBlock } from "@/utils/blockRpcData";
import { PageContainer, PageHeader } from "@/components/ui/PageLayout";
import { DataTable, Pagination, linkStyle, monoStyle } from "@/components/ui/DataTable";
import { LoadingState, TableSkeleton } from "@/components/ui/LoadingState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CopyableHash } from "@/components/ui/CopyableHash";

export default function BlocksListPage() {
  const { chainId } = useParams<{ chainId: string }>();
  const navigate = useNavigate();
  const [blocks, setBlocks] = useState<RpcBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [latestBlockNumber, setLatestBlockNumber] = useState<bigint | null>(null);
  const limit = 20;

  const currentChainId = parseInt(chainId || "1");
  const chainInfo = getChainInfo(currentChainId);

  const fetchBlocks = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const beforeBlock =
        latestBlockNumber && page > 1
          ? latestBlockNumber - BigInt((page - 1) * limit) + 1n
          : undefined;

      const result = await getLatestBlocks(currentChainId, limit, beforeBlock);
      setBlocks(result.blocks);
      if (page === 1) {
        setLatestBlockNumber(result.latestBlockNumber);
      }
    } catch (err) {
      console.error("Failed to fetch blocks:", err);
      setError(
        err instanceof Error ? err.message : "Failed to fetch blocks"
      );
    } finally {
      setLoading(false);
    }
  }, [currentChainId, page, latestBlockNumber]);

  useEffect(() => {
    fetchBlocks();
  }, [fetchBlocks]);

  const handleChainChange = (newChainId: number) => {
    navigate(`/chain/${newChainId}/blocks`, { replace: true });
  };

  const formatGasUsage = (used: string, limit: string) => {
    try {
      const usedNum = parseInt(used);
      const limitNum = parseInt(limit);
      const percentage = ((usedNum / limitNum) * 100).toFixed(1);
      return `${formatNumber(usedNum)} (${percentage}%)`;
    } catch {
      return used;
    }
  };

  const formatMiner = (miner: string) => {
    if (!miner || miner.length < 10) return miner;
    return `${miner.slice(0, 8)}...${miner.slice(-6)}`;
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <ErrorState message={`Unsupported chain ID: ${chainId}`} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <PageHeader
          title="Blocks"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        {loading && <TableSkeleton rows={10} cols={5} />}

        {error && <ErrorState message={error} onRetry={fetchBlocks} />}

        {!loading && !error && blocks.length === 0 && (
          <LoadingState message="No blocks found" />
        )}

        {blocks.length > 0 && (
          <DataTable>
            <thead>
              <tr>
                <th>Block</th>
                <th>Age</th>
                <th>Txn</th>
                <th>Gas Used</th>
                <th>Miner</th>
              </tr>
            </thead>
            <tbody>
              {blocks.map((block) => (
                <tr key={block.number}>
                  <td>
                    <Link
                      to={`/chain/${currentChainId}/block/${block.number}`}
                      className={linkStyle}
                    >
                      {formatNumber(parseInt(block.number))}
                    </Link>
                  </td>
                  <td>
                    {block.timestamp
                      ? formatRelativeTime(block.timestamp)
                      : "N/A"}
                  </td>
                  <td>{block.transactionCount}</td>
                  <td className={monoStyle}>
                    {formatGasUsage(block.gasUsed, block.gasLimit)}
                  </td>
                  <td>
                    <CopyableHash
                      value={block.miner}
                      truncated={formatMiner(block.miner)}
                      href={`/chain/${currentChainId}/address/${block.miner}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}

        {blocks.length > 0 && (
          <Pagination
            page={page}
            pageInfo={`Page ${page}${latestBlockNumber !== null ? ` • Latest block: ${formatNumber(Number(latestBlockNumber))}` : ""}`}
            hasPrev={page > 1}
            hasNext={blocks.length >= limit}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => p + 1)}
            prevLabel="Newer"
            nextLabel="Older"
          />
        )}
      </PageContainer>
    </>
  );
}
