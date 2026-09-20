// Responsive degradation pins (G1): linaria is zero-runtime, so jsdom sees
// class names but never applies CSS — real 375px viewport verification is
// the browser-smoke pass owned by the integration round. What these tests
// pin is that the degradation rules exist in the stylesheets at all: each
// wide surface must keep its scroll/wrap/stack rule, so a refactor cannot
// silently drop mobile usability back to clipped tables and crushed rows.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { DataTable } from '@/components/ui/DataTable';

const src = (relPath: string): string =>
  readFileSync(resolve(__dirname, '../..', relPath), 'utf8');

describe('DataTable horizontal scroll (mobile table degradation)', () => {
  it('keeps a scroller container around the table', () => {
    render(
      <DataTable>
        <thead>
          <tr>
            <th>Col</th>
          </tr>
        </thead>
      </DataTable>,
    );
    const table = screen.getByRole('table');
    // The container div (border + radius + now the horizontal scroller)
    // wraps the table directly.
    expect(table.parentElement).toBe(table.closest('div'));
    expect(table.parentElement?.className).not.toBe('');
  });

  it('styles the container as a touch horizontal scroller and the table with a content floor', () => {
    const styles = src('src/components/ui/DataTable.tsx');
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('-webkit-overflow-scrolling: touch');
    // The table must keep its natural width instead of squeezing columns.
    expect(styles).toContain('min-width: max-content');
  });
});

describe('narrow-screen stacking rules exist where wide layouts break', () => {
  it('Address/Tx/Block InfoGrid stacks label over value at 768px', () => {
    const styles = src('src/components/ui/InfoGrid.tsx');
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('flex-direction: column');
    expect(styles).toContain('text-align: left');
  });

  it('TopNavigation wraps its rows and gives the search its own full row', () => {
    const styles = src('src/components/TopNavigation.tsx');
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('flex-wrap: wrap');
    expect(styles).toContain('flex: 1 1 100%');
  });

  it('Contract page scrolls its tab strip and wraps its header address', () => {
    const styles = src('src/views/Contract/index.tsx');
    // tabsStyles: horizontal scroller for the five tabs; headerStyles:
    // breakable address chip.
    expect(styles).toContain('overflow-x: auto');
    expect(styles).toContain('word-break: break-all');
    expect(styles.match(/@media \(max-width: 768px\)/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('IndexingRangeManager stacks its rows and wraps its add form', () => {
    const styles = src('src/components/events/IndexingRangeManager.tsx');
    // headerStyles + rangeItemStyles + addFormStyles each carry one.
    expect(styles.match(/@media \(max-width: 768px\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(styles).toContain('flex-wrap: wrap');
    expect(styles).toContain('flex-direction: column');
  });

  it('Search form wraps its button under the input', () => {
    const styles = src('src/views/Search/index.tsx');
    expect(styles).toContain('@media (max-width: 768px)');
    expect(styles).toContain('flex: 1 1 100%');
  });

  it('Collapsible headers wrap instead of clipping long signatures', () => {
    const styles = src('src/components/ui/Collapsible.tsx');
    expect(styles).toContain('flex-wrap: wrap');
  });
});
