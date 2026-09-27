// AbiListPanel wiring tests: the categorized list renders from a raw ABI
// fixture (counts, hidden empty categories), multi-select spans categories
// through the chips, the copy action merges the selection with EVERY error
// definition via copyText, the raw toggle renders the exact rawJson string,
// and the provenance chip only appears when provided.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AbiListPanel } from '@/views/Contract/AbiListPanel';
import { copyText } from '@/util/clipboard';

vi.mock('@/util/clipboard', () => ({ copyText: vi.fn() }));

vi.mock('@/components/SourceCodeViewer', async () => {
  const React = await import('react');
  return {
    SourceCodeViewer: (props: { sourceCode: string }) =>
      React.createElement('pre', { 'data-testid': 'source-viewer' }, props.sourceCode),
  };
});

// One entry per category: read (with outputs), write, event, two errors,
// constructor.
const FIXTURE = [
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
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }],
  },
  { type: 'error', name: 'Unauthorized', inputs: [] },
  { type: 'error', name: 'InsufficientBalance', inputs: [{ type: 'uint256' }] },
  { type: 'constructor', inputs: [] },
];

const RAW_JSON = JSON.stringify(FIXTURE, null, 2);

const renderPanel = (abi: readonly unknown[] = FIXTURE, rawJson: string = RAW_JSON) =>
  render(<AbiListPanel abi={abi} rawJson={rawJson} />);

const copyButton = () => screen.getByRole('button', { name: /Copy selected \(\d+\)/ });

beforeEach(() => {
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
});

describe('AbiListPanel list view', () => {
  it('renders category chips with counts and hides empty categories', () => {
    renderPanel();

    expect(screen.getByRole('button', { name: 'All (6)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Write (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Events (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Errors (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Other (1)' })).toBeInTheDocument();

    // Every row renders as a checkbox named by its formatted signature,
    // with the mutability/type badge beside it.
    expect(screen.getByRole('checkbox', { name: 'name() returns (string)' })).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'transfer(address, uint256)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'event Transfer(address, address, uint256)' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'error Unauthorized()' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'constructor()' })).toBeInTheDocument();
    expect(screen.getByText('nonpayable')).toBeInTheDocument();
    expect(screen.getByText('constructor')).toBeInTheDocument();
  });

  it('hides categories with no entries', () => {
    renderPanel(FIXTURE.filter(entry => entry.type !== 'event' && entry.type !== 'error'));

    expect(screen.queryByRole('button', { name: /^Events \(/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Errors \(/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument();
    // No errors in the ABI: no standing error note either.
    expect(screen.queryByText(/Always includes/)).not.toBeInTheDocument();
  });

  it('notes that error definitions always ride along (singular and plural)', () => {
    renderPanel();
    expect(
      screen.getByText(/Always includes 2 error definitions so reverts decode/),
    ).toBeInTheDocument();

    renderPanel(FIXTURE.filter(entry => entry.name !== 'InsufficientBalance'));
    expect(
      screen.getByText(/Always includes 1 error definition so reverts decode/),
    ).toBeInTheDocument();
  });

  it('narrows rows with the name/type text filter', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Filter ABI entries by name or type'), 'trans');

    expect(
      screen.getByRole('checkbox', { name: 'transfer(address, uint256)' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'event Transfer(address, address, uint256)' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'name() returns (string)' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'error Unauthorized()' })).not.toBeInTheDocument();
  });

  it('selects across categories through the chips and copies selection plus all errors', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: 'name() returns (string)' }));
    await user.click(screen.getByRole('button', { name: 'Write (1)' }));
    await user.click(screen.getByRole('checkbox', { name: 'transfer(address, uint256)' }));

    expect(copyButton()).toHaveTextContent('Copy selected (2)');

    await user.click(copyButton());

    expect(copyText).toHaveBeenCalledTimes(1);
    // Selection in original ABI order, then the two (unselected) errors
    // merged in; the event and constructor stay out.
    expect(JSON.parse(vi.mocked(copyText).mock.calls[0][0])).toEqual([
      FIXTURE[0],
      FIXTURE[1],
      FIXTURE[3],
      FIXTURE[4],
    ]);
  });

  it('keeps the copy button disabled until a row is selected', async () => {
    const user = userEvent.setup();
    renderPanel();

    expect(screen.getByRole('button', { name: 'Copy selected (0)' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'error Unauthorized()' }));
    expect(screen.getByRole('button', { name: 'Copy selected (1)' })).toBeEnabled();
  });

  it('selects and clears through the global and per-section controls', async () => {
    const user = userEvent.setup();
    renderPanel();

    // Per-section select-all (Read is the first rendered section).
    await user.click(screen.getAllByRole('checkbox', { name: 'Select all' })[0]);
    expect(screen.getByRole('button', { name: 'Copy selected (1)' })).toBeEnabled();

    // Global Select all covers every visible row.
    await user.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Copy selected (6)' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByRole('button', { name: 'Copy selected (0)' })).toBeDisabled();
  });

  it('reports copy outcomes and resets the label after two seconds', async () => {
    vi.useFakeTimers();
    try {
      renderPanel();
      fireEvent.click(screen.getByRole('checkbox', { name: 'name() returns (string)' }));
      fireEvent.click(screen.getByRole('button', { name: 'Copy selected (1)' }));
      await act(async () => {});
      expect(screen.getByRole('button', { name: 'Copied ✓' })).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.getByRole('button', { name: 'Copy selected (1)' })).toBeEnabled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows Copy failed when the clipboard write is rejected', async () => {
    vi.mocked(copyText).mockResolvedValueOnce(false);
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('checkbox', { name: 'name() returns (string)' }));
    await user.click(screen.getByRole('button', { name: 'Copy selected (1)' }));

    expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
  });
});

describe('AbiListPanel raw view and provenance', () => {
  it('renders the exact rawJson string behind the Raw JSON toggle', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByRole('button', { name: 'Raw JSON' }));

    const viewer = screen.getByTestId('source-viewer');
    expect(viewer.textContent).toBe(RAW_JSON);
    // List surface is unmounted while the raw view is active.
    expect(screen.queryByRole('checkbox', { name: 'name() returns (string)' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Raw JSON' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.queryByTestId('source-viewer')).not.toBeInTheDocument();
  });

  it('renders an optional caption above the raw viewer', async () => {
    const user = userEvent.setup();
    render(
      <AbiListPanel abi={FIXTURE} rawJson={RAW_JSON} rawTitle="Server ABI (pretty-printed)" />,
    );

    await user.click(screen.getByRole('button', { name: 'Raw JSON' }));
    expect(screen.getByText('Server ABI (pretty-printed)')).toBeInTheDocument();
  });

  it('shows the provenance chip only when provided', () => {
    const { rerender } = renderPanel();
    expect(screen.queryByText('Custom ABI (this browser)')).not.toBeInTheDocument();

    rerender(
      <AbiListPanel
        abi={FIXTURE}
        rawJson={RAW_JSON}
        provenanceLabel="Custom ABI (this browser)"
      />,
    );
    expect(screen.getByText('Custom ABI (this browser)')).toBeInTheDocument();
  });

  it('never crashes on a non-array or junk-filled abi prop', () => {
    renderPanel([1, 'junk', null, { type: 'function', name: 'only' }], '[]');
    expect(screen.getByRole('button', { name: 'All (1)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'only()' })).toBeInTheDocument();
  });
});

// Keeps the afterEach chain explicit for the fake-timers test above.
afterEach(() => {
  vi.useRealTimers();
});
