// Pure bytecode semantics of compile verification: the trailing CBOR
// auxdata splitter (real Solidity metadata shapes, lookalikes, multiple
// trailing blocks) and the three-tier comparison (exact, metadata-only,
// mismatch with first differing byte). No compiler, no network.
import { describe, it, expect } from 'vitest';
import {
  stripTrailingAuxdata,
  compareRuntimeBytecode,
} from '@/services/CompileVerifyService';

// Real Solidity 0.8.x ipfs metadata block (as emitted with default
// settings): a2 65"ipfs" 58 22 1220<32-byte digest> 64"solc" 43 000825,
// terminated by the 2-byte BE length 0x0033.
const ipfsAuxdata =
  'a2656970667358221220567d602f5bb4729467e6780a0a4546c7dcd1d07987b4bb2fb9b3b923b097c72b64736f6c6343000825';
// Same shape with a different digest (what a recompile with different
// comment lengths produces).
const ipfsAuxdataOther =
  'a2656970667358221220ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff64736f6c6343000825';
// bzzr1 variant (swarm hash): a2 65"bzzr1" 58 20 <32 bytes> 64"solc" 43 000825.
const bzzr1Auxdata =
  'a265627a7a72315820d4e56740f876aef8c010b86a40d2f6e0dbb252ea7ca39a1c8a5b1f2c2b1a0bee64736f6c6343000825';

const blockWithLength = (payloadHex: string): string => {
  const length = payloadHex.length / 2;
  return `${payloadHex}${length.toString(16).padStart(4, '0')}`;
};

const CODE = '60806040523480156100115760006000fdff';

describe('stripTrailingAuxdata', () => {
  it('strips a real ipfs metadata block and reports it', () => {
    const split = stripTrailingAuxdata(`0x${CODE}${blockWithLength(ipfsAuxdata)}`);
    expect(split.code).toBe(CODE.toLowerCase());
    expect(split.auxdata).toBe(ipfsAuxdata);
  });

  it('strips a bzzr1 metadata block', () => {
    const split = stripTrailingAuxdata(`${CODE}${blockWithLength(bzzr1Auxdata)}`);
    expect(split.code).toBe(CODE.toLowerCase());
    expect(split.auxdata).toBe(bzzr1Auxdata);
  });

  it('leaves metadata-free bytecode untouched (settings.metadata appendCBOR=false)', () => {
    const split = stripTrailingAuxdata(`0x${CODE}`);
    expect(split).toEqual({ code: CODE.toLowerCase(), auxdata: null });
  });

  it('does not strip a lookalike mid-code (tail is ordinary code)', () => {
    // The valid block sits mid-code and the tail is arbitrary opcodes:
    // only a TRAILING block is ever stripped.
    const hex = `${CODE}${blockWithLength(ipfsAuxdata)}5b60005260206000f3`;
    const split = stripTrailingAuxdata(hex);
    expect(split.auxdata).toBeNull();
    expect(split.code).toBe(hex);
  });

  it('does not strip a trailing block whose payload lacks the solc key', () => {
    // Length and map head parse, but the payload is not Solidity metadata.
    const fake = 'a10568656c6c6f';
    const hex = `${CODE}${blockWithLength(fake)}`;
    const split = stripTrailingAuxdata(hex);
    expect(split.auxdata).toBeNull();
    expect(split.code).toBe(hex);
  });

  it('does not strip when the declared length does not fit the payload', () => {
    // Declared length exceeds the code before it.
    const hex = `${CODE}ffff`;
    expect(stripTrailingAuxdata(hex).auxdata).toBeNull();
    // Declared length zero (trailing 0000) is not a metadata block.
    expect(stripTrailingAuxdata(`${CODE}0000`).auxdata).toBeNull();
  });

  it('does not strip when the payload head is not a CBOR map head', () => {
    // Payload starts with a string head (0x65 'ipfs'-like) rather than a map.
    const fake = '656970667364736f6c6343000825';
    const hex = `${CODE}${blockWithLength(fake)}`;
    expect(stripTrailingAuxdata(hex).auxdata).toBeNull();
  });

  it('strips exactly one block when two are concatenated', () => {
    const hex = `${CODE}${blockWithLength(ipfsAuxdata)}${blockWithLength(bzzr1Auxdata)}`;
    const split = stripTrailingAuxdata(hex);
    expect(split.auxdata).toBe(bzzr1Auxdata);
    // The inner block stays part of the code (with its own length
    // terminator): Solidity emits one block, and looping would risk
    // cutting real code that merely looks like one.
    expect(split.code).toBe(`${CODE}${blockWithLength(ipfsAuxdata)}`);
  });

  it('handles too-short, odd-length, and non-hex inputs defensively', () => {
    expect(stripTrailingAuxdata('0x')).toEqual({ code: '', auxdata: null });
    expect(stripTrailingAuxdata('6080')).toEqual({ code: '6080', auxdata: null });
    expect(stripTrailingAuxdata('608060')).toEqual({ code: '608060', auxdata: null });
    expect(stripTrailingAuxdata('zz')).toEqual({ code: 'zz', auxdata: null });
  });

  it('accepts uppercase hex', () => {
    const split = stripTrailingAuxdata(`0X${CODE.toUpperCase()}${blockWithLength(ipfsAuxdata).toUpperCase()}`);
    expect(split.code).toBe(CODE.toLowerCase());
    expect(split.auxdata).toBe(ipfsAuxdata);
  });
});

describe('compareRuntimeBytecode', () => {
  const withIpfs = (code: string): string => `${code}${blockWithLength(ipfsAuxdata)}`;

  it('classifies raw equality as exact (case-insensitive)', () => {
    const comparison = compareRuntimeBytecode(withIpfs(CODE), `0x${withIpfs(CODE).toUpperCase()}`);
    expect(comparison.tier).toBe('exact');
    // Raw includes the 53-byte metadata block; the normalized length has
    // it stripped.
    expect(comparison.onChainRawBytes).toBe(withIpfs(CODE).length / 2);
    expect(comparison.onChainBytes).toBe(CODE.length / 2);
  });

  it('classifies equal-after-strip codes as matches-metadata-only and reports both auxdata blocks', () => {
    const comparison = compareRuntimeBytecode(
      withIpfs(CODE),
      `${CODE}${blockWithLength(ipfsAuxdataOther)}`,
    );
    expect(comparison.tier).toBe('matches-metadata-only');
    expect(comparison.onChainAuxdata).toBe(ipfsAuxdata);
    expect(comparison.compiledAuxdata).toBe(ipfsAuxdataOther);
    // Normalized lengths exclude the stripped blocks; raw lengths include them.
    expect(comparison.onChainBytes).toBe(CODE.length / 2);
    expect(comparison.onChainRawBytes).toBe(withIpfs(CODE).length / 2);
  });

  it('classifies one-side-metadata differences as matches-metadata-only too', () => {
    const comparison = compareRuntimeBytecode(withIpfs(CODE), CODE);
    expect(comparison.tier).toBe('matches-metadata-only');
    expect(comparison.compiledAuxdata).toBe('');
  });

  it('reports the first differing byte offset on mismatch (high nibble)', () => {
    const compiled = `${CODE}ff${blockWithLength(ipfsAuxdata)}`;
    const onChain = `${CODE}aaff${blockWithLength(ipfsAuxdata)}`;
    const comparison = compareRuntimeBytecode(onChain, compiled);
    expect(comparison.tier).toBe('mismatch');
    // CODE is 19 bytes; the differing byte is at index 19.
    expect(comparison.firstDiffByteOffset).toBe(CODE.length / 2);
  });

  it('reports the first differing byte offset on mismatch (low nibble only)', () => {
    // 0x5b vs 0x5a differ only in the low nibble — the offset must still
    // land on that byte.
    const onChain = `${CODE}5b${blockWithLength(ipfsAuxdata)}`;
    const compiled = `${CODE}5a${blockWithLength(ipfsAuxdata)}`;
    const comparison = compareRuntimeBytecode(onChain, compiled);
    expect(comparison.tier).toBe('mismatch');
    expect(comparison.firstDiffByteOffset).toBe(CODE.length / 2);
  });

  it('reports the shorter length when one side is a strict prefix', () => {
    const longer = `${CODE}60806040`;
    const comparison = compareRuntimeBytecode(CODE, longer);
    expect(comparison.tier).toBe('mismatch');
    expect(comparison.firstDiffByteOffset).toBe(CODE.length / 2);
    expect(comparison.onChainBytes).toBe(CODE.length / 2);
    expect(comparison.compiledBytes).toBe(longer.length / 2);
  });

  it('treats empty on-chain code as a mismatch at offset 0', () => {
    const comparison = compareRuntimeBytecode('', withIpfs(CODE));
    expect(comparison.tier).toBe('mismatch');
    expect(comparison.firstDiffByteOffset).toBe(0);
    expect(comparison.onChainBytes).toBe(0);
  });
});
