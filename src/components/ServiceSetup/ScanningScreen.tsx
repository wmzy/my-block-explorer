import { css, cx } from '@linaria/core';

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
  background: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  background-attachment: fixed;

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%);
  }
`;

const cardStyle = css`
  background-color: var(--haze-color-bg, #ffffff);
  border-radius: var(--haze-radius-lg, 12px);
  box-shadow:
    0 20px 40px rgba(0, 0, 0, 0.15),
    0 0 0 1px rgba(255, 255, 255, 0.1) inset;
  padding: var(--haze-space-10, 40px) var(--haze-space-12, 48px);
  text-align: center;
  max-width: 420px;
  width: 90%;
  position: relative;
  overflow: hidden;

  &:hover {
    box-shadow:
      0 25px 50px rgba(0, 0, 0, 0.2),
      0 0 0 1px rgba(255, 255, 255, 0.15) inset;
  }

  @media (prefers-color-scheme: dark) {
    background-color: var(--haze-color-bg-dark, #1f2937);
    box-shadow:
      0 20px 40px rgba(0, 0, 0, 0.3),
      0 0 0 1px rgba(255, 255, 255, 0.05) inset;

    &:hover {
      box-shadow:
        0 25px 50px rgba(0, 0, 0, 0.4),
        0 0 0 1px rgba(255, 255, 255, 0.08) inset;
    }
  }
`;

const scanLineStyle = css`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.4), transparent);
  animation: scan-line 2s ease-in-out infinite;

  @keyframes scan-line {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    90% {
      opacity: 1;
    }
    100% {
      transform: translateY(380px);
      opacity: 0;
    }
  }

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(90deg, transparent, rgba(129, 140, 248, 0.5), transparent);
  }
`;

const iconContainerStyle = css`
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto var(--haze-space-8, 32px);
`;

const pulseRingStyle = css`
  position: absolute;
  inset: 0;
  border: 3px solid rgba(102, 126, 234, 0.3);
  border-radius: 50%;
  animation: pulse-ring 2s ease-out infinite;

  @keyframes pulse-ring {
    0% {
      transform: scale(0.8);
      opacity: 1;
    }
    100% {
      transform: scale(1.4);
      opacity: 0;
    }
  }

  @media (prefers-color-scheme: dark) {
    border-color: rgba(129, 140, 248, 0.4);
  }
`;

const pulseIconStyle = css`
  position: absolute;
  inset: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.4);

  &::after {
    content: '';
    width: 20px;
    height: 20px;
    border: 2px solid rgba(255, 255, 255, 0.8);
    border-radius: 50%;
    animation: pulse-core 1.5s ease-in-out infinite;
  }

  @keyframes pulse-core {
    0%,
    100% {
      transform: scale(0.9);
      opacity: 0.8;
    }
    50% {
      transform: scale(1);
      opacity: 1;
    }
  }

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(135deg, #818cf8 0%, #a78bfa 100%);
    box-shadow: 0 4px 15px rgba(129, 140, 248, 0.5);
  }
`;

const titleStyle = css`
  font-size: var(--haze-text-2xl, 24px);
  font-weight: var(--haze-weight-bold, 700);
  color: var(--haze-color-text, #1f2937);
  margin: 0 0 var(--haze-space-4, 16px) 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const portStatusStyle = css`
  font-size: var(--haze-text-lg, 18px);
  font-weight: var(--haze-weight-semibold, 600);
  color: var(--haze-color-text, #1f2937);
  margin: 0 0 var(--haze-space-6, 24px) 0;
  min-height: 28px;
  font-family: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-dark, #f9fafb);
  }
`;

const progressContainerStyle = css`
  margin: 0 0 var(--haze-space-3, 12px) 0;
`;

const progressBarBgStyle = css`
  width: 100%;
  height: 8px;
  background-color: rgba(102, 126, 234, 0.15);
  border-radius: 4px;
  overflow: hidden;
  position: relative;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(129, 140, 248, 0.2);
  }
`;

const progressBarFillStyle = css`
  height: 100%;
  background: linear-gradient(90deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  border-radius: 4px;
  transition: width 0.3s ease;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.3) 50%,
      transparent 100%
    );
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }

  @media (prefers-color-scheme: dark) {
    background: linear-gradient(90deg, #818cf8 0%, #a78bfa 50%, #c084fc 100%);
  }
`;

const progressTextStyle = css`
  font-size: var(--haze-text-sm, 14px);
  color: var(--haze-color-text-secondary, #6b7280);
  margin: var(--haze-space-2, 8px) 0 0 0;

  @media (prefers-color-scheme: dark) {
    color: var(--haze-color-text-secondary-dark, #9ca3af);
  }
`;

const portListStyle = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--haze-space-2, 8px);
  margin-top: var(--haze-space-4, 16px);
`;

const portDotStyle = css`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background-color: rgba(102, 126, 234, 0.2);
  transition: all 0.3s ease;

  @media (prefers-color-scheme: dark) {
    background-color: rgba(129, 140, 248, 0.2);
  }
`;

const portDotActiveStyle = css`
  background-color: #667eea;
  box-shadow: 0 0 8px rgba(102, 126, 234, 0.6);
  transform: scale(1.2);

  @media (prefers-color-scheme: dark) {
    background-color: #818cf8;
    box-shadow: 0 0 8px rgba(129, 140, 248, 0.7);
  }
`;

const portDotCheckedStyle = css`
  background-color: #10b981;

  @media (prefers-color-scheme: dark) {
    background-color: #34d399;
  }
`;

export function ScanningScreen({ currentPort, portIndex, totalPorts }: ScanningScreenProps) {
  const progress = totalPorts > 0 ? (portIndex / totalPorts) * 100 : 0;

  return (
    <div className={containerStyle}>
      <div className={cardStyle}>
        <div className={scanLineStyle} />
        <div className={iconContainerStyle}>
          <div className={pulseRingStyle} />
          <div className={pulseIconStyle} />
        </div>
        <h2 className={titleStyle}>Scanning for local services...</h2>
        <p className={portStatusStyle}>
          {currentPort !== null ? `Checking port ${currentPort}` : 'Initializing...'}
        </p>
        <div className={progressContainerStyle}>
          <div className={progressBarBgStyle}>
            <div className={progressBarFillStyle} style={{ width: `${progress}%` }} />
          </div>
          <p className={progressTextStyle}>
            Port {portIndex} of {totalPorts}
          </p>
        </div>
        <div className={portListStyle}>
          {Array.from({ length: totalPorts }, (_, i) => {
            const dotIndex = i + 1;
            const isActive = dotIndex === portIndex;
            const isChecked = dotIndex < portIndex;
            return (
              <div
                key={i}
                className={cx(
                  portDotStyle,
                  isActive ? portDotActiveStyle : '',
                  isChecked ? portDotCheckedStyle : '',
                )}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
