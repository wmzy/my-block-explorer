// The Address route reuses its component instance across address changes
// (native-router composes matched elements without a key — the repo
// documents the same router behaviour in views/Contract/index.tsx). The
// Private Note chip seeded all its state from (chainId, address) props in
// a useState initializer and never resynced, so a note written for address
// A stayed on screen under address B whenever the view did not unmount in
// between — which is exactly the case when B's data comes from the query
// cache (e.g. browser Back). Saving then wrote A's text onto B.
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { getAddress } from 'viem';
import { PrivateNoteChip } from '@/components/ui/PrivateNoteChip';
import { readPrivateNote } from '@/util/privateNotes';

const A = getAddress('0x1234567890abcdef1234567890abcdef12345678');
const B = getAddress('0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');

beforeEach(() => {
  localStorage.clear();
});

describe('the chip follows the address it renders for', () => {
  it('shows the new address\'s note (or none) when the address prop changes', () => {
    // Seed a note for A only, as if saved in a previous visit.
    localStorage.setItem(`be:privateNote:1:${A}`, 'Alice wallet');
    expect(readPrivateNote(1, A)).toBe('Alice wallet');
    expect(readPrivateNote(1, B)).toBeNull();

    const view = render(<PrivateNoteChip chainId={1} address={A} />);
    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('Alice wallet');

    // Same instance, new address — the route hands the chip new props.
    view.rerender(<PrivateNoteChip chainId={1} address={B} />);

    expect(screen.getByTestId('private-note-add')).toBeInTheDocument();
    expect(screen.queryByTestId('private-note-chip')).not.toBeInTheDocument();
  });

  it('drops an open editor of the previous address instead of saving it onto the new one', () => {
    localStorage.setItem(`be:privateNote:1:${A}`, 'Alice wallet');

    const view = render(<PrivateNoteChip chainId={1} address={A} />);
    fireEvent.click(screen.getByTestId('private-note-edit'));
    const input = screen.getByTestId('private-note-input');
    expect(input).toHaveValue('Alice wallet');
    fireEvent.change(input, { target: { value: 'secret for A' } });

    view.rerender(<PrivateNoteChip chainId={1} address={B} />);

    // The editor is gone (B has no note) — the A draft cannot be submitted.
    expect(screen.queryByTestId('private-note-editor')).not.toBeInTheDocument();
    expect(readPrivateNote(1, B)).toBeNull();
  });

  it('reads the new address\'s own note after a prop change', () => {
    localStorage.setItem(`be:privateNote:1:${A}`, 'Alice wallet');
    localStorage.setItem(`be:privateNote:1:${B}`, 'Bob wallet');

    const view = render(<PrivateNoteChip chainId={1} address={A} />);
    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('Alice wallet');

    view.rerender(<PrivateNoteChip chainId={1} address={B} />);

    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('Bob wallet');
  });

  it('a chain change re-reads too', () => {
    localStorage.setItem(`be:privateNote:1:${A}`, 'mainnet note');
    localStorage.setItem(`be:privateNote:10:${A}`, 'polygon note');

    const view = render(<PrivateNoteChip chainId={1} address={A} />);
    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('mainnet note');

    view.rerender(<PrivateNoteChip chainId={10} address={A} />);

    expect(screen.getByTestId('private-note-chip')).toHaveTextContent('polygon note');
  });
});
