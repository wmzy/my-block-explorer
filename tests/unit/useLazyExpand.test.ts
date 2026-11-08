// The shared lazy-expand machine: fetch-once latch, identity (route-param)
// reset, and the stale-settle guard. These are the three invariants every
// lazily-fetched card (CallTraceCard, InternalTxnsSection, RawJsonCard)
// hand-rolled before the hook existed.
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLazyExpand } from '@/util/useLazyExpand';

const keyDown = (key: string) =>
  ({ key, preventDefault: () => undefined } as unknown as Parameters<
    ReturnType<typeof useLazyExpand>['handleKeyDown']
  >[0]);

const renderMachine = (identity: string, callbacks: Parameters<typeof useLazyExpand>[1] = {}) =>
  renderHook(({ id }: { id: string }) => useLazyExpand(id, callbacks), {
    initialProps: { id: identity },
  });

describe('useLazyExpand', () => {
  it('starts collapsed and toggles through the keyboard affordance too', () => {
    const { result } = renderMachine('chain:1:tx-a');

    expect(result.current.expanded).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    act(() => result.current.handleKeyDown(keyDown('Enter')));
    expect(result.current.expanded).toBe(false);
    act(() => result.current.handleKeyDown(keyDown(' ')));
    expect(result.current.expanded).toBe(true);
  });

  it('fires the fetch exactly ONCE per identity: later expands reuse the settled result', () => {
    const onFirstExpand = vi.fn();
    const { result } = renderMachine('chain:1:tx-a', { onFirstExpand });

    act(() => result.current.toggle()); // first expand: fetch
    act(() => result.current.toggle()); // collapse
    act(() => result.current.toggle()); // re-expand: cached, no fetch
    act(() => result.current.toggle());
    act(() => result.current.toggle());

    expect(onFirstExpand).toHaveBeenCalledTimes(1);
  });

  it('keeps the latch armed when onFirstExpand vetoes (nothing to fetch yet)', () => {
    const onFirstExpand = vi.fn(() => false);
    const { result } = renderMachine('chain:1:block-a', { onFirstExpand });

    act(() => result.current.toggle()); // expand, vetoed
    expect(onFirstExpand).toHaveBeenCalledTimes(1);
    act(() => result.current.toggle()); // collapse
    act(() => result.current.toggle()); // expand again — latch still armed

    expect(onFirstExpand).toHaveBeenCalledTimes(2);
  });

  it('resets everything when the identity (route param) changes', () => {
    const onFirstExpand = vi.fn();
    const onReset = vi.fn();
    const { result, rerender } = renderMachine('chain:1:tx-a', { onFirstExpand, onReset });

    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
    expect(onFirstExpand).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();

    // Route change under the reused card: collapsed, latch re-armed, and
    // the caller's own entity state handed its reset.
    rerender({ id: 'chain:1:tx-b' });
    expect(result.current.expanded).toBe(false);
    expect(onReset).toHaveBeenCalledTimes(1);

    act(() => result.current.toggle());
    expect(onFirstExpand).toHaveBeenCalledTimes(2);
  });

  it('drops settles superseded by a later claim (Retry) or an identity change', () => {
    const { result, rerender } = renderMachine('chain:1:tx-a');

    const first = result.current.claim();
    expect(result.current.isCurrent(first)).toBe(true);

    // A Retry claims a newer token: the first request's settle must drop.
    const second = result.current.claim();
    expect(result.current.isCurrent(first)).toBe(false);
    expect(result.current.isCurrent(second)).toBe(true);

    // An identity change invalidates even the latest in-flight claim.
    rerender({ id: 'chain:1:tx-b' });
    expect(result.current.isCurrent(second)).toBe(false);
    // And the next claim after the reset is current again.
    const third = result.current.claim();
    expect(result.current.isCurrent(third)).toBe(true);
  });
});
