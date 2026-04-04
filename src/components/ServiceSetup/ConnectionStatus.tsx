import { css } from '@linaria/core';
import { useState, useEffect, useCallback, useRef } from 'react';
import { StatusBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { useServiceDiscovery } from '@/hooks/ServiceDiscoveryContext';

const containerStyle = css`
  position: fixed;
  bottom: var(--haze-space-4);
  left: var(--haze-space-4);
  z-index: 9999;
  font-family: var(--haze-font-sans);
`;

const clickableBadgeStyle = css`
  cursor: pointer;
  transition:
    transform 0.2s ease,
    opacity 0.2s ease;
  display: inline-flex;

  &:hover {
    opacity: 0.85;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`;

const expandedPanelStyle = css`
  position: absolute;
  bottom: calc(100% + var(--haze-space-3));
  left: 0;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  padding: var(--haze-space-4);
  min-width: 280px;
  box-shadow:
    0 10px 25px rgba(0, 0, 0, 0.1),
    0 0 0 1px rgba(255, 255, 255, 0.05) inset;
  animation: panel-slide-up 0.2s ease-out;

  @keyframes panel-slide-up {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (prefers-color-scheme: dark) {
    background: var(--haze-color-bg-raised);
    border-color: rgba(255, 255, 255, 0.08);
    box-shadow:
      0 10px 25px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.03) inset;
  }
`;

const expandedRowStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  padding: var(--haze-space-2) 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--haze-color-border);
  }

  @media (prefers-color-scheme: dark) {
    border-color: rgba(255, 255, 255, 0.06);
  }
`;

const labelStyle = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-xs);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
`;

const valueStyle = css`
  color: var(--haze-color-text);
  word-break: break-all;
  text-align: right;
  font-size: var(--haze-text-sm);
`;

const urlValueStyle = css`
  color: var(--haze-color-text);
  word-break: break-all;
  text-align: right;
  font-size: var(--haze-text-sm);
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
  background-color: var(--haze-color-bg-subtle, #f3f4f6);
  padding: var(--haze-space-1) var(--haze-space-2);
  border-radius: var(--haze-radius-sm);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(0, 0, 0, 0.2);
    color: #e5e7eb;
  }
`;

const actionsStyle = css`
  display: flex;
  justify-content: flex-end;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-3);
  padding-top: var(--haze-space-3);
  border-top: 1px solid var(--haze-color-border);

  @media (prefers-color-scheme: dark) {
    border-color: rgba(255, 255, 255, 0.06);
  }
`;

const versionBadgeStyle = css`
  display: inline-flex;
  align-items: center;
  padding: var(--haze-space-1) var(--haze-space-2);
  background: linear-gradient(135deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%);
  border: 1px solid rgba(102, 126, 234, 0.2);
  border-radius: var(--haze-radius-sm);
  font-size: var(--haze-text-xs);
  color: #667eea;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(
      135deg,
      rgba(129, 140, 248, 0.15) 0%,
      rgba(167, 139, 250, 0.15) 100%
    );
    border-color: rgba(129, 140, 248, 0.25);
    color: #a78bfa;
  }
`;

type ConnectionStatusProps = {
  className?: string;
};

export function ConnectionStatus({ className: _className }: ConnectionStatusProps) {
  const { status, serviceInfo, isConnected, isScanning, disconnect, reconnect } =
    useServiceDiscovery();

  const [isExpanded, setIsExpanded] = useState(false);
  const reconnectingRef = useRef(false);

  // Auto-reconnect: poll every 30s, silently attempt reconnect on service loss
  useEffect(() => {
    if (!isConnected) return;

    let cancelled = false;

    const timer = setInterval(async () => {
      if (cancelled || reconnectingRef.current) return;

      try {
        const savedUrl = localStorage.getItem('my-block-explorer-api-url');
        if (!savedUrl) return;

        const response = await fetch(`${savedUrl}/api/health`, {
          signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('unhealthy');
      } catch {
        reconnectingRef.current = true;
        try {
          await reconnect();
        } catch {
          // Silent: auto-reconnect failure does not surface errors
        } finally {
          reconnectingRef.current = false;
        }
      }
    }, 30000);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isConnected, reconnect]);

  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setIsExpanded(false);
  }, [disconnect]);

  const handleReconnect = useCallback(async () => {
    try {
      await reconnect();
    } catch {
      // User-initiated: failure is reflected in status
    }
  }, [reconnect]);

  const badgeStatus = isConnected ? 'online' : status === 'discovering' ? 'unknown' : 'offline';

  const statusText = isConnected
    ? 'Connected'
    : status === 'discovering'
      ? 'Scanning...'
      : status === 'not-found'
        ? 'Disconnected'
        : status === 'error'
          ? 'Error'
          : 'Unknown';

  return (
    <div className={containerStyle}>
      {isExpanded && (
        <div className={expandedPanelStyle}>
          <div className={expandedRowStyle}>
            <span className={labelStyle}>Status</span>
            <span className={valueStyle}>{statusText}</span>
          </div>
          <div className={expandedRowStyle}>
            <span className={labelStyle}>URL</span>
            <span className={urlValueStyle}>{serviceInfo?.url ?? 'Not configured'}</span>
          </div>
          {serviceInfo?.version && (
            <div className={expandedRowStyle}>
              <span className={labelStyle}>Version</span>
              <span className={versionBadgeStyle}>{serviceInfo.version}</span>
            </div>
          )}
          <div className={actionsStyle}>
            {isConnected && (
              <Button variant="danger" size="sm" onClick={handleDisconnect}>
                Disconnect
              </Button>
            )}
            {status === 'not-found' && !isScanning && (
              <Button variant="primary" size="sm" onClick={handleReconnect}>
                Reconnect
              </Button>
            )}
            {status === 'discovering' && isScanning && (
              <Button variant="secondary" size="sm" disabled>
                Scanning...
              </Button>
            )}
          </div>
        </div>
      )}
      <div
        role="button"
        tabIndex={0}
        onClick={handleToggle}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleToggle();
          }
        }}
        className={clickableBadgeStyle}
      >
        <StatusBadge status={badgeStatus}>{statusText}</StatusBadge>
      </div>
    </div>
  );
}
