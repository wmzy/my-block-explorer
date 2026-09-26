// Observable behavior of the tx-tab advanced filter bar: open/close
// toggle, URL-seeded fields, the inline two-tier address / wei
// validation states, and the Apply gate — an invalid draft must never
// reach onApply (the URL write behind it is what fires the request, so
// no request can ever leave the browser with a malformed filter).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getAddress } from 'viem';
import { TxFilterBar, validateTxFilterValues } from '@/views/Address/TxFilterBar';

const VALID_FROM = '0x1111111111111111111111111111111111111111';
const VALID_TO = '0x2222222222222222222222222222222222222222';

// A real checksum form, flipped at one letter the checksum keeps
// lowercase — the tier-2 (checksum) fixture.
const CHECKSUMMED = getAddress('0x5aaeb6053f3e94c9b9a09f33669495e3474963fe');
const BAD_CHECKSUM = (() => {
  for (let i = 2; i < CHECKSUMMED.length; i++) {
    if (/[a-f]/.test(CHECKSUMMED[i])) {
      return (
        CHECKSUMMED.slice(0, i)
        + CHECKSUMMED[i].toUpperCase()
        + CHECKSUMMED.slice(i + 1)
      );
    }
  }
  return CHECKSUMMED;
})();

const EMPTY_VALUES = { from: '', to: '', min: '', max: '' };

type Harness = {
  onApply: ReturnType<typeof vi.fn>;
  onClear: ReturnType<typeof vi.fn>;
  onToggle: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<Parameters<typeof TxFilterBar>[0]>) => void;
  unmount: () => void;
};

const renderBar = (
  props: Partial<Parameters<typeof TxFilterBar>[0]> & { values?: typeof EMPTY_VALUES },
): Harness => {
  const onApply = vi.fn();
  const onClear = vi.fn();
  const onToggle = vi.fn();
  const { rerender, unmount } = render(
    <TxFilterBar
      open={props.open ?? true}
      onToggle={onToggle}
      values={props.values ?? EMPTY_VALUES}
      urlParamCount={props.urlParamCount ?? 0}
      onApply={onApply}
      onClear={onClear}
    />,
  );
  // Re-render helper that keeps the same handler instances (assertions
  // below count calls across the URL-driven re-render).
  const rerenderWith = (next: Partial<Parameters<typeof TxFilterBar>[0]>) =>
    rerender(
      <TxFilterBar
        open={next.open ?? props.open ?? true}
        onToggle={onToggle}
        values={next.values ?? props.values ?? EMPTY_VALUES}
        urlParamCount={next.urlParamCount ?? props.urlParamCount ?? 0}
        onApply={onApply}
        onClear={onClear}
      />,
    );
  return { onApply, onClear, onToggle, rerender: rerenderWith, unmount };
};

const typeInto = (testId: string, value: string) => {
  fireEvent.change(screen.getByTestId(testId), { target: { value } });
};

describe('validateTxFilterValues (pure)', () => {
  it('accepts empty fields (absent, not invalid)', () => {
    expect(validateTxFilterValues(EMPTY_VALUES)).toEqual({});
  });

  it('accepts valid addresses and non-negative integer wei', () => {
    expect(
      validateTxFilterValues({
        from: VALID_FROM,
        to: VALID_TO.toLowerCase(),
        min: '0',
        max: '1000000000000000000000',
      }),
    ).toEqual({});
  });

  it('flags shape-invalid addresses on the format tier', () => {
    expect(validateTxFilterValues({ ...EMPTY_VALUES, from: '0x123' }).from)
      .toMatch(/format/i);
  });

  it('flags checksum mismatches on the checksum tier', () => {
    expect(validateTxFilterValues({ ...EMPTY_VALUES, to: BAD_CHECKSUM }).to)
      .toMatch(/checksum/i);
  });

  it('flags non-integer / negative wei amounts', () => {
    for (const bad of ['-5', '1.5', 'NaN', '1e18', 'abc']) {
      expect(validateTxFilterValues({ ...EMPTY_VALUES, min: bad }).min)
        .toMatch(/wei/i);
      expect(validateTxFilterValues({ ...EMPTY_VALUES, max: bad }).max)
        .toMatch(/wei/i);
    }
  });
});

describe('TxFilterBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders closed with only the toggle; fields and scope line hidden', () => {
    renderBar({ open: false });

    expect(screen.getByTestId('tx-filter-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('tx-filter-from')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tx-filter-scope')).not.toBeInTheDocument();
  });

  it('shows the standing scope line while open (honesty contract)', () => {
    renderBar({ open: true });

    expect(screen.getByTestId('tx-filter-scope')).toHaveTextContent(
      'Filters apply within the discovered transactions of the selected window — not a new scan.',
    );
    // The wei hint is plain about the unit.
    expect(screen.getAllByText(/1 native unit = 10\^18 wei/).length).toBeGreaterThan(0);
  });

  it('fires onToggle from the header (click and keyboard)', () => {
    const { onToggle } = renderBar({ open: false });

    fireEvent.click(screen.getByTestId('tx-filter-toggle'));
    expect(onToggle).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByTestId('tx-filter-toggle'), { key: 'Enter' });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('seeds its fields from the URL values and re-seeds on URL change', () => {
    const values = { from: VALID_FROM, to: VALID_TO, min: '7', max: '' };
    const { rerender } = renderBar({ open: true, values });

    expect(screen.getByTestId('tx-filter-from')).toHaveValue(VALID_FROM);
    expect(screen.getByTestId('tx-filter-min')).toHaveValue('7');

    // Back/forward to a different filter set re-seeds the draft.
    rerender({ values: { from: '', to: VALID_FROM, min: '', max: '9' }, urlParamCount: 2 });
    expect(screen.getByTestId('tx-filter-from')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-max')).toHaveValue('9');
  });

  it('shows the URL param count badge only when params are present', () => {
    const first = renderBar({ open: true, urlParamCount: 3 });
    expect(screen.getByTestId('tx-filter-count')).toHaveTextContent('3');
    first.unmount();

    const second = renderBar({ open: true, urlParamCount: 0 });
    expect(screen.queryByTestId('tx-filter-count')).not.toBeInTheDocument();
    second.rerender({ urlParamCount: 1 });
    expect(screen.getByTestId('tx-filter-count')).toHaveTextContent('1');
  });

  it('an invalid address draft renders a field error and Apply never fires onApply', () => {
    const { onApply } = renderBar({ open: true });

    typeInto('tx-filter-from', '0x123');
    expect(screen.getByTestId('tx-filter-from-error')).toHaveTextContent(/format/i);
    expect(screen.getByTestId('tx-filter-apply')).toBeDisabled();

    fireEvent.click(screen.getByTestId('tx-filter-apply'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('a checksum-mismatched address renders the checksum error and never applies', () => {
    const { onApply } = renderBar({ open: true });

    typeInto('tx-filter-to', BAD_CHECKSUM);
    expect(screen.getByTestId('tx-filter-to-error')).toHaveTextContent(/checksum/i);
    fireEvent.click(screen.getByTestId('tx-filter-apply'));
    expect(onApply).not.toHaveBeenCalled();
  });

  it('an invalid wei draft renders a field error and Apply never fires onApply', () => {
    const { onApply } = renderBar({ open: true });

    for (const bad of ['-5', '1.5', 'NaN']) {
      typeInto('tx-filter-min', bad);
      expect(screen.getByTestId('tx-filter-min-error')).toHaveTextContent(/wei/i);
      fireEvent.click(screen.getByTestId('tx-filter-apply'));
      expect(onApply).not.toHaveBeenCalled();
    }
  });

  it('a fully valid draft applies with the exact field values', () => {
    const { onApply } = renderBar({ open: true });

    typeInto('tx-filter-from', VALID_FROM);
    typeInto('tx-filter-to', VALID_TO);
    typeInto('tx-filter-min', '0');
    typeInto('tx-filter-max', '1000000000000000000000');
    fireEvent.click(screen.getByTestId('tx-filter-apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      from: VALID_FROM,
      to: VALID_TO,
      min: '0',
      max: '1000000000000000000000',
    });
  });

  it('empty fields are valid — applying an all-empty draft is a clear-by-apply', () => {
    const { onApply } = renderBar({ open: true, values: { from: VALID_FROM, to: '', min: '', max: '' } });

    // Wipe the seeded from value: still valid (absent), Apply fires.
    typeInto('tx-filter-from', '');
    fireEvent.click(screen.getByTestId('tx-filter-apply'));

    expect(onApply).toHaveBeenCalledWith(EMPTY_VALUES);
  });

  it('Clear resets the draft fields and fires onClear', () => {
    const { onClear } = renderBar({
      open: true,
      values: { from: VALID_FROM, to: VALID_TO, min: '7', max: '9' },
    });

    fireEvent.click(screen.getByTestId('tx-filter-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tx-filter-from')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-to')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-min')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-max')).toHaveValue('');
  });
});
