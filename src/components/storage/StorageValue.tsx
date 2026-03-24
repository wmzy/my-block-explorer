import type { Hex } from 'viem';
import type {
  StorageType,
  TypesMap,
  StorageStruct,
  StorageArray,
  StorageDynamicArray,
  InplaceStorageType,
} from '@/types/storage';
import { StorageValuePrimitive } from './StorageValuePrimitive';
import { StorageValueArray } from './StorageValueArray';
import { StorageValueMapping } from './StorageValueMapping';
import { StorageValueStruct } from './StorageValueStruct';
import { StorageValueBytes } from './StorageValueBytes';

export type SlotCode = ['hex' | 'bigint', string];

export type StorageValueProps = {
  slot: Hex;
  slotCode?: SlotCode;
  offset: number;
  type: StorageType;
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
};

export function StorageValue({
  slot,
  slotCode,
  offset,
  type,
  types,
  chainId,
  address,
  path,
}: StorageValueProps) {
  if (type.encoding === 'inplace') {
    if (type.label.startsWith('struct ')) {
      return (
        <StorageValueStruct
          slot={slot}
          type={type as StorageStruct}
          types={types}
          chainId={chainId}
          address={address}
          path={path}
        />
      );
    }

    if (type.label.endsWith(']')) {
      return (
        <StorageValueArray
          slot={slot}
          slotCode={slotCode}
          offset={offset}
          type={type as StorageArray}
          types={types}
          chainId={chainId}
          address={address}
          path={path}
        />
      );
    }

    return (
      <StorageValuePrimitive
        slot={slot}
        slotCode={slotCode}
        offset={offset}
        type={type as InplaceStorageType}
        chainId={chainId}
        address={address}
      />
    );
  }

  if (type.encoding === 'dynamic_array') {
    return (
      <StorageValueArray
        slot={slot}
        slotCode={slotCode}
        offset={0}
        type={type as StorageDynamicArray}
        types={types}
        chainId={chainId}
        address={address}
        path={path}
      />
    );
  }

  if (type.encoding === 'bytes') {
    return (
      <StorageValueBytes
        slot={slot}
        chainId={chainId}
        address={address}
        isString={type.label === 'string'}
      />
    );
  }

  if (type.encoding === 'mapping') {
    return (
      <StorageValueMapping
        slot={slot}
        type={type}
        types={types}
        chainId={chainId}
        address={address}
        path={path}
      />
    );
  }

  return <div>Unsupported encoding [{JSON.stringify(type)}]</div>;
}
