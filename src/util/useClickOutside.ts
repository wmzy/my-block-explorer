// The one dismiss-on-outside-press hook behind the dropdown islands
// (TopNavigation's chain selector and search history, OpenInIdeButton's
// IDE picker): a document 'mousedown' listener that fires onClose unless
// the press landed inside the container the ref points at. The listener
// is attached only while `enabled` (while the dropdown is open at every
// call site); the always-attached hand-rolled effects this replaces
// guarded with `isOpen &&` inside the handler and were no-ops when
// closed, which is the same contract for free. Escape is deliberately
// NOT handled here: no migrated site closed on a document-level Escape
// (only their focused inputs' own keydown handlers do), so each site
// keeps its keyboard dismissal next to its input.
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

export type UseClickOutsideOptions = {
  // While false no listener is attached, so presses anywhere are ignored
  // and a closed surface costs nothing.
  enabled?: boolean;
};

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  { enabled = true }: UseClickOutsideOptions = {},
): void {
  // Callers pass inline arrows (a fresh identity every render); holding
  // the latest callback in a ref keeps the document subscription keyed
  // on the open/close flip alone instead of churning on every render.
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!enabled) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onCloseRef.current();
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [ref, enabled]);
}
