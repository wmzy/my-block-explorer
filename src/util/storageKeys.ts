// The localStorage key manifest — ONE registry of every key/prefix family
// this explorer reads or writes in the browser. Key sprawl (independent
// per-feature constants across a dozen modules) forced the backup layer
// to hand-enumerate what it exports, so the next feature key silently
// fell out of backups. From now on:
//
//   * Owner modules import their key constant/prefix from here (and keep
//     re-exporting it for their existing consumers) — each literal lives
//     in exactly one place, byte-identical to what older builds wrote,
//     so no storage migration is ever needed.
//   * The backup layer (util/localBackup.ts + services/backupRestore.ts)
//     iterates THIS manifest instead of hand-enumerating: export collects
//     every family flagged includeInBackup, and the restore write plan is
//     pinned to the same constants/patterns.
//   * includeInBackup: false entries carry an excludeReason — secrets
//     (admin token) and machine-specific state (manual API base) never
//     leave the browser, and the remaining local-only convenience state
//     keeps exactly the pre-manifest export set.
//
// This module is pure data: no storage access, no readers or writers, so
// every module (owners and the backup layer alike) can import it without
// import cycles.

// --- The be: prefix family -------------------------------------------------

export const THEME_STORAGE_KEY = 'be:theme';

export const WATCHLIST_STORAGE_KEY = 'be:watchlist';

export const SEARCH_HISTORY_STORAGE_KEY = 'be:searchHistory';

export const VALUE_UNIT_STORAGE_KEY = 'be:valueUnit';

export const IPFS_GATEWAY_STORAGE_KEY = 'be:ipfsGateway';

export const LAST_CHAIN_STORAGE_KEY = 'be:lastChainId';

export const LAST_HEAD_STORAGE_PREFIX = 'be:lastHead:';

export const CHAIN_RESET_DISMISSED_PREFIX = 'be:chainResetDismissed:';

// Private notes: one key per (chainId, checksummed address). The prefix
// and the grammar regex are pinned together (tests assert the alignment)
// — util/privateNotes.ts builds and parses keys with them.
export const PRIVATE_NOTE_KEY_PREFIX = 'be:privateNote:';
export const PRIVATE_NOTE_KEY_RE = /^be:privateNote:\d+:0x[0-9a-fA-F]{40}$/;

// --- Long-form family (values written by older builds live under these) ----

export const ADMIN_TOKEN_STORAGE_KEY = 'my-block-explorer-admin-token';

export const MANUAL_BASE_STORAGE_KEY = 'my-block-explorer-api-url';

// --- Custom-ABI grammar (own unprefixed family) ----------------------------

// views/Contract writes `custom-abi:<chainId>:<lowercase address>`. The
// regex is the backup layer's safety rail — a backup file cannot smuggle
// writes to arbitrary localStorage keys (e.g. be:theme) through it.
export const CUSTOM_ABI_STORAGE_PREFIX = 'custom-abi:';
export const CUSTOM_ABI_KEY_RE = /^custom-abi:\d+:0x[0-9a-f]{40}$/;

// --- The manifest ----------------------------------------------------------

// How one family's keys are spelled: a single exact key, a `prefix + id`
// namespace, or a full grammar pattern.
export type StorageKeyShape =
  | { kind: 'exact'; key: string }
  | { kind: 'prefix'; prefix: string }
  | { kind: 'pattern'; pattern: RegExp };

export type StorageKeyManifestEntry = StorageKeyShape & {
  /** Stable family id — the backup format's section table and tests key off it. */
  id: string;
  /** The module that owns the readers/writers (human label, not an import contract). */
  owner: string;
} & (
  | { includeInBackup: true }
  // Every exclusion says why — an undocumented "not backed up" is exactly
  // the silent gap this manifest exists to prevent.
  | { includeInBackup: false; excludeReason: string }
);

export const STORAGE_KEY_MANIFEST: readonly StorageKeyManifestEntry[] = [
  // --- Backed up (exactly the pre-manifest export set) ---
  {
    id: 'watchlist',
    owner: 'src/util/watchlist.ts',
    kind: 'exact',
    key: WATCHLIST_STORAGE_KEY,
    includeInBackup: true,
  },
  {
    id: 'theme',
    owner: 'src/themePreference.ts',
    kind: 'exact',
    key: THEME_STORAGE_KEY,
    includeInBackup: true,
  },
  {
    id: 'ipfsGateway',
    owner: 'src/services/nftMetadata.ts',
    kind: 'exact',
    key: IPFS_GATEWAY_STORAGE_KEY,
    includeInBackup: true,
  },
  {
    id: 'customAbi',
    owner: 'src/views/Contract/index.tsx',
    kind: 'pattern',
    pattern: CUSTOM_ABI_KEY_RE,
    includeInBackup: true,
  },
  {
    id: 'privateNote',
    owner: 'src/util/privateNotes.ts',
    kind: 'pattern',
    pattern: PRIVATE_NOTE_KEY_RE,
    includeInBackup: true,
  },
  // --- Never exported ---
  {
    id: 'adminToken',
    owner: 'src/util/adminAuth.ts',
    kind: 'exact',
    key: ADMIN_TOKEN_STORAGE_KEY,
    includeInBackup: false,
    excludeReason: 'secret — must never leave the browser',
  },
  {
    id: 'apiBase',
    owner: 'src/util/apiBase.ts',
    kind: 'exact',
    key: MANUAL_BASE_STORAGE_KEY,
    includeInBackup: false,
    excludeReason: 'machine-specific backend address',
  },
  // --- Local-only state (unchanged from the pre-manifest export set) ---
  {
    id: 'searchHistory',
    owner: 'src/services/searchHistory.ts',
    kind: 'exact',
    key: SEARCH_HISTORY_STORAGE_KEY,
    includeInBackup: false,
    excludeReason: 'local-only convenience history — not user-authored data',
  },
  {
    id: 'valueUnit',
    owner: 'src/util/units.ts',
    kind: 'exact',
    key: VALUE_UNIT_STORAGE_KEY,
    includeInBackup: false,
    excludeReason: 'per-browser display preference outside the backup format',
  },
  {
    id: 'lastChainId',
    owner: 'src/views/Home/Landing.tsx',
    kind: 'exact',
    key: LAST_CHAIN_STORAGE_KEY,
    includeInBackup: false,
    excludeReason: 'per-browser navigation state, not data',
  },
  {
    id: 'lastHead',
    owner: 'src/services/chainReset.ts',
    kind: 'prefix',
    prefix: LAST_HEAD_STORAGE_PREFIX,
    includeInBackup: false,
    excludeReason: 'reset-detection baseline — derived cache state, meaningless on another machine',
  },
  {
    id: 'chainResetDismissed',
    owner: 'src/services/chainReset.ts',
    kind: 'prefix',
    prefix: CHAIN_RESET_DISMISSED_PREFIX,
    includeInBackup: false,
    excludeReason: 'per-browser banner dismissal state',
  },
  // --- Families whose owner modules were outside this manifest slice's
  // edit list: they still define their own constant. The literals are
  // pinned here (and by test) so migrating those owners is a pure import
  // swap with no value change.
  {
    id: 'onboardingDismissed',
    owner: 'src/views/Home/GettingStarted.tsx',
    kind: 'exact',
    key: 'be:onboardingDismissed',
    includeInBackup: false,
    excludeReason: 'per-browser onboarding flag',
  },
  {
    id: 'sqlConsoleHistory',
    owner: 'src/views/Sql/index.tsx',
    kind: 'exact',
    key: 'be:sqlConsole',
    includeInBackup: false,
    excludeReason: 'local-only query history — not user-authored data',
  },
  {
    id: 'viewedTokens',
    owner: 'src/services/tokenDirectory.ts',
    kind: 'prefix',
    prefix: 'be:viewedTokens:',
    includeInBackup: false,
    excludeReason: 'per-browser recency list, regenerated by browsing',
  },
];
