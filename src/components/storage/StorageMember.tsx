import { css } from '@linaria/core';
import type { Hex } from 'viem';
import type { StorageMember as StorageMemberType, TypesMap } from '@/types/storage';
import { SlotDisplay } from './SlotDisplay';
import { StorageValue } from './StorageValue';

const memberInfoStyle = css`
  display: flex;
  align-items: center;
  gap: var(--haze-space-3);
`;

const offsetStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  padding: var(--haze-space-1) var(--haze-space-2);
  background: var(--haze-color-bg-muted);
  border-radius: var(--haze-radius-sm);
`;

const typeLabelStyle = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-secondary);
  font-family: var(--haze-font-mono);
`;

const valueWrapperStyle = css`
  flex: 1;
`;

export type StorageMemberProps = {
  member: StorageMemberType;
  types: TypesMap;
  chainId: number;
  address: string;
  baseSlot?: Hex;
  baseSlotCode?: ['hex' | 'bigint', string];
  offsetOverride?: number;
};

export function StorageMember({
  member,
  types,
  chainId,
  address,
  baseSlot,
  baseSlotCode,
  offsetOverride,
}: StorageMemberProps) {
  const type = types[member.type];
  if (!type) {
    return (
      <div className={memberInfoStyle}>
        <span className={typeLabelStyle}>Unknown type: {member.type}</span>
      </div>
    );
  }

  const displayOffset = offsetOverride ?? member.offset;

  const renderValue = () => {
    return (
      <StorageValue
        slot={
          baseSlot ??
          (`0x${BigInt(member.slot.startsWith('0x') ? member.slot : `0x${member.slot}`).toString(16)}` as Hex)
        }
        slotCode={baseSlotCode}
        offset={displayOffset}
        type={type}
        types={types}
        chainId={chainId}
        address={address}
        path={member.label}
      />
    );
  };

  return (
    <div className={memberInfoStyle}>
      <span className={offsetStyle}>offset: {displayOffset}</span>
      <span className={typeLabelStyle}>{type.label}</span>
      <div className={valueWrapperStyle}>
        <SlotDisplay
          chainId={chainId}
          address={address}
          slot={
            baseSlot ??
            (`0x${BigInt(member.slot.startsWith('0x') ? member.slot : `0x${member.slot}`).toString(16)}` as Hex)
          }
        />
        {renderValue()}
      </div>
    </div>
  );
}
