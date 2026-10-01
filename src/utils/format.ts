// Formatting utilities

/**
 * Exact fixed-decimal rendering of a scaled integer amount.
 *
 * Integer-only: the value is divided by 10^(decimals - fractionDigits) with
 * half-up rounding and reassembled from BigInt digits. Nothing passes
 * through a double, so distinct 256-bit amounts stay distinct and the
 * output can never switch to `toFixed`'s exponential notation (>= 1e21).
 *
 * `decimals` is the amount's on-chain scale (wei = 0, gwei = 9, ether = 18)
 * and `fractionDigits` the displayed precision. `decimals <
 * fractionDigits` is a real case (a 0-decimal token shown to 4 digits):
 * the value is exact, so it is only zero-padded.
 *
 * Returns null for a negative fractionDigits count or a non-finite
 * decimals argument, so callers can degrade explicitly rather than
 * render NaN.
 */
export function formatFixedDecimals(
  value: bigint,
  decimals: number,
  fractionDigits: number,
): string | null {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0) return null;
  if (!Number.isFinite(decimals) || !Number.isInteger(decimals) || decimals < 0) return null;

  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  let scaled: bigint;
  if (decimals >= fractionDigits) {
    const unit = 10n ** BigInt(decimals - fractionDigits);
    scaled = (magnitude + unit / 2n) / unit; // half up
  } else {
    scaled = magnitude * 10n ** BigInt(fractionDigits - decimals);
  }
  const scale = 10n ** BigInt(fractionDigits);
  const whole = scaled / scale;
  const fraction = scaled % scale;
  return `${negative ? '-' : ''}${whole}.${fraction.toString().padStart(fractionDigits, '0')}`;
}

/**
 * Format an ether value.
 *
 * `decimals` is the DISPLAYED precision. The old implementation
 * round-tripped viem's exact string through parseFloat().toFixed(), which
 * collapsed distinct amounts past 2^53 (10,000,000,000,000,001 and
 * 10,000,000,000,000,000 wei both read "0.0000" here), printed "1e+21"
 * for huge figures, and rendered a NONZERO amount below the display floor
 * as an exact "0.0000". A nonzero amount that rounds to zero now renders
 * as the honest "<0.0001" floor — the same contract formatValue below
 * already used.
 */
export function formatEth(value: bigint | string, decimals = 4): string {
  const wei = BigInt(value);
  if (wei === 0n) return decimals === 0 ? '0' : `0.${'0'.repeat(decimals)}`;
  if (decimals === 0) return formatFixedDecimals(wei, 18, 0) ?? '';
  // 1/10^decimals native unit in wei — the display floor, compared exactly.
  if (wei > 0n && wei < 10n ** BigInt(18 - decimals)) {
    return `<0.${'0'.repeat(decimals - 1)}1`;
  }
  return formatFixedDecimals(wei, 18, decimals) ?? '';
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
  return formatFixedDecimals(BigInt(value), 9, 2) ?? '0.00';
}

/**
 * Format a token amount
 *
 * `decimals` is the token's on-chain scale and `displayDecimals` the
 * rendered precision. Exact integer arithmetic (see formatFixedDecimals);
 * a nonzero amount that rounds to zero renders the "<0.0…01" floor rather
 * than an exact zero.
 */
export function formatTokenAmount(
  value: bigint | string,
  decimals: number = 18,
  displayDecimals = 4,
): string {
  const amount = BigInt(value);
  if (amount === 0n) return (0).toFixed(displayDecimals);
  const shown = formatFixedDecimals(amount, decimals, displayDecimals);
  if (shown === null) return amount.toString();
  // A nonzero amount whose every displayed digit is zero: the floor
  // states the truth (something is there, it is smaller than we show).
  // The floor figure is the last place unit rendered as a string — a
  // leading "0." plus (displayDecimals - 1) zeros and a 1.
  if (/^0*\.?0*$/.test(shown)) {
    return displayDecimals === 0 ? '<1' : `<0.${'0'.repeat(displayDecimals - 1)}1`;
  }
  return shown;
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
