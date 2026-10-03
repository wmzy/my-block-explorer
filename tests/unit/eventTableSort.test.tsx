/**
 * EventTable client-side sorting must actually reorder rows.
 *
 * `defaultSortOptions` declares its columns with snake_case keys
 * (`block_timestamp`, `block_number`, `event_name`, `transaction_hash`)
 * while the rows the component builds are camelCase EventData
 * (`blockTimestamp`, `blockNumber`, `eventName`, `transactionHash`).
 * The sorter's `extractValue` does a literal `obj[key]` walk with no
 * snake→camel mapping, so every one of those columns read `undefined`
 * for every row: `compareValues(undefined, undefined)` returned 0 and
 * the table kept its original order in BOTH directions.
 *
 * Only `from`, `to` and `value` — the options whose keys happen to match
 * the row fields — sorted at all, which is why the default view looked
 * time-descending: the API already returns rows in that order. Four of
 * the five sortable columns, including the DEFAULT ('Time'), were
 * silent no-ops. The `sortBy` query param does not rescue it either: no
 * route or service reads it, so client-side is the only sort path.
 *
 * Both sort surfaces are exercised: the header cells and the Sort select.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AbiEvent } from 'viem';
import EventTable from '@/components/events/EventTable';
import { get } from '@/util/http';
import { setApiBase } from '@/util/apiBase';

vi.mock('@/util/http', () => ({ get: vi.fn() }));

const ADDRESS = '0x1234567890123456789012345678901234567890';
const transferEvent = {
  type: 'event',
  name: 'Transfer',
  inputs: [{ name: 'owner', type: 'address', indexed: true }],
} as unknown as AbiEvent;

const API_BASE = 'http://unit.test:1';

// Deliberately NOT in sorted order in any column, so "unchanged" is
// visibly different from "sorted" for every assertion below.
const EVENTS = [
  {
    blockNumber: 30,
    blockTimestamp: '2026-01-03T00:00:00Z',
    transactionHash: '0xcc3ccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc3',
    eventName: 'Cee',
    value: '3000000000000000000',
    from: '0x3333333333333333333333333333333333333333',
    to: '0x4444444444444444444444444444444444444444',
  },
  {
    blockNumber: 10,
    blockTimestamp: '2026-01-01T00:00:00Z',
    transactionHash: '0xaa1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa1a',
    eventName: 'Aye',
    value: '1000000000000000000',
    from: '0x1111111111111111111111111111111111111111',
    to: '0x2222222222222222222222222222222222222222',
  },
  {
    blockNumber: 20,
    blockTimestamp: '2026-01-02T00:00:00Z',
    transactionHash: '0xbb2bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb2b',
    eventName: 'Bee',
    value: '2000000000000000000',
    from: '0x5555555555555555555555555555555555555555',
    to: '0x6666666666666666666666666666666666666666',
  },
];

// Mirrors formatTransactionHash in EventTable: 10 leading + 8 trailing.
const SHORT = (h: string) => `${h.slice(0, 10)}...${h.slice(-8)}`;

const HASHES = {
  block30: SHORT(EVENTS[0].transactionHash),
  block10: SHORT(EVENTS[1].transactionHash),
  block20: SHORT(EVENTS[2].transactionHash),
};

/** The tx-hash cell (last column) of each rendered body row, in DOM order. */
const rowHashes = () =>
  within(screen.getByRole('table').querySelector('tbody') as HTMLElement)
    .getAllByRole('row')
    .map(row => {
      const cells = row.querySelectorAll('td');
      const cell = cells[cells.length - 1];
      return (cell?.textContent ?? '').replace(/\s+/g, '');
    });

const renderTable = () =>
  render(
    <EventTable
      chainId={1}
      contractAddress={ADDRESS as `0x${string}`}
      abiEvents={[transferEvent]}
      enableDynamicFiltering
      enableClientSideSort
    />,
  );

// The filter panel contributes other comboboxes; the Sort select is the
// one whose options are the sort-option keys.
const sortSelect = () =>
  screen
    .getAllByRole('combobox')
    .find(el => el.querySelector('option[value="blockTimestamp"]') !== null) as HTMLSelectElement;

/** The order under assertion, keyed so a failure names what diverged. */
const order = () => ({ rowHashes: rowHashes().map(h => HASH_LABEL[h] ?? h) });

const HASH_LABEL: Record<string, string> = {
  [HASHES.block10]: 'block10',
  [HASHES.block20]: 'block20',
  [HASHES.block30]: 'block30',
};

const headerCell = (label: string) =>
  within(screen.getByRole('table').querySelector('thead') as HTMLElement).getByText(label, {
    exact: false,
  });

beforeEach(() => {
  vi.clearAllMocks();
  setApiBase(API_BASE);
  vi.mocked(get).mockResolvedValue({
    events: EVENTS,
    total: EVENTS.length,
    page: 1,
    totalPages: 1,
  });
});

const ASCENDING = ['block10', 'block20', 'block30'];
const DESCENDING = ['block30', 'block20', 'block10'];
// The component's initial sort is blockTimestamp DESC (its own default),
// so a freshly rendered table is 30/20/10 — the API's 30/10/20 order is
// NOT what reaches the DOM.
const DEFAULT_ORDER = ['block30', 'block20', 'block10'];

describe('EventTable client-side sorting reorders rows', () => {
  it('sorts by block number in both directions from the header', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(order().rowHashes).toEqual(DEFAULT_ORDER));

    await user.click(headerCell('Block'));
    await waitFor(() => expect(order().rowHashes).toEqual(ASCENDING));

    await user.click(headerCell('Block'));
    await waitFor(() => expect(order().rowHashes).toEqual(DESCENDING));
  });

  it('sorts by event name from the header', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(order().rowHashes).toEqual(DEFAULT_ORDER));

    await user.click(headerCell('Event'));
    await waitFor(() => expect(order().rowHashes).toEqual(ASCENDING));
  });

  it('sorts by time from the header', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(order().rowHashes).toEqual(DEFAULT_ORDER));

    await user.click(headerCell('Time'));
    await waitFor(() => expect(order().rowHashes).toEqual(ASCENDING));
  });

  it('sorts by block number through the Sort select in both directions', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(order().rowHashes).toEqual(DEFAULT_ORDER));

    // The select applies each option's declared defaultDirection:
    // Block is 'desc', so choosing it sorts descending…
    await user.selectOptions(sortSelect(), 'blockNumber');
    await waitFor(() => expect(order().rowHashes).toEqual(DESCENDING));

    // …and the direction button then flips it to ascending.
    await user.click(screen.getByRole('button', { name: /Ascending|Descending/ }));
    await waitFor(() => expect(order().rowHashes).toEqual(ASCENDING));
  });

  it('sorts by event name through the Sort select', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(order().rowHashes).toEqual(DEFAULT_ORDER));

    await user.selectOptions(sortSelect(), 'eventName');
    await waitFor(() => expect(order().rowHashes).toEqual(ASCENDING));
  });

  it('sorts by tx hash through the Sort select', async () => {
    const user = userEvent.setup();
    renderTable();
    await waitFor(() => expect(order().rowHashes).toEqual(DEFAULT_ORDER));

    await user.selectOptions(sortSelect(), 'transactionHash');
    await waitFor(() => expect(order().rowHashes).toEqual(ASCENDING));
  });
});
