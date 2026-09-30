// Backup/restore orchestration — the impure layer on top of the pure
// format module (util/localBackup.ts). Export gathers the parts (backend
// reads + localStorage scan) and downloads explorer-backup.json;
// restore executes a RestorePlan with per-item honest reporting.
//
// Honesty contract (BackendOfflineState spirit): collectBackupParts
// never throws for expected failures — an unreachable backend, an admin
// gate, or a redacted RPC URL degrades the export to the parts that ARE
// available, with one notes line attributing every skip. The file says
// exactly what it contains and why something is missing; the UI surfaces
// the same notes in the export toast. executeRestore likewise reports
// per-item outcomes instead of aborting on the first failure.
import { get, isBackendUnreachable } from '@/util/http';
import { ApiError } from '@/util/apiError';
import { readWatchlist } from '@/util/watchlist';
import { readThemePreference } from '@/themePreference';
import { getIpfsGateway } from '@/services/nftMetadata';
import { saveAddressLabel } from '@/services/labels';
import { addCustomChain } from '@/services/customChains';
import { parsePrivateNoteKey, parseStoredPrivateNote } from '@/util/privateNotes';
import {
  BACKUP_SECTION_ENTRY_IDS,
  parseBackupChainRow,
  parseBackupLabelRow,
  serializeBackup,
  type BackupBrowserParts,
  type BackupCustomChainRow,
  type BackupLabelRow,
  type BackupParts,
  type RestorePlan,
} from '@/util/localBackup';
import { STORAGE_KEY_MANIFEST, type StorageKeyManifestEntry } from '@/util/storageKeys';

export const BACKUP_FILENAME = 'explorer-backup.json';

// The custom-chain register route allows 5/min with burst 2 (each POST
// probes the RPC server-side). A restore POSTs one chain at a time, so a
// 429 mid-restore waits one refill period and retries that chain once
// before its failure is reported.
const CHAIN_POST_RETRY_MS = 12_000;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'unknown error';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Read one localStorage key; storage-unavailable browsers read as absent. */
const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/**
 * Gather every exportable part. Expected failures land in notes (honest
 * attribution), never in a throw: a backend-less browser still exports
 * its local preferences with "server data skipped — backend unreachable".
 */
export async function collectBackupParts(): Promise<BackupParts> {
  const notes: string[] = [];
  const note = (line: string): void => {
    if (!notes.includes(line)) notes.push(line);
  };

  let labels: BackupLabelRow[] = [];
  try {
    const body = await get<unknown>('/api/labels');
    const rows =
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as Record<string, unknown>).labels)
        ? ((body as Record<string, unknown>).labels as unknown[])
        : null;
    if (rows === null) {
      note('labels skipped — the backend returned a malformed body');
    } else {
      const parsedRows = rows.map(row => parseBackupLabelRow(row));
      if (parsedRows.some(row => row === null)) {
        note('some label rows skipped — malformed backend response');
      }
      labels = parsedRows.filter((row): row is BackupLabelRow => row !== null);
    }
  } catch (error) {
    if (isBackendUnreachable(error)) {
      note('server data skipped — backend unreachable');
    } else if (error instanceof ApiError && error.status === 403) {
      note(
        'labels skipped — admin token required (save it under "Admin token", then retry the export)',
      );
    } else {
      note(`labels skipped — ${messageOf(error)}`);
    }
  }

  const customChains: BackupCustomChainRow[] = [];
  try {
    const body = await get<unknown>('/api/chains/custom');
    const rows =
      typeof body === 'object' &&
      body !== null &&
      Array.isArray((body as Record<string, unknown>).chains)
        ? ((body as Record<string, unknown>).chains as unknown[])
        : null;
    if (rows === null) {
      note('custom chains skipped — the backend returned a malformed body');
    } else {
      // A redacted rpcUrl is not restorable — registering it back would
      // point the explorer at scheme+host with the secret stripped. Skip
      // those rows and say so instead of exporting a broken URL.
      let redacted = 0;
      let malformed = 0;
      for (const row of rows) {
        const parsed = parseBackupChainRow(row);
        if (parsed === null) {
          malformed += 1;
          continue;
        }
        const urlRedacted =
          typeof row === 'object' &&
          row !== null &&
          (row as Record<string, unknown>).urlRedacted === true;
        if (urlRedacted) {
          redacted += 1;
          continue;
        }
        customChains.push(parsed);
      }
      if (redacted > 0) {
        note(
          `${redacted} custom chain(s) skipped — RPC URL redacted for this browser (open the explorer via localhost or a trusted origin to include them)`,
        );
      }
      if (malformed > 0) {
        note(`${malformed} custom chain row(s) skipped — malformed backend response`);
      }
    }
  } catch (error) {
    if (isBackendUnreachable(error)) {
      note('server data skipped — backend unreachable');
    } else {
      note(`custom chains skipped — ${messageOf(error)}`);
    }
  }

  // The shared notes array: a corrupted-note skip line lands here before
  // the spread below runs, so it reaches the file with the other skips.
  const browser = collectBrowserParts(notes);
  return { labels, customChains, browser, ...(notes.length > 0 ? { notes } : {}) };
}

/** What one manifest family collected from this browser (see scanStorageByManifest). */
type ScannedFamily = { exact: string | null } | { scanned: string[] };

/**
 * Bucket localStorage by manifest family — one snapshot scan for
 * everything. Only entries flagged includeInBackup are touched: the
 * manifest (util/storageKeys.ts), not this module, decides what a backup
 * may read. Exact families read their single key (null = absent);
 * prefix/pattern families list every storage key they own. A full or
 * private-mode localStorage reads as absent/empty throughout.
 */
function scanStorageByManifest(
  manifest: readonly StorageKeyManifestEntry[],
): Map<string, ScannedFamily> {
  const families = new Map<string, ScannedFamily>();
  let snapshot: string[] | null = null;
  const snapshotKeys = (): string[] => {
    if (snapshot !== null) return snapshot;
    snapshot = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key !== null) snapshot.push(key);
      }
    } catch {
      // Storage unavailable (private mode) — nothing to scan.
    }
    return snapshot;
  };
  for (const entry of manifest) {
    if (!entry.includeInBackup) continue;
    if (entry.kind === 'exact') {
      families.set(entry.id, { exact: readStored(entry.key) });
    } else if (entry.kind === 'prefix') {
      families.set(entry.id, {
        scanned: snapshotKeys().filter(key => key.startsWith(entry.prefix)),
      });
    } else {
      families.set(entry.id, {
        scanned: snapshotKeys().filter(key => entry.pattern.test(key)),
      });
    }
  }
  return families;
}

const exactValue = (families: Map<string, ScannedFamily>, id: string): string | null => {
  const family = families.get(id);
  return family !== undefined && 'exact' in family ? family.exact : null;
};

const scannedKeys = (families: Map<string, ScannedFamily>, id: string): string[] => {
  const family = families.get(id);
  return family !== undefined && 'scanned' in family ? family.scanned : [];
};

/**
 * Browser-local preferences, collected by iterating the manifest (the
 * default; tests inject a hypothetical manifest through the second
 * parameter). `null` (= not exported) is keyed off the raw stored key,
 * while the VALUE comes from the app's own validated readers — a
 * hand-corrupted localStorage entry exports as what the app would
 * actually use, never the corruption itself. Private notes are a key scan
 * like custom ABIs (they accrue per visited address); entries whose
 * stored value the app's reader would reject are skipped with a note line
 * instead of exported broken.
 */
export function collectBrowserParts(
  notes: string[],
  manifest: readonly StorageKeyManifestEntry[] = STORAGE_KEY_MANIFEST,
): BackupBrowserParts {
  const families = scanStorageByManifest(manifest);

  // Pattern families shape their raw entries through the app's own
  // parsers, exactly as before the manifest reorganization.
  const customAbis: BackupBrowserParts['customAbis'] = [];
  for (const key of scannedKeys(families, 'customAbi')) {
    const abi = readStored(key);
    if (abi !== null) customAbis.push({ key, abi });
  }
  const privateNotes: BackupBrowserParts['privateNotes'] = [];
  let corruptedNotes = 0;
  for (const key of scannedKeys(families, 'privateNote')) {
    const parsedKey = parsePrivateNoteKey(key);
    const note = parsedKey === null ? null : parseStoredPrivateNote(readStored(key));
    if (parsedKey === null || note === null) {
      corruptedNotes += 1;
      continue;
    }
    privateNotes.push({ chainId: parsedKey.chainId, address: parsedKey.address, note });
  }
  if (corruptedNotes > 0) {
    notes.push(
      `${corruptedNotes} private note(s) skipped — the stored entry is corrupted (unreadable key or over-length value)`,
    );
  }

  // Honest-drop guard: a family flagged includeInBackup that the file
  // format has no section for must not vanish silently. The note lands
  // in the export (and its toast) so a future key registered for backup
  // without its format section is attributed, not lost — the exact
  // failure mode the manifest exists to prevent.
  for (const entry of manifest) {
    if (!entry.includeInBackup || BACKUP_SECTION_ENTRY_IDS.includes(entry.id)) continue;
    const family = families.get(entry.id);
    const collected =
      family === undefined
        ? 0
        : 'exact' in family
          ? family.exact !== null
            ? 1
            : 0
          : family.scanned.length;
    if (collected === 0) continue;
    notes.push(
      `${entry.id} skipped — ${collected} stored value(s) not exported: flagged includeInBackup but the backup format has no section for this key family yet (add one in util/localBackup.ts)`,
    );
  }

  return {
    watchlist: exactValue(families, 'watchlist') === null ? null : readWatchlist(),
    theme: exactValue(families, 'theme') === null ? null : readThemePreference(),
    ipfsGateway: exactValue(families, 'ipfsGateway') === null ? null : getIpfsGateway(),
    customAbis,
    privateNotes,
  };
}

/** Assemble and download explorer-backup.json (in-page anchor click). */
export function exportBackupFile(parts: BackupParts): void {
  const file = serializeBackup(parts);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = BACKUP_FILENAME;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** What executeRestore did, per section — the restore summary's content. */
export type RestoreReport = {
  storage: {
    written: number;
    failures: Array<{ key: string; message: string }>;
  };
  labels: {
    attempted: number;
    restored: number;
    adminDenied: boolean;
    failures: Array<{ address: string; message: string }>;
  };
  chains: {
    attempted: number;
    registered: number;
    adminDenied: boolean;
    failures: Array<{ name: string; message: string }>;
  };
};

/**
 * Execute a restore plan. Each section proceeds independently and
 * reports per-item outcomes: a localStorage write that throws (quota /
 * private mode), a label PUT that 400s, or a chain POST whose RPC probe
 * fails never blocks the remaining writes. A 403 collapses to one
 * honest admin-token line per section (the token gate rejects
 * everything equally — continuing would only stack identical 403s).
 */
export async function executeRestore(plan: RestorePlan): Promise<RestoreReport> {
  const report: RestoreReport = {
    storage: { written: 0, failures: [] },
    labels: { attempted: plan.labelPuts.length, restored: 0, adminDenied: false, failures: [] },
    chains: { attempted: plan.chainPosts.length, registered: 0, adminDenied: false, failures: [] },
  };

  for (const write of plan.storageWrites) {
    try {
      localStorage.setItem(write.key, write.value);
      report.storage.written += 1;
    } catch (error) {
      report.storage.failures.push({ key: write.key, message: messageOf(error) });
    }
  }

  for (const item of plan.labelPuts) {
    try {
      await saveAddressLabel(item.chainId, item.address, item.label, item.note);
      report.labels.restored += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        report.labels.adminDenied = true;
      } else {
        report.labels.failures.push({
          address: `${item.address} (chain ${item.chainId})`,
          message: messageOf(error),
        });
      }
    }
  }

  for (const item of plan.chainPosts) {
    const name = item.input.name ?? `chain ${item.chainId}`;
    try {
      await addCustomChain(item.input);
      report.chains.registered += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 429) {
        // Wait one refill period and retry once — the register limiter
        // (5/min, burst 2) cannot admit a many-chain restore in a burst.
        await sleep(CHAIN_POST_RETRY_MS);
        try {
          await addCustomChain(item.input);
          report.chains.registered += 1;
          continue;
        } catch {
          // Fall through and report the original failure.
        }
      }
      if (error instanceof ApiError && error.status === 403) {
        report.chains.adminDenied = true;
      } else {
        report.chains.failures.push({ name, message: messageOf(error) });
      }
    }
  }

  return report;
}
