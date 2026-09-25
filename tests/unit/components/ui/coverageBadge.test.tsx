// CoverageBadge unit tests: the pure aggregation contract (worstCoverage
// severity ordering, aggregateCoverage label/detail composition) and the
// chip's rendering contract — one visually distinct rendering per level
// (icon + label, never color alone), the ⓘ disclosure toggling the
// per-source detail list, and the legend link that lives ONLY inside the
// expanded detail (the collapsed chip DOM stays byte-identical).
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, createRoutes } from '@native-router/react';
import type { ReactElement } from 'react';
import '@testing-library/jest-dom/vitest';
import {
  CoverageBadge,
  aggregateCoverage,
  worstCoverage,
  type CoverageLevel,
} from '@/components/ui/CoverageBadge';

const ALL_LEVELS: CoverageLevel[] = [
  'live',
  'cached-immutable',
  'discovered',
  'sampled',
  'partial',
  'unavailable',
];

// The expanded detail renders a TypedLink to the coverage legend, which
// needs router context (useRouter throws bare) — badge tests that expand
// the detail mount through this harness. The stub route keeps the link's
// target resolvable.
const LegendStub = () => <span data-testid="legend-stub" />;

const renderWithRouter = (ui: ReactElement) =>
  render(
    <MemoryRouter routes={createRoutes([{ path: '/about/coverage', component: () => LegendStub }])}>
      {ui}
    </MemoryRouter>,
  );

describe('worstCoverage', () => {
  it('is reflexive (a level never loses to itself)', () => {
    for (const level of ALL_LEVELS) {
      expect(worstCoverage(level, level)).toBe(level);
    }
  });

  it('returns the more severe operand for every ordered pair', () => {
    // unavailable > partial > sampled > discovered > cached-immutable > live
    const ordered = [...ALL_LEVELS].reverse(); // [unavailable, partial, sampled, discovered, cached-immutable, live]
    for (let i = 0; i < ordered.length; i++) {
      for (let j = i + 1; j < ordered.length; j++) {
        const severe = ordered[i];
        const benign = ordered[j];
        expect(worstCoverage(severe, benign)).toBe(severe);
        expect(worstCoverage(benign, severe)).toBe(severe);
      }
    }
  });

  it('folds a source list down to its single worst level', () => {
    const fold = (levels: CoverageLevel[]) =>
      levels.reduce(worstCoverage, 'live' as CoverageLevel);
    expect(fold(['live', 'cached-immutable', 'live'])).toBe('cached-immutable');
    expect(fold(['discovered', 'partial', 'unavailable'])).toBe('unavailable');
    expect(fold(['sampled', 'discovered'])).toBe('sampled');
  });
});

describe('aggregateCoverage', () => {
  it('takes the worst level across sources and keeps every detail line in order', () => {
    const summary = aggregateCoverage([
      { level: 'live', detail: 'Balance & nonce: read live' },
      { level: 'discovered', detail: 'Token transfers: scanned' },
      { level: 'partial', detail: 'Transaction history: partial' },
      { level: 'cached-immutable', detail: 'Labels: stored' },
    ]);

    expect(summary.level).toBe('partial');
    expect(summary.label).toBe('Data coverage: partial');
    expect(summary.detail).toEqual([
      'Balance & nonce: read live',
      'Token transfers: scanned',
      'Transaction history: partial',
      'Labels: stored',
    ]);
  });

  it('composes the label word for every level', () => {
    const cases: Array<[CoverageLevel, string]> = [
      ['live', 'Data coverage: live'],
      ['cached-immutable', 'Data coverage: cached'],
      ['discovered', 'Data coverage: discovered'],
      ['sampled', 'Data coverage: sampled'],
      ['partial', 'Data coverage: partial'],
      ['unavailable', 'Data coverage: unavailable'],
    ];
    for (const [level, label] of cases) {
      expect(aggregateCoverage([{ level, detail: 'x' }]).label).toBe(label);
    }
  });

  it('renders an empty source list as unavailable — nothing is promised', () => {
    expect(aggregateCoverage([])).toEqual({
      level: 'unavailable',
      label: 'Data coverage: unavailable',
      detail: [],
    });
  });
});

describe('CoverageBadge rendering', () => {
  it('renders every level with its label text and a distinct marker attribute', () => {
    for (const level of ALL_LEVELS) {
      const { unmount } = render(
        <CoverageBadge level={level} label={`Data coverage: ${level}`} />,
      );
      const badge = screen.getByTestId('coverage-badge');
      // The level rides on the DOM so styling/tests can branch on it.
      expect(badge).toHaveAttribute('data-level', level);
      // Never color alone: the label word is always rendered as text.
      expect(screen.getByText(`Data coverage: ${level}`)).toBeInTheDocument();
      // Every level carries its distinguishing icon (an inline svg).
      expect(badge.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      unmount();
    }
  });

  it('renders no info affordance when detail is absent or empty', () => {
    const { unmount } = render(<CoverageBadge level="live" label="Data coverage: live" />);
    expect(screen.queryByTestId('coverage-badge-toggle')).not.toBeInTheDocument();
    unmount();

    render(
      <CoverageBadge level="live" label="Data coverage: live" detail={[]} />,
    );
    expect(screen.queryByTestId('coverage-badge-toggle')).not.toBeInTheDocument();
  });

  it('keeps the detail list collapsed until the ⓘ affordance opens it', () => {
    renderWithRouter(
      <CoverageBadge
        level="partial"
        label="Data coverage: partial"
        detail={['Transaction history: partial', 'Token transfers: not scanned yet']}
      />,
    );

    const toggle = screen.getByTestId('coverage-badge-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('coverage-badge-detail')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByTestId('coverage-badge-detail');
    expect(list).toHaveTextContent('Transaction history: partial');
    expect(list).toHaveTextContent('Token transfers: not scanned yet');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('coverage-badge-detail')).not.toBeInTheDocument();
  });

  it('links the affordance to the detail list for assistive tech', () => {
    renderWithRouter(
      <CoverageBadge level="discovered" label="Data coverage: discovered" detail={['One line']} />,
    );
    const toggle = screen.getByTestId('coverage-badge-toggle');
    fireEvent.click(toggle);
    const list = screen.getByTestId('coverage-badge-detail');
    expect(toggle.getAttribute('aria-controls')).toBe(list.getAttribute('id'));
    expect(list.id).not.toBe('');
  });

  it('renders the legend link only inside the expanded detail', () => {
    renderWithRouter(
      <CoverageBadge level="live" label="Data coverage: live" detail={['Balance: live']} />,
    );

    // Collapsed: no link anywhere in the chip.
    expect(screen.queryByText('What do these levels mean?')).not.toBeInTheDocument();

    const toggle = screen.getByTestId('coverage-badge-toggle');
    fireEvent.click(toggle);
    const link = screen.getByRole('link', { name: 'What do these levels mean?' });
    expect(link).toHaveAttribute('href', '/about/coverage');

    // Collapsing again removes the link with the detail list.
    fireEvent.click(toggle);
    expect(
      screen.queryByRole('link', { name: 'What do these levels mean?' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the collapsed chip DOM byte-identical (no legend affordance leaks in)', () => {
    // The collapsed chip is pinned wholesale: any structural change to the
    // collapsed rendering — including the legend link creeping in — fails
    // here instead of silently growing the page chrome. Bare render is
    // enough: the detail (and with it the router-dependent link) stays
    // unmounted while collapsed. One exception: aria-controls carries a
    // useId value, which React seeds per root — it shifts with how many
    // roots rendered earlier in the file, so exactly that attribute value
    // is normalized; every other byte is pinned.
    render(
      <CoverageBadge level="partial" label="Data coverage: partial" detail={['One line']} />,
    );
    const collapsed = screen.getByTestId('coverage-badge').outerHTML;
    expect(collapsed).toMatch(/aria-controls="[^"]+"/);
    const pinned = collapsed.replace(/aria-controls="[^"]+"/, 'aria-controls="<useId>"');
    expect(pinned).toMatchInlineSnapshot(`"<div class="mocked-css-0" data-testid="coverage-badge" data-level="partial"><span class="mocked-css-1"><span data-slot="tag" class="haze-Tag__base haze-Tag__warning haze-Tag__sm mocked-css-2"><span class="mocked-css-3" aria-hidden="true"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill="none" stroke="currentColor" stroke-width="1.4"></circle><path d="M5 1a4 4 0 0 0 0 8Z" fill="currentColor"></path></svg></span>Data coverage: partial</span><button type="button" class="mocked-css-4" aria-expanded="false" aria-controls="<useId>" aria-label="Show data coverage details" title="What this coverage means, per data source" data-testid="coverage-badge-toggle">ⓘ</button></span></div>"`);
  });
});
