import React from 'react';
import { css } from '@linaria/core';
import type { RpcError } from '../types/rpc';

type Props = {
  error: RpcError;
  onConfigureRpc: () => void;
  onDismiss: () => void;
};

const alertStyles = css`
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

const iconStyles = css`
  color: #dc2626;
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
`;

const contentStyles = css`
  flex: 1;

  h4 {
    margin: 0 0 8px 0;
    color: #991b1b;
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 0 0 12px 0;
    color: #7f1d1d;
    font-size: 14px;
    line-height: 1.5;
  }

  .suggestion {
    background: #fff5f5;
    border: 1px solid #fed7d7;
    border-radius: 6px;
    padding: 12px;
    margin: 8px 0;
    font-size: 13px;
    color: #7f1d1d;
  }
`;

const actionsStyles = css`
  display: flex;
  gap: 8px;
  margin-top: 8px;
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

const closeButtonStyles = css`
  background: none;
  border: none;
  color: #991b1b;
  cursor: pointer;
  font-size: 18px;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    background: #fecaca;
  }
`;

export default function RpcErrorAlert({
  error,
  onConfigureRpc,
  onDismiss,
}: Props) {
  return (
    <div className={alertStyles}>
      <div className={iconStyles}>⚠️</div>

      <div className={contentStyles}>
        <h4>RPC connection error</h4>
        <p>
          Unable to connect to an RPC node for chain ID
          {' '}
          {error.chainId}
          .
        </p>
        <p>
          <strong>Error:</strong>
          {error.error}
        </p>

        <div className="suggestion">
          💡
          {' '}
          <strong>Suggestion:</strong>
          {error.suggestion}
        </div>

        <div className={actionsStyles}>
          <button
            className={`${buttonStyles} primary`}
            onClick={onConfigureRpc}
          >
            Configure RPC
          </button>
          <button className={`${buttonStyles} secondary`} onClick={onDismiss}>
            Dismiss
          </button>
        </div>
      </div>

      <button className={closeButtonStyles} onClick={onDismiss} title="Close">
        ×
      </button>
    </div>
  );
}
