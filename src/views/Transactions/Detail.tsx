import { css } from '@linaria/core';
import { Fragment, useMemo, useState, useEffect } from 'react';

import { TypedLink, useMatched } from '@native-router/react';
import { decodeEventLog, type Abi, type Hex } from 'viem';

import TopNavigation from '@/components/TopNavigation';
import { RawDataBlock } from '@/components/transactions/RawDataBlock';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { linkStyle, monoStyle } from '@/components/ui/DataTable';
import { ExternalLinks } from '@/components/ui/ExternalLinks';
import { ErrorState } from '@/components/ui/ErrorState';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { LoadingState } from '@/components/ui/LoadingState';
import { PageContainer, PageHeader, BackButton } from '@/components/ui/PageLayout';
import { POPULAR_CHAINS, getChainInfo, getChainName, getChainSymbol } from '@/config/chains';
import { getExternalTxLinks } from '@/config/externalTools';
import { redirectReplace, navigateBack } from '@/views/Home/Landing';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';
import { finalityLabelFor, useFinalityHeads } from '@/services/blocks';
import { useContractSource } from '@/services/contracts';
import { useTransactionByHash } from '@/services/chainRpc';
import { useTokenMetadata } from '@/services/tokenMetadata';
import { useLatestBlocksFeed } from '@/services/homeFeed';
import type { DecodedTokenTransfer } from '@/utils/tokenTransferDecode';
import type { RpcLogEntry, RpcTxAuthorization } from '@/utils/blockRpcData';
import { createRpcClient } from '@/utils/realTimeData';
import {
  decodeFunctionCall,
  decodeRevertReason,
  extractRevertData,
  formatCallArgs,
  selectorOf,
} from '@/utils/txDecode';
import { formatGasPrice, formatNumber, formatTokenAmount, formatValue } from '@/utils/format';

const getTxTypeText = (type: number): string => {
  const types: Record<number, string> = {
    0: 'Legacy',
    1: 'EIP-2930',
    2: 'EIP-1559',
    3: 'EIP-4844 (Blob)',
    4: 'EIP-7702',
  };
  return types[type] ?? `Type ${type}`;
};

// Gas amounts are plain unit counts: BigInt-parse first (block gas figures
// stay far below Number.MAX_SAFE_INTEGER, so the Number step is exact).
const formatGas = (gas: string): string => {
  try {
    return Number(BigInt(gas)).toLocaleString();
  } catch {
    return gas;
  }
};

// status: 1 → success, 0 → failed, -1 → pending (no receipt yet, NOT failed).
function TxStatusBadge({ status }: { status: number }) {
  if (status === 1) {
    return (
      <Badge variant="success" size="sm">
        Success
      </Badge>
    );
  }
  if (status === 0) {
    return (
      <Badge variant="error" size="sm">
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="default" size="sm">
      Pending
    </Badge>
  );
}

// Wrong-chain lookups: viem raises TransactionNotFoundError, and some
// providers answer with an RPC error whose message embeds "not found".
const isTxNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const name = 'name' in error ? String(error.name) : '';
  const message = 'message' in error ? String(error.message) : '';
  return name === 'TransactionNotFoundError' || /not found|could not be found/i.test(message);
};

const logRawStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  word-break: break-all;
  white-space: pre-wrap;
  margin: var(--haze-space-2) 0 0;
`;

// The detail page stacks its main info card and the optional function-call /
// revert-reason / event-logs cards with uniform vertical rhythm.
const stackStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-5);
`;

const logEntryStyle = css`
  padding-bottom: var(--haze-space-4);
  border-bottom: 1px solid var(--haze-color-border);

  &:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
`;

const logHeaderStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  flex-wrap: wrap;
  font-size: var(--haze-text-xs);
`;

// External signature-lookup affordance for an undecoded topic0: the same ↗
// marker ExternalLinks uses, scaled to sit inside the raw hex block.
const topicLinkArrowStyle = css`
  font-size: 10px;
  opacity: 0.5;
  margin-left: var(--haze-space-1);
`;

// One receipt log: numbered entry, emitter address link, and either the
// ABI-decoded event signature (when the emitter is the called contract and
// its ABI is known) or the raw topics + data fallback. A log emitter is by
// definition a contract, so the address targets the contract view; the raw
// fallback links topic0 to the openchain signature database — the standard
// lookup for an unknown event selector.
function EventLogEntry({
  log,
  index,
  chainId,
  toAddress,
  abi,
}: {
  log: RpcLogEntry;
  index: number;
  chainId: number;
  toAddress: string;
  abi: Abi | null;
}) {
  const canDecode =
    abi !== null && toAddress.length > 0 && log.address.toLowerCase() === toAddress.toLowerCase();

  let decoded: string | null = null;
  if (canDecode) {
    try {
      const event = decodeEventLog({
        abi,
        data: log.data as Hex,
        topics: log.topics as [Hex, ...Hex[]],
      });
      const rawArgs: unknown = event.args;
      const args = Array.isArray(rawArgs)
        ? rawArgs
        : Object.values((rawArgs as Record<string, unknown>) ?? {});
      // viem types eventName as possibly-undefined for generic ABIs; skip
      // the signature when the name is missing and fall back to raw.
      decoded =
        event.eventName !== undefined
          ? args.length > 0
            ? `${event.eventName}(${formatCallArgs(args)})`
            : event.eventName
          : null;
    } catch {
      // Selector/shape mismatch against the ABI — fall back to raw.
      decoded = null;
    }
  }

  return (
    <div className={logEntryStyle}>
      <div className={logHeaderStyle}>
        <span>
          Log #{index + 1}
          {log.logIndex !== undefined ? ` (index ${log.logIndex})` : ''}
        </span>
        <CopyableHash value={log.address} href={`/chain/${chainId}/contract/${log.address}`} />
      </div>
      {decoded !== null ? (
        <div className={logRawStyle}>{decoded}</div>
      ) : (
        <div className={logRawStyle}>
          {log.topics.length > 0 && (
            <a
              className={linkStyle}
              href={`https://openchain.xyz/signatures?query=${log.topics[0]}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {log.topics[0]}
              <span className={topicLinkArrowStyle}>↗</span>
            </a>
          )}
          {log.topics.length > 1 ? `\n${log.topics.slice(1).join('\n')}` : ''}
          {`\n${log.data}`}
        </div>
      )}
    </div>
  );
}

type RevertState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'decoded'; reason: string }
  | { kind: 'unavailable' };

// Persistent small print under the revert replay result, at the same visual
// level as the best-effort copy: the replay's known semantic limit.
const replayCaveatStyle = css`
  margin: var(--haze-space-2) 0 0;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

// Best-effort revert reason: replays the exact call against the node at the
// tx's block. Any failure (including nodes without archive state) degrades
// to an honest "unavailable" note — never a page error.
function RevertReasonCard({
  chainId,
  txHash,
  toAddress,
  fromAddress,
  inputData,
  blockNumber,
  gasLimit,
  abi,
}: {
  chainId: number;
  txHash: string;
  toAddress: string;
  fromAddress: string;
  inputData: string | undefined;
  /** null while the transaction is pending — nothing to replay against. */
  blockNumber: string | null;
  gasLimit: string;
  abi: Abi | null;
}) {
  const [state, setState] = useState<RevertState>({ kind: 'idle' });

  useEffect(() => {
    // Nothing to replay against (plain transfers / contract creation), and
    // a pending transaction has no block state to replay at either.
    if (!toAddress || !inputData || inputData === '0x' || blockNumber === null) {
      setState({ kind: 'idle' });
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });

    const replay = async () => {
      try {
        const client = await createRpcClient(chainId);
        await client.call({
          to: toAddress as Hex,
          data: inputData as Hex,
          account: fromAddress as Hex,
          blockNumber: BigInt(blockNumber),
          gas: BigInt(gasLimit),
        });
        // Resolved without reverting — nothing to report.
        if (!cancelled) setState({ kind: 'unavailable' });
      } catch (err) {
        if (cancelled) return;
        const data = extractRevertData(err);
        if (data !== null) {
          // Unknown payloads still shown raw; decodeRevertReason handles
          // Error(string), Panic(uint256) and ABI custom errors.
          const reason = decodeRevertReason(data, abi ?? undefined);
          setState({ kind: 'decoded', reason: reason ?? data });
        } else {
          setState({ kind: 'unavailable' });
        }
      }
    };

    void replay();
    return () => {
      cancelled = true;
    };
  }, [chainId, txHash, toAddress, fromAddress, inputData, blockNumber, gasLimit, abi]);

  if (state.kind === 'idle') return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Revert Reason (best effort)</CardTitle>
      </CardHeader>
      <CardContent>
        {state.kind === 'loading' && <p>Checking revert reason…</p>}
        {state.kind === 'decoded' && <span className={monoStyle}>{state.reason}</span>}
        {state.kind === 'unavailable' && (
          <p>
            Reason unavailable — replaying the call did not return a revert string. Replays of older
            transactions can fail on nodes without archive state.
          </p>
        )}
        {/* Always present once the card renders, in every state: eth_call at
            block N executes against end-of-block state, not the interim
            state right before this transaction ran, so an earlier tx in the
            same block can change the replay's outcome. */}
        <p className={replayCaveatStyle}>
          Replayed against end-of-block state — transactions earlier in the same block may alter
          the result.
        </p>
      </CardContent>
    </Card>
  );
}

// Selector + ABI-decoded signature + always-visible raw input hex. Rendered
// only for contract calls (non-empty input, known target); missing/failed
// ABI decode degrades to the selector + raw hex — never an error state.
function FunctionCallCard({
  inputData,
  toAddress,
  abi,
}: {
  inputData: string | undefined;
  toAddress: string | undefined;
  abi: Abi | null;
}) {
  const hasInput = inputData !== undefined && inputData !== '' && inputData !== '0x';
  if (!hasInput || !toAddress) return null;

  const selector = selectorOf(inputData);
  const decoded = abi !== null ? decodeFunctionCall(inputData, abi) : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Function Call</CardTitle>
      </CardHeader>
      <CardContent>
        <InfoGrid>
          <InfoItem label="Method">
            <span className={monoStyle}>{selector ?? 'Unknown'}</span>
          </InfoItem>
          {decoded !== null && (
            <InfoItem label="Function">
              <span className={monoStyle}>
                {`${decoded.functionName}(${formatCallArgs(decoded.args)})`}
              </span>
            </InfoItem>
          )}
        </InfoGrid>
        <RawDataBlock title="Raw Input" data={inputData} />
      </CardContent>
    </Card>
  );
}

// The not-found card's cause list: relaxed spacing, one cause per line.
const notFoundListStyle = css`
  margin: 12px 0 0;
  padding-left: 20px;
  display: grid;
  gap: 8px;
  color: var(--haze-color-text, #374151);
`;

// Inline link-look button for the not-found card's recovery paths: real
// <button> semantics (focus, Enter activation) without native button chrome
// inside running prose.
const notFoundActionButtonStyle = css`
  padding: 0;
  border: none;
  background: none;
  font: inherit;
  font-family: var(--haze-font-mono);
  color: var(--haze-color-primary);
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

// The tx-not-found card. A valid-looking hash with no match has exactly
// three realistic causes, each with its own recovery path. The previous
// single "may exist on another network or be pending" sentence folded the
// reorg case in and sent orphaned-transaction owners hunting through
// chains that never had the hash. The hash itself stays visible and
// copyable — without a found transaction this card is the only place it
// appears on the page.
function TxNotFoundCard({
  txHash,
  chainId,
  onChainChange,
  onRetry,
}: {
  txHash: string;
  chainId: number;
  onChainChange: (newChainId: number) => void;
  onRetry: () => void;
}) {
  // Same-hash quick jumps for the wrong-network cause: the tx hash is
  // chain-agnostic, so switching re-resolves this exact hash on the target
  // chain instead of kicking the user to the chain home page.
  const otherPopularChains = POPULAR_CHAINS.filter(chain => chain.id !== chainId).slice(0, 4);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Transaction Not Found</CardTitle>
      </CardHeader>
      <CardContent>
        <p>
          <CopyableHash
            value={txHash}
            truncated={`${txHash.slice(0, 10)}…${txHash.slice(-8)}`}
            className={monoStyle}
          />
        </p>
        <p>
          {`No transaction with this hash is known to ${getChainName(chainId)}. This usually means one of three things:`}
        </p>
        <ul className={notFoundListStyle}>
          <li>
            <strong>Still pending.</strong> The transaction was broadcast but not mined yet, or this
            explorer&apos;s indexer has not reached its block. Give it a minute, then{' '}
            <button type="button" className={notFoundActionButtonStyle} onClick={onRetry}>
              try again
            </button>
            .
          </li>
          <li>
            <strong>Different network.</strong> A transaction hash only exists on the chain it was
            signed for. Use the chain selector above
            {otherPopularChains.length > 0 && (
              <>
                , re-check this hash on{' '}
                {otherPopularChains.map((chain, index) => (
                  <Fragment key={chain.id}>
                    {index > 0 && ', '}
                    <button
                      type="button"
                      className={notFoundActionButtonStyle}
                      onClick={() => onChainChange(chain.id)}
                    >
                      {chain.name}
                    </button>
                  </Fragment>
                ))}
              </>
            )}
            , or{' '}
            <TypedLink to="/search" className={linkStyle}>
              search across chains
            </TypedLink>
            .
          </li>
          <li>
            <strong>Reorged out.</strong> The transaction was once confirmed but its block was
            orphaned in a chain reorganization. If you know its block number, open{' '}
            <TypedLink to={`/chain/${chainId}/blocks`} className={linkStyle}>
              the block list
            </TypedLink>{' '}
            and check whether that block still contains it.
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

// Page header + cross-verification links on one row; wraps under the
// header on narrow screens instead of overflowing.
const headerLinksRow = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  flex-wrap: wrap;
  gap: var(--haze-space-3);
`;

// The Confirmations row value: the count and, when the chain reports
// finality heads, the Safe/Finalized badge on one baseline.
const confirmationsRowStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

// The confirmation count of a mined tx against the polled head. Three
// honest outcomes only: the count itself, an explicit placeholder while the
// head is still unknown (never a fabricated 0), and Unknown when the cached
// block sits above the current head — the reorged-out case, where a
// negative count would mislead.
function ConfirmationCount({
  headNumber,
  blockNumber,
}: {
  headNumber: bigint | undefined;
  blockNumber: string;
}) {
  if (headNumber === undefined) return <>…</>;
  const confirmations = headNumber - BigInt(blockNumber);
  if (confirmations < 0n) {
    return (
      <span title="Transaction block is above the current chain head (likely reorged out)">
        Unknown
      </span>
    );
  }
  return <>{formatNumber(confirmations)}</>;
}

// One token-movement row of the Token Transfers card: standard head of
// badge + From → To, then the human-readable amount once metadata lands.
const transferRowStyle = css`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: var(--haze-space-1) var(--haze-space-3);
  padding-bottom: var(--haze-space-4);
  border-bottom: 1px solid var(--haze-color-border);

  &:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
`;

const transferArrowStyle = css`
  color: var(--haze-color-text-muted);
`;

// The "For …" amount rides the mono font like every other numeric on the
// page; a pending-metadata amount shows the raw base units instead.
const transferAmountStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  word-break: break-all;
`;

const transferMetaStyle = css`
  width: 100%;
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

const transferKindLabel: Record<DecodedTokenTransfer['kind'], string> = {
  erc20: 'ERC-20',
  erc721: 'ERC-721',
  erc1155_single: 'ERC-1155',
  erc1155_batch: 'ERC-1155',
};

const TRUNCATED_ADDRESS = (address: string): string =>
  `${address.slice(0, 8)}…${address.slice(-6)}`;

// Human-readable transfer amount per standard. ERC-20 needs decimals from
// the token's metadata; until that lands (or when it is honestly
// unavailable) the raw base-unit integer is shown rather than a guessed
// decimal shift. ERC-721/1155 amounts are whole-item counts — no decimals.
function TransferAmount({
  transfer,
  decimals,
  symbol,
}: {
  transfer: DecodedTokenTransfer;
  decimals: number | null | undefined;
  symbol: string | null | undefined;
}) {
  if (transfer.kind === 'erc20') {
    const body =
      decimals === null || decimals === undefined
        ? `${transfer.value} (raw units)`
        : formatTokenAmount(BigInt(transfer.value), decimals);
    return (
      <span className={transferAmountStyle} title={`${transfer.value} base units`}>
        {body}
        {symbol ? ` ${symbol}` : ''}
      </span>
    );
  }
  if (transfer.kind === 'erc721') {
    return (
      <span className={transferAmountStyle}>{`Token ID ${transfer.tokenId}${symbol ? ` ${symbol}` : ''}`}</span>
    );
  }
  if (transfer.kind === 'erc1155_single') {
    return (
      <span className={transferAmountStyle} title={`ID ${transfer.id} × ${transfer.amount}`}>
        {`ID ${transfer.id} × ${transfer.amount}${symbol ? ` ${symbol}` : ''}`}
      </span>
    );
  }
  return (
    <span className={transferAmountStyle}>
      {transfer.ids
        .map((id, i) => `ID ${id} × ${transfer.amounts[i] ?? '?'}${symbol ? ` ${symbol}` : ''}`)
        .join(' • ')}
    </span>
  );
}

// Token movements decoded from the receipt (see utils/tokenTransferDecode):
// one row per Transfer event — From → To plus the human-readable amount.
// The token metadata hook is a network edge; while it is in flight (or when
// it honestly fails) rows fall back to raw values and refine in place.
function TokenTransfersCard({
  chainId,
  transfers,
}: {
  chainId: number;
  transfers: DecodedTokenTransfer[];
}) {
  // Unique token contracts with their standard — drives the metadata batch.
  const tokens = useMemo(() => {
    const byAddress = new Map<string, { address: string; kind: 'erc20' | 'erc721' | 'erc1155' }>();
    for (const transfer of transfers) {
      const key = transfer.token.toLowerCase();
      if (!byAddress.has(key)) {
        const kind = transfer.kind === 'erc20' ? 'erc20' : transfer.kind === 'erc721' ? 'erc721' : 'erc1155';
        byAddress.set(key, { address: transfer.token, kind });
      }
    }
    return [...byAddress.values()];
  }, [transfers]);

  const metadata = useTokenMetadata(chainId, tokens);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Token Transfers</CardTitle>
      </CardHeader>
      <CardContent>
        {transfers.map((transfer, index) => {
          const tokenMeta = metadata?.get(transfer.token.toLowerCase());
          return (
            <div
              className={transferRowStyle}
              key={`${transfer.token}-${transfer.from}-${transfer.to}-${index}`}
            >
              <Badge variant="default" size="sm">
                {transferKindLabel[transfer.kind]}
              </Badge>
              <CopyableHash
                value={transfer.from}
                truncated={TRUNCATED_ADDRESS(transfer.from)}
                href={`/chain/${chainId}/address/${transfer.from}`}
              />
              <span className={transferArrowStyle} aria-hidden="true">
                →
              </span>
              <CopyableHash
                value={transfer.to}
                truncated={TRUNCATED_ADDRESS(transfer.to)}
                href={`/chain/${chainId}/address/${transfer.to}`}
              />
              <TransferAmount
                transfer={transfer}
                decimals={tokenMeta?.decimals}
                symbol={tokenMeta?.symbol}
              />
              <span className={transferMetaStyle}>
                {'Token: '}
                <CopyableHash
                  value={transfer.token}
                  truncated={TRUNCATED_ADDRESS(transfer.token)}
                  href={`/chain/${chainId}/contract/${transfer.token}`}
                />
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// EIP-7702 delegation list: each authorization lets the signing EOA (the
// authority) run the delegate contract's code. The authority is only known
// when the node surfaces it (receipts do, some tx objects do not) — an
// absent authority is stated, not guessed from the signature.
function AuthorizationsCard({
  chainId,
  authorizations,
}: {
  chainId: number;
  authorizations: RpcTxAuthorization[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>EIP-7702 Authorizations</CardTitle>
      </CardHeader>
      <CardContent>
        {authorizations.map((authorization, index) => (
          <div className={transferRowStyle} key={`${authorization.address}-${authorization.nonce}-${index}`}>
            <InfoGrid>
              {authorization.authority ? (
                <InfoItem label="Authority">
                  <CopyableHash
                    value={authorization.authority}
                    truncated={TRUNCATED_ADDRESS(authorization.authority)}
                    href={`/chain/${chainId}/address/${authorization.authority}`}
                  />
                </InfoItem>
              ) : (
                <InfoItem label="Authority">
                  <span title="This node did not report the signing EOA">Not reported by node</span>
                </InfoItem>
              )}
              <InfoItem label="Delegates To">
                <CopyableHash
                  value={authorization.address}
                  truncated={TRUNCATED_ADDRESS(authorization.address)}
                  href={`/chain/${chainId}/contract/${authorization.address}`}
                />
              </InfoItem>
              <InfoItem label="Chain ID">{formatNumber(BigInt(authorization.chainId))}</InfoItem>
              <InfoItem label="Nonce">{formatNumber(BigInt(authorization.nonce))}</InfoItem>
            </InfoGrid>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function TransactionDetail() {
  const { params, router } = useMatched();

  const currentChainId = Number.parseInt(params.chainId ?? '1', 10);
  const chainInfo = getChainInfo(currentChainId);
  const txHash = params.txHash ?? '';

  // The service fetch guards an empty hash itself (no network), so the hook
  // runs unconditionally and the view reports the bad param.
  const { data: txInfo, loading, error, refetch } = useTransactionByHash(currentChainId, txHash);

  // ABI of the called contract, when the backend has a verified source for
  // it. Unverified contracts answer 404 (error set) or no data — both mean
  // "raw only" and are deliberately NOT treated as page failures. The
  // service guards an empty address itself, so the call is unconditional.
  const { data: sourceResponse } = useContractSource(currentChainId, txInfo?.toAddress ?? '');

  const contractAbi = useMemo<Abi | null>(() => {
    const contractSource = sourceResponse?.contractSource as { abi?: string } | undefined;
    if (!contractSource?.abi) return null;
    try {
      return JSON.parse(contractSource.abi) as Abi;
    } catch {
      return null;
    }
  }, [sourceResponse]);

  // Confirmations/finality inputs on the same polled channels the Blocks
  // views use: the finality heads behind the Safe/Finalized badge and the
  // home-feed head behind the confirmation count. Both hooks take the 0
  // guard for the unsupported-chain early return below (no RPC touched);
  // when either source fails they stay undefined and the row degrades to
  // what is actually known instead of inventing numbers.
  const headChainId = chainInfo ? currentChainId : 0;
  const finalityHeads = useFinalityHeads(headChainId).data;
  const { data: headFeed } = useLatestBlocksFeed(headChainId);

  // Mined-position facts. A pending tx has no block, so neither the
  // confirmation count nor a finality label exists yet.
  const txBlockNumber = txInfo?.blockNumber ?? null;
  const finalityLabel =
    txBlockNumber === null ? undefined : finalityLabelFor(finalityHeads, Number(txBlockNumber));
  const headBlockNumber = headFeed?.latestBlockNumber;

  const handleChainChange = (newChainId: number) => {
    // Same-params refresh via the shared replace helper: the hash is
    // chain-agnostic, so switching chains re-resolves this exact
    // transaction on the target chain's RPC instead of kicking the user
    // back to the chain home page, without pushing a history entry.
    void redirectReplace(router, `/chain/${newChainId}/tx/${txHash}`).catch(() => undefined);
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          {/* Unsupported-chain deep link: recovery CTAs instead of a bare
              error (Home/Blocks pattern). The tx-not-found branch below is
              a different, legit case and keeps its own copy. */}
          <UnsupportedChainState chainId={currentChainId} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton onClick={() => navigateBack(router, `/chain/${currentChainId}/transactions`)} />

        {/* Cross-verification in an external explorer from the page head —
            available before/without the tx resolving. */}
        <div className={headerLinksRow}>
          <PageHeader
            title="Transaction Details"
            chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
          />
          {txHash && <ExternalLinks links={getExternalTxLinks(currentChainId, txHash)} />}
        </div>

        {!txHash && <ErrorState message="Invalid transaction hash or chain ID" />}

        {txHash && loading && <LoadingState message="Loading transaction information..." />}

        {txHash && error && isTxNotFound(error) && (
          <TxNotFoundCard
            txHash={txHash}
            chainId={currentChainId}
            onChainChange={handleChainChange}
            onRetry={() => void refetch()}
          />
        )}

        {txHash && error && !isTxNotFound(error) && (
          <ErrorState
            message={
              error instanceof Error ? error.message : 'Failed to fetch transaction information'
            }
          />
        )}

        {txHash && !loading && !error && txInfo && (
          <div className={stackStyle}>
            <Card>
              <CardHeader>
                <CardTitle>Transaction Details</CardTitle>
              </CardHeader>
              <CardContent>
                <InfoGrid>
                  <InfoItem label="Transaction Hash">{txInfo.hash}</InfoItem>
                  <InfoItem label="Status">
                    <TxStatusBadge status={txInfo.status} />
                  </InfoItem>
                  <InfoItem label="Block Number">
                    {/* Pending tx (not yet mined): honest Pending text,
                        never a "0" or a /block/0 link. */}
                    {txInfo.blockNumber === null
                      ? 'Pending'
                      : formatNumber(BigInt(txInfo.blockNumber))}
                  </InfoItem>
                  {txInfo.blockNumber !== null && (
                    <InfoItem label="Confirmations">
                      <span className={confirmationsRowStyle}>
                        <ConfirmationCount
                          headNumber={headBlockNumber}
                          blockNumber={txInfo.blockNumber}
                        />
                        {finalityLabel && (
                          // Same badge semantics as the Blocks views:
                          // Finalized outranks Safe; a chain whose node
                          // reports neither tag shows the count only.
                          <Badge
                            variant={finalityLabel === 'finalized' ? 'default' : 'info'}
                            size="sm"
                          >
                            {finalityLabel === 'finalized' ? 'Finalized' : 'Safe'}
                          </Badge>
                        )}
                      </span>
                    </InfoItem>
                  )}
                  <InfoItem label="Transaction Index">
                    {txInfo.transactionIndex ?? 'Pending'}
                  </InfoItem>
                  <InfoItem label="From">
                    <CopyableHash
                      value={txInfo.fromAddress}
                      href={`/chain/${currentChainId}/address/${txInfo.fromAddress}`}
                    />
                  </InfoItem>
                  <InfoItem label="To">
                    {txInfo.toAddress ? (
                      <CopyableHash
                        value={txInfo.toAddress}
                        href={`/chain/${currentChainId}/address/${txInfo.toAddress}`}
                      />
                    ) : (
                      'Contract Creation'
                    )}
                  </InfoItem>
                  <InfoItem label="Value">
                    {/* Exact wei rides the title so the 4-decimal floor
                        never looks like lost precision. */}
                    <span title={`${txInfo.value} wei`}>
                      {formatValue(BigInt(txInfo.value), getChainSymbol(currentChainId))}
                    </span>
                  </InfoItem>
                  <InfoItem label="Gas Limit">{formatGas(txInfo.gasLimit)}</InfoItem>
                  {txInfo.gasUsed && (
                    <InfoItem label="Gas Used">{formatGas(txInfo.gasUsed)}</InfoItem>
                  )}
                  {txInfo.gasPrice && (
                    <InfoItem label="Gas Price">{formatGasPrice(txInfo.gasPrice)} gwei</InfoItem>
                  )}
                  {txInfo.maxFeePerGas && (
                    <InfoItem label="Max Fee Per Gas">
                      {formatGasPrice(txInfo.maxFeePerGas)} gwei
                    </InfoItem>
                  )}
                  {txInfo.maxPriorityFeePerGas && (
                    <InfoItem label="Max Priority Fee Per Gas">
                      {formatGasPrice(txInfo.maxPriorityFeePerGas)} gwei
                    </InfoItem>
                  )}
                  {txInfo.maxFeePerBlobGas && (
                    <InfoItem label="Max Fee Per Blob Gas">
                      {formatGasPrice(txInfo.maxFeePerBlobGas)} gwei
                    </InfoItem>
                  )}
                  {txInfo.blobVersionedHashes && txInfo.blobVersionedHashes.length > 0 && (
                    <InfoItem label="Blob Versioned Hashes">
                      {txInfo.blobVersionedHashes.join(', ')}
                    </InfoItem>
                  )}
                  {txInfo.effectiveGasPrice && (
                    <InfoItem label="Effective Gas Price">
                      {formatGasPrice(txInfo.effectiveGasPrice)} gwei
                    </InfoItem>
                  )}
                  <InfoItem label="Nonce">{txInfo.nonce}</InfoItem>
                  <InfoItem label="Transaction Type">{getTxTypeText(txInfo.type)}</InfoItem>
                  {txInfo.timestamp && (
                    <InfoItem label="Timestamp">
                      {new Date(txInfo.timestamp).toLocaleString()}
                    </InfoItem>
                  )}
                  {txInfo.contractAddress && (
                    <InfoItem label="Created Contract">
                      <TypedLink
                        to={`/chain/${currentChainId}/contract/${txInfo.contractAddress}`}
                        className={linkStyle}
                      >
                        {txInfo.contractAddress}
                      </TypedLink>
                    </InfoItem>
                  )}
                </InfoGrid>
              </CardContent>
            </Card>

            {txInfo.authorizationList && txInfo.authorizationList.length > 0 && (
              <AuthorizationsCard
                chainId={currentChainId}
                authorizations={txInfo.authorizationList}
              />
            )}

            <FunctionCallCard
              inputData={txInfo.inputData}
              toAddress={txInfo.toAddress}
              abi={contractAbi}
            />

            {txInfo.status === 0 && (
              <RevertReasonCard
                chainId={currentChainId}
                txHash={txInfo.hash}
                toAddress={txInfo.toAddress}
                fromAddress={txInfo.fromAddress}
                inputData={txInfo.inputData}
                blockNumber={txInfo.blockNumber}
                gasLimit={txInfo.gasLimit}
                abi={contractAbi}
              />
            )}

            {txInfo.tokenTransfers && txInfo.tokenTransfers.length > 0 && (
              <TokenTransfersCard
                chainId={currentChainId}
                transfers={txInfo.tokenTransfers}
              />
            )}

            {txInfo.logs.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Event Logs</CardTitle>
                </CardHeader>
                <CardContent>
                  {txInfo.logs.map((log, index) => (
                    <EventLogEntry
                      key={`${log.address}-${log.logIndex ?? index}`}
                      log={log}
                      index={index}
                      chainId={currentChainId}
                      toAddress={txInfo.toAddress}
                      abi={contractAbi}
                    />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </PageContainer>
    </>
  );
}
