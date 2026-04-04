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
`;

const headerSectionStyle = css`
  text-align: center;
  margin-bottom: var(--haze-space-6);
`;

const titleStyle = css`
  font-size: var(--haze-text-3xl);
  font-weight: var(--haze-weight-bold);
  color: #ffffff;
  margin: 0 0 var(--haze-space-2) 0;
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

  @media (prefers-color-scheme: dark) {
    color: #f9fafb;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }
`;

const descriptionStyle = css`
  font-size: var(--haze-text-base);
  color: rgba(255, 255, 255, 0.85);
  margin: 0;
  line-height: var(--haze-leading-relaxed);

  @media (prefers-color-scheme: dark) {
    color: rgba(249, 250, 251, 0.85);
  }
`;

const cardStyle = css`
  margin-bottom: var(--haze-space-4);
  border-radius: var(--haze-radius-lg);
  box-shadow:
    0 4px 6px -1px rgba(0, 0, 0, 0.1),
    0 2px 4px -2px rgba(0, 0, 0, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  transition:
    transform 0.2s ease,
    box-shadow 0.2s ease;

  &:hover {
    transform: translateY(-2px);
    box-shadow:
      0 10px 15px -3px rgba(0, 0, 0, 0.1),
      0 4px 6px -4px rgba(0, 0, 0, 0.1),
      0 0 0 1px rgba(255, 255, 255, 0.15) inset;
  }

  @media (prefers-color-scheme: dark) {
    background-color: var(--haze-color-bg-dark, #1f2937);
    box-shadow:
      0 4px 6px -1px rgba(0, 0, 0, 0.3),
      0 2px 4px -2px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset;

    &:hover {
      box-shadow:
        0 10px 15px -3px rgba(0, 0, 0, 0.4),
        0 4px 6px -4px rgba(0, 0, 0, 0.25),
        0 0 0 1px rgba(255, 255, 255, 0.08) inset;
    }
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
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  font-size: var(--haze-text-xs);
  font-weight: var(--haze-weight-semibold);
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.05em;

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
  }
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
  color: var(--haze-color-text);
  margin: 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const cardDescriptionStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin: 0 0 var(--haze-space-5) 0;
  line-height: var(--haze-leading-relaxed);

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-secondary-dark, #9ca3af);
  }
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
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #ffffff;
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-bold);
  flex-shrink: 0;
  box-shadow: 0 2px 4px rgba(102, 126, 234, 0.3);

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
    box-shadow: 0 2px 4px rgba(129, 140, 248, 0.4);
  }
`;

const stepContentStyle = css`
  flex: 1;
  min-width: 0;
`;

const stepLabelStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text);
  margin: 0 0 var(--haze-space-2) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const codeBlockWrapperStyle = css`
  position: relative;
`;

const codeBlockStyle = css`
  background-color: var(--haze-color-bg-subtle, #f3f4f6);
  border: 1px solid var(--haze-color-border, #e5e7eb);
  border-radius: var(--haze-radius-md);
  padding: var(--haze-space-3) var(--haze-space-4);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  overflow-x: auto;
  margin: 0;
  white-space: pre;

  @media (prefers-color-scheme: dark) {
    background-color: #1f2937;
    border-color: #374151;
    color: #e5e7eb;
  }
`;

const commandPartStyle = css`
  color: var(--haze-color-primary, #667eea);
  font-weight: var(--haze-weight-medium);

  @media (prefers-color-scheme: dark) {
    color: #818cf8;
  }
`;

const argPartStyle = css`
  color: #059669;

  @media (prefers-color-scheme: dark) {
    color: #34d399;
  }
`;

const copyButtonStyle = css`
  position: absolute;
  top: var(--haze-space-2);
  right: var(--haze-space-2);
  opacity: 0;
  transition: opacity 0.15s ease;

  .codeBlockWrapperStyle:hover & {
    opacity: 1;
  }
`;

const tabContainerStyle = css`
  display: flex;
  gap: var(--haze-space-1);
  margin-bottom: var(--haze-space-3);
  padding: var(--haze-space-1);
  background-color: var(--haze-color-bg-subtle, #f3f4f6);
  border-radius: var(--haze-radius-md);
  border: 1px solid var(--haze-color-border, #e5e7eb);

  @media (prefers-color-scheme: dark) {
    background-color: #1f2937;
    border-color: #374151;
  }
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
  color: var(--haze-color-text-secondary);

  &:hover {
    background-color: rgba(255, 255, 255, 0.5);
  }

  &.activeTab {
    background-color: #ffffff;
    color: var(--haze-color-text);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-secondary-dark, #9ca3af);

    &:hover {
      background-color: rgba(255, 255, 255, 0.1);
    }

    &.activeTab {
      background-color: #374151;
      color: #f9fafb;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    }
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
    background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.3), transparent);
  }

  @media (prefers-color-scheme: dark) {
    &::before,
    &::after {
      background: linear-gradient(to right, transparent, rgba(255, 255, 255, 0.15), transparent);
    }
  }
`;

const dividerTextStyle = css`
  font-size: var(--haze-text-xs);
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
  letter-spacing: 0.1em;

  @media (prefers-color-scheme: dark) {
    color: rgba(249, 250, 251, 0.5);
  }
`;

const remoteCardTitleStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  margin: 0 0 var(--haze-space-3) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const remoteCardDescriptionStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
  margin: 0 0 var(--haze-space-4) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-secondary-dark, #9ca3af);
  }
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

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const inputStyle = css`
  width: 100%;
  padding: var(--haze-space-3);
  border: 1px solid var(--haze-color-border, #e5e7eb);
  border-radius: var(--haze-radius-md);
  font-size: var(--haze-text-base);
  color: var(--haze-color-text);
  background-color: var(--haze-color-bg, #ffffff);
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease;

  &::placeholder {
    color: var(--haze-color-text-tertiary, #9ca3af);
  }

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary, #667eea);
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.15);
  }

  @media (prefers-color-scheme: dark) {
    background-color: #1f2937;
    border-color: #374151;
    color: #f9fafb;

    &:focus {
      border-color: #818cf8;
      box-shadow: 0 0 0 3px rgba(129, 140, 248, 0.2);
    }
  }
`;

const buttonGroupStyle = css`
  display: flex;
  justify-content: flex-end;
`;

const errorWrapperStyle = css`
  margin-top: var(--haze-space-3);
`;

const copiedToastStyle = css`
  position: absolute;
  top: var(--haze-space-2);
  right: var(--haze-space-2);
  padding: var(--haze-space-1) var(--haze-space-2);
  background-color: #059669;
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
                      className={copyButtonStyle}
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
            <h2 className={remoteCardTitleStyle}>Connect to Remote API</h2>
            <p className={remoteCardDescriptionStyle}>
              Connect to an externally hosted API service.
            </p>

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
