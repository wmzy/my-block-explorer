import { useEffect, useRef, useState } from 'react';
import { css } from '@linaria/core';
import type { Abi, AbiEvent, AbiFunction, AbiParameter } from 'viem';
import { cardStyles } from './styles';
import type { ContractABI } from './types';

// Parses a raw JSON ABI string into the ContractABI shape the view's tabs
// and panels consume (functions/events/errors split, plus the raw string
// kept for viem-based decoding). Returns null for unparseable input so
// callers can treat it as "no ABI".
export function parseAbiString(
  abiString: string,
  verificationStatus: string,
): ContractABI | null {
  try {
    const abi = JSON.parse(abiString) as Abi;
    const functions = abi.filter((item): item is AbiFunction => item.type === 'function');
    const events = abi.filter((item): item is AbiEvent => item.type === 'event');
    const errors = abi.filter(
      (item): item is { type: 'error'; name: string; inputs: AbiParameter[] } =>
        item.type === 'error',
    );
    return {
      abi: abiString,
      functions: functions.map(f => ({
        name: f.name,
        type: f.type,
        inputs: (f.inputs ?? []).map(input => ({
          name: input.name ?? '',
          type: input.type,
          internalType: input.internalType,
        })),
        outputs: (f.outputs ?? []).map(output => ({
          name: output.name ?? '',
          type: output.type,
          internalType: output.internalType,
        })),
        stateMutability: f.stateMutability ?? 'nonpayable',
        signature: `${f.name}(${(f.inputs ?? []).map(input => input.type).join(', ')})`,
      })),
      events: events.map(e => ({
        name: e.name,
        inputs: (e.inputs ?? []).map(input => ({
          name: input.name ?? '',
          type: input.type,
          internalType: input.internalType,
        })),
        signature: `${e.name}(${(e.inputs ?? []).map(input => input.type).join(', ')})`,
      })),
      errors,
      verificationStatus,
    };
  } catch {
    return null;
  }
}

type AbiValidation =
  | { ok: true; entries: number; ignored: number }
  | { ok: false; message: string };

const ABI_SHAPE_ERROR = 'ABI must be a JSON array of entries with a string "type" field';

// Entry types that pass structural validation but are not callable through
// the explorer: they are dropped when the ABI is parsed for the tabs.
const NON_CALLABLE_TYPES = new Set(['constructor', 'fallback', 'receive']);

// Structural guard for one pasted ABI entry: a non-null object carrying a
// string `type` field. `name` is intentionally not required — constructor,
// fallback and receive entries legitimately omit it.
function isAbiEntry(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).type === 'string'
  );
}

// Validates a pasted ABI before it is applied: it must JSON-parse, be an
// array, and every entry must be shaped like an ABI member. The ok result
// also reports how many entries are non-callable (constructor/fallback/
// receive) so the feedback can disclose what will be silently dropped.
export function validateAbiJson(raw: string): AbiValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      message: `Not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(parsed) || !parsed.every(isAbiEntry)) {
    return { ok: false, message: ABI_SHAPE_ERROR };
  }
  return {
    ok: true,
    entries: parsed.length,
    ignored: parsed.filter(
      entry => typeof entry.type === 'string' && NON_CALLABLE_TYPES.has(entry.type),
    ).length,
  };
}

const panelStyles = css`
  &.active {
    border-color: #f0a500;
    box-shadow: 0 0 0 1px rgba(240, 165, 0, 0.3);
  }
`;

const panelNoteStyles = css`
  font-size: 13px;
  color: #8a6d3b;
  margin: 0 0 12px 0;
`;

const textareaStyles = css`
  box-sizing: border-box;
  width: 100%;
  min-height: 120px;
  padding: 10px;
  font-family:
    'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  font-size: 13px;
  border: 1px solid #e1e5e9;
  border-radius: 6px;
  resize: vertical;

  &:focus {
    outline: none;
    border-color: #f0a500;
    box-shadow: 0 0 0 2px rgba(240, 165, 0, 0.15);
  }
`;

const actionsStyles = css`
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
`;

const actionButtonStyles = css`
  padding: 6px 14px;
  font-size: 13px;
  border: 1px solid #dee2e6;
  border-radius: 4px;
  background: #f8f9fa;
  color: #495057;
  cursor: pointer;

  &:hover {
    background: #e9ecef;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.primary {
    background: #f0a500;
    border-color: #d69200;
    color: white;
    font-weight: 500;

    &:hover {
      background: #d69200;
    }
  }
`;

const feedbackStyles = css`
  margin-top: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 13px;

  &.error {
    background: #f8d7da;
    color: #721c24;
  }

  &.ok {
    background: #fff8e6;
    color: #8a6d3b;
  }
`;

const activeChipStyles = css`
  display: inline-block;
  padding: 2px 10px;
  border-radius: 10px;
  background: #f0a500;
  color: white;
  font-size: 12px;
  font-weight: 600;
`;

// Clipboard copy with a fallback for contexts without the async clipboard
// API (non-secure origins, embedded webviews): a hidden selected textarea
// plus the legacy execCommand('copy'). Returns whether the copy verifiably
// happened so the button can report failure honestly.
async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied or the promise rejected: fall through to the
      // legacy path before giving up.
    }
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  let copied: boolean;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  helper.remove();
  return copied;
}

// Paste-ABI unlock for contracts without a server-side ABI: the textarea
// holds a draft, Validate checks it, Apply persists it through onApply and
// Clear discards it through onClear. The parent owns persistence; this
// panel only edits the raw string. focusSignal lets the locked ABI/Interact
// tab panels jump the user here: each increment focuses the textarea and
// scrolls it into view. unlockReason selects the explanatory note's tier:
// 'impl-unverified' (a proxy whose implementation is unverified while the
// proxy itself still has a server ABI) must not claim the whole contract
// has no ABI anywhere.
export function CustomAbiPanel({
  storedRaw,
  onApply,
  onClear,
  focusSignal = 0,
  unlockReason = 'no-server-abi',
}: {
  storedRaw: string;
  onApply: (raw: string) => void;
  onClear: () => void;
  focusSignal?: number;
  unlockReason?: 'no-server-abi' | 'impl-unverified';
}) {
  const [draft, setDraft] = useState(storedRaw);
  const [validation, setValidation] = useState<AbiValidation | null>(null);
  // Transient Copy ABI outcome: the label swaps to Copied!/Copy failed and
  // back after the reset timeout (cleared on unmount).
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    },
    [],
  );

  const trimmed = draft.trim();
  const active = storedRaw.trim() !== '';

  // Imperative focus driven by the parent's signal counter (increments
  // only — the initial 0 never triggers).
  useEffect(() => {
    if (focusSignal > 0) {
      textareaRef.current?.focus();
      textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [focusSignal]);

  // Resync the editor when the stored raw changes from the outside (the
  // tab-bar Clear action, or a chain/address switch re-reading
  // sessionStorage). The validation message survives when the change is
  // this panel's own Apply (stored raw equals the current draft).
  useEffect(() => {
    setDraft(storedRaw);
    if (storedRaw !== draft.trim()) setValidation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only external stored-raw changes resync the editor
  }, [storedRaw]);

  const handleApply = () => {
    const result = validateAbiJson(trimmed);
    setValidation(result);
    if (result.ok) onApply(trimmed);
  };

  const handleClear = () => {
    onClear();
    setDraft('');
    setValidation(null);
  };

  // Copies what the panel currently holds: the applied raw when one is
  // stored, otherwise the pasted draft.
  const copySource = active ? storedRaw : trimmed;

  const handleCopy = async () => {
    const copied = await copyText(copySource);
    setCopyState(copied ? 'copied' : 'failed');
    if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopyState('idle'), 2000);
  };

  return (
    <div className={`${cardStyles} ${panelStyles}${active ? ' active' : ''}`}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}
      >
        <h2 style={{ margin: 0 }}>Use custom ABI</h2>
        {active && <span className={activeChipStyles}>Active</span>}
      </div>
      {unlockReason === 'impl-unverified' ? (
        <p className={panelNoteStyles}>
          The implementation contract is not verified, so its ABI is not available from verification
          services. Paste the implementation's ABI here to unlock the ABI, Events and Interact
          views, or switch to the Proxy view to use the proxy's own ABI. Pasting an ABI does not
          verify the contract and is not shared with other users.
        </p>
      ) : (
        <p className={panelNoteStyles}>
          No ABI is available for this contract from verification services. Paste a contract ABI
          (a JSON array) to unlock the ABI, Events and Interact views. It is saved in this
          browser for this chain and address and persists across sessions. Pasting an ABI does
          not verify the contract and is not shared with other users.
        </p>
      )}
      <textarea
        ref={textareaRef}
        className={textareaStyles}
        aria-label="Custom ABI JSON"
        placeholder='[{"type":"function","name":"transfer","inputs":[],"outputs":[]}]'
        spellCheck={false}
        value={draft}
        onChange={e => setDraft(e.target.value)}
      />
      <div className={actionsStyles}>
        <button
          type="button"
          className={actionButtonStyles}
          onClick={() => setValidation(validateAbiJson(trimmed))}
          disabled={!trimmed}
        >
          Validate
        </button>
        <button
          type="button"
          className={`${actionButtonStyles} primary`}
          onClick={handleApply}
          disabled={!trimmed}
        >
          Apply
        </button>
        <button
          type="button"
          className={actionButtonStyles}
          onClick={handleClear}
          disabled={!storedRaw && !trimmed}
        >
          Clear
        </button>
        <button
          type="button"
          className={actionButtonStyles}
          onClick={handleCopy}
          disabled={!copySource}
        >
          {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy ABI'}
        </button>
      </div>
      {validation && !validation.ok && (
        <div role="alert" className={`${feedbackStyles} error`}>
          {validation.message}
        </div>
      )}
      {validation?.ok && (
        <div className={`${feedbackStyles} ok`}>
          Valid ABI: {validation.entries} {validation.entries === 1 ? 'entry' : 'entries'}
          {validation.ignored > 0 &&
            ` (${validation.ignored} constructor/fallback/receive ${
              validation.ignored === 1 ? 'entry' : 'entries'
            } ignored)`}
        </div>
      )}
    </div>
  );
}
