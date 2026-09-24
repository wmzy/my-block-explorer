// RevokeIntent codec + revocation-call derivation: encode→decode roundtrip
// for all three kinds, strict malformed→null degradation (the Interact
// panel must never crash or guess on a tampered ?revoke= payload),
// canonicalization, the per-kind call mapping (function, args, fragment),
// and the function-selection preference — a verified ABI carrying the
// exact write signature wins over the bundled standard fragment.
import { describe, it, expect } from 'vitest';
import {
  buildRevokeCall,
  decodeRevokeIntent,
  encodeRevokeIntent,
  resolveRevokeTarget,
  type RevokeIntent,
} from '@/views/Contract/revokeIntent';

const TOKEN = '0xaabbccddeeff00112233445566778899aabbccdd';
const TOKEN_CHECKSUMMED = '0xAaBbCcDdEeFf00112233445566778899AaBbCcDd';
const SPENDER = '0x1111111111111111111111111111111111111111';
const OPERATOR = '0x2222222222222222222222222222222222222222';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const erc20: RevokeIntent = { kind: 'erc20', token: TOKEN, spender: SPENDER };
const erc721: RevokeIntent = { kind: 'erc721', token: TOKEN, spender: SPENDER, tokenId: '77' };
const erc1155: RevokeIntent = { kind: 'erc1155', token: TOKEN, spender: OPERATOR };

describe('revokeIntent codec - roundtrip', () => {
  it('roundtrips all three kinds losslessly', () => {
    for (const intent of [erc20, erc721, erc1155]) {
      const encoded = encodeRevokeIntent(intent);
      expect(encoded).not.toBeNull();
      expect(decodeRevokeIntent(encoded as string)).toEqual(intent);
    }
  });

  it('emits URL-safe payloads (dots, hex and digits only)', () => {
    expect(encodeRevokeIntent(erc20)).toBe(`1.erc20.${TOKEN}.${SPENDER}`);
    expect(encodeRevokeIntent(erc721)).toBe(`1.erc721.${TOKEN}.${SPENDER}.77`);
    expect(encodeRevokeIntent(erc1155)).toBe(`1.erc1155.${TOKEN}.${OPERATOR}`);
  });

  it('canonicalizes on both ends: uppercase addresses and leading-zero token ids', () => {
    // Mixed-case address input → lowercase canonical form out.
    expect(
      decodeRevokeIntent(`1.erc721.${TOKEN_CHECKSUMMED}.${SPENDER}.0077`),
    ).toEqual({ kind: 'erc721', token: TOKEN, spender: SPENDER, tokenId: '77' });
    // The encoder canonicalizes too, so roundtrips are byte-stable.
    expect(
      encodeRevokeIntent({ kind: 'erc721', token: TOKEN_CHECKSUMMED, spender: SPENDER, tokenId: '0077' }),
    ).toBe(`1.erc721.${TOKEN}.${SPENDER}.77`);
  });

  it('rejects invalid intents at encode time with null (callers omit the link)', () => {
    expect(encodeRevokeIntent({ kind: 'erc20', token: '0xnope', spender: SPENDER })).toBeNull();
    expect(
      encodeRevokeIntent({ kind: 'erc721', token: TOKEN, spender: SPENDER }),
    ).toBeNull(); // missing tokenId
    expect(
      encodeRevokeIntent({ kind: 'erc721', token: TOKEN, spender: SPENDER, tokenId: '7x7' }),
    ).toBeNull();
    // A token id on a non-721 intent is a shape violation.
    expect(
      encodeRevokeIntent({ kind: 'erc1155', token: TOKEN, spender: OPERATOR, tokenId: '1' }),
    ).toBeNull();
  });
});

describe('revokeIntent codec - malformed payloads decode to null', () => {
  it('rejects version, kind, arity and shape violations', () => {
    expect(decodeRevokeIntent('')).toBeNull();
    expect(decodeRevokeIntent(`2.erc20.${TOKEN}.${SPENDER}`)).toBeNull(); // future version
    expect(decodeRevokeIntent(`1.erc223.${TOKEN}.${SPENDER}`)).toBeNull(); // unknown kind
    expect(decodeRevokeIntent(`1.erc20.${TOKEN}`)).toBeNull(); // truncated
    expect(decodeRevokeIntent(`1.erc20.${TOKEN}.${SPENDER}.77`)).toBeNull(); // id on erc20
    expect(decodeRevokeIntent(`1.erc721.${TOKEN}.${SPENDER}`)).toBeNull(); // missing id
    expect(decodeRevokeIntent(`1.erc721.${TOKEN}.${SPENDER}.abc`)).toBeNull(); // junk id
    expect(decodeRevokeIntent(`1.erc1155.${TOKEN}.0x1234`)).toBeNull(); // bad address
    expect(decodeRevokeIntent(`1.erc1155.${TOKEN}.${OPERATOR}.extra.part`)).toBeNull();
  });

  it('never throws on adversarial input', () => {
    const adversarial = [
      '.',
      '....',
      '1.erc20..',
      `1.erc20.${'0x'.padEnd(42, 'z')}.${SPENDER}`,
      `%00`,
      `1.erc20.${TOKEN}.${SPENDER}\u0000`,
    ];
    for (const payload of adversarial) {
      expect(decodeRevokeIntent(payload)).toBeNull();
    }
  });
});

describe('buildRevokeCall - per-kind standard call', () => {
  it('maps erc20 to approve(spender, 0)', () => {
    const call = buildRevokeCall(erc20);
    expect(call).toMatchObject({
      kind: 'erc20',
      signature: 'approve(address,uint256)',
      functionName: 'approve',
      args: [SPENDER, '0'],
    });
    expect(call?.summary).toContain('allowance to zero');
    // The fragment is a parseable single-function standard ABI.
    const fragment: unknown = JSON.parse(call?.fragmentAbi ?? '[]');
    expect(Array.isArray(fragment)).toBe(true);
  });

  it('maps erc721 to approve(zeroAddress, tokenId) and says it clears that one token', () => {
    const call = buildRevokeCall(erc721);
    expect(call).toMatchObject({
      kind: 'erc721',
      signature: 'approve(address,uint256)',
      functionName: 'approve',
      args: [ZERO_ADDRESS, '77'],
    });
    expect(call?.summary).toContain('token #77 only');
  });

  it('maps erc1155 to setApprovalForAll(operator, false)', () => {
    const call = buildRevokeCall(erc1155);
    expect(call).toMatchObject({
      kind: 'erc1155',
      signature: 'setApprovalForAll(address,bool)',
      functionName: 'setApprovalForAll',
      args: [OPERATOR, 'false'],
    });
    expect(call?.summary).toContain('every token id');
  });

  it('returns null for an invalid intent', () => {
    expect(buildRevokeCall({ kind: 'erc20', token: 'junk', spender: SPENDER })).toBeNull();
  });
});

describe('resolveRevokeTarget - function selection preference', () => {
  // Structural candidates as parseContractFunctionsUnified would emit.
  const fn = (name: string, inputs: readonly { type: string }[], interactionType: 'read' | 'write') => ({
    name,
    inputs,
    interactionType,
  });

  it('prefers the verified ABI when it carries the exact write signature', () => {
    const selection = resolveRevokeTarget(erc20, [
      fn('transfer', [{ type: 'address' }, { type: 'uint256' }], 'write'),
      fn('approve', [{ type: 'address' }, { type: 'uint256' }], 'write'),
    ]);
    expect(selection?.source).toBe('verified-abi');
    expect(selection?.call.functionName).toBe('approve');
  });

  it('falls back to the standard fragment when the signature is absent', () => {
    const selection = resolveRevokeTarget(erc20, [
      fn('transfer', [{ type: 'address' }, { type: 'uint256' }], 'write'),
    ]);
    expect(selection?.source).toBe('standard-fragment');
    expect(selection?.call.fragmentAbi).toContain('approve');
  });

  it('does not count a same-signature READ overload as the verified function', () => {
    const selection = resolveRevokeTarget(erc20, [
      fn('approve', [{ type: 'address' }, { type: 'uint256' }], 'read'),
    ]);
    expect(selection?.source).toBe('standard-fragment');
  });

  it('requires the exact signature — name alone or wrong arity does not match', () => {
    expect(
      resolveRevokeTarget(erc20, [fn('approve', [{ type: 'address' }], 'write')])?.source,
    ).toBe('standard-fragment');
    expect(
      resolveRevokeTarget(
        erc20,
        [fn('approve', [{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }], 'write')],
      )?.source,
    ).toBe('standard-fragment');
  });

  it('matches the 1155 setter signature against the verified surface', () => {
    const selection = resolveRevokeTarget(erc1155, [
      fn('setApprovalForAll', [{ type: 'address' }, { type: 'bool' }], 'write'),
    ]);
    expect(selection?.source).toBe('verified-abi');
  });

  it('returns null only for an invalid intent (an empty verified list still gets the fragment)', () => {
    expect(resolveRevokeTarget(erc20, [])?.source).toBe('standard-fragment');
    expect(resolveRevokeTarget({ kind: 'erc20', token: 'junk', spender: SPENDER }, [])).toBeNull();
  });
});
