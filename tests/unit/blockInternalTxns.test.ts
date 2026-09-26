// Block-level internal-tx derivation: tree→row flattening (root
// exclusion, every-depth>=1 inclusion, selector/error retention, depth
// and row bounds), block-payload tx-hash extraction, the 50-tx sweep
// scope (empty list → nothing to trace, no truncation claim), and
// cross-tx grouping (block order, per-tx failure/unsupported
// classification, the total-row cap, summary/truncation labels). All
// tree fixtures are already-normalized callTracer trees (the shape
// utils/traceFormat produces); block fixtures are raw
// eth_getBlockByHash payloads.
import { describe, it, expect } from 'vitest';
import {
  BLOCK_TRACE_CONCURRENCY,
  MAX_BLOCK_TRACED_TXS,
  MAX_BLOCK_TOTAL_ROWS,
  blockInternalTxnsSummary,
  blockTraceTruncationLabel,
  extractBlockTxHashes,
  flattenBlockInternalFrames,
  groupBlockInternalTxns,
  rowCarriesValue,
  selectBlockTraceScope,
  type BlockInternalTxRow,
  type BlockTraceTxOutcome,
} from '@/views/Blocks/internalTxns';
import { MAX_INTERNAL_TRACE_DEPTH, MAX_ROWS_PER_TX } from '@/utils/internalTxScan';
import type { CallTraceNode } from '@/utils/traceFormat';

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

const rowSummary = (rows: BlockInternalTxRow[]) =>
  rows.map(row => `${row.type}@${row.depth}:${row.to ?? '?'}`);

describe('flattenBlockInternalFrames', () => {
  it('never emits the root frame — it is the external transaction itself', () => {
    const root = node({ type: 'CALL', from: SENDER, to: TARGET, value: 10n ** 18n });
    const { rows, truncated } = flattenBlockInternalFrames('0xtx', root);
    expect(rows).toEqual([]);
    expect(truncated).toBe(false);
  });

  it('emits EVERY depth>=1 frame — the block page has no subject address, so the address tab\'s value/address noise filter does not apply', () => {
    const root = node({
      type: 'CALL',
      calls: [
        // Zero-value unrelated frames are real activity in a block sweep.
        node({ type: 'STATICCALL', from: TARGET, to: OTHER, depth: 1 }),
        node({
          type: 'CALL',
          from: TARGET,
          to: OTHER,
          value: 5n,
          depth: 1,
          calls: [node({ type: 'DELEGATECALL', from: OTHER, to: TARGET, depth: 2 })],
        }),
      ],
    });
    const { rows, truncated } = flattenBlockInternalFrames('0xtx', root);
    expect(rowSummary(rows)).toEqual([
      'STATICCALL@1:0x3333333333333333333333333333333333333333',
      'CALL@1:0x3333333333333333333333333333333333333333',
      'DELEGATECALL@2:0x2222222222222222222222222222222222222222',
    ]);
    expect(truncated).toBe(false);
    // DFS pre-order = execution order: parent before child, siblings in order.
    expect(rows.every(row => row.txHash === '0xtx')).toBe(true);
  });

  it('flattens in DFS pre-order (execution order)', () => {
    const root = node({
      type: 'CALL',
      calls: [
        node({ type: 'CALL', to: OTHER, depth: 1, calls: [node({ type: 'CALL', to: OTHER, depth: 2 })] }),
        node({ type: 'CALL', to: OTHER, depth: 1 }),
      ],
    });
    const { rows } = flattenBlockInternalFrames('0xtx', root);
    expect(rows.map(row => row.depth)).toEqual([1, 2, 1]);
  });

  it('keeps the frame error text, with honest nulls when unreported', () => {
    const root = node({
      type: 'CALL',
      input: `0xa9059cbb${'00'.repeat(64)}`,
      calls: [
        node({
          type: 'DELEGATECALL',
          to: OTHER,
          input: '0x',
          error: 'execution reverted',
          revertReason: 'INSUFFICIENT_ALLOWANCE',
          from: null,
          depth: 1,
        }),
      ],
    });
    const { rows } = flattenBlockInternalFrames('0xtx', root);
    expect(rows[0].selector).toBeNull(); // "0x" calldata carries none
    expect(rows[0].error).toBe('execution reverted');
    expect(rows[0].revertReason).toBe('INSUFFICIENT_ALLOWANCE');
    expect(rows[0].from).toBeNull();
    expect(rows[0].value).toBeNull();
  });

  it('keeps the selector of calldata-carrying frames (fixtures are normalized trees: traceFormat derives it from input)', () => {
    const root = node({
      type: 'CALL',
      calls: [
        node({
          type: 'CALL',
          to: OTHER,
          input: `0x18160ddd${'00'.repeat(4)}`,
          selector: '0x18160ddd',
          depth: 1,
        }),
      ],
    });
    const { rows } = flattenBlockInternalFrames('0xtx', root);
    expect(rows[0].selector).toBe('0x18160ddd');
  });

  it('stops descending at the depth bound and flags the cut only when a subtree existed', () => {
    const deep = (depth: number): CallTraceNode =>
      node({ type: 'CALL', to: OTHER, depth, calls: depth < 4 ? [deep(depth + 1)] : [] });
    const root = node({ type: 'CALL', calls: [deep(1)] });

    const cut = flattenBlockInternalFrames('0xtx', root, { maxDepth: 2 });
    expect(cut.rows.map(row => row.depth)).toEqual([1, 2]);
    expect(cut.truncated).toBe(true);

    const exact = flattenBlockInternalFrames('0xtx', root, { maxDepth: 4 });
    expect(exact.rows.map(row => row.depth)).toEqual([1, 2, 3, 4]);
    expect(exact.truncated).toBe(false);
  });

  it('caps rows per tx and flags the truncation', () => {
    const root = node({
      type: 'CALL',
      calls: [
        node({ type: 'CALL', to: OTHER, depth: 1 }),
        node({ type: 'CALL', to: OTHER, depth: 1 }),
        node({ type: 'CALL', to: OTHER, depth: 1 }),
      ],
    });
    const { rows, truncated } = flattenBlockInternalFrames('0xtx', root, {
      maxRowsPerTx: 2,
    });
    expect(rows).toHaveLength(2);
    expect(truncated).toBe(true);
  });

  it('exposes the shipped bounds (UI contracts, not accidents)', () => {
    expect(MAX_BLOCK_TRACED_TXS).toBe(50);
    expect(BLOCK_TRACE_CONCURRENCY).toBe(4);
    expect(MAX_BLOCK_TOTAL_ROWS).toBe(1000);
    // The per-tx walk bounds are the address tab's — one convention.
    expect(MAX_INTERNAL_TRACE_DEPTH).toBe(128);
    expect(MAX_ROWS_PER_TX).toBe(200);
  });
});

describe('rowCarriesValue', () => {
  it('treats null as unreported, 0n as a real no-op, only positive value carries', () => {
    expect(rowCarriesValue(null)).toBe(false);
    expect(rowCarriesValue(0n)).toBe(false);
    expect(rowCarriesValue(1n)).toBe(true);
  });
});

describe('extractBlockTxHashes', () => {
  it('reads full tx objects in block order', () => {
    const block = {
      number: '0x12',
      transactions: [{ hash: '0xa' }, { hash: '0xb' }, { hash: '0xc' }],
    };
    expect(extractBlockTxHashes(block)).toEqual(['0xa', '0xb', '0xc']);
  });

  it('accepts bare hash strings (includeTransactions=false shapes)', () => {
    expect(extractBlockTxHashes({ transactions: ['0xa', '0xb'] })).toEqual(['0xa', '0xb']);
  });

  it('returns null for payloads without a usable transaction list', () => {
    expect(extractBlockTxHashes(null)).toBeNull();
    expect(extractBlockTxHashes({ number: '0x1' })).toBeNull();
    expect(extractBlockTxHashes({ transactions: 'not-an-array' })).toBeNull();
    // An entry without a hash would leave a silent hole — refuse the list.
    expect(extractBlockTxHashes({ transactions: [{ hash: '0xa' }, { blockNumber: '0x1' }] })).toBeNull();
    expect(extractBlockTxHashes({ transactions: [{ hash: '' }] })).toBeNull();
  });
});

describe('selectBlockTraceScope', () => {
  it('an empty tx list traces nothing and claims no truncation', () => {
    expect(selectBlockTraceScope([])).toEqual({ txs: [], truncated: false });
  });

  it('caps the sweep at MAX_BLOCK_TRACED_TXS and flags the cut', () => {
    const txs = Array.from({ length: 60 }, (_, i) => ({ hash: `0x${i}` }));
    const scope = selectBlockTraceScope(txs);
    expect(scope.txs).toHaveLength(50);
    expect(scope.txs[0]).toEqual({ hash: '0x0' });
    expect(scope.truncated).toBe(true);
  });

  it('a block within the cap keeps every transaction, uncut', () => {
    const txs = Array.from({ length: MAX_BLOCK_TRACED_TXS }, (_, i) => ({ hash: `0x${i}` }));
    const scope = selectBlockTraceScope(txs);
    expect(scope.txs).toHaveLength(MAX_BLOCK_TRACED_TXS);
    expect(scope.truncated).toBe(false);
  });
});

describe('groupBlockInternalTxns', () => {
  const traced = (
    hash: string,
    rows: BlockInternalTxRow[],
    truncated = false,
  ): BlockTraceTxOutcome => ({ hash, status: 'traced', rows, truncated });

  const row = (txHash: string, depth = 1): BlockInternalTxRow => ({
    txHash,
    from: SENDER,
    to: OTHER,
    value: 1n,
    depth,
    type: 'CALL',
    selector: '0xa9059cbb',
    error: null,
    revertReason: null,
  });

  it('groups rows per parent tx in block order, skipping txs without internal calls', () => {
    const aggregate = groupBlockInternalTxns([
      traced('0xa', [row('0xa')]),
      traced('0xb', []), // plain transfer — no group, still counted as traced
      traced('0xc', [row('0xc'), row('0xc', 2)]),
      { hash: '0xerr', status: 'failed', message: 'boom' },
    ]);
    expect(aggregate.groups.map(group => group.hash)).toEqual(['0xa', '0xc']);
    expect(aggregate.totalRows).toBe(3);
    expect(aggregate.tracedCount).toBe(3);
    expect(aggregate.failedTxs).toEqual([
      { hash: '0xerr', message: 'boom', unsupported: false },
    ]);
    expect(aggregate.unsupported).toBe(false);
    expect(aggregate.truncated).toBe(false);
  });

  it('marks the whole sweep unsupported only when nothing traced', () => {
    const allUnsupported = groupBlockInternalTxns([
      { hash: '0xa', status: 'unsupported', message: 'method not found' },
      { hash: '0xb', status: 'unsupported', message: 'method not found' },
    ]);
    expect(allUnsupported.unsupported).toBe(true);
    expect(allUnsupported.tracedCount).toBe(0);
  });

  it('records a lone unsupported attempt per-tx when other traces settled', () => {
    const aggregate = groupBlockInternalTxns([
      traced('0xa', [row('0xa')]),
      { hash: '0xb', status: 'unsupported', message: 'nope' },
    ]);
    expect(aggregate.unsupported).toBe(false);
    expect(aggregate.failedTxs[0].unsupported).toBe(true);
  });

  it('flags truncation from a per-tx cut', () => {
    const aggregate = groupBlockInternalTxns([traced('0xa', [row('0xa')], true)]);
    expect(aggregate.truncated).toBe(true);
    expect(aggregate.groups[0].truncated).toBe(true);
  });

  it('drops whole groups past the total-row cap, still counting later failures honestly', () => {
    const outcomes: BlockTraceTxOutcome[] = [
      traced('0xa', [row('0xa'), row('0xa')]),
      traced('0xb', [row('0xb'), row('0xb')]), // would exceed a cap of 3
      traced('0xc', [row('0xc')]),
      { hash: '0xd', status: 'failed', message: 'late failure still reported' },
    ];
    const aggregate = groupBlockInternalTxns(outcomes, { maxTotalRows: 3 });
    expect(aggregate.groups.map(group => group.hash)).toEqual(['0xa']);
    expect(aggregate.totalRows).toBe(2);
    expect(aggregate.truncated).toBe(true);
    expect(aggregate.tracedCount).toBe(3);
    expect(aggregate.failedTxs).toHaveLength(1);
  });
});

describe('labels', () => {
  it('blockInternalTxnsSummary pluralizes both counts and never invents totals', () => {
    const aggregate = groupBlockInternalTxns([
      {
        hash: '0xa',
        status: 'traced',
        rows: [
          {
            txHash: '0xa',
            from: SENDER,
            to: OTHER,
            value: 1n,
            depth: 1,
            type: 'CALL',
            selector: null,
            error: null,
            revertReason: null,
          },
        ],
        truncated: false,
      },
    ]);
    expect(blockInternalTxnsSummary(aggregate)).toBe(
      '1 internal call across 1 traced transaction',
    );
    expect(blockInternalTxnsSummary(groupBlockInternalTxns([]))).toBe(
      '0 internal calls across 0 traced transactions',
    );
  });

  it('blockTraceTruncationLabel reads "first N of M" only when the cap cut the block', () => {
    expect(blockTraceTruncationLabel(50, 60)).toBe('first 50 of 60 transactions traced');
    expect(blockTraceTruncationLabel(60, 60)).toBeNull();
    expect(blockTraceTruncationLabel(0, 0)).toBeNull();
  });
});
