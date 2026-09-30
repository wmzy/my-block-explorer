// Manifest-completeness contract for util/storageKeys.ts — the single
// localStorage key registry the backup layer iterates. Pins:
//   (a) literal byte-stability — values written by older builds live
//       under these keys, so no constant may ever change value;
//   (b) registry hygiene — unique families, every exclusion documented,
//       the two never-export secrets (admin token, manual API base);
//   (c) export totality — every family flagged includeInBackup actually
//       lands in a generated browser-parts export when its key is
//       seeded, and a hypothetical future family without a format
//       section is attributed in notes instead of silently falling out.
import { describe, it, expect, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import {
  ADMIN_TOKEN_STORAGE_KEY,
  CHAIN_RESET_DISMISSED_PREFIX,
  CUSTOM_ABI_KEY_RE,
  CUSTOM_ABI_STORAGE_PREFIX,
  IPFS_GATEWAY_STORAGE_KEY,
  LAST_CHAIN_STORAGE_KEY,
  LAST_HEAD_STORAGE_PREFIX,
  MANUAL_BASE_STORAGE_KEY,
  PRIVATE_NOTE_KEY_PREFIX,
  PRIVATE_NOTE_KEY_RE,
  SEARCH_HISTORY_STORAGE_KEY,
  STORAGE_KEY_MANIFEST,
  THEME_STORAGE_KEY,
  VALUE_UNIT_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  type StorageKeyManifestEntry,
} from '@/util/storageKeys';
import {
  BACKUP_SECTION_ENTRY_IDS,
  planRestore,
  serializeBackup,
  type BackupBrowserParts,
} from '@/util/localBackup';
import { collectBrowserParts } from '@/services/backupRestore';

const manifestById = (id: string): StorageKeyManifestEntry | undefined =>
  STORAGE_KEY_MANIFEST.find(entry => entry.id === id);

describe('storage key manifest hygiene', () => {
  it('keeps every canonical literal byte-identical — values written by older builds live under them', () => {
    expect(THEME_STORAGE_KEY).toBe('be:theme');
    expect(WATCHLIST_STORAGE_KEY).toBe('be:watchlist');
    expect(SEARCH_HISTORY_STORAGE_KEY).toBe('be:searchHistory');
    expect(VALUE_UNIT_STORAGE_KEY).toBe('be:valueUnit');
    expect(IPFS_GATEWAY_STORAGE_KEY).toBe('be:ipfsGateway');
    expect(LAST_CHAIN_STORAGE_KEY).toBe('be:lastChainId');
    expect(LAST_HEAD_STORAGE_PREFIX).toBe('be:lastHead:');
    expect(CHAIN_RESET_DISMISSED_PREFIX).toBe('be:chainResetDismissed:');
    expect(PRIVATE_NOTE_KEY_PREFIX).toBe('be:privateNote:');
    expect(ADMIN_TOKEN_STORAGE_KEY).toBe('my-block-explorer-admin-token');
    expect(MANUAL_BASE_STORAGE_KEY).toBe('my-block-explorer-api-url');
    expect(CUSTOM_ABI_STORAGE_PREFIX).toBe('custom-abi:');
    // Families whose owner modules still hold local constants (outside
    // this slice's edit list) are pinned here too.
    expect(manifestById('onboardingDismissed')).toMatchObject({ key: 'be:onboardingDismissed' });
    expect(manifestById('sqlConsoleHistory')).toMatchObject({ key: 'be:sqlConsole' });
    expect(manifestById('viewedTokens')).toMatchObject({ prefix: 'be:viewedTokens:' });
  });

  it('gives every family a unique id, and no two exact families share a key', () => {
    const ids = STORAGE_KEY_MANIFEST.map(entry => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    const exactKeys = STORAGE_KEY_MANIFEST.filter(e => e.kind === 'exact').map(e => e.key);
    expect(new Set(exactKeys).size).toBe(exactKeys.length);
  });

  it('documents every exclusion with a reason', () => {
    for (const entry of STORAGE_KEY_MANIFEST) {
      if (entry.includeInBackup) continue;
      expect(entry.excludeReason, `${entry.id} carries an excludeReason`).toBeTruthy();
    }
  });

  it('never exports the admin token (secret) or the manual API base (machine-specific)', () => {
    expect(manifestById('adminToken')).toMatchObject({
      key: ADMIN_TOKEN_STORAGE_KEY,
      includeInBackup: false,
    });
    expect(manifestById('apiBase')).toMatchObject({
      key: MANUAL_BASE_STORAGE_KEY,
      includeInBackup: false,
    });
  });

  it('flags exactly the families the backup format has sections for', () => {
    const flagged = STORAGE_KEY_MANIFEST.filter(e => e.includeInBackup)
      .map(e => e.id)
      .sort();
    expect(flagged).toEqual([...BACKUP_SECTION_ENTRY_IDS].sort());
  });

  it('keeps the grammar regexes aligned with their prefixes', () => {
    const address = `0x${'ab'.repeat(20)}`;
    expect(CUSTOM_ABI_KEY_RE.test(`${CUSTOM_ABI_STORAGE_PREFIX}1:${address}`)).toBe(true);
    expect(
      PRIVATE_NOTE_KEY_RE.test(`${PRIVATE_NOTE_KEY_PREFIX}1:0x${'ab'.repeat(20).toUpperCase()}`),
    ).toBe(true);
    // Off-grammar keys never match — the restore's smuggling safety rail.
    expect(CUSTOM_ABI_KEY_RE.test(THEME_STORAGE_KEY)).toBe(false);
    expect(PRIVATE_NOTE_KEY_RE.test(`${CUSTOM_ABI_STORAGE_PREFIX}1:${address}`)).toBe(false);
  });
});

describe('export totality — the manifest drives what a backup carries', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // One seeded, app-valid entry per backed-up family. A family flagged
  // includeInBackup without a fixture here fails the tests below — that
  // is the "new keys cannot silently fall out of backups" pin.
  const FIXTURES: Record<string, { key: string; value: string; marker: string }> = {
    watchlist: {
      key: WATCHLIST_STORAGE_KEY,
      value: JSON.stringify(['0x1234567890abcdef1234567890abcdef12345678']),
      marker: '0x1234567890abcdef1234567890abcdef12345678',
    },
    theme: { key: THEME_STORAGE_KEY, value: 'dark', marker: 'dark' },
    ipfsGateway: {
      key: IPFS_GATEWAY_STORAGE_KEY,
      value: 'https://fixture-gateway.example',
      marker: 'https://fixture-gateway.example',
    },
    customAbi: {
      key: 'custom-abi:1:0x1234567890abcdef1234567890abcdef12345678',
      value: '[{"type":"function","name":"fixtureCustomAbiFamily"}]',
      marker: 'fixtureCustomAbiFamily',
    },
    privateNote: {
      key: 'be:privateNote:1:0x1234567890abcdef1234567890abcdef12345678',
      value: 'fixture private note body',
      marker: 'fixture private note body',
    },
  };

  it('has a seeded fixture for every flagged family', () => {
    for (const entry of STORAGE_KEY_MANIFEST) {
      if (!entry.includeInBackup) continue;
      expect(FIXTURES, `seed fixture for flagged family ${entry.id}`).toHaveProperty(entry.id);
    }
  });

  it('collects every flagged family for a seeded localStorage', () => {
    for (const { key, value } of Object.values(FIXTURES)) {
      localStorage.setItem(key, value);
    }
    const notes: string[] = [];
    const browser = collectBrowserParts(notes);
    const serialized = JSON.stringify(browser);
    for (const [id, { marker }] of Object.entries(FIXTURES)) {
      expect(serialized, `${id} must reach the export`).toContain(marker);
    }
    // No honest-drop line fired: every flagged family landed somewhere.
    expect(notes).toEqual([]);
    // The structured sections keep their shapes (not just raw values).
    expect(browser.watchlist).toEqual(['0x1234567890abcdef1234567890abcdef12345678']);
    expect(browser.theme).toBe('dark');
    expect(browser.ipfsGateway).toBe('https://fixture-gateway.example');
    expect(browser.customAbis).toEqual([{ key: FIXTURES.customAbi.key, abi: FIXTURES.customAbi.value }]);
    expect(browser.privateNotes).toEqual([
      {
        chainId: 1,
        address: getAddress('0x1234567890abcdef1234567890abcdef12345678'),
        note: 'fixture private note body',
      },
    ]);
  });

  it('reads an empty browser as all-null sections with no notes', () => {
    const notes: string[] = [];
    expect(collectBrowserParts(notes)).toEqual({
      watchlist: null,
      theme: null,
      ipfsGateway: null,
      customAbis: [],
      privateNotes: [],
    });
    expect(notes).toEqual([]);
  });

  it('leaves secret and machine-specific families out of the export entirely', () => {
    localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, 'fixture-admin-secret');
    localStorage.setItem(MANUAL_BASE_STORAGE_KEY, 'http://10.0.0.5:8201');
    const notes: string[] = [];
    const browser = collectBrowserParts(notes);
    expect(JSON.stringify(browser)).not.toContain('fixture-admin-secret');
    expect(JSON.stringify(browser)).not.toContain('10.0.0.5');
    expect(notes).toEqual([]);
  });

  it('attributes a hypothetical flagged family with no format section instead of dropping it silently', () => {
    localStorage.setItem('be:hypothetical', 'future-feature-data');
    const notes: string[] = [];
    const hypothetical: StorageKeyManifestEntry[] = [
      ...STORAGE_KEY_MANIFEST,
      {
        id: 'hypothetical',
        owner: 'tests — a future feature family',
        kind: 'exact',
        key: 'be:hypothetical',
        includeInBackup: true,
      },
    ];
    const browser = collectBrowserParts(notes, hypothetical);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/hypothetical/);
    expect(notes[0]).toMatch(/no section/);
    // The known families still export normally alongside the attribution.
    expect(browser.watchlist).toBeNull();
  });

  it('collects a hypothetical prefix family by startsWith (and attributes it too)', () => {
    localStorage.setItem('be:futureStuff:1', 'a');
    localStorage.setItem('be:futureStuff:2', 'b');
    localStorage.setItem('be:futureStuffifier', 'c'); // shares the stem, not the family
    const notes: string[] = [];
    const hypothetical: StorageKeyManifestEntry[] = [
      ...STORAGE_KEY_MANIFEST,
      {
        id: 'futureStuff',
        owner: 'tests — a future prefix family',
        kind: 'prefix',
        prefix: 'be:futureStuff:',
        includeInBackup: true,
      },
    ];
    collectBrowserParts(notes, hypothetical);
    expect(notes).toHaveLength(1);
    // Exactly the two grammar-owned keys (the stem-sharer is not family).
    expect(notes[0]).toMatch(/futureStuff skipped — 2 stored value/);
  });

  it('plans restore writes only inside families the manifest flags for backup', () => {
    const browser: BackupBrowserParts = {
      watchlist: ['0x1234567890abcdef1234567890abcdef12345678'],
      theme: 'dark',
      ipfsGateway: 'https://fixture-gateway.example',
      customAbis: [{ key: FIXTURES.customAbi.key, abi: FIXTURES.customAbi.value }],
      privateNotes: [
        {
          chainId: 1,
          address: getAddress('0x1234567890abcdef1234567890abcdef12345678'),
          note: 'fixture private note body',
        },
      ],
    };
    const writes = planRestore(serializeBackup({ labels: [], customChains: [], browser }), () => null)
      .storageWrites;
    expect(writes.length).toBeGreaterThan(0);
    const flagged = STORAGE_KEY_MANIFEST.filter(e => e.includeInBackup);
    const covered = (key: string): boolean =>
      flagged.some(family =>
        family.kind === 'exact'
          ? family.key === key
          : family.kind === 'prefix'
            ? key.startsWith(family.prefix)
            : family.pattern.test(key),
      );
    for (const write of writes) {
      expect(covered(write.key), `${write.key} must sit inside a flagged manifest family`).toBe(
        true,
      );
    }
  });
});
