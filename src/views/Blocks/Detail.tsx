import { useEffect, useMemo, useState } from 'react';
import { css, cx } from '@linaria/core';
import { TypedLink, useMatched } from '@native-router/react';
import { formatGwei, formatUnits, numberToHex } from 'viem';

import TopNavigation from '@/components/TopNavigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Collapsible } from '@/components/ui/Collapsible';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { ErrorState, EmptyState } from '@/components/ui/ErrorState';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { RawJsonCard, type RawJsonFetcher } from '@/components/ui/RawJson';
import { linkStyle } from '@/components/ui/DataTable';
import { ExternalLinks } from '@/components/ui/ExternalLinks';
import { getChainInfo, getChainName, getChainSymbol, getChainType } from '@/config/chains';
import { getExternalBlockLinks } from '@/config/externalTools';
import { redirectReplace, navigateBack } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { useBlockByNumber } from '@/services/chainRpc';
import { finalityLabelFor, useFinalityHeads } from '@/services/blocks';
import { describeBlockProducer } from '@/utils/blockRpcData';
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

// Future-block polling cadence and budget: while the requested number is
// beyond the chain head, the head is re-probed every 4 s; after ~5 minutes
// the automatic probing stops (the manual button stays available).
export const FUTURE_BLOCK_POLL_INTERVAL_MS = 4_000;
export const FUTURE_BLOCK_POLL_BUDGET_MS = 5 * 60_000;

// Per-blob gas (EIP-4844): each blob costs exactly 131,072 gas. Expressing
// blob usage as a blob count is schedule-independent — the original
// percentage used the launch-era 786,432 "cap" (6 blobs), which post-
// Prague/Fusaka blob-schedule increases turned into a misleading
// denominator (real blocks render >100% "of cap").
const BLOB_GAS_PER_BLOB = 131_072n;

// Decimal-integer RPC strings parsed BigInt-safely. BigInt('') is 0n, so
// empty/whitespace/non-numeric values must be rejected explicitly — an
// absent field rendered as zero would be a fabricated number.
const parseDecimalInteger = (value: string): bigint | undefined => {
  if (!/^\d+$/.test(value.trim())) return undefined;
  try {
    return BigInt(value);
  } catch {
    return undefined;
  }
};

// baseFeePerGas × gasUsed in wei. Both are decimal-string integers per the
// RpcBlock contract; anything unparseable collapses to undefined so the
// row is skipped rather than rendered from a fabricated number.
export const computeBurntFees = (baseFeePerGas: string, gasUsed: string): bigint | undefined => {
  const baseFee = parseDecimalInteger(baseFeePerGas);
  const used = parseDecimalInteger(gasUsed);
  if (baseFee === undefined || used === undefined) return undefined;
  return baseFee * used;
};

// Wei → decimal ETH. viem's formatUnits already strips trailing zeros
// (3e17 → "0.3"), so the raw result reads cleanly without extra math.
export const formatEthValue = (wei: bigint): string => formatUnits(wei, 18);

// Gwei-integer withdrawal amounts → exact ETH (9 decimals is lossless);
// unparseable values fall back to the raw string, never a NaN.
export const formatWithdrawalEth = (gwei: string): string => {
  const amount = parseDecimalInteger(gwei);
  return amount === undefined ? gwei : formatUnits(amount, 9);
};

// Blob usage as an exact blob count (each blob = 131,072 gas, always a
// whole multiple per protocol). BigInt division floors, so a malformed
// non-multiple still renders a sane count instead of a fabricated ratio.
export const blobCountFromGas = (blobGasUsed: string): number | undefined => {
  const used = parseDecimalInteger(blobGasUsed);
  if (used === undefined) return undefined;
  return Number(used / BLOB_GAS_PER_BLOB);
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
  align-items: center;
  flex-wrap: wrap;
`;

// Honest stop condition once the automatic future-block probing has spent
// its budget: secondary copy, not an error.
const pollStoppedNote = css`
  margin-top: var(--haze-space-3);
  font-family: var(--haze-font-sans);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
`;

// Withdrawal list inside the collapsible section: a three-column grid
// (validator index, address, amount) reading like the InfoGrid rows above.
const withdrawalsSection = css`
  margin-top: var(--haze-space-5);
`;

const withdrawalRowStyle = css`
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--haze-space-3);
  padding: var(--haze-space-2) 0;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;

  /* Phone widths: the fixed validator column + nowrap amount squeeze the
     address column to unreadability — stack one field per line instead
     (the header row stacks the same way, labels above their values). */
  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--haze-space-1);
  }
`;

const withdrawalHeaderStyle = css`
  padding-bottom: var(--haze-space-2);
  border-bottom: 1px solid var(--haze-color-border);
  color: var(--haze-color-text-muted);
  font-family: var(--haze-font-sans);
  font-size: var(--haze-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const withdrawalListStyle = css`
  list-style: none;
  margin: 0;
  padding: 0;
  /* Post-Shanghai mainnet blocks carry up to 16 withdrawals and a
     misbehaving RPC can report far more: long lists scroll inside a
     capped window instead of stretching the card. */
  max-height: 22rem;
  overflow-y: auto;

  & > li + li {
    border-top: 1px solid var(--haze-color-border);
  }
`;

const withdrawalAmountStyle = css`
  text-align: right;
  white-space: nowrap;
`;

// Bor-style PoS chains report the zero address as the miner; this honest
// note replaces a link to the meaningless zero-address page. Sans + muted
// to read as secondary info against the mono value style.
const minerNotExposedNote = css`
  font-family: var(--haze-font-sans);
  color: var(--haze-color-text-muted);
`;

// PageHeader block, the testnet pill, and the cross-verification links on
// one row (same scale as the Blocks list header); wraps on narrow screens.
const headerRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  flex-wrap: wrap;
`;

// The found-block page stacks the details card and the Raw JSON appendix
// with the same vertical rhythm as the tx detail page's card stack.
const detailStackStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-5);
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
  const {
    data: blockInfo,
    loading,
    error,
    refetch: refetchBlock,
  } = useBlockByNumber(currentChainId, blockNumberStr);

  // Future-block hint: when the block fetch fails, a head lookup decides
  // between "does not exist yet" guidance and a genuine RPC failure. Happy
  // paths never trigger the call; the future state keeps re-probing the
  // head (see the polling effect below) until the chain catches up.
  const [latestBlock, setLatestBlock] = useState<bigint | undefined>(undefined);
  const [headChecked, setHeadChecked] = useState(false);
  // "Check again" nonce: each click re-arms exactly one head probe.
  const [checkNonce, setCheckNonce] = useState(0);
  // Latch: the automatic head probing has spent its ~5-minute budget.
  const [pollExhausted, setPollExhausted] = useState(false);

  // Reset on route change so a head read for a previous chain is never
  // compared against the current block number (and the poll budget is a
  // per-page budget, not a per-visit one).
  useEffect(() => {
    setLatestBlock(undefined);
    setHeadChecked(false);
    setCheckNonce(0);
    setPollExhausted(false);
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

  // Future-block polling: while the page shows the "does not exist yet"
  // state, re-probe the head every 4 s for up to ~5 minutes. The moment
  // the head reaches the requested number the block detail is refetched
  // (the error branches below are loading-gated, so the in-flight refetch
  // reads as loading rather than flashing the stale RPC error); the
  // interval tears down with the future state itself.
  const futurePending =
    !invalidNumber &&
    error !== undefined &&
    headChecked &&
    futureBlock !== undefined &&
    !pollExhausted;

  useEffect(() => {
    if (!futurePending) return;
    const startedAt = Date.now();
    const probe = async () => {
      const head = await fetchLatestBlockNumber(currentChainId);
      if (head === undefined) return;
      setLatestBlock(head);
      if (requestedBlock !== undefined && head >= requestedBlock) {
        // The chain reached the block: pull the detail.
        void refetchBlock();
      }
      if (Date.now() - startedAt >= FUTURE_BLOCK_POLL_BUDGET_MS) {
        setPollExhausted(true);
      }
    };
    const id = setInterval(() => {
      void probe();
    }, FUTURE_BLOCK_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [futurePending, currentChainId, requestedBlock, refetchBlock]);

  // Manual "Check again": one head probe per click. Deliberately not
  // budget-bound — an explicit user action always gets a fresh answer.
  useEffect(() => {
    if (checkNonce === 0) return;
    let cancelled = false;
    void fetchLatestBlockNumber(currentChainId).then(latest => {
      if (!cancelled && latest !== undefined) setLatestBlock(latest);
    });
    return () => {
      cancelled = true;
    };
  }, [checkNonce, currentChainId]);

  const handleCheckAgain = () => {
    setCheckNonce(nonce => nonce + 1);
    // The head probe can lag a cached/lagging RPC: the block may already
    // be servable even while the probe still reports a lower head.
    void refetchBlock();
  };

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

  // Bor-style PoS chains report the zero address as miner — classify so
  // the Miner row only links to a real producer address.
  const producer = blockInfo ? describeBlockProducer(blockInfo.miner) : undefined;

  // Fee/blob/withdrawal derivations for the detail grid and the
  // withdrawals section. Each collapses to undefined when the RPC omitted
  // the field or serialized it in an unparseable shape, so nothing is
  // rendered from a fabricated value.
  const nativeSymbol = getChainSymbol(currentChainId);
  const burntFees = blockInfo?.baseFeePerGas
    ? computeBurntFees(blockInfo.baseFeePerGas, blockInfo.gasUsed)
    : undefined;
  const blobCount = blockInfo?.blobGasUsed
    ? blobCountFromGas(blockInfo.blobGasUsed)
    : undefined;
  const withdrawals = blockInfo?.withdrawals;

  // Raw JSON appendix sources: both eth_getBlockByNumber shapes — full
  // transaction objects and the bare header — fetched verbatim in the
  // browser (ephemeral node data — data-separation rule) for
  // cross-checking exactly what this node reports. Keyed on the FETCHED
  // number (not the URL param) so the payloads always match the rendered
  // block.
  const blockNumberHex = blockInfo ? numberToHex(BigInt(blockInfo.number)) : undefined;
  const rawJsonFetchers = useMemo<RawJsonFetcher[]>(() => {
    if (blockNumberHex === undefined) return [];
    const loadBlock = (includeTransactions: boolean): RawJsonFetcher['load'] => {
      const load: RawJsonFetcher['load'] = async (signal?: AbortSignal) => {
        const client = await createRpcClient(currentChainId);
        return client.request(
          {
            method: 'eth_getBlockByNumber',
            params: [blockNumberHex, includeTransactions],
          },
          signal !== undefined ? { signal } : undefined,
        );
      };
      return load;
    };
    return [
      { label: 'Block (with transactions)', load: loadBlock(true) },
      { label: 'Block header (without transactions)', load: loadBlock(false) },
    ];
  }, [currentChainId, blockNumberHex]);

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

        {!invalidNumber && error && !loading && headChecked && futureBlock && (
          <EmptyState
            message={`Block ${futureBlock.requested.toLocaleString()} does not exist yet. The chain is currently at block ${futureBlock.latest.toLocaleString()}.`}
          >
            <div className={futureBlockLinks}>
              <Button variant="outline" size="sm" onClick={handleCheckAgain}>
                Check again
              </Button>
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
            {pollExhausted && (
              <p className={pollStoppedNote}>
                Automatic checking stopped after 5 minutes of waiting — use “Check again” to
                keep probing.
              </p>
            )}
          </EmptyState>
        )}

        {!invalidNumber && error && !loading && headChecked && !futureBlock && (
          <ErrorState
            message={error instanceof Error ? error.message : 'Failed to fetch block information'}
          />
        )}

        {!invalidNumber && !loading && !error && blockInfo && (
          <div className={detailStackStyle}>
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
                    {producer?.kind === 'validator' ? (
                      <CopyableHash
                        value={producer.address}
                        href={`/chain/${currentChainId}/address/${producer.address}`}
                      />
                    ) : (
                      <span className={minerNotExposedNote}>
                        Validator not exposed by this chain’s RPC
                      </span>
                    )}
                  </InfoItem>
                  <InfoItem label="Gas Limit">{formatGas(blockInfo.gasLimit)}</InfoItem>
                  <InfoItem label="Gas Used">{formatGas(blockInfo.gasUsed)}</InfoItem>
                  {blockInfo.baseFeePerGas && (
                    <InfoItem label="Base Fee Per Gas">
                      {`${formatGwei(BigInt(blockInfo.baseFeePerGas))} gwei`}
                    </InfoItem>
                  )}
                  {burntFees !== undefined && (
                    <InfoItem label="Burnt Fees">{`${formatEthValue(burntFees)} ${nativeSymbol}`}</InfoItem>
                  )}
                  {blockInfo.blobGasUsed && (
                    <InfoItem label="Blob Gas Used">
                      {`${formatGas(blockInfo.blobGasUsed)}${
                        blobCount !== undefined ? ` (${blobCount.toLocaleString()} blobs)` : ''
                      }`}
                    </InfoItem>
                  )}
                  {blockInfo.excessBlobGas && (
                    <InfoItem label="Excess Blob Gas">{formatGas(blockInfo.excessBlobGas)}</InfoItem>
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
                {withdrawals !== undefined && withdrawals.length > 0 && (
                  <Collapsible
                    title={`Withdrawals (${withdrawals.length.toLocaleString()})`}
                    className={withdrawalsSection}
                  >
                    <div className={cx(withdrawalRowStyle, withdrawalHeaderStyle)}>
                      <span>Validator</span>
                      <span>Address</span>
                      <span className={withdrawalAmountStyle}>Amount</span>
                    </div>
                    <ul className={withdrawalListStyle}>
                      {withdrawals.map(withdrawal => (
                        <li key={withdrawal.index} className={withdrawalRowStyle}>
                          {/* Validator indices share the BigInt-safe integer
                              formatting with the gas figures. */}
                          <span>{formatGas(withdrawal.validatorIndex)}</span>
                          <TypedLink
                            to={`/chain/${currentChainId}/address/${withdrawal.address}`}
                            className={linkStyle}
                          >
                            {withdrawal.address}
                          </TypedLink>
                          <span className={withdrawalAmountStyle}>
                            {`${formatWithdrawalEth(withdrawal.amount)} ${nativeSymbol}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Collapsible>
                )}
              </CardContent>
            </Card>

            {/* Raw JSON appendix: verbatim eth_getBlockByNumber payloads
                for this block, collapsed by default and fetched on first
                expand only. */}
            <RawJsonCard title="Raw JSON" fetchers={rawJsonFetchers} />
          </div>
        )}
      </PageContainer>
    </>
  );
}
