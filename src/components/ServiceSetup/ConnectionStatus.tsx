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
    transform: translateY(-1px) scale(1.02);
  }

  &:active {
    transform: translateY(0) scale(1);
  }
`;

const expandedPanelStyle = css`
  position: absolute;
  bottom: calc(100% + var(--haze-space-3));
  left: 0;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  padding: var(--haze-space-5);
  min-width: 300px;
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.12),
    0 0 0 1px var(--haze-color-border);
  animation: panel-enter 0.3s cubic-bezier(0.16, 1, 0.3, 1);

  @keyframes panel-enter {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

const expandedRowStyle = css`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  padding: var(--haze-space-3) 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--haze-color-border);
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
  font-family: var(--haze-font-mono);
  background-color: var(--haze-color-bg-muted);
  padding: var(--haze-space-1) var(--haze-space-3);
  border-radius: var(--haze-radius-sm);
  border: 1px solid var(--haze-color-border);
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const actionsStyle = css`
  display: flex;
  justify-content: flex-end;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-4);
  padding-top: var(--haze-space-4);
  border-top: 1px solid var(--haze-color-border);
`;

const versionBadgeStyle = css`
  display: inline-flex;
  align-items: center;
  padding: var(--haze-space-1) var(--haze-space-2);
  background: color-mix(in srgb, var(--haze-color-primary) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--haze-color-primary) 25%, transparent);
  border-radius: var(--haze-radius-sm);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-primary);
  font-weight: var(--haze-weight-medium);
  font-family: var(--haze-font-mono);
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
