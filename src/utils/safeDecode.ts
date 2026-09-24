// Safe (Gnosis Safe) multisig `execTransaction` calldata decoder. Pure and
// total: every failure path (wrong selector, malformed or truncated
// payload, argument-shape mismatch, out-of-range operation) resolves to
// null — decoding a UI hint must never throw.
//
// Honesty model: a successful decode proves ONLY that the calldata starts
// with the execTransaction selector and matches its ABI shape. It does not
// verify that the called contract is a Safe — any contract can expose the
// same selector. Callers must present the result as selector-based
// detection, never as verification.
import { decodeFunctionData, encodeFunctionData, parseAbi, type Hex } from 'viem';

// The single-function ABI fragment is local on purpose: the decode is a
// UI affordance over raw calldata, not a claim about the target's verified
// source (which may be absent or a different contract entirely).
const SAFE_EXEC_ABI = parseAbi([
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address payable refundReceiver, bytes signatures) payable returns (bool success)',
]);

// keccak256("execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)")[0:4]
const SAFE_EXEC_SELECTOR = '0x6a761202';

// Narrowing guard for viem's `0x${string}` template type: decodes of
// address/bytes params must be well-formed hex, which the shape checks
// below then rely on for the round-trip re-encode.
const isHexString = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value);

/** Safe operation enum: 0 = CALL, 1 = DELEGATECALL (anything else is malformed). */
export type SafeOperation = 'CALL' | 'DELEGATECALL';

export type DecodedSafeExecTransaction = {
  /** Inner call target (checksummed by viem's address decoding). */
  to: string;
  /** Native value forwarded by the inner call, in wei. */
  value: bigint;
  /** Inner call calldata ('0x' when the inner call is a plain transfer). */
  data: string;
  operation: SafeOperation;
  safeTxGas: bigint;
  baseGas: bigint;
  gasPrice: bigint;
  gasToken: string;
  refundReceiver: string;
  /** Verbatim signatures blob as decoded. */
  signatures: string;
  /** Exact byte length of the signatures blob. */
  signatureByteLength: number;
  /**
   * Approximate signature count: blob bytes / 65, floored. Regular ECDSA
   * owner signatures are exactly 65 bytes (r, s, v), but approved-hash
   * entries and EIP-1271 contract signatures pack their payloads
   * differently inside the same blob — so this is an ESTIMATE and must be
   * rendered with a leading '≈'.
   */
  approximateSignatureCount: number;
};

/**
 * Decode an execTransaction calldata payload into its typed fields.
 *
 * Returns null unless the input carries exactly the 0x6a761202 selector
 * AND decodes against the local ABI fragment AND re-encoding the decoded
 * arguments reproduces the input byte-for-byte — the round-trip guard
 * matters because viem's dynamic-type decoding is lenient with truncated
 * tails (it can fabricate the missing bytes instead of throwing). An
 * operation byte outside {0, 1} is malformed and also yields null.
 */
export function decodeSafeExecTransaction(
  calldata: string | undefined,
): DecodedSafeExecTransaction | null {
  if (typeof calldata !== 'string' || calldata.length < 10) return null;
  if (calldata.slice(0, 10).toLowerCase() !== SAFE_EXEC_SELECTOR) return null;

  let args: readonly unknown[];
  try {
    const decoded = decodeFunctionData({ abi: SAFE_EXEC_ABI, data: calldata as Hex });
    if (!Array.isArray(decoded.args)) return null;
    args = decoded.args;
  } catch {
    return null;
  }

  // Positional shape guards: this fragment decodes address → checksummed
  // string, uint → bigint, bytes → 0x-prefixed hex, uint8 → number.
  // Anything else is not an execTransaction payload.
  if (args.length !== 10) return null;
  const [
    to,
    value,
    data,
    operation,
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
  ] = args as readonly [
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
    unknown,
  ];
  if (
    !isHexString(to) ||
    typeof value !== 'bigint' ||
    !isHexString(data) ||
    typeof operation !== 'number' ||
    typeof safeTxGas !== 'bigint' ||
    typeof baseGas !== 'bigint' ||
    typeof gasPrice !== 'bigint' ||
    !isHexString(gasToken) ||
    !isHexString(refundReceiver) ||
    !isHexString(signatures)
  ) {
    return null;
  }

  if (operation !== 0 && operation !== 1) return null;

  // Faithfulness guard: accept the decode only when the canonical
  // re-encoding of the decoded arguments reproduces the input. Catches
  // truncated tails (see doc comment) that decode without throwing.
  try {
    const roundTrip = encodeFunctionData({
      abi: SAFE_EXEC_ABI,
      args: [
        to,
        value,
        data,
        operation,
        safeTxGas,
        baseGas,
        gasPrice,
        gasToken,
        refundReceiver,
        signatures,
      ],
    });
    if (roundTrip !== calldata.toLowerCase()) return null;
  } catch {
    return null;
  }

  const signatureByteLength = Math.max(0, Math.floor((signatures.length - 2) / 2));

  return {
    to,
    value,
    data,
    operation: operation === 1 ? 'DELEGATECALL' : 'CALL',
    safeTxGas,
    baseGas,
    gasPrice,
    gasToken,
    refundReceiver,
    signatures,
    signatureByteLength,
    approximateSignatureCount: Math.floor(signatureByteLength / 65),
  };
}
