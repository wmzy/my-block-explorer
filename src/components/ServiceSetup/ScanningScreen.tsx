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
  background: rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--haze-radius-lg);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
  padding: var(--haze-space-10) var(--haze-space-12);
  text-align: center;
  max-width: 420px;
  width: 90%;
  position: relative;
  overflow: hidden;
  animation: card-enter 0.6s cubic-bezier(0.16, 1, 0.3, 1);

  @keyframes card-enter {
    from {
      opacity: 0;
      transform: translateY(20px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }
`;

const scanLineStyle = css`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
  animation: scan-line 3s ease-in-out infinite;

  @keyframes scan-line {
    0% {
      transform: translateY(0);
      opacity: 0;
    }
    10%,
    90% {
      opacity: 1;
    }
    100% {
      transform: translateY(380px);
      opacity: 0;
    }
  }
`;

const iconContainerStyle = css`
  position: relative;
  width: 80px;
  height: 80px;
  margin: 0 auto var(--haze-space-8);
`;

const pulseRingStyle = css`
  position: absolute;
  inset: 0;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  animation: pulse-ring 2s ease-out infinite;

  @keyframes pulse-ring {
    0% {
      transform: scale(0.85);
      opacity: 0.8;
    }
    100% {
      transform: scale(1.5);
      opacity: 0;
    }
  }
`;

const pulseIconStyle = css`
  position: absolute;
  inset: 14px;
  background: rgba(255, 255, 255, 0.15);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 4px 20px rgba(255, 255, 255, 0.1);

  &::after {
    content: '';
    width: 18px;
    height: 18px;
    border: 2px solid rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    animation: pulse-core 1.8s ease-in-out infinite;
  }

  @keyframes pulse-core {
    0%,
    100% {
      transform: scale(0.85);
      opacity: 0.7;
    }
    50% {
      transform: scale(1);
      opacity: 1;
    }
  }
`;

const titleStyle = css`
  font-size: var(--haze-text-2xl);
  font-weight: var(--haze-weight-bold);
  color: rgba(255, 255, 255, 0.95);
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  margin: 0 0 var(--haze-space-4) 0;
`;

const portStatusStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: rgba(255, 255, 255, 0.75);
  margin: 0 0 var(--haze-space-6) 0;
  min-height: 28px;
  font-family: var(--haze-font-mono);
`;

const progressContainerStyle = css`
  margin: 0 0 var(--haze-space-3) 0;
`;

const progressBarBgStyle = css`
  width: 100%;
  height: 6px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: var(--haze-radius-sm);
  overflow: hidden;
`;

const progressBarFillStyle = css`
  height: 100%;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.4), rgba(255, 255, 255, 0.7));
  border-radius: var(--haze-radius-sm);
  transition: width 0.3s ease;
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      rgba(255, 255, 255, 0.4) 50%,
      transparent 100%
    );
    animation: shimmer 2s infinite;
  }

  @keyframes shimmer {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(100%);
    }
  }
`;

const progressTextStyle = css`
  font-size: var(--haze-text-sm);
  color: rgba(255, 255, 255, 0.5);
  margin: var(--haze-space-2) 0 0 0;
`;

const portListStyle = css`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--haze-space-2);
  margin-top: var(--haze-space-4);
`;

const portDotStyle = css`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: rgba(255, 255, 255, 0.2);
  transition: all 0.3s ease;
`;

const portDotActiveStyle = css`
  background-color: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.4);
  transform: scale(1.3);
`;

const portDotCheckedStyle = css`
  background-color: rgba(134, 239, 172, 0.8);
  box-shadow: 0 0 6px rgba(134, 239, 172, 0.4);
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
