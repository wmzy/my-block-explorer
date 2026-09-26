// Observable behavior of the tx-tab advanced filter bar: open/close
// toggle, URL-seeded fields, the inline two-tier address / wei /
// method-selector validation states, the selector chips offered from the
// loaded page's own rows, and the Apply gate — an invalid draft must
// never reach onApply (the URL write behind it is what fires the
// request, so no request can ever leave the browser with a malformed
// filter).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { getAddress } from 'viem';
import {
  TxFilterBar,
  validateTxFilterValues,
  distinctRowSelectors,
  selectorChipLabel,
} from '@/views/Address/TxFilterBar';
import type { SignatureOutcome } from '@/services/signatures';

// Chip labels come from the shared openchain batch hook; mocked so chip
// rendering is deterministic (the hook's own batching/memo behavior has
// dedicated coverage in signaturesFrontend.test.ts).
const mockUseSignaturesBatched = vi.fn<
  (selectors: readonly string[]) => Record<string, SignatureOutcome>
>(() => ({}));
vi.mock('@/services/signatures', () => ({
  useSignaturesBatched: (...args: unknown[]) => mockUseSignaturesBatched(...(args as [readonly string[]])),
}));

const VALID_FROM = '0x1111111111111111111111111111111111111111';
const VALID_TO = '0x2222222222222222222222222222222222222222';
const SEL_TRANSFER = '0xa9059cbb';
const SEL_APPROVE = '0x095ea7b3';

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

const EMPTY_VALUES = { from: '', to: '', min: '', max: '', method: '' };

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
      selectorOptions={props.selectorOptions}
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
        selectorOptions={next.selectorOptions ?? props.selectorOptions}
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
        method: SEL_TRANSFER,
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

  it('flags malformed method selectors (0x + 8 hex is the only valid shape)', () => {
    for (const bad of ['a9059cbb', '0xa905', '0xa9059cbb00', '0xzz059cbb', '0XA9059CBB']) {
      expect(validateTxFilterValues({ ...EMPTY_VALUES, method: bad }).method)
        .toMatch(/selector/i);
    }
    // Mixed-case hex with the 0x prefix is legal (compared case-blind).
    expect(validateTxFilterValues({ ...EMPTY_VALUES, method: '0xA9059CBB' }).method)
      .toBeUndefined();
  });
});

describe('distinctRowSelectors / selectorChipLabel (pure)', () => {
  it('collects distinct row selectors in first-seen order, skipping null/absent/empty', () => {
    expect(
      distinctRowSelectors([
        { selector: SEL_TRANSFER },
        { selector: null },
        {},
        { selector: SEL_TRANSFER },
        { selector: SEL_APPROVE },
        { selector: '' },
      ]),
    ).toEqual([SEL_TRANSFER, SEL_APPROVE]);
    expect(distinctRowSelectors([])).toEqual([]);
  });

  it('labels a chip with the resolved base name, falling back to the raw selector', () => {
    const resolved: SignatureOutcome = {
      kind: 'function',
      signatures: ['transfer(address,uint256)', 'transfer(address,uint256,bytes)'],
      source: 'openchain',
    };
    expect(selectorChipLabel(SEL_TRANSFER, resolved)).toBe('transfer');
    // Pending (undefined), notFound and unavailable all keep the raw
    // selector — never a fabricated name.
    expect(selectorChipLabel(SEL_TRANSFER, undefined)).toBe(SEL_TRANSFER);
    expect(
      selectorChipLabel(SEL_TRANSFER, { kind: 'function', signatures: [], notFound: true }),
    ).toBe(SEL_TRANSFER);
    expect(selectorChipLabel(SEL_TRANSFER, { unavailable: true })).toBe(SEL_TRANSFER);
    // A candidate without parentheses renders verbatim.
    expect(
      selectorChipLabel(SEL_APPROVE, {
        kind: 'function',
        signatures: ['weird_signature'],
        source: 'openchain',
      }),
    ).toBe('weird_signature');
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
    const values = { from: VALID_FROM, to: VALID_TO, min: '7', max: '', method: SEL_TRANSFER };
    const { rerender } = renderBar({ open: true, values });

    expect(screen.getByTestId('tx-filter-from')).toHaveValue(VALID_FROM);
    expect(screen.getByTestId('tx-filter-min')).toHaveValue('7');
    expect(screen.getByTestId('tx-filter-method')).toHaveValue(SEL_TRANSFER);

    // Back/forward to a different filter set re-seeds the draft.
    rerender({
      values: { from: '', to: VALID_FROM, min: '', max: '9', method: '' },
      urlParamCount: 2,
    });
    expect(screen.getByTestId('tx-filter-from')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-max')).toHaveValue('9');
    expect(screen.getByTestId('tx-filter-method')).toHaveValue('');
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

  it('an invalid method draft renders a field error and Apply never fires onApply', () => {
    const { onApply } = renderBar({ open: true });

    typeInto('tx-filter-method', 'not-a-selector');
    expect(screen.getByTestId('tx-filter-method-error')).toHaveTextContent(/selector/i);
    expect(screen.getByTestId('tx-filter-apply')).toBeDisabled();
    // The helper hint is replaced by the error, and vice versa on fix.
    expect(screen.queryByText('4-byte selector, e.g. 0xa9059cbb')).not.toBeInTheDocument();

    typeInto('tx-filter-method', SEL_TRANSFER);
    expect(screen.queryByTestId('tx-filter-method-error')).not.toBeInTheDocument();
    expect(screen.getByText('4-byte selector, e.g. 0xa9059cbb')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('tx-filter-apply'));
    expect(onApply).toHaveBeenCalledWith({
      ...EMPTY_VALUES,
      method: SEL_TRANSFER,
    });
  });

  it('renders one chip per distinct loaded-row selector, labeled by the decode and titled with the raw selector', () => {
    mockUseSignaturesBatched.mockImplementation(() => ({
      [SEL_TRANSFER]: {
        kind: 'function',
        signatures: ['transfer(address,uint256)'],
        source: 'openchain',
      } satisfies SignatureOutcome,
      // SEL_APPROVE stays unresolved (pending) — its raw selector is
      // the label.
    }));

    renderBar({ open: true, selectorOptions: [SEL_TRANSFER, SEL_APPROVE] });

    const chips = screen.getByTestId('tx-filter-method-chips');
    expect(screen.getByTestId(`tx-filter-method-chip-${SEL_TRANSFER}`)).toHaveTextContent(
      'transfer',
    );
    expect(screen.getByTestId(`tx-filter-method-chip-${SEL_APPROVE}`)).toHaveTextContent(
      SEL_APPROVE,
    );
    // Raw selector as the title on every chip, resolved or not.
    expect(screen.getByTestId(`tx-filter-method-chip-${SEL_TRANSFER}`)).toHaveAttribute(
      'title',
      SEL_TRANSFER,
    );
    expect(screen.getByTestId(`tx-filter-method-chip-${SEL_APPROVE}`)).toHaveAttribute(
      'title',
      SEL_APPROVE,
    );
    expect(chips).toBeInTheDocument();
  });

  it('renders no chip row when the loaded rows offer no selectors', () => {
    const first = renderBar({ open: true, selectorOptions: [] });
    expect(screen.queryByTestId('tx-filter-method-chips')).not.toBeInTheDocument();
    first.unmount();

    // And none when the prop is absent (no page data yet).
    renderBar({ open: true });
    expect(screen.queryByTestId('tx-filter-method-chips')).not.toBeInTheDocument();
  });

  it('clicking a chip fills the Method field with that selector', () => {
    mockUseSignaturesBatched.mockImplementation(() => ({}));
    renderBar({ open: true, selectorOptions: [SEL_TRANSFER] });

    fireEvent.click(screen.getByTestId(`tx-filter-method-chip-${SEL_TRANSFER}`));
    expect(screen.getByTestId('tx-filter-method')).toHaveValue(SEL_TRANSFER);
  });

  it('a fully valid draft applies with the exact field values', () => {
    const { onApply } = renderBar({ open: true });

    typeInto('tx-filter-from', VALID_FROM);
    typeInto('tx-filter-to', VALID_TO);
    typeInto('tx-filter-min', '0');
    typeInto('tx-filter-max', '1000000000000000000000');
    typeInto('tx-filter-method', SEL_TRANSFER);
    fireEvent.click(screen.getByTestId('tx-filter-apply'));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith({
      from: VALID_FROM,
      to: VALID_TO,
      min: '0',
      max: '1000000000000000000000',
      method: SEL_TRANSFER,
    });
  });

  it('empty fields are valid — applying an all-empty draft is a clear-by-apply', () => {
    const { onApply } = renderBar({
      open: true,
      values: { from: VALID_FROM, to: '', min: '', max: '', method: '' },
    });

    // Wipe the seeded from value: still valid (absent), Apply fires.
    typeInto('tx-filter-from', '');
    fireEvent.click(screen.getByTestId('tx-filter-apply'));

    expect(onApply).toHaveBeenCalledWith(EMPTY_VALUES);
  });

  it('Clear resets the draft fields and fires onClear', () => {
    const { onClear } = renderBar({
      open: true,
      values: { from: VALID_FROM, to: VALID_TO, min: '7', max: '9', method: SEL_APPROVE },
    });

    fireEvent.click(screen.getByTestId('tx-filter-clear'));

    expect(onClear).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tx-filter-from')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-to')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-min')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-max')).toHaveValue('');
    expect(screen.getByTestId('tx-filter-method')).toHaveValue('');
  });
});
