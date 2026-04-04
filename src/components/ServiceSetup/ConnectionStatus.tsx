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
  transition: opacity 0.2s;
  display: inline-flex;

  &:hover {
    opacity: 0.8;
  }
`;

const expandedPanelStyle = css`
  position: absolute;
  bottom: calc(100% + var(--haze-space-2));
  left: 0;
  background: var(--haze-color-bg);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-lg);
  padding: var(--haze-space-3);
  min-width: 220px;
  box-shadow: var(--haze-shadow-md);

  @media (prefers-color-scheme: dark) {
    background: var(--haze-color-bg-raised);
  }
`;

const expandedRowStyle = css`
  display: flex;
  justify-content: space-between;
  gap: var(--haze-space-4);
  font-size: var(--haze-text-sm);
  padding: var(--haze-space-1) 0;

  &:not(:last-child) {
    border-bottom: 1px solid var(--haze-color-border);
  }
`;

const labelStyle = css`
  color: var(--haze-color-text-muted);
`;

const valueStyle = css`
  color: var(--haze-color-text);
  word-break: break-all;
  text-align: right;
`;

const actionsStyle = css`
  display: flex;
  justify-content: flex-end;
  margin-top: var(--haze-space-2);
  padding-top: var(--haze-space-2);
  border-top: 1px solid var(--haze-color-border);
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
            <span className={valueStyle}>{serviceInfo?.url ?? 'Not configured'}</span>
          </div>
          {serviceInfo?.version && (
            <div className={expandedRowStyle}>
              <span className={labelStyle}>Version</span>
              <span className={valueStyle}>{serviceInfo.version}</span>
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
