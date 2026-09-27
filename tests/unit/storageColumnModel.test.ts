// Unit tests for the pure column view-model of the storage explorer.
// Expected slots are computed independently with viem primitives here
// (never via the module under test); expected slot-expression strings
// are hard-coded literals.
//
// Fixture contract:
//   contract Vault {
//     struct Point { uint128 x; uint128 y; }          // packed pair
//     struct Account { uint256 balance; Point point; bool sealed; }
//     address owner;                                   // slot 0
//     mapping(address => Account) accounts;            // slot 1
//     mapping(string => uint256) names;                // slot 2
//     address[] whitelist;                             // slot 3
//     uint128[6] grid;                                 // slot 4
//     Point[] points;                                  // slot 5
//   }
import { describe, expect, it } from 'vitest';
import { concat, keccak256, pad, toHex } from 'viem';
import type { Hex } from 'viem';
import type { StorageLayout, TypesMap } from '@/types/storage';
import {
  DEFAULT_COLUMN_SPAN,
  MAX_COLUMN_SPAN,
  augmentLayoutTypes,
  clampRange,
  decodeStoragePath,
  encodeStoragePath,
  resolveColumns,
  type Segment,
} from '@/components/storage/columnModel';

const KEY1 = '0x0000000000000000000000000000000000000001';

const member = (
  astId: number,
  label: string,
  slot: string,
  type: string,
): StorageLayout['storage'][number] => ({
  astId,
  contract: 'Vault',
  label,
  offset: 0,
  slot: slot as `${number}`,
  type,
});

const types: TypesMap = {
  t_address: { encoding: 'inplace', label: 'address', numberOfBytes: '20' },
  t_uint256: { encoding: 'inplace', label: 'uint256', numberOfBytes: '32' },
  t_uint128: { encoding: 'inplace', label: 'uint128', numberOfBytes: '16' },
  t_bool: { encoding: 'inplace', label: 'bool', numberOfBytes: '1' },
  t_string: { encoding: 'bytes', label: 'string', numberOfBytes: '32' },
  t_point: {
    encoding: 'inplace',
    label: 'struct Point',
    numberOfBytes: '32',
    members: [
      { astId: 1, contract: 'Vault', label: 'x', offset: 0, slot: '0', type: 't_uint128' },
      { astId: 2, contract: 'Vault', label: 'y', offset: 16, slot: '0', type: 't_uint128' },
    ],
  },
  t_account: {
    encoding: 'inplace',
    label: 'struct Account',
    numberOfBytes: '96',
    members: [
      { astId: 3, contract: 'Vault', label: 'balance', offset: 0, slot: '0', type: 't_uint256' },
      { astId: 4, contract: 'Vault', label: 'point', offset: 0, slot: '1', type: 't_point' },
      { astId: 5, contract: 'Vault', label: 'sealed', offset: 0, slot: '2', type: 't_bool' },
    ],
  },
  t_accounts: {
    encoding: 'mapping',
    key: 't_address',
    value: 't_account',
    label: 'mapping(address => struct Account)',
    numberOfBytes: '32',
  },
  t_quorum: {
    encoding: 'mapping',
    key: 't_uint256',
    value: 't_uint256',
    label: 'mapping(uint256 => uint256)',
    numberOfBytes: '32',
  },
  t_scores: {
    encoding: 'mapping',
    key: 't_int256',
    value: 't_uint256',
    label: 'mapping(int256 => uint256)',
    numberOfBytes: '32',
  },
  t_int256: { encoding: 'inplace', label: 'int256', numberOfBytes: '32' },
  t_names: {
    encoding: 'mapping',
    key: 't_string',
    value: 't_uint256',
    label: 'mapping(string => uint256)',
    numberOfBytes: '32',
  },
  t_whitelist: {
    encoding: 'dynamic_array',
    base: 't_address',
    label: 'address[]',
    numberOfBytes: '32',
  },
  t_grid: { encoding: 'inplace', label: 'uint128[6]', numberOfBytes: '96', base: 't_uint128' },
  t_points: {
    encoding: 'dynamic_array',
    base: 't_point',
    label: 'struct Point[]',
    numberOfBytes: '32',
  },
  // Fixed array of structs — solc labels it 'struct …[N]', which must
  // classify as an ARRAY (length suffix wins over the struct prefix).
  t_books: {
    encoding: 'inplace',
    label: 'struct Account[3]',
    numberOfBytes: '288',
    base: 't_account',
  },
};

const layout: StorageLayout = {
  storage: [
    member(10, 'owner', '0', 't_address'),
    member(11, 'accounts', '1', 't_accounts'),
    member(12, 'names', '2', 't_names'),
    member(13, 'whitelist', '3', 't_whitelist'),
    member(14, 'grid', '4', 't_grid'),
    member(15, 'points', '5', 't_points'),
    member(16, 'quorum', '6', 't_quorum'),
    member(17, 'scores', '7', 't_scores'),
    member(18, 'books', '8', 't_books'),
  ],
  types,
};

const m = (label: string): Segment => ({ t: 'm', label });
const k = (key: string): Segment => ({ t: 'k', key });
const i = (index: number): Segment => ({ t: 'i', index });
const a = (from: number, to: number): Segment => ({ t: 'a', from, to });

// Independently computed fixture slots (viem, not the module under test).
const ACCOUNT_SLOT = keccak256(concat([pad(KEY1, { size: 32 }), pad('0x1', { size: 32 })]));
const NAME_ABC_SLOT = keccak256(concat([keccak256(toHex('abc')), pad('0x2', { size: 32 })]));
const WHITELIST_DATA = keccak256(pad('0x3', { size: 32 }));
const POINTS_DATA = keccak256(pad('0x5', { size: 32 }));
const slotPlus = (slot: Hex, delta: bigint): Hex => toHex(BigInt(slot) + delta);

describe('resolveColumns — root', () => {
  it('resolves the root struct from layout.storage', () => {
    const columns = resolveColumns(layout, []);
    expect(columns).toHaveLength(1);
    const root = columns[0];
    expect(root.segments).toEqual([]);
    expect(root.pathLabel).toBe('Storage');
    expect(root.slot).toBeNull();
    expect(root.expr).toBeNull();
    expect(root.node.kind).toBe('struct');
    if (root.node.kind !== 'struct') return;
    expect(root.node.rows.map(row => row.label)).toEqual([
      'owner',
      'accounts',
      'names',
      'whitelist',
      'grid',
      'points',
      'quorum',
      'scores',
      'books',
    ]);
  });

  it('gives root rows absolute slots, marker-literal exprs and expand kinds', () => {
    const rows = resolveColumns(layout, [])[0].node;
    if (rows.kind !== 'struct') return;
    const byLabel = Object.fromEntries(rows.rows.map(row => [row.label, row]));
    expect(byLabel.owner).toMatchObject({
      slot: '0x0',
      expr: '/* owner< */0n/* >*/',
      offset: 0,
      expand: 'leaf',
    });
    expect(byLabel.owner.type?.label).toBe('address');
    expect(byLabel.accounts).toMatchObject({ slot: '0x1', expand: 'mapping' });
    expect(byLabel.accounts.expr).toBe('/* accounts< */1n/* >*/');
    expect(byLabel.names).toMatchObject({ slot: '0x2', expand: 'mapping' });
    expect(byLabel.whitelist).toMatchObject({ slot: '0x3', expand: 'array' });
    expect(byLabel.grid).toMatchObject({ slot: '0x4', expand: 'array' });
    expect(byLabel.points).toMatchObject({ slot: '0x5', expand: 'array' });
  });

  it('marks every root row unknown (type null) when layout.types is null', () => {
    const bare = resolveColumns({ storage: layout.storage, types: null }, []);
    expect(bare).toHaveLength(1);
    const node = bare[0].node;
    if (node.kind !== 'struct') return;
    expect(node.rows).toHaveLength(9);
    for (const row of node.rows) {
      expect(row.type).toBeNull();
      expect(row.expand).toBe('unknown');
    }
    // Slots stay absolute and exprs stay literal — no type info needed.
    expect(node.rows[1]).toMatchObject({ slot: '0x1', expr: '/* accounts< */1n/* >*/' });
  });
});

describe('resolveColumns — mapping drill', () => {
  it('resolves a mapping member into a single-row shell', () => {
    const columns = resolveColumns(layout, [m('accounts')]);
    expect(columns).toHaveLength(2);
    const shell = columns[1];
    expect(shell.segments).toEqual([m('accounts')]);
    expect(shell.pathLabel).toBe('Storage.accounts');
    expect(shell.slot).toBe('0x1');
    expect(shell.expr).toBe('/* accounts< */1n/* >*/');
    expect(shell.node.kind).toBe('struct');
    if (shell.node.kind !== 'struct') return;
    expect(shell.node.typeLabel).toBe('mapping(address => struct Account)');
    expect(shell.node.rows).toHaveLength(1);
    expect(shell.node.rows[0]).toMatchObject({ label: 'accounts', expand: 'mapping' });
  });

  it('computes the struct value slot with exact keccak256 math', () => {
    const columns = resolveColumns(layout, [m('accounts'), k(KEY1)]);
    expect(columns).toHaveLength(3);
    const account = columns[2];
    expect(account.pathLabel).toBe(`Storage.accounts[${KEY1}]`);
    expect(account.slot).toBe(ACCOUNT_SLOT);
    expect(account.node.kind).toBe('struct');
    if (account.node.kind !== 'struct') return;
    // Member slots are relative to the value slot.
    expect(account.node.rows[0]).toMatchObject({ label: 'balance', slot: ACCOUNT_SLOT });
    expect(account.node.rows[1]).toMatchObject({
      label: 'point',
      slot: slotPlus(ACCOUNT_SLOT, 1n),
    });
    expect(account.node.rows[2]).toMatchObject({
      label: 'sealed',
      slot: slotPlus(ACCOUNT_SLOT, 2n),
    });
  });

  it('threads marker-commented exprs from root through key to member', () => {
    const columns = resolveColumns(layout, [m('accounts'), k(KEY1), m('point')]);
    const point = columns[3];
    const accountExpr =
      'keccak256(concat([pad(/* key< */\'0x0000000000000000000000000000000000000001\'/* >*/ as `0x${string}`, { size: 32 }), pad(/* accounts< */1n/* >*/, { size: 32 })]))';
    expect(columns[2].expr).toBe(accountExpr);
    // balance (slot 0) keeps the base expr; point adds its relative slot.
    const accountNode = columns[2].node;
    if (accountNode.kind !== 'struct') return;
    expect(accountNode.rows[0].expr).toBe(accountExpr);
    expect(accountNode.rows[1].expr).toBe(`(/* point< */1n/* >*/ + ${accountExpr})`);
    expect(point.slot).toBe(slotPlus(ACCOUNT_SLOT, 1n));
    expect(point.expr).toBe(`(/* point< */1n/* >*/ + ${accountExpr})`);
  });

  it('resolves a packed struct (uint128 pair sharing one slot)', () => {
    const columns = resolveColumns(layout, [m('accounts'), k(KEY1), m('point')]);
    const point = columns[3];
    expect(point.pathLabel).toBe(`Storage.accounts[${KEY1}].point`);
    expect(point.node.kind).toBe('struct');
    if (point.node.kind !== 'struct') return;
    const [x, y] = point.node.rows;
    expect(x).toMatchObject({ label: 'x', slot: point.slot, offset: 0 });
    expect(y).toMatchObject({ label: 'y', slot: point.slot, offset: 16 });
    // Relative slot 0 keeps the base expr untouched.
    expect(x.expr).toBe(point.expr);
    expect(y.expr).toBe(point.expr);
  });

  it('resolves numeric mapping keys, quoting them in the expression', () => {
    const columns = resolveColumns(layout, [m('quorum'), k('42')]);
    const leaf = columns[2];
    expect(leaf.slot).toBe(
      keccak256(concat([pad('0x2a', { size: 32 }), pad('0x6', { size: 32 })])),
    );
    expect(leaf.expr).toBe(
      'keccak256(concat([pad(toHex(BigInt(/* key< */\'42\'/* >*/)), { size: 32 }), pad(/* quorum< */6n/* >*/, { size: 32 })]))',
    );
    // Leading-zero keys encode identically ('007' === 7) and stay quoted —
    // an unquoted 007 would be a forbidden octal literal in the snippet.
    const padded = resolveColumns(layout, [m('quorum'), k('007')])[2];
    const canonical = resolveColumns(layout, [m('quorum'), k('7')])[2];
    expect(padded.slot).toBe(canonical.slot);
    expect(padded.expr).toContain('/* key< */\'007\'');
  });

  it('two\'s-complement resolves negative int keys', () => {
    const columns = resolveColumns(layout, [m('scores'), k('-1')]);
    const leaf = columns[2];
    expect(leaf.slot).toBe(
      keccak256(
        concat([pad(toHex(BigInt.asUintN(256, -1n)), { size: 32 }), pad('0x7', { size: 32 })]),
      ),
    );
    expect(leaf.expr).toContain('BigInt.asUintN(256n, BigInt(/* key< */\'-1\'/* >*/))');
  });

  it('resolves a string-keyed mapping to a leaf column (crafted URL flow)', () => {
    const segments = decodeStoragePath('m.names/k.abc');
    expect(segments).toEqual([m('names'), k('abc')]);
    const columns = resolveColumns(layout, segments!);
    const leaf = columns[2];
    expect(leaf.pathLabel).toBe('Storage.names[abc]');
    expect(leaf.slot).toBe(NAME_ABC_SLOT);
    expect(leaf.node).toEqual({
      kind: 'leaf',
      type: types.t_uint256,
      slot: NAME_ABC_SLOT,
      expr: 'keccak256(concat([keccak256(toHex(/* key< */\'abc\'/* >*/)), pad(/* names< */2n/* >*/, { size: 32 })]))',
    });
  });
});

describe('resolveColumns — arrays', () => {
  it('resolves a dynamic array to its keccak data slot', () => {
    const columns = resolveColumns(layout, [m('whitelist')]);
    const array = columns[1];
    expect(array.pathLabel).toBe('Storage.whitelist');
    expect(array.node).toMatchObject({
      kind: 'array',
      elementType: types.t_address,
      dataSlot: WHITELIST_DATA,
      dataExpr: 'keccak256(pad(/* whitelist< */3n/* >*/, { size: 32 }))',
      fixedLength: null,
      baseLabel: 'address',
    });
    expect(array.slot).toBe(WHITELIST_DATA);
  });

  it('places a whole-slot element (address) one slot per index', () => {
    const columns = resolveColumns(layout, [m('whitelist'), i(4)]);
    const element = columns[2];
    expect(element.slot).toBe(slotPlus(WHITELIST_DATA, 4n));
    expect(element.pathLabel).toBe('Storage.whitelist[4]');
    expect(element.expr).toBe(
      '(/* index 4< */4n/* >*/ + keccak256(pad(/* whitelist< */3n/* >*/, { size: 32 })))',
    );
    expect(element.node).toEqual({
      kind: 'leaf',
      type: types.t_address,
      slot: slotPlus(WHITELIST_DATA, 4n),
      expr: element.expr,
    });
  });

  it('resolves a fixed array at its own base with the parsed length', () => {
    const columns = resolveColumns(layout, [m('grid')]);
    expect(columns[1].node).toMatchObject({
      kind: 'array',
      dataSlot: '0x4',
      dataExpr: '/* grid< */4n/* >*/',
      fixedLength: 6,
      baseLabel: 'uint128',
    });
  });

  it('packs uint128 elements two-per-slot (index 5 → slotDelta 2)', () => {
    const columns = resolveColumns(layout, [m('grid'), i(5)]);
    const element = columns[2];
    expect(element.slot).toBe('0x6');
    expect(element.expr).toBe('(/* index 5< */2n/* >*/ + /* grid< */4n/* >*/)');
    expect(element.node).toMatchObject({ kind: 'leaf', type: types.t_uint128, slot: '0x6' });
  });

  it('resolves dynamic-array-of-struct elements as struct columns', () => {
    const columns = resolveColumns(layout, [m('points'), i(2)]);
    const element = columns[2];
    expect(element.slot).toBe(slotPlus(POINTS_DATA, 2n));
    expect(element.node.kind).toBe('struct');
    if (element.node.kind !== 'struct') return;
    expect(element.node.typeLabel).toBe('struct Point');
    expect(element.node.rows[0]).toMatchObject({ label: 'x', offset: 0 });
    expect(element.node.rows[1]).toMatchObject({ label: 'y', offset: 16 });
  });

  it('classifies a fixed array of structs (struct Account[3]) as an array', () => {
    const columns = resolveColumns(layout, [m('books')]);
    expect(columns[1].node).toMatchObject({
      kind: 'array',
      elementType: types.t_account,
      dataSlot: '0x8',
      dataExpr: '/* books< */8n/* >*/',
      fixedLength: 3,
      baseLabel: 'struct Account',
    });
    // 96-byte struct stride: element 2 lands 6 slots past the base.
    const element = resolveColumns(layout, [m('books'), i(2)])[2];
    expect(element.node.kind).toBe('struct');
    expect(element.slot).toBe('0xe');
    expect(element.expr).toBe('(/* index 2< */6n/* >*/ + /* books< */8n/* >*/)');
  });

  it('re-ranges an array view without changing the resolved context', () => {
    const columns = resolveColumns(layout, [m('grid'), a(2, 6)]);
    const range = columns[2];
    expect(range.pathLabel).toBe('Storage.grid'); // 'a' adds no label
    expect(range.segments).toEqual([m('grid'), a(2, 6)]);
    expect(range.slot).toBe('0x4');
    expect(range.node).toEqual(columns[1].node);
    // Ranging then indexing still works.
    const indexed = resolveColumns(layout, [m('grid'), a(2, 6), i(5)]);
    expect(indexed[3].slot).toBe('0x6');
  });
});

describe('resolveColumns — errors stop resolution', () => {
  it('errors on an unknown member label and drops later segments', () => {
    const columns = resolveColumns(layout, [m('nope'), k(KEY1), i(0)]);
    expect(columns).toHaveLength(2);
    expect(columns[1].error).toContain('nope');
    expect(columns[1].slot).toBeNull();
  });

  it('errors when drilling a leaf member or a typeless row', () => {
    expect(resolveColumns(layout, [m('owner')])[1].error).toContain('Cannot drill into owner');
    const typeless = resolveColumns({ storage: layout.storage, types: null }, [m('owner')]);
    expect(typeless[1].error).toMatch(/unknown type/i);
  });

  it('errors on a key segment outside a mapping shell (ambiguous root)', () => {
    expect(resolveColumns(layout, [k(KEY1)])[1].error).toMatch(/several mappings/i);
  });

  it('errors on an invalid mapping key with the validator message', () => {
    expect(resolveColumns(layout, [m('accounts'), k('nope')])[2].error).toBe('Invalid address');
    expect(resolveColumns(layout, [m('names'), k('')])[2].error).toBe('Empty key');
  });

  it('errors on index/range segments outside arrays', () => {
    expect(resolveColumns(layout, [i(0)])[1].error).toMatch(/requires an array column/i);
    expect(resolveColumns(layout, [a(0, 4)])[1].error).toMatch(/requires an array column/i);
  });

  it('errors on an invalid range passed directly to the API', () => {
    expect(resolveColumns(layout, [m('grid'), a(5, 5)])[2].error).toMatch(/invalid range/i);
    expect(resolveColumns(layout, [m('grid'), a(-1, 4)])[2].error).toMatch(/invalid range/i);
    expect(resolveColumns(layout, [m('grid'), a(0, 65)])[2].error).toMatch(/invalid range/i);
  });
});

describe('encodeStoragePath / decodeStoragePath', () => {
  it('round-trips every segment kind', () => {
    const segments: Segment[] = [m('accounts'), k(KEY1), m('point'), i(3), a(2, 10)];
    const encoded = encodeStoragePath(segments);
    expect(encoded).toBe(`m.accounts/k.${encodeURIComponent(KEY1)}/m.point/i.3/a.2-10`);
    expect(decodeStoragePath(encoded)).toEqual(segments);
  });

  it('encodes keys with slashes and spaces through percent-escaping', () => {
    const segments: Segment[] = [m('names'), k('a b/c')];
    const encoded = encodeStoragePath(segments);
    expect(encoded).toBe('m.names/k.a%20b%2Fc');
    expect(decodeStoragePath(encoded)).toEqual(segments);
  });

  it('omits the param for the root path and decodes absent as root', () => {
    expect(encodeStoragePath([])).toBeUndefined();
    expect(decodeStoragePath(undefined)).toEqual([]);
  });

  it.each([
    [''],
    ['foo'],
    ['x.1'],
    ['m.'],
    ['k.'],
    ['i.'],
    ['i.-3'],
    ['i.1.5'],
    ['i.abc'],
    ['a.'],
    ['a.5'],
    ['a.1-2-3'],
    ['a.x-y'],
    ['a.3-3'],
    ['a.0-65'],
    ['k.%'],
    ['k.%zz'],
    ['m.a//m.b'],
    ['m.ok/i.notanumber'],
  ])('rejects malformed path %p with null (never throws)', raw => {
    expect(decodeStoragePath(raw)).toBeNull();
  });
});

describe('clampRange', () => {
  it.each([
    [0, 8, 10, 0, 8], // identity
    [-5, 3, 10, 0, 3], // negative from clamps to 0
    [8, 99, 10, 8, 10], // to clamps to length
    [12, 15, 10, 9, 10], // from beyond length clamps to the last element
    [0, 100, 1000, 0, MAX_COLUMN_SPAN], // span capped at MAX_COLUMN_SPAN
    [5, 5, 10, 5, 6], // empty window gains min span 1
    [9, 9, 10, 9, 10], // min span at the very end
    [3, 1, 10, 3, 4], // inverted window becomes span 1
    [0, 8, 0, 0, 0], // empty array → empty window
    [0, 8, -2, 0, 0], // negative length → empty window
    [2.7, 6.2, 10, 2, 6], // fractional inputs floor
  ])('clamps [%i, %i) of length %i to [%i, %i)', (from, to, length, expectedFrom, expectedTo) => {
    expect(clampRange(from, to, length)).toEqual({ from: expectedFrom, to: expectedTo });
  });

  it('exports the pinned span constants', () => {
    expect(MAX_COLUMN_SPAN).toBe(64);
    expect(DEFAULT_COLUMN_SPAN).toBe(8);
  });
});

// ---- evmole label-first augmentation --------------------------------------
// evmole marks every entry 'inplace' and carries the real shape only in
// the label; the augmentation pass canonicalizes entries so the resolver
// treats inferred layouts like verified ones. (Live shape verified on
// mainnet USDC's evmole layout: padded 0x-less slot strings +
// everything-inplace types.)
describe('augmentLayoutTypes', () => {
  // evmole's wire shape LIES about numberOfBytes (always '32', even for
  // 20-byte addresses) and marks everything inplace — the literal won't
  // fit the discriminated templates, so the fixture asserts once to the
  // map type, exactly like a JSON.parse'd backend response.
  const evmoleTypes = {
    'address': { encoding: 'inplace', label: 'address', numberOfBytes: '32' },
    'bool': { encoding: 'inplace', label: 'bool', numberOfBytes: '32' },
    'string': { encoding: 'inplace', label: 'string', numberOfBytes: '32' },
    'uint8': { encoding: 'inplace', label: 'uint8', numberOfBytes: '32' },
    'mapping(address => bool)': {
      encoding: 'inplace',
      label: 'mapping(address => bool)',
      numberOfBytes: '32',
    },
  } as unknown as TypesMap;
  const evmoleLayout: StorageLayout = {
    storage: [
      { astId: 0, contract: '', label: 'name', offset: 0, slot: '0', type: 'string' },
      {
        astId: 1,
        contract: '',
        label: 'blacklisted',
        offset: 0,
        slot: '1',
        type: 'mapping(address => bool)',
      },
    ],
    types: evmoleTypes,
  };

  it('canonicalizes string/mapping labels into proper encodings', () => {
    const augmented = augmentLayoutTypes(evmoleLayout);
    expect(augmented.types?.string.encoding).toBe('bytes');
    expect(augmented.types?.['mapping(address => bool)'].encoding).toBe('mapping');
    const mapping = augmented.types?.['mapping(address => bool)'];
    expect(mapping && 'key' in mapping ? augmented.types?.[mapping.key]?.label : null).toBe('address');
    expect(mapping && 'value' in mapping ? augmented.types?.[mapping.value]?.label : null).toBe('bool');
  });

  it('makes evmole mappings drillable and strings decodable through the resolver', () => {
    const augmented = augmentLayoutTypes(evmoleLayout);
    const columns = resolveColumns(augmented, [
      { t: 'm', label: 'blacklisted' },
      { t: 'k', key: KEY1 },
    ]);
    const rootRows = columns[0].node.kind === 'struct' ? columns[0].node.rows : [];
    expect(rootRows[0].expand).toBe('leaf'); // the string row
    expect(rootRows[0].type?.encoding).toBe('bytes');
    expect(rootRows[1].expand).toBe('mapping'); // the blacklisted row
    // The k column resolves the bool LEAF at the keccak slot.
    expect(columns[2].error).toBeUndefined();
    expect(columns[2].node.kind).toBe('leaf');
    const expectedSlot = keccak256(
      concat([pad(KEY1 as Hex, { size: 32 }), pad('0x1', { size: 32 })]),
    );
    expect(columns[2].slot).toBe(expectedSlot);
  });

  it('synthesizes nested entries missing from the evmole types map', () => {
    const augmented = augmentLayoutTypes({
      storage: [
        {
          astId: 2,
          contract: '',
          label: 'nested',
          offset: 0,
          slot: '2',
          type: 'mapping(bytes => mapping(address => uint8))',
        },
      ],
      types: { uint8: evmoleTypes.uint8 },
    });
    const outer = augmented.types?.['mapping(bytes => mapping(address => uint8))'];
    expect(outer?.encoding).toBe('mapping');
    const valueKey = outer && 'value' in outer ? outer.value : '';
    expect(augmented.types?.[valueKey]?.label).toBe('mapping(address => uint8)');
    // The doubly-nested value resolves too (synthesized recursively).
    const inner = augmented.types?.[valueKey];
    const innerValue = inner && 'value' in inner ? inner.value : '';
    expect(augmented.types?.[innerValue]?.label).toBe('uint8');
  });

  it('passes canonical (verified-layout) entries through untouched', () => {
    const layout: StorageLayout = {
      storage: [],
      types: {
        t_uint128: { encoding: 'inplace', label: 'uint128', numberOfBytes: '16' },
        t_arr: {
          encoding: 'dynamic_array',
          base: 't_uint128',
          label: 'uint128[]',
          numberOfBytes: '32',
        },
      },
    };
    expect(augmentLayoutTypes(layout).types).toEqual(layout.types);
  });
});
