// traceFormat: the pure normalization of Geth callTracer results. Pins
// bigint-exactness, selector extraction, depth/nesting, honest nulls for
// missing fields, malformed-root rejection, and the unsupported-method
// classifier — no network, no viem.
import { describe, it, expect } from 'vitest';
import {
  normalizeCallTrace,
  countNodes,
  maxDepth,
  countFailedCalls,
  isTraceUnsupportedError,
  type CallTraceNode,
} from '@/utils/traceFormat';

// Fixture normalizer: these payloads are well-formed by construction, so a
// null here is a test bug worth failing loudly on.
const must = (raw: unknown): CallTraceNode => {
  const node = normalizeCallTrace(raw);
  if (node === null) throw new Error('fixture failed to normalize');
  return node;
};

// A realistic three-level fixture: root CALL → STATICCALL → CALL that
// reverts (the shape of a proxy read feeding a state write).
const nestedRaw = {
  type: 'CALL',
  from: '0x1111111111111111111111111111111111111111',
  to: '0x2222222222222222222222222222222222222222',
  value: '0xde0b6b3a7640000', // 1 ETH
  gas: '0x8ac6f0',
  gasUsed: '0x186a0', // 100000
  input: '0xa9059cbb00000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000001',
  output: '0x',
  calls: [
    {
      type: 'STATICCALL',
      from: '0x2222222222222222222222222222222222222222',
      to: '0x4444444444444444444444444444444444444444',
      gas: '0x1d4c0',
      gasUsed: '0x5208', // 21000
      input: '0x18160ddd', // totalSupply()
      output: '0x0000000000000000000000000000000000000000000000000de0b6b3a7640000',
      calls: [
        {
          type: 'CALL',
          from: '0x4444444444444444444444444444444444444444',
          to: '0x5555555555555555555555555555555555555555',
          value: '0x0',
          gas: '0x5208',
          gasUsed: '0x2b46', // 11078
          input: '0x',
          error: 'execution reverted',
          revertReason: 'INSUFFICIENT_ALLOWANCE',
        },
      ],
    },
  ],
};

describe('normalizeCallTrace', () => {
  it('normalizes a nested tree with exact bigints, depths, and selector', () => {
    const root = must(nestedRaw);

    expect(root.type).toBe('CALL');
    expect(root.depth).toBe(0);
    expect(root.value).toBe(1_000_000_000_000_000_000n);
    expect(root.gas).toBe(0x8ac6f0n);
    expect(root.gasUsed).toBe(100_000n);
    expect(root.selector).toBe('0xa9059cbb');
    expect(root.error).toBeNull();
    expect(root.revertReason).toBeNull();

    const child = root.calls[0];
    expect(child.type).toBe('STATICCALL');
    expect(child.depth).toBe(1);
    // STATICCALL frames may omit value — absence stays null, never 0.
    expect(child.value).toBeNull();
    expect(child.selector).toBe('0x18160ddd');

    const grandchild = child.calls[0];
    expect(grandchild.depth).toBe(2);
    expect(grandchild.value).toBe(0n); // explicit 0 stays an exact 0
    expect(grandchild.error).toBe('execution reverted');
    expect(grandchild.revertReason).toBe('INSUFFICIENT_ALLOWANCE');
  });

  it('counts failures through the tree without inventing parent errors', () => {
    const root = must(nestedRaw);
    // The revert sits on the leaf only — a parent that caught the revert
    // is NOT marked failed (Geth's per-frame reporting is kept verbatim).
    expect(root.error).toBeNull();
    expect(countFailedCalls(root)).toBe(1);

    const clean = must({ type: 'CALL', from: '0x1', to: '0x2', gas: '0x1' });
    expect(countFailedCalls(clean)).toBe(0);
  });

  it('extracts a selector only from inputs with at least 4 data bytes', () => {
    const selectorOf = (input: unknown): string | null =>
      normalizeCallTrace({ type: 'CALL', input })?.selector ?? null;

    expect(selectorOf(`0xa9059cbb${'ff'.repeat(32)}`)).toBe('0xa9059cbb');
    expect(selectorOf('0xa9059cbb')).toBe('0xa9059cbb'); // exactly 4 bytes
    expect(selectorOf('0xa9059c')).toBeNull(); // 3 bytes
    expect(selectorOf('0x')).toBeNull(); // plain transfer
    expect(selectorOf(undefined)).toBeNull(); // field absent
    expect(selectorOf('0xZZYYZZYY')).toBeNull(); // not hex
    // Uppercase hex is accepted and normalized (parity with selectorOf).
    expect(selectorOf('0xA9059CBB0000')).toBe('0xa9059cbb');
  });

  it('parses hex strings, decimal strings, and JSON numbers exactly; rejects nonsense', () => {
    const valueOf = (value: unknown): bigint | null | undefined =>
      normalizeCallTrace({ type: 'CALL', value })?.value;

    // 2^78 — beyond Number.MAX_SAFE_INTEGER, exact only as bigint.
    expect(valueOf('0x40000000000000000000')).toBe(2n ** 78n);
    expect(valueOf('21000')).toBe(21_000n);
    expect(valueOf(21_000)).toBe(21_000n);
    expect(valueOf(0)).toBe(0n);
    expect(valueOf(undefined)).toBeNull(); // absent field
    expect(valueOf('')).toBeNull();
    expect(valueOf('not-a-number')).toBeNull();
    expect(valueOf(-5)).toBeNull(); // negative gas/value is nonsense → absent
    expect(valueOf(1.5)).toBeNull(); // fractional quantities → absent
  });

  it('normalizes CREATE frames without a `to` and without calls', () => {
    const root = must({
      type: 'CREATE2',
      from: '0x1111111111111111111111111111111111111111',
      gas: '0x186a0',
      gasUsed: '0x186a0',
      input: '0x60806040523480156100115760006000fdff',
    });
    expect(root.to).toBeNull();
    expect(root.calls).toEqual([]);
    expect(root.input).toBe('0x60806040523480156100115760006000fdff');
  });

  it('passes unknown call types through verbatim and skips malformed children only', () => {
    const root = must({
      type: 'FUTURECALL',
      calls: [{ type: 'CALL' }, 'garbage', null, { not: 'a frame' }],
    });
    expect(root.type).toBe('FUTURECALL');
    // The one well-formed child survives; its broken siblings are dropped
    // rather than nuking the whole tree.
    expect(root.calls).toHaveLength(1);
    expect(root.calls[0]?.type).toBe('CALL');
    expect(root.calls[0]?.depth).toBe(1);
  });

  it('returns null for payloads that are not a call frame', () => {
    expect(normalizeCallTrace(null)).toBeNull();
    expect(normalizeCallTrace(undefined)).toBeNull();
    expect(normalizeCallTrace('CALL')).toBeNull();
    expect(normalizeCallTrace(42)).toBeNull();
    expect(normalizeCallTrace([])).toBeNull();
    expect(normalizeCallTrace({})).toBeNull(); // no `type`
    expect(normalizeCallTrace({ type: 7 })).toBeNull(); // non-string type
    expect(normalizeCallTrace({ type: '' })).toBeNull();
  });
});

describe('countNodes / maxDepth', () => {
  it('count the root and measure nesting from 0', () => {
    expect(countNodes(must(nestedRaw))).toBe(3);
    expect(maxDepth(must(nestedRaw))).toBe(2);

    const single = must({ type: 'CALL', to: '0x2' });
    expect(countNodes(single)).toBe(1);
    expect(maxDepth(single)).toBe(0);

    // Wide but shallow: 3 children, all leaves.
    const wide = must({
      type: 'CALL',
      calls: [{ type: 'CALL' }, { type: 'STATICCALL' }, { type: 'DELEGATECALL' }],
    });
    expect(countNodes(wide)).toBe(4);
    expect(maxDepth(wide)).toBe(1);
  });
});

describe('isTraceUnsupportedError', () => {
  it('recognizes the method-not-found family from Geth and proxies', () => {
    expect(
      isTraceUnsupportedError(
        new Error('the method debug_traceTransaction does not exist/is not available'),
      ),
    ).toBe(true);
    expect(isTraceUnsupportedError(new Error('Method not found'))).toBe(true);
    expect(
      isTraceUnsupportedError(new Error('debug_traceTransaction is not supported on this endpoint')),
    ).toBe(true);
    expect(isTraceUnsupportedError(new Error('tracing not enabled: unimplemented'))).toBe(true);
    // JSON-RPC code -32601 with an unhelpful message still classifies.
    expect(
      isTraceUnsupportedError(Object.assign(new Error('request failed'), { code: -32601 })),
    ).toBe(true);
    // viem wraps provider errors as a cause chain: the verdict can live
    // several hops down.
    expect(
      isTraceUnsupportedError(
        new Error('HTTP request failed', {
          cause: new Error('RPC error', { cause: new Error('the method does not exist') }),
        }),
      ),
    ).toBe(true);
    expect(isTraceUnsupportedError('method not found')).toBe(true); // bare string rejection
  });

  it('does not misread unrelated failures as unsupported', () => {
    expect(isTraceUnsupportedError(new Error('transaction not found'))).toBe(false);
    expect(isTraceUnsupportedError(new Error('gateway timeout'))).toBe(false);
    expect(isTraceUnsupportedError(new Error('429 Too Many Requests'))).toBe(false);
    expect(isTraceUnsupportedError(undefined)).toBe(false);
  });
});
