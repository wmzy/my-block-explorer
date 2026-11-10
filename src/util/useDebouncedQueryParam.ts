// Debounced URL-query-string input discipline — the shared shape behind
// the directory/signature filter boxes (Contracts/List, Tokens/List,
// Signatures). The input starts from the deep-linked ?q= and then LEADS
// the URL: every debounced change replaces the URL entry so typing does
// not spam history. An external URL change (deep link, back/forward)
// syncs the input back. The one discrimination that makes both
// directions coexist is a ref remembering the value this hook itself
// last pushed — a URL equal to it is our own write landing, not a
// navigation to follow.
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The setSearch shape this hook drives. The schema-aware setter from
 * `useSetSearch(schema)` satisfies it: functional updates receive the
 * live previous params and `{ replace: true }` rewrites the current
 * history entry.
 */
export type SetSearchLike<S> = (
  next: S | ((prev: S) => S),
  opts?: { replace?: boolean },
) => unknown;

export type UseDebouncedQueryParamOptions<S> = {
  /** Debounce window in ms before a typed change commits to the URL (default 300). */
  debounceMs?: number;
  /**
   * Search keys dropped alongside `key` on every commit (Contracts'
   * 'offset': a new filter always restarts at page 1). Read through a
   * ref — the array's identity is never a dependency, so an inline
   * literal must not re-arm the debounce timer.
   */
  extraKeysToStrip?: readonly (keyof S & string)[];
};

export type DebouncedQueryParamController = {
  /** The live input value; starts from the URL's current value. */
  value: string;
  /** Set the input value; the URL follows once typing settles. */
  setValue: (next: string) => void;
  /** Commit a value to the URL immediately (Enter key), bypassing the debounce. */
  commit: (next: string) => void;
};

/**
 * One debounced query-param filter input (the ?q= boxes).
 *
 * `key` is the search key the input mirrors; `paramValue` is that key's
 * CURRENT parsed URL value (`useSearch(schema)`); `setSearch` is the
 * matching `useSetSearch(schema)` setter. Commits strip `key` (and any
 * `extraKeysToStrip`) from the previous search, then set `key` only when
 * the committed value is non-empty — an empty filter removes the key
 * from the URL entirely.
 */
export function useDebouncedQueryParam<S extends object>(
  key: keyof S & string,
  paramValue: string | undefined,
  setSearch: SetSearchLike<S>,
  options: UseDebouncedQueryParamOptions<S> = {},
): DebouncedQueryParamController {
  const { debounceMs = 300 } = options;
  const [value, setValue] = useState(() => paramValue ?? '');
  // The URL value this hook itself last pushed — distinguishes the URL
  // write the debounce causes (input must keep leading) from an external
  // URL change (deep link, back/forward — input must follow).
  const lastPushedRef = useRef<string | null>(null);
  // Latest-ref read: extras change only what commit strips; a fresh
  // array literal per render must not re-arm the debounce timer.
  const extrasRef = useRef(options.extraKeysToStrip ?? []);
  extrasRef.current = options.extraKeysToStrip ?? [];

  const commit = useCallback(
    (next: string) => {
      if ((paramValue ?? '') === next) return;
      lastPushedRef.current = next;
      void setSearch(
        prev => {
          // Generic plumbing (same widened-cast idiom as the return
          // below): S is opaque inside the generic, so the key-wise
          // rebuild goes through the loose record once.
          const stripped = { ...prev } as unknown as Record<string, unknown>;
          delete stripped[key];
          for (const extra of extrasRef.current) delete stripped[extra];
          // Generic plumbing: the tuple is rebuilt key-wise exactly like
          // the per-view destructuring-rest it replaces (the widened
          // `as unknown as S` mirrors polledQuery's runtime-signature
          // casts — S is opaque inside the generic).
          return (next === '' ? stripped : { ...stripped, [key]: next }) as unknown as S;
        },
        { replace: true },
      );
    },
    [key, paramValue, setSearch],
  );

  // Debounced commit: the timer resets per keystroke (value change) or
  // when the commit closure itself goes stale (the URL value moved), so
  // only settled input is ever written.
  useEffect(() => {
    const timer = setTimeout(() => {
      commit(value.trim());
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [value, commit, debounceMs]);

  // External URL change (deep link, back/forward): sync the input unless
  // the URL carries exactly what this hook just pushed.
  useEffect(() => {
    const urlValue = paramValue ?? '';
    if (lastPushedRef.current === urlValue) return;
    setValue(urlValue);
  }, [paramValue]);

  return { value, setValue, commit };
}

/**
 * Plain trailing-edge debounce of any value (the ContractInteract name
 * filter and Broadcast raw-input preview twins): returns `value` until
 * it has stayed unchanged for `delayMs`, then the settled value. The
 * timer resets per change, so mid-edit churn never propagates.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}
