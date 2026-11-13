// The one copy-feedback state machine behind every label-swap copy button
// (EventTable, StorageMemberRow, RawJson, Signatures, CustomAbiPanel,
// AbiListPanel, FunctionCallForm, GettingStarted): the shared copyText
// (async Clipboard API with the legacy execCommand fallback) settles an
// honest 'ok'/'fail' that resets to idle after resetMs. Same timer
// discipline the hand-rolled copies all shared — cleared on unmount, and
// an in-flight reset is cancelled when a new outcome settles, so a rapid
// double-copy shows the latest result for a full window.
import { useCallback, useEffect, useRef, useState } from 'react';

import { copyText } from '@/util/clipboard';

export type CopyFeedbackState = 'idle' | 'ok' | 'fail';

export type UseCopyFeedbackOptions = {
  // How long an ok/fail outcome stays on screen before resetting to idle.
  resetMs?: number;
};

export type CopyFeedback = {
  // Outcome of the most recent copy — 'idle' before the first copy and
  // after the reset. Multi-button surfaces read stateFor instead.
  state: CopyFeedbackState;
  // Copy through the shared copyText and record the honest outcome. The
  // optional key scopes the outcome to one button among several sharing
  // one hook instance; each new copy replaces the previous outcome
  // outright, so exactly one button shows feedback at a time.
  copy: (text: string, key?: string) => Promise<void>;
  // Return to idle immediately, cancelling any pending reset (and any
  // copy still in flight).
  reset: () => void;
  // The latest outcome when that copy carried this key, else 'idle'.
  stateFor: (key: string) => CopyFeedbackState;
};

const DEFAULT_RESET_MS = 2000;

// The settled latest copy: which button it belongs to (null for
// single-target usage) and whether the clipboard write succeeded. null is
// the idle state.
type Settled = { key: string | null; ok: boolean } | null;

export function useCopyFeedback({
  resetMs = DEFAULT_RESET_MS,
}: UseCopyFeedbackOptions = {}): CopyFeedback {
  const [settled, setSettled] = useState<Settled>(null);
  const timerRef = useRef<number | undefined>(undefined);
  // Copies can settle out of order (the first click's promise resolving
  // after the second's); only the latest-invoked copy may settle, so a
  // rapid double-copy always shows the latest result for a full window.
  const seqRef = useRef(0);

  const apply = useCallback(
    (next: Settled) => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
      setSettled(next);
      if (next !== null) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = undefined;
          setSettled(null);
        }, resetMs);
      }
    },
    [resetMs],
  );

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(
    async (text: string, key?: string) => {
      const seq = ++seqRef.current;
      const ok = await copyText(text);
      if (seq !== seqRef.current) return;
      apply({ key: key ?? null, ok });
    },
    [apply],
  );

  const reset = useCallback(() => {
    seqRef.current += 1;
    apply(null);
  }, [apply]);

  const state: CopyFeedbackState = settled === null ? 'idle' : settled.ok ? 'ok' : 'fail';
  const stateFor = useCallback(
    (key: string): CopyFeedbackState =>
      settled !== null && settled.key === key ? (settled.ok ? 'ok' : 'fail') : 'idle',
    [settled],
  );

  return { state, copy, reset, stateFor };
}

// The label a copy button shows for the machine's current state:
// 'Copied ✓' after a good write, 'Copy failed' after a bad one, else the
// caller's idle label (GettingStarted's 'Copy', the NFT tile's id text).
// Pure — no hooks inside — but named (and housed) beside the state
// machine it verbalizes so every label-swap site reads identically.
export function useCopyLabel(state: CopyFeedbackState, idleLabel: string): string {
  if (state === 'ok') return 'Copied ✓';
  if (state === 'fail') return 'Copy failed';
  return idleLabel;
}
