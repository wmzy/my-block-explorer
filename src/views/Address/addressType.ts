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
import { codeVerdict } from '@/utils/address';

export type AddressType = 'eoa' | 'contract' | 'delegated-eoa' | 'unknown';

// EIP-7702 delegation designator check — the view-side spelling of the
// raw-code verdict's 'delegated' tier. utils/address owns the matching
// (exactly 0xef0100 + the 20-byte delegate address; 0xef is an invalid
// opcode, so deployed bytecode can never collide with the prefix).
export function isEip7702Designator(code: string | undefined): boolean {
  return codeVerdict(code) === 'delegated';
}

// The delegate address a 7702 designator points at (bytes 3-42 of the
// code), EIP-55 checksummed for display; undefined for anything that is
// not a designator.
export function delegationTarget(code: string | undefined): string | undefined {
  if (code === undefined || !isEip7702Designator(code)) return undefined;
  const target = `0x${code.slice('0xef0100'.length)}`;
  try {
    return getAddress(target);
  } catch {
    return target.toLowerCase();
  }
}

export type AddressTypeInput = {
  /** Persistent channel's isContract flag; undefined = no settled record (or the channel errored — an errored channel contributes no verdict). */
  persistentType?: boolean;
  /**
   * Live eth_getCode result. '0x' = the read SUCCEEDED and the account
   * carries no code (the realtime service restores '0x' where viem folds
   * it into undefined); undefined = not read (gated args / never settled /
   * failed — a failed read rejects the query, so data stays undefined).
   */
  rpcCode?: string;
};

export function classifyAddressType({ persistentType, rpcCode }: AddressTypeInput): AddressType {
  // The designator is authoritative and outranks the persistent record:
  // a delegated EOA executes another contract's code but is still an
  // account, never a contract deployed at this address.
  if (isEip7702Designator(rpcCode)) return 'delegated-eoa';
  if (persistentType !== undefined) return persistentType ? 'contract' : 'eoa';
  if (rpcCode !== undefined) {
    return codeVerdict(rpcCode) !== 'eoa' ? 'contract' : 'eoa';
  }
  return 'unknown';
}
