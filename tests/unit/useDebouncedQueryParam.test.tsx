// useDebouncedQueryParam (util/useDebouncedQueryParam): the debounced
// ?q= input discipline the Contracts/Tokens/Signatures filter boxes
// share — the input leads the URL (debounced, history-replacing commits
// that strip the key plus extras when the filter clears), external URL
// changes sync the input back, and the one discrimination between the
// two directions is the last-pushed ref. Plus useDebouncedValue, the
// plain trailing-edge debounce twin.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import {
  useDebouncedQueryParam,
  useDebouncedValue,
  type SetSearchLike,
} from '@/util/useDebouncedQueryParam';

type Search = { q?: string; offset?: number; keep?: string };

describe('useDebouncedQueryParam', () => {
  let setSearch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    setSearch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const renderQ = (initialQ: string | undefined = undefined) =>
    renderHook(
      ({ q }: { q: string | undefined }) =>
        useDebouncedQueryParam('q', q, setSearch as SetSearchLike<Search>, {
          extraKeysToStrip: ['offset'],
        }),
      { initialProps: { q: initialQ } },
    );

  it('starts the input from the deep-linked ?q=', () => {
    const { result } = renderQ('deep');
    expect(result.current.value).toBe('deep');
  });

  it('commits a settled input to the URL, replacing history and stripping extras', () => {
    const { result } = renderQ();
    act(() => {
      result.current.setValue('vitalik');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(setSearch).toHaveBeenCalledTimes(1);
    const [updater, opts] = setSearch.mock.calls[0] as unknown as [
      (prev: Search) => Search,
      { replace?: boolean },
    ];
    expect(opts).toEqual({ replace: true });
    // The updater strips q AND the extras (a new filter restarts at page
    // 1) while preserving every other key.
    expect(updater({ q: 'old', offset: 40, keep: 'me' })).toEqual({ keep: 'me', q: 'vitalik' });
  });

  it('removes the key entirely when the committed filter is empty', () => {
    const { result } = renderQ('old');

    act(() => {
      result.current.setValue('');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });

    const [updater] = setSearch.mock.calls[0] as unknown as [(prev: Search) => Search];
    expect(updater({ q: 'old', offset: 40, keep: 'me' })).toEqual({ keep: 'me' });
  });

  it('debounces: only settled input is written, not per keystroke', () => {
    const { result } = renderQ();

    act(() => {
      result.current.setValue('vi');
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    act(() => {
      result.current.setValue('vitalik');
    });
    act(() => {
      vi.advanceTimersByTime((299));
    });
    expect(setSearch).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(setSearch).toHaveBeenCalledTimes(1);
    const [updater] = setSearch.mock.calls[0] as unknown as [(prev: Search) => Search];
    expect(updater({})).toEqual({ q: 'vitalik' });
  });

  it('never writes when the URL already carries the trimmed input', () => {
    const { result } = renderQ('vitalik');

    // Same value (untrimmed variant of an equal trim) — no commit.
    act(() => {
      result.current.setValue('vitalik');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setSearch).not.toHaveBeenCalled();
  });

  it('commits the trimmed value', () => {
    const { result } = renderQ();

    act(() => {
      result.current.setValue('  spaced  ');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    const [updater] = setSearch.mock.calls[0] as unknown as [(prev: Search) => Search];
    expect(updater({})).toEqual({ q: 'spaced' });
  });

  it('commit() bypasses the debounce (Enter key)', () => {
    const { result } = renderQ();

    act(() => {
      result.current.commit('now');
    });
    expect(setSearch).toHaveBeenCalledTimes(1);
  });

  it('follows an external URL change (deep link, back/forward)', () => {
    const { result, rerender } = renderQ();

    rerender({ q: 'deep' });
    expect(result.current.value).toBe('deep');
  });

  it('keeps the input leading when its own pushed write lands in the URL', () => {
    const { result, rerender } = renderQ();

    act(() => {
      result.current.setValue('typed');
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(setSearch).toHaveBeenCalledTimes(1);

    // The URL now carries exactly what we pushed — input must NOT be
    // reset (and, mid-edit, a further keystroke is not clobbered).
    act(() => {
      result.current.setValue('typed2');
    });
    rerender({ q: 'typed' });
    expect(result.current.value).toBe('typed2');
  });
});

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('holds the previous value until the input stays unchanged for the delay', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });
    expect(result.current).toBe('a');

    rerender({ v: 'b' });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('b');
  });

  it('resets the timer per change: only the settled value propagates', () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 'a' },
    });

    rerender({ v: 'b' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender({ v: 'c' });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe('c');
  });
});
