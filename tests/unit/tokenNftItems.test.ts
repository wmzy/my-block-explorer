// Unit tests for the Token page's pure NFT-item derivation: which scan
// rows prove an NFT item (4-topic ERC-721 shapes vs ERC-20/ambiguous
// shared-signature rows, ERC-1155 single/batch families), the
// BigInt-exact mint/burn netting with the floor-at-zero burned marker,
// first-seen ordering with the 24-item cap, and the malformed-row and
// foreign-token honesty guards. Amount fixtures use values past 2^53 so
// a Number-float implementation would fail.
import { describe, it, expect } from 'vitest';

import type { TokenTransfer } from '@/services/tokenTransfers';
import { deriveNftItems, NFT_ITEMS_LIMIT } from '@/views/Token/nftItems';

const TOKEN = `0x${'aa'.repeat(20)}`;
const OTHER_TOKEN = `0x${'bb'.repeat(20)}`;
const ALICE = '0x1111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222';
const ZERO = '0x0000000000000000000000000000000000000000';

// Token-mode row shape: the viewed contract emitted the log (token ===
// TOKEN, direction 'none') — exactly what the scan hands the page.
function row(fields: Partial<TokenTransfer>): TokenTransfer {
  return {
    txHash: `0x${'f'.repeat(64)}`,
    blockNumber: 18_000_000,
    logIndex: 0,
    token: TOKEN,
    standard: 'erc20-or-erc721',
    from: ALICE,
    to: BOB,
    value: '1',
    direction: 'none',
    ...fields,
  };
}

const single = (id: string, amount: string, from = ZERO, to = ALICE): TokenTransfer =>
  row({
    standard: 'erc1155-single',
    logStandard: 'erc1155',
    tokenIds: [id],
    amounts: [amount],
    value: amount,
    from,
    to,
  });

const batch = (
  ids: string[],
  amounts: string[],
  from = ZERO,
  to = ALICE,
): TokenTransfer =>
  row({
    standard: 'erc1155-batch',
    logStandard: 'erc1155',
    tokenIds: ids,
    amounts,
    value: String(ids.length),
    from,
    to,
  });

describe('deriveNftItems erc721 rows', () => {
  it('derives one item per distinct 4-topic id, first-seen order', () => {
    const items = deriveNftItems(
      [
        row({ logStandard: 'erc721', value: '9' }),
        row({ logStandard: 'erc721', value: '3' }),
        row({ logStandard: 'erc721', value: '9' }), // repeat: deduped
        row({ logStandard: 'erc721', value: '5' }),
      ],
      TOKEN,
    );
    expect(items).toEqual([
      { standard: 'erc721', tokenId: '9', amount: 1n, burned: false },
      { standard: 'erc721', tokenId: '3', amount: 1n, burned: false },
      { standard: 'erc721', tokenId: '5', amount: 1n, burned: false },
    ]);
  });

  it('counts a burn row as a discovered item (it proves the id exists)', () => {
    const items = deriveNftItems(
      [row({ logStandard: 'erc721', value: '12', from: ALICE, to: ZERO })],
      TOKEN,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ standard: 'erc721', tokenId: '12' });
  });

  it('yields nothing for ERC-20 rows, ambiguous rows, or malformed ids', () => {
    expect(
      deriveNftItems(
        [
          row({ logStandard: 'erc20', value: '100' }),
          row({ value: '7' }), // no topic evidence: never a guessed item
          row({ logStandard: 'erc721', value: '0x1f' }), // non-decimal id
          row({ logStandard: 'erc721', value: '' }),
        ],
        TOKEN,
      ),
    ).toEqual([]);
  });

  it('ignores rows emitted by another contract', () => {
    expect(
      deriveNftItems([row({ token: OTHER_TOKEN, logStandard: 'erc721', value: '9' })], TOKEN),
    ).toEqual([]);
  });
});

describe('deriveNftItems erc1155 netting', () => {
  it('aggregates single mints BigInt-exactly, deduping repeat ids', () => {
    const big = '9007199254740993'; // 2^53 + 1
    const items = deriveNftItems([single('5', big), single('5', '2')], TOKEN);
    expect(items).toEqual([
      { standard: 'erc1155', tokenId: '5', amount: BigInt(big) + 2n, burned: false },
    ]);
  });

  it('nets batch mints per id', () => {
    const items = deriveNftItems([batch(['1', '2'], ['10', '20'])], TOKEN);
    expect(items).toEqual([
      { standard: 'erc1155', tokenId: '1', amount: 10n, burned: false },
      { standard: 'erc1155', tokenId: '2', amount: 20n, burned: false },
    ]);
  });

  it('subtracts burns and floors a negative net at 0 with the burned marker', () => {
    const items = deriveNftItems(
      [single('5', '5'), single('5', '7', ALICE, ZERO)],
      TOKEN,
    );
    expect(items).toEqual([
      { standard: 'erc1155', tokenId: '5', amount: 0n, burned: true },
    ]);
  });

  it('floors once at the end: mint 5, burn 7, mint 3 nets to +1, not 0', () => {
    const items = deriveNftItems(
      [single('5', '5'), single('5', '7', ALICE, ZERO), single('5', '3')],
      TOKEN,
    );
    expect(items).toEqual([
      { standard: 'erc1155', tokenId: '5', amount: 1n, burned: false },
    ]);
  });

  it('lists an id seen only in plain transfers with a zero net, unmarked', () => {
    const items = deriveNftItems([single('5', '4', ALICE, BOB)], TOKEN);
    expect(items).toEqual([
      { standard: 'erc1155', tokenId: '5', amount: 0n, burned: false },
    ]);
  });

  it('falls back to value for single rows missing amounts, skips malformed pairs', () => {
    const items = deriveNftItems(
      [
        row({
          standard: 'erc1155-single',
          logStandard: 'erc1155',
          tokenIds: ['5'],
          value: '3',
          from: ZERO,
        }),
        batch(['6', '7'], ['not-a-number', '2']),
        row({ standard: 'erc1155-single', logStandard: 'erc1155', value: '3' }), // no ids
      ],
      TOKEN,
    );
    expect(items).toEqual([
      { standard: 'erc1155', tokenId: '5', amount: 3n, burned: false },
      { standard: 'erc1155', tokenId: '7', amount: 2n, burned: false },
    ]);
  });
});

describe('deriveNftItems mixed shapes and the cap', () => {
  it('derives both families from one scan in first-seen order', () => {
    const items = deriveNftItems(
      [single('5', '3'), row({ logStandard: 'erc721', value: '7' })],
      TOKEN,
    );
    expect(items.map(item => [item.standard, item.tokenId])).toEqual([
      ['erc1155', '5'],
      ['erc721', '7'],
    ]);
  });

  it('never aggregates a 1155 row onto an id first evidenced as a 721', () => {
    const items = deriveNftItems(
      [row({ logStandard: 'erc721', value: '5' }), single('5', '100')],
      TOKEN,
    );
    expect(items).toEqual([
      { standard: 'erc721', tokenId: '5', amount: 1n, burned: false },
    ]);
  });

  it('caps at 24 distinct items by first-seen order, still netting capped ids', () => {
    expect(NFT_ITEMS_LIMIT).toBe(24);
    const rows: TokenTransfer[] = [];
    for (let id = 1; id <= 25; id += 1) {
      rows.push(row({ logStandard: 'erc721', value: String(id), blockNumber: 18_000_100 - id }));
    }
    // Post-cap rows: a NEW id stays dropped, an already-capped id nets on.
    rows.push(row({ logStandard: 'erc721', value: '26', blockNumber: 1 }));
    rows.push(single('1', '40', ZERO, BOB)); // nets +40 onto id '1'
    const items = deriveNftItems(rows, TOKEN);
    expect(items).toHaveLength(24);
    expect(items.map(item => item.tokenId)).toEqual(
      Array.from({ length: 24 }, (_, i) => String(i + 1)),
    );
    expect(items[0]).toEqual({
      standard: 'erc721',
      tokenId: '1',
      amount: 1n,
      burned: false,
    });
  });

  it('returns an empty derivation for an empty scan', () => {
    expect(deriveNftItems([], TOKEN)).toEqual([]);
  });
});
