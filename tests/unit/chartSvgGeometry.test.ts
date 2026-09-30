// Vertical geometry of the Charts page's line series (src/views/Charts/
// chartSvg.ts) and the Token page's price sparkline, which shares it.
//
// lineYScaler(extent, top, height) documents itself as mapping values into
// [top, top + height] — higher value, smaller y. It instead computed
// `usable = height - top`, so the bottom of the range landed `top` pixels
// above the plot bottom: every caller passes height = boxHeight - 2*pad
// (the pad already removed on BOTH sides), so the series was squeezed into
// [pad, boxHeight-2*pad-pad] and the axis gridlines the page draws for the
// same extent (Charts/index.tsx yForTick, which spans the true plot box)
// did not line up with the plotted line. On the 96px Token price chart 8 of
// 88 plot pixels were wasted; on the 216px Charts line chart, 8 of 200.

import { describe, it, expect } from 'vitest';
import {
  buildLineSegments,
  linePoints,
  lineX,
  lineYScaler,
  seriesExtent,
  expandExtent,
  buildBars,
} from '@/views/Charts/chartSvg';

const WIDTH = 320;
const HEIGHT = 96;
const PAD = 8;

describe('lineYScaler', () => {
  const extent = { min: 0, max: 100 };

  it('maps the extent maximum onto the top edge and the minimum onto the bottom edge', () => {
    const y = lineYScaler(extent, PAD, HEIGHT - 2 * PAD);
    expect(y(extent.max)).toBe(PAD);
    expect(y(extent.min)).toBe(PAD + (HEIGHT - 2 * PAD));
  });

  it('spans exactly the box the caller describes, not box-minus-top', () => {
    const plotHeight = HEIGHT - 2 * PAD;
    const y = lineYScaler(extent, PAD, plotHeight);
    // The midpoint must sit at the middle of the plot box.
    expect(y(50)).toBeCloseTo(PAD + plotHeight / 2, 10);
  });

  it('clamps out-of-range values into the box', () => {
    const plotHeight = HEIGHT - 2 * PAD;
    const y = lineYScaler(extent, PAD, plotHeight);
    expect(y(1e9)).toBe(PAD);
    expect(y(-1e9)).toBe(PAD + plotHeight);
  });

  it('renders a flat series as the vertical center of the box', () => {
    const plotHeight = HEIGHT - 2 * PAD;
    const y = lineYScaler({ min: 5, max: 5 }, PAD, plotHeight);
    expect(y(5)).toBeCloseTo(PAD + plotHeight / 2, 10);
  });
});

describe('line chart geometry agrees with the page axis', () => {
  // Charts/index.tsx draws the axis gridlines with its own transform over
  // the full plot box. The plotted line must land on the same y for the
  // same value, otherwise the line visibly detaches from its own axis.
  const yForTick = (value: number, min: number, max: number, plotTop: number, plotBottom: number) => {
    const span = max - min;
    const normalized = span > 0 ? (value - min) / span : 0.5;
    return plotTop + (1 - normalized) * (plotBottom - plotTop);
  };

  it('places plotted points exactly on the gridline for the same value', () => {
    const values = [10, 40, 25, 90, 60, 5];
    const points = linePoints(values, WIDTH, HEIGHT, PAD);
    const extent = expandExtent(seriesExtent([values])!);
    const plotTop = PAD;
    const plotBottom = HEIGHT - PAD;

    for (const [index, value] of values.entries()) {
      expect(points[index].y).toBeCloseTo(yForTick(value, extent.min, extent.max, plotTop, plotBottom), 10);
    }
  });

  it('keeps every plotted point inside the padded plot box', () => {
    const values = [1, 2, 3, 500, 7];
    const points = linePoints(values, WIDTH, HEIGHT, PAD);
    for (const point of points) {
      expect(point.y).toBeGreaterThanOrEqual(PAD);
      expect(point.y).toBeLessThanOrEqual(HEIGHT - PAD);
    }
  });

  it('emits segments whose y coordinates match the markers for the same values', () => {
    const values = [3, 1, 4, 1, 5];
    const segments = buildLineSegments(values, WIDTH, HEIGHT, PAD);
    const points = linePoints(values, WIDTH, HEIGHT, PAD);
    expect(segments).toHaveLength(1);
    // 'M…L…' — one command per value, in the same order as the markers.
    const commands = segments[0].split(' ');
    expect(commands).toHaveLength(values.length);
    for (const [index, command] of commands.entries()) {
      const y = Number(command.slice(command.indexOf(',') + 1));
      expect(y).toBeCloseTo(points[index].y, 2);
    }
  });

  it('spans the full padded width (x and y use symmetric padding)', () => {
    const values = [1, 2, 3];
    const points = linePoints(values, WIDTH, HEIGHT, PAD);
    expect(points[0].x).toBe(lineX(0, values.length, PAD, WIDTH - PAD));
    expect(points[values.length - 1].x).toBe(lineX(values.length - 1, values.length, PAD, WIDTH - PAD));
  });
});

describe('bar chart geometry is unaffected by the line scaler fix', () => {
  it('still anchors bars to the bottom of the plot box', () => {
    const bars = buildBars([0, 50, 100], WIDTH, HEIGHT, PAD);
    const plotHeight = HEIGHT - 2 * PAD;
    const tallest = bars[2]!;
    expect(tallest.h).toBeCloseTo(plotHeight, 10);
    expect(tallest.y).toBeCloseTo(PAD, 10);
  });

  it('keeps a null day as an empty slot', () => {
    const bars = buildBars([1, null, 3], WIDTH, HEIGHT, PAD);
    expect(bars[1]).toBeNull();
    expect(bars[0]).not.toBeNull();
    expect(bars[2]).not.toBeNull();
  });
});
