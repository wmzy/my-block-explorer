import { css } from '@linaria/core';
import { Title } from 'haze-ui';
import { TypedLink } from '@native-router/react';
import { Card, CardContent } from '@/components/ui/Card';
import { getChainInfo } from '@/config/chains';
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

export default function RouterError({ error }: { error: unknown }) {
  const text = error instanceof Error ? error.message : String(error);

  // Recover into the chain the user was actually browsing (same key the
  // landing redirect reads); /chain/1 only when nothing valid is remembered.
  const targetChainId = readRememberedChainId() ?? 1;
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
