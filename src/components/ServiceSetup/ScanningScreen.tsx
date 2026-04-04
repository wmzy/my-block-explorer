import { css } from '@linaria/core';

type ScanningScreenProps = {
  currentPort: number | null;
  portIndex: number;
  totalPorts: number;
};

const containerStyle = css`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
`;

const cardStyle = css`
  background-color: var(--haze-color-bg, #ffffff);
  border-radius: var(--haze-radius-lg, 12px);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  padding: var(--haze-space-10, 40px) var(--haze-space-12, 48px);
  text-align: center;
  max-width: 400px;
  width: 90%;

  @media (prefers-color-scheme: dark) {
    background-color: var(--haze-color-bg-dark, #1f2937);
  }
`;

const spinnerStyle = css`
  width: 48px;
  height: 48px;
  border: 4px solid rgba(102, 126, 234, 0.2);
  border-top-color: #667eea;
  border-radius: 50%;
  animation: scan-spin 1s linear infinite;
  margin: 0 auto var(--haze-space-6, 24px);

  @keyframes scan-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-color-scheme: dark) {
    border-color: rgba(102, 126, 234, 0.3);
    border-top-color: #818cf8;
  }
`;

const titleStyle = css`
  font-size: var(--haze-text-xl, 20px);
  font-weight: var(--haze-weight-semibold, 600);
  color: var(--haze-color-text, #1f2937);
  margin: 0 0 var(--haze-space-3, 12px) 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const portStatusStyle = css`
  font-size: var(--haze-text-sm, 14px);
  color: var(--haze-color-text-secondary, #6b7280);
  margin: 0 0 var(--haze-space-2, 8px) 0;
  min-height: 20px;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-secondary-dark, #9ca3af);
  }
`;

const progressStyle = css`
  font-size: var(--haze-text-xs, 12px);
  color: var(--haze-color-text-tertiary, #9ca3af);
  margin: 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-tertiary-dark, #6b7280);
  }
`;

export function ScanningScreen({ currentPort, portIndex, totalPorts }: ScanningScreenProps) {
  return (
    <div className={containerStyle}>
      <div className={cardStyle}>
        <div className={spinnerStyle} />
        <h2 className={titleStyle}>Scanning for local services...</h2>
        {currentPort !== null && <p className={portStatusStyle}>Checking port {currentPort}...</p>}
        <p className={progressStyle}>
          Port {portIndex} of {totalPorts}
        </p>
      </div>
    </div>
  );
}
