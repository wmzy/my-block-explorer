import { describe, expect, it } from 'vitest';
import { encodeFunctionData, parseAbi, serializeTransaction, toRlp } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { decodeRawTransaction } from '@/utils/rawTxDecode';

// Well-known throwaway developer key (anvil/hardhat account #0). Never used
// for anything real — fixtures only need a consistent signer to recover.
const SENDER = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
);
const RECIPIENT = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

// 4-byte selector + address + uint256 = exactly 68 bytes of calldata — the
// dataPreview cap boundary (136 hex chars, untruncated at exactly the cap).
const TRANSFER_CALLDATA = encodeFunctionData({
  abi: parseAbi(['function transfer(address to, uint256 amount) returns (bool)']),
  args: [RECIPIENT, 123456789012345678n],
});

// EIP-4844 versioned hash: version byte 0x01 (KZG) + 31 bytes. Built through
// an annotated helper so no `as` assertion is needed (tsc requires the
// narrowing here, eslint flags the equivalent inline assertion as redundant).
const toHex = (body: string): `0x${string}` => `0x${body}`;
const BLOB_VERSIONED_HASH = toHex(`01${'ab'.repeat(31)}`);

// Fixtures are built with viem itself (serialize + sign), never pasted
// constants, so they track the library's own serialization semantics.
const legacyPre155 = await SENDER.signTransaction({
  nonce: 7,
  gasPrice: 20_000_000_000n,
  gas: 120_000n,
  to: RECIPIENT,
  value: 1_000_000_000n,
});

const legacyWithChainId = await SENDER.signTransaction({
  chainId: 11155111,
  nonce: 8,
  gasPrice: 20_000_000_000n,
  gas: 120_000n,
  to: RECIPIENT,
  value: 1_000_000_000n,
});

const eip2930 = await SENDER.signTransaction({
  chainId: 11155111,
  type: 'eip2930',
  nonce: 3,
  gasPrice: 25_000_000_000n,
  gas: 150_000n,
  to: RECIPIENT,
  value: 2_000_000_000n,
  data: TRANSFER_CALLDATA,
  accessList: [{ address: RECIPIENT, storageKeys: [toHex('00'.repeat(32))] }],
});

const eip1559 = await SENDER.signTransaction({
  chainId: 1,
  type: 'eip1559',
  nonce: 42,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  gas: 100_000n,
  to: RECIPIENT,
  value: 3_000_000_000n,
  data: TRANSFER_CALLDATA,
});

// `to` omitted — contract creation.
const eip1559Creation = await SENDER.signTransaction({
  chainId: 1,
  type: 'eip1559',
  nonce: 43,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  gas: 200_000n,
  value: 0n,
  data: '0x600a600c600039600a6000f3',
});

const eip4844 = await SENDER.signTransaction({
  chainId: 11155111,
  type: 'eip4844',
  nonce: 5,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  maxFeePerBlobGas: 10_000_000_000n,
  gas: 200_000n,
  to: RECIPIENT,
  blobVersionedHashes: [BLOB_VERSIONED_HASH],
});

// Empty authorization list: parses to authorizationListLength 0.
const eip7702 = await SENDER.signTransaction({
  chainId: 1,
  type: 'eip7702',
  nonce: 9,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  gas: 100_000n,
  to: RECIPIENT,
  value: 1_000_000_000n,
  authorizationList: [],
});

// Unsigned payload: structurally decodable, but `from` must be null.
const unsignedEip1559 = serializeTransaction({
  chainId: 1,
  type: 'eip1559',
  nonce: 42,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  gas: 100_000n,
  to: RECIPIENT,
  value: 3_000_000_000n,
  data: TRANSFER_CALLDATA,
});

// 100 bytes of data — past the 68-byte preview cap.
const bigDataEip1559 = await SENDER.signTransaction({
  chainId: 1,
  type: 'eip1559',
  nonce: 44,
  maxFeePerGas: 30_000_000_000n,
  maxPriorityFeePerGas: 2_000_000_000n,
  gas: 300_000n,
  to: RECIPIENT,
  data: toHex('cd'.repeat(100)),
});

// Valid RLP, wrong shape for any transaction envelope (3-item list).
const wrongShapeRlp = toRlp(['0x01', '0x02', '0x03']);

async function decodeOk(raw: string) {
  const result = await decodeRawTransaction(raw);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.tx;
}

function expectInvalid(raw: string) {
  return decodeRawTransaction(raw).then((result) => {
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a failure result');
    expect(result.error).toMatch(/^Not a valid signed raw transaction \(.+\)\.$/);
    return result.error;
  });
}

describe('decodeRawTransaction happy paths', () => {
  it('decodes a pre-EIP-155 legacy transaction with chainId null', async () => {
    const tx = await decodeOk(legacyPre155);
    expect(tx.type).toBe('legacy');
    expect(tx.chainId).toBeNull();
    expect(tx.from?.toLowerCase()).toBe(SENDER.address.toLowerCase());
    expect(tx.to?.toLowerCase()).toBe(RECIPIENT.toLowerCase());
    expect(tx.value).toBe(1_000_000_000n);
    expect(tx.nonce).toBe(7n);
    expect(tx.gas).toBe(120_000n);
    expect(tx.gasPrice).toBe(20_000_000_000n);
    expect(tx.dataByteLength).toBe(0);
    expect(tx.dataPreview).toBe('0x');
  });

  it('decodes an EIP-155 legacy transaction with its chainId', async () => {
    const tx = await decodeOk(legacyWithChainId);
    expect(tx.type).toBe('legacy');
    expect(tx.chainId).toBe(11155111);
    expect(tx.from?.toLowerCase()).toBe(SENDER.address.toLowerCase());
    expect(tx.gasPrice).toBe(20_000_000_000n);
    expect(tx.nonce).toBe(8n);
  });

  it('decodes an eip2930 transaction with its access list length', async () => {
    const tx = await decodeOk(eip2930);
    expect(tx.type).toBe('eip2930');
    expect(tx.chainId).toBe(11155111);
    expect(tx.value).toBe(2_000_000_000n);
    expect(tx.nonce).toBe(3n);
    expect(tx.gas).toBe(150_000n);
    expect(tx.gasPrice).toBe(25_000_000_000n);
    expect(tx.accessListLength).toBe(1);
    expect(tx.dataByteLength).toBe(68);
    // 68 bytes is exactly the preview cap — untruncated.
    expect(tx.dataPreview).toBe(TRANSFER_CALLDATA);
  });

  it('recovers the signer address for a signed eip1559 transaction', async () => {
    const tx = await decodeOk(eip1559);
    expect(tx.type).toBe('eip1559');
    expect(tx.chainId).toBe(1);
    expect(tx.from).toBe(SENDER.address);
    expect(tx.value).toBe(3_000_000_000n);
    expect(tx.nonce).toBe(42n);
    expect(tx.gas).toBe(100_000n);
    expect(tx.maxFeePerGas).toBe(30_000_000_000n);
    expect(tx.maxPriorityFeePerGas).toBe(2_000_000_000n);
    expect(tx.gasPrice).toBeUndefined();
  });

  it('decodes a contract-creation transaction with to null', async () => {
    const tx = await decodeOk(eip1559Creation);
    expect(tx.type).toBe('eip1559');
    expect(tx.to).toBeNull();
    expect(tx.from?.toLowerCase()).toBe(SENDER.address.toLowerCase());
    expect(tx.dataByteLength).toBe(12);
  });

  it('decodes an eip4844 transaction with its blob fields', async () => {
    const tx = await decodeOk(eip4844);
    expect(tx.type).toBe('eip4844');
    expect(tx.chainId).toBe(11155111);
    expect(tx.blobVersionedHashes).toEqual([BLOB_VERSIONED_HASH]);
    expect(tx.maxFeePerBlobGas).toBe(10_000_000_000n);
    expect(tx.maxFeePerGas).toBe(30_000_000_000n);
    expect(tx.from?.toLowerCase()).toBe(SENDER.address.toLowerCase());
    expect(tx.nonce).toBe(5n);
  });

  it('decodes an eip7702 transaction with an empty authorization list', async () => {
    const tx = await decodeOk(eip7702);
    expect(tx.type).toBe('eip7702');
    expect(tx.chainId).toBe(1);
    expect(tx.authorizationListLength).toBe(0);
    // The eip7702 envelope carries an (empty) access list: length 0.
    expect(tx.accessListLength).toBe(0);
    expect(tx.from?.toLowerCase()).toBe(SENDER.address.toLowerCase());
    expect(tx.value).toBe(1_000_000_000n);
  });

  it('truncates the data preview past the cap and reports exact byte length', async () => {
    const tx = await decodeOk(bigDataEip1559);
    expect(tx.dataByteLength).toBe(100);
    expect(tx.dataPreview).toBe(`0x${'cd'.repeat(68)}…`);
    expect(tx.dataPreview.length).toBe(2 + 136 + 1);
  });

  it('trims surrounding whitespace before decoding', async () => {
    const tx = await decodeOk(`  ${eip1559} \n`);
    expect(tx.nonce).toBe(42n);
  });
});

describe('decodeRawTransaction honesty for unsigned payloads', () => {
  it('decodes an unsigned transaction but reports from as null', async () => {
    const tx = await decodeOk(unsignedEip1559);
    expect(tx.type).toBe('eip1559');
    expect(tx.from).toBeNull();
    expect(tx.nonce).toBe(42n);
    expect(tx.to?.toLowerCase()).toBe(RECIPIENT.toLowerCase());
  });
});

describe('decodeRawTransaction malformed input', () => {
  it('rejects an empty string', async () => {
    const error = await expectInvalid('');
    expect(error).toContain('empty');
  });

  it('rejects whitespace-only input', async () => {
    await expectInvalid('   \t ');
  });

  it('rejects a bare 0x prefix', async () => {
    const error = await expectInvalid('0x');
    expect(error).toContain('no bytes');
  });

  it('rejects odd-length hex', async () => {
    const error = await expectInvalid('0xabc');
    expect(error).toContain('odd');
  });

  it('rejects non-hex garbage without and with the 0x prefix', async () => {
    await expectInvalid('zzzz');
    await expectInvalid('0xzz');
  });

  it('rejects a bare type byte (valid RLP integer, not a transaction)', async () => {
    await expectInvalid('0x01');
  });

  it('rejects valid RLP with a non-transaction shape', async () => {
    await expectInvalid(wrongShapeRlp);
  });
});
