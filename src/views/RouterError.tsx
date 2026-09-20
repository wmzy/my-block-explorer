import { css } from '@linaria/core';
import { Title } from 'haze-ui';
import { TypedLink, useMatched } from '@native-router/react';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackendOfflineState } from '@/components/ui/ErrorState';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';
import { ApiError } from '@/util/apiError';
import { isBackendUnreachable } from '@/util/http';
import { getChainInfo, isChainSupported } from '@/config/chains';
import { readRememberedChainId } from '@/views/Home/Landing';

const page = css`
  max-width: 640px;
  margin: 10vh auto;
  padding: 0 16px;
`;

const message = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  word-break: break-all;
`;

// /chain/<id> segment of a crashed route's path, when present and a plain
// positive integer.
function parseChainIdFromPath(pathname: string): number | undefined {
  const match = /\/chain\/(\d+)/.exec(pathname);
  const parsed = match !== null ? Number.parseInt(match[1], 10) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

// The contract address of a crashed /chain/<id>/contract/<addr> route, when
// the path carries a well-formed one.
function parseContractAddressFromPath(pathname: string): string | undefined {
  const match = /\/chain\/\d+\/contract\/(0x[a-fA-F0-9]{40})/.exec(pathname);
  return match?.[1];
}

// The contract source loader rejects with ApiError 404 + code
// 'not_a_contract' when the address has no on-chain code (an EOA): a fact
// about the address, not a failure of the explorer. Deep links land here in
// the error slot long before the crashed view's own not-a-contract state
// could render, so this branch turns the generic "Something went wrong"
// into an honest verdict with the address page as the way out.
function isNotAContractError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 404 && error.code === 'not_a_contract';
}

export default function RouterError({ error }: { error: unknown }) {
  const text = error instanceof Error ? error.message : String(error);

  // Loader failures for indexed surfaces (contract source, storage layout,
  // events) reject with an ApiError status 0 long before the crashed view's
  // own error state could render — this slot is the first place the user
  // lands. Attribute those to the missing backend with the self-help state
  // instead of the generic "Something went wrong" card and its raw message.
  const { reconnect } = useServiceDiscovery();
  const [retryPending, setRetryPending] = useState(false);

  // Recover into the chain the failed navigation was on. Render-phase
  // errors still sit inside the crashed route's matched context (absent
  // when the error slot renders outside it — hence the runtime-optional
  // handling); resolve-phase failures (loader/guard crashes) commit no
  // location at all, and there the browser URL is the failed location —
  // on a failed deep link it is exactly the path the user opened. Only
  // when neither source yields a usable chain fall back to the remembered
  // chain (same key the landing redirect reads) and finally /chain/1.
  // A derived id must additionally be a supported chain, or the recovery
  // link would just replay the failure.
  const matched: ReturnType<typeof useMatched> | undefined = useMatched();
  const crashedPath = matched?.location.pathname ?? window.location.pathname;
  const crashedChainId = parseChainIdFromPath(crashedPath);
  const targetChainId =
    (crashedChainId !== undefined && isChainSupported(crashedChainId)
      ? crashedChainId
      : undefined) ??
      readRememberedChainId() ??
      1;
  const targetChainName = getChainInfo(targetChainId)?.name ?? 'Ethereum';

  // All hooks above; the offline branch may return early.
  if (isNotAContractError(error)) {
    const address = parseContractAddressFromPath(crashedPath);
    return (
      <div className={page}>
        <Card variant="outlined">
          <CardContent>
            <Title level={3}>This address is not a contract</Title>
            <p className={message}>{text}</p>
            <p>
              It holds no on-chain code on {targetChainName} — it is an
              externally owned account (or has none deployed). Open it as a
              regular address instead.
            </p>
            {address !== undefined && (
              <p>
                <TypedLink to={`/chain/${targetChainId}/address/${address}`}>
                  View as address →
                </TypedLink>
              </p>
            )}
            <p>
              <TypedLink to={`/chain/${targetChainId}`}>
                Back to {targetChainName}
              </TypedLink>
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isBackendUnreachable(error)) {
    const handleRetryConnection = () => {
      setRetryPending(true);
      void reconnect().then(service => {
        // A live backend re-runs this route's loader from a clean slate;
        // still nothing → stay on the offline state (no reload loop).
        if (service !== null) {
          window.location.reload();
        } else {
          setRetryPending(false);
        }
      });
    };
    return (
      <div className={page}>
        <Card variant="outlined">
          <CardContent>
            <BackendOfflineState
              onRetryConnection={handleRetryConnection}
              retryConnectionPending={retryPending}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={page}>
      <Card variant="outlined">
        <CardContent>
          <Title level={3}>Something went wrong</Title>
          <p className={message}>{text}</p>
          <p>
            <TypedLink to={`/chain/${targetChainId}`}>
              Back to {targetChainName}
            </TypedLink>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
