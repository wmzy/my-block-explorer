// Address type classification: the pure presentation-layer verdict behind
// the Overview "Type" row and the contract-link affordance. Two channels
// feed it — the persistent indexer record (`isContract`, computed from
// "has code at sync time") and the live RPC eth_getCode read. Neither
// channel understands EIP-7702: a delegated EOA carries code (the
// 0xef0100 designator followed by the delegate address), so both would
// file it under "contract". The designator check therefore outranks the
// persistent verdict; everything else keeps the view's original
// precedence (persistent record wins, RPC code read as the fallback).
import { getAddress } from 'viem';

export type AddressType = 'eoa' | 'contract' | 'delegated-eoa' | 'unknown';

// EIP-7702 delegation designator: exactly 0xef0100 followed by the 20-byte
// delegate address (46 hex chars, 48 including the 0x prefix). 0xef is an
// invalid opcode, so deployed bytecode can never collide with the prefix;
// the exact length still guards against truncated or garbled reads.
const EIP7702_PREFIX = '0xef0100';
const EIP7702_DESIGNATOR_LENGTH = EIP7702_PREFIX.length + 40;

export function isEip7702Designator(code: string | undefined): boolean {
  if (code === undefined) return false;
  const normalized = code.toLowerCase();
  return (
    normalized.length === EIP7702_DESIGNATOR_LENGTH &&
    normalized.startsWith(EIP7702_PREFIX)
  );
}

// The delegate address a 7702 designator points at (bytes 3-42 of the
// code), EIP-55 checksummed for display; undefined for anything that is
// not a designator.
export function delegationTarget(code: string | undefined): string | undefined {
  if (code === undefined || !isEip7702Designator(code)) return undefined;
  const target = `0x${code.slice(EIP7702_PREFIX.length)}`;
  try {
    return getAddress(target);
  } catch {
    return target.toLowerCase();
  }
}

export type AddressTypeInput = {
  /** Persistent channel's isContract flag; undefined = no settled record. */
  persistentType?: boolean;
  /** Live eth_getCode result ('0x' for plain EOAs); undefined = not read. */
  rpcCode?: string;
};

export function classifyAddressType({
  persistentType,
  rpcCode,
}: AddressTypeInput): AddressType {
  // The designator is authoritative and outranks the persistent record:
  // a delegated EOA executes another contract's code but is still an
  // account, never a contract deployed at this address.
  if (isEip7702Designator(rpcCode)) return 'delegated-eoa';
  if (persistentType !== undefined) return persistentType ? 'contract' : 'eoa';
  if (rpcCode !== undefined) {
    return rpcCode !== '0x' && rpcCode.length > 2 ? 'contract' : 'eoa';
  }
  return 'unknown';
}
