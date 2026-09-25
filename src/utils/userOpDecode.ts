/**
 * Pure ERC-4337 (account abstraction) UserOperation decoding utilities.
 *
 * Wire layouts follow eth-infinitism/account-abstraction (the EntryPoint
 * reference implementation):
 * - v0.6 bundles UserOperations as a flat 11-field tuple.
 * - v0.7 and v0.8 share the IDENTICAL packed 9-field wire tuple: bytes32
 *   accountGasLimits (high 128 bits = verificationGasLimit, low 128 bits =
 *   callGasLimit) and bytes32 gasFees (high 128 bits = maxPriorityFeePerGas,
 *   low 128 bits = maxFeePerGas), so one packed decoder serves both versions.
 * - The UserOperationEvent ABI DIFFERS between them: v0.6/v0.7 index
 *   (sender, paymaster, nonce); v0.8 indexes (userOpHash, sender, paymaster)
 *   and moves nonce into the data section.
 *
 * This module is pure (no React/DOM/network) and total: every decode entry
 * point returns null or skips malformed entries instead of throwing.
 */
import {
  decodeAbiParameters,
  encodeAbiParameters,
  encodeEventTopics,
  getAddress,
  parseAbi,
  parseAbiParameters,
  slice,
  toFunctionSelector,
  type Address,
  type Hex,
} from 'viem';

export type UserOpVersion = 'v0.6' | 'v0.7' | 'v0.8';

export type DecodedUserOp = {
  sender: Address;
  nonce: bigint;
  paymaster: Address | null;
  /** First 4 bytes of callData ('0x' when callData is shorter). */
  callDataSelector: Hex;
  /** True when initCode is non-empty (account deployment attached). */
  initCodePresent: boolean;
  gasLimits: { call: bigint; verification: bigint; pre: bigint };
};

export type UserOpEventResult = {
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
};

export type DecodedUserOperationEvent = {
  sender: Address;
  /** address(0) emitted by the EntryPoint is normalized to null. */
  paymaster: Address | null;
  nonce: bigint;
  success: boolean;
  actualGasCost: bigint;
  actualGasUsed: bigint;
  /** Documents which UserOperationEvent ABI the log matched. */
  variant: 'v0.6/v0.7' | 'v0.8';
};

/** Log fragments as they arrive from RPC (topics/data may be absent). */
type UserOpLogLike = { topics?: readonly string[] | null; data?: string | null };

/** Canonical EntryPoint addresses (EIP-55 checksummed). */
export const ENTRY_POINT_ADDRESSES: Record<UserOpVersion, Address> = {
  'v0.6': '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
  'v0.7': '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
  'v0.8': '0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108',
};

const ENTRY_POINT_VERSIONS = ['v0.6', 'v0.7', 'v0.8'] as const satisfies readonly UserOpVersion[];

const ENTRY_POINT_VERSION_BY_ADDRESS = new Map<string, UserOpVersion>(
  ENTRY_POINT_VERSIONS.map((version) => [ENTRY_POINT_ADDRESSES[version].toLowerCase(), version] as const),
);

/** Resolves which EntryPoint version an address belongs to (case-insensitive). */
export function entryPointVersionForAddress(addr: string | null | undefined): UserOpVersion | null {
  if (!addr?.startsWith('0x')) return null;
  return ENTRY_POINT_VERSION_BY_ADDRESS.get(addr.toLowerCase()) ?? null;
}

// Event ABIs. topic0 values are computed (never hardcoded) from these.
const USER_OPERATION_EVENT_ABI = parseAbi([
  'event UserOperationEvent(address indexed sender, address indexed paymaster, uint256 indexed nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
]);
const USER_OPERATION_EVENT_V8_ABI = parseAbi([
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
]);

/** topic0 of the v0.6/v0.7 UserOperationEvent. */
export const userOperationEventTopic0: Hex = encodeEventTopics({
  abi: USER_OPERATION_EVENT_ABI,
  eventName: 'UserOperationEvent',
})[0];
/** topic0 of the v0.8 UserOperationEvent. */
export const userOperationEventV8Topic0: Hex = encodeEventTopics({
  abi: USER_OPERATION_EVENT_V8_ABI,
  eventName: 'UserOperationEvent',
})[0];
/** Both topic0 variants, for log filtering. */
export const USER_OPERATION_EVENT_TOPICS: readonly Hex[] = [
  userOperationEventTopic0,
  userOperationEventV8Topic0,
];

const CLASSIC_TOPIC0_LOWER = userOperationEventTopic0.toLowerCase();
const V8_TOPIC0_LOWER = userOperationEventV8Topic0.toLowerCase();

// Data-section layouts: classic (bool,uint256,uint256); v0.8 (nonce first).
const CLASSIC_EVENT_DATA_PARAMS = parseAbiParameters('bool, uint256, uint256');
const V8_EVENT_DATA_PARAMS = parseAbiParameters('uint256, bool, uint256, uint256');

// handleOps wire formats. v0.6 is flat; v0.7/v0.8 share the packed tuple.
const V6_HANDLE_OPS_SIGNATURE =
  'function handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[] ops, address beneficiary)';
const PACKED_HANDLE_OPS_SIGNATURE =
  'function handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[] ops, address beneficiary)';

const V6_HANDLE_OPS_SELECTOR = toFunctionSelector(V6_HANDLE_OPS_SIGNATURE);
const PACKED_HANDLE_OPS_SELECTOR = toFunctionSelector(PACKED_HANDLE_OPS_SIGNATURE);

const V6_OPS_PARAMS = parseAbiParameters(
  '(address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[] ops, address beneficiary',
);
const PACKED_OPS_PARAMS = parseAbiParameters(
  '(address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[] ops, address beneficiary',
);

const UINT_128_MASK = (1n << 128n) - 1n;

/**
 * Paymaster address from paymasterAndData: '0x'/empty means no paymaster;
 * otherwise bytes[0:20] are the address and the rest is opaque. Tails that
 * are non-empty but shorter than 20 bytes are treated as absent (defensive).
 */
function paymasterFrom(paymasterAndData: Hex): Address | null {
  if (paymasterAndData.length < 42) return null; // '0x' + 40 hex chars
  return getAddress(slice(paymasterAndData, 0, 20));
}

function callDataSelectorOf(callData: Hex): Hex {
  return callData.length >= 10 ? slice(callData, 0, 4) : '0x';
}

/** Last 20 bytes of a 32-byte topic word as a checksummed address. */
function addressFromTopicWord(topic: string): Address {
  return getAddress(slice(topic as Hex, 12));
}

/** Like addressFromTopicWord but maps the zero address to null. */
function addressOrNullFromTopicWord(topic: string): Address | null {
  const word = slice(topic as Hex, 12);
  if (BigInt(word) === 0n) return null;
  return getAddress(word);
}

/** Decodes a v0.6 flat-tuple handleOps tail. Returns null on any mismatch. */
function decodeV6OpsTail(tail: Hex): DecodedUserOp[] | null {
  const decoded = decodeAbiParameters(V6_OPS_PARAMS, tail);
  // Canonical re-encode guard: viem leniently fabricates missing bytes for
  // tail-truncated dynamic data, so only a byte-exact round trip is sound.
  if (encodeAbiParameters(V6_OPS_PARAMS, decoded).toLowerCase() !== tail.toLowerCase()) return null;
  const [ops] = decoded;
  return ops.map((op) => ({
    sender: getAddress(op[0]),
    nonce: op[1],
    paymaster: paymasterFrom(op[9]),
    callDataSelector: callDataSelectorOf(op[3]),
    initCodePresent: op[2].length > 2,
    // (callGasLimit, verificationGasLimit, preVerificationGas) are flat fields.
    gasLimits: { call: op[4], verification: op[5], pre: op[6] },
  }));
}

/** Decodes a v0.7/v0.8 packed-tuple handleOps tail. Returns null on any mismatch. */
function decodePackedOpsTail(tail: Hex): DecodedUserOp[] | null {
  const decoded = decodeAbiParameters(PACKED_OPS_PARAMS, tail);
  if (encodeAbiParameters(PACKED_OPS_PARAMS, decoded).toLowerCase() !== tail.toLowerCase()) return null;
  const [ops] = decoded;
  return ops.map((op) => {
    // accountGasLimits: high 128 bits = verificationGasLimit, low = callGasLimit.
    const accountGasLimits = BigInt(op[4]);
    return {
      sender: getAddress(op[0]),
      nonce: op[1],
      paymaster: paymasterFrom(op[7]),
      callDataSelector: callDataSelectorOf(op[3]),
      initCodePresent: op[2].length > 2,
      gasLimits: {
        call: accountGasLimits & UINT_128_MASK,
        verification: accountGasLimits >> 128n,
        pre: op[5],
      },
    };
  });
}

type HandleOpsWire = {
  selector: Hex;
  decodeTail: (tail: Hex) => DecodedUserOp[] | null;
};

const HANDLE_OPS_WIRES: Record<UserOpVersion, HandleOpsWire> = {
  'v0.6': { selector: V6_HANDLE_OPS_SELECTOR, decodeTail: decodeV6OpsTail },
  // v0.7 and v0.8 share the identical packed wire tuple.
  'v0.7': { selector: PACKED_HANDLE_OPS_SELECTOR, decodeTail: decodePackedOpsTail },
  'v0.8': { selector: PACKED_HANDLE_OPS_SELECTOR, decodeTail: decodePackedOpsTail },
};

/**
 * Decodes EntryPoint handleOps calldata into UserOperations for the given
 * EntryPoint version. Returns null when the data is not a valid canonical
 * encoding for that version (wrong selector, truncated tail, garbage); never
 * throws. An empty ops array decodes to [].
 */
export function decodeHandleOps(data: string, version: UserOpVersion): DecodedUserOp[] | null {
  try {
    if (!data.startsWith('0x') || data.length < 10) return null; // '0x' + 4-byte selector
    const wire = HANDLE_OPS_WIRES[version];
    if (data.slice(0, 10).toLowerCase() !== wire.selector.toLowerCase()) return null;
    // Strip the 4-byte selector (byte offset 4 to the end) for ABI decoding.
    return wire.decodeTail(slice(data as Hex, 4));
  } catch {
    return null;
  }
}

function decodeUserOperationEvent(log: UserOpLogLike): DecodedUserOperationEvent | null {
  try {
    const topics = log.topics ?? [];
    const topic0 = topics[0]?.toLowerCase();
    if (topic0 === CLASSIC_TOPIC0_LOWER) {
      // topics = [topic0, sender, paymaster, nonce]
      if (topics.length !== 4) return null;
      const [success, actualGasCost, actualGasUsed] = decodeAbiParameters(
        CLASSIC_EVENT_DATA_PARAMS,
        (log.data ?? '0x') as Hex,
      );
      return {
        sender: addressFromTopicWord(topics[1]),
        paymaster: addressOrNullFromTopicWord(topics[2]),
        nonce: BigInt(topics[3]),
        success,
        actualGasCost,
        actualGasUsed,
        variant: 'v0.6/v0.7',
      };
    }
    if (topic0 === V8_TOPIC0_LOWER) {
      // topics = [topic0, userOpHash, sender, paymaster]; nonce lives in data.
      if (topics.length !== 4) return null;
      const [nonce, success, actualGasCost, actualGasUsed] = decodeAbiParameters(
        V8_EVENT_DATA_PARAMS,
        (log.data ?? '0x') as Hex,
      );
      return {
        sender: addressFromTopicWord(topics[2]),
        paymaster: addressOrNullFromTopicWord(topics[3]),
        nonce,
        success,
        actualGasCost,
        actualGasUsed,
        variant: 'v0.8',
      };
    }
    return null;
  } catch {
    // One malformed log never aborts the batch.
    return null;
  }
}

/**
 * Extracts UserOperationEvents from raw logs (both the v0.6/v0.7 and the
 * v0.8 variants). Logs that do not match either topic0, or that fail to
 * decode, are skipped.
 */
export function decodeUserOperationEvents(
  logs: readonly UserOpLogLike[],
): DecodedUserOperationEvent[] {
  const events: DecodedUserOperationEvent[] = [];
  for (const log of logs) {
    const event = decodeUserOperationEvent(log);
    if (event) events.push(event);
  }
  return events;
}

/**
 * Joins decoded UserOperationEvents to decoded ops by lowercase(sender) +
 * nonce. The result is aligned index-for-index with decodedOps (undefined
 * where no event matched). When several events share a key, the LAST one
 * wins (the EntryPoint emits one event per op; duplicates favor the newest).
 */
export function matchUserOpResults(
  logs: readonly UserOpLogLike[],
  decodedOps: readonly DecodedUserOp[],
): (UserOpEventResult | undefined)[] {
  const resultsByOpKey = new Map<string, UserOpEventResult>();
  for (const event of decodeUserOperationEvents(logs)) {
    resultsByOpKey.set(`${event.sender.toLowerCase()}:${event.nonce}`, {
      success: event.success,
      actualGasCost: event.actualGasCost,
      actualGasUsed: event.actualGasUsed,
    });
  }
  return decodedOps.map((op) => resultsByOpKey.get(`${op.sender.toLowerCase()}:${op.nonce}`));
}
