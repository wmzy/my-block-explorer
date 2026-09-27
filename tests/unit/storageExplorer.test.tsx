// Component tests for the Finder-style storage explorer. The store's slot
// reads are injected through StorageValuesProvider's reader prop (via
// StorageExplorer's own reader passthrough) — no service mocking. The
// fixture reuses the Vault contract from storageColumnModel.test.ts,
// extended with a root struct member (`settings`) so struct drills are
// reachable from the root column. Expected slots are recomputed
// independently with viem primitives, never via the module under test.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { concat, getAddress, keccak256, pad, toHex, type Hex } from 'viem';
import type { StorageLayout, TypesMap } from '@/types/storage';
import type { SlotReader } from '@/services/storageValues';
import { StorageExplorer } from '@/components/storage';

const ADDR = '0xabc0000000000000000000000000000000000001';
const ZERO_WORD = `0x${'0'.repeat(64)}`;

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
  t_settings: {
    encoding: 'inplace',
    label: 'struct Settings',
    numberOfBytes: '64',
    members: [
      { astId: 6, contract: 'Vault', label: 'admin', offset: 0, slot: '0', type: 't_address' },
      { astId: 7, contract: 'Vault', label: 'inner', offset: 0, slot: '1', type: 't_point' },
    ],
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
    member(19, 'settings', '9', 't_settings'),
  ],
  types,
};

// Independently computed fixture slots (viem, not the module under test).
const NAME_ABC_SLOT = keccak256(concat([keccak256(toHex('abc')), pad('0x2', { size: 32 })]));
const OWNER_ADDR = '0x1111111111111111111111111111111111111111';

// Fake reader keyed by canonical slot hex; unlisted slots read as the
// zero word (a valid empty read, exactly like a live node answers).
const createFakeReader = (map: Record<string, Hex>) => {
  const calls: Hex[] = [];
  const reader: SlotReader = async slot => {
    const key = toHex(BigInt(slot));
    calls.push(key);
    return map[key] ?? ZERO_WORD;
  };
  return { reader, calls };
};

const flush = async (): Promise<void> => {
  await waitFor(() => new Promise(resolve => setTimeout(resolve, 0)));
};

const renderExplorer = (opts: {
  reader: SlotReader;
  initialPath?: string;
  onPathChange?: (sv: string | undefined) => void;
}) =>
  render(
    <StorageExplorer
      chainId={1}
      address={ADDR}
      layoutAddress={ADDR}
      layout={layout}
      reader={opts.reader}
      initialPath={opts.initialPath}
      onPathChange={opts.onPathChange}
    />,
  );

// The Open button inside a specific member row (rows are located by the
// title attribute on their truncated label span).
const openButtonInRow = (label: string): HTMLElement => {
  const labelSpan = screen.getByTitle(label);
  const rowTop = labelSpan.parentElement as HTMLElement;
  return within(rowTop).getByRole('button', { name: 'Open ▸' });
};

describe('StorageExplorer', () => {
  it('renders the root column with one row per storage member', async () => {
    const { reader } = createFakeReader({
      '0x0': pad(OWNER_ADDR as Hex, { size: 32 }),
    });
    const onPathChange = vi.fn();
    renderExplorer({ reader, onPathChange });

    for (const label of ['owner', 'accounts', 'names', 'whitelist', 'grid', 'points', 'settings']) {
      expect(screen.getByTitle(label)).toBeInTheDocument();
    }
    // Slot chips and type chips for the first members.
    expect(screen.getByRole('button', { name: 'slot 0' })).toBeInTheDocument();
    expect(screen.getByText('mapping(address => struct Account)')).toBeInTheDocument();
    // The root column carries no close button, and mounting it reads
    // exactly the leaf slots it displays (owner only) — arrays/mappings
    // read nothing until drilled.
    expect(screen.queryByRole('button', { name: /Close / })).not.toBeInTheDocument();
    await waitFor(() => expect(reader).toBeTruthy());
    expect(await screen.findByText(getAddress(OWNER_ADDR))).toBeInTheDocument();
    // No interaction yet: the ?sv writer stays silent.
    expect(onPathChange).not.toHaveBeenCalled();
  });

  it('opens a struct member as a new column and emits the encoded path', async () => {
    const { reader } = createFakeReader({});
    const onPathChange = vi.fn();
    renderExplorer({ reader, onPathChange });
    const user = userEvent.setup();

    await user.click(openButtonInRow('settings'));

    expect(await screen.findByTitle('Storage.settings')).toBeInTheDocument();
    // The struct's members render inside the new column.
    expect(screen.getByTitle('admin')).toBeInTheDocument();
    expect(screen.getByTitle('inner')).toBeInTheDocument();
    expect(onPathChange).toHaveBeenLastCalledWith('m.settings');
  });

  it('blocks the mapping Open on an invalid key', async () => {
    const { reader } = createFakeReader({});
    renderExplorer({ reader });
    const user = userEvent.setup();

    const input = screen.getByLabelText('Mapping key for mapping(address => struct Account)');
    await user.type(input, 'nothex');

    expect(await screen.findByText('Invalid address')).toBeInTheDocument();
    const keyRow = input.parentElement as HTMLElement;
    expect(within(keyRow).getByRole('button', { name: 'Open ▸' })).toBeDisabled();
    // No key was encoded → no slot was ever read for this mapping.
    expect(screen.queryByTitle('Storage.accounts[nothex]')).not.toBeInTheDocument();
  });

  it('renders a leaf-valued mapping INLINE without opening a column', async () => {
    const { reader, calls } = createFakeReader({
      [NAME_ABC_SLOT]: pad(toHex(123n), { size: 32 }),
    });
    const onPathChange = vi.fn();
    renderExplorer({ reader, onPathChange });
    const user = userEvent.setup();

    const input = screen.getByLabelText('Mapping key for mapping(string => uint256)');
    await user.type(input, 'abc');

    // The value appears under the input, decoded from the keccak-derived
    // value slot; no column is opened and no path is emitted.
    expect(await screen.findByText('123')).toBeInTheDocument();
    expect(calls).toContain(NAME_ABC_SLOT);
    expect(screen.queryByTitle('Storage.names[abc]')).not.toBeInTheDocument();
    expect(onPathChange).not.toHaveBeenCalled();
  });

  it('shows the live array length and keeps the committed range span', async () => {
    const { reader, calls } = createFakeReader({
      '0x3': pad(toHex(3n), { size: 32 }),
    });
    const onPathChange = vi.fn();
    renderExplorer({ reader, onPathChange });
    const user = userEvent.setup();

    await user.click(openButtonInRow('whitelist'));
    expect(await screen.findByText('length: 3')).toBeInTheDocument();
    expect(calls).toContain('0x3');

    // Before the length lands the default window is 0..8; once it lands
    // the rendered window clamps to the live length.
    await waitFor(() => expect(screen.queryByTitle('[7]')).not.toBeInTheDocument());
    expect(screen.getByTitle('[2]')).toBeInTheDocument();

    // Commit a new start index; the end stays — the span shrinks with the
    // clamped window and the 'a' segment lands in the URL path.
    const from = screen.getByLabelText('Range start index');
    await user.clear(from);
    await user.type(from, '1');
    await user.tab();

    expect(onPathChange).toHaveBeenLastCalledWith('m.whitelist/a.1-3');
    await waitFor(() => expect(screen.queryByTitle('[0]')).not.toBeInTheDocument());
    expect(screen.getByTitle('[1]')).toBeInTheDocument();
    expect(screen.getByTitle('[2]')).toBeInTheDocument();
  });

  it('closes a column and truncates everything to its right', async () => {
    const { reader } = createFakeReader({});
    const onPathChange = vi.fn();
    renderExplorer({ reader, onPathChange });
    const user = userEvent.setup();

    await user.click(openButtonInRow('settings'));
    await user.click(openButtonInRow('inner'));
    expect(await screen.findByTitle('Storage.settings.inner')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Close Storage.settings.inner column' }));

    await waitFor(() =>
      expect(screen.queryByTitle('Storage.settings.inner')).not.toBeInTheDocument(),
    );
    expect(screen.getByTitle('Storage.settings')).toBeInTheDocument();
    expect(onPathChange).toHaveBeenLastCalledWith('m.settings');
  });

  it('degrades a malformed initial path to the root column', () => {
    const { reader } = createFakeReader({});
    renderExplorer({ reader, initialPath: 'garbage' });

    expect(screen.getByTitle('Storage')).toBeInTheDocument();
    expect(screen.queryByTitle('Storage.garbage')).not.toBeInTheDocument();
    // Root only: no column offers a close button.
    expect(screen.queryByRole('button', { name: /Close / })).not.toBeInTheDocument();
  });

  it('stops issuing slot reads once the Values toggle is off', async () => {
    const { reader, calls } = createFakeReader({
      '0x0': pad(OWNER_ADDR as Hex, { size: 32 }),
    });
    renderExplorer({ reader });
    const user = userEvent.setup();

    // Mount reads the root's single leaf value.
    await screen.findByText(getAddress(OWNER_ADDR));
    expect(calls).toEqual(['0x0']);

    await user.click(screen.getByRole('button', { name: /Values: on/ }));

    // Drilling after the toggle mounts a new leaf (settings.admin at
    // slot 9) — with reads gated it must never reach the reader.
    await user.click(openButtonInRow('settings'));
    expect(await screen.findByTitle('Storage.settings')).toBeInTheDocument();
    await flush();
    expect(calls).toEqual(['0x0']);
  });

  it('restores a deep-linked array range from the URL path', async () => {
    // No open handler ever ran for this path — the array column's length
    // slot must be DERIVED from the parent row (member slot 3).
    const { reader, calls } = createFakeReader({
      '0x3': pad(toHex(3n), { size: 32 }),
    });
    renderExplorer({ reader, initialPath: 'm.whitelist/a.1-3' });

    expect(screen.getByTitle('Storage.whitelist')).toBeInTheDocument();
    expect(await screen.findByText('length: 3')).toBeInTheDocument();
    expect(calls).toContain('0x3');
    // The governing 'a' view renders ONCE (the 'a'-created duplicate is
    // skipped) with the URL's window: [1] and [2], never [0].
    expect(screen.getByTitle('[1]')).toBeInTheDocument();
    expect(screen.getByTitle('[2]')).toBeInTheDocument();
    expect(screen.queryByTitle('[0]')).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Storage.whitelist')).toHaveLength(1);
  });

  it('drills an element mapping with index and key together', async () => {
    // flags: dynamic array of mappings — element rows carry the key-input
    // pattern and Open must push BOTH the index and the key (the 'k'
    // resolves against the element's mapping-shell column).
    const registryLayout: StorageLayout = {
      storage: [member(1, 'flags', '0', 't_flags')],
      types: {
        t_uint: { encoding: 'inplace', label: 'uint256', numberOfBytes: '32' },
        t_point: types.t_point,
        t_entry: {
          encoding: 'mapping',
          key: 't_uint',
          value: 't_point',
          label: 'mapping(uint256 => struct Point)',
          numberOfBytes: '32',
        },
        t_flags: {
          encoding: 'dynamic_array',
          base: 't_entry',
          label: 'mapping(uint256 => struct Point)[]',
          numberOfBytes: '32',
        },
      },
    };
    const { reader } = createFakeReader({ '0x0': pad(toHex(2n), { size: 32 }) });
    const onPathChange = vi.fn();
    render(
      <StorageExplorer
        chainId={1}
        address={ADDR}
        layoutAddress={ADDR}
        layout={registryLayout}
        reader={reader}
        onPathChange={onPathChange}
      />,
    );
    const user = userEvent.setup();

    await user.click(openButtonInRow('flags'));
    expect(await screen.findByText('length: 2')).toBeInTheDocument();

    // Both element rows ([0] and [1]) carry the same key input label —
    // DOM order makes the first one element [0].
    const input = screen.getAllByLabelText('Mapping key for mapping(uint256 => struct Point)')[0];
    await user.type(input, '7');
    await user.click(
      within(input.parentElement as HTMLElement).getByRole('button', { name: 'Open ▸' }),
    );

    // The pushed path is index-then-key; the value column resolves the
    // Point struct at the keccak-derived slot.
    expect(await screen.findByTitle('Storage.flags[0][7]')).toBeInTheDocument();
    expect(screen.getByTitle('x')).toBeInTheDocument();
    expect(onPathChange).toHaveBeenLastCalledWith('m.flags/i.0/k.7');
  });

  it('drills a composite mapping from a struct row via m+k segments', async () => {
    // Regression: a mapping row inside a struct column (root included)
    // must push 'm' (locate the mapping shell) AND 'k' (the key) — a bare
    // 'k' cannot pick a mapping out of a multi-member column and used to
    // render an error card instead of the value.
    const { reader } = createFakeReader({});
    const onPathChange = vi.fn();
    renderExplorer({ reader, onPathChange });
    const user = userEvent.setup();

    const key = '0x1111111111111111111111111111111111111111';
    const input = screen.getByLabelText('Mapping key for mapping(address => struct Account)');
    await user.type(input, key);
    await user.click(within(input.parentElement as HTMLElement).getByRole('button', { name: 'Open ▸' }));

    expect(await screen.findByTitle('Storage.accounts[0x1111111111111111111111111111111111111111]')).toBeInTheDocument();
    // The value column shows the Account struct's members.
    expect(screen.getByTitle('balance')).toBeInTheDocument();
    expect(screen.getByTitle('sealed')).toBeInTheDocument();
    expect(onPathChange).toHaveBeenLastCalledWith('m.accounts/k.0x1111111111111111111111111111111111111111');
  });

  it('drills a nested mapping from the shell column without re-pushing m', async () => {
    // Regression: a mapping shell (single-mapping column produced by m/k)
    // is already located — its key drill must push ONLY 'k'. Pushing 'm'
    // again duplicated the path label (allowance.allowance) and the ?sv
    // segment list.
    const nestTypes: TypesMap = {
      t_addr: { encoding: 'inplace', label: 'address', numberOfBytes: '20' },
      t_inner: {
        encoding: 'mapping',
        key: 't_addr',
        value: 't_uint256',
        label: 'mapping(address => uint256)',
        numberOfBytes: '32',
      },
      t_outer: {
        encoding: 'mapping',
        key: 't_addr',
        value: 't_inner',
        label: 'mapping(address => mapping(address => uint256))',
        numberOfBytes: '32',
      },
      t_uint256: { encoding: 'inplace', label: 'uint256', numberOfBytes: '32' },
    };
    const nestLayout: StorageLayout = {
      storage: [member(1, 'spends', '0', 't_outer')],
      types: nestTypes,
    };
    const { reader } = createFakeReader({});
    const onPathChange = vi.fn();
    render(
      <StorageExplorer
        chainId={1}
        address={ADDR}
        layoutAddress={ADDR}
        layout={nestLayout}
        reader={reader}
        onPathChange={onPathChange}
      />,
    );
    const user = userEvent.setup();
    const k1 = '0x1111111111111111111111111111111111111111';
    const k2 = '0x2222222222222222222222222222222222222222';

    const outer = screen.getByLabelText('Mapping key for mapping(address => mapping(address => uint256))');
    await user.type(outer, k1);
    await user.click(within(outer.parentElement as HTMLElement).getByRole('button', { name: 'Open ▸' }));
    // The shell column lands with the outer key in its breadcrumb.
    expect(await screen.findByTitle(`Storage.spends[${k1}]`)).toBeInTheDocument();
    expect(onPathChange).toHaveBeenLastCalledWith(`m.spends/k.${k1}`);

    // The shell's own mapping has a uint256 LEAF value: no column, no
    // Open button — the value resolves INLINE under the key input.
    const inner = await screen.findByLabelText('Mapping key for mapping(address => uint256)');
    await user.type(inner, k2);
    expect(await screen.findByText('0')).toBeInTheDocument(); // zero word (fake reader default)
    // Inline resolution pushes no path segment.
    expect(onPathChange).toHaveBeenLastCalledWith(`m.spends/k.${k1}`);
  });

  it('decodes a short string to exactly its on-chain bytes (no NUL padding)', async () => {
    // Regression: the short-bytes data occupies the HIGH-order bytes of
    // the word; slicing must take `length` bytes from the front, never
    // `32 - length` (which leaks the right-side zero padding).
    const shortTypes: TypesMap = {
      t_string: { encoding: 'bytes', label: 'string', numberOfBytes: '32' },
    };
    const shortLayout: StorageLayout = {
      storage: [member(1, 'name', '0', 't_string')],
      types: shortTypes,
    };
    const text = 'Wrapped Ether'; // 13 bytes → last byte = 26 (0x1a)
    // data (13) + zero padding (18) + length byte (1) = one 32-byte word
    const word = concat([toHex(text), pad('0x0', { size: 32 - 13 - 1 }), toHex(26n)]);
    const { reader } = createFakeReader({ '0x0': word });
    render(
      <StorageExplorer
        chainId={1}
        address={ADDR}
        layoutAddress={ADDR}
        layout={shortLayout}
        reader={reader}
      />,
    );

    const value = await screen.findByText('Wrapped Ether');
    expect(value.textContent).not.toContain('\u0000');
  });
});
