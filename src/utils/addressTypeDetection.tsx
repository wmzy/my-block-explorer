import type React from 'react';
import { CopyableHash } from '@/components/ui/CopyableHash';

export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

export function isAddress(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return ADDRESS_REGEX.test(value);
}

export function isAddressType(type: string): boolean {
  if (type === 'address') {
    return true;
  }
  if (type === 'address[]') {
    return true;
  }
  if (/^address\[([1-9]\d*)\]$/.test(type)) {
    return true;
  }
  return false;
}

type FormatOptions = {
  chainId: number;
  outputs: Array<{ name: string; type: string }>;
  truncateLength?: number;
};

function truncateAddress(address: string, length: number): string {
  if (address.length <= length * 2 + 2) {
    return address;
  }
  const prefix = address.slice(0, length);
  const suffix = address.slice(-length);
  return `${prefix}...${suffix}`;
}

function getAddressHref(chainId: number, address: string): string {
  return `/chain/${chainId}/address/${address}`;
}

export function formatResultWithLinks(result: unknown, options: FormatOptions): React.ReactNode {
  const { chainId, outputs, truncateLength = 8 } = options;

  if (result === null || result === undefined) {
    return String(result);
  }

  if (typeof result === 'bigint') {
    return result.toString();
  }

  if (typeof result === 'string' && isAddress(result)) {
    const truncated = truncateAddress(result, truncateLength);
    const href = getAddressHref(chainId, result);
    return <CopyableHash value={result} truncated={truncated} href={href} />;
  }

  if (Array.isArray(result)) {
    if (result.length > 0 && typeof result[0] === 'string' && isAddress(result[0])) {
      return (
        <span>
          [
          {result.map((item, idx) => {
            const value = typeof item === 'bigint' ? item.toString() : String(item);
            const truncated = truncateAddress(value, truncateLength);
            const href = getAddressHref(chainId, value);
            return (
              <span key={idx}>
                {idx > 0 && ', '}
                <CopyableHash value={value} truncated={truncated} href={href} />
              </span>
            );
          })}
          ]
        </span>
      );
    }
    return String(result);
  }

  if (typeof result === 'object' && result !== null) {
    const formattedFields: React.ReactNode[] = [];
    const entries = Object.entries(result);

    for (const [key, value] of entries) {
      const outputDef = outputs.find(o => o.name === key);
      const valueAsString = typeof value === 'bigint' ? value.toString() : String(value);

      if (
        outputDef &&
        isAddressType(outputDef.type) &&
        typeof value === 'string' &&
        isAddress(value)
      ) {
        const truncated = truncateAddress(value, truncateLength);
        const href = getAddressHref(chainId, value);
        formattedFields.push(
          <span key={key}>
            {key}: <CopyableHash value={value} truncated={truncated} href={href} />
          </span>,
        );
      } else if (outputDef && isAddressType(outputDef.type) && Array.isArray(value)) {
        formattedFields.push(
          <span key={key}>
            {key}: [
            {value.map((v, i) => {
              const strVal = typeof v === 'bigint' ? v.toString() : String(v);
              const truncated = truncateAddress(strVal, truncateLength);
              const href = getAddressHref(chainId, strVal);
              return (
                <span key={i}>
                  {i > 0 && ', '}
                  <CopyableHash value={strVal} truncated={truncated} href={href} />
                </span>
              );
            })}
            ]
          </span>,
        );
      } else {
        formattedFields.push(<span key={key}>{valueAsString}</span>);
      }
    }

    return <>{formattedFields}</>;
  }

  return String(result);
}
