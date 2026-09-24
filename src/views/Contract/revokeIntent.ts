// ?revoke= intent codec for the in-product approval-revoke flow.
//
// The Address page's Approvals card links each live approval row to the
// token contract's Interact tab with a compact, URL-safe description of
// WHAT to revoke; the Contract view decodes it (Contract/index.tsx owns
// the search param, ContractInteract consumes the decoded intent) and
// pre-fills the standard revocation call on the existing wallet-send
// form. The wire format is deliberately dumb and strictly validated —
// `1.<kind>.<token>.<spender>[.<tokenId>]`, lowercase hex addresses and
// canonical decimal token ids — so any tampering or truncation that
// breaks the shape decodes to null and the Interact panel renders as if
// no intent had been passed (never a crash, never a guessed revoke).
// The intent names public on-chain state only: no signatures, no secrets.

import { parseAbi } from 'viem';

export type RevokeKind = 'erc20' | 'erc721' | 'erc1155';

export type RevokeIntent = {
  kind: RevokeKind;
  /** Token contract the approval lives on (lowercase 0x address). */
  token: string;
  /** Approved spender (erc20/erc721) or operator (erc1155), lowercase. */
  spender: string;
  /** erc721 only: the approved token id, canonical decimal string. */
  tokenId?: string;
};

const REVOKE_VERSION = '1';
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const TOKEN_ID_PATTERN = /^\d+$/;

// Address(0): the ERC-721 revoke target — approving the zero address
// clears a single token's approval (the standard's own idiom).
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

// Bundled single-function standard ABIs (JSON strings). Used when the
// contract's verified ABI does not carry the exact signature: the
// selector only depends on name + input types, so the fragment encodes
// the same calldata any compliant token would. Output types follow each
// standard (ERC-20 approve returns bool; the 721/1155 setters return
// nothing) so decoded simulations match the standard's shape.
const REVOKE_FRAGMENTS: Record<RevokeKind, string> = {
  erc20: JSON.stringify(
    parseAbi(['function approve(address spender, uint256 value) returns (bool)']),
  ),
  erc721: JSON.stringify(parseAbi(['function approve(address to, uint256 tokenId)'])),
  erc1155: JSON.stringify(
    parseAbi(['function setApprovalForAll(address operator, bool approved)']),
  ),
};

// Canonicalizes and validates one intent; every field that fails its
// exact shape makes the whole intent null (encode and decode share this,
// which is what makes the codec roundtrip-safe).
const validateIntent = (
  kind: string,
  token: string,
  spender: string,
  tokenId: string | undefined,
): RevokeIntent | null => {
  if (kind !== 'erc20' && kind !== 'erc721' && kind !== 'erc1155') return null;
  const normalizedToken = token.trim().toLowerCase();
  const normalizedSpender = spender.trim().toLowerCase();
  if (!ADDRESS_PATTERN.test(normalizedToken)) return null;
  if (!ADDRESS_PATTERN.test(normalizedSpender)) return null;
  if (kind === 'erc721') {
    if (tokenId === undefined || !TOKEN_ID_PATTERN.test(tokenId)) return null;
    // Canonical decimal: no leading zeros, so visually-equal intents
    // encode to byte-identical strings.
    return {
      kind,
      token: normalizedToken,
      spender: normalizedSpender,
      tokenId: String(BigInt(tokenId)),
    };
  }
  // A token id on a non-721 intent is a shape violation, not extra data.
  if (tokenId !== undefined) return null;
  return { kind, token: normalizedToken, spender: normalizedSpender };
};

/** Encodes an intent into the URL-safe `?revoke=` payload; invalid input → null. */
export const encodeRevokeIntent = (intent: RevokeIntent): string | null => {
  const canonical = validateIntent(intent.kind, intent.token, intent.spender, intent.tokenId);
  if (canonical === null) return null;
  const parts = [REVOKE_VERSION, canonical.kind, canonical.token, canonical.spender];
  if (canonical.kind === 'erc721') parts.push(canonical.tokenId ?? '');
  return parts.join('.');
};

/** Decodes a `?revoke=` payload back into an intent; any malformed input → null. */
export const decodeRevokeIntent = (raw: string): RevokeIntent | null => {
  const parts = raw.split('.');
  // [version, kind, token, spender] — plus exactly one tokenId part for 721.
  if (parts.length !== 4 && parts.length !== 5) return null;
  const [version, kind, token, spender, tokenId] = parts;
  if (version !== REVOKE_VERSION) return null;
  if (kind === 'erc721') {
    if (tokenId === undefined) return null;
  } else if (tokenId !== undefined) {
    return null;
  }
  return validateIntent(kind, token, spender, tokenId);
};

/** The standard revocation call one intent maps onto (args are raw form-input strings). */
export type RevokeCall = {
  kind: RevokeKind;
  /** Canonical signature (selector source): `name(inputTypes)`. */
  signature: string;
  functionName: string;
  /** Raw argument prefill strings — exactly what a user could type. */
  args: readonly string[];
  /** Bundled standard-ABI fragment (JSON string) for the fallback path. */
  fragmentAbi: string;
  /** Honest one-liner about what broadcasting this call does. */
  summary: string;
};

/** Maps a valid intent onto its standard revocation call; invalid intent → null. */
export const buildRevokeCall = (intent: RevokeIntent): RevokeCall | null => {
  const canonical = validateIntent(intent.kind, intent.token, intent.spender, intent.tokenId);
  if (canonical === null) return null;
  switch (canonical.kind) {
    case 'erc20':
      return {
        kind: 'erc20',
        signature: 'approve(address,uint256)',
        functionName: 'approve',
        args: [canonical.spender, '0'],
        fragmentAbi: REVOKE_FRAGMENTS.erc20,
        summary:
          `approve(${canonical.spender}, 0) sets this spender's allowance to zero — ` +
          'the standard ERC-20 revoke.',
      };
    case 'erc721':
      return {
        kind: 'erc721',
        signature: 'approve(address,uint256)',
        functionName: 'approve',
        args: [ZERO_ADDRESS, canonical.tokenId ?? ''],
        fragmentAbi: REVOKE_FRAGMENTS.erc721,
        summary:
          `approve(${ZERO_ADDRESS}, ${canonical.tokenId}) clears the approval for ` +
          `token #${canonical.tokenId} only — other tokens and operator approvals ` +
          'keep their state.',
      };
    case 'erc1155':
      return {
        kind: 'erc1155',
        signature: 'setApprovalForAll(address,bool)',
        functionName: 'setApprovalForAll',
        args: [canonical.spender, 'false'],
        fragmentAbi: REVOKE_FRAGMENTS.erc1155,
        summary:
          `setApprovalForAll(${canonical.spender}, false) revokes this operator's ` +
          'access to every token id of this contract.',
      };
  }
};

// Structural slice of the parsed function list (EnhancedContractFunction
// satisfies it) — keeps this module free of React/panel imports.
export type RevokeFunctionCandidate = {
  name: string;
  inputs: readonly { type: string }[];
  interactionType?: string;
};

export type RevokeTargetSelection = {
  call: RevokeCall;
  /**
   * 'verified-abi': the contract's own ABI carries the exact signature —
   * preferred, because a non-standard token may define a same-signature
   * function with different behavior.
   * 'standard-fragment': the bundled standard ABI stands in.
   */
  source: 'verified-abi' | 'standard-fragment';
};

/**
 * Resolves which function surface a revoke intent should use: the
 * contract's verified ABI when it contains a WRITE function with the
 * exact canonical signature, otherwise the bundled standard fragment.
 */
export const resolveRevokeTarget = (
  intent: RevokeIntent,
  verifiedFunctions: readonly RevokeFunctionCandidate[],
): RevokeTargetSelection | null => {
  const call = buildRevokeCall(intent);
  if (call === null) return null;
  const verifiedHasSignature = verifiedFunctions.some(func => {
    if (func.interactionType === 'read') return false;
    if (func.name !== call.functionName) return false;
    const signature = `${func.name}(${func.inputs.map(input => input.type).join(',')})`;
    return signature === call.signature;
  });
  return { call, source: verifiedHasSignature ? 'verified-abi' : 'standard-fragment' };
};
