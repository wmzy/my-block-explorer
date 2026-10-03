// The ABI tab's multi-select must survive the Contract view re-rendering.
// The panel resets its selection on a "different ABI" signal, but that
// signal was the identity of a useMemo that depends on the `abi` PROP —
// and every call site computes that prop inline
// (`abi={parseAbiEntries(contractSource.abi)}`), so the array is a NEW
// object on every parent render. The memo therefore never holds, the
// reset effect fires on every render, and any parent re-render (a toast,
// a search-param update, a query-cache notification) silently wiped the
// user's checkboxes mid-selection.
//
// The reset must key on the ABI's CONTENT, not on a derived array's
// identity. These tests drive the panel through a parent that recreates
// the prop exactly as the Contract view does, and through a parent that
// genuinely swaps in a different ABI (the case the reset exists for).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useState } from 'react';

import { AbiListPanel } from '@/views/Contract/AbiListPanel';
import { parseAbiEntries } from '@/views/Contract/abiList';
import { copyText } from '@/util/clipboard';

vi.mock('@/util/clipboard', () => ({ copyText: vi.fn() }));

vi.mock('@/components/SourceCodeViewer', async () => {
  const React = await import('react');
  return {
    SourceCodeViewer: (props: { sourceCode: string }) =>
      React.createElement('pre', { 'data-testid': 'source-viewer' }, props.sourceCode),
  };
});

const ABI_A = JSON.stringify([
  {
    type: 'function',
    name: 'name',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [{ type: 'address' }],
    stateMutability: 'nonpayable',
  },
  { type: 'error', name: 'Unauthorized', inputs: [] },
]);

const ABI_B = JSON.stringify([
  { type: 'function', name: 'totalSupply', inputs: [], outputs: [{ type: 'uint256' }] },
]);

/** The Contract view's exact call shape: parse inline, fresh array per render. */
function InlineParseParent({ raw }: { raw: string }) {
  const [, bump] = useState(0);
  return (
    <>
      <button onClick={() => bump(n => n + 1)}>rerender parent</button>
      <AbiListPanel abi={parseAbiEntries(raw)} rawJson={raw} />
    </>
  );
}

/** A parent that swaps the whole ABI (a different contract's source). */
function SwitchingParent() {
  const [raw, setRaw] = useState(ABI_A);
  return (
    <>
      <button onClick={() => setRaw(current => (current === ABI_A ? ABI_B : ABI_A))}>
        switch abi
      </button>
      <AbiListPanel abi={parseAbiEntries(raw)} rawJson={raw} />
    </>
  );
}

const copyCount = () => screen.getByRole('button', { name: /Copy selected \(\d+\)/ });

beforeEach(() => {
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
});

describe('AbiListPanel selection identity', () => {
  it('keeps the selection when the parent re-renders with the same ABI', () => {
    render(<InlineParseParent raw={ABI_A} />);

    act(() => {
      screen.getByRole('checkbox', { name: 'name() returns (string)' }).click();
    });
    expect(copyCount()).toHaveTextContent('Copy selected (1)');

    // The very thing that used to wipe it: a parent re-render that
    // rebuilds the `abi` prop array.
    act(() => {
      screen.getByRole('button', { name: 'rerender parent' }).click();
    });

    expect(copyCount()).toHaveTextContent('Copy selected (1)');
    expect(screen.getByRole('checkbox', { name: 'name() returns (string)' })).toBeChecked();
  });

  it('keeps the selection across several re-renders', () => {
    render(<InlineParseParent raw={ABI_A} />);

    act(() => {
      screen.getByRole('checkbox', { name: 'name() returns (string)' }).click();
    });
    const rerender = screen.getByRole('button', { name: 'rerender parent' });
    for (let i = 0; i < 3; i += 1) {
      act(() => {
        rerender.click();
      });
    }

    expect(copyCount()).toHaveTextContent('Copy selected (1)');
  });

  it('still clears the selection when the ABI genuinely changes', () => {
    render(<SwitchingParent />);

    act(() => {
      screen.getByRole('checkbox', { name: 'name() returns (string)' }).click();
    });
    expect(copyCount()).toHaveTextContent('Copy selected (1)');

    act(() => {
      screen.getByRole('button', { name: 'switch abi' }).click();
    });

    // A different contract's ABI must not inherit the previous selection.
    expect(copyCount()).toHaveTextContent('Copy selected (0)');
    expect(screen.getByRole('checkbox', { name: 'totalSupply() returns (uint256)' })).toBeVisible();
  });
});
