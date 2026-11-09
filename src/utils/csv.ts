// CSV export primitives shared by the address-transactions and
// contract-event exporters and the routes that serve their downloads:
// RFC 4180 field quoting, the exporters' timestamp rendering, and the
// attachment headers every CSV response sets. A dependency-free leaf so
// both the service layer and the routes can share one definition.

/** RFC 4180: quote a field containing a comma, quote, CR or LF, and double any embedded quotes. */
export const escapeCsvField = (field: string): string => {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
};

// Numbers are unix seconds (the timestamp column's driver mapping);
// strings/Dates are ISO or naive timestamps. An empty or unparseable
// value renders as an empty cell (never a fabricated date).
export const csvTimestamp = (value: string | number | Date | null | undefined): string => {
  if (value === null || value === undefined || value === '') return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
};

/**
 * The headers every CSV download sets: text/csv, an attachment filename
 * `<prefix>-<chainId>-<address>-<timestamp>.csv` (ISO timestamp with
 * filesystem-hostile characters stripped), and no-store — an export is a
 * point-in-time answer, and a cached one would masquerade as current.
 * `address` is passed pre-formatted; each call site picks its own casing.
 */
export const csvAttachmentHeaders = (
  prefix: string,
  chainId: number,
  address: string,
): Record<string, string> => ({
  'Content-Type': 'text/csv; charset=utf-8',
  'Content-Disposition': `attachment; filename="${prefix}-${chainId}-${address}-${new Date()
    .toISOString()
    .replace(/[:.]/g, '-')}.csv"`,
  'Cache-Control': 'no-store',
});
