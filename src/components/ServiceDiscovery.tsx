import React, { useState } from 'react';
import { css } from '@linaria/core';
import { Card, CardHeader, CardTitle, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge, StatusBadge } from './ui/Badge';
import { useAutoDiscovery } from '../hooks/useAutoDiscovery';

const container = css`
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 20px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
`;

const discoveryCard = css`
  width: 100%;
  max-width: 480px;
  text-align: center;
`;

const statusSection = css`
  margin: 24px 0;
  padding: 16px;
  border-radius: 8px;
  background-color: #f8fafc;

  @media (prefers-color-scheme: dark) {
    background-color: #0f172a;
  }
`;

const inputGroup = css`
  display: flex;
  gap: 8px;
  margin-top: 16px;
`;

const input = css`
  flex: 1;
  padding: 8px 12px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 14px;

  &:focus {
    outline: 2px solid #3b82f6;
    outline-offset: -2px;
    border-color: #3b82f6;
  }

  @media (prefers-color-scheme: dark) {
    background-color: #1e293b;
    border-color: #334155;
    color: #e2e8f0;
  }
`;

const scanningText = css`
  color: #64748b;
  font-size: 14px;
  margin-top: 8px;

  @media (prefers-color-scheme: dark) {
    color: #94a3b8;
  }
`;

const installSection = css`
  margin-top: 24px;
  padding: 16px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  text-align: left;

  @media (prefers-color-scheme: dark) {
    border-color: #334155;
  }
`;

const codeBlock = css`
  background-color: #1e293b;
  color: #e2e8f0;
  padding: 12px;
  border-radius: 6px;
  font-family: "JetBrains Mono", "Consolas", monospace;
  font-size: 13px;
  margin: 8px 0;
  overflow-x: auto;
`;

export function ServiceDiscovery() {
  const {
    status,
    serviceInfo,
    error,
    isScanning,
    currentPort,
    discover,
    setApiUrl,
    reset,
  } = useAutoDiscovery();

  const [customUrl, setCustomUrl] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);

  const handleManualConnect = async () => {
    if (!customUrl.trim()) return;

    setIsConnecting(true);
    const success = await setApiUrl(customUrl.trim());
    setIsConnecting(false);

    if (!success) {
      // 错误信息已经在hook中设置
    }
  };

  const handleRescan = async () => {
    reset();
    await discover();
  };

  const getStatusInfo = () => {
    switch (status) {
      case 'discovering':
        return {
          badge: <StatusBadge status="pending">正在扫描</StatusBadge>,
          message: '正在扫描本地端口以查找Block Explorer服务...',
          submessage: currentPort ? `当前检查端口: ${currentPort}` : '',
        };
      case 'found':
        return {
          badge: <StatusBadge status="online">服务已连接</StatusBadge>,
          message: `已找到Block Explorer服务`,
          submessage: serviceInfo ? `地址: ${serviceInfo.url}` : '',
        };
      case 'not-found':
        return {
          badge: <StatusBadge status="offline">未找到服务</StatusBadge>,
          message: '在默认端口范围内未找到Block Explorer服务',
          submessage: '请确保本地服务正在运行，或手动输入API地址',
        };
      case 'error':
        return {
          badge: <StatusBadge status="offline">连接错误</StatusBadge>,
          message: '连接时发生错误',
          submessage: error || '未知错误',
        };
      default:
        return {
          badge: <Badge variant="default">准备就绪</Badge>,
          message: '准备搜索Block Explorer服务',
          submessage: '',
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <div className={container}>
      <Card className={discoveryCard}>
        <CardHeader>
          <CardTitle>Block Explorer</CardTitle>
          <p
            className={css`
              color: #64748b;
              margin: 8px 0 0 0;
              font-size: 14px;
            `}
          >
            区块链浏览器需要连接到本地API服务
          </p>
        </CardHeader>

        <CardContent>
          <div className={statusSection}>
            {statusInfo.badge}
            <div
              className={css`
                margin-top: 12px;
              `}
            >
              <div
                className={css`
                  font-weight: 500;
                  margin-bottom: 4px;
                `}
              >
                {statusInfo.message}
              </div>
              {statusInfo.submessage && (
                <div className={scanningText}>{statusInfo.submessage}</div>
              )}
            </div>
          </div>

          {/* 服务信息 */}
          {serviceInfo && (
            <div className={statusSection}>
              <h4
                className={css`
                  margin: 0 0 12px 0;
                  font-size: 16px;
                `}
              >
                服务信息
              </h4>
              <div
                className={css`
                  display: grid;
                  gap: 8px;
                  text-align: left;
                  font-size: 14px;
                `}
              >
                <div>
                  地址:
                  {' '}
                  <code>{serviceInfo.url}</code>
                </div>
                {serviceInfo.version && (
                  <div>
                    版本:
                    {' '}
                    <code>{serviceInfo.version}</code>
                  </div>
                )}
                {serviceInfo.latency && (
                  <div>
                    延迟:
                    {' '}
                    <code>
                      {serviceInfo.latency}
                      ms
                    </code>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 操作按钮 */}
          <div
            className={css`
              display: flex;
              gap: 12px;
              margin-top: 20px;
            `}
          >
            <Button
              onClick={handleRescan}
              loading={isScanning}
              disabled={isScanning || isConnecting}
              variant="primary"
            >
              {status === 'idle' ? '开始扫描' : '重新扫描'}
            </Button>

            {status === 'not-found' && (
              <Button
                variant="outline"
                onClick={() => setCustomUrl('http://localhost:8201')}
              >
                手动连接
              </Button>
            )}
          </div>

          {/* 手动连接 */}
          {(status === 'not-found' || customUrl) && (
            <div
              className={css`
                margin-top: 20px;
              `}
            >
              <h4
                className={css`
                  margin: 0 0 12px 0;
                  font-size: 14px;
                  text-align: left;
                `}
              >
                手动输入API地址
              </h4>
              <div className={inputGroup}>
                <input
                  type="url"
                  placeholder="http://localhost:8201"
                  value={customUrl}
                  onChange={e => setCustomUrl(e.target.value)}
                  className={input}
                  onKeyDown={e => e.key === 'Enter' && handleManualConnect()}
                />
                <Button
                  onClick={handleManualConnect}
                  loading={isConnecting}
                  disabled={!customUrl.trim() || isConnecting}
                >
                  连接
                </Button>
              </div>
            </div>
          )}

          {/* 安装说明 */}
          {status === 'not-found' && (
            <div className={installSection}>
              <h4
                className={css`
                  margin: 0 0 12px 0;
                  font-size: 14px;
                `}
              >
                本地服务安装指南
              </h4>

              <p
                className={css`
                  margin: 0 0 12px 0;
                  font-size: 14px;
                  color: #64748b;
                `}
              >
                如果您还没有运行Block Explorer服务，请按照以下步骤安装：
              </p>

              <div
                className={css`
                  margin: 12px 0;
                `}
              >
                <div
                  className={css`
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 8px;
                  `}
                >
                  1. 克隆项目并安装依赖：
                </div>
                <div className={codeBlock}>
                  git clone &lt;repository-url&gt; block-explorer
                  <br />
                  cd block-explorer
                  <br />
                  npm install
                </div>
              </div>

              <div
                className={css`
                  margin: 12px 0;
                `}
              >
                <div
                  className={css`
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 8px;
                  `}
                >
                  2. 启动开发服务器：
                </div>
                <div className={codeBlock}>npm run dev</div>
              </div>

              <div
                className={css`
                  margin: 12px 0;
                `}
              >
                <div
                  className={css`
                    font-size: 14px;
                    font-weight: 500;
                    margin-bottom: 8px;
                  `}
                >
                  3. 或者只启动后端服务：
                </div>
                <div className={codeBlock}>npm run dev:server</div>
              </div>

              <p
                className={css`
                  margin: 12px 0 0 0;
                  font-size: 13px;
                  color: #64748b;
                `}
              >
                默认情况下，服务将在端口 8201-8205 中的一个启动。
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
