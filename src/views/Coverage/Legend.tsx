import { css } from '@linaria/core';
import { PageContainer, PageHeader } from '@/components/ui/PageLayout';
import { Card, CardContent, CardTitle } from '@/components/ui/Card';
import {
  COVERAGE_GLYPHS,
  COVERAGE_WORDS,
  type CoverageLevel,
} from '@/components/ui/CoverageBadge';

// Static explainer for the data-coverage vocabulary: one section per
// CoverageBadge level, plus the honest comparison with full-indexer
// explorers. Pure copy — no data fetching, no loader, no chain scope (the
// levels describe data sourcing, which is the same on every chain).

// One row per level: the sentence that defines it and a concrete place
// this app actually uses it. The glyph is the SAME svg the CoverageBadge
// chip renders (shared export), so the legend and the chips cannot drift.
type LevelLegend = {
  readonly level: CoverageLevel;
  readonly definition: string;
  readonly example: string;
};

const LEVELS: readonly LevelLegend[] = [
  {
    level: 'live',
    definition: 'Read from the node at the moment the page was opened.',
    example:
      'The balance and nonce on an address page come from a live RPC call, so they match the chain head, not an index.',
  },
  {
    level: 'cached-immutable',
    definition:
      'Stored in this explorer’s database because it cannot change after it is written.',
    example:
      'Verified contract source and ABI: once verified, the bytes are permanent, so the stored copy is authoritative.',
  },
  {
    level: 'discovered',
    definition:
      'Found by scanning, so the list is complete only within the range actually walked.',
    example:
      'Token holdings on an address page come from a windowed scan of transfer events; transfers outside the window are not counted.',
  },
  {
    level: 'sampled',
    definition:
      'Measured at intervals instead of at every point, so values between samples are approximations.',
    example:
      'The daily charts sample block headers over time; a day on a chart is computed from samples, not from every block.',
  },
  {
    level: 'partial',
    definition:
      'Some of the expected data is present and some is not, usually because a scan was capped or is still running.',
    example:
      'Transaction history for an address is partial while the explorer is still walking blocks toward the chain head.',
  },
  {
    level: 'unavailable',
    definition:
      'The source could not be read at all — the endpoint does not expose it, or the request failed.',
    example:
      'The pending-pool page reads unavailable when a public RPC keeps its txpool endpoint private.',
  },
];

// Chip word with a leading capital for the term column ("cached" → "Cached").
const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

const sectionCardStyle = css`
  margin-bottom: var(--haze-space-6);
`;

const introStyle = css`
  margin: 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);
`;

const levelListStyle = css`
  list-style: none;
  margin: var(--haze-space-5) 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--haze-space-5);
`;

const levelItemStyle = css`
  display: grid;
  grid-template-columns: 130px minmax(0, 1fr);
  gap: var(--haze-space-3);
  align-items: start;

  /* 375px-clean: the term stacks above its definition, the same single
     column the detail-page info grids collapse to. */
  @media (max-width: 768px) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--haze-space-1);
  }
`;

const levelTermStyle = css`
  display: inline-flex;
  align-items: center;
  gap: var(--haze-space-2);
  font-weight: var(--haze-weight-semibold);
  color: var(--haze-color-text);
`;

const glyphStyle = css`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  color: var(--haze-color-text-secondary);
`;

const definitionStyle = css`
  margin: 0;
  color: var(--haze-color-text);
  line-height: var(--haze-leading-relaxed);
`;

const exampleStyle = css`
  margin: var(--haze-space-1) 0 0;
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
  line-height: var(--haze-leading-relaxed);
`;

const paragraphStyle = css`
  margin: var(--haze-space-3) 0 0;
  color: var(--haze-color-text-secondary);
  line-height: var(--haze-leading-relaxed);

  &:first-of-type {
    margin-top: 0;
  }
`;

export default function CoverageLegend() {
  return (
    <PageContainer narrow>
      <PageHeader
        title="Data Coverage"
        chainInfo="What the coverage badges on this explorer mean"
      />

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">The six levels</CardTitle>
          <p className={introStyle}>
            Every data page carries a small badge summarizing how its numbers were
            obtained. The badge takes the worst level across that page&rsquo;s data
            sources, so a page never looks better than its weakest source.
          </p>
          <ul className={levelListStyle}>
            {LEVELS.map(({ level, definition, example }) => (
              <li key={level} className={levelItemStyle} data-level={level}>
                <div className={levelTermStyle}>
                  <span className={glyphStyle} aria-hidden="true">
                    {COVERAGE_GLYPHS[level]}
                  </span>
                  {capitalized(COVERAGE_WORDS[level])}
                </div>
                <div>
                  <p className={definitionStyle}>{definition}</p>
                  <p className={exampleStyle}>Example: {example}</p>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card className={sectionCardStyle}>
        <CardContent>
          <CardTitle as="h2">Why numbers may differ from Etherscan/Blockscout</CardTitle>
          <p className={paragraphStyle}>
            Full-indexer explorers such as Etherscan and Blockscout run an indexer
            that walks every block from genesis and stores every transaction and
            event. Their counts are exhaustive by construction.
          </p>
          <p className={paragraphStyle}>
            This explorer reads a node directly instead: balances and nonce are
            live, immutable data such as verified sources is cached, and histories
            come from windowed scans or samples. Every page labels what it
            actually walked rather than implying completeness.
          </p>
          <p className={paragraphStyle}>
            So a smaller number here usually means a smaller scan window or a
            coarser sample — not data missing from the chain. Check the page&rsquo;s
            coverage badge to see which case you are in.
          </p>
        </CardContent>
      </Card>
    </PageContainer>
  );
}
