import React from 'react';
import { css } from '@linaria/core';
import type { RpcError } from '../types/rpc';

type Props = {
  error: RpcError;
  onConfigureRpc: () => void;
  onDismiss: () => void;
};

const alertStyles = css`
  background: var(--haze-color-danger-subtle);
  border: 1px solid color-mix(in srgb, var(--haze-color-danger) 25%, transparent);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
`;

const iconStyles = css`
  color: var(--haze-color-danger);
  font-size: 20px;
  flex-shrink: 0;
  margin-top: 2px;
`;

const contentStyles = css`
  flex: 1;

  h4 {
    margin: 0 0 8px 0;
    color: var(--haze-color-danger);
    font-size: 16px;
    font-weight: 600;
  }

  p {
    margin: 0 0 12px 0;
    color: var(--haze-color-danger);
    font-size: 14px;
    line-height: 1.5;
  }

  .suggestion {
    background: var(--haze-color-bg);
    border: 1px solid color-mix(in srgb, var(--haze-color-danger) 15%, transparent);
    border-radius: 6px;
    padding: 12px;
    margin: 8px 0;
    font-size: 13px;
    color: var(--haze-color-danger);
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
    background: var(--haze-color-danger);
    color: var(--haze-color-text-inverse);

    &:hover {
      background: var(--haze-color-danger-hover);
    }
  }

  &.secondary {
    background: var(--haze-color-bg);
    color: var(--haze-color-danger);
    border: 1px solid color-mix(in srgb, var(--haze-color-danger) 25%, transparent);

    &:hover {
      background: var(--haze-color-danger-subtle);
    }
  }
`;

const closeButtonStyles = css`
  background: none;
  border: none;
  color: var(--haze-color-danger);
  cursor: pointer;
  font-size: 18px;
  padding: 4px;
  border-radius: 4px;

  &:hover {
    background: var(--haze-color-danger-subtle);
  }
`;

export default function RpcErrorAlert({ error, onConfigureRpc, onDismiss }: Props) {
  return (
    <div className={alertStyles}>
      <div className={iconStyles}>⚠️</div>

      <div className={contentStyles}>
        <h4>RPC connection error</h4>
        <p>Unable to connect to an RPC node for chain ID {error.chainId}.</p>
        <p>
          <strong>Error:</strong>
          {error.error}
        </p>

        <div className="suggestion">
          💡 <strong>Suggestion:</strong>
          {error.suggestion}
        </div>

        <div className={actionsStyles}>
          <button className={`${buttonStyles} primary`} onClick={onConfigureRpc}>
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
