// UsdValue component tests: formatting boundaries (cents, thousands,
// compact millions), the provenance tooltip, and above all the honesty
// gate — unavailable/stale/non-finite inputs render NOTHING. The last
// describe drives the real service hook with a stubbed fetch to prove
// the compose path used by every USD surface: a failed price fetch
// leaves zero USD nodes in the rendered output.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

import { UsdValue, formatUsd } from '@/components/ui/UsdValue';
import { resetPricesForTests, useNativeUsdPrice } from '@/services/prices';

const fresh = (usd: number): { usd: number; fetchedAt: number } => ({
  usd,
  fetchedAt: Date.now(),
});

beforeEach(() => {
  vi.clearAllMocks();
  resetPricesForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('formatUsd', () => {
  it('formats cents and thousands boundaries', () => {
    expect(formatUsd(0.01)).toBe('$0.01');
    expect(formatUsd(1234.5)).toBe('$1,234.50');
  });

  it('switches to compact notation from $1M up', () => {
    expect(formatUsd(2_500_000)).toBe('$2.5M');
    expect(formatUsd(1_000_000)).toBe('$1M');
    expect(formatUsd(999_999.99)).toBe('$999,999.99');
  });
});

describe('UsdValue rendering', () => {
  it('renders the formatted amount with a DefiLlama provenance tooltip', () => {
    render(<UsdValue usd={1234.5} price={fresh(1)} />);

    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
    expect(screen.getByTitle(/Price via DefiLlama · updated \d+s ago/)).toBeInTheDocument();
  });

  it('renders nothing while the price is unavailable or still settling', () => {
    const { container } = render(
      <div>
        <UsdValue usd={1234.5} price={null} />
        <UsdValue usd={1234.5} price={undefined} />
      </div>,
    );

    expect(container.textContent).toBe('');
  });

  it('renders nothing for a price older than 10 minutes', () => {
    const stale = { usd: 1, fetchedAt: Date.now() - 11 * 60_000 };
    const { container } = render(
      <div>
        <UsdValue usd={1234.5} price={stale} />
      </div>,
    );

    expect(container.textContent).toBe('');
  });

  it('still renders inside the 10-minute window', () => {
    const aging = { usd: 1, fetchedAt: Date.now() - 9 * 60_000 };
    render(<UsdValue usd={1234.5} price={aging} />);

    expect(screen.getByText('$1,234.50')).toBeInTheDocument();
    expect(screen.getByTitle(/updated 9min ago/)).toBeInTheDocument();
  });

  it('renders nothing for a non-finite amount', () => {
    const { container } = render(
      <div>
        <UsdValue usd={Number.NaN} price={fresh(1)} />
      </div>,
    );

    expect(container.textContent).toBe('');
  });
});

// The exact compose shape every USD surface uses: the hook result gates
// the render and feeds the amount. A rejected fetch must leave the DOM
// with zero USD nodes — the fetch-failure → zero-DOM-diff contract.
describe('hook + UsdValue composition (fetch stubbed)', () => {
  it('a failed price fetch renders no USD node', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    try {
      function ValueRow() {
        const price = useNativeUsdPrice(1);
        return (
          <div>
            {price != null && <UsdValue usd={price.usd} price={price} />}
          </div>
        );
      }

      const { container } = render(<ValueRow />);

      await waitFor(() => {
        expect(container.querySelector('span')).toBeNull();
      });
      expect(container.textContent).toBe('');
    } finally {
      warn.mockRestore();
    }
  });

  it('an unmapped chain renders no USD node without any network', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    function ValueRow() {
      const price = useNativeUsdPrice(9999);
      return (
        <div>{price != null && <UsdValue usd={price.usd} price={price} />}</div>
      );
    }

    const { container } = render(<ValueRow />);

    expect(container.textContent).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a successful fetch renders the priced amount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ coins: { 'coingecko:ethereum': { price: 2740.68 } } }),
    }));

    function ValueRow() {
      const price = useNativeUsdPrice(1);
      return (
        <div>{price != null && <UsdValue usd={price.usd} price={price} />}</div>
      );
    }

    render(<ValueRow />);

    expect(await screen.findByText('$2,740.68')).toBeInTheDocument();
  });
});
