// Human phrasing for the machine-readable `degradedReasons` the search API
// reports alongside a degraded response (not-found AND an upstream lookup
// errored). The UI must never let such a miss read as a definitive
// "no results", so the message names the lookups that did not answer.

// Noun phrases for the reason codes SearchService emits today. Unknown
// codes (future backend additions) degrade to their dashes-spaced form
// rather than being hidden — an unnamed data source is still better
// honesty than a bare "failed".
const REASON_NOUNS: Record<string, string> = {
  'block-lookup-failed': 'block lookup',
  'transaction-lookup-failed': 'transaction lookup',
  'address-lookup-failed': 'address lookup',
  'search-failed': 'the search itself',
};

const humanizeReason = (reason: string): string =>
  REASON_NOUNS[reason] ?? reason.replaceAll('-', ' ');

/**
 * Message for a degraded search response: states that a data source
 * errored, lists which lookups did not answer (when the response says),
 * and keeps the existing retry semantics — the miss may not be final.
 */
export function degradedSearchMessage(reasons: string[] | null | undefined): string {
  const parts = (reasons ?? []).map(humanizeReason);
  const cause = parts.length > 0 ? ` (${parts.join(', ')})` : '';
  return `Search failed — a data source errored${cause}. The miss may not be final; try again.`;
}
