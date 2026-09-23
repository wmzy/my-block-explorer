// Pure derivations for the Address Overview's summary stats strip
// (first/last seen, total in/out). Everything here is a function of the
// tx rows the Transactions tab already holds — the current window's
// DISCOVERED set, never a lifetime claim (the view's caveat line carries
// that honesty; these numbers must never be presented without it).
import { formatUnits } from 'viem';

// Minimal projection of the serialized tx rows (TxRecord in ./index):
// blockNumber/value arrive as strings over JSON. `toAddress` is null (or
// empty) for contract-creation rows on the wire. `timestamp` is optional —
// the discovered-set endpoint serializes ISO strings that the API's
// Date-only converter drops, so today's rows usually carry none; rows that
// DO carry one are used as-is.
export type SummaryTxRow = {
  readonly blockNumber: string | number;
  readonly fromAddress: string;
  readonly toAddress: string | null;
  readonly value: string | bigint;
  readonly timestamp?: string;
};

// One boundary of the observed block range. `timestamp` is epoch
// milliseconds, present ONLY when the winning row carried a parseable ISO
// timestamp — never fabricated. Absent means the view falls back to the
// block number (or resolves it lazily via RPC getBlock).
export type SeenBoundary = {
  readonly blockNumber: number;
  readonly timestamp?: number;
};

export type AddressSummaryStats = {
  readonly firstSeen: SeenBoundary | null;
  readonly lastSeen: SeenBoundary | null;
  readonly totalIn: bigint;
  readonly totalOut: bigint;
  readonly txCount: number;
};

// ISO string → epoch ms; unparsable/absent stays undefined (honest
// absence, never an invented epoch).
const parseEpochMs = (iso: string | undefined): number | undefined => {
  if (iso === undefined || iso === '') return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
};

// Fold the discovered rows into the summary. Rules:
// - firstSeen/lastSeen by blockNumber min/max; strict comparisons keep
//   same-block ties stable (first row in input order wins, and its
//   timestamp — if any — is the boundary's).
// - totalIn sums rows whose recipient is the viewed address
//   (case-insensitive); totalOut sums rows sent from it. A self-transfer
//   honestly counts on both sides, and a contract-creation row (null or
//   empty `toAddress`) contributes to neither.
// - Values are BigInt-exact end to end — no Number rounding, ever.
export function computeAddressSummaryStats(
  rows: readonly SummaryTxRow[],
  address: string,
): AddressSummaryStats {
  const lower = address.toLowerCase();
  let firstSeen: SeenBoundary | null = null;
  let lastSeen: SeenBoundary | null = null;
  let totalIn = 0n;
  let totalOut = 0n;
  for (const row of rows) {
    const blockNumber = Number(row.blockNumber);
    const timestamp = parseEpochMs(row.timestamp);
    if (firstSeen === null || blockNumber < firstSeen.blockNumber) {
      firstSeen = timestamp === undefined ? { blockNumber } : { blockNumber, timestamp };
    }
    if (lastSeen === null || blockNumber > lastSeen.blockNumber) {
      lastSeen = timestamp === undefined ? { blockNumber } : { blockNumber, timestamp };
    }
    const value = typeof row.value === 'bigint' ? row.value : BigInt(row.value);
    const to = row.toAddress;
    if (to !== null && to !== '' && to.toLowerCase() === lower) totalIn += value;
    if (row.fromAddress.toLowerCase() === lower) totalOut += value;
  }
  return { firstSeen, lastSeen, totalIn, totalOut, txCount: rows.length };
}

// Locale-pinned digit grouping: the display stays identical across host
// locales AND stable for totals whose integer part exceeds 2^53 (where
// Number.prototype.toLocaleString would flip to exponential notation).
const groupDigits = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// Native-token total display over the chain's OWN decimals (never a
// hardcoded 18 — repo-verified pitfall on non-18 chains). Same display
// contract as the tx surfaces' formatValue, decimals-generic: zero
// renders exactly; dust below the 4-decimal floor renders "<0.0001"
// instead of a misleading "0.0000"; anything larger renders 4 decimals.
export function formatNativeTotal(
  value: bigint,
  decimals: number,
  symbol: string,
): string {
  if (value === 0n) return `0 ${symbol}`;
  const dustFloor = 10n ** BigInt(Math.max(decimals - 4, 0));
  if (value < dustFloor) return `<0.0001 ${symbol}`;
  const [intPart, fracPart = ''] = formatUnits(value, decimals).split('.');
  return `${groupDigits(intPart)}.${fracPart.slice(0, 4).padEnd(4, '0')} ${symbol}`;
}

// Boundary display: a date when a timestamp is known (formatter injected
// so tests stay deterministic), otherwise the honest block-number
// fallback — "Block N", never an estimated or fabricated date.
export function formatSeenBoundary(
  seen: SeenBoundary,
  formatDateTime: (epochMs: number) => string,
): string {
  return seen.timestamp !== undefined
    ? formatDateTime(seen.timestamp)
    : `Block ${seen.blockNumber.toLocaleString('en-US')}`;
}
