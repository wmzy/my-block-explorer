// 格式化工具函数

import { formatEther, formatGwei, formatUnits } from 'viem';

/**
 * 格式化以太币值
 */
export function formatEth(value: bigint | string, decimals = 4): string {
  const ethValue = formatEther(BigInt(value));
  return parseFloat(ethValue).toFixed(decimals);
}

/**
 * 格式化Gas价格 (Gwei)
 */
export function formatGasPrice(value: bigint | string): string {
  const gweiValue = formatGwei(BigInt(value));
  return parseFloat(gweiValue).toFixed(2);
}

/**
 * 格式化代币数量
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
 * 格式化地址 - 显示前后几位
 */
export function formatAddress(address: string, length = 6): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, length + 2)}...${address.slice(-length)}`;
}

/**
 * 格式化哈希值
 */
export function formatHash(hash: string, length = 8): string {
  if (!hash || hash.length < 10) return hash;
  return `${hash.slice(0, length + 2)}...${hash.slice(-length)}`;
}

/**
 * 格式化数字 - 添加千分位分隔符
 */
export function formatNumber(value: number | string | bigint): string {
  const num = typeof value === 'bigint' ? Number(value) : Number(value);
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * 格式化百分比
 */
export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 Bytes';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * 格式化时间间隔
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
 * 格式化相对时间 (例如: "2 minutes ago")
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
