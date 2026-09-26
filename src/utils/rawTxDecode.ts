// Raw signed-transaction decoder for the broadcast page. Pure and total:
// every failure path (empty input, non-hex input, odd-length payload, wrong
// RLP shape, unknown envelope type) resolves to `{ ok: false, error }` with
// one human sentence — decoding pasted user input must never throw.
//
// Honesty model: a successful decode proves ONLY that the bytes are a
// structurally valid serialized transaction. It says nothing about whether
// any network will accept it: balance, nonce freshness, gas adequacy and
// chain membership are not checked here. `from` is recovered from the
// signature and is null when the signature is absent or undecodable —
// null is not an error, unsigned payloads are still decodable. `dataPreview`
// is a display-only truncation of the input data, never a claim about the
// full calldata.
//
// Async note — do not "simplify" this to a sync function: in viem 2.56.5
// `parseTransaction` never recovers the sender (its result type omits `from`
// entirely), and the only sender-recovery APIs viem exposes
// (`recoverTransactionAddress`/`recoverAddress`) are async because they load
// `@noble/curves` through a dynamic import. `@noble/*` is a transitive
// dependency of viem and cannot be imported from app code under pnpm's
// isolated layout, and Node's built-in crypto has no ECDSA public-key
// recovery — so viem's async recovery is the only honest source of `from`,
// and the whole decode is async by necessity. Everything else about the
// result is plain, sync-friendly data.
//
// `from` honesty: null means the signature is absent or undecodable — it is
// never a guess, never defaulted, and null is not an error (unsigned
// payloads are still structurally decodable).
import {
  parseTransaction,
  recoverTransactionAddress,
  type Hex,
  type TransactionSerialized,
} from 'viem';

export type DecodedRawTransaction = {
  type: 'legacy' | 'eip2930' | 'eip1559' | 'eip4844' | 'eip7702';
  /** Chain ID the transaction is valid on; null only for pre-EIP-155 legacy. */
  chainId: number | null;
  /** ECDSA-recovered sender; null when the signature is absent or undecodable. */
  from: `0x${string}` | null;
  /** Recipient; null means contract creation. */
  to: `0x${string}` | null;
  /** Value in wei. */
  value: bigint;
  /** Account nonce as of signing. */
  nonce: bigint;
  /** Gas limit. */
  gas: bigint;
  /** Legacy / EIP-2930 fee field, in wei. */
  gasPrice?: bigint;
  /** EIP-1559 / EIP-4844 / EIP-7702 fee cap, in wei. */
  maxFeePerGas?: bigint;
  /** EIP-1559 / EIP-4844 / EIP-7702 priority fee, in wei. */
  maxPriorityFeePerGas?: bigint;
  /** EIP-4844 blob fee cap, in wei. */
  maxFeePerBlobGas?: bigint;
  /** EIP-4844 blob versioned hashes. */
  blobVersionedHashes?: `0x${string}`[];
  /** Number of entries in the EIP-2930 access list. */
  accessListLength?: number;
  /** Number of entries in the EIP-7702 authorization list. */
  authorizationListLength?: number;
  /** Exact byte length of the input data. */
  dataByteLength: number;
  /** Capped hex preview of the input data (display-only). */
  dataPreview: string;
};

export type RawTransactionDecodeResult =
  | { ok: true; tx: DecodedRawTransaction }
  | { ok: false; error: string };

// 136 hex characters = 68 bytes: a 4-byte selector plus a couple of words,
// enough for a human to recognize the shape of common calldata.
const DATA_PREVIEW_HEX_CHARS = 136;

// Error causes are inlined into a single sentence; anything longer than this
// is truncated so the failure line stays readable in the UI.
const ERROR_CAUSE_MAX_CHARS = 140;

const HEX_BODY_PATTERN = /^(?:[0-9a-fA-F]{2})*$/;

function invalid(reason: string): RawTransactionDecodeResult {
  return { ok: false, error: `Not a valid signed raw transaction (${reason}).` };
}

/**
 * Decode a raw (serialized, hex) transaction into its typed fields.
 * Total: never throws — every malformed input resolves to
 * `{ ok: false, error }` with one human sentence.
 */
export async function decodeRawTransaction(
  raw: string,
): Promise<RawTransactionDecodeResult> {
  if (typeof raw !== 'string') return invalid('input must be a string');
  const trimmed = raw.trim();
  if (trimmed === '') return invalid('input is empty');
  if (!trimmed.startsWith('0x'))
    return invalid('input must be a 0x-prefixed hex string');
  const body = trimmed.slice(2);
  if (body === '') return invalid('input has no bytes after the 0x prefix');
  if (body.length % 2 !== 0)
    return invalid('hex payload has an odd number of digits');
  if (!HEX_BODY_PATTERN.test(body))
    return invalid('hex payload contains non-hexadecimal characters');

  let parsed;
  try {
    // Throws on every malformed shape (wrong field count, bad addresses,
    // invalid v, unknown envelope type byte).
    parsed = parseTransaction(trimmed as Hex);
  } catch (error) {
    return invalid(describeError(error));
  }

  // viem's parse result omits `type` only for legacy payloads; every typed
  // envelope sets its literal type explicitly.
  const tx: DecodedRawTransaction = {
    type: parsed.type ?? 'legacy',
    chainId: parsed.chainId ?? null,
    from: await recoverSender(trimmed as Hex),
    to: parsed.to ?? null,
    value: parsed.value ?? 0n,
    nonce: BigInt(parsed.nonce ?? 0),
    gas: parsed.gas ?? 0n,
    dataByteLength: dataByteLengthOf(parsed.data),
    dataPreview: dataPreviewOf(parsed.data),
  };

  // Fee fields are attached when the envelope carries a value (viem omits
  // zero fees from its parse result; absence of the property mirrors that).
  if (parsed.gasPrice !== undefined) tx.gasPrice = parsed.gasPrice;
  if (parsed.maxFeePerGas !== undefined) tx.maxFeePerGas = parsed.maxFeePerGas;
  if (parsed.maxPriorityFeePerGas !== undefined)
    tx.maxPriorityFeePerGas = parsed.maxPriorityFeePerGas;
  if (parsed.maxFeePerBlobGas !== undefined)
    tx.maxFeePerBlobGas = parsed.maxFeePerBlobGas;
  if (parsed.blobVersionedHashes !== undefined)
    tx.blobVersionedHashes = [...parsed.blobVersionedHashes];

  // List-length fields are attached by ENVELOPE TYPE, not by whether viem
  // populated them: an empty access list or authorization list serializes to
  // '0x' and viem drops the field entirely on parse — the type still carries
  // the field, so its length is honestly reported as 0.
  if (
    tx.type === 'eip2930' ||
    tx.type === 'eip1559' ||
    tx.type === 'eip4844' ||
    tx.type === 'eip7702'
  ) {
    tx.accessListLength = parsed.accessList?.length ?? 0;
  }
  if (tx.type === 'eip7702') {
    tx.authorizationListLength = parsed.authorizationList?.length ?? 0;
  }

  return { ok: true, tx };
}

/**
 * Recover the sender address from the transaction signature via viem, which
 * handles the signing-hash construction of every envelope family (EIP-155 v,
 * yParity, EIP-4844 network wrappers, EIP-7702). Returns null — not an
 * error — when the signature is absent or undecodable.
 */
async function recoverSender(serialized: Hex): Promise<`0x${string}` | null> {
  try {
    return await recoverTransactionAddress({
      serializedTransaction: serialized as TransactionSerialized,
    });
  } catch {
    return null;
  }
}

function dataByteLengthOf(data: Hex | undefined): number {
  // Hex strings from viem always have an even body, so this is exact.
  return ((data?.length ?? 2) - 2) / 2;
}

function dataPreviewOf(data: Hex | undefined): string {
  const body = data?.slice(2) ?? '';
  return body.length > DATA_PREVIEW_HEX_CHARS
    ? `0x${body.slice(0, DATA_PREVIEW_HEX_CHARS)}…`
    : data ?? '0x';
}

// Prefer viem's `shortMessage` (a human one-liner) over the full message,
// collapse whitespace, and cap the length so the error stays one sentence.
function describeError(error: unknown): string {
  const short = (error as { shortMessage?: unknown } | null)?.shortMessage;
  const message =
    typeof short === 'string' && short !== ''
      ? short
      : error instanceof Error && error.message !== ''
        ? error.message
        : 'unrecognized error';
  const flat = message.replace(/\s+/g, ' ').trim();
  return flat.length > ERROR_CAUSE_MAX_CHARS
    ? `${flat.slice(0, ERROR_CAUSE_MAX_CHARS - 3)}...`
    : flat;
}
