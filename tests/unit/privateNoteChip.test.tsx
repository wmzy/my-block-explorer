// PrivateNoteChip component contract: empty → editor → saved → re-edit
// transitions, the live out-of-280 counter with inline rejection (never a
// silent truncation), the mandatory browser-only caveat riding the
// editor, collapsed truncation of long notes, and removal. Saves are
// synchronous localStorage writes, so every assertion reads storage
// directly — what the chip shows IS what this browser stored.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { getAddress } from 'viem';
import { PrivateNoteChip } from '@/components/ui/PrivateNoteChip';
import {
  readPrivateNote,
  PRIVATE_NOTE_KEY_PREFIX,
  PRIVATE_NOTE_MAX_CHARS,
} from '@/util/privateNotes';

const CHECKSUMMED = getAddress('0x1234567890abcdef1234567890abcdef12345678');

const renderChip = () => render(<PrivateNoteChip chainId={1} address={CHECKSUMMED} />);

const addField = () => screen.getByTestId('private-note-add');
const openEditor = () => fireEvent.click(addField());
const input = () => screen.getByTestId('private-note-input');
const saveButton = () => screen.getByTestId('private-note-save');

beforeEach(() => {
  localStorage.clear();
});

describe('empty → editor → saved', () => {
  it('offers the add affordance when nothing is stored', () => {
    renderChip();
    expect(addField()).toHaveTextContent('+ add private note');
    expect(screen.queryByTestId('private-note-chip')).not.toBeInTheDocument();
  });

  it('opens the editor with the counter, the caveat, and no error', () => {
    renderChip();
    openEditor();
    expect(input()).toHaveValue('');
    expect(screen.getByTestId('private-note-counter')).toHaveTextContent(`0 / ${PRIVATE_NOTE_MAX_CHARS}`);
    // Mandatory honesty copy rides the editor itself.
    expect(screen.getByTestId('private-note-editor'))
      .toHaveTextContent('Stored only in this browser — never sent to the server.');
    expect(screen.queryByTestId('private-note-error')).not.toBeInTheDocument();
  });

  it('saves synchronously: chip appears, localStorage holds the trimmed note', () => {
    renderChip();
    openEditor();
    fireEvent.change(input(), { target: { value: '  dao treasury  ' } });
    fireEvent.click(saveButton());
    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('dao treasury');
    expect(localStorage.getItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`)).toBe('dao treasury');
    // Editor closed after the save.
    expect(screen.queryByTestId('private-note-input')).not.toBeInTheDocument();
  });

  it('re-opens the editor prefilled and saves the edit', () => {
    localStorage.setItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, 'first draft');
    renderChip();
    fireEvent.click(screen.getByTestId('private-note-edit'));
    expect(input()).toHaveValue('first draft');
    fireEvent.change(input(), { target: { value: 'second draft' } });
    fireEvent.click(saveButton());
    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('second draft');
    expect(readPrivateNote(1, CHECKSUMMED)).toBe('second draft');
  });
});

describe('char cap — reject inline, never truncate', () => {
  it('accepts exactly 280 characters', () => {
    renderChip();
    openEditor();
    fireEvent.change(input(), { target: { value: 'x'.repeat(PRIVATE_NOTE_MAX_CHARS) } });
    expect(screen.getByTestId('private-note-counter'))
      .toHaveTextContent(`${PRIVATE_NOTE_MAX_CHARS} / ${PRIVATE_NOTE_MAX_CHARS}`);
    expect(screen.queryByTestId('private-note-error')).not.toBeInTheDocument();
    expect(saveButton()).toBeEnabled();
    fireEvent.click(saveButton());
    // Collapsed display truncates at 40 chars — the full text rides the
    // title; storage keeps every character.
    expect(screen.getByTestId('private-note-chip'))
      .toHaveTextContent(`${'x'.repeat(40)}…`);
    expect(screen.getByTestId('private-note-chip'))
      .toHaveAttribute('title', 'x'.repeat(PRIVATE_NOTE_MAX_CHARS));
    expect(readPrivateNote(1, CHECKSUMMED)).toBe('x'.repeat(PRIVATE_NOTE_MAX_CHARS));
  });

  it('shows the inline error and disables Save past the cap, without writing', () => {
    renderChip();
    openEditor();
    // No maxLength on the textarea: the over-cap text stays visible so
    // the user can shorten it, and the counter reflects the raw length.
    const over = 'y'.repeat(PRIVATE_NOTE_MAX_CHARS + 5);
    fireEvent.change(input(), { target: { value: over } });
    expect(input()).toHaveValue(over);
    expect(screen.getByTestId('private-note-counter'))
      .toHaveTextContent(`${over.length} / ${PRIVATE_NOTE_MAX_CHARS}`);
    const error = screen.getByTestId('private-note-error');
    expect(error).toHaveTextContent(`at most ${PRIVATE_NOTE_MAX_CHARS} characters`);
    expect(saveButton()).toBeDisabled();
    expect(localStorage.getItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`)).toBeNull();
  });

  it('flags an empty draft as unsavable (Remove is the clear path)', () => {
    localStorage.setItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, 'existing');
    renderChip();
    fireEvent.click(screen.getByTestId('private-note-edit'));
    fireEvent.change(input(), { target: { value: '   ' } });
    expect(screen.getByTestId('private-note-error')).toHaveTextContent('empty');
    expect(saveButton()).toBeDisabled();
  });
});

describe('collapsed display and removal', () => {
  it('truncates long notes to ~40 characters with the full text on the title', () => {
    const long = 'a'.repeat(60);
    localStorage.setItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, long);
    renderChip();
    const chip = screen.getByTestId('private-note-chip');
    expect(chip).toHaveTextContent(`${'a'.repeat(40)}…`);
    expect(chip).toHaveAttribute('title', long);
  });

  it('Remove (in the editor over an existing note) clears storage and returns to the add state', () => {
    localStorage.setItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, 'temporary');
    renderChip();
    fireEvent.click(screen.getByTestId('private-note-edit'));
    fireEvent.click(screen.getByTestId('private-note-remove'));
    expect(screen.getByTestId('private-note-add')).toBeInTheDocument();
    expect(localStorage.getItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`)).toBeNull();
  });

  it('Cancel discards the draft without writing', () => {
    localStorage.setItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, 'stable');
    renderChip();
    fireEvent.click(screen.getByTestId('private-note-edit'));
    fireEvent.change(input(), { target: { value: 'discarded' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('stable');
    expect(readPrivateNote(1, CHECKSUMMED)).toBe('stable');
  });
});

describe('notes are namespaced per chain and address', () => {
  it('does not leak a note across chains or addresses', () => {
    localStorage.setItem(`${PRIVATE_NOTE_KEY_PREFIX}137:${CHECKSUMMED}`, 'polygon note');
    renderChip();
    expect(addField()).toBeInTheDocument();
    openEditor();
    fireEvent.change(input(), { target: { value: 'mainnet note' } });
    fireEvent.click(saveButton());
    expect(readPrivateNote(1, CHECKSUMMED)).toBe('mainnet note');
    expect(readPrivateNote(137, CHECKSUMMED)).toBe('polygon note');
  });
});
