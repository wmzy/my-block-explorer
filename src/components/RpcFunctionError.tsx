import React from 'react';
import { css } from '@linaria/core';

type Props = {
  functionName: string;
  chainId: number;
  chainName: string;
  error: string;
  onConfigureRpc: () => void;
  onRetry?: () => void;
};

const errorBoxStyles = css`
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin: 16px 0;

  .error-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;

    .icon {
      font-size: 20px;
    }

    .title {
      font-weight: 600;
      color: #991b1b;
      margin: 0;
    }
  }

  .error-content {
    color: #7f1d1d;
    font-size: 14px;
    line-height: 1.5;
    margin-bottom: 16px;

    .function-name {
      font-weight: 500;
      font-family:
        "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
        "Courier New", monospace;
      background: #fed7d7;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .chain-info {
      font-weight: 500;
    }
  }

  .error-details {
    background: #fff5f5;
    border: 1px solid #fed7d7;
    border-radius: 6px;
    padding: 12px;
    margin: 12px 0;
    font-size: 13px;
    color: #7f1d1d;
    font-family:
      "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas,
      "Courier New", monospace;
  }

  .suggestions {
    background: #fff5f5;
    border: 1px solid #fed7d7;
    border-radius: 6px;
    padding: 12px;
    margin: 12px 0;

    .suggestion-title {
      font-weight: 600;
      color: #991b1b;
      margin: 0 0 8px 0;
      font-size: 14px;
    }

    ul {
      margin: 0;
      padding-left: 20px;
      color: #7f1d1d;
      font-size: 13px;

      li {
        margin-bottom: 4px;
      }
    }
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }
`;

const buttonStyles = css`
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;

  &.primary {
    background: #dc2626;
    color: white;

    &:hover {
      background: #b91c1c;
    }
  }

  &.secondary {
    background: white;
    color: #7f1d1d;
    border: 1px solid #fecaca;

    &:hover {
      background: #fef2f2;
    }
  }
`;

export default function RpcFunctionError({
  functionName,
  chainId,
  chainName,
  error,
  onConfigureRpc,
  onRetry,
}: Props) {
  const getSuggestions = (functionName: string) => {
    switch (functionName) {
      case 'getContractCreationInfo':
        return [
          'The current RPC node may not support historical state queries',
          'Consider configuring an archive-mode RPC node',
          'Try an RPC from a provider such as Alchemy or Infura',
          'Some free RPC nodes restrict access to historical data',
        ];
      case 'getEvents':
        return [
          'The current RPC node may limit the block range for event queries',
          'Reduce the queried block range or configure a more capable RPC node',
          'Some RPC nodes cap a single query at 1000 blocks',
          'Configure an RPC node that supports wide-range queries',
        ];
      case 'getStorageAt':
        return [
          'The current RPC node may not support storage slot queries',
          'Proxy contract detection requires an RPC node that supports eth_getStorageAt',
          'Use a full node or a professional RPC service',
        ];
      default:
        return [
          'The current RPC node may have capability limitations',
          'Consider configuring a more stable, fully featured RPC node',
          'Try keeping multiple RPC nodes as fallbacks',
        ];
    }
  };

  const getFunctionDisplayName = (functionName: string) => {
    switch (functionName) {
      case 'getContractCreationInfo':
        return 'Contract creation query';
      case 'getEvents':
        return 'Event log query';
      case 'getStorageAt':
        return 'Storage slot query';
      default:
        return functionName;
    }
  };

  return (
    <div className={errorBoxStyles}>
      <div className="error-header">
        <span className="icon">⚠️</span>
        <h4 className="title">RPC call failed</h4>
      </div>

      <div className="error-content">
        <p>
          <span className="function-name">
            {getFunctionDisplayName(functionName)}
          </span>
          {' '}
          failed on
          {' '}
          <span className="chain-info">
            {chainName}
            {' '}
            (Chain ID:
            {chainId}
            )
          </span>
          .
        </p>
      </div>

      <div className="error-details">
        Error details:
        {error}
      </div>

      <div className="suggestions">
        <div className="suggestion-title">💡 Possible solutions:</div>
        <ul>
          {getSuggestions(functionName).map((suggestion, index) => (
            <li key={index}>{suggestion}</li>
          ))}
        </ul>
      </div>

      <div className="actions">
        <button className={`${buttonStyles} primary`} onClick={onConfigureRpc}>
          Configure
          {' '}
          {chainName}
          {' '}
          RPC
        </button>
        {onRetry && (
          <button className={`${buttonStyles} secondary`} onClick={onRetry}>
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
