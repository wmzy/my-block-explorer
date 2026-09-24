// Pure-layer contract for the backup format (util/localBackup.ts):
// serialize→parse round-trip fidelity, typed rejection of wrong-version
// and malformed files (no partial guess), and the merge planner's exact
// write plan (skip-equal keys, overwrites flag, lowercased label PUT
// keys, chain POST inputs). Everything here is pure — localStorage is
// only ever seen through the injected reader.
import { describe, it, expect } from 'vitest';
import {
  BACKUP_VERSION,
  parseBackup,
  parseBackupChainRow,
  parseBackupLabelRow,
  planRestore,
  serializeBackup,
  type BackupParts,
} from '@/util/localBackup';
import { WATCHLIST_STORAGE_KEY } from '@/util/watchlist';
import { THEME_STORAGE_KEY } from '@/themePreference';
import { IPFS_GATEWAY_STORAGE_KEY } from '@/services/nftMetadata';

const NOW = new Date('2026-09-24T12:00:00.000Z');

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
    const future = { ...base, version: 2 };
    const parsed = parseBackup(JSON.stringify(future));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error.kind).toBe('unknown_version');
      expect(parsed.error.message).toContain('2');
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
        browser: { watchlist: null, theme: null, ipfsGateway: null, customAbis: [] },
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
