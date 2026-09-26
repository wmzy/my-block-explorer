// Private-notes store contract (util/privateNotes.ts): the key grammar
// (checksummed, pattern-pinned), the two-tier address validation with
// malformed-input-performs-no-write, the 280-char cap as an explicit
// rejection (never a silent truncation), best-effort read degradation,
// clear, and the injected-storage seam the backup layer shares.
import { describe, it, expect, beforeEach } from 'vitest';
import { getAddress } from 'viem';
import {
  clearPrivateNote,
  parsePrivateNoteKey,
  parseStoredPrivateNote,
  privateNoteStorageKey,
  PRIVATE_NOTE_KEY_PREFIX,
  PRIVATE_NOTE_KEY_RE,
  PRIVATE_NOTE_MAX_CHARS,
  readPrivateNote,
  savePrivateNote,
  type PrivateNoteStorage,
} from '@/util/privateNotes';

const BODY = '0x1234567890abcdef1234567890abcdef12345678';
const CHECKSUMMED = getAddress(BODY);
const OTHER = getAddress('0xabcdef0000000000000000000000000000000001');

// A recording in-memory storage: proves both WHAT was written and that
// NOTHING was written on a rejection.
function memoryStorage(): PrivateNoteStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: key => {
      map.delete(key);
    },
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('key grammar', () => {
  it('builds the key from the checksummed form, normalizing case-tiers through', () => {
    expect(privateNoteStorageKey(1, BODY)).toBe(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`);
    // All-lowercase (checksum-less convention) and the checksummed form
    // land on the SAME key; chains are part of the namespace.
    expect(privateNoteStorageKey(1, BODY.toLowerCase()))
      .toBe(privateNoteStorageKey(1, CHECKSUMMED));
    expect(privateNoteStorageKey(137, CHECKSUMMED)).toBe(`${PRIVATE_NOTE_KEY_PREFIX}137:${CHECKSUMMED}`);
  });

  it('returns null (no key, no write) for malformed addresses and chain ids', () => {
    for (const bad of ['hello', '0x123', `0x${'g'.repeat(40)}`, '', '  ']) {
      expect(privateNoteStorageKey(1, bad)).toBeNull();
    }
    // Mixed-case body that is NOT the EIP-55 checksummed spelling.
    expect(privateNoteStorageKey(1, '0x1234567890AbCdEf1234567890abCdEf12345678')).toBeNull();
    expect(privateNoteStorageKey(0, CHECKSUMMED)).toBeNull();
    expect(privateNoteStorageKey(1.5, CHECKSUMMED)).toBeNull();
  });

  it('splits scanned keys back into parts, rejecting off-grammar keys', () => {
    expect(parsePrivateNoteKey(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`))
      .toEqual({ chainId: 1, address: CHECKSUMMED });
    // Lowercase hand-edited key normalizes to the checksummed address.
    expect(parsePrivateNoteKey(`${PRIVATE_NOTE_KEY_PREFIX}1:${BODY.toLowerCase()}`))
      .toEqual({ chainId: 1, address: CHECKSUMMED });
    for (const foreign of [
      'be:theme',
      `be:privateNote:1:${'z'.repeat(40)}`,
      `be:privateNote:0:${CHECKSUMMED}`,
      `custom-abi:1:${BODY.toLowerCase()}`,
      `be:privateNote:1:${'0'.repeat(41)}`,
    ]) {
      expect(parsePrivateNoteKey(foreign)).toBeNull();
    }
  });
});

describe('savePrivateNote', () => {
  it('round-trips through the injected storage, trimmed', () => {
    const storage = memoryStorage();
    const result = savePrivateNote(1, CHECKSUMMED, '  treasury of the DAO  ', storage);
    expect(result).toEqual({ ok: true, note: 'treasury of the DAO' });
    expect(storage.map.get(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`)).toBe('treasury of the DAO');
    expect(readPrivateNote(1, CHECKSUMMED, storage)).toBe('treasury of the DAO');
  });

  it('works against the real (jsdom) localStorage too', () => {
    expect(savePrivateNote(137, OTHER, 'staking rewards wallet')).toEqual({ ok: true, note: 'staking rewards wallet' });
    expect(localStorage.getItem(`${PRIVATE_NOTE_KEY_PREFIX}137:${OTHER}`)).toBe('staking rewards wallet');
  });

  it('rejects over-cap input WITHOUT writing — never silently truncates', () => {
    const storage = memoryStorage();
    const atCap = 'x'.repeat(PRIVATE_NOTE_MAX_CHARS);
    const overCap = 'x'.repeat(PRIVATE_NOTE_MAX_CHARS + 1);
    expect(savePrivateNote(1, CHECKSUMMED, atCap, storage)).toEqual({ ok: true, note: atCap });
    expect(savePrivateNote(1, OTHER, overCap, storage)).toEqual({ ok: false, reason: 'too-long' });
    expect(storage.map.has(`${PRIVATE_NOTE_KEY_PREFIX}1:${OTHER}`)).toBe(false);
    // The cap counts the stored (trimmed) text, but raw length is what
    // the editor shows — whitespace padding cannot smuggle past it.
    expect(savePrivateNote(1, OTHER, ` ${'x'.repeat(PRIVATE_NOTE_MAX_CHARS)} `, storage))
      .toEqual({ ok: true, note: 'x'.repeat(PRIVATE_NOTE_MAX_CHARS) });
  });

  it('rejects empty/whitespace-only notes without touching storage', () => {
    const storage = memoryStorage();
    expect(savePrivateNote(1, CHECKSUMMED, '', storage)).toEqual({ ok: false, reason: 'empty' });
    expect(savePrivateNote(1, CHECKSUMMED, '   \n\t ', storage)).toEqual({ ok: false, reason: 'empty' });
    expect(storage.map.size).toBe(0);
  });

  it('performs NO write for a malformed address (both tiers)', () => {
    const storage = memoryStorage();
    for (const bad of ['not-an-address', '0x12', `0x${'h'.repeat(40)}`, '0x1234567890AbCdEf1234567890abCdEf12345678']) {
      expect(savePrivateNote(1, bad, 'note', storage)).toEqual({ ok: false, reason: 'malformed-address' });
    }
    expect(storage.map.size).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('reports storage-unavailable when the write throws (quota/private mode)', () => {
    const throwing: PrivateNoteStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    expect(savePrivateNote(1, CHECKSUMMED, 'note', throwing)).toEqual({ ok: false, reason: 'storage-unavailable' });
  });
});

describe('readPrivateNote', () => {
  it('reads back only what the app itself would have written', () => {
    const storage = memoryStorage();
    expect(readPrivateNote(1, CHECKSUMMED, storage)).toBeNull();
    // Hand-corrupted values degrade to null, never crash the page.
    storage.map.set(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, '');
    expect(readPrivateNote(1, CHECKSUMMED, storage)).toBeNull();
    storage.map.set(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, 'x'.repeat(PRIVATE_NOTE_MAX_CHARS + 1));
    expect(readPrivateNote(1, CHECKSUMMED, storage)).toBeNull();
    storage.map.set(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`, 'real note');
    expect(readPrivateNote(1, CHECKSUMMED, storage)).toBe('real note');
    // Case-insensitive lookup through the checksum normalization.
    expect(readPrivateNote(1, BODY.toLowerCase(), storage)).toBe('real note');
  });

  it('parseStoredPrivateNote is the pure payload guard', () => {
    expect(parseStoredPrivateNote(null)).toBeNull();
    expect(parseStoredPrivateNote('')).toBeNull();
    expect(parseStoredPrivateNote('x'.repeat(PRIVATE_NOTE_MAX_CHARS))).toBe('x'.repeat(PRIVATE_NOTE_MAX_CHARS));
    expect(parseStoredPrivateNote('x'.repeat(PRIVATE_NOTE_MAX_CHARS + 1))).toBeNull();
  });
});

describe('clearPrivateNote', () => {
  it('removes exactly the (chainId, address) note and reports whether one existed', () => {
    savePrivateNote(1, CHECKSUMMED, 'keep me');
    savePrivateNote(137, CHECKSUMMED, 'other chain');
    expect(clearPrivateNote(1, CHECKSUMMED)).toBe(true);
    expect(localStorage.getItem(`${PRIVATE_NOTE_KEY_PREFIX}1:${CHECKSUMMED}`)).toBeNull();
    expect(readPrivateNote(137, CHECKSUMMED)).toBe('other chain');
    expect(clearPrivateNote(1, CHECKSUMMED)).toBe(false);
    // Malformed address: no write, no crash.
    expect(clearPrivateNote(1, 'zzz')).toBe(false);
  });
});

describe('written keys always match the pinned pattern', () => {
  it('every key the store can produce is inside the be:privateNote: grammar', () => {
    const storage = memoryStorage();
    for (const [chainId, address] of [[1, CHECKSUMMED], [137, OTHER], [31337, BODY.toLowerCase()]] as const) {
      savePrivateNote(chainId, address, 'n', storage);
    }
    expect(storage.map.size).toBe(3);
    for (const key of storage.map.keys()) {
      expect(key).toMatch(PRIVATE_NOTE_KEY_RE);
    }
  });
});
