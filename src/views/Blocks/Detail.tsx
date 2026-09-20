import { useEffect, useState } from 'react';
import { css } from '@linaria/core';
import { TypedLink, useMatched } from '@native-router/react';
import { formatGwei } from 'viem';

import TopNavigation from '@/components/TopNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ErrorState, EmptyState } from '@/components/ui/ErrorState';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { linkStyle } from '@/components/ui/DataTable';
import { ExternalLinks } from '@/components/ui/ExternalLinks';
import { getChainInfo, getChainName, getChainType } from '@/config/chains';
import { getExternalBlockLinks } from '@/config/externalTools';
import { redirectReplace, navigateBack } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { useBlockByNumber } from '@/services/chainRpc';
import { finalityLabelFor, useFinalityHeads } from '@/services/blocks';
import { formatRelativeTime } from '@/utils/format';
import { parseBlockNumberParam } from '@/utils/chainParam';
import { createRpcClient } from '@/utils/realTimeData';

// Gas quantities are on-chain integers serialized as strings: format them
// BigInt-safe (parseInt would silently lose precision past 2^53).
const formatGas = (gas: string): string => {
  try {
    return BigInt(gas).toLocaleString();
  } catch {
    return gas;
  }
};

const formatBytes = (bytes?: number): string => {
  if (!bytes) return 'N/A';
  return `${bytes.toLocaleString()} bytes`;
};

// Head lookup backing the "does not exist yet" hint below: reuses the RPC
// service layer's cached client, and only the error path ever pays for the
// single eth_blockNumber call. A failed lookup collapses to undefined so
// the genuine error UI survives.
async function fetchLatestBlockNumber(chainId: number): Promise<bigint | undefined> {
  try {
    const client = await createRpcClient(chainId);
    return await client.getBlockNumber();
  } catch {
    return undefined;
  }
}

const futureBlockLinks = css`
  display: flex;
  gap: var(--haze-space-4);
  margin-top: var(--haze-space-3);
`;

// PageHeader block, the testnet pill, and the cross-verification links on
// one row (same scale as the Blocks list header); wraps on narrow screens.
const headerRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

export default function BlockDetail() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const blockNumberStr = params.blockNumber ?? '';
  // Decimal-only validation: Number("0x1a") === 26 (hex!), so a hex-ish
  // param used to silently load the wrong block — now it is an explicit
  // invalid state. Block 0 (genesis) stays valid.
  const parsedBlockNumber = parseBlockNumberParam(blockNumberStr);
  const invalidNumber = parsedBlockNumber === null;

  // The service fetch guards invalid numbers itself (no network), so the
  // hook runs unconditionally and the view reports the bad param.
  const { data: blockInfo, loading, error } = useBlockByNumber(currentChainId, blockNumberStr);

  // Future-block hint: when the block fetch fails, one extra head lookup
  // decides between "does not exist yet" guidance and a genuine RPC
  // failure. Happy paths never trigger the call.
  const [latestBlock, setLatestBlock] = useState<bigint | undefined>(undefined);
  const [headChecked, setHeadChecked] = useState(false);

  // Reset on route change so a head read for a previous chain is never
  // compared against the current block number.
  useEffect(() => {
    setLatestBlock(undefined);
    setHeadChecked(false);
  }, [currentChainId, blockNumberStr]);

  useEffect(() => {
    if (!error || invalidNumber || headChecked) return;
    let cancelled = false;
    void fetchLatestBlockNumber(currentChainId).then(latest => {
      if (cancelled) return;
      setLatestBlock(latest);
      setHeadChecked(true);
    });
    return () => {
      cancelled = true;
    };
  }, [error, invalidNumber, headChecked, currentChainId]);

  // Only a resolved head AND a beyond-head request produce the friendly
  // state; anything else keeps the genuine error UI. (parsedBlockNumber is
  // already a safe integer, so the BigInt step is exact.)
  const requestedBlock = parsedBlockNumber !== null ? BigInt(parsedBlockNumber) : undefined;
  const futureBlock =
    requestedBlock !== undefined && latestBlock !== undefined && requestedBlock > latestBlock
      ? { requested: requestedBlock, latest: latestBlock }
      : undefined;

  // Chain switch: a block NUMBER is not a chain-agnostic identity — the
  // same number on another chain is a completely different block with
  // different data. Keeping the number would silently show that unrelated
  // block as if it were the one being read. Land on the new chain's home
  // instead: deterministic and honest (the user re-picks a block there).
  const handleChainChange = (newChainId: number) => {
    void redirectReplace(router, `/chain/${newChainId}`).catch(() => undefined);
  };

  // Finality label for the viewed block (same semantics as the list rows):
  // unknown heads render no badge — absence of data is not "pending" — and
  // an invalid param earns none either (no number to compare). Guarded to
  // 0 on the unsupported-chain branch like the list's feed hook.
  const finalityHeads = useFinalityHeads(chainInfo ? currentChainId : 0).data;
  const finalityLabel =
    parsedBlockNumber === null ? undefined : finalityLabelFor(finalityHeads, parsedBlockNumber);

  // Parent-hash link target: block N's parent is N-1. The genesis block
  // has no parent to visit (its parent hash is the zero placeholder), so
  // its row stays copy-only.
  const fetchedNumber = blockInfo ? BigInt(blockInfo.number) : undefined;
  const parentNumber =
    fetchedNumber !== undefined && fetchedNumber > 0n ? fetchedNumber - 1n : undefined;

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <UnsupportedChainState chainId={currentChainId} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton onClick={() => navigateBack(router, `/chain/${currentChainId}/blocks`)} />

        <div className={headerRow}>
          <PageHeader
            title={`Block #${blockNumberStr}`}
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          {finalityLabel && (
            // Finalized outranks Safe; muted variant for the settled
            // state, info tone for merely safe.
            <Badge variant={finalityLabel === 'finalized' ? 'default' : 'info'} size="sm">
              {finalityLabel === 'finalized' ? 'Finalized' : 'Safe'}
            </Badge>
          )}
          {getChainType(currentChainId) === 'testnet' && (
            <Badge variant="warning" size="sm">
              Testnet
            </Badge>
          )}
          {/* Cross-verification in an external explorer from the page head —
              only a decimal block number makes a valid external URL. */}
          {!invalidNumber && (
            <ExternalLinks links={getExternalBlockLinks(currentChainId, blockNumberStr)} />
          )}
        </div>

        {invalidNumber && (
          <ErrorState
            message={`Invalid block number: "${blockNumberStr}" is not a decimal block number (expected a number like 18000001).`}
          />
        )}

        {!invalidNumber && loading && <LoadingState message="Loading block information..." />}

        {!invalidNumber && error && !headChecked && (
          <LoadingState message="Checking whether this block exists yet..." />
        )}

        {!invalidNumber && error && headChecked && futureBlock && (
          <EmptyState
            message={`Block ${futureBlock.requested.toLocaleString()} does not exist yet. The chain is currently at block ${futureBlock.latest.toLocaleString()}.`}
          >
            <div className={futureBlockLinks}>
              <TypedLink
                to={`/chain/${currentChainId}/block/${futureBlock.latest.toString()}`}
                className={linkStyle}
              >
                View latest block
              </TypedLink>
              <TypedLink to={`/chain/${currentChainId}/blocks`} className={linkStyle}>
                View blocks list
              </TypedLink>
            </div>
          </EmptyState>
        )}

        {!invalidNumber && error && headChecked && !futureBlock && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch block information'}
          />
        )}

        {!invalidNumber && !loading && !error && blockInfo && (
          <Card>
            <CardHeader>
              <CardTitle>Block Details</CardTitle>
            </CardHeader>
            <CardContent>
              <InfoGrid>
                <InfoItem label="Block Number">
                  {Number(BigInt(blockInfo.number)).toLocaleString()}
                </InfoItem>
                <InfoItem label="Block Hash">
                  <CopyableHash value={blockInfo.hash} />
                </InfoItem>
                <InfoItem label="Parent Hash">
                  <CopyableHash
                    value={blockInfo.parentHash}
                    href={
                      parentNumber !== undefined
                        ? `/chain/${currentChainId}/block/${parentNumber}`
                        : undefined
                    }
                  />
                </InfoItem>
                <InfoItem label="Timestamp">
                  {`${new Date(blockInfo.timestamp).toLocaleString()} (${formatRelativeTime(blockInfo.timestamp)})`}
                </InfoItem>
                <InfoItem label="Miner">
                  <CopyableHash
                    value={blockInfo.miner}
                    href={`/chain/${currentChainId}/address/${blockInfo.miner}`}
                  />
                </InfoItem>
                <InfoItem label="Gas Limit">{formatGas(blockInfo.gasLimit)}</InfoItem>
                <InfoItem label="Gas Used">{formatGas(blockInfo.gasUsed)}</InfoItem>
                {blockInfo.baseFeePerGas && (
                  <InfoItem label="Base Fee Per Gas">
                    {`${formatGwei(BigInt(blockInfo.baseFeePerGas))} gwei`}
                  </InfoItem>
                )}
                <InfoItem label="Transaction Count">
                  <TypedLink
                    to={`/chain/${currentChainId}/transactions`}
                    search={{ block: blockInfo.number }}
                    className={linkStyle}
                  >
                    View {blockInfo.transactionCount} Transactions →
                  </TypedLink>
                </InfoItem>
                <InfoItem label="Block Size">{formatBytes(blockInfo.sizeBytes)}</InfoItem>
                {blockInfo.difficulty && (
                  <InfoItem label="Difficulty">{blockInfo.difficulty}</InfoItem>
                )}
                {blockInfo.extraData && (
                  <InfoItem label="Extra Data">{blockInfo.extraData}</InfoItem>
                )}
              </InfoGrid>
            </CardContent>
          </Card>
        )}
      </PageContainer>
    </>
  );
}
