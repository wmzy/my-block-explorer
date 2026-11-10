// Formatting utilities
import { formatUnits } from 'viem';

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
  const fractionText = fraction.toString().padStart(fractionDigits, '0');
  // No dot at zero displayed digits: "123", never "123.0".
  return `${negative ? '-' : ''}${whole}${fractionDigits > 0 ? `.${fractionText}` : ''}`;
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
  // Display precision is capped at the native unit's 18 digits: more
  // asks for sub-wei precision that does not exist (and a negative
  // BigInt exponent throws). Non-integer input falls back to the
  // default precision; negative or over-18 input clamps into range.
  const precision =
    Number.isInteger(decimals) ? Math.min(Math.max(decimals, 0), 18) : 4;
  if (wei === 0n) return precision === 0 ? '0' : `0.${'0'.repeat(precision)}`;
  if (precision === 0) return formatFixedDecimals(wei, 18, 0) ?? '';
  // 1/10^precision native unit in wei — the display floor, compared exactly.
  if (wei > 0n && wei < 10n ** BigInt(18 - precision)) {
    return `<0.${'0'.repeat(precision - 1)}1`;
  }
  return formatFixedDecimals(wei, 18, precision) ?? '';
}

// Shared native-token value display for the tx surfaces (Home feed, tx
// list, tx detail, internal transfers): one display contract instead of
// per-view copies. Zero renders exactly; dust below the 0.0001-unit
// display floor renders the "<0.0001" floor instead of a misleading
// "0.0000"; anything larger renders 4 decimals over the chain's OWN
// native-currency decimals (`decimals`, default 18 — the shape every
// pre-existing 2-arg caller means, byte-identical to the old hard-coded
// path). An invalid `decimals` (formatFixedDecimals' guard) falls back
// to the raw wei integer, never a fabricated amount.
export function formatValue(wei: bigint, symbol: string, decimals = 18): string {
  if (wei === 0n) return `0 ${symbol}`;
  const shown = formatFixedDecimals(wei, decimals, 4);
  if (shown === null) return `${wei} ${symbol}`;
  // 0.0001 native units in integer wei — the display floor, compared
  // exactly (the historical 18-decimal gate was `wei < 10n ** 14n`).
  // Flooring the WHOLE sub-floor band — including values half-up would
  // round to "0.0001" — is what the default path has always done.
  const floorUnit = 10n ** BigInt(Math.max(decimals - 4, 0));
  if (wei < floorUnit) return `<0.0001 ${symbol}`;
  return `${shown} ${symbol}`;
}

// Raw base-unit value → human amount: the shared shape of every token
// surface's amount cell. viem's exact formatUnits under the token's OWN
// decimals when they resolved (null OR undefined both mean "unknown"),
// the untouched base-unit string when they did not — a guessed divisor
// would fabricate the amount. `value` may be the decimal-string wire
// form (BigInt() accepts bigint too); a non-numeric string throws inside
// BigInt, exactly what the callers' guarded formatUnits calls did. The
// symbol is appended only when known (non-nullish): some surfaces render
// the bare amount next to their own symbol column.
export function formatRawUnits(
  value: bigint | string,
  decimals: number | null | undefined,
  symbol?: string | null,
): string {
  const amount =
    decimals != null ? formatUnits(BigInt(value), decimals) : value.toString();
  return symbol != null ? `${amount} ${symbol}` : amount;
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
 * Middle truncation with an explicit head/tail budget — the single
 * primitive behind every shortened address/hash cell. `lead`/`tail` are
 * kept character counts (callers pass `length + 2` when the head should
 * include the `0x` prefix), so the explorer's two display budgets (the
 * 6/4 `formatAddress` form and the 8/6 list-cell form) share one slice
 * pair instead of eleven hand-rolled ones.
 *
 * The input is returned unchanged when an ellipsis would not shorten it
 * (empty and short strings included: a result at least as long as the
 * input is not a truncation). Sites with their own fallback contract
 * (the lists' 'N/A' for a blank cell) wrap THIS, never a second slice.
 */
export function truncateMiddle(s: string, lead: number, tail: number): string {
  if (s.length <= lead + tail + 3) return s;
  return `${s.slice(0, lead)}...${s.slice(-tail)}`;
}

/**
 * Table-cell text: the shared 8/6 middle truncation with a blank-cell
 * fallback ('N/A' by default). The one home for what every list view
 * used to hand-roll as its own `addressCell`/`formatAddr` one-liner.
 */
export function cellText(value: string | null | undefined, fallback = 'N/A'): string {
  return value ? truncateMiddle(value, 8, 6) : fallback;
}

/**
 * Format an address - show the first and last few characters. The head
 * slice includes the `0x` prefix (`length` counts hex body characters).
 */
export function formatAddress(address: string, length = 6): string {
  if (!address || address.length < 10) return address;
  return truncateMiddle(address, length + 2, length);
}

/**
 * Format a hash
 */
export function formatHash(hash: string, length = 8): string {
  if (!hash || hash.length < 10) return hash;
  return truncateMiddle(hash, length + 2, length);
}

// Locale-pinned digit grouping: identical across host locales AND stable
// for integers whose magnitude exceeds 2^53 (where
// Number.prototype.toLocaleString would flip to exponential notation).
const groupDigits = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * Format a number - add thousands separators
 */
export function formatNumber(value: number | string | bigint): string {
  const num = typeof value === 'bigint' ? Number(value) : Number(value);
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Format a BigInt with thousands separators, exactly.
 *
 * Both call sites previously went through `toLocaleString()` — one as
 * `BigInt(x).toLocaleString()`, one as `Number(BigInt(x)).toLocaleString()`
 * — which loses grouping determinism to the host locale and (in the
 * Number variant) precision past 2^53. String-level grouping has neither
 * failure mode; realistic gas magnitudes render identically to the old
 * en-US behavior.
 */
export function formatBigInt(value: bigint): string {
  return groupDigits(value.toString());
}

/**
 * Format a gas quantity that travels as a decimal string.
 *
 * Gas quantities are on-chain integers serialized as strings: format
 * them BigInt-safe with the shared exact grouping helper (Number
 * coercion would silently lose precision past 2^53, and a bare
 * toLocaleString followed the host locale). A string BigInt cannot parse
 * (a provider quirk, a placeholder) is renderer intent, not an error —
 * returned verbatim.
 */
export function formatGasString(gas: string): string {
  try {
    return formatBigInt(BigInt(gas));
  } catch {
    return gas;
  }
}

/**
 * How the fractional part of a native amount is rendered by
 * formatNativeDisplay.
 *
 * - 'trim' — the exact minimal fraction, trailing zeros cut (chart
 *   labels, mempool values);
 * - 'fixed4' — exactly four fraction digits, truncated then zero-padded,
 *   with optional integer grouping (the address summary totals);
 * - 'round4' — exactly four fraction digits, half-up (the tx-surface
 *   display contract formatValue/formatEth already use, decimals-generic).
 */
export type NativeFractionStyle = 'trim' | 'fixed4' | 'round4';

export type FormatNativeDisplayOptions = {
  /** Rendered after the amount with a space, e.g. 'ETH' → "1.5 ETH". */
  symbol?: string;
  /** Fraction style, default 'trim'. See NativeFractionStyle. */
  fraction?: NativeFractionStyle;
  /** Thousands separators on the integer part (summary totals). */
  grouped?: boolean;
  /**
   * Sub-floor cutoff (default true): a nonzero amount that would render
   * all-zero at four digits renders "<0.0001" instead — the same floor
   * formatValue uses. Chart labels pass false: a point's exact value is
   * the point.
   */
  floor?: boolean;
};

/**
 * Format a native-token amount over the chain's OWN decimals — the one
 * decimals-generic display entry point for the native-value surfaces
 * (balance chart, mempool pool values, summary totals, the address tx
 * table). Zero renders exactly; dust below the 4-decimal floor (when
 * `floor` is on) renders the honest "<0.0001" cutoff compared in integer
 * wei (`wei < 10^(decimals-4)`, never a rounded double).
 */
export function formatNativeDisplay(
  wei: bigint,
  decimals: number,
  options: FormatNativeDisplayOptions = {},
): string {
  const { symbol, fraction = 'trim', grouped = false, floor = true } = options;
  const suffix = symbol === undefined ? '' : ` ${symbol}`;
  if (wei === 0n) return `0${suffix}`;
  if (floor && wei > 0n && decimals >= 4 && wei < 10n ** BigInt(decimals - 4)) {
    return `<0.0001${suffix}`;
  }

  const applyGrouping = (text: string): string => {
    if (!grouped) return text;
    const [intPart, ...rest] = text.split('.');
    return rest.length > 0 ? `${groupDigits(intPart)}.${rest.join('.')}` : groupDigits(intPart);
  };

  if (fraction === 'round4') {
    const shown = formatFixedDecimals(wei, decimals, 4);
    // Unreachable for real chain decimals; degrade to the raw integer
    // rather than render NaN.
    if (shown === null) return `${wei.toString()}${suffix}`;
    return `${applyGrouping(shown)}${suffix}`;
  }

  // Exact integer split — viem's formatUnits algorithm without the viem
  // import (this module stays dependency-free): whole and padded
  // fraction reassembled from BigInt digits only.
  const unit = 10n ** BigInt(decimals);
  const negative = wei < 0n;
  const magnitude = negative ? -wei : wei;
  const whole = magnitude / unit;
  const fractionDigits = (magnitude % unit).toString().padStart(decimals, '0');

  if (fraction === 'fixed4') {
    const fixed = fractionDigits.slice(0, 4).padEnd(4, '0');
    return `${negative ? '-' : ''}${applyGrouping(`${whole}.${fixed}`)}${suffix}`;
  }

  // 'trim': trailing fractional zeros cut; a bare sign or empty body is
  // not a number the caller should see, but stay exact here — the
  // balance-chart wrapper owns that guard.
  const trimmed = fractionDigits.replace(/0+$/, '');
  const body = trimmed === '' ? `${whole}` : `${whole}.${trimmed}`;
  return `${negative ? '-' : ''}${applyGrouping(body)}${suffix}`;
}

/**
 * Format a percentage.
 *
 * A non-finite ratio (NaN from a failed division, Infinity) rendered the
 * literal "NaN%" / "Infinity%" — arithmetic noise dressed as a measured
 * figure. Degrades to the shared placeholder instead.
 */
export function formatPercentage(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a file size.
 *
 * A negative or NaN byte count made the unit index NaN, which printed
 * "NaN undefined" (and a petabyte-scale value read "909.49 undefined" —
 * the unit table simply stops at GB). A non-finite count degrades to the
 * placeholder; oversized real values extend the table instead of lying
 * about the unit.
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes === 0) return '0 Bytes';
  if (bytes < 0) return '—';
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);
  return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
}

/**
 * Format a duration.
 *
 * A negative or NaN seconds value printed "-5s" / "NaNd NaNh" — a number
 * the server could not compute presented as a measurement. Degrades to the
 * placeholder; real durations are unchanged.
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
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
 * Format a relative time (e.g. "2 minutes ago").
 *
 * Two holes in the old version, both reachable from real payloads: an
 * unparseable or empty timestamp string made `date.getTime()` NaN, every
 * `NaN < x` comparison is false, and the fallthrough printed the literal
 * "Invalid Date" into the table; and a FUTURE timestamp (a block ahead of
 * the head, a clock skew, a hand-edited link) produced a negative
 * difference that answered "just now" — claiming a transaction was just
 * mined when its time is still in the future.
 */
export function formatRelativeTime(timestamp: Date | string | number): string {
  const now = new Date();
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < -1) {
    // Genuinely ahead of us: name the gap instead of claiming recency.
    return `in ${formatDuration(-diffInSeconds)}`;
  }
  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} min ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)} days ago`;

  // Old enough that only the date matters: pinned to en-US so the string is
  // host-locale independent, like every other renderer in this module.
  return date.toLocaleDateString('en-US');
}

/**
 * The one absolute-datetime renderer for display surfaces (tables, info
 * panels). Replaces the per-view `toLocaleString()` copies that each
 * followed the host locale and had their own missing/invalid handling:
 * nullish (never-fetched) and unparseable timestamps render an explicit
 * '—' placeholder, never a fabricated value or 'Invalid Date'. The format
 * is pinned to en-US ("Nov 9, 2026, 14:03:05") so output is deterministic
 * across machines and test hosts.
 */
export function formatDateTime(timestamp: Date | string | number | null | undefined): string {
  if (timestamp === null || timestamp === undefined || timestamp === '') return '—';
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
