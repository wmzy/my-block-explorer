// Broadcast view (/chain/:chainId/broadcast): paste a fully-signed raw
// transaction, read a LOCAL decode of what it will do, then send it to
// the network through the RPC this explorer uses for the viewed chain.
// No backend endpoint is involved — the page works in pure RPC-only mode.
//
// Honesty rules this page encodes:
// - Broadcasting goes through THIS explorer's configured RPC for the
//   chain. That endpoint sees the transaction (and anything it chooses
//   to log) even though the explorer itself stores nothing about it —
//   the intro line says both facts instead of implying privacy.
// - The decode preview is computed locally in the browser from the
//   pasted bytes alone. The RPC cannot forge what is shown here, and
//   the preview card says so (its title names the provenance).
// - A transaction signed for a DIFFERENT chain is the one case where
//   broadcasting is blocked outright: the red warning names both chains
//   and the disabled button's title explains itself. Everything else —
//   pre-EIP-155 replayability, an unrecoverable sender — is disclosed
//   in amber and left to the user's judgement; the explorer is a
//   window, not a wallet.
// - Failures show the RPC's verbatim message under one human sentence
//   (common node rejections get a short classification prefix), and the
//   textarea is never auto-cleared: the pasted bytes are the only copy
//   of the transaction this page ever sees.
import { useEffect, useState } from 'react';
import { css, cx } from '@linaria/core';
import { navigate } from '@native-router/core';
import { TypedLink, useMatched } from '@native-router/react';
import { getAddress } from 'viem';
import { sendRawTransaction } from 'viem/actions';
import { Alert } from 'haze-ui';

import TopNavigation from '@/components/TopNavigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';
import { CopyableHash } from '@/components/ui/CopyableHash';
import { linkStyle, monoStyle } from '@/components/ui/DataTable';
import { InfoGrid, InfoItem } from '@/components/ui/InfoGrid';
import { BackButton, PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { getChainInfo, getChainName } from '@/config/chains';
import { formatGasPrice, formatNumber } from '@/utils/format';
import { parseChainIdParam } from '@/utils/chainParam';
import { createRpcClient } from '@/utils/realTimeData';
import {
  decodeRawTransaction,
  type DecodedRawTransaction,
  type RawTransactionDecodeResult,
} from '@/utils/rawTxDecode';
import { formatPoolValue } from '@/views/Transactions/Pending';
import { UnsupportedChainState } from '@/views/Home/UnsupportedChainState';

// One-line labels for the decoded transaction types (tx-detail naming
// family, uppercase spec form — never an invented marketing name).
const TX_TYPE_LABELS: Record<DecodedRawTransaction['type'], string> = {
  legacy: 'Legacy',
  eip2930: 'EIP-2930',
  eip1559: 'EIP-1559',
  eip4844: 'EIP-4844',
  eip7702: 'EIP-7702',
};

/**
 * Failure-card classification: common node rejections get a short human
 * prefix so the verbatim message reads in context; "already known" gets
 * its own wording (the node did not reject the transaction — it already
 * had it). Anything unrecognized passes through unchanged: the RPC's own
 * words are the most honest text this page can show.
 */
export function classifyBroadcastRejection(message: string): string {
  if (/already known|already exists/i.test(message)) {
    return `Known to this RPC node already — it may have been broadcast before: ${message}`;
  }
  if (
    /nonce too low|nonce too high|incorrect nonce|invalid nonce|insufficient funds|underpriced|intrinsic gas too low|exceeds block gas limit|invalid chain id/i.test(
      message,
    )
  ) {
    return `Rejected by the RPC node: ${message}`;
  }
  return message;
}

// --- Styles (Sql console editor family for the mono input area) ---

const rawInputArea = css`
  display: block;
  width: 100%;
  min-height: 120px;
  resize: vertical;
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
  padding: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-bg);
  color: var(--haze-color-text);

  &:focus-visible {
    outline: 2px solid var(--haze-color-primary);
    outline-offset: -1px;
  }
`;

const actionRow = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
  margin-top: var(--haze-space-3);
  flex-wrap: wrap;
`;

const noticeBox = css`
  margin-top: var(--haze-space-4);
`;

const failureLead = css`
  margin: 0 0 var(--haze-space-1) 0;
`;

// The node's verbatim rejection: mono, wrapped anywhere (RPC messages
// are long single-line strings), visually set apart from the human
// sentence above it.
const rpcMessageStyle = css`
  display: block;
  margin-top: var(--haze-space-2);
  padding: var(--haze-space-2) var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  background: var(--haze-color-bg-subtle);
  word-break: break-all;
`;

const previewCard = css`
  margin-top: var(--haze-space-5);
`;

const warningsStack = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-3);
  margin-bottom: var(--haze-space-4);
`;

// --- Components ---

type BroadcastState =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'failed'; message: string };

export default function BroadcastTransactionPage() {
  const { params, router } = useMatched();

  // An unparseable :chainId param is a broken link, not an unsupported
  // chain: parseChainIdParam returns null and the raw param travels on
  // to the unsupported state (same two-tier guard as Pending/Charts).
  const rawChainId = params.chainId;
  const parsedChainId = rawChainId === undefined ? 1 : parseChainIdParam(rawChainId);
  const currentChainId = parsedChainId ?? 0;
  const chainInfo = getChainInfo(currentChainId);

  const handleChainChange = (newChainId: number) => {
    void navigate(router, `/chain/${newChainId}/broadcast`).catch(() => undefined);
  };

  if (!chainInfo) {
    return (
      <>
        <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
        <PageContainer>
          <UnsupportedChainState chainId={currentChainId} rawChainId={rawChainId} />
        </PageContainer>
      </>
    );
  }

  return (
    <>
      <TopNavigation currentChainId={currentChainId} onChainChange={handleChainChange} />
      <PageContainer>
        <BackButton
          onClick={() => {
            void navigate(router, `/chain/${currentChainId}`).catch(() => undefined);
          }}
          label="Back to Explorer"
        />

        <PageHeader
          title="Broadcast Transaction"
          chainInfo={`${getChainName(currentChainId)} • Chain ID: ${currentChainId}`}
        />

        <BroadcastBody chainId={currentChainId} />
      </PageContainer>
    </>
  );
}

/**
 * Form + preview body, split out so the unsupported-chain early return
 * above keeps hook order stable (Pending/Charts view pattern).
 */
function BroadcastBody({ chainId }: { chainId: number }) {
  const { router } = useMatched();
  const [rawInput, setRawInput] = useState('');
  const [debouncedRaw, setDebouncedRaw] = useState('');
  const [decode, setDecode] = useState<RawTransactionDecodeResult | null>(null);
  const [broadcast, setBroadcast] = useState<BroadcastState>({ status: 'idle' });

  // Debounce the paste: decoding on every keystroke would re-render the
  // preview mid-edit; the timer resets per keystroke so only settled
  // input is ever decoded.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedRaw(rawInput), 300);
    return () => window.clearTimeout(timer);
  }, [rawInput]);

  // Async local decode (sender recovery is async in viem). Last write
  // wins: a stale resolve after a newer edit is discarded, so the
  // preview always reflects the CURRENT pasted bytes — the one thing a
  // user must be able to trust before broadcasting.
  useEffect(() => {
    const trimmed = debouncedRaw.trim();
    if (trimmed === '') {
      setDecode(null);
      return;
    }
    let cancelled = false;
    decodeRawTransaction(trimmed)
      .then(result => {
        if (!cancelled) setDecode(result);
      })
      .catch(() => {
        // The decoder's contract is never-throw; this guard only keeps
        // an unexpected runtime failure from taking the page down.
        if (!cancelled) {
          setDecode({ ok: false, error: 'The local decoder failed unexpectedly.' });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedRaw]);

  const trimmedRaw = debouncedRaw.trim();

  const tx = decode?.ok ? decode.tx : null;

  // The one hard block: a signature for another chain. Names come from
  // the chain config (getChainName falls back to "Chain <id>" for ids
  // the explorer does not know — the raw id always survives).
  const mismatchInfo =
    tx !== null && tx.chainId !== null && tx.chainId !== chainId
      ? { txChainId: tx.chainId, txChainName: getChainName(tx.chainId) }
      : null;
  const currentChainName = getChainName(chainId);

  // Value units follow the chain the transaction is SIGNED for; a
  // pre-EIP-155 transaction names no chain, so the viewed chain's unit
  // is used and the row's title discloses the assumption.
  const valueChain = getChainInfo(tx?.chainId ?? chainId);
  const valueDecimals = valueChain?.nativeCurrency.decimals ?? 18;
  const valueSymbol = valueChain?.nativeCurrency.symbol ?? 'ETH';

  const busy = broadcast.status === 'pending';
  const broadcastDisabled = tx === null || mismatchInfo !== null || busy;
  const disabledTitle = busy
    ? 'Broadcasting…'
    : tx === null
      ? trimmedRaw === ''
        ? 'Paste a signed raw transaction first'
        : 'The pasted input does not decode as a signed transaction'
      : mismatchInfo !== null
        ? `Disabled: the transaction is signed for ${mismatchInfo.txChainName} (chain ID ${mismatchInfo.txChainId}), not ${currentChainName} (chain ID ${chainId})`
        : undefined;

  const broadcastTx = async () => {
    if (tx === null || mismatchInfo !== null || busy) return;
    setBroadcast({ status: 'pending' });
    try {
      const client = await createRpcClient(chainId);
      const hash = await sendRawTransaction(client, {
        serializedTransaction: trimmedRaw as `0x${string}`,
      });
      void navigate(router, `/chain/${chainId}/tx/${hash}`).catch(() => undefined);
    } catch (err) {
      setBroadcast({
        status: 'failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Signed raw transaction</CardTitle>
          <CardDescription>
            Broadcasting sends the bytes below through the RPC endpoint this explorer
            uses for {currentChainName} — the explorer itself stores nothing about
            it. The decoded preview is computed locally in your browser, so the RPC
            cannot forge what you see.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <textarea
            className={rawInputArea}
            aria-label="Raw signed transaction"
            placeholder="0x…"
            value={rawInput}
            onChange={event => setRawInput(event.target.value)}
            spellCheck={false}
          />
          <div className={actionRow}>
            <Button
              onClick={() => {
                void broadcastTx();
              }}
              disabled={broadcastDisabled}
              title={disabledTitle}
            >
              {busy ? 'Broadcasting…' : 'Broadcast Transaction'}
            </Button>
            {/* Resets the failure state only — the pasted bytes are never
                auto-cleared; they are the only copy of the transaction. */}
            {broadcast.status === 'failed' && (
              <Button
                variant="secondary"
                onClick={() => setBroadcast({ status: 'idle' })}
              >
                Clear failure
              </Button>
            )}
          </div>

          {decode !== null && !decode.ok && (
            <div className={noticeBox}>
              <Alert variant="danger">
                Could not decode the pasted input as a signed transaction — nothing
                was sent. {decode.error}
              </Alert>
            </div>
          )}

          {broadcast.status === 'failed' && (
            <div className={noticeBox}>
              <Alert variant="danger">
                <p className={failureLead}>
                  The transaction was not accepted. The text below is the RPC
                  endpoint's own message, shown verbatim — this explorer added
                  nothing to it.
                </p>
                <code className={cx(monoStyle, rpcMessageStyle)}>
                  {classifyBroadcastRejection(broadcast.message)}
                </code>
              </Alert>
            </div>
          )}
        </CardContent>
      </Card>

      {tx !== null && (
        <Card className={previewCard}>
          <CardHeader>
            <CardTitle>Decoded locally — not yet seen by the RPC</CardTitle>
            <CardDescription>
              Everything below was derived in your browser from the pasted bytes
              alone. Nothing has been sent anywhere until you press Broadcast.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {(mismatchInfo !== null || tx.chainId === null || tx.from === null) && (
              <div className={warningsStack}>
                {mismatchInfo !== null && (
                  <Alert variant="danger">
                    <strong>Wrong network.</strong> This transaction is signed for{' '}
                    {mismatchInfo.txChainName} (chain ID {mismatchInfo.txChainId}),
                    but you are viewing {currentChainName} (chain ID {chainId}).
                    Broadcasting it here cannot reach the signing chain — the
                    button is disabled for that reason.
                  </Alert>
                )}
                {tx.chainId === null && (
                  <Alert variant="warning">
                    <strong>Legacy pre-EIP-155 transaction.</strong> It carries no
                    chain ID, so it is in principle replayable on any chain that
                    still accepts pre-EIP-155 transactions. Broadcasting stays
                    enabled — that judgement is yours, not the explorer's.
                  </Alert>
                )}
                {tx.from === null && (
                  <Alert variant="warning">
                    <strong>Sender could not be recovered.</strong> The signature
                    did not yield a sender address, so this preview cannot
                    attribute the transaction to anyone — treat it with care.
                  </Alert>
                )}
              </div>
            )}

            <InfoGrid>
              <InfoItem label="Type">
                <Badge variant="info" size="sm">
                  {TX_TYPE_LABELS[tx.type]}
                </Badge>
              </InfoItem>
              <InfoItem label="Chain ID">
                {tx.chainId === null ? (
                  <span title="Pre-EIP-155 legacy transactions carry no chain ID">
                    None (pre-EIP-155)
                  </span>
                ) : (
                  formatNumber(BigInt(tx.chainId))
                )}
              </InfoItem>
              <InfoItem label="From">
                {tx.from !== null ? (
                  <CopyableHash
                    value={getAddress(tx.from)}
                    href={`/chain/${chainId}/address/${getAddress(tx.from)}`}
                  />
                ) : (
                  <span title="No recoverable signature — the sender cannot be attributed">
                    Not recoverable
                  </span>
                )}
              </InfoItem>
              <InfoItem label="To">
                {tx.to !== null ? (
                  <TypedLink
                    to={`/chain/${chainId}/address/${getAddress(tx.to)}`}
                    className={linkStyle}
                    title={getAddress(tx.to)}
                  >
                    {getAddress(tx.to)}
                  </TypedLink>
                ) : (
                  <span title="No recipient — this transaction creates a contract">
                    Contract creation
                  </span>
                )}
              </InfoItem>
              <InfoItem label="Value">
                <span
                  title={
                    tx.chainId === null
                      ? `Denominated in ${valueSymbol} of the viewed chain — a pre-EIP-155 transaction names no chain`
                      : `${tx.value} wei`
                  }
                >
                  {formatPoolValue(tx.value, valueDecimals, valueSymbol)}
                </span>
              </InfoItem>
              <InfoItem label="Nonce">{formatNumber(tx.nonce)}</InfoItem>
              <InfoItem label="Gas Limit">{formatNumber(tx.gas)}</InfoItem>
              {tx.gasPrice !== undefined && (
                <InfoItem label="Gas Price">
                  {formatGasPrice(tx.gasPrice)} gwei
                </InfoItem>
              )}
              {tx.maxFeePerGas !== undefined && (
                <InfoItem label="Max Fee Per Gas">
                  {formatGasPrice(tx.maxFeePerGas)} gwei
                </InfoItem>
              )}
              {tx.maxPriorityFeePerGas !== undefined && (
                <InfoItem label="Max Priority Fee Per Gas">
                  {formatGasPrice(tx.maxPriorityFeePerGas)} gwei
                </InfoItem>
              )}
              {tx.maxFeePerBlobGas !== undefined && (
                <InfoItem label="Max Fee Per Blob Gas">
                  {formatGasPrice(tx.maxFeePerBlobGas)} gwei
                </InfoItem>
              )}
              {tx.accessListLength !== undefined && tx.accessListLength > 0 && (
                <InfoItem label="Access List">
                  {`${formatNumber(tx.accessListLength)} ${tx.accessListLength === 1 ? 'entry' : 'entries'}`}
                </InfoItem>
              )}
              {tx.blobVersionedHashes !== undefined && tx.blobVersionedHashes.length > 0 && (
                <InfoItem label="Blob Versioned Hashes">
                  {/* Full hashes stay one hover away behind the count. */}
                  <span title={tx.blobVersionedHashes.join('\n')}>
                    {tx.blobVersionedHashes.length}
                    {tx.blobVersionedHashes.length === 1 ? ' blob' : ' blobs'}
                  </span>
                </InfoItem>
              )}
              {tx.authorizationListLength !== undefined && tx.authorizationListLength > 0 && (
                <InfoItem label="Authorizations">
                  <span title="EIP-7702 authorization list entries">
                    {formatNumber(tx.authorizationListLength)}
                  </span>
                </InfoItem>
              )}
              <InfoItem label="Input Data">
                {tx.dataByteLength === 0 ? (
                  <span title="The transaction carries no input data">
                    Empty (0 bytes)
                  </span>
                ) : (
                  <span className={monoStyle} title={`${tx.dataByteLength} bytes`}>
                    {`${formatNumber(BigInt(tx.dataByteLength))} bytes · ${tx.dataPreview}`}
                  </span>
                )}
              </InfoItem>
            </InfoGrid>
          </CardContent>
        </Card>
      )}
    </>
  );
}
