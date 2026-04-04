import { css } from '@linaria/core';
import { useState, useEffect } from 'react';
import { concatHex, hexToBigInt, hexToString, keccak256, pad, slice, toHex } from 'viem';
import type { Hex } from 'viem';
import { useStorageAt } from '@/hooks/useStorageLayout';

const bytesContainerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const valueStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  padding: var(--haze-space-1) var(--haze-space-2);
  background: var(--haze-color-bg-elevated);
  border-radius: var(--haze-radius-sm);
  border: 1px solid var(--haze-color-border);
  word-break: break-all;
  max-width: 400px;
`;

const loadingStyle = css`
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

export type StorageValueBytesProps = {
  slot: Hex;
  chainId: number;
  address: string;
  isString?: boolean;
  showValues?: boolean;
};

function isLongValue(data: Hex): boolean {
  return Number.parseInt(data.slice(-1), 16) % 2 === 1;
}

function getShortLength(data: Hex): bigint {
  return hexToBigInt(slice(data, 31)) / 2n;
}

export function StorageValueBytes({
  slot,
  chainId,
  address,
  isString = false,
  showValues = false,
}: StorageValueBytesProps) {
  const { value, loading } = useStorageAt(showValues ? chainId : undefined, address, slot);

  if (!showValues) {
    return <span className={loadingStyle}>-</span>;
  }

  if (loading) {
    return <span className={loadingStyle}>...</span>;
  }

  if (!value) {
    return <span className={valueStyle}>0x0</span>;
  }

  const formatValue = (v: Hex) => (isString ? hexToString(v).toString() : v);

  if (isLongValue(value)) {
    const length = (hexToBigInt(value) - 1n) / 2n;
    return (
      <LongBytesValue
        slot={slot}
        length={length}
        chainId={chainId}
        address={address}
        formatValue={formatValue}
        showValues={showValues}
      />
    );
  }

  const length = getShortLength(value);
  const truncated = length > 32n;

  if (truncated) {
    return (
      <LongBytesValue
        slot={slot}
        length={length}
        chainId={chainId}
        address={address}
        formatValue={formatValue}
        showValues={showValues}
      />
    );
  }

  const shortValue = slice(value, 0, Number(length));

  return (
    <div className={bytesContainerStyle}>
      <span className={valueStyle}>{formatValue(shortValue)}</span>
    </div>
  );
}

function LongBytesValue({
  slot,
  length,
  chainId,
  address,
  formatValue,
  showValues: _showValues = false,
}: {
  slot: Hex;
  length: bigint;
  chainId: number;
  address: string;
  formatValue: (hex: Hex) => string;
  showValues?: boolean;
}) {
  const [value, setValue] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const firstSlot = keccak256(pad(slot, { size: 32 }));
  const slotsNeeded = Math.ceil(Number(length) / 32);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    Promise.all(
      [...new Array(slotsNeeded).keys()].map(async i => {
        const slotHex = toHex(hexToBigInt(firstSlot) + BigInt(i));
        const response = await fetch(
          `/api/chains/${chainId}/contracts/${address}/storage/${slotHex}`,
        );
        if (!response.ok) return null;
        const data = await response.json();
        return data.value as Hex | null;
      }),
    ).then(results => {
      if (cancelled) return;
      const validResults = results.filter((r): r is Hex => r !== null);
      const concatenated = concatHex(validResults);
      const formatted = formatValue(slice(concatenated, 0, Number(length)));
      setValue(formatted);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [chainId, address, firstSlot, slotsNeeded, formatValue, length]);

  if (loading || !value) {
    return <span className={loadingStyle}>Loading...</span>;
  }

  return (
    <div className={bytesContainerStyle}>
      <span className={valueStyle}>{value}</span>
    </div>
  );
}
