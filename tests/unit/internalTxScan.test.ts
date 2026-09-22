// Internal-tx scan pure logic: tree→row flattening (value filter, address
// filter, root exclusion, depth/row bounds) and cross-tx aggregation
// (ordering determinism, per-tx failure/unsupported classification, the
// honest summary/scope labels). All fixtures are already-normalized
// callTracer trees (the shape utils/traceFormat produces).
import { describe, it, expect } from 'vitest';
import {
  aggregateInternalTxns,
  flattenInternalTxTree,
  internalTxSummary,
  isInternalTxRow,
  tracedScopeLabel,
  MAX_INTERNAL_TRACE_DEPTH,
  type InternalTxRow,
  type TraceTxOutcome,
} from '@/utils/internalTxScan';
import type { CallTraceNode } from '@/utils/traceFormat';

const VIEWED = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const SENDER = '0x1111111111111111111111111111111111111111';
const TARGET = '0x2222222222222222222222222222222222222222';
const OTHER = '0x3333333333333333333333333333333333333333';

const node = (partial: Partial<CallTraceNode> & { type: string }): CallTraceNode => ({
  from: SENDER,
  to: TARGET,
  value: null,
  gas: null,
  gasUsed: null,
  input: null,
  output: null,
  selector: null,
  error: null,
  revertReason: null,
  depth: 0,
  calls: [],
  ...partial,
});

const rowSummary = (rows: InternalTxRow[]) =>
  rows.map(
    row =>
      `${row.type}@${row.depth}:${
        row.to === VIEWED ? 'viewed' : row.to === OTHER ? 'other' : row.to ?? '?'
      }`,
  );

describe('isInternalTxRow', () => {
  it('keeps value-carrying frames regardless of participants', () => {
    expect(isInternalTxRow(node({ type: 'CALL', value: 1n }), VIEWED)).toBe(true);
  });

  it('keeps zero-value frames that send from or to the viewed address, case-insensitively', () => {
    expect(isInternalTxRow(node({ type: 'DELEGATECALL', from: VIEWED }), VIEWED)).toBe(true);
    expect(isInternalTxRow(node({ type: 'CALL', to: VIEWED.toUpperCase() }), VIEWED)).toBe(true);
  });

  it('drops zero-value frames unrelated to the address', () => {
    expect(
      isInternalTxRow(node({ type: 'STATICCALL', from: SENDER, to: OTHER }), VIEWED),
    ).toBe(false);
  });

  it('treats an explicit zero value as non-carrying (null is absence, 0n is a no-op)', () => {
    expect(isInternalTxRow(node({ type: 'CALL', value: 0n }), VIEWED)).toBe(false);
  });
});

describe('flattenInternalTxTree', () => {
  it('never emits the root frame — it is the external transaction the tx tab lists', () => {
    const root = node({
      type: 'CALL',
      from: VIEWED,
      to: TARGET,
      value: 10n ** 18n,
    });
    const { rows, truncated } = flattenInternalTxTree('0xtx', root, VIEWED);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('flattens matching descendants in DFS pre-order (execution order)', () => {
    const root = node({
      type: 'CALL',
      value: 10n ** 18n,
      calls: [
        node({
          type: 'CALL',
          from: TARGET,
          to: VIEWED,
          value: 5n * 10n ** 17n,
          depth: 1,
          calls: [
            node({ type: 'STATICCALL', from: VIEWED, to: OTHER, depth: 2 }),
          ],
        }),
        node({ type: 'DELEGATECALL', from: TARGET, to: OTHER, value: 1n, depth: 1 }),
      ],
    });
    const { rows } = flattenInternalTxTree('0xtx', root, VIEWED);
    // Depth-1 value transfer to the viewed address first, its zero-value
    // address-matched child second, the unrelated-but-value-carrying
    // delegatecall last — sibling order and parent-before-child preserved.
    expect(rowSummary(rows)).toEqual([
      'CALL@1:viewed',
      'STATICCALL@2:other',
      'DELEGATECALL@1:other',
    ]);
    expect(rows[0].value).toBe(5n * 10n ** 17n);
    expect(rows[0].txHash).toBe('0xtx');
  });

  it('descends through non-matching frames to nested matches', () => {
    const root = node({
      type: 'CALL',
      calls: [
        node({
          type: 'STATICCALL',
          from: TARGET,
          to: OTHER,
          depth: 1,
          calls: [node({ type: 'CALL', from: OTHER, to: VIEWED, value: 2n, depth: 2 })],
        }),
      ],
    });
    const { rows } = flattenInternalTxTree('0xtx', root, VIEWED);
    expect(rows).toHaveLength(1);
    expect(rows[0].depth).toBe(2);
  });

  it('keeps unreported from/to as honest nulls in rows', () => {
    const root = node({
      type: 'SELFDESTRUCT',
      calls: [node({ type: 'SELFDESTRUCT', from: null, to: null, value: 3n, depth: 1 })],
    });
    const { rows } = flattenInternalTxTree('0xtx', root, VIEWED);
    expect(rows[0].from).toBeNull();
    expect(rows[0].to).toBeNull();
    expect(rows[0].value).toBe(3n);
  });

  it('stops descending at the depth bound and flags the cut only when a subtree existed', () => {
    const deep = (depth: number): CallTraceNode =>
      node({
        type: 'CALL',
        from: TARGET,
        to: VIEWED,
        depth,
        calls: depth < 4 ? [deep(depth + 1)] : [],
      });
    const root = node({ type: 'CALL', calls: [deep(1)] });

    const cut = flattenInternalTxTree('0xtx', root, VIEWED, { maxDepth: 2 });
    expect(cut.rows.map(row => row.depth)).toEqual([1, 2]);
    expect(cut.truncated).toBe(true);

    const exact = flattenInternalTxTree('0xtx', root, VIEWED, { maxDepth: 4 });
    expect(exact.rows.map(row => row.depth)).toEqual([1, 2, 3, 4]);
    expect(exact.truncated).toBe(false);
  });

  it('caps rows per tx and flags the truncation', () => {
    const root = node({
      type: 'CALL',
      calls: [
        node({ type: 'CALL', from: TARGET, to: VIEWED, depth: 1 }),
        node({ type: 'CALL', from: TARGET, to: VIEWED, depth: 1 }),
        node({ type: 'CALL', from: TARGET, to: VIEWED, depth: 1 }),
      ],
    });
    const { rows, truncated } = flattenInternalTxTree('0xtx', root, VIEWED, {
      maxRowsPerTx: 2,
    });
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it('exposes the shipped default depth bound (a UI contract, not an accident)', () => {
    expect(MAX_INTERNAL_TRACE_DEPTH).toBe(128);
  });
});

describe('aggregateInternalTxns', () => {
  const traced = (
    hash: string,
    rows: InternalTxRow[],
    truncated = false,
  ): TraceTxOutcome => ({ hash, status: 'traced', rows, truncated });

  it('concatenates rows in discovered-tx order, not completion order', () => {
    const rowA: InternalTxRow = {
      txHash: '0xa',
      from: SENDER,
      to: VIEWED,
      value: 1n,
      depth: 1,
      type: 'CALL',
    };
    const rowB: InternalTxRow = {
      txHash: '0xb',
      from: TARGET,
      to: OTHER,
      value: 2n,
      depth: 1,
      type: 'CALL',
    };
    const aggregate = aggregateInternalTxns([
      traced('0xa', [rowA]),
      { hash: '0xerr', status: 'failed', message: 'boom' },
      traced('0xb', [rowB]),
    ]);
    expect(aggregate.rows.map(row => row.txHash)).toEqual(['0xa', '0xb']);
    expect(aggregate.tracedCount).toBe(2);
    expect(aggregate.failedTxs).toEqual([
      { hash: '0xerr', message: 'boom', unsupported: false },
    ]);
    expect(aggregate.unsupported).toBe(false);
  });

  it('marks the whole scan unsupported only when nothing traced', () => {
    const allUnsupported = aggregateInternalTxns([
      { hash: '0xa', status: 'unsupported', message: 'method not found' },
      { hash: '0xb', status: 'unsupported', message: 'method not found' },
    ]);
    expect(allUnsupported.unsupported).toBe(true);
    expect(allUnsupported.tracedCount).toBe(0);
    expect(allUnsupported.failedTxs.every(failure => failure.unsupported)).toBe(true);
  });

  it('records a lone unsupported attempt per-tx when other traces settled', () => {
    const aggregate = aggregateInternalTxns([
      traced('0xa', []),
      { hash: '0xb', status: 'unsupported', message: 'nope' },
    ]);
    expect(aggregate.unsupported).toBe(false);
    expect(aggregate.tracedCount).toBe(1);
    expect(aggregate.failedTxs[0].unsupported).toBe(true);
  });

  it('flags truncation from any per-tx cut or the total row cap', () => {
    const row: InternalTxRow = {
      txHash: '0xa',
      from: SENDER,
      to: VIEWED,
      value: 1n,
      depth: 1,
      type: 'CALL',
    };
    expect(aggregateInternalTxns([traced('0xa', [row], true)]).truncated).toBe(true);

    const many = Array.from({ length: 5 }, (_, i) => traced(`0x${i}`, [{ ...row, txHash: `0x${i}` }]));
    expect(aggregateInternalTxns(many, { maxTotalRows: 3 }).rows).toHaveLength(3);
    expect(aggregateInternalTxns(many, { maxTotalRows: 3 }).truncated).toBe(true);
  });
});

describe('labels', () => {
  it('internalTxSummary pluralizes both counts and never invents totals', () => {
    const aggregate = aggregateInternalTxns([
      {
        hash: '0xa',
        status: 'traced',
        rows: [
          {
            txHash: '0xa',
            from: SENDER,
            to: VIEWED,
            value: 1n,
            depth: 1,
            type: 'CALL',
          },
        ],
        truncated: false,
      },
    ]);
    expect(internalTxSummary(aggregate)).toBe(
      '1 internal transfer across 1 traced transaction',
    );
    expect(
      internalTxSummary(aggregateInternalTxns([])),
    ).toBe('0 internal transfers across 0 traced transactions');
  });

  it('tracedScopeLabel reads "first N" only on page 1; deeper pages name the page', () => {
    expect(tracedScopeLabel(10, 1)).toBe('Traced the first 10 discovered transactions');
    expect(tracedScopeLabel(10, 3)).toBe(
      'Traced 10 discovered transactions (page 3 of the discovered set)',
    );
  });
});
