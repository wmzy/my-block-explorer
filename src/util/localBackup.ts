// Local-data backup format v1 — the "your data is yours" portability
// layer. One JSON file (explorer-backup.json) carries everything the user
// authored or chose in this explorer: the server-side address labels and
// custom chains (fetched from the backend at export, replayed through the
// same write APIs at restore) plus this browser's localStorage
// preferences (watchlist, theme, IPFS gateway, per-contract custom ABIs).
//
// This module is the PURE layer: serialize (parts → file), parse
// (file → validated parts with typed errors — a malformed or
// wrong-version file fails honestly, never a partial guess), and the
// restore merge planner (file + a storage reader → the exact write
// plan). Everything impure (HTTP, localStorage scanning, Blob download,
// plan execution) lives in services/backupRestore.ts and the settings
// modal.
//
// Validation mirrors the app's own readers/writers so a round trip is
// lossless and a hand-edited file dies at parse time instead of
// half-restoring: address shape (util/watchlist.ts regex), theme values
// (themePreference.ts), the custom-abi key spelling views/Contract
// writes, and the label/note caps the write API (routes/labels.ts)
// enforces when the plan is replayed.
import { IPFS_GATEWAY_STORAGE_KEY } from '@/services/nftMetadata';
import { THEME_STORAGE_KEY } from '@/themePreference';
import { WATCHLIST_STORAGE_KEY, WATCHLIST_MAX_ENTRIES } from '@/util/watchlist';

export const BACKUP_VERSION = 1;

// Label/note caps mirrored from the write API (routes/labels.ts): the
// restore PUTs every planned label, so a file that already violates the
// caps is rejected at parse time with a fixable message instead of N
// per-label 400s mid-restore.
const LABEL_MAX_LENGTH = 64;
const NOTE_MAX_LENGTH = 500;

// 0x + 40 hex chars — the same shape tier every address surface uses.
export const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

// Custom-ABI storage keys exactly as views/Contract writes them:
// `custom-abi:<chainId>:<lowercase address>`. Pinning the pattern here is
// also the restore's safety rail — a backup file cannot smuggle writes
// to arbitrary localStorage keys (e.g. be:theme) through customAbis.
export const CUSTOM_ABI_KEY_RE = /^custom-abi:\d+:0x[0-9a-f]{40}$/;

/** One address-label row exactly as GET /api/labels serves it. */
export type BackupLabelRow = {
  chainId: number;
  address: string;
  label: string;
  note: string | null;
  source: 'builtin' | 'user';
  updatedAt: string | null;
};

/** One custom chain exactly as GET /api/chains/custom serves it (full-URL form). */
export type BackupCustomChainRow = {
  chainId: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrl: string;
};

/** One per-contract custom ABI localStorage entry. */
export type BackupCustomAbi = { key: string; abi: string };

/**
 * Browser-local preferences. `null` means "not exported" (the key was
 * absent in the source browser) and restores to nothing — distinct from
 * an empty value, which would overwrite.
 */
export type BackupBrowserParts = {
  watchlist: string[] | null;
  theme: string | null;
  ipfsGateway: string | null;
  customAbis: BackupCustomAbi[];
};

/** The v1 backup file (what gets serialized to disk). */
export type BackupFile = {
  version: 1;
  exportedAt: string;
  labels: BackupLabelRow[];
  customChains: BackupCustomChainRow[];
  browser: BackupBrowserParts;
  /** Honest attribution for anything the export skipped (e.g. backend unreachable). */
  notes?: string[];
};

/** The gathered parts serializeBackup turns into a BackupFile. */
export type BackupParts = {
  labels: BackupLabelRow[];
  customChains: BackupCustomChainRow[];
  browser: BackupBrowserParts;
  notes?: string[];
};

/**
 * Assemble the v1 file. `now` is injectable so tests (and any future
 * deterministic tooling) can pin exportedAt.
 */
export function serializeBackup(parts: BackupParts, now: Date = new Date()): BackupFile {
  return {
    version: BACKUP_VERSION,
    exportedAt: now.toISOString(),
    labels: parts.labels,
    customChains: parts.customChains,
    browser: parts.browser,
    ...(parts.notes !== undefined && parts.notes.length > 0 ? { notes: parts.notes } : {}),
  };
}

export type ParseBackupError =
  | { kind: 'not_json'; message: string }
  | { kind: 'unknown_version'; message: string }
  | { kind: 'malformed'; message: string };

/** parseBackup result: validated parts, or a typed error — never both, never neither. */
export type ParsedBackup =
  | { ok: true; file: BackupFile }
  | { ok: false; error: ParseBackupError };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const malformed = (message: string): ParsedBackup => ({
  ok: false,
  error: { kind: 'malformed', message },
});

/**
 * Shape guard for one label row (also used by the export collector to
 * guard GET /api/labels bodies — the backup row IS the API row). Null =
 * not a valid row; the caller decides reject-the-file vs skip-the-row.
 */
export function parseBackupLabelRow(row: unknown): BackupLabelRow | null {
  if (!isPlainObject(row)) return null;
  const { chainId, address, label, note, source, updatedAt } = row;
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) return null;
  if (typeof address !== 'string' || !HEX_ADDRESS_RE.test(address)) return null;
  if (typeof label !== 'string' || label.trim().length < 1 || label.trim().length > LABEL_MAX_LENGTH) {
    return null;
  }
  if (note !== null && typeof note !== 'string') return null;
  if (typeof note === 'string' && note.length > NOTE_MAX_LENGTH) return null;
  if (source !== 'builtin' && source !== 'user') return null;
  if (updatedAt !== null && typeof updatedAt !== 'string') return null;
  return { chainId, address, label, note, source, updatedAt };
}

/** Shape guard for one custom-chain row (full-URL form). */
export function parseBackupChainRow(row: unknown): BackupCustomChainRow | null {
  if (!isPlainObject(row)) return null;
  const { chainId, name, symbol, decimals, rpcUrl } = row;
  if (typeof chainId !== 'number' || !Number.isInteger(chainId) || chainId <= 0) return null;
  if (typeof name !== 'string' || name.length === 0) return null;
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0) return null;
  if (typeof rpcUrl !== 'string' || rpcUrl.length === 0) return null;
  return { chainId, name, symbol, decimals, rpcUrl };
}

/**
 * Parse and fully validate a backup file. Honest failure contract: an
 * unparseable / wrong-version / malformed file rejects the WHOLE file
 * with one typed error — no section is salvaged into a partial restore.
 * Unknown extra keys are ignored (forward compatibility).
 */
export function parseBackup(json: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  }
  catch {
    return { ok: false, error: { kind: 'not_json', message: 'The file is not valid JSON.' } };
  }
  if (!isPlainObject(raw)) return malformed('The backup must be a JSON object.');

  if (raw.version !== BACKUP_VERSION) {
    const found = raw.version === undefined ? 'missing' : `got ${JSON.stringify(raw.version) ?? 'an unknown value'}`;
    return {
      ok: false,
      error: {
        kind: 'unknown_version',
        message: `Unsupported backup format version (${found}) — this explorer restores version ${BACKUP_VERSION} files.`,
      },
    };
  }

  const { exportedAt } = raw;
  if (typeof exportedAt !== 'string' || exportedAt.length === 0) {
    return malformed('exportedAt must be a non-empty ISO timestamp string.');
  }

  if (!Array.isArray(raw.labels)) return malformed('labels must be an array.');
  const labelRows: unknown[] = raw.labels;
  const labels: BackupLabelRow[] = [];
  for (let i = 0; i < labelRows.length; i++) {
    const parsed = parseBackupLabelRow(labelRows[i]);
    if (parsed === null) {
      return malformed(
        `labels[${i}] is not a valid row — expected {chainId, address, label (1-${LABEL_MAX_LENGTH} chars), note (≤${NOTE_MAX_LENGTH} chars or null), source ('builtin'|'user'), updatedAt}.`,
      );
    }
    labels.push(parsed);
  }

  if (!Array.isArray(raw.customChains)) return malformed('customChains must be an array.');
  const chainRows: unknown[] = raw.customChains;
  const customChains: BackupCustomChainRow[] = [];
  for (let i = 0; i < chainRows.length; i++) {
    const parsed = parseBackupChainRow(chainRows[i]);
    if (parsed === null) {
      return malformed(
        `customChains[${i}] is not a valid row — expected {chainId, name, symbol, decimals, rpcUrl}.`,
      );
    }
    customChains.push(parsed);
  }

  const { browser } = raw;
  if (!isPlainObject(browser)) return malformed('browser must be an object.');
  const { watchlist, theme, ipfsGateway, customAbis } = browser;

  let parsedWatchlist: string[] | null = null;
  if (watchlist !== null) {
    if (!Array.isArray(watchlist)) return malformed('browser.watchlist must be an array or null.');
    const entries: unknown[] = watchlist;
    if (entries.length > WATCHLIST_MAX_ENTRIES) {
      return malformed(`browser.watchlist exceeds the ${WATCHLIST_MAX_ENTRIES}-entry cap.`);
    }
    const validated: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (typeof entry !== 'string' || !HEX_ADDRESS_RE.test(entry)) {
        return malformed(`browser.watchlist[${i}] is not a hex address.`);
      }
      validated.push(entry);
    }
    parsedWatchlist = validated;
  }

  if (theme !== null && theme !== 'light' && theme !== 'dark' && theme !== 'system') {
    return malformed('browser.theme must be "light", "dark", "system" or null.');
  }
  if (ipfsGateway !== null && (typeof ipfsGateway !== 'string' || ipfsGateway.length === 0)) {
    return malformed('browser.ipfsGateway must be a non-empty string or null.');
  }

  if (!Array.isArray(customAbis)) return malformed('browser.customAbis must be an array.');
  const abiRows: unknown[] = customAbis;
  const parsedAbis: BackupCustomAbi[] = [];
  const seenAbiKeys = new Set<string>();
  for (let i = 0; i < abiRows.length; i++) {
    const row = abiRows[i];
    if (
      !isPlainObject(row)
      || typeof row.key !== 'string'
      || typeof row.abi !== 'string'
      || row.abi.length === 0
    ) {
      return malformed(`browser.customAbis[${i}] must be an {key, abi} object.`);
    }
    if (!CUSTOM_ABI_KEY_RE.test(row.key)) {
      return malformed(
        `browser.customAbis[${i}].key must match custom-abi:<chainId>:<lowercase address> — arbitrary localStorage keys cannot be restored.`,
      );
    }
    if (seenAbiKeys.has(row.key)) {
      return malformed(`browser.customAbis[${i}].key is duplicated.`);
    }
    seenAbiKeys.add(row.key);
    parsedAbis.push({ key: row.key, abi: row.abi });
  }

  let notes: string[] | undefined;
  if (raw.notes !== undefined) {
    if (!Array.isArray(raw.notes) || raw.notes.some(n => typeof n !== 'string')) {
      return malformed('notes must be an array of strings.');
    }
    notes = raw.notes as string[];
  }

  return {
    ok: true,
    file: {
      version: BACKUP_VERSION,
      exportedAt,
      labels,
      customChains,
      browser: { watchlist: parsedWatchlist, theme, ipfsGateway, customAbis: parsedAbis },
      ...(notes !== undefined ? { notes } : {}),
    },
  };
}

/** One localStorage write the restore will perform. */
export type RestoreStorageWrite = {
  key: string;
  value: string;
  /** A different value is currently stored under the key (vs. the key being absent). */
  overwrites: boolean;
};

/** One label upsert the restore will PUT (address lowercased — storage-key convention). */
export type RestoreLabelPut = {
  chainId: number;
  address: string;
  label: string;
  note: string | null;
};

/** One custom-chain registration the restore will POST (the probe's chain id wins server-side). */
export type RestoreChainPost = {
  chainId: number;
  input: { rpcUrl: string; name?: string; symbol?: string; decimals?: number };
};

/** The exact set of writes a restore will perform — the confirmation dialog's content. */
export type RestorePlan = {
  storageWrites: RestoreStorageWrite[];
  labelPuts: RestoreLabelPut[];
  chainPosts: RestoreChainPost[];
};

/**
 * Merge planner: the backup plus a reader for the current localStorage
 * values produce the exact write plan. A browser already holding the
 * backup's value for a key gets NO write for it (the overwrites flag
 * then distinguishes "key absent" from "current value replaced").
 * Labels and chains are always planned in full — PUT/POST are the apps'
 * own idempotent upserts, and detecting "already equal" server-side
 * would cost one request per row for no behavioral difference.
 */
export function planRestore(
  file: BackupFile,
  readStored: (key: string) => string | null,
): RestorePlan {
  const storageWrites: RestoreStorageWrite[] = [];
  const planWrite = (key: string, value: string): void => {
    const current = readStored(key);
    if (current === value) return;
    storageWrites.push({ key, value, overwrites: current !== null });
  };

  const { watchlist, theme, ipfsGateway, customAbis } = file.browser;
  if (watchlist !== null) planWrite(WATCHLIST_STORAGE_KEY, JSON.stringify(watchlist));
  if (theme !== null) planWrite(THEME_STORAGE_KEY, theme);
  if (ipfsGateway !== null) planWrite(IPFS_GATEWAY_STORAGE_KEY, ipfsGateway);
  for (const { key, abi } of customAbis) planWrite(key, abi);

  return {
    storageWrites,
    labelPuts: file.labels.map(l => ({
      chainId: l.chainId,
      // Storage keys are lowercase (project convention) and the PUT
      // checksum-validates mixed-case input — normalize once here so the
      // restore address doubles as the storage key.
      address: l.address.toLowerCase(),
      label: l.label,
      note: l.note,
    })),
    chainPosts: file.customChains.map(c => ({
      chainId: c.chainId,
      input: { rpcUrl: c.rpcUrl, name: c.name, symbol: c.symbol, decimals: c.decimals },
    })),
  };
}
