import { css, cx } from '@linaria/core';
import { useState, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/ErrorState';

type SetupRequiredScreenProps = {
  error: string | null;
  isConnecting: boolean;
  onSetApiUrl: (url: string) => Promise<boolean>;
  onDiscover: () => void;
};

type PackageManager = 'npx' | 'pnpm' | 'bunx';

const PACKAGE_MANAGERS: { key: PackageManager; label: string; command: string }[] = [
  { key: 'npx', label: 'npx', command: 'npx my-block-explorer --port 8201' },
  { key: 'pnpm', label: 'pnpm dlx', command: 'pnpm dlx my-block-explorer --port 8201' },
  { key: 'bunx', label: 'bunx', command: 'bunx my-block-explorer --port 8201' },
];

const containerStyle = css`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--haze-space-4);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  background-attachment: fixed;

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%);
  }
`;

const contentWrapperStyle = css`
  width: 100%;
  max-width: 540px;
  animation: content-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1);

  @keyframes content-enter {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const headerSectionStyle = css`
  text-align: center;
  margin-bottom: var(--haze-space-6);
`;

const titleStyle = css`
  font-size: var(--haze-text-4xl, 36px);
  font-weight: var(--haze-weight-bold);
  color: #ffffff;
  margin: 0 0 var(--haze-space-2) 0;
  letter-spacing: -0.02em;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.2);
`;

const descriptionStyle = css`
  font-size: var(--haze-text-base);
  color: rgba(255, 255, 255, 0.75);
  margin: 0;
  line-height: var(--haze-leading-relaxed);
`;

const cardStyle = css`
  margin-bottom: var(--haze-space-4);
  background: rgba(255, 255, 255, 0.12);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: var(--haze-radius-xl, 16px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease;

  &:hover {
    background: rgba(255, 255, 255, 0.16);
    border-color: rgba(255, 255, 255, 0.25);
    transform: translateY(-2px);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
  }
`;

const cardContentStyle = css`
  padding: var(--haze-space-6);
`;

const recommendedBadgeStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
  padding: var(--haze-space-1) var(--haze-space-3);
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.3), rgba(255, 255, 255, 0.15));
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-semibold);
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const cardTitleRowStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--haze-space-3);
`;

const cardTitleStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: rgba(255, 255, 255, 0.95);
  margin: 0;
`;

const cardDescriptionStyle = css`
  font-size: var(--haze-text-sm);
  color: rgba(255, 255, 255, 0.65);
  margin: 0 0 var(--haze-space-5) 0;
  line-height: var(--haze-leading-relaxed);
`;

const stepsContainerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const stepItemStyle = css`
  display: flex;
  align-items: flex-start;
  gap: var(--haze-space-3);
`;

const stepNumberStyle = css`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0.1));
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ffffff;
  font-size: var(--haze-text-base);
  font-weight: var(--haze-weight-bold);
  flex-shrink: 0;
`;

const stepContentStyle = css`
  flex: 1;
  min-width: 0;
`;

const stepLabelStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: rgba(255, 255, 255, 0.85);
  margin: 0 0 var(--haze-space-2) 0;
`;

const codeBlockWrapperStyle = css`
  position: relative;
`;

const codeBlockStyle = css`
  display: block;
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--haze-radius-md);
  padding: var(--haze-space-3) var(--haze-space-4);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: rgba(255, 255, 255, 0.9);
  overflow-x: auto;
  margin: 0;
  white-space: pre;
`;

const commandPartStyle = css`
  color: rgba(255, 255, 255, 0.95);
  font-weight: var(--haze-weight-medium);
`;

const argPartStyle = css`
  color: rgba(134, 239, 172, 0.9);
`;

const codeActionStyle = css`
  position: absolute;
  top: var(--haze-space-2);
  right: var(--haze-space-2);
  opacity: 0;
  transition: opacity 0.15s ease;

  .codeBlockWrapperStyle:hover & {
    opacity: 1;
  }
`;

const copiedToastStyle = css`
  position: absolute;
  top: var(--haze-space-2);
  right: var(--haze-space-2);
  padding: var(--haze-space-1) var(--haze-space-2);
  background: rgba(34, 197, 94, 0.9);
  backdrop-filter: blur(8px);
  color: #ffffff;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-medium);
  border-radius: var(--haze-radius-sm);
  animation: toast-fade 1.5s ease forwards;

  @keyframes toast-fade {
    0% {
      opacity: 1;
      transform: translateY(0);
    }
    70% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translateY(-4px);
    }
  }
`;

const tabContainerStyle = css`
  display: flex;
  gap: var(--haze-space-1);
  margin-bottom: var(--haze-space-3);
  padding: 3px;
  background: rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: var(--haze-radius-md);
`;

const tabStyle = css`
  flex: 1;
  padding: var(--haze-space-2) var(--haze-space-3);
  border: none;
  border-radius: var(--haze-radius-sm);
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  cursor: pointer;
  transition: all 0.15s ease;
  background-color: transparent;
  color: rgba(255, 255, 255, 0.6);

  &:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  &.activeTab {
    background: rgba(255, 255, 255, 0.2);
    color: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
`;

const dividerStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-4);
  margin: var(--haze-space-4) 0;

  &::before,
  &::after {
    content: '';
    flex: 1;
    height: 1px;
    background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.2), transparent);
  }
`;

const dividerTextStyle = css`
  font-size: var(--haze-text-xs);
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.1em;
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
  color: rgba(255, 255, 255, 0.7);
`;

const inputStyle = css`
  width: 100%;
  padding: var(--haze-space-3);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: var(--haze-radius-md);
  font-size: var(--haze-text-base);
  color: #ffffff;
  background: rgba(0, 0, 0, 0.15);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &::placeholder {
    color: rgba(255, 255, 255, 0.35);
  }

  &:focus {
    outline: none;
    border-color: rgba(255, 255, 255, 0.4);
    box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.1);
  }
`;

const buttonGroupStyle = css`
  display: flex;
  justify-content: flex-end;
`;

const errorWrapperStyle = css`
  margin-top: var(--haze-space-3);
`;

export function SetupRequiredScreen({
  error,
  isConnecting,
  onSetApiUrl,
  onDiscover,
}: SetupRequiredScreenProps) {
  const [packageManager, setPackageManager] = useState<PackageManager>('npx');
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  const currentCommand = PACKAGE_MANAGERS.find(p => p.key === packageManager)?.command ?? '';

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(currentCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Silent fail - clipboard may be unavailable
    }
  }, [currentCommand]);

  const handleConnect = async () => {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    await onSetApiUrl(trimmedUrl);
  };

  const handleRefresh = () => {
    onDiscover();
  };

  const commandParts = currentCommand.split(' --port ');
  const commandBase = commandParts[0] ?? '';
  const commandPort = commandParts[1] ?? '';

  return (
    <div className={containerStyle}>
      <div className={contentWrapperStyle}>
        <header className={headerSectionStyle}>
          <h1 className={titleStyle}>Block Explorer Setup</h1>
          <p className={descriptionStyle}>
            No local API service detected. Start a local service or connect to a remote endpoint.
          </p>
        </header>

        <Card className={cardStyle}>
          <CardContent className={cardContentStyle}>
            <div className={cardTitleRowStyle}>
              <h2 className={cardTitleStyle}>Install Local Service</h2>
              <span className={recommendedBadgeStyle}>Recommended</span>
            </div>
            <p className={cardDescriptionStyle}>
              Run your own API service for optimal performance and data privacy.
            </p>

            <div className={tabContainerStyle}>
              {PACKAGE_MANAGERS.map(pm => (
                <button
                  key={pm.key}
                  type="button"
                  className={cx(tabStyle, packageManager === pm.key && 'activeTab')}
                  onClick={() => setPackageManager(pm.key)}
                >
                  {pm.label}
                </button>
              ))}
            </div>

            <div className={stepsContainerStyle}>
              <div className={stepItemStyle}>
                <div className={stepNumberStyle}>1</div>
                <div className={stepContentStyle}>
                  <p className={stepLabelStyle}>Run the command to start the service</p>
                  <div className={codeBlockWrapperStyle}>
                    <code className={codeBlockStyle}>
                      <span className={commandPartStyle}>{commandBase}</span>
                      <span className={argPartStyle}> --port {commandPort}</span>
                    </code>
                    {copied && <span className={copiedToastStyle}>Copied!</span>}
                    <Button
                      variant="ghost"
                      size="sm"
                      className={codeActionStyle}
                      onClick={handleCopy}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              </div>

              <div className={stepItemStyle}>
                <div className={stepNumberStyle}>2</div>
                <div className={stepContentStyle}>
                  <p className={stepLabelStyle}>The page will automatically detect the service</p>
                  <Button variant="secondary" size="sm" onClick={handleRefresh}>
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className={dividerStyle}>
          <span className={dividerTextStyle}>or</span>
        </div>

        <Card className={cardStyle}>
          <CardContent className={cardContentStyle}>
            <h2 className={cardTitleStyle}>Connect to Remote API</h2>
            <p className={cardDescriptionStyle}>Connect to an externally hosted API service.</p>

            <form className={formStyle} onSubmit={e => e.preventDefault()}>
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
                  onClick={handleConnect}
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
    </div>
  );
}
