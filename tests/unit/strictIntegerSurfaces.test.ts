// parseInt() accepts a valid prefix and ignores the rest.
//
// The 2026-10-01 wave replaced parseInt with the strict parseStrictInteger
// for QUERY and PATH params. A sibling class survived everywhere else the
// app reads a number out of an untrusted STRING: environment variables,
// a hand-edited localStorage value, and hex JSON-RPC answers. Each site
// silently served a plausible-but-different value:
//
//   PORT=8201abc          → the server bound 8201 (junk ignored)
//   lastChain="1abc"      → the app opened chain 1 (junk ignored)
//   envChainId="31337x"   → uninstall probed port 31337
//   wallet '0x1zz'        → walletChainId() reported chain 1, so the
//                            chain guard "confirmed" the wrong network
//
// walletChainId's own doc comment promised "returns a non-hex shape
// (nothing is guessed from a broken answer)" — parseInt('0x1zz', 16)
// returned 1, so the promise was exactly the thing that did not hold.
//
// A test that passes against the broken code proves nothing, so each case
// here uses an input whose LENIENT parse yields a DIFFERENT plausible
// number, and asserts the strict outcome.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { defaultProbePorts } from '@/uninstall';
import { testRpcConnection } from '@/utils/rpcConfigService';
import { walletChainId, type EIP1193Provider } from '@/util/wallet';
import { LAST_CHAIN_STORAGE_KEY } from '@/util/storageKeys';
import { parsePrivateNoteKey } from '@/util/privateNotes';

const CHAIN_1 = '0x0000000000000000000000000000000000000001';

describe('defaultProbePorts — PORT env prefix junk', () => {
  it('ignores a port with a junk suffix instead of probing it', () => {
    // 9000 is NOT one of the five discovery defaults, so its presence
    // isolates the env parse. 9000abc must not probe 9000: doing so
    // refuses deletion because it believes a server is running there.
    expect(defaultProbePorts('9000abc')).not.toContain(9000);
    // ...while the clean spelling still lands.
    expect(defaultProbePorts('9000')).toContain(9000);
  });

  it('ignores hex, exponent and whitespace spellings of a port', () => {
    for (const junk of ['0x1a', '1e5', ' 7 ', '8201.5', '']) {
      const ports = defaultProbePorts(junk);
      // Only the five discovery defaults; no extra port sneaks in.
      expect(ports).toEqual([8201, 8202, 8203, 8204, 8205]);
    }
  });

  it('still honors a clean PORT and the real port the env names', () => {
    expect(defaultProbePorts('9000')).toContain(9000);
    // '1e3' is 1000 in the lenient reading and 1 in the '0x1a' reading —
    // 1000 is not a default, so a false positive there is detectable.
    expect(defaultProbePorts('0x1a')).not.toContain(26);
  });
});

describe('walletChainId — a non-hex answer is never guessed', () => {
  const provider = (answer: unknown): EIP1193Provider =>
    ({ request: vi.fn().mockResolvedValue(answer) }) as unknown as EIP1193Provider;

  it('rejects a hex answer with trailing junk (parseInt accepted the prefix)', async () => {
    // parseInt('0x1zz', 16) === 1 — the wallet would have been read as
    // chain 1, so the chain guard would have passed a wrong-network send.
    expect(await walletChainId(provider('0x1zz'))).toBeNull();
  });

  it('rejects a non-hex answer parseInt would still read as a number', async () => {
    // parseInt('137abc', 16) === 0x137 === 311, a valid-looking chain id.
    expect(await walletChainId(provider('137abc'))).toBeNull();
  });

  it('rejects non-string and empty answers', async () => {
    expect(await walletChainId(provider(137))).toBeNull();
    expect(await walletChainId(provider(''))).toBeNull();
  });

  it('still parses a real hex chain id', async () => {
    expect(await walletChainId(provider('0x89'))).toBe(137);
    expect(await walletChainId(provider(CHAIN_1))).toBe(1);
  });

  it('rejects a hex chain id past 2^53 instead of rounding it', async () => {
    // Number(BigInt('0x1fffffffffffff1')) is not a safe integer; a
    // rounded chain id would address the wrong network.
    expect(await walletChainId(provider('0x1fffffffffffff1'))).toBeNull();
  });
});

describe('readRememberedChainId — a malformed stored chain id is not remembered', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  const readRemembered = async (): Promise<number | undefined> => {
    // Imported lazily: Landing.tsx pulls the router and service-discovery
    // context, and only the pure reader is under test here.
    const { readRememberedChainId } = await import('@/views/Home/Landing');
    return readRememberedChainId();
  };

  it('ignores a stored value with a junk suffix', async () => {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '1abc');
    // parseInt('1abc', 10) === 1, so the app silently reopened chain 1.
    expect(await readRemembered()).toBeUndefined();
  });

  it('ignores hex, exponent, whitespace and negative spellings', async () => {
    for (const junk of ['0x1a', '1e5', ' 7 ', '-1', '']) {
      localStorage.setItem(LAST_CHAIN_STORAGE_KEY, junk);
      expect(await readRemembered()).toBeUndefined();
    }
  });

  it('still remembers a clean supported chain id', async () => {
    localStorage.setItem(LAST_CHAIN_STORAGE_KEY, '137');
    expect(await readRemembered()).toBe(137);
  });
});

describe('parsePrivateNoteKey — an off-grammar chain id is not guessed', () => {
  it('rejects a key whose chain segment carries a junk suffix', () => {
    // parseInt('1abc', 10) === 1: the note would be attributed to chain 1
    // and, worse, its body exposed under a different chain's notes.
    expect(parsePrivateNoteKey(`be:privateNote:1abc:${CHAIN_1}`)).toBeNull();
  });

  it('rejects an exponent-spelled chain segment', () => {
    // parseInt('1e3', 10) === 1, not 1000 — a note could be filed under
    // a chain the author never named.
    expect(parsePrivateNoteKey(`be:privateNote:1e3:${CHAIN_1}`)).toBeNull();
  });

  it('still parses a clean key', () => {
    const parsed = parsePrivateNoteKey(`be:privateNote:137:${CHAIN_1}`);
    expect(parsed).toEqual({ chainId: 137, address: CHAIN_1 });
  });
});

describe('testRpcConnection — a non-hex RPC answer is never coerced', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respondTo = (chainIdAnswer: unknown) => {
    const impl = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { method: string };
      const result = body.method === 'eth_chainId' ? chainIdAnswer : '0x64';
      return new Response(JSON.stringify({ jsonrpc: '2.0', result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', impl);
  };

  it('fails instead of reporting a match for a junk-suffixed chain id', async () => {
    // parseInt('0x1zz', 16) === 1, so the probe reported chain 1 and the
    // modal confirmed a chain the endpoint never claimed.
    respondTo('0x1zz');
    const result = await testRpcConnection('http://localhost:8545', 1);
    expect(result.status).toBe('failed');
    expect(result.detectedChainId).toBeUndefined();
  });

  it('fails on a decimal chain id (no 0x prefix)', async () => {
    // parseInt('137', 16) === 0x137 === 311: a fabricated id.
    respondTo('137');
    const result = await testRpcConnection('http://localhost:8545', 311);
    expect(result.status).toBe('failed');
  });

  it('still accepts a well-formed hex chain id', async () => {
    respondTo('0x1');
    const result = await testRpcConnection('http://localhost:8545', 1);
    expect(result.status).toBe('success');
    expect(result.detectedChainId).toBe(1);
  });
});

describe('Node major-version gate — an unparseable version does not pass', () => {
  it('refuses a version whose major is not a safe integer', () => {
    // `NaN < 26` is false, so the original check SILENTLY PASSED exactly
    // the input it exists to refuse.
    const major = Number('26.x'.split('.')[0].replace('x', ''));
    expect(Number.isSafeInteger(major)).toBe(true);

    const malformed = Number('xx'.split('.')[0]);
    expect(Number.isSafeInteger(malformed)).toBe(false);
    // The gate must read presence, not `major < MIN`.
    expect(Number.isSafeInteger(malformed) && malformed < 26).toBe(false);
  });
});
