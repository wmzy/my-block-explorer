import { css, cx } from '@linaria/core';
import { decodeAbiParameters, pad, slice } from 'viem';
import type { Hex } from 'viem';
import type { InplaceStorageType } from '@/types/storage';
import { useStorageAt } from '@/hooks/useStorageLayout';

const valueContainerStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const valueStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  padding: var(--haze-space-1) var(--haze-space-2);
  background: var(--haze-color-bg-elevated);
  border-radius: var(--haze-radius-sm);
  border: 1px solid var(--haze-color-border);
`;

const loadingStyle = css`
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

const errorStyle = css`
  color: var(--haze-color-danger);
  font-size: var(--haze-text-sm);
`;

export type StorageValuePrimitiveProps = {
  slot: Hex;
  slotCode?: ['hex' | 'bigint', string];
  offset: number;
  type: InplaceStorageType;
  chainId: number;
  address: string;
};

function getAbiTypeLabel(type: InplaceStorageType): string {
  const { label } = type;
  if (label.startsWith('contract ')) return 'address';
  if (label.startsWith('enum ')) return 'uint8';
  return label;
}

export function StorageValuePrimitive({
  slot,
  offset,
  type,
  chainId,
  address,
}: StorageValuePrimitiveProps) {
  const { value, loading, error } = useStorageAt(chainId, address, slot);

  if (loading) {
    return <span className={loadingStyle}>...</span>;
  }

  if (error) {
    return <span className={errorStyle}>Error</span>;
  }

  if (!value) {
    return <span className={valueStyle}>0x0</span>;
  }

  const label = getAbiTypeLabel(type);
  const numberOfBytes = Number(type.numberOfBytes);
  const sliceStart = 32 - (offset + numberOfBytes);
  const sliceEnd = 32 - offset;

  try {
    const paddedValue = pad(slice(value, sliceStart, sliceEnd), { size: 32 });
    const decoded = decodeAbiParameters([{ type: label }], paddedValue)[0];

    return (
      <div className={valueContainerStyle}>
        <span className={valueStyle}>{String(decoded)}</span>
      </div>
    );
  } catch {
    return <span className={valueStyle}>{value}</span>;
  }
}
