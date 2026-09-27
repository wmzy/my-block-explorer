// copyText: the async Clipboard API path plus the legacy execCommand
// fallback for non-secure contexts. Every case stubs the browser surface
// copyText consumes; the assertions pin WHICH path produced the result.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyText } from '@/util/clipboard';

type ClipboardStub = { writeText: ReturnType<typeof vi.fn> } | undefined;

const originalClipboard = navigator.clipboard;
const originalExecCommand = document.execCommand;

function stubClipboard(writeText?: ReturnType<typeof vi.fn>): void {
  if (writeText === undefined) {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      get() {
        return undefined;
      },
    });
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  }
}

function restoreBrowserSurface(): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: originalClipboard,
  });
  Object.defineProperty(document, 'execCommand', {
    configurable: true,
    value: originalExecCommand,
  });
}

afterEach(restoreBrowserSurface);

describe('copyText', () => {
  it('uses the async Clipboard API when available and succeeds', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    await expect(copyText('abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('abc');
  });

  it('falls back to execCommand when the Clipboard API rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    stubClipboard(writeText);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await expect(copyText('abc')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('falls back to execCommand when the Clipboard API is missing (non-secure context)', async () => {
    const clipboard: ClipboardStub = undefined;
    void clipboard;
    stubClipboard();
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await expect(copyText('abc')).resolves.toBe(true);
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('reports false when both paths fail', async () => {
    stubClipboard();
    const execCommand = vi.fn(() => false);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    await expect(copyText('abc')).resolves.toBe(false);
  });

  it('reports false when execCommand throws', async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        throw new Error('unsupported');
      },
    });
    await expect(copyText('abc')).resolves.toBe(false);
  });

  it('copies the exact payload through the fallback textarea', async () => {
    stubClipboard();
    const values: string[] = [];
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: () => {
        const textarea = document.querySelector('textarea');
        if (textarea !== null) values.push(textarea.value);
        return true;
      },
    });
    await expect(copyText('0xdeadbeef')).resolves.toBe(true);
    // The helper textarea is removed after the copy attempt.
    expect(values).toEqual(['0xdeadbeef']);
    expect(document.querySelector('textarea')).toBeNull();
  });
});
