import { useState } from 'react';
import { css } from '@linaria/core';
import { Button } from '@/components/ui/Button';
import {
  clearPrivateNote,
  PRIVATE_NOTE_MAX_CHARS,
  readPrivateNote,
  savePrivateNote,
} from '@/util/privateNotes';

// Collapsed display truncation for long notes — the full text stays one
// title-hover away, and the editor shows it untruncated.
const COLLAPSED_MAX_CHARS = 40;

// Saved-note chip: the same badge-like pill the Label row uses — an
// annotation the user authored, deliberately not styled as chain truth.
const noteChip = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-1);
  padding: 0 var(--haze-space-2);
  border: 1px solid var(--haze-color-border);
  border-radius: 999px;
  background: var(--haze-color-bg-muted);
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  max-width: 100%;
  overflow-wrap: anywhere;
`;

// Subtle affordances beside the chip (icon buttons).
const noteChipButton = css`
  border: none;
  background: none;
  padding: 0 var(--haze-space-1);
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: var(--haze-text-sm);

  &:hover {
    color: var(--haze-color-text);
  }
`;

// The "+ add private note" affordance: quiet on purpose (an invitation,
// not a data row) but always visible — this is a single-user tool.
const noteAddButton = css`
  border: none;
  background: none;
  padding: 0;
  color: var(--haze-color-text-muted);
  cursor: pointer;
  font-size: var(--haze-text-sm);
  text-decoration: underline dotted;

  &:hover {
    color: var(--haze-color-text);
  }
`;

// Inline editor: textarea + counter + Save/Cancel (+ Remove over an
// existing note). Stacks vertically inside the InfoItem value cell.
const noteEditor = css`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--haze-space-2);
  width: 100%;

  @media (max-width: 768px) {
    align-items: stretch;
  }
`;

const noteTextarea = css`
  width: 100%;
  min-height: 4.5rem;
  resize: vertical;
  font-family: var(--haze-font-sans);
`;

// Counter + caveat line under the textarea: the counter is the live cap
// feedback, the caveat is the mandatory honesty copy.
const noteMeta = css`
  font-size: var(--haze-text-xs);
  color: var(--haze-color-text-muted);
  margin: 0;
  text-align: right;
  width: 100%;

  @media (max-width: 768px) {
    text-align: left;
  }
`;

const noteError = css`
  font-size: var(--haze-text-sm);
  color: var(--haze-color-text);
  margin: 0;
  text-align: right;

  @media (max-width: 768px) {
    text-align: left;
  }
`;

const noteEditorRow = css`
  display: flex;
  gap: var(--haze-space-2);
`;

/**
 * The Private Note row of the Address overview. Browser-only annotation
 * per (chainId, address): collapsed state shows the saved note truncated
 * (or the "+ add private note" invitation), the editor is a textarea with
 * a live out-of-280 counter. Saves are synchronous localStorage writes —
 * the UI settles the same tick, no optimistic gap. Validation is inline
 * and rejects (never silently truncates) over-cap input; the mandatory
 * caveat "Stored only in this browser — never sent to the server." rides
 * the editor, because that is the moment the user is deciding to type
 * something a server will never see.
 */
export function PrivateNoteChip({ chainId, address }: { chainId: number; address: string }) {
  const [note, setNote] = useState<string | null>(() => readPrivateNote(chainId, address));
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  // Set only when the synchronous write itself failed (storage off) —
  // validation errors are derived live from the draft instead.
  const [storageHint, setStorageHint] = useState<string | null>(null);

  const rawLength = draft.length;
  const tooLong = rawLength > PRIVATE_NOTE_MAX_CHARS;
  const empty = draft.trim().length === 0;

  const startEditing = () => {
    setDraft(note ?? '');
    setStorageHint(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setStorageHint(null);
  };

  const save = () => {
    const result = savePrivateNote(chainId, address, draft);
    if (result.ok) {
      setNote(result.note);
      setEditing(false);
      setStorageHint(null);
    } else {
      // Validation rejections are already visible inline; only the
      // storage failure needs the editor kept open with a hint.
      setStorageHint(
        result.reason === 'storage-unavailable'
          ? 'Could not save — this browser\'s storage is unavailable (private mode?).'
          : null,
      );
    }
  };

  const remove = () => {
    clearPrivateNote(chainId, address);
    setNote(null);
    setEditing(false);
    setStorageHint(null);
  };

  if (editing) {
    const saveDisabled = tooLong || empty || storageHint !== null;
    // The title explains a disabled Save (hover/focus reachable); the
    // inline error paragraphs below repeat the two data problems.
    const saveDisabledReason
      = tooLong
        ? `Note must be at most ${PRIVATE_NOTE_MAX_CHARS} characters (currently ${rawLength})`
        : empty
          ? 'Note is empty — Remove clears the saved note instead'
          : (storageHint ?? undefined);
    return (
      <div className={noteEditor} data-testid="private-note-editor">
        <textarea
          className={noteTextarea}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="Private note (visible only in this browser)"
          aria-label="Private note"
          // Deliberately NO maxLength: the cap must reject visibly, never
          // truncate silently as the user types.
          data-testid="private-note-input"
        />
        <p className={noteMeta}>
          <span data-testid="private-note-counter">
            {rawLength}
            {' / '}
            {PRIVATE_NOTE_MAX_CHARS}
          </span>
          {' — '}
          Stored only in this browser — never sent to the server.
        </p>
        {tooLong && (
          <p className={noteError} data-testid="private-note-error" role="alert">
            {`Note must be at most ${PRIVATE_NOTE_MAX_CHARS} characters (currently ${rawLength}) — shorten it to save.`}
          </p>
        )}
        {/* Empty-draft guidance only over an EXISTING note (the case
            where "empty" means "you are erasing something — use Remove");
            a fresh editor starts quiet, with Save's title carrying the
            requirement. */}
        {!tooLong && empty && note !== null && (
          <p className={noteError} data-testid="private-note-error" role="alert">
            Note is empty — Remove clears the saved note instead.
          </p>
        )}
        {storageHint !== null && (
          <p className={noteError} data-testid="private-note-editor-hint" role="alert">
            {storageHint}
          </p>
        )}
        <div className={noteEditorRow}>
          <Button
            variant="secondary"
            size="sm"
            onClick={save}
            disabled={saveDisabled}
            title={saveDisabled ? saveDisabledReason : 'Save the private note'}
            data-testid="private-note-save"
          >
            Save
          </Button>
          <Button variant="ghost" size="sm" onClick={cancelEditing}>
            Cancel
          </Button>
          {note !== null && (
            <Button
              variant="ghost"
              size="sm"
              onClick={remove}
              title="Remove the saved private note"
              data-testid="private-note-remove"
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (note === null) {
    return (
      <button
        type="button"
        className={noteAddButton}
        onClick={startEditing}
        data-testid="private-note-add"
      >
        + add private note
      </button>
    );
  }

  const collapsed = note.length > COLLAPSED_MAX_CHARS
    ? `${note.slice(0, COLLAPSED_MAX_CHARS)}…`
    : note;

  return (
    <>
      <span className={noteChip} title={note} data-testid="private-note-chip">
        {collapsed}
      </span>
      <button
        type="button"
        className={noteChipButton}
        onClick={startEditing}
        aria-label="Edit private note"
        title="Edit private note"
        data-testid="private-note-edit"
      >
        ✎
      </button>
    </>
  );
}
