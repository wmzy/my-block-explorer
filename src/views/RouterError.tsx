import { css } from '@linaria/core';
import { Title } from 'haze-ui';
import { TypedLink, useMatched } from '@native-router/react';
import { Card, CardContent } from '@/components/ui/Card';
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

export default function RouterError({ error }: { error: unknown }) {
  const text = error instanceof Error ? error.message : String(error);

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
