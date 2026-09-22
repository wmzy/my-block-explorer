// USD amount renderer with built-in provenance and honesty gating.
// Every fiat figure on the four USD surfaces renders through this
// component: it renders NOTHING when the backing price snapshot is
// unavailable (never-fetched, settled-null) or older than 10 minutes,
// so an external price outage degrades to zero DOM diff. The tooltip
// names the source and freshness; formatting is Intl-based with compact
// notation from $1M up.
import { css } from '@linaria/core';

import type { UsdPriceSnapshot } from '@/services/prices';

// A snapshot older than 10 minutes is treated as unavailable — stale
// money is worse than no money.
const MAX_PRICE_AGE_MS = 10 * 60 * 1000;

// Secondary text: USD figures ride alongside primary values, never
// replace them.
const usdValueStyle = css`
  color: var(--haze-color-text-muted);
  font-size: var(--haze-text-sm);
`;

const standardUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Sub-cent amounts (a cheap-chain transfer at $0.003) would render as
// "$0.00" — numerically honest but information-free. Below one cent the
// formatter widens to four decimals so the figure stays readable.
const subCentUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const compactUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  // Currency style defaults minimumFractionDigits to 2 — pin it to 0 so
  // compact figures drop trailing zeros ("$2.5M", "$1M").
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** "$1,234.56"; sub-cent widens to 4 decimals ("$0.0032"); compact ("$2.5M") from $1M up. */
export function formatUsd(usd: number): string {
  if (usd >= 1_000_000) return compactUsd.format(usd);
  if (usd > 0 && usd < 0.01) return subCentUsd.format(usd);
  return standardUsd.format(usd);
}

const ageText = (ageMs: number): string => {
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  if (ageMs < 60 * 60_000) return `${Math.floor(ageMs / 60_000)}min ago`;
  return `${Math.floor(ageMs / 3_600_000)}h ago`;
};

/**
 * Render one USD figure. `price` is the snapshot backing the amount
 * (pass the hook result straight through): null/undefined (lookup
 * unavailable or still settling) and non-finite amounts render nothing.
 */
export function UsdValue({
  usd,
  price,
}: {
  usd: number;
  price: UsdPriceSnapshot | null | undefined;
}) {
  if (price === null || price === undefined) return null;

  const age = Date.now() - price.fetchedAt;
  if (!Number.isFinite(age) || age < 0 || age > MAX_PRICE_AGE_MS) return null;
  if (!Number.isFinite(usd)) return null;

  return (
    <span
      className={usdValueStyle}
      title={`Price via DefiLlama · updated ${ageText(age)}`}
    >
      {formatUsd(usd)}
    </span>
  );
}
