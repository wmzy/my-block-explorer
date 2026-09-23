// Pure day-grid mapping for the Token page's Price History card: lays
// the DefiLlama /chart points (shaped by services/prices — ascending,
// deduplicated, window-filtered) onto the Charts page's GappedSeries
// day grid so the chart renders through the SAME gap-preserving
// primitives (chartSvg). One value per UTC-day slot of the window; a
// day the API did not answer stays null — gaps are never interpolated
// or zero-filled (the Charts page series contract). Zero React/SVG
// knowledge, directly testable (the ./tokenMath pattern).

import type { GappedSeries } from '@/views/Charts/chartSvg';
import type { PricePoint } from '@/services/prices';

const SECONDS_PER_DAY = 86_400;

/**
 * Bucket ascending price points onto the window's UTC-day grid: index 0
 * is the day the window started (`startEpochSeconds` — the request's
 * `start` param), length is windowDays + 1 (start day through today).
 * The LAST point of a day wins (a day answered twice keeps the newer
 * observation); points outside the grid are dropped defensively — the
 * service layer already filtered pre-window ones.
 */
export function toDailyGappedSeries(
  points: readonly PricePoint[],
  startEpochSeconds: number,
  windowDays: number,
): GappedSeries {
  const firstDay = Math.floor(startEpochSeconds / SECONDS_PER_DAY);
  const values: Array<number | null> = Array.from(
    { length: windowDays + 1 },
    () => null,
  );
  for (const point of points) {
    const index = Math.floor(point.timestamp / SECONDS_PER_DAY) - firstDay;
    if (index < 0 || index >= values.length) continue;
    values[index] = point.price;
  }
  return values;
}
