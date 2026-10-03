// The Charts page drew its axis and its data in two different coordinate
// frames, so no value could be read off its own axis.
//
// DayChart draws the frame itself: gridlines span x ∈ [PLOT_LEFT,
// plotRight] and y ∈ [PLOT_TOP, plotBottom] where plotBottom =
// VIEW_HEIGHT - PLOT_BOTTOM (216 - 30 = 186), with three y gridlines and
// up to five x day ticks. But every data mark was produced by the pure
// helpers in chartSvg.ts, which only know about ONE symmetric pad:
//
//   buildLineSegments / linePoints / buildBars(…, VIEW_WIDTH, VIEW_HEIGHT, 8)
//
// so with pad = 8 they map into x ∈ [8, 632] and y ∈ [8, 208] — 38px to
// the left of the axis, 22px below it, and a bar row whose tops are
// measured against a baseline the gridlines never draw. The two-series fee
// card is worse: each line normalizes over its OWN extent inside those
// helpers while the shared gridlines use the extent of both series, so
// the lines disagree with each other as well.
//
// This is the same line/axis detachment class already fixed inside
// lineYScaler (its doc records that subtracting `top` twice squeezed the
// series off the gridlines; tests/unit/chartSvgGeometry.test.ts pins the
// pad-symmetric contract for the helpers). The view's asymmetric frame was
// never reconciled with it.
//
// The fix: the helpers take the real frame, so the axis and the marks are
// derived from one rectangle. A regression test that renders the real
// component is deliberately avoided here (the file's geometry assertions
// live at the helper level); what is pinned is that every mark the helpers
// produce for a known series lands ON the frame the axis is drawn in.
import { describe, it, expect } from 'vitest';

import {
  buildBars,
  buildLineSegments,
  expandExtent,
  linePoints,
  lineX,
  lineYScaler,
  seriesExtent,
} from '@/views/Charts/chartSvg';

// The frame exactly as src/views/Charts/index.tsx defines it.
const VIEW_WIDTH = 640;
const VIEW_HEIGHT = 216;
const PLOT_LEFT = 46;
const PLOT_RIGHT = 8;
const PLOT_TOP = 8;
const PLOT_BOTTOM = 30;
const PLOT_RIGHT_EDGE = VIEW_WIDTH - PLOT_RIGHT;
const PLOT_BOTTOM_EDGE = VIEW_HEIGHT - PLOT_BOTTOM;

const days = 10;
const series = [1, 4, 9, 16, 25, 36, 49, 64, 81, 100];

const parseSegment = (d: string): Array<[number, number]> =>
  d.split(' ')
    .filter(Boolean)
    .map(command => command.slice(1).split(',').map(Number) as [number, number]);

describe('chart marks live inside the frame the axis is drawn in', () => {
  it('draws every line point between the y gridlines, not below the frame', () => {
    const points = linePoints(series, {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      left: PLOT_LEFT,
      right: PLOT_RIGHT_EDGE,
      top: PLOT_TOP,
      bottom: PLOT_BOTTOM_EDGE,
    });

    for (const point of points) {
      expect(point.y).toBeGreaterThanOrEqual(PLOT_TOP);
      expect(point.y).toBeLessThanOrEqual(PLOT_BOTTOM_EDGE);
      expect(point.x).toBeGreaterThanOrEqual(PLOT_LEFT);
      expect(point.x).toBeLessThanOrEqual(PLOT_RIGHT_EDGE);
    }
  });

  it('puts a gridline y exactly where the series would plot that value', () => {
    // The view draws its three gridlines with its own transform over
    // [PLOT_TOP, plotBottom] and labels them with the extent's max, mid
    // and min. A mark for a value must therefore land on the same y — the
    // assertion is the value-for-value agreement the fix restores.
    const frame = {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      left: PLOT_LEFT,
      right: PLOT_RIGHT_EDGE,
      top: PLOT_TOP,
      bottom: PLOT_BOTTOM_EDGE,
    };
    const extent = expandExtent(seriesExtent([series])!);
    const viewGridlineY = (value: number): number => {
      const span = extent.max - extent.min;
      const normalized = span > 0 ? (value - extent.min) / span : 0.5;
      return PLOT_TOP + (1 - normalized) * (PLOT_BOTTOM_EDGE - PLOT_TOP);
    };
    const markY = lineYScaler(extent, frame.top, frame.bottom - frame.top);

    for (const tick of [extent.max, (extent.max + extent.min) / 2, extent.min]) {
      expect(markY(tick)).toBeCloseTo(viewGridlineY(tick), 6);
    }
    // The ends of the extent ARE the top and bottom gridlines.
    expect(markY(extent.max)).toBeCloseTo(PLOT_TOP, 6);
    expect(markY(extent.min)).toBeCloseTo(PLOT_BOTTOM_EDGE, 6);
  });

  it('spans the x axis exactly from the first day to the last', () => {
    const first = lineX(0, days, PLOT_LEFT, PLOT_RIGHT_EDGE);
    const last = lineX(days - 1, days, PLOT_LEFT, PLOT_RIGHT_EDGE);

    expect(first).toBeCloseTo(PLOT_LEFT, 6);
    expect(last).toBeCloseTo(PLOT_RIGHT_EDGE, 6);
  });

  it('keeps line segments inside the same frame as the point markers', () => {
    const frame = {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      left: PLOT_LEFT,
      right: PLOT_RIGHT_EDGE,
      top: PLOT_TOP,
      bottom: PLOT_BOTTOM_EDGE,
    };
    const segments = buildLineSegments(series, frame);
    const points = linePoints(series, frame);

    expect(segments).toHaveLength(1);
    const segmentPoints = parseSegment(segments[0]);
    expect(segmentPoints).toHaveLength(days);
    for (let i = 0; i < days; i += 1) {
      // Segment coordinates are serialized with two decimals.
      expect(segmentPoints[i][0]).toBeCloseTo(points[i].x, 2);
      expect(segmentPoints[i][1]).toBeCloseTo(points[i].y, 2);
    }
  });

  it('anchors bars on the zero baseline at the frame bottom', () => {
    const bars = buildBars([0, 50, 100], {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      left: PLOT_LEFT,
      right: PLOT_RIGHT_EDGE,
      top: PLOT_TOP,
      bottom: PLOT_BOTTOM_EDGE,
    });

    // The zero bar sits on the baseline the gridlines share…
    expect(bars[0]!.y + bars[0]!.h).toBeCloseTo(PLOT_BOTTOM_EDGE, 6);
    // …the tallest bar reaches the top gridline…
    expect(bars[2]!.y).toBeCloseTo(PLOT_TOP, 6);
    // …and no bar spills into the y-label column.
    for (const bar of bars) {
      expect(bar).not.toBeNull();
      expect(bar!.x).toBeGreaterThanOrEqual(PLOT_LEFT);
      expect(bar!.x + bar!.w).toBeLessThanOrEqual(PLOT_RIGHT_EDGE);
    }
  });

  it('keeps a gap empty in bars and breaks the line there', () => {
    const gapped = [10, null, 30];
    const frame = {
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      left: PLOT_LEFT,
      right: PLOT_RIGHT_EDGE,
      top: PLOT_TOP,
      bottom: PLOT_BOTTOM_EDGE,
    };

    expect(buildBars(gapped, frame)[1]).toBeNull();
    expect(buildLineSegments(gapped, frame)).toHaveLength(0);
    expect(linePoints(gapped, frame)).toHaveLength(2);
  });
});
