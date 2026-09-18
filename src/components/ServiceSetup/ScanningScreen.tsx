import { css, cx } from '@linaria/core';

type ScanningScreenProps = {
  /** Candidate ports, all probed concurrently. */
  ports: readonly number[];
};

const containerStyle = css`
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--haze-color-bg);
`;

const cardStyle = css`
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-xl);
  box-shadow: var(--haze-shadow-lg);
  padding: var(--haze-space-10) var(--haze-space-8);
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
  background: var(--haze-color-border);
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
  border: 2px solid var(--haze-color-border);
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
  background: var(--haze-color-bg-muted);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: var(--haze-shadow-sm);

  &::after {
    content: '';
    width: 18px;
    height: 18px;
    border: 2px solid var(--haze-color-primary);
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
  color: var(--haze-color-text);
  margin: 0 0 var(--haze-space-5) 0;
`;

const portStatusStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text-secondary);
  margin: 0 0 var(--haze-space-6) 0;
  min-height: 28px;
  font-family: var(--haze-font-mono);
`;

const progressContainerStyle = css`
  margin: 0 0 var(--haze-space-3) 0;
`;

// Indeterminate bar: the probes run concurrently, so there is no N-of-M
// progress to show — the shimmer communicates activity, the per-probe
// timeout bounds the wait.
const progressBarBgStyle = css`
  width: 100%;
  height: 6px;
  background-color: var(--haze-color-bg-muted);
  border-radius: var(--haze-radius-sm);
  overflow: hidden;
`;

const progressBarFillStyle = css`
  height: 100%;
  width: 100%;
  background-color: var(--haze-color-primary);
  border-radius: var(--haze-radius-sm);
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(
      90deg,
      transparent 0%,
      var(--haze-color-text-inverse) 50%,
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
  color: var(--haze-color-text-muted);
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
  transition: all 0.3s ease;
`;

// Every port is being probed at once, so every dot is live for the whole
// (sub-2s) scan.
const portDotActiveStyle = css`
  background-color: var(--haze-color-primary);
  box-shadow: 0 0 8px var(--haze-color-primary);
  transform: scale(1.3);
  animation: dot-pulse 1.4s ease-in-out infinite;

  @keyframes dot-pulse {
    0%,
    100% {
      transform: scale(1.1);
    }
    50% {
      transform: scale(1.4);
    }
  }
`;

export function ScanningScreen({ ports }: ScanningScreenProps) {
  const first = ports[0] ?? 0;
  const last = ports[ports.length - 1] ?? 0;
  const statusText =
    ports.length > 1
      ? `Checking ports ${first}–${last} in parallel`
      : `Checking port ${first}`;

  return (
    <div className={containerStyle}>
      <div className={cardStyle}>
        <div className={scanLineStyle} />
        <div className={iconContainerStyle}>
          <div className={pulseRingStyle} />
          <div className={pulseIconStyle} />
        </div>
        <h2 className={titleStyle}>Scanning for local services...</h2>
        <p className={portStatusStyle}>{statusText}</p>
        <div className={progressContainerStyle}>
          <div className={progressBarBgStyle}>
            <div className={progressBarFillStyle} />
          </div>
          <p className={progressTextStyle}>
            {ports.length > 1
              ? `${ports.length} ports probed at once`
              : 'This takes at most a couple of seconds'}
          </p>
        </div>
        <div className={portListStyle}>
          {ports.map(port => (
            <div key={port} className={cx(portDotStyle, portDotActiveStyle)} />
          ))}
        </div>
      </div>
    </div>
  );
}
