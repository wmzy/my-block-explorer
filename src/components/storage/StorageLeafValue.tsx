// Inline decoded value for one storage word. Reads flow through the
// shared StorageValuesProvider store — useSlotValue auto-requests and a
// resolved null is a VALID empty word (rendered as 0x000…0), never an
// error. Decode failures degrade to the raw word hex: a display decoder
// must never crash the explorer.
import { css } from '@linaria/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { concat, decodeAbiParameters, getAddress, hexToString, pad, slice, type Hex } from 'viem';
import type { StorageType } from '@/types/storage';
import { useSlotValue } from '@/services/storageValues';
import {
  abiTypeForLabel,
  decodeBytesWord,
  slotAdd,
  type BytesWordLayout,
} from '@/utils/storageSlots';

// Display truncation before the Show-all toggle kicks in.
const DISPLAY_CHAR_LIMIT = 512;
// Long bytes/string values probe their data slots through the store; the
// window is bounded so a pathological on-chain length cannot mount
// thousands of probes. The value line says so when truncating.
const LONG_WINDOW_BYTES = 2048;

const ZERO_WORD: Hex = `0x${'0'.repeat(64)}`;

const valueStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  word-break: break-all;
  min-width: 0;
`;

const mutedStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text-secondary);
`;

const errorStyle = css`
  font-family: var(--haze-font-mono);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-danger);
`;

const linkButtonStyle = css`
  padding: 0 var(--haze-space-1);
  margin-left: var(--haze-space-1);
  font-size: var(--haze-text-xs);
  color: var(--haze-color-primary);
  background: transparent;
  border: none;
  cursor: pointer;

  &:hover {
    text-decoration: underline;
  }
`;

export type StorageLeafValueProps = {
  slot: Hex;
  offset: number;
  type: StorageType | null;
};

export function StorageLeafValue({ slot, offset, type }: StorageLeafValueProps) {
  const state = useSlotValue(slot);

  if (state.status === 'idle') return <span className={mutedStyle}>-</span>;
  if (state.status === 'loading') return <span className={mutedStyle}>…</span>;
  if (state.status === 'error') {
    return (
      <span className={errorStyle} title={state.error ?? undefined}>
        error
      </span>
    );
  }
  // A null word is a valid empty read, not an error.
  if (state.value === null) {
    return (
      <span className={mutedStyle} title="empty storage word">
        0x000…0
      </span>
    );
  }
  if (type === null) {
    // No type information (evmole-style layout): the raw word is the value.
    return <span className={valueStyle}>{state.value}</span>;
  }
  if (type.encoding === 'bytes') {
    return <BytesValue word={state.value} slot={slot} label={type.label} />;
  }
  return <PrimitiveValue word={state.value} offset={offset} label={type.label} />;
}

function PrimitiveValue({ word, offset, label }: { word: Hex; offset: number; label: string }) {
  let display: string;
  try {
    display = formatDecoded(decodeWordValue(word, offset, label), label);
  } catch {
    // Any decode surprise (odd label, short word) falls back to the raw
    // word — the honest bytes that are actually on chain.
    display = word;
  }
  return <span className={valueStyle}>{display}</span>;
}

// Slice the value's bytes out of the (right-offset) slot word and decode
// them through the ABI decoder. Throws on unsupported shapes — the caller
// renders the raw word instead.
function decodeWordValue(word: Hex, offset: number, label: string): unknown {
  const bytes = labelToBytes(label);
  if (offset < 0 || offset + bytes > 32) {
    throw new Error(`value crosses the slot boundary: ${label} at offset ${offset}`);
  }
  const word32 = pad(word, { size: 32 });
  const piece = slice(word32, 32 - (offset + bytes), 32 - offset);
  const [decoded] = decodeAbiParameters(
    [{ type: abiTypeForLabel(label) }],
    pad(piece, { size: 32 }),
  );
  return decoded;
}

function labelToBytes(label: string): number {
  // Only value types reach a leaf: address/bool/enum are fixed, uint/int/
  // bytesN carry their width in the label, everything exotic throws in
  // decodeWordValue anyway — so a conservative regex extract is enough.
  if (label === 'address' || label.startsWith('contract ')) return 20;
  if (label === 'bool') return 1;
  if (label.startsWith('enum ')) return 1;
  const width = /^(?:u?int|bytes)(\d+)$/.exec(label.trim());
  if (width === null) throw new Error(`unsupported value label: ${label}`);
  const size = Number(width[1]);
  if (label.trim().startsWith('bytes')) return size; // bytesN: N bytes
  return Math.max(1, Math.ceil(size / 8)); // uint/int: bits → bytes
}

function formatDecoded(decoded: unknown, label: string): string {
  if (typeof decoded === 'bigint') return decoded.toString();
  if (typeof decoded === 'boolean') return String(decoded);
  if (typeof decoded === 'string') {
    // Address-family values render checksummed; getAddress's own throw
    // (malformed hex) falls back to the raw decoding.
    if (label === 'address' || label.startsWith('contract ')) {
      try {
        return getAddress(decoded);
      } catch {
        return decoded;
      }
    }
    return decoded;
  }
  return String(decoded);
}

function BytesValue({ word, slot, label }: { word: Hex; slot: Hex; label: string }) {
  let layout: BytesWordLayout;
  try {
    layout = decodeBytesWord(pad(word, { size: 32 }), slot);
  } catch {
    return <span className={valueStyle}>{word}</span>;
  }
  if (layout.kind === 'short') {
    // Short data occupies the HIGH-order bytes of the word (right-padded
    // to 32); the low byte carries length*2. Slice exactly `length` bytes
    // — never the padding NULs.
    const length = Number(layout.length);
    const data = slice(pad(word, { size: 32 }), 0, length);
    return <TruncatedValue text={label === 'string' ? tryHexToString(data) : data} />;
  }
  return <LongBytesValue layout={layout} label={label} />;
}

function tryHexToString(data: Hex): string {
  try {
    return hexToString(data);
  } catch {
    // Invalid UTF-8 on chain: the bytes themselves are the honest value.
    return data;
  }
}

// Long bytes/string: data lives in consecutive slots from keccak256(base).
// The store exposes no bulk-read hook, so each data slot is read by its
// own probe component (stable hook count per component) and the words are
// assembled once every probe has settled. Probes ride the normal store
// path — deduped, enabled-gated, and re-read by the explorer-wide Refresh.
function LongBytesValue({
  layout,
  label,
}: {
  layout: Extract<BytesWordLayout, { kind: 'long' }>;
  label: string;
}) {
  const windowBytes =
    layout.length > BigInt(LONG_WINDOW_BYTES) ? BigInt(LONG_WINDOW_BYTES) : layout.length;
  const slotCount = Number((windowBytes + 31n) / 32n);
  const slots = useMemo(
    () => Array.from({ length: slotCount }, (_, i) => slotAdd(layout.dataSlot, BigInt(i))),
    [layout.dataSlot, slotCount],
  );

  const seenRef = useRef(new Map<Hex, Hex | 'error'>());
  const [words, setWords] = useState<Hex[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    seenRef.current = new Map();
    setWords(null);
    setFailed(false);
  }, [layout.dataSlot, slotCount]);

  const onSettled = useCallback(
    (probeSlot: Hex, settled: Hex | null | 'error') => {
      seenRef.current.set(probeSlot, settled ?? ZERO_WORD);
      if (seenRef.current.size < slots.length) return;
      if ([...seenRef.current.values()].includes('error')) {
        setFailed(true);
        return;
      }
      const resolved = slots.map(s => {
        const seen = seenRef.current.get(s);
        return seen !== undefined && seen !== 'error' ? seen : ZERO_WORD;
      });
      setWords(resolved);
    },
    [slots],
  );

  return (
    <span className={valueStyle}>
      <SlotWordProbes slots={slots} onSettled={onSettled} />
      {failed ? (
        <span className={errorStyle}>data read failed — use Refresh</span>
      ) : words === null ? (
        <span className={mutedStyle}>…</span>
      ) : (
        <TruncatedValue
          text={assembleBytes(words, windowBytes, label)}
          note={
            layout.length > windowBytes
              ? `(first ${LONG_WINDOW_BYTES} of ${layout.length} bytes)`
              : undefined
          }
        />
      )}
    </span>
  );
}

function assembleBytes(words: Hex[], length: bigint, label: string): string {
  // length ≤ LONG_WINDOW_BYTES here, so the bigint→number drop is exact.
  const data = slice(concat(words), 0, Number(length));
  return label === 'string' ? tryHexToString(data) : data;
}

function SlotWordProbes({
  slots,
  onSettled,
}: {
  slots: Hex[];
  onSettled: (slot: Hex, settled: Hex | null | 'error') => void;
}) {
  return (
    <>
      {slots.map(probeSlot => (
        <SlotWordProbe key={probeSlot} slot={probeSlot} onSettled={onSettled} />
      ))}
    </>
  );
}

function SlotWordProbe({
  slot,
  onSettled,
}: {
  slot: Hex;
  onSettled: (slot: Hex, settled: Hex | null | 'error') => void;
}) {
  const state = useSlotValue(slot);
  useEffect(() => {
    if (state.status === 'ok') onSettled(slot, state.value);
    else if (state.status === 'error') onSettled(slot, 'error');
  }, [state.status, state.value, state.error, slot, onSettled]);
  return null;
}

function TruncatedValue({ text, note }: { text: string; note?: string }) {
  const [showAll, setShowAll] = useState(false);
  const overLimit = text.length > DISPLAY_CHAR_LIMIT;
  return (
    <>
      {overLimit && !showAll ? `${text.slice(0, DISPLAY_CHAR_LIMIT)}…` : text}
      {note !== undefined && <span className={mutedStyle}> {note}</span>}
      {overLimit && (
        <button type="button" className={linkButtonStyle} onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Show less' : 'Show all'}
        </button>
      )}
    </>
  );
}
