// Pure-layer contract for the backup format (util/localBackup.ts):
// serialize→parse round-trip fidelity, typed rejection of wrong-version
// and malformed files (no partial guess), and the merge planner's exact
// write plan (skip-equal keys, overwrites flag, lowercased label PUT
// keys, chain POST inputs). Everything here is pure — localStorage is
// only ever seen through the injected reader.
import { describe, it, expect } from 'vitest';
import { getAddress } from 'viem';
import {
  BACKUP_VERSION,
  parseBackup,
  parseBackupChainRow,
  parseBackupLabelRow,
  planRestore,
  serializeBackup,
  type BackupParts,
  type BackupPrivateNote,
} from '@/util/localBackup';
import { WATCHLIST_STORAGE_KEY } from '@/util/watchlist';
import { THEME_STORAGE_KEY } from '@/themePreference';
import { IPFS_GATEWAY_STORAGE_KEY } from '@/services/nftMetadata';
import {
  PRIVATE_NOTE_KEY_PREFIX,
  PRIVATE_NOTE_KEY_RE,
  PRIVATE_NOTE_MAX_CHARS,
  readPrivateNote,
} from '@/util/privateNotes';

const NOW = new Date('2026-09-24T12:00:00.000Z');

const NOTE_ADDRESS = getAddress('0x2345678901abcdef2345678901abcdef23456789');

const PARTS: BackupParts = {
  labels: [
    {
      chainId: 1,
      address: '0x1234567890abcdef1234567890abcdef12345678',
      label: 'Cold wallet',
      note: 'hardware backup in safe',
      source: 'user',
      updatedAt: '2026-09-20T08:00:00.000Z',
    },
    {
      chainId: 137,
      address: '0xAbCdEf0123456789012345678901234567890123'.toLowerCase(),
      label: 'Binance 14',
      note: null,
      source: 'builtin',
      updatedAt: null,
    },
  ],
  customChains: [
    {
      chainId: 31337,
      name: 'Anvil',
      symbol: 'ETH',
      decimals: 18,
      rpcUrl: 'http://127.0.0.1:8545',
    },
  ],
  browser: {
    watchlist: ['0x1234567890AbCdEf1234567890aBcDeF12345678'],
    theme: 'dark',
    ipfsGateway: 'https://pin.mydomain.dev',
    customAbis: [
      { key: 'custom-abi:1:0x1234567890abcdef1234567890abcdef12345678', abi: '[{"type":"function"}]' },
    ],
    privateNotes: [
      { chainId: 1, address: NOTE_ADDRESS, note: 'treasury — hardware key in the office safe' },
    ],
  },
};

describe('serializeBackup → parseBackup round-trip', () => {
  it('preserves every part across the JSON wire', () => {
    const file = serializeBackup(PARTS, NOW);
    const parsed = parseBackup(JSON.stringify(file));

    expect(parsed).toEqual({ ok: true, file });
    expect(file.version).toBe(BACKUP_VERSION);
    expect(file.exportedAt).toBe('2026-09-24T12:00:00.000Z');
  });

  it('omits the notes field when there are no notes, carries it when there are', () => {
    expect(serializeBackup(PARTS, NOW).notes).toBeUndefined();

    const withNotes = serializeBackup(
      { ...PARTS, notes: ['server data skipped — backend unreachable'] },
      NOW,
    );
    expect(withNotes.notes).toEqual(['server data skipped — backend unreachable']);
    expect(parseBackup(JSON.stringify(withNotes))).toEqual({ ok: true, file: withNotes });
  });
});

describe('parseBackup rejections (typed, whole-file)', () => {
  const base = serializeBackup(PARTS, NOW);

  it('rejects non-JSON with not_json', () => {
    const parsed = parseBackup('this is not json{');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('not_json');
  });

  it('rejects a future version with unknown_version', () => {
    const future = { ...base, version: BACKUP_VERSION + 1 };
    const parsed = parseBackup(JSON.stringify(future));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe('unknown_version');
      expect(parsed.error.message).toContain(String(BACKUP_VERSION + 1));
    }
  });

  it('rejects a missing version with unknown_version', () => {
    const versionless: Record<string, unknown> = { ...base };
    delete versionless.version;
    const parsed = parseBackup(JSON.stringify(versionless));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('unknown_version');
  });

  it('rejects a non-object root with malformed', () => {
    const parsed = parseBackup(JSON.stringify(['not', 'an', 'object']));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('malformed');
  });

  it('rejects a label row with a non-hex address, salvaging nothing', () => {
    const bad = { ...base, labels: [{ ...base.labels[0], address: '0xzz' }] };
    const parsed = parseBackup(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('malformed');
  });

  it('rejects a label over the write-API cap instead of letting it fail at PUT time', () => {
    const bad = { ...base, labels: [{ ...base.labels[0], label: 'x'.repeat(65) }] };
    const parsed = parseBackup(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe('malformed');
      expect(parsed.error.message).toContain('labels[0]');
    }
  });

  it('rejects an unknown label source (the API pins builtin|user)', () => {
    const bad = { ...base, labels: [{ ...base.labels[0], source: 'mystery' }] };
    const parsed = parseBackup(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('malformed');
  });

  it('rejects an invalid theme value', () => {
    const bad = { ...base, browser: { ...base.browser, theme: 'neon' } };
    const parsed = parseBackup(JSON.stringify(bad));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.kind).toBe('malformed');
  });

  it('rejects customAbis keys that do not spell custom-abi:<chainId>:<lowercase address>', () => {
    // The pattern is the restore's safety rail: a backup must not be
    // able to write arbitrary localStorage keys (e.g. be:theme).
    const smuggled = { ...base, browser: { ...base.browser, customAbis: [{ key: 'be:theme', abi: 'x' }] } };
    const parsed = parseBackup(JSON.stringify(smuggled));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe('malformed');
      expect(parsed.error.message).toContain('arbitrary localStorage keys');
    }
  });

  it('rejects a watchlist over the app cap and non-address entries', () => {
    const overCap = {
      ...base,
      browser: { ...base.browser, watchlist: Array.from({ length: 26 }, () => base.browser.watchlist![0]) },
    };
    expect(parseBackup(JSON.stringify(overCap)).ok).toBe(false);

    const notAddress = { ...base, browser: { ...base.browser, watchlist: ['nope'] } };
    expect(parseBackup(JSON.stringify(notAddress)).ok).toBe(false);
  });
});

describe('row guards (shared with the export collector)', () => {
  it('parseBackupLabelRow accepts the API shape and rejects degenerate rows', () => {
    expect(parseBackupLabelRow(PARTS.labels[0])).toEqual(PARTS.labels[0]);
    expect(parseBackupLabelRow({ ...PARTS.labels[0], chainId: 0 })).toBeNull();
    expect(parseBackupLabelRow({ ...PARTS.labels[0], note: 7 })).toBeNull();
    expect(parseBackupLabelRow(null)).toBeNull();
  });

  it('parseBackupChainRow accepts the API shape and rejects degenerate rows', () => {
    expect(parseBackupChainRow(PARTS.customChains[0])).toEqual(PARTS.customChains[0]);
    expect(parseBackupChainRow({ ...PARTS.customChains[0], rpcUrl: '' })).toBeNull();
    expect(parseBackupChainRow({ ...PARTS.customChains[0], decimals: 1.5 })).toBeNull();
  });
});

describe('planRestore merge planner', () => {
  const file = serializeBackup(PARTS, NOW);
  const abiKey = PARTS.browser.customAbis[0].key;

  type RestoreStorageReader = (key: string) => string | null;
  const emptyStorage = (): RestoreStorageReader => () => null;

  it('plans every write against an empty browser', () => {
    const plan = planRestore(file, emptyStorage());

    expect(plan.storageWrites).toEqual([
      { key: WATCHLIST_STORAGE_KEY, value: JSON.stringify(PARTS.browser.watchlist), overwrites: false },
      { key: THEME_STORAGE_KEY, value: 'dark', overwrites: false },
      { key: IPFS_GATEWAY_STORAGE_KEY, value: 'https://pin.mydomain.dev', overwrites: false },
      { key: abiKey, value: PARTS.browser.customAbis[0].abi, overwrites: false },
      // The private note rebuilds its key through the store's builder —
      // checksummed address, pinned prefix.
      {
        key: `${PRIVATE_NOTE_KEY_PREFIX}1:${NOTE_ADDRESS}`,
        value: PARTS.browser.privateNotes[0].note,
        overwrites: false,
      },
    ]);
    // Labels: all rows, storage-key lowercase.
    expect(plan.labelPuts).toEqual([
      {
        chainId: 1,
        address: PARTS.labels[0].address,
        label: 'Cold wallet',
        note: 'hardware backup in safe',
      },
      { chainId: 137, address: PARTS.labels[1].address, label: 'Binance 14', note: null },
    ]);
    // Chains: one POST per row, chain id from the probe.
    expect(plan.chainPosts).toEqual([
      {
        chainId: 31337,
        input: { rpcUrl: 'http://127.0.0.1:8545', name: 'Anvil', symbol: 'ETH', decimals: 18 },
      },
    ]);
  });

  it('skips keys already holding the backup value and flags real overwrites', () => {
    const current = new Map<string, string>([
      [WATCHLIST_STORAGE_KEY, JSON.stringify(PARTS.browser.watchlist)], // identical → no write
      [THEME_STORAGE_KEY, 'light'], // different → overwrite
      [abiKey, '[]'], // different → overwrite
      [`${PRIVATE_NOTE_KEY_PREFIX}1:${NOTE_ADDRESS}`, PARTS.browser.privateNotes[0].note], // identical → no write
    ]);
    const plan = planRestore(file, key => current.get(key) ?? null);

    expect(plan.storageWrites).toEqual([
      { key: THEME_STORAGE_KEY, value: 'dark', overwrites: true },
      { key: IPFS_GATEWAY_STORAGE_KEY, value: 'https://pin.mydomain.dev', overwrites: false },
      { key: abiKey, value: PARTS.browser.customAbis[0].abi, overwrites: true },
    ]);
  });

  it('plans no browser writes when the backup carries null sections', () => {
    const sparse = serializeBackup(
      {
        labels: [],
        customChains: [],
        browser: { watchlist: null, theme: null, ipfsGateway: null, customAbis: [], privateNotes: [] },
      },
      NOW,
    );
    const plan = planRestore(sparse, key => (key === THEME_STORAGE_KEY ? 'dark' : null));
    expect(plan.storageWrites).toEqual([]);
    expect(plan.labelPuts).toEqual([]);
    expect(plan.chainPosts).toEqual([]);
  });

  it('lowercases label addresses so the PUT key matches the storage convention', () => {
    const mixed = serializeBackup(
      {
        ...PARTS,
        labels: [
          {
            chainId: 1,
            // Checksummed (mixed-case) form — valid for the regex, must
            // still restore through the lowercase storage key.
            address: '0xAbCdEf0123456789012345678901234567890123',
            label: 'Mixed',
            note: null,
            source: 'user',
            updatedAt: null,
          },
        ],
      },
      NOW,
    );
    const plan = planRestore(mixed, emptyStorage());
    expect(plan.labelPuts[0].address).toBe('0xabcdef0123456789012345678901234567890123');
  });
});

describe('private notes (v2 section)', () => {
  const noteFile = serializeBackup(PARTS, NOW);
  const emptyStorage = (): ((key: string) => string | null) => () => null;

  it('round-trips notes through the JSON wire, checksum-normalizing addresses', () => {
    // A lowercase (checksum-less) note address exports from a
    // hand-normalized file and parses back as the checksummed form.
    const lowercased = JSON.parse(JSON.stringify(noteFile)) as typeof noteFile;
    lowercased.browser.privateNotes[0].address = NOTE_ADDRESS.toLowerCase();
    const parsed = parseBackup(JSON.stringify(lowercased));
    expect(parsed).toEqual({ ok: true, file: noteFile });
  });

  it('still imports v1 files — and ignores a privateNotes section smuggled into one', () => {
    const v1 = JSON.parse(JSON.stringify(noteFile)) as Record<string, unknown>;
    v1.version = 1;
    delete (v1.browser as Record<string, unknown>).privateNotes;
    const parsed = parseBackup(JSON.stringify(v1));
    // A v1 file IS a v2 file with no notes — normalized on parse, so a
    // re-export upgrades it losslessly.
    expect(parsed).toEqual({
      ok: true,
      file: { ...noteFile, browser: { ...noteFile.browser, privateNotes: [] } },
    });

    // A v1 file carrying a hand-added privateNotes section ignores it
    // (v1 readers ignore unknown sections; half-trusting hand-added v1
    // data would be worse than dropping it).
    const smuggled = JSON.parse(JSON.stringify(v1)) as Record<string, unknown>;
    (smuggled.browser as Record<string, unknown>).privateNotes
      = [{ chainId: 1, address: NOTE_ADDRESS, note: 'smuggled' }];
    const parsedSmuggled = parseBackup(JSON.stringify(smuggled));
    expect(parsedSmuggled.ok).toBe(true);
    if (parsedSmuggled.ok) {
      expect(parsedSmuggled.file.browser.privateNotes).toEqual([]);
    }
  });

  it('requires the section to exist and every row to be a valid note', () => {
    const drop = JSON.parse(JSON.stringify(noteFile)) as Record<string, unknown>;
    delete (drop.browser as Record<string, unknown>).privateNotes;
    expect(parseBackup(JSON.stringify(drop)).ok).toBe(false);

    const bad = (row: Record<string, unknown>): boolean => {
      const mutated = JSON.parse(JSON.stringify(noteFile)) as typeof noteFile;
      mutated.browser.privateNotes = [row as unknown as BackupPrivateNote];
      return !parseBackup(JSON.stringify(mutated)).ok;
    };
    expect(bad({ chainId: 0, address: NOTE_ADDRESS, note: 'n' })).toBe(true);
    expect(bad({ chainId: 1.5, address: NOTE_ADDRESS, note: 'n' })).toBe(true);
    expect(bad({ chainId: 1, address: '0xzz', note: 'n' })).toBe(true);
    // Mixed-case body that is NOT the EIP-55 spelling — rejected even
    // though the hex shape is fine (the planned write key is built from
    // this value; a wrong checksum must die at parse time).
    expect(bad({ chainId: 1, address: '0x2345678901AbCdEf2345678901abCdEf23456789', note: 'n' })).toBe(true);
    expect(bad({ chainId: 1, address: NOTE_ADDRESS, note: '' })).toBe(true);
    expect(bad({ chainId: 1, address: NOTE_ADDRESS, note: 'x'.repeat(PRIVATE_NOTE_MAX_CHARS + 1) })).toBe(true);
    expect(bad({ chainId: 1, address: NOTE_ADDRESS, note: 7 })).toBe(true);
    expect(bad({ chainId: 1, address: NOTE_ADDRESS })).toBe(true);
    // Duplicates (same chainId + address, case-insensitive) reject.
    const dup = JSON.parse(JSON.stringify(noteFile)) as typeof noteFile;
    dup.browser.privateNotes = [
      { chainId: 1, address: NOTE_ADDRESS, note: 'a' },
      { chainId: 1, address: NOTE_ADDRESS.toLowerCase(), note: 'b' },
    ];
    expect(parseBackup(JSON.stringify(dup)).ok).toBe(false);
  });

  it('pins every planned note write inside the be:privateNote: grammar — no hostile keys', () => {
    // Structural safety rail (the custom-abi mirror): the section carries
    // {chainId, address, note} rows, not raw keys, and the planner
    // rebuilds each key through the store's own builder — so no file
    // content can steer a write at, say, be:theme.
    const plan = planRestore(noteFile, emptyStorage());
    const noteWrites = plan.storageWrites.filter(write => write.value === PARTS.browser.privateNotes[0].note);
    expect(noteWrites).toHaveLength(1);
    for (const write of plan.storageWrites) {
      if (write.key.startsWith(PRIVATE_NOTE_KEY_PREFIX)) {
        expect(write.key).toMatch(PRIVATE_NOTE_KEY_RE);
      }
    }
    expect(plan.storageWrites.some(write => write.key === 'be:theme' && write.value !== 'dark')).toBe(false);
  });

  it('full round-trip: a planned note write lands where the store reads it back', () => {
    localStorage.clear();
    const plan = planRestore(noteFile, emptyStorage());
    for (const write of plan.storageWrites) {
      localStorage.setItem(write.key, write.value);
    }
    expect(readPrivateNote(1, NOTE_ADDRESS)).toBe(PARTS.browser.privateNotes[0].note);
    localStorage.clear();
  });
});
