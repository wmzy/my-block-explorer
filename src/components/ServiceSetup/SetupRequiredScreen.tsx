import { css } from '@linaria/core';
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';

type SetupRequiredScreenProps = {
  error: string | null;
  isConnecting: boolean;
  onSetApiUrl: (url: string) => Promise<boolean>;
  onDiscover: () => void;
};

const containerStyle = css`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: var(--haze-space-6);
`;

const headingStyle = css`
  font-size: var(--haze-text-2xl);
  font-weight: var(--haze-weight-bold);
  color: var(--haze-color-text);
  margin: 0 0 var(--haze-space-2) 0;
  text-align: center;
`;

const descriptionStyle = css`
  font-size: var(--haze-text-base);
  color: var(--haze-color-text-secondary);
  margin: 0 0 var(--haze-space-6) 0;
  text-align: center;
`;

const cardStyle = css`
  max-width: 600px;
  width: 100%;
`;

const sectionHeadingStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  margin: 0 0 var(--haze-space-2) 0;
`;

const sectionDescriptionStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin: 0 0 var(--haze-space-4) 0;
`;

const stepsListStyle = css`
  list-style: none;
  padding: 0;
  margin: 0;
`;

const stepItemStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  margin-bottom: var(--haze-space-4);

  &:last-child {
    margin-bottom: 0;
  }
`;

const stepHeaderStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const stepNumberStyle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background-color: var(--haze-color-primary);
  color: white;
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-semibold);
  flex-shrink: 0;
`;

const stepTextStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  margin: 0;
`;

const codeBlockStyle = css`
  background-color: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  padding: var(--haze-space-3);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  overflow-x: auto;
  margin: 0;
  white-space: pre;
`;

const dividerStyle = css`
  width: 100%;
  height: 1px;
  background-color: var(--haze-color-border);
  margin: var(--haze-space-6) 0;
`;

const formStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const inputGroupStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const labelStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text);
`;

const inputStyle = css`
  width: 100%;
  padding: var(--haze-space-3);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
  font-size: var(--haze-text-base);
  color: var(--haze-color-text);
  background-color: var(--haze-color-bg);
  transition: border-color 0.15s ease;

  &::placeholder {
    color: var(--haze-color-text-tertiary);
  }

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }
`;

const buttonGroupStyle = css`
  display: flex;
  justify-content: flex-end;
  margin-top: var(--haze-space-2);
`;

const errorWrapperStyle = css`
  margin-top: var(--haze-space-4);
`;

export function SetupRequiredScreen({
  error,
  isConnecting,
  onSetApiUrl,
  onDiscover,
}: SetupRequiredScreenProps) {
  const [url, setUrl] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    await onSetApiUrl(trimmedUrl);
  };

  const handleRefresh = () => {
    onDiscover();
  };

  return (
    <div className={containerStyle}>
      <h1 className={headingStyle}>Block Explorer Setup</h1>
      <p className={descriptionStyle}>
        No local API service detected. Choose one of the options below:
      </p>

      <Card className={cardStyle}>
        <CardContent>
          <h2 className={sectionHeadingStyle}>Option 1: Install Local Service (Recommended)</h2>
          <p className={sectionDescriptionStyle}>
            Run your own API service for the best performance and privacy.
          </p>

          <ol className={stepsListStyle}>
            <li className={stepItemStyle}>
              <div className={stepHeaderStyle}>
                <span className={stepNumberStyle}>1</span>
                <p className={stepTextStyle}>Clone the repository and install dependencies:</p>
              </div>
              <code className={codeBlockStyle}>{'git clone <repository-url>\npnpm install'}</code>
            </li>

            <li className={stepItemStyle}>
              <div className={stepHeaderStyle}>
                <span className={stepNumberStyle}>2</span>
                <p className={stepTextStyle}>Start the development server:</p>
              </div>
              <code className={codeBlockStyle}>pnpm dev:server</code>
            </li>

            <li className={stepItemStyle}>
              <div className={stepHeaderStyle}>
                <span className={stepNumberStyle}>3</span>
                <p className={stepTextStyle}>Refresh this page to auto-detect the service</p>
              </div>
              <Button variant="secondary" size="sm" onClick={handleRefresh}>
                Refresh
              </Button>
            </li>
          </ol>
        </CardContent>
      </Card>

      <div className={dividerStyle} />

      <Card className={cardStyle}>
        <CardContent>
          <h2 className={sectionHeadingStyle}>Option 2: Use Remote API Service</h2>
          <p className={sectionDescriptionStyle}>
            Connect to a remote API service (hosted by you or others).
          </p>

          <form className={formStyle} onSubmit={handleSubmit}>
            <div className={inputGroupStyle}>
              <label className={labelStyle} htmlFor="api-url">
                API URL
              </label>
              <input
                id="api-url"
                type="url"
                className={inputStyle}
                placeholder="http://localhost:8201"
                value={url}
                onChange={e => setUrl(e.target.value)}
                required
              />
            </div>

            <div className={buttonGroupStyle}>
              <Button
                variant="primary"
                loading={isConnecting}
                disabled={!url.trim() || isConnecting}
              >
                Connect
              </Button>
            </div>

            {error && (
              <div className={errorWrapperStyle}>
                <ErrorState message={error} />
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
