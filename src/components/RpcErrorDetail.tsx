import React, { useState } from 'react';
import { css } from '@linaria/core';

const errorDetailStyles = css`
  background: #fff5f5;
  border: 1px solid #feb2b2;
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;

  .error-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;

    h4 {
      margin: 0;
      color: #c53030;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .toggle-btn {
      background: none;
      border: none;
      color: #c53030;
      cursor: pointer;
      font-size: 14px;

      &:hover {
        text-decoration: underline;
      }
    }
  }

  .error-summary {
    color: #742a2a;
    margin-bottom: 12px;
    font-weight: 500;
  }

  .error-details {
    background: white;
    border: 1px solid #fed7d7;
    border-radius: 6px;
    padding: 12px;
    margin-top: 12px;

    .detail-section {
      margin-bottom: 16px;

      &:last-child {
        margin-bottom: 0;
      }

      h5 {
        margin: 0 0 8px 0;
        color: #c53030;
        font-size: 14px;
        font-weight: 600;
      }

      p {
        margin: 0 0 8px 0;
        color: #742a2a;
        font-size: 14px;
        line-height: 1.4;
      }

      .code-block {
        background: #f7fafc;
        border: 1px solid #e2e8f0;
        border-radius: 4px;
        padding: 8px;
        font-family: 'Monaco', 'Menlo', monospace;
        font-size: 12px;
        color: #2d3748;
        overflow-x: auto;

        .copy-btn {
          float: right;
          background: #e2e8f0;
          border: none;
          border-radius: 3px;
          padding: 2px 6px;
          font-size: 10px;
          cursor: pointer;
          margin-left: 8px;

          &:hover {
            background: #cbd5e0;
          }
        }
      }

      .troubleshooting-list {
        list-style: none;
        padding: 0;
        margin: 0;

        li {
          margin-bottom: 4px;
          padding-left: 16px;
          position: relative;
          color: #742a2a;
          font-size: 13px;

          &:before {
            content: '→';
            position: absolute;
            left: 0;
            color: #c53030;
          }
        }
      }
    }
  }

  .retry-section {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #fed7d7;

    .retry-btn {
      background: #c53030;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;

      &:hover {
        background: #9c2626;
      }

      &:disabled {
        background: #a0aec0;
        cursor: not-allowed;
      }
    }

    .config-btn {
      background: #3182ce;
      color: white;
      border: none;
      border-radius: 4px;
      padding: 6px 12px;
      font-size: 12px;
      cursor: pointer;

      &:hover {
        background: #2c5282;
      }
    }

    .retry-info {
      font-size: 12px;
      color: #742a2a;
    }
  }
`;

type RpcErrorDetailProps = {
  error: string;
  blockNumber?: number;
  contractAddress?: string;
  rpcUrl?: string;
  chainId?: number;
  chainName?: string;
  suggestion: string;
  castCommand?: string;
  retryable: boolean;
  troubleshooting: string[];
  onRetry?: () => void;
  onConfigureRpc?: () => void;
};

export default function RpcErrorDetail({
  error,
  blockNumber,
  contractAddress,
  rpcUrl,
  chainId,
  chainName,
  suggestion,
  castCommand,
  retryable,
  troubleshooting,
  onRetry,
  onConfigureRpc,
}: RpcErrorDetailProps) {
  const [expanded, setExpanded] = useState(false);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      // 可以添加一个临时的复制成功提示
    });
  };

  return (
    <div className={errorDetailStyles}>
      <div className="error-header">
        <h4>🚨 RPC节点错误</h4>
        <button className="toggle-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? '收起详情' : '查看详情'}
        </button>
      </div>

      <div className="error-summary">{suggestion}</div>

      {expanded && (
        <div className="error-details">
          <div className="detail-section">
            <h5>错误信息</h5>
            <p>{error}</p>
          </div>

          {(blockNumber ?? contractAddress ?? rpcUrl) && (
            <div className="detail-section">
              <h5>请求详情</h5>
              {chainId && chainName && (
                <p>
                  <strong>链:</strong>
                  {' '}
                  {chainName}
                  {' '}
                  (ID:
                  {' '}
                  {chainId}
                  )
                </p>
              )}
              {blockNumber && (
                <p>
                  <strong>区块:</strong>
                  {' '}
                  {blockNumber.toLocaleString()}
                </p>
              )}
              {contractAddress && (
                <p>
                  <strong>合约:</strong>
                  {' '}
                  {contractAddress}
                </p>
              )}
              {rpcUrl && (
                <p>
                  <strong>RPC:</strong>
                  {' '}
                  {rpcUrl}
                </p>
              )}
            </div>
          )}

          {castCommand && (
            <div className="detail-section">
              <h5>验证命令</h5>
              <p>使用以下命令可以直接验证RPC节点是否正常工作：</p>
              <div className="code-block">
                <button className="copy-btn" onClick={() => copyToClipboard(castCommand)}>
                  复制
                </button>
                {castCommand}
              </div>
            </div>
          )}

          <div className="detail-section">
            <h5>故障排除步骤</h5>
            <ul className="troubleshooting-list">
              {troubleshooting.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="retry-section">
        {retryable && onRetry && (
          <button className="retry-btn" onClick={onRetry}>
            重试
          </button>
        )}

        {onConfigureRpc && (
          <button className="config-btn" onClick={onConfigureRpc}>
            配置RPC
          </button>
        )}

        <span className="retry-info">
          {retryable ? '此错误可能是临时的，建议重试' : '此错误通常需要更换RPC节点'}
        </span>
      </div>
    </div>
  );
}
