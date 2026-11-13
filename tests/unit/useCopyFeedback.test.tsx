// useCopyFeedback: the one copy-feedback state machine behind every
// label-swap copy button. copyText is mocked so the tests pin the hook's
// own contract — honest ok/fail settlement, resetMs window (default
// 2000), timer discipline (cleared on unmount, restarted on a new copy),
// keyed multi-button reads, and reset cancelling pending work.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useCopyFeedback, useCopyLabel } from '@/util/useCopyFeedback';
import { copyText } from '@/util/clipboard';

vi.mock('@/util/clipboard', () => ({ copyText: vi.fn() }));

beforeEach(() => {
  vi.mocked(copyText).mockReset();
  vi.mocked(copyText).mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useCopyFeedback', () => {
  it('starts idle and settles the honest outcome of the copy', async () => {
    const { result } = renderHook(() => useCopyFeedback());

    expect(result.current.state).toBe('idle');

    await act(async () => {
      await result.current.copy('0xabc');
    });

    expect(copyText).toHaveBeenCalledWith('0xabc');
    expect(result.current.state).toBe('ok');
  });

  it('settles fail when the clipboard write is rejected', async () => {
    vi.mocked(copyText).mockResolvedValue(false);
    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy('0xabc');
    });

    expect(result.current.state).toBe('fail');
  });

  it('resets to idle after the 2000ms default window', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy('0xabc');
    });
    expect(result.current.state).toBe('ok');

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.state).toBe('ok');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.state).toBe('idle');
  });

  it('honors a custom resetMs', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyFeedback({ resetMs: 500 }));

    await act(async () => {
      await result.current.copy('0xabc');
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.state).toBe('idle');
  });

  it('restarts the window on a new copy so the latest result shows in full', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy('first');
    });
    expect(result.current.state).toBe('ok');

    // The second copy's window must not be cut short by the first copy's
    // still-pending reset timer.
    vi.mocked(copyText).mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.copy('second');
    });
    expect(result.current.state).toBe('fail');

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.state).toBe('fail');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.state).toBe('idle');
  });

  it('lets only the latest-invoked copy settle when writes resolve out of order', async () => {
    // First click's write resolves AFTER the second's — the second (the
    // user's latest action) must own the feedback.
    let resolveFirst: (ok: boolean) => void = () => {};
    vi.mocked(copyText).mockImplementationOnce(
      () => new Promise<boolean>(resolve => (resolveFirst = resolve)),
    );
    const { result } = renderHook(() => useCopyFeedback());

    let firstCopy: Promise<void> = Promise.resolve();
    act(() => {
      firstCopy = result.current.copy('first');
    });
    await act(async () => {
      await result.current.copy('second');
    });
    expect(result.current.state).toBe('ok');

    await act(async () => {
      resolveFirst(false);
      await firstCopy;
    });
    expect(result.current.state).toBe('ok');
  });

  it('scopes feedback to the keyed button — exactly one shows at a time', async () => {
    const { result } = renderHook(() => useCopyFeedback());

    expect(result.current.stateFor('cast')).toBe('idle');
    expect(result.current.stateFor('viem')).toBe('idle');

    await act(async () => {
      await result.current.copy('cast cmd', 'cast');
    });
    expect(result.current.stateFor('cast')).toBe('ok');
    expect(result.current.stateFor('viem')).toBe('idle');

    vi.mocked(copyText).mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.copy('viem script', 'viem');
    });
    // The new copy replaces the previous outcome outright.
    expect(result.current.stateFor('cast')).toBe('idle');
    expect(result.current.stateFor('viem')).toBe('fail');
  });

  it('reset returns to idle immediately, cancels the timer and pending copies', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCopyFeedback());

    // A settled outcome: reset drops it and clears the pending reset timer.
    await act(async () => {
      await result.current.copy('first');
    });
    expect(result.current.state).toBe('ok');
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      result.current.reset();
    });
    expect(result.current.state).toBe('idle');
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current.state).toBe('idle');

    // A copy still in flight when reset ran must not resurrect feedback.
    let resolvePending: (ok: boolean) => void = () => {};
    vi.mocked(copyText).mockImplementationOnce(
      () => new Promise<boolean>(resolve => (resolvePending = resolve)),
    );
    let lateCopy: Promise<void> = Promise.resolve();
    act(() => {
      lateCopy = result.current.copy('late');
    });
    act(() => {
      result.current.reset();
    });
    await act(async () => {
      resolvePending(true);
      await lateCopy;
    });
    expect(result.current.state).toBe('idle');
  });

  it('clears the pending reset timer on unmount', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCopyFeedback());

    await act(async () => {
      await result.current.copy('0xabc');
    });
    expect(vi.getTimerCount()).toBe(1);

    act(() => {
      unmount();
    });
    expect(vi.getTimerCount()).toBe(0);

    // No state update may fire after the unmount cleared the timer.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
  });
});

describe('useCopyLabel', () => {
  it('verbalizes each machine state, falling back to the caller idle label', () => {
    expect(useCopyLabel('ok', 'Copy')).toBe('Copied ✓');
    expect(useCopyLabel('fail', 'Copy')).toBe('Copy failed');
    expect(useCopyLabel('idle', 'Copy')).toBe('Copy');
    // The idle label is whatever the site shows at rest — the NFT tile's id.
    expect(useCopyLabel('idle', '#7')).toBe('#7');
  });
});
