// useClickOutside: the one dismiss-on-outside-press hook behind the nav's
// dropdown islands and the IDE picker. Pins the hook's own contract — a
// document mousedown outside the ref'd container closes, one inside (or
// on a descendant) does not, nothing listens while disabled, the listener
// detaches on unmount, and the latest onClose identity is the one that
// fires.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, fireEvent } from '@testing-library/react';
import { useRef } from 'react';

import { useClickOutside } from '@/util/useClickOutside';

type ProbeProps = {
  enabled?: boolean;
  onClose: () => void;
};

// The hook reads ref.current only at event time, so the container can be
// a detached-from-React element — but events only REACH the document
// listener through a connected tree, so both shells live under body.
const domShells: HTMLElement[] = [];

const renderProbe = (initialProps: ProbeProps) => {
  const inside = document.createElement('div');
  const insideChild = document.createElement('span');
  inside.appendChild(insideChild);
  const outside = document.createElement('div');
  document.body.append(inside, outside);
  domShells.push(inside, outside);

  const utils = renderHook(
    ({ enabled, onClose }: ProbeProps) => {
      const ref = useRef<HTMLDivElement | null>(inside);
      useClickOutside(ref, onClose, { enabled });
      return ref;
    },
    { initialProps },
  );
  return { ...utils, inside, insideChild, outside };
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const shell of domShells.splice(0)) shell.remove();
});

describe('useClickOutside', () => {
  it('closes on a document mousedown outside the container', () => {
    const onClose = vi.fn();
    const { outside } = renderProbe({ enabled: true, onClose });

    fireEvent.mouseDown(outside);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the surface open on a mousedown inside the container (or a descendant)', () => {
    const onClose = vi.fn();
    const { inside, insideChild } = renderProbe({ enabled: true, onClose });

    fireEvent.mouseDown(inside);
    fireEvent.mouseDown(insideChild);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('attaches nothing while disabled', () => {
    const onClose = vi.fn();
    const { outside } = renderProbe({ enabled: false, onClose });

    fireEvent.mouseDown(outside);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('stops listening after unmount', () => {
    const onClose = vi.fn();
    const { outside, unmount } = renderProbe({ enabled: true, onClose });

    unmount();
    fireEvent.mouseDown(outside);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('fires the latest onClose identity across re-renders', () => {
    const first = vi.fn();
    const { rerender, outside } = renderProbe({ enabled: true, onClose: first });
    const second = vi.fn();
    rerender({ enabled: true, onClose: second });

    fireEvent.mouseDown(outside);

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
