// Boot-path localStorage guards: in Safari private mode / storage-blocked
// contexts the bare `localStorage` property access itself throws
// SecurityError — before any method runs. All four guarded functions sit
// on pre-React or below-React paths (getStoredManualBase feeds service
// discovery before the app renders data; readRememberedChainId runs at
// boot, on every 5s watch-notification poll tick and in the
// CommandPalette), so the contract is the one established by
// themePreference/units: reads degrade to "nothing stored", writes are
// silent no-ops, and the modules keep importing and answering.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { LAST_CHAIN_STORAGE_KEY, MANUAL_BASE_STORAGE_KEY } from '@/util/storageKeys';
import { getStoredManualBase, storeManualBase } from '@/util/apiBase';
import { readRememberedChainId, rememberChainId } from '@/views/Home/Landing';

// Redefine window.localStorage with a throwing getter — the exact
// private-mode failure shape. jsdom defines it as a configurable own
// accessor, so the original descriptor is saved and restored after each
// test (a plain delete would remove the real storage outright).
let originalStorage: PropertyDescriptor | undefined;

function blockLocalStorage(): void {
  originalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    },
  });
}

afterEach(() => {
  if (originalStorage) {
    Object.defineProperty(window, 'localStorage', originalStorage);
    originalStorage = undefined;
  }
  localStorage.clear();
});

describe('apiBase manual-base storage guards', () => {
  it('round-trips the stored manual base while storage works', () => {
    storeManualBase('http://192.168.1.50:9000');
    expect(getStoredManualBase()).toBe('http://192.168.1.50:9000');
    expect(localStorage.getItem(MANUAL_BASE_STORAGE_KEY)).toBe('http://192.168.1.50:9000');
  });

  it('reads as null when the localStorage access itself throws (private mode)', () => {
    blockLocalStorage();
    expect(getStoredManualBase()).toBeNull();
  });

  it('storeManualBase is a silent no-op when storage is blocked', () => {
    blockLocalStorage();
    expect(() => storeManualBase('http://192.168.1.50:9000')).not.toThrow();
  });
});

describe('remembered-chain storage guards', () => {
  it('round-trips the remembered chain while storage works', () => {
    rememberChainId(1);
    expect(readRememberedChainId()).toBe(1);
    expect(localStorage.getItem(LAST_CHAIN_STORAGE_KEY)).toBe('1');
  });

  it('reads as nothing-remembered when the localStorage access itself throws', () => {
    blockLocalStorage();
    expect(readRememberedChainId()).toBeUndefined();
  });

  it('rememberChainId is a silent no-op when storage is blocked', () => {
    blockLocalStorage();
    expect(() => rememberChainId(1)).not.toThrow();
  });
});

describe('module import safety under blocked storage', () => {
  it('the boot-path modules re-import and keep answering while storage throws', async () => {
    // Fresh module evaluation (not the cached instances above) with the
    // getter already throwing: any future module-scope storage touch on
    // these boot paths would fail here instead of crashing the boot.
    vi.resetModules();
    blockLocalStorage();
    const apiBase = await import('@/util/apiBase');
    const landing = await import('@/views/Home/Landing');
    expect(apiBase.getStoredManualBase()).toBeNull();
    expect(landing.readRememberedChainId()).toBeUndefined();
    expect(() => landing.rememberChainId(1)).not.toThrow();
    expect(() => apiBase.storeManualBase('http://localhost:8201')).not.toThrow();
  });
});
