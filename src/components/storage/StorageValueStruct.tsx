import { css } from '@linaria/core';
import type { Hex } from 'viem';
import type { StorageStruct, TypesMap } from '@/types/storage';
import { Collapsible } from '@/components/ui/Collapsible';
import { StorageMember } from './StorageMember';

const structContainerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const membersContainerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  padding-left: var(--haze-space-4);
  border-left: 2px solid var(--haze-color-border);
`;

const memberWrapperStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
`;

const memberLabelStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
`;

export type StorageValueStructProps = {
  slot: Hex;
  type: StorageStruct;
  types: TypesMap;
  chainId: number;
  address: string;
  path: string;
};

export function StorageValueStruct({
  slot,
  type,
  types,
  chainId,
  address,
  path,
}: StorageValueStructProps) {
  return (
    <Collapsible title="Struct" badge={type.label}>
      <div className={structContainerStyle}>
        <div className={membersContainerStyle}>
          {type.members.map(member => {
            const memberType = types[member.type];
            if (!memberType) {
              return (
                <div key={member.label} className={memberWrapperStyle}>
                  <span className={memberLabelStyle}>{member.label}</span>
                  <span>Unknown type: {member.type}</span>
                </div>
              );
            }

            const memberSlot =
              `0x${(BigInt(slot) + BigInt(member.slot.startsWith('0x') ? member.slot : `0x${member.slot}`)).toString(16)}` as Hex;

            return (
              <div key={member.label} className={memberWrapperStyle}>
                <span className={memberLabelStyle}>
                  {member.label} (slot: {member.slot}, offset: {member.offset})
                </span>
                <StorageMember
                  member={member}
                  types={types}
                  chainId={chainId}
                  address={address}
                  baseSlot={memberSlot}
                  offsetOverride={member.offset}
                />
              </div>
            );
          })}
        </div>
      </div>
    </Collapsible>
  );
}
