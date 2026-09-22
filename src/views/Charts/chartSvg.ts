// Pure SVG geometry for the Charts page: everything here maps a
// gap-preserving day series into viewBox coordinates with ZERO data
// knowledge — no fetching, no formatting policy, no React. Gaps are the
// core contract: a null day breaks a line into separate segments and
// leaves a bar slot empty; nothing is ever interpolated across a gap or
// filled with zero.

/** One value per grid day; null marks a day the series could not resolve. */
export type GappedSeries = ReadonlyArray<number | null>;

/**
 * Min/max over every non-null value of the given series sets, or null
 * when no set carries a single value.
 */
export function seriesExtent(
  series: readonly GappedSeries[],
): { min: number; max: number } | null {
  let min: number | null = null;
  let max: number | null = null;
  for (const set of series) {
    for (const value of set) {
      if (value === null) continue;
      if (min === null || value < min) min = value;
      if (max === null || value > max) max = value;
    }
  }
  return min === null || max === null ? null : { min, max };
}

/**
 * Expand an extent by `fraction` of its span on both sides (a flat or
 * single-value extent stays untouched — the caller renders a mid-line).
 */
export function expandExtent(
  extent: { min: number; max: number },
  fraction = 0.05,
): { min: number; max: number } {
  const span = extent.max - extent.min;
  if (span <= 0) return extent;
  const pad = span * fraction;
  return { min: extent.min - pad, max: extent.max + pad };
}

/**
 * y-scaling for line charts: values normalized into [top, top + height]
 * (higher value → smaller y), clamped to the box. A flat extent maps to
 * the vertical center, mirroring the gas sparkline's flat-series rule.
 */
export function lineYScaler(
  extent: { min: number; max: number },
  top: number,
  height: number,
): (value: number) => number {
  const span = extent.max - extent.min;
  const usable = height - top;
  return value => {
    const normalized = span > 0 ? (value - extent.min) / span : 0.5;
    const y = top + (1 - normalized) * usable;
    return Math.min(top + height, Math.max(top, y));
  };
}

/** x position of day `index` on a line chart spanning [left, right]. */
export function lineX(index: number, count: number, left: number, right: number): number {
  const denominator = Math.max(1, count - 1);
  return left + (index / denominator) * (right - left);
}

/**
 * Contiguous line segments (SVG path strings) for a gapped series: a run
 * of non-null days becomes one 'M…L…' path; null breaks the run. Runs of
 * a single day emit no segment (the caller's point markers carry it).
 */
export function buildLineSegments(
  series: GappedSeries,
  width: number,
  height: number,
  pad = 8,
): string[] {
  const extent = expandExtent(seriesExtent([series]) ?? { min: 0, max: 1 });
  const y = lineYScaler(extent, pad, height - 2 * pad);
  const segments: string[] = [];
  let current: string[] = [];
  series.forEach((value, index) => {
    if (value === null) {
      if (current.length >= 2) segments.push(current.join(' '));
      current = [];
      return;
    }
    const x = lineX(index, series.length, pad, width - pad).toFixed(2);
    current.push(`${current.length === 0 ? 'M' : 'L'}${x},${y(value).toFixed(2)}`);
  });
  if (current.length >= 2) segments.push(current.join(' '));
  return segments;
}

/** Marker positions for every non-null day (line charts draw these as dots). */
export function linePoints(
  series: GappedSeries,
  width: number,
  height: number,
  pad = 8,
): Array<{ x: number; y: number }> {
  const extent = expandExtent(seriesExtent([series]) ?? { min: 0, max: 1 });
  const y = lineYScaler(extent, pad, height - 2 * pad);
  const points: Array<{ x: number; y: number }> = [];
  series.forEach((value, index) => {
    if (value === null) return;
    points.push({ x: lineX(index, series.length, pad, width - pad), y: y(value) });
  });
  return points;
}

export type BarRect = { x: number; y: number; w: number; h: number };

/**
 * Bar geometry for a gapped series on a zero baseline: one rect per
 * non-null day (null days keep an empty slot — the gap), each at least
 * `minHeight` tall so a real near-zero value stays visible.
 */
export function buildBars(
  series: GappedSeries,
  width: number,
  height: number,
  pad = 8,
  gapRatio = 0.25,
  minHeight = 1,
): Array<BarRect | null> {
  const extent = seriesExtent([series]);
  const max = extent === null ? 1 : Math.max(extent.max, 0);
  const top = pad;
  const plotHeight = height - 2 * pad;
  const slot = (width - 2 * pad) / Math.max(1, series.length);
  const barWidth = Math.max(1, slot * (1 - gapRatio));
  return series.map((value, index) => {
    if (value === null) return null;
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const barHeight = Math.max(minHeight, plotHeight * ratio);
    return {
      x: pad + slot * index + (slot - barWidth) / 2,
      y: top + plotHeight - barHeight,
      w: barWidth,
      h: barHeight,
    };
  });
}

/**
 * Grid-day tick indexes spread over the series (first and last included):
 * at most `maxTicks`, evenly stepped. Always includes day 0 when there
 * is anything to label.
 */
export function dayTickPositions(dayCount: number, maxTicks = 5): number[] {
  if (dayCount <= 0) return [];
  if (dayCount <= maxTicks) return Array.from({ length: dayCount }, (_, i) => i);
  const step = Math.ceil((dayCount - 1) / (maxTicks - 1));
  const ticks: number[] = [];
  for (let index = 0; index < dayCount - 1; index += step) ticks.push(index);
  ticks.push(dayCount - 1);
  return ticks;
}

/** UTC 'Sep 15' label for a day start (charts bucket by UTC day). */
export function formatDayTick(dayStart: number): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(dayStart));
}
