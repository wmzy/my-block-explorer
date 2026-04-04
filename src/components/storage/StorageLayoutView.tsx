import { css } from '@linaria/core';
import { useState } from 'react';
import type { Hex } from 'viem';
import type { StorageLayout } from '@/types/storage';
import { StorageMember } from './StorageMember';

export type SlotCode = ['hex' | 'bigint', string];

const containerStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-4);
`;

const titleStyle = css`
  font-size: var(--haze-text-lg);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
  margin: 0;
`;

const listStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
  list-style: none;
  margin: 0;
  padding: 0;
`;

const listItemStyle = css`
  display: flex;
  align-items: flex-start;
  gap: var(--haze-space-4);
  padding: var(--haze-space-3) var(--haze-space-4);
  background: var(--haze-color-bg-subtle);
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-md);
`;

const slotInfoStyle = css`
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-1);
  min-width: 120px;
`;

const slotNumberStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const slotLabelStyle = css`
  font-size: var(--haze-text-sm);
  font-weight: var(--haze-weight-medium);
  color: var(--haze-color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 150px;
`;

const valueContainerStyle = css`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-2);
`;

const headerStyle = css`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--haze-space-3);
`;

const buttonStyle = css`
  padding: var(--haze-space-1) var(--haze-space-3);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-primary);
  background: transparent;
  border: 1px solid var(--haze-color-primary);
  border-radius: var(--haze-radius-sm);
  cursor: pointer;

  &:hover {
    background: var(--haze-color-bg-elevated);
  }
`;

export type StorageLayoutViewProps = {
  chainId: number;
  address: string;
  layout: StorageLayout;
};

export function getSlotCode(type: 'hex' | 'bigint', slotCode?: SlotCode): string {
  if (!slotCode) return '';
  const [t, c] = slotCode;
  if (t === type) return c;
  if (type === 'bigint') return `hexToBigInt(${c})`;
  return `toHex(${c})`;
}

export function StorageLayoutView({ chainId, address, layout }: StorageLayoutViewProps) {
  const { storage, types } = layout;
  const [showValues, setShowValues] = useState(false);

  return (
    <div className={containerStyle}>
      <div className={headerStyle}>
        <h2 className={titleStyle}>Storage Layout</h2>
        {!showValues && (
          <button className={buttonStyle} onClick={() => setShowValues(true)}>
            Load values
          </button>
        )}
      </div>
      <ol className={listStyle}>
        {storage.map(member => {
          const type = types?.[member.type];
          if (!type) return null;

          const slot = `0x${BigInt(member.slot.startsWith('0x') ? member.slot : `0x${member.slot}`).toString(16)}`;

          return (
            <li key={`${member.slot}-${member.offset}`} className={listItemStyle}>
              <div className={slotInfoStyle}>
                <span className={slotNumberStyle} title={slot}>
                  Slot {member.slot}
                </span>
                <span className={slotLabelStyle} title={member.label}>
                  {member.label}
                </span>
              </div>
              <div className={valueContainerStyle}>
                <StorageMember
                  member={member}
                  types={types}
                  chainId={chainId}
                  address={address}
                  baseSlot={slot as Hex}
                  showValues={showValues}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
