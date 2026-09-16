import { css } from '@linaria/core';
import { Title } from 'haze-ui';
import { TypedLink } from '@native-router/react';
import { Card, CardContent } from '@/components/ui/Card';

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

  return (
    <div className={page}>
      <Card variant="outlined">
        <CardContent>
          <Title level={3}>Something went wrong</Title>
          <p className={message}>{text}</p>
          <p>
            <TypedLink to="/chain/1">Back to Ethereum mainnet</TypedLink>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
