import { css } from '@linaria/core';
import { useState } from 'react';
import { concat, keccak256, pad, toHex } from 'viem';
import type { Hex } from 'viem';
import type { StorageMapping, TypesMap } from '@/types/storage';
import { Collapsible } from '@/components/ui/Collapsible';
import { StorageValue } from './StorageValue';

const mappingContainerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const keyInputContainerStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
`;

const keyLabelStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const keyInputStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  padding: var(--haze-space-1) var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg-elevated);
  color: var(--haze-color-text);
  width: 200px;

  &:focus {
    outline: none;
    border-color: var(--haze-color-primary);
  }
`;

const valueContainerStyle = css`
  padding-left: var(--haze-space-4);
  border-left: 2px solid var(--haze-color-border);
`;

const placeholderStyle = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-muted);
  font-style: italic;
`;

export type StorageValueMappingProps = {
  slot: Hex;
  type: StorageMapping;
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
};

function encodeKey(key: string, keyType: string): { encoded: Hex; code: string } | null {
  try {
    if (keyType.startsWith('uint') || keyType.startsWith('int')) {
      const encoded = pad(toHex(BigInt(key)), { size: 32 });
      return { encoded, code: `pad(toHex(BigInt(${key})), { size: 32 })` };
    }
    if (keyType === 'bool') {
      const val = key.toLowerCase() === 'true';
      const encoded = pad(toHex(val), { size: 32 });
      return { encoded, code: `pad(toHex(${val}), { size: 32 })` };
    }
    if (keyType === 'address') {
      const encoded = pad(key as Hex, { size: 32 });
      return { encoded, code: `pad(${key} as Hex, { size: 32 })` };
    }
    if (keyType === 'bytes') {
      return { encoded: key as Hex, code: `${key} as Hex` };
    }
    if (keyType === 'string') {
      const encoded = toHex(key);
      return { encoded, code: `toHex(${key})` };
    }
  } catch {
    return null;
  }
  return null;
}

export function StorageValueMapping({
  slot,
  type,
  types,
  chainId,
  address,
  path,
}: StorageValueMappingProps) {
  const [key, setKey] = useState<string>('');
  const valueType = types[type.value];
  const keyType = types[type.key];

  if (!valueType || !keyType) {
    return <div>Unknown type</div>;
  }

  const keyEncoded = encodeKey(key, keyType.label);
  const valueSlot = keyEncoded
    ? keccak256(concat([keyEncoded.encoded, pad(slot, { size: 32 })]))
    : null;

  return (
    <Collapsible title="Mapping" badge={type.label}>
      <div className={mappingContainerStyle}>
        <div className={keyInputContainerStyle}>
          <span className={keyLabelStyle}>key:</span>
          <input
            type="text"
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Enter key value"
            className={keyInputStyle}
          />
        </div>
        {valueSlot && key ? (
          <div className={valueContainerStyle}>
            <StorageValue
              slot={valueSlot}
              offset={0}
              type={valueType}
              types={types}
              chainId={chainId}
              address={address}
              path={`${path}[${key}]`}
            />
          </div>
        ) : (
          <span className={placeholderStyle}>Enter a key to see the value</span>
        )}
      </div>
    </Collapsible>
  );
}
