// Theme preference (Light / Dark / System), stored per browser under
// 'be:theme' (same prefix family as be:searchHistory / be:lastChainId).
// This module is the single reader/writer of the key and owns the mapping
// from a preference to the `data-theme` attribute the palette overrides in
// theme.css select on. Storage is best-effort, matching searchHistory: a
// full/private-mode localStorage degrades reads to 'system' and swallows
// writes — theming must never break rendering.

export const THEME_STORAGE_KEY = 'be:theme';

export type ThemePreference = 'light' | 'dark' | 'system';

// Cycle order of the topbar theme control: Light → Dark → System.
const CYCLE_ORDER: readonly ThemePreference[] = ['light', 'dark', 'system'];

/** The mode the cycle control moves to from `mode`. */
export function nextThemePreference(mode: ThemePreference): ThemePreference {
  return CYCLE_ORDER[(CYCLE_ORDER.indexOf(mode) + 1) % CYCLE_ORDER.length];
}

/**
 * Pure mapping from a preference to the `data-theme` attribute value the
 * palette overrides in theme.css key off: 'dark'/'light' pin the palette
 * over the OS preference, 'system' removes the attribute so the
 * prefers-color-scheme media query alone decides. Returns null for the
 * removal case — that is the whole contract the pre-mount init in
 * src/index.tsx and the topbar control share.
 */
export function applyThemePreference(mode: ThemePreference): 'light' | 'dark' | null {
  return mode === 'system' ? null : mode;
}

/**
 * Stored preference; anything absent or unusable reads as 'system' (the
 * no-choice default that follows the OS).
 */
export function readThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return raw === 'light' || raw === 'dark' ? raw : 'system';
  } catch {
    return 'system';
  }
}

/** Persist a choice (best-effort — see module header). */
export function storeThemePreference(mode: ThemePreference): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Quota/private mode — the choice lasts only for this session.
  }
}

/**
 * Apply a preference to the document root: pin `data-theme` for an
 * explicit choice, remove it for System. Lives here so the pre-mount init
 * and the topbar control cannot drift apart on the attribute spelling.
 */
export function setDocumentThemeAttribute(mode: ThemePreference): void {
  const value = applyThemePreference(mode);
  if (value === null) {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.dataset.theme = value;
  }
}
