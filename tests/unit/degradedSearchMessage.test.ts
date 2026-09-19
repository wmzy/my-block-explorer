// Degraded-search copy: a degraded response (not-found AND an upstream
// lookup errored) must name which lookups did not answer, keep the
// "not final" framing, and degrade unknown reason codes to human words
// instead of hiding them.
import { describe, it, expect } from 'vitest';
import { degradedSearchMessage } from '@/views/Search/degradedReasons';

describe('degradedSearchMessage', () => {
  it('names the lookups that did not answer, in human words', () => {
    expect(degradedSearchMessage(['transaction-lookup-failed'])).toBe(
      'Search failed — a data source errored (transaction lookup). '
      + 'The miss may not be final; try again.',
    );
  });

  it('lists several reasons comma-separated', () => {
    expect(degradedSearchMessage(['block-lookup-failed', 'address-lookup-failed'])).toBe(
      'Search failed — a data source errored (block lookup, address lookup). '
      + 'The miss may not be final; try again.',
    );
  });

  it('keeps a generic message when the response carries no reasons', () => {
    expect(degradedSearchMessage(undefined)).toBe(
      'Search failed — a data source errored. The miss may not be final; try again.',
    );
    expect(degradedSearchMessage(null)).toBe(degradedSearchMessage(undefined));
    expect(degradedSearchMessage([])).toBe(degradedSearchMessage(undefined));
  });

  it('degrades unknown reason codes to their dashes-spaced form', () => {
    expect(degradedSearchMessage(['future-shard-unavailable'])).toBe(
      'Search failed — a data source errored (future shard unavailable). '
      + 'The miss may not be final; try again.',
    );
  });

  it('phrases the catch-all search failure like the other reasons', () => {
    expect(degradedSearchMessage(['search-failed'])).toBe(
      'Search failed — a data source errored (the search itself). '
      + 'The miss may not be final; try again.',
    );
  });
});
