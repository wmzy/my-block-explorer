import { css } from '@linaria/core';
import { hexToBigInt, keccak256, pad, toHex } from 'viem';
import type { Hex } from 'viem';
import type { StorageArray, StorageDynamicArray, TypesMap } from '@/types/storage';
import { Collapsible } from '@/components/ui/Collapsible';
import { StorageValue } from './StorageValue';

const arrayContainerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const arrayHeaderStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-2);
  font-size: var(--haze-text-sm);
`;

const lengthStyle = css`
  font-family: var(--haze-font-mono);
  color: var(--haze-color-text-secondary);
`;

const arrayElementsStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  padding-left: var(--haze-space-4);
  border-left: 2px solid var(--haze-color-border);
`;

const elementStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const elementIndexStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

export type StorageValueArrayProps = {
  slot: Hex;
  slotCode?: ['hex' | 'bigint', string];
  offset: number;
  type: StorageArray | StorageDynamicArray;
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
};

function isFixedArrayType(type: StorageArray | StorageDynamicArray): type is StorageArray {
  return 'base' in type && !('encoding' in type);
}

function isDynamicArrayType(type: StorageArray | StorageDynamicArray): type is StorageDynamicArray {
  return 'encoding' in type && type.encoding === 'dynamic_array';
}

export function StorageValueArray({
  slot,
  slotCode,
  offset,
  type,
  types,
  chainId,
  address,
  path,
}: StorageValueArrayProps) {
  if (isDynamicArrayType(type)) {
    return (
      <DynamicArrayView
        slot={slot}
        type={type}
        types={types}
        chainId={chainId}
        address={address}
        path={path}
      />
    );
  }

  if (isFixedArrayType(type)) {
    return (
      <FixedArrayView
        slot={slot}
        type={type}
        types={types}
        chainId={chainId}
        address={address}
        path={path}
      />
    );
  }

  return <div>Unknown array type</div>;
}

function FixedArrayView({
  slot,
  type,
  types,
  chainId,
  address,
  path,
}: {
  slot: Hex;
  type: StorageArray;
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
}) {
  const baseType = types[type.base];
  if (!baseType) {
    return <div>Unknown base type: {type.base}</div>;
  }

  const match = type.label.match(/\[(\d+)\]$/);
  const length = match ? parseInt(match[1], 10) : 0;
  const numberOfBytes = Number(baseType.numberOfBytes);
  const nOfSlot = Math.floor(32 / numberOfBytes);

  return (
    <div className={arrayContainerStyle}>
      <span className={arrayHeaderStyle}>
        <span className={lengthStyle}>[{length}]</span>
      </span>
      <div className={arrayElementsStyle}>
        {[...new Array(length).keys()].map(i => {
          let indexSlot: number;
          let elementOffset: number = 0;

          if (nOfSlot < 2) {
            indexSlot = i * Math.ceil(numberOfBytes / 32);
          } else {
            indexSlot = Math.floor(i / nOfSlot);
            elementOffset = (i % nOfSlot) * numberOfBytes;
          }

          const elementSlot = toHex(hexToBigInt(slot) + BigInt(indexSlot));

          return (
            <div key={i} className={elementStyle}>
              <span className={elementIndexStyle}>[{i}]</span>
              <StorageValue
                slot={elementSlot}
                offset={elementOffset}
                type={baseType}
                types={types}
                chainId={chainId}
                address={address}
                path={`${path}[${i}]`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DynamicArrayView({
  slot,
  type,
  types,
  chainId,
  address,
  path,
}: {
  slot: Hex;
  type: StorageDynamicArray;
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
}) {
  const baseType = types[type.base];
  if (!baseType) {
    return <div>Unknown base type: {type.base}</div>;
  }

  return (
    <Collapsible title="Dynamic Array" badge={`${type.label}`}>
      <ArrayElementsWithLength
        slot={keccak256(pad(slot, { size: 32 }))}
        baseType={baseType}
        types={types}
        chainId={chainId}
        address={address}
        path={path}
      />
    </Collapsible>
  );
}

function ArrayElementsWithLength({
  slot,
  baseType,
  types,
  chainId,
  address,
  path,
}: {
  slot: Hex;
  baseType: (typeof types)[string];
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
}) {
  const numberOfBytes = Number(baseType.numberOfBytes);
  const nOfSlot = Math.floor(32 / numberOfBytes);

  return (
    <div className={arrayContainerStyle}>
      <div className={arrayElementsStyle}>
        {[...new Array(1).keys()].map(i => {
          let indexSlot: number;
          let elementOffset: number = 0;

          if (nOfSlot < 2) {
            indexSlot = i * Math.ceil(numberOfBytes / 32);
          } else {
            indexSlot = Math.floor(i / nOfSlot);
            elementOffset = (i % nOfSlot) * numberOfBytes;
          }

          const elementSlot = toHex(hexToBigInt(slot) + BigInt(indexSlot));

          return (
            <div key={i} className={elementStyle}>
              <span className={elementIndexStyle}>[{i}]</span>
              <StorageValue
                slot={elementSlot}
                offset={elementOffset}
                type={baseType}
                types={types}
                chainId={chainId}
                address={address}
                path={`${path}[${i}]`}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
