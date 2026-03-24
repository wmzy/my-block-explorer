import { css, cx } from '@linaria/core';
import type { Hex } from 'viem';
import { useStorageAt } from '@/hooks/useStorageLayout';

const slotDisplayStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
`;

const slotLabelStyle = css`
  color: var(--haze-color-text-muted);
`;

const slotValueStyle = css`
  color: var(--haze-color-primary);
  padding: var(--haze-space-1) var(--haze-space-2);
  background: var(--haze-color-bg-elevated);
  border-radius: var(--haze-radius-sm);
  border: 1px solid var(--haze-color-border);
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const slotLoadingStyle = css`
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

export type SlotDisplayProps = {
  chainId: number;
  address: string;
  slot: Hex;
  className?: string;
  showValues?: boolean;
};

export function SlotDisplay({
  chainId,
  address,
  slot,
  className,
  showValues = false,
}: SlotDisplayProps) {
  const { value, loading } = useStorageAt(showValues ? chainId : undefined, address, slot);

  return (
    <div className={cx(slotDisplayStyle, className)}>
      <span className={slotLabelStyle}>slot:</span>
      {!showValues ? (
        <span className={slotLoadingStyle}>-</span>
      ) : loading ? (
        <span className={slotLoadingStyle}>...</span>
      ) : (
        <span className={slotValueStyle} title={value ?? undefined}>
          {value ?? '0x0'}
        </span>
      )}
    </div>
  );
}
