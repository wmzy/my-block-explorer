// The one honest-clipboard label-swap copy button, unified from the former
// hand-rolled copies (EventTable, StorageMemberRow, RawJson, Signatures,
// SourceCodeViewer): the button itself reports the real outcome of the
// clipboard call — 'Copied ✓' on success, 'Copy failed' on failure, the
// label (or children) while idle — never a guess. Copying runs through the
// shared useCopyFeedback → copyText path (async Clipboard API with the
// legacy fallback); the outcome resets to idle after the hook's window.
// Visual chrome is the caller's: compose copyButtonBase with per-site
// deltas (font-size, flex-shrink, mono face …) via cx and pass the result
// as className — a bare CopyButton without one renders unstyled.
import type { ReactNode } from 'react';
import { css } from '@linaria/core';

import { useCopyFeedback } from '@/util/useCopyFeedback';

// Shared chrome for the bordered small-button family (the former
// RawDataBlock / RawJson / EventTable near-triplet styles): per-site
// deltas compose on top via cx at the call site.
export const copyButtonBase = css`
  border: 1px solid var(--haze-color-border);
  border-radius: var(--haze-radius-sm);
  background: var(--haze-color-bg);
  padding: var(--haze-space-1) var(--haze-space-3);
  cursor: pointer;

  &:hover {
    background: var(--haze-color-bg-muted);
  }
`;

type CopyButtonProps = {
  /** The verbatim text handed to the clipboard. */
  text: string;
  /** Idle label; 'Copied ✓' / 'Copy failed' replace it after a copy. */
  label?: string;
  title?: string;
  className?: string;
  /** Idle content when the plain label is not enough (wins over label). */
  children?: ReactNode;
};

export function CopyButton({ text, label = 'Copy', title, className, children }: CopyButtonProps) {
  const { state, copy } = useCopyFeedback();

  return (
    <button type="button" className={className} title={title} onClick={() => void copy(text)}>
      {state === 'ok' ? 'Copied ✓' : state === 'fail' ? 'Copy failed' : (children ?? label)}
    </button>
  );
}
