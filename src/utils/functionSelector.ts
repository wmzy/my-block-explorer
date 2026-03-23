import { toFunctionSelector } from 'viem';

import type { ContractFunction } from './contractInteraction';

export function getFunctionSelector(func: ContractFunction): `0x${string}` | null {
  try {
    if (!func.name) {
      return null;
    }
    const signature = buildFunctionSignature(func);
    return toFunctionSelector(signature);
  } catch {
    return null;
  }
}

export function buildFunctionSignature(func: Pick<ContractFunction, 'name' | 'inputs'>): string {
  const paramTypes = func.inputs.map(input => input.type).join(',');
  return `functionName(${paramTypes})`.replace('functionName', func.name);
}

export function formatSelectorForDisplay(selector: `0x${string}` | null): string {
  return selector ?? '';
}
