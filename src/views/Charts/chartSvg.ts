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
export function seriesExtent(series: readonly GappedSeries[]): { min: number; max: number } | null {
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
 *
 * `height` is the height of the plot box itself — callers pass
 * `boxHeight - 2 * pad` because the padding has already been removed from
 * BOTH sides. Subtracting `top` a second time squeezed every series into
 * [top, top + height - top], so the minimum never reached the plot bottom
 * and the line sat `pad` pixels above the gridlines the Charts page draws
 * for the very same extent.
 */
export function lineYScaler(
  extent: { min: number; max: number },
  top: number,
  height: number,
): (value: number) => number {
  const span = extent.max - extent.min;
  return value => {
    const normalized = span > 0 ? (value - extent.min) / span : 0.5;
    const y = top + (1 - normalized) * height;
    return Math.min(top + height, Math.max(top, y));
  };
}

/** x position of day `index` on a line chart spanning [left, right]. */
export function lineX(index: number, count: number, left: number, right: number): number {
  const denominator = Math.max(1, count - 1);
  return left + (index / denominator) * (right - left);
}

/**
 * The plot box a chart draws its axis in: the four edges of the rectangle
 * every mark is mapped onto.
 *
 * The helpers used to take a single symmetric `pad`, which made a chart's
 * axis frame and its data frame two different rectangles: the Charts page
 * reserves a left column for y tick labels (46px) and a bottom row for day
 * labels (30px), so its data sat 38px left of and 22px below the gridlines
 * drawn for the same extent. Callers that draw an axis MUST pass the same
 * edges they draw it in.
 */
export type ChartFrame = {
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

/** A frame that keeps the old symmetric `pad` on all four edges. */
export const frameWithPad = (width: number, height: number, pad = 8): ChartFrame => ({
  width,
  height,
  left: pad,
  right: width - pad,
  top: pad,
  bottom: height - pad,
});

/**
 * Contiguous line segments (SVG path strings) for a gapped series: a run
 * of non-null days becomes one 'M…L…' path; null breaks the run. Runs of
 * a single day emit no segment (the caller's point markers carry it).
 *
 * `extent` overrides the per-series normalization; a two-series card passes
 * the extent of BOTH series so its lines share one scale (each series
 * normalizing over its own range draws two incomparable lines against one
 * set of gridlines).
 */
export function buildLineSegments(
  series: GappedSeries,
  frame: ChartFrame,
  extent?: { min: number; max: number },
): string[] {
  const y = lineYScaler(extent ?? expandExtent(seriesExtent([series]) ?? { min: 0, max: 1 }), frame.top, frame.bottom - frame.top);
  const segments: string[] = [];
  let current: string[] = [];
  series.forEach((value, index) => {
    if (value === null) {
      if (current.length >= 2) segments.push(current.join(' '));
      current = [];
      return;
    }
    const x = lineX(index, series.length, frame.left, frame.right).toFixed(2);
    current.push(`${current.length === 0 ? 'M' : 'L'}${x},${y(value).toFixed(2)}`);
  });
  if (current.length >= 2) segments.push(current.join(' '));
  return segments;
}

/**
 * Marker positions for every non-null day (line charts draw these as
 * dots). Shares {@link buildLineSegments}' frame and optional shared
 * extent, so markers and paths always land on the same transform.
 */
export function linePoints(
  series: GappedSeries,
  frame: ChartFrame,
  extent?: { min: number; max: number },
): Array<{ x: number; y: number }> {
  const y = lineYScaler(extent ?? expandExtent(seriesExtent([series]) ?? { min: 0, max: 1 }), frame.top, frame.bottom - frame.top);
  const points: Array<{ x: number; y: number }> = [];
  series.forEach((value, index) => {
    if (value === null) return;
    points.push({ x: lineX(index, series.length, frame.left, frame.right), y: y(value) });
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
  frame: ChartFrame,
  gapRatio = 0.25,
  minHeight = 1,
): Array<BarRect | null> {
  const extent = seriesExtent([series]);
  const max = extent === null ? 1 : Math.max(extent.max, 0);
  const plotHeight = frame.bottom - frame.top;
  const slot = (frame.right - frame.left) / Math.max(1, series.length);
  const barWidth = Math.max(1, slot * (1 - gapRatio));
  return series.map((value, index) => {
    if (value === null) return null;
    const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
    const barHeight = Math.max(minHeight, plotHeight * ratio);
    return {
      x: frame.left + slot * index + (slot - barWidth) / 2,
      y: frame.bottom - barHeight,
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
