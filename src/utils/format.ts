// Formatting utilities

import { formatEther, formatGwei, formatUnits } from 'viem';

/**
 * Format an ether value
 */
export function formatEth(value: bigint | string, decimals = 4): string {
  const ethValue = formatEther(BigInt(value));
  return parseFloat(ethValue).toFixed(decimals);
}

// Shared native-token value display for the tx surfaces (Home feed, tx
// list, tx detail): one display contract instead of three. Zero renders
// exactly; dust below the 4-decimal floor renders the "<0.0001" floor
// instead of a misleading "0.0000"; anything larger renders 4 decimals.
export function formatValue(wei: bigint, symbol: string): string {
  if (wei === 0n) return `0 ${symbol}`;
  // 0.0001 ETH in integer wei — the display floor, compared exactly.
  if (wei < 10n ** 14n) return `<0.0001 ${symbol}`;
  return `${formatEth(wei, 4)} ${symbol}`;
}

/**
 * Format a gas price (Gwei)
 */
export function formatGasPrice(value: bigint | string): string {
  const gweiValue = formatGwei(BigInt(value));
  return parseFloat(gweiValue).toFixed(2);
}

/**
 * Format a token amount
 */
export function formatTokenAmount(
  value: bigint | string,
  decimals: number = 18,
  displayDecimals = 4,
): string {
  const formatted = formatUnits(BigInt(value), decimals);
  return parseFloat(formatted).toFixed(displayDecimals);
}

/**
 * Format an address - show the first and last few characters
 */
export function formatAddress(address: string, length = 6): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, length + 2)}...${address.slice(-length)}`;
}

/**
 * Format a hash
 */
export function formatHash(hash: string, length = 8): string {
  if (!hash || hash.length < 10) return hash;
  return `${hash.slice(0, length + 2)}...${hash.slice(-length)}`;
}

/**
 * Format a number - add thousands separators
 */
export function formatNumber(value: number | string | bigint): string {
  const num = typeof value === 'bigint' ? Number(value) : Number(value);
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format a percentage
 */
export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a file size
 */
export function formatFileSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * Format a duration
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  return `${days}d ${hours}h`;
}

/**
 * Format a relative time (e.g. "2 minutes ago")
 */
export function formatRelativeTime(timestamp: Date | string | number): string {
  const now = new Date();
  const date = new Date(timestamp);
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;

  return date.toLocaleDateString();
}
