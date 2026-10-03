// Holdings were netted from the server's collapsed `direction` field, so a
// SELF-TRANSFER (from === to === the viewed address) counted as a full
// outflow.
//
// The backend scans each event shape twice — once filtered by `from`,
// once by `to` — and dedupes a self-transfer down to a SINGLE row whose
// direction is 'out' (services/TokenTransferService.ts: "within each event
// shape the outgoing query runs before the incoming one, so a
// self-transfer (from == to == address) is recorded once with direction
// 'out'"). `direction` is therefore a SCAN-ORDER artifact for exactly the
// rows where both parties are the viewed address, and it is lossy: the
// collapsed row has no way to say "both sides are me".
//
// aggregateTokenHoldings took `direction === 'in' ? +1 : -1`, so:
//
//   - an ERC-20 self-transfer of 1000 units netted to −1000 instead of 0
//     (the card drops a holding the address still has, and can even show a
//     negative balance);
//   - an ERC-721 self-transfer decremented the id's held-count multiset
//     to 0, so an NFT the address still owns disappeared from holdings.
//
// Both sibling aggregators already net from/to and say why
// (nftHoldings.ts: "In/out is derived from the row's from/to against the
// viewed address (NOT the backend `direction` field)"; tokenOverview.ts
// the same). This is the odd one out.
import { describe, it, expect } from 'vitest';

import { aggregateTokenHoldings } from '@/views/Address/holdings';
import type { TokenTransfer } from '@/services/tokenTransfers';

const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TOKEN = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OTHER = '0xcccccccccccccccccccccccccccccccccccccccc';
const HASH = `0x${'12'.repeat(32)}`;

type Overrides = Partial<TokenTransfer>;

const transfer = (overrides: Overrides): TokenTransfer => ({
  txHash: HASH,
  blockNumber: 1,
  logIndex: 0,
  token: TOKEN,
  standard: 'erc20-or-erc721',
  from: OTHER,
  to: ADDRESS,
  value: '1000',
  // The backend's collapsed verdict: a self-transfer is recorded as 'out'.
  direction: 'out',
  ...overrides,
});

/** Self-transfer as the backend actually serves it: one row, direction 'out'. */
const selfTransfer = (overrides: Overrides = {}): TokenTransfer =>
  transfer({ from: ADDRESS, to: ADDRESS, ...overrides });

const erc20 = () => () => 'erc20' as const;
const erc721 = () => () => 'erc721' as const;

describe('aggregateTokenHoldings — a self-transfer changes no balance', () => {
  it('nets an ERC-20 self-transfer to zero instead of an outflow', () => {
    const holdings = aggregateTokenHoldings([selfTransfer({ value: '1000' })], erc20(), ADDRESS);

    // The address sent 1000 to itself: it still holds what it held.
    expect(holdings).toHaveLength(0);
  });

  it('keeps a prior balance intact across a self-transfer', () => {
    const holdings = aggregateTokenHoldings(
      [
        transfer({ from: OTHER, to: ADDRESS, value: '1000', direction: 'in' }),
        selfTransfer({ value: '1000' }),
      ],
      erc20(),
      ADDRESS,
    );

    expect(holdings).toEqual([
      { kind: 'erc20', token: TOKEN, net: 1000n, transferCount: 2 },
    ]);
  });

  it('keeps an ERC-721 id held after a self-transfer of that id', () => {
    const holdings = aggregateTokenHoldings(
      [
        transfer({ from: OTHER, to: ADDRESS, value: '7', direction: 'in' }),
        selfTransfer({ value: '7' }),
      ],
      erc721(),
      ADDRESS,
    );

    expect(holdings).toEqual([
      { kind: 'erc721', token: TOKEN, heldIds: ['7'], transferCount: 2 },
    ]);
  });

  it('nets an ERC-1155 self-transfer to zero', () => {
    const holdings = aggregateTokenHoldings(
      [
        transfer({
          from: OTHER,
          to: ADDRESS,
          standard: 'erc1155-single',
          value: '5',
          tokenIds: ['42'],
          amounts: ['5'],
          direction: 'in',
        }),
        selfTransfer({ standard: 'erc1155-single', value: '5', tokenIds: ['42'], amounts: ['5'] }),
      ],
      erc20(),
      ADDRESS,
    );

    expect(holdings).toEqual([
      { kind: 'erc1155', token: TOKEN, tokenId: '42', net: 5n, transferCount: 2 },
    ]);
  });

  it('still nets a real outflow as a decrease', () => {
    const holdings = aggregateTokenHoldings(
      [
        transfer({ from: OTHER, to: ADDRESS, value: '1000', direction: 'in' }),
        transfer({ from: ADDRESS, to: OTHER, value: '400', direction: 'out' }),
      ],
      erc20(),
      ADDRESS,
    );

    expect(holdings).toEqual([{ kind: 'erc20', token: TOKEN, net: 600n, transferCount: 2 }]);
  });

  it('ignores a token-mode row, which says nothing about the holder', () => {
    // Mint/burn rows carry direction 'none' and neither party is the viewed
    // address; they must not move its balance.
    const holdings = aggregateTokenHoldings(
      [
        transfer({
          from: OTHER,
          to: OTHER,
          value: '5000',
          direction: 'none',
        }),
      ],
      erc20(),
      ADDRESS,
    );

    expect(holdings).toHaveLength(0);
  });
});
