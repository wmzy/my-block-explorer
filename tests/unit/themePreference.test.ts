// Theme preference core (TopNavigation cycle control + pre-mount init in
// src/index.tsx): the cycle order, the pure preference → data-theme
// attribute mapping (System = removal, the contract that lets the OS media
// query decide again), and the best-effort storage behavior (unusable or
// unavailable storage degrades to 'system', never throws).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyThemePreference,
  nextThemePreference,
  readThemePreference,
  setDocumentThemeAttribute,
  storeThemePreference,
} from '@/themePreference';

describe('nextThemePreference', () => {
  it('cycles Light → Dark → System → Light from every mode', () => {
    expect(nextThemePreference('light')).toBe('dark');
    expect(nextThemePreference('dark')).toBe('system');
    expect(nextThemePreference('system')).toBe('light');
  });
});

describe('applyThemePreference', () => {
  it('pins \'dark\' and \'light\' as attribute values', () => {
    expect(applyThemePreference('dark')).toBe('dark');
    expect(applyThemePreference('light')).toBe('light');
  });

  it('maps \'system\' to removal (null) so the OS preference decides', () => {
    expect(applyThemePreference('system')).toBeNull();
  });
});

describe('readThemePreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('reads a stored explicit choice', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    expect(readThemePreference()).toBe('dark');
    localStorage.setItem(THEME_STORAGE_KEY, 'light');
    expect(readThemePreference()).toBe('light');
  });

  it('treats an absent or unrecognized value as \'system\'', () => {
    expect(readThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, 'blue');
    expect(readThemePreference()).toBe('system');
    localStorage.setItem(THEME_STORAGE_KEY, '');
    expect(readThemePreference()).toBe('system');
  });

  it('degrades to \'system\' when storage is unavailable (private mode)', () => {
    const getItem = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new DOMException('storage unavailable');
      });
    expect(readThemePreference()).toBe('system');
    getItem.mockRestore();
  });
});

describe('storeThemePreference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists the choice under the be:theme key', () => {
    storeThemePreference('dark');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('swallows a failing write instead of breaking the click', () => {
    const setItem = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new DOMException('quota exceeded');
      });
    expect(() => storeThemePreference('light')).not.toThrow();
    setItem.mockRestore();
  });
});

describe('setDocumentThemeAttribute', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
  });

  it('pins data-theme for explicit modes', () => {
    setDocumentThemeAttribute('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    setDocumentThemeAttribute('light');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('removes the attribute for \'system\' (OS media query governs again)', () => {
    setDocumentThemeAttribute('dark');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(true);
    setDocumentThemeAttribute('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
