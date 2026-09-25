import { describe, expect, it } from 'vitest';
import {
  concatBytes,
  concatHex,
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  getAddress,
  keccak256,
  numberToHex,
  parseAbi,
  parseAbiParameters,
  slice,
  toBytes,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import {
  ENTRY_POINT_ADDRESSES,
  USER_OPERATION_EVENT_TOPICS,
  decodeHandleOps,
  decodeUserOperationEvents,
  entryPointVersionForAddress,
  matchUserOpResults,
  userOperationEventTopic0,
  userOperationEventV8Topic0,
  type DecodedUserOp,
} from '@/utils/userOpDecode';

const SENDER_A = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const SENDER_B = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const PAYMASTER = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const BENEFICIARY = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const v6HandleOpsAbi = parseAbi([
  'function handleOps((address,uint256,bytes,bytes,uint256,uint256,uint256,uint256,uint256,bytes,bytes)[] ops, address beneficiary)',
]);
const packedHandleOpsAbi = parseAbi([
  'function handleOps((address,uint256,bytes,bytes,bytes32,uint256,bytes32,bytes,bytes)[] ops, address beneficiary)',
]);
const classicEventAbi = parseAbi([
  'event UserOperationEvent(address indexed sender, address indexed paymaster, uint256 indexed nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
]);
const v8EventAbi = parseAbi([
  'event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)',
]);
const erc20Abi = parseAbi([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'function transfer(address to, uint256 amount) returns (bool)',
]);

const classicEventDataParams = parseAbiParameters('bool, uint256, uint256');
const v8EventDataParams = parseAbiParameters('uint256, bool, uint256, uint256');

// Shared fixture bytes (built with viem, never from-memory constants).
const transferCalldata = encodeFunctionData({
  abi: erc20Abi,
  functionName: 'transfer',
  args: [SENDER_B, 12345n],
});
const initCodeA = concatHex([SENDER_B, toHex('factory-init-data')]);
const signatureA = toHex(toBytes('signature-a'));
const signatureB = toHex(toBytes('signature-b'));
// 20-byte paymaster + 16-byte verification gas + 16-byte postOp gas + opaque tail.
const paymasterAndDataFull = concatHex([
  PAYMASTER,
  numberToHex(1500000n, { size: 16 }),
  numberToHex(32109n, { size: 16 }),
  toHex('opaque paymaster data'),
]);
// v0.7/v0.8 packed words: high 128 bits first, then low 128 bits.
const packedAccountGasLimits = concatHex([
  numberToHex(654321n, { size: 16 }), // verificationGasLimit (asymmetric vs call)
  numberToHex(123456n, { size: 16 }), // callGasLimit
]);
const packedAccountGasLimitsSmall = concatHex([
  numberToHex(11n, { size: 16 }),
  numberToHex(22n, { size: 16 }),
]);
const packedGasFees = concatHex([
  numberToHex(2000000011n, { size: 16 }), // maxPriorityFeePerGas
  numberToHex(3000000021n, { size: 16 }), // maxFeePerGas
]);

const v6Calldata = encodeFunctionData({
  abi: v6HandleOpsAbi,
  functionName: 'handleOps',
  args: [
    [
      [
        SENDER_A,
        7n,
        initCodeA,
        transferCalldata,
        100001n, // callGasLimit
        500003n, // verificationGasLimit
        21007n, // preVerificationGas
        3000000021n, // maxFeePerGas
        2000000011n, // maxPriorityFeePerGas
        paymasterAndDataFull,
        signatureA,
      ],
      [
        SENDER_B,
        0n,
        '0x',
        '0xdeadbeef',
        85000n,
        91000n,
        21000n,
        2n,
        1n,
        '0x',
        signatureB,
      ],
    ],
    BENEFICIARY,
  ],
});

const v7Calldata = encodeFunctionData({
  abi: packedHandleOpsAbi,
  functionName: 'handleOps',
  args: [
    [
      [SENDER_A, 42n, '0x', transferCalldata, packedAccountGasLimits, 55000n, packedGasFees, PAYMASTER, signatureA],
      [SENDER_B, 9n, initCodeA, '0x', packedAccountGasLimitsSmall, 21000n, packedGasFees, '0x', signatureB],
    ],
    BENEFICIARY,
  ],
});

const expectedV6Ops = [
  {
    sender: SENDER_A,
    nonce: 7n,
    paymaster: PAYMASTER,
    callDataSelector: slice(transferCalldata, 0, 4),
    initCodePresent: true,
    gasLimits: { call: 100001n, verification: 500003n, pre: 21007n },
  },
  {
    sender: SENDER_B,
    nonce: 0n,
    paymaster: null,
    callDataSelector: '0xdeadbeef',
    initCodePresent: false,
    gasLimits: { call: 85000n, verification: 91000n, pre: 21000n },
  },
];

const expectedPackedOps = [
  {
    sender: SENDER_A,
    nonce: 42n,
    paymaster: PAYMASTER,
    callDataSelector: slice(transferCalldata, 0, 4),
    initCodePresent: false,
    gasLimits: { call: 123456n, verification: 654321n, pre: 55000n },
  },
  {
    sender: SENDER_B,
    nonce: 9n,
    paymaster: null,
    callDataSelector: '0x',
    initCodePresent: true,
    gasLimits: { call: 22n, verification: 11n, pre: 21000n },
  },
];

// encodeEventTopics returns a loose tuple (indexed array/struct topics may be
// null); every event here only indexes scalars, so widen to a plain string
// list matching the raw receipt-log input shape.
function topicsOf(parameters: Parameters<typeof encodeEventTopics>[0]): string[] {
  return encodeEventTopics(parameters) as string[];
}

const makeClassicLog = (
  args: { sender: Address; paymaster: Address; nonce: bigint },
  success: boolean,
  actualGasCost: bigint,
  actualGasUsed: bigint,
) => ({
  topics: topicsOf({ abi: classicEventAbi, eventName: 'UserOperationEvent', args }),
  data: encodeAbiParameters(classicEventDataParams, [success, actualGasCost, actualGasUsed]),
});

const makeV8Log = (
  args: { userOpHash: Hex; sender: Address; paymaster: Address },
  nonce: bigint,
  success: boolean,
  actualGasCost: bigint,
  actualGasUsed: bigint,
) => ({
  topics: topicsOf({ abi: v8EventAbi, eventName: 'UserOperationEvent', args }),
  data: encodeAbiParameters(v8EventDataParams, [nonce, success, actualGasCost, actualGasUsed]),
});

describe('userOperationEventTopic0 constants', () => {
  it('classic topic0 is keccak256 of the v0.6/v0.7 event signature', () => {
    expect(userOperationEventTopic0).toBe(
      keccak256(toBytes('UserOperationEvent(address,address,uint256,bool,uint256,uint256)')),
    );
  });

  it('v0.8 topic0 is keccak256 of the v0.8 event signature', () => {
    expect(userOperationEventV8Topic0).toBe(
      keccak256(toBytes('UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)')),
    );
  });

  it('USER_OPERATION_EVENT_TOPICS bundles both variants', () => {
    expect(USER_OPERATION_EVENT_TOPICS).toEqual([userOperationEventTopic0, userOperationEventV8Topic0]);
  });
});

describe('entryPointVersionForAddress', () => {
  it('matches all three canonical EntryPoints case-insensitively', () => {
    for (const version of ['v0.6', 'v0.7', 'v0.8'] as const) {
      expect(entryPointVersionForAddress(ENTRY_POINT_ADDRESSES[version])).toBe(version);
      expect(entryPointVersionForAddress(ENTRY_POINT_ADDRESSES[version].toLowerCase())).toBe(version);
    }
  });

  it('canonical constants are EIP-55 checksummed', () => {
    for (const version of ['v0.6', 'v0.7', 'v0.8'] as const) {
      expect(ENTRY_POINT_ADDRESSES[version]).toBe(getAddress(ENTRY_POINT_ADDRESSES[version]));
    }
  });

  it('returns null for unknown or missing addresses', () => {
    expect(entryPointVersionForAddress('0x1234567890123456789012345678901234567890')).toBeNull();
    expect(entryPointVersionForAddress('0x')).toBeNull();
    expect(entryPointVersionForAddress('not-an-address')).toBeNull();
    expect(entryPointVersionForAddress(undefined)).toBeNull();
    expect(entryPointVersionForAddress(null)).toBeNull();
  });
});

describe('decodeHandleOps v0.6', () => {
  it('round-trips a 2-op bundle with paymaster extraction and flat gas limits', () => {
    expect(decodeHandleOps(v6Calldata, 'v0.6')).toEqual(expectedV6Ops);
  });

  it('decodes an empty ops array to [] (not null)', () => {
    const emptyCalldata = encodeFunctionData({
      abi: v6HandleOpsAbi,
      functionName: 'handleOps',
      args: [[], BENEFICIARY],
    });
    expect(decodeHandleOps(emptyCalldata, 'v0.6')).toEqual([]);
  });
});

describe('decodeHandleOps v0.7', () => {
  it('round-trips packed tuples and unpacks accountGasLimits in the right order', () => {
    expect(decodeHandleOps(v7Calldata, 'v0.7')).toEqual(expectedPackedOps);
  });

  it('decodes an empty ops array to [] (not null)', () => {
    const emptyCalldata = encodeFunctionData({
      abi: packedHandleOpsAbi,
      functionName: 'handleOps',
      args: [[], BENEFICIARY],
    });
    expect(decodeHandleOps(emptyCalldata, 'v0.7')).toEqual([]);
  });
});

describe('decodeHandleOps v0.8', () => {
  it('accepts the same packed calldata as v0.7 (identical wire format)', () => {
    expect(decodeHandleOps(v7Calldata, 'v0.8')).toEqual(expectedPackedOps);
    expect(decodeHandleOps(v7Calldata, 'v0.8')).toEqual(decodeHandleOps(v7Calldata, 'v0.7'));
  });
});

describe('decodeHandleOps guard rails', () => {
  it('rejects tail truncations of several lengths (round-trip guard)', () => {
    for (const removed of [10, 32, 64]) {
      const truncated = toHex(toBytes(v7Calldata).slice(0, -removed));
      expect(decodeHandleOps(truncated, 'v0.7')).toBeNull();
    }
    expect(decodeHandleOps(toHex(toBytes(v6Calldata).slice(0, -10)), 'v0.6')).toBeNull();
  });

  it('rejects a valid tail behind the wrong selector', () => {
    const forged = toHex(concatBytes([toBytes('0xdeadbeef'), toBytes(v6Calldata).slice(4)]));
    expect(decodeHandleOps(forged, 'v0.6')).toBeNull();
    // Cross-version: v0.6 and packed selectors differ.
    expect(decodeHandleOps(v6Calldata, 'v0.7')).toBeNull();
    expect(decodeHandleOps(v7Calldata, 'v0.6')).toBeNull();
  });

  it('rejects garbage without throwing', () => {
    expect(decodeHandleOps('', 'v0.6')).toBeNull();
    expect(decodeHandleOps('0x', 'v0.6')).toBeNull();
    expect(decodeHandleOps('0xab', 'v0.6')).toBeNull();
    expect(decodeHandleOps('not-hex', 'v0.7')).toBeNull();
    expect(decodeHandleOps('1234', 'v0.7')).toBeNull();
  });

  it('rejects selector-only and odd-length payloads', () => {
    const selectorOnly = slice(v7Calldata, 0, 4);
    expect(decodeHandleOps(selectorOnly, 'v0.7')).toBeNull();
    expect(decodeHandleOps(`${selectorOnly}abc`, 'v0.7')).toBeNull();
  });

  it('rejects an empty-ops bundle whose beneficiary word is truncated', () => {
    const emptyCalldata = encodeFunctionData({
      abi: packedHandleOpsAbi,
      functionName: 'handleOps',
      args: [[], BENEFICIARY],
    });
    expect(decodeHandleOps(toHex(toBytes(emptyCalldata).slice(0, -8)), 'v0.7')).toBeNull();
  });
});

describe('decodeUserOperationEvents', () => {
  it('decodes classic events, ignores unrelated topics, and skips malformed logs', () => {
    const successLog = makeClassicLog({ sender: SENDER_A, paymaster: PAYMASTER, nonce: 5n }, true, 1000n, 500n);
    const failedLog = makeClassicLog({ sender: SENDER_B, paymaster: ZERO_ADDRESS, nonce: 6n }, false, 2000n, 600n);
    const unrelatedLog = {
      topics: topicsOf({
        abi: erc20Abi,
        eventName: 'Transfer',
        args: { from: SENDER_A, to: SENDER_B },
      }),
      data: encodeAbiParameters(parseAbiParameters('uint256'), [1n]),
    };
    const shortTopicsLog = { topics: successLog.topics.slice(0, 2), data: successLog.data };
    const badDataLog = { topics: successLog.topics, data: '0xdeadbeef' };
    const noTopicsLog = { data: successLog.data };

    expect(
      decodeUserOperationEvents([successLog, failedLog, unrelatedLog, shortTopicsLog, badDataLog, noTopicsLog]),
    ).toEqual([
      {
        sender: SENDER_A,
        paymaster: PAYMASTER,
        nonce: 5n,
        success: true,
        actualGasCost: 1000n,
        actualGasUsed: 500n,
        variant: 'v0.6/v0.7',
      },
      {
        sender: SENDER_B,
        paymaster: null,
        nonce: 6n,
        success: false,
        actualGasCost: 2000n,
        actualGasUsed: 600n,
        variant: 'v0.6/v0.7',
      },
    ]);
  });

  it('decodes v0.8 events: nonce from data, sender from topics[2]', () => {
    const userOpHash = keccak256(toBytes('user-op-hash-a'));
    const v8Log = makeV8Log({ userOpHash, sender: SENDER_A, paymaster: PAYMASTER }, 99n, false, 700n, 21n);
    const v8ZeroPaymasterLog = makeV8Log(
      { userOpHash: keccak256(toBytes('user-op-hash-b')), sender: SENDER_B, paymaster: ZERO_ADDRESS },
      100n,
      true,
      1n,
      2n,
    );

    expect(decodeUserOperationEvents([v8Log, v8ZeroPaymasterLog])).toEqual([
      {
        sender: SENDER_A,
        paymaster: PAYMASTER,
        nonce: 99n,
        success: false,
        actualGasCost: 700n,
        actualGasUsed: 21n,
        variant: 'v0.8',
      },
      {
        sender: SENDER_B,
        paymaster: null,
        nonce: 100n,
        success: true,
        actualGasCost: 1n,
        actualGasUsed: 2n,
        variant: 'v0.8',
      },
    ]);
  });
});

describe('matchUserOpResults', () => {
  it('aligns results index-for-index; unmatched ops stay undefined; last duplicate wins', () => {
    const opA: DecodedUserOp = {
      sender: SENDER_A,
      nonce: 5n,
      paymaster: PAYMASTER,
      callDataSelector: '0x',
      initCodePresent: false,
      gasLimits: { call: 1n, verification: 2n, pre: 3n },
    };
    const opB: DecodedUserOp = {
      sender: SENDER_B,
      nonce: 6n,
      paymaster: null,
      callDataSelector: '0x',
      initCodePresent: false,
      gasLimits: { call: 4n, verification: 5n, pre: 6n },
    };
    const firstEvent = makeClassicLog({ sender: SENDER_A, paymaster: PAYMASTER, nonce: 5n }, true, 100n, 10n);
    const duplicateEvent = makeClassicLog({ sender: SENDER_A, paymaster: PAYMASTER, nonce: 5n }, false, 200n, 20n);

    expect(matchUserOpResults([firstEvent, duplicateEvent], [opA, opB])).toEqual([
      { success: false, actualGasCost: 200n, actualGasUsed: 20n },
      undefined,
    ]);
  });
});
