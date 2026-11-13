import React from 'react';
import { css } from '@linaria/core';

type ErrorBoundaryProps = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

const fallbackStyles = css`
  padding: 2rem;
  text-align: center;
`;

const fallbackMessageStyles = css`
  color: var(--haze-color-text-muted);
  margin-top: 0.5rem;
`;

const fallbackButtonStyles = css`
  margin-top: 1rem;
  padding: 0.5rem 1rem;
  cursor: pointer;
  border-radius: 4px;
  border: 1px solid var(--haze-color-border);
  background: var(--haze-color-bg-muted);
  color: var(--haze-color-text);
`;

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className={fallbackStyles}>
          <h2>Something went wrong</h2>
          <p className={fallbackMessageStyles}>
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className={fallbackButtonStyles}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
