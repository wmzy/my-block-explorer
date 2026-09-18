// Client-side search history, stored per browser in localStorage. The old
// server-side history shared every visitor's queries with everyone (a
// privacy leak), so history is now local-only: this module is the single
// reader/writer of the storage key and every surface that executes a search
// records through it.
export const SEARCH_HISTORY_STORAGE_KEY = 'be:searchHistory';

// Keep the dropdown short and the storage payload tiny.
export const SEARCH_HISTORY_MAX_ENTRIES = 10;

export type SearchHistoryEntry = { query: string; chainId: number };

const isEntry = (value: unknown): value is SearchHistoryEntry =>
  typeof value === 'object'
  && value !== null
  && typeof (value as { query?: unknown }).query === 'string'
  && typeof (value as { chainId?: unknown }).chainId === 'number'
  && Number.isInteger((value as { chainId: number }).chainId);

// Storage is best-effort: a corrupt payload or a full/private-mode
// localStorage must never break searching — reads degrade to [] and writes
// are swallowed (the returned list still reflects the attempted change).
const persist = (entries: SearchHistoryEntry[]): SearchHistoryEntry[] => {
  try {
    localStorage.setItem(SEARCH_HISTORY_STORAGE_KEY, JSON.stringify(entries));
  }
  catch {
    // Quota/private mode — history silently stops persisting.
  }
  return entries;
};

/** Newest-first history entries, never more than the cap. */
export function readSearchHistory(): SearchHistoryEntry[] {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isEntry)
      .slice(0, SEARCH_HISTORY_MAX_ENTRIES);
  }
  catch {
    return [];
  }
}

/**
 * Record an executed search. Deduplicates by query+chainId and moves the
 * entry to the front (newest-first), capping the list.
 */
export function recordSearchHistoryEntry(
  query: string,
  chainId: number,
): SearchHistoryEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return readSearchHistory();

  const rest = readSearchHistory().filter(
    entry => !(entry.query === trimmed && entry.chainId === chainId),
  );
  return persist([{ query: trimmed, chainId }, ...rest].slice(0, SEARCH_HISTORY_MAX_ENTRIES));
}

/** Remove a single entry (per-item removal in the history dropdown). */
export function removeSearchHistoryEntry(
  query: string,
  chainId: number,
): SearchHistoryEntry[] {
  return persist(
    readSearchHistory().filter(
      entry => !(entry.query === query && entry.chainId === chainId),
    ),
  );
}

/** Clear the whole history (the dropdown's Clear button). */
export function clearSearchHistory(): SearchHistoryEntry[] {
  return persist([]);
}
