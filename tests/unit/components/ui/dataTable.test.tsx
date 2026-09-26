// DataTable accessibility contract: the additive a11y pass pins that
// (1) every thead column header carries scope="col" unconditionally,
// while tbody cells are never rewritten; (2) caption / ariaLabel are
// opt-in — when absent the rendered markup is structurally identical to
// the pre-a11y table (no caption element, no aria-label attribute); and
// (3) the pager's buttons expose their visible text as their accessible
// name (the icon-only-button audit found nothing missing — this keeps it
// that way).
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { DataTable, Pagination } from '@/components/ui/DataTable';

const renderTable = (props: { caption?: string; ariaLabel?: string } = {}) =>
  render(
    <DataTable {...props}>
      <thead>
        <tr>
          <th>Txn Hash</th>
          <th className="method-column">Method</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>0xabc…def</td>
          <td>transfer</td>
        </tr>
      </tbody>
    </DataTable>,
  );

describe('DataTable scope="col"', () => {
  it('adds scope="col" to every thead th while preserving their classes and content', () => {
    const { container } = renderTable();
    const heads = [...container.querySelectorAll('thead th')];
    expect(heads).toHaveLength(2);
    for (const th of heads) {
      expect(th).toHaveAttribute('scope', 'col');
    }
    // The clone keeps everything else: text and the Method column's class.
    expect(heads[0]).toHaveTextContent('Txn Hash');
    expect(heads[1]).toHaveTextContent('Method');
    expect(heads[1]).toHaveClass('method-column');
  });

  it('never rewrites tbody cells (a row-header th there must keep its own attributes)', () => {
    const { container } = render(
      <DataTable>
        <thead>
          <tr>
            <th>Column</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th id="row-header">row label</th>
            <td>value</td>
          </tr>
        </tbody>
      </DataTable>,
    );
    const rowHeader = container.querySelector('tbody th');
    expect(rowHeader).not.toBeNull();
    expect(rowHeader).not.toHaveAttribute('scope');
  });
});

describe('DataTable caption / ariaLabel (opt-in)', () => {
  it('renders a visually-hidden caption as the table\'s first child when provided', () => {
    const { container } = renderTable({ caption: 'Transactions' });
    const table = container.querySelector('table');
    expect(table).not.toBeNull();
    const caption = table?.querySelector('caption');
    expect(caption).toHaveTextContent('Transactions');
    expect(caption).toHaveClass('sr-only');
    // <caption> must precede thead (its required position in the table).
    expect(table?.firstElementChild?.tagName).toBe('CAPTION');
  });

  it('labels the table via aria-label when provided', () => {
    const { container } = renderTable({ ariaLabel: 'Latest blocks' });
    expect(container.querySelector('table')).toHaveAttribute('aria-label', 'Latest blocks');
  });

  it('is structurally identical to the pre-a11y table when neither prop is set', () => {
    const { container } = renderTable();
    const table = container.querySelector('table');
    // No caption element, no aria-label attribute — the only additive
    // markup is the unconditional th scope pinned above.
    expect(table?.getAttribute('aria-label')).toBeNull();
    expect(table?.querySelector('caption')).toBeNull();
    // Structural pin: one wrapper div > table > [thead, tbody] in order.
    expect(container.firstElementChild?.tagName).toBe('DIV');
    const children = [...(table?.children ?? [])].map(el => el.tagName);
    expect(children).toEqual(['THEAD', 'TBODY']);
  });
});

describe('Pagination accessible names (icon-only-button audit)', () => {
  it('exposes visible text as the buttons\' accessible name, default and custom labels', () => {
    render(
      <Pagination
        page={2}
        hasPrev
        hasNext
        onPrev={() => undefined}
        onNext={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Prev' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('names custom-labeled pagers (the list views\' Newer/Older) by their visible text', () => {
    render(
      <Pagination
        page={2}
        hasPrev
        hasNext
        prevLabel="Newer"
        nextLabel="Older"
        onPrev={() => undefined}
        onNext={() => undefined}
      />,
    );
    expect(screen.getByRole('button', { name: 'Newer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Older' })).toBeInTheDocument();
  });
});
