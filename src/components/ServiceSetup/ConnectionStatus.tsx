import { css } from '@linaria/core';
import { useState, useEffect, useCallback } from 'react';
import { StatusBadge } from '@/components/ui/Badge';
import { ApiClient } from '@/api/client';

type ConnectionStatusProps = {
  className?: string;
};

type HealthStatus = 'online' | 'offline' | 'unknown';

type HealthData = {
  status: 'healthy' | 'unhealthy';
  version?: string;
};

const STORAGE_KEY = 'my-block-explorer-api-url';

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
  min-width: 200px;
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

export function ConnectionStatus({ className: _className }: ConnectionStatusProps) {
  const [status, setStatus] = useState<HealthStatus>('unknown');
  const [isExpanded, setIsExpanded] = useState(false);
  const [serviceUrl, setServiceUrl] = useState<string>('');
  const [version, setVersion] = useState<string | undefined>();

  const checkHealth = useCallback(async () => {
    const savedUrl = localStorage.getItem(STORAGE_KEY);
    if (!savedUrl) {
      setStatus('unknown');
      return;
    }

    setServiceUrl(savedUrl);

    try {
      const testClient = new ApiClient(savedUrl, 5000);
      const health = await testClient.getHealth();

      if ((health as HealthData).status === 'healthy') {
        setStatus('online');
        setVersion((health as HealthData).version);
      } else {
        setStatus('offline');
      }
    } catch {
      setStatus('offline');
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  const handleToggle = () => {
    setIsExpanded(prev => !prev);
  };

  const statusText =
    status === 'online' ? 'Connected' : status === 'offline' ? 'Disconnected' : 'Unknown';

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
            <span className={valueStyle}>{serviceUrl || 'Not configured'}</span>
          </div>
          {version && (
            <div className={expandedRowStyle}>
              <span className={labelStyle}>Version</span>
              <span className={valueStyle}>{version}</span>
            </div>
          )}
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
        <StatusBadge status={status}>{statusText}</StatusBadge>
      </div>
    </div>
  );
}
