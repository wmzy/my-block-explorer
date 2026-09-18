// IndexingRangeManager wave-2 P1 fixes: creation-block honesty (a
// null/undefined/0 creationBlock renders as "unknown", never a fabricated
// #0), the one-click Catch up to head action (visibility against the chain
// head, in-flight disable, create+start flow, verbatim 400 surfacing), the
// manual form's To-Block placeholder pointing at the chain head instead of
// the furthest already-indexed block, and the transient Pausing… state that
// outlives the pause POST until the polled status flips away from
// 'indexing'. Quick-button pre-disable pins First Blocks (unknown creation)
// and Continue (empty range list) disabling before their backing POST can
// 400. The HTTP layer and sonner are mocked so backend calls and
// surfaced errors are observable. The client-side overlap precheck
// describe block pins the two-click gate (warning + 'Create anyway') for
// the manual form and the gated quick modes, the catchup exemption, and
// the reset-on-input-change semantics.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import IndexingRangeManager, { describeMutationError } from '@/components/events/IndexingRangeManager';
import { toast } from 'sonner';
import { ApiError } from '@/util/apiError';

const { mockGet, mockPost, mockDel } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDel: vi.fn(),
}));

vi.mock('@/util/http', () => ({
  get: mockGet,
  post: mockPost,
  del: mockDel,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const CHAIN_ID = 1;
const ADDRESS = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' as const;

const rangesUrl = `/api/chains/${CHAIN_ID}/contracts/${ADDRESS}/events/ranges`;
const quickUrl = `${rangesUrl}/quick`;
const statusUrl = `${rangesUrl.replace(/\/ranges$/, '')}/indexing-status`;

type RangeStatus = 'pending' | 'indexing' | 'paused' | 'completed' | 'error';

type RangeFixture = {
  chainId: number;
  address: string;
  rangeId: number;
  fromBlock: bigint;
  toBlock: bigint;
  direction: 'forward' | 'backward';
  currentBlock: bigint | null;
  status: RangeStatus;
  totalEventsIndexed: number;
  errorMessage: string | null;
  priority: number;
  createdAt: Date | null;
  updatedAt: Date | null;
};

const range = (
  rangeId: number,
  from: number,
  to: number,
  status: RangeStatus,
  currentBlock: number | null = null,
): RangeFixture => ({
  chainId: CHAIN_ID,
  address: ADDRESS,
  rangeId,
  fromBlock: BigInt(from),
  toBlock: BigInt(to),
  direction: 'forward',
  currentBlock: currentBlock === null ? null : BigInt(currentBlock),
  status,
  totalEventsIndexed: 0,
  errorMessage: null,
  priority: 0,
  createdAt: null,
  updatedAt: null,
});

// Mutable fixtures the URL-dispatching get mock reads from, so tests can
// flip the polled state (e.g. 'indexing' → 'paused') between fetches.
let rangesFixture: RangeFixture[] = [];
let headFixture = 0;

beforeEach(() => {
  rangesFixture = [];
  headFixture = 0;
  mockGet.mockReset().mockImplementation(async (url: string) => {
    if (url === rangesUrl) return { ranges: rangesFixture };
    if (url === statusUrl) return { latestBlock: headFixture };
    return {};
  });
  mockPost.mockReset().mockResolvedValue({});
  mockDel.mockReset();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('creation-block honesty', () => {
  it.each([undefined, null, 0])(
    'renders "unknown" instead of a fabricated #0 for creationBlock %s',
    async creationBlock => {
      render(
        <IndexingRangeManager
          chainId={CHAIN_ID}
          contractAddress={ADDRESS}
          creationBlock={creationBlock}
        />,
      );

      await screen.findByText('Contract creation block: unknown');

      expect(screen.queryByText(/created at block/)).toBeNull();
    },
  );

  it('renders the creation block when it is known', async () => {
    render(
      <IndexingRangeManager
        chainId={CHAIN_ID}
        contractAddress={ADDRESS}
        creationBlock={123456}
      />,
    );

    await screen.findByText(`Contract created at block #${(123456).toLocaleString()}`);
  });

  it('does not use 0 as the From Block placeholder when creation is unknown', async () => {
    render(
      <IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} creationBlock={null} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));

    expect(screen.getByPlaceholderText('start block (or earliest)')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('0 (or earliest)')).toBeNull();
  });
});

describe('Catch up to head', () => {
  it('is visible when ranges exist and the head is ahead of the furthest indexed toBlock', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    headFixture = 500;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    expect(await screen.findByRole('button', { name: 'Catch up to head' })).toBeEnabled();
  });

  it('is hidden when the furthest range already reaches the head', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    headFixture = 400;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    await screen.findByText('Up to date');
    expect(screen.queryByRole('button', { name: 'Catch up to head' })).toBeNull();
  });

  it('is hidden when no ranges exist', async () => {
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    await screen.findByText(/No indexing ranges configured/);
    expect(screen.queryByRole('button', { name: 'Catch up to head' })).toBeNull();
  });

  it('creates the catchup range via the auto-starting quick endpoint and refreshes the list', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    headFixture = 500;
    mockPost.mockImplementation(async (url: string) => {
      if (url === quickUrl) {
        // The backend persisted the new range AND started it; the next
        // poll sees it.
        rangesFixture = [...rangesFixture, range(9, 400, 500, 'indexing', 405)];
        return { rangeId: 9, fromBlock: 400, toBlock: 500, started: true };
      }
      return {};
    });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Catch up to head' }));

    // One request: quick create auto-starts server-side, so the manager
    // must not POST /start itself (it would hit 'already being indexed').
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'catchup',
        blockCount: undefined,
        abi: undefined,
      }),
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Indexing started: blocks 400 - 500',
      ),
    );
    // Once the new range reaches the head, the action disappears.
    await screen.findByText('#400 - 500');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Catch up to head' })).toBeNull(),
    );
  });

  it('is disabled and relabelled while the catchup range is being created', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    headFixture = 500;
    let resolveQuick: (value: { rangeId: number }) => void = () => {};
    mockPost.mockImplementation(
      (url: string) =>
        url === quickUrl &&
        new Promise(resolve => {
          resolveQuick = resolve;
        }),
    );

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Catch up to head' }));

    expect(await screen.findByRole('button', { name: 'Catching up...' })).toBeDisabled();

    await act(async () => {
      resolveQuick({ rangeId: 9 });
    });
  });

  it('surfaces the 400 "No previous range found" contract error verbatim', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    headFixture = 500;
    mockPost.mockImplementation((url: string) => {
      if (url === quickUrl) {
        return Promise.reject(
          new ApiError('No previous range found. Cannot catch up.', 400),
        );
      }
      return Promise.resolve({});
    });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Catch up to head' }));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'No previous range found. Cannot catch up.',
      ),
    );
  });
});

describe('First Blocks with unknown creation', () => {
  it('is pre-disabled with an explanatory title instead of offering the 400-ing POST', async () => {
    render(
      <IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} creationBlock={null} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    const firstBlocks = screen.getByRole('button', { name: 'First Blocks' });
    expect(firstBlocks).toBeDisabled();
    expect(firstBlocks).toHaveAttribute('title', 'Contract creation block unknown');

    // A disabled button cannot select the mode, so nothing is ever posted.
    fireEvent.click(firstBlocks);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('is enabled once the creation block is known', async () => {
    render(
      <IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} creationBlock={1234} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    expect(screen.getByRole('button', { name: 'First Blocks' })).toBeEnabled();
  });
});

describe('Continue with no previous range', () => {
  it('is pre-disabled with an explanatory title when the range list is empty', async () => {
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
    expect(continueBtn).toHaveAttribute('title', 'No previous range yet');

    fireEvent.click(continueBtn);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('is enabled once at least one range exists', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled();
  });
});

describe('Add-Range To-Block placeholder', () => {
  it('prefills the chain head, not the furthest already-indexed block', async () => {
    rangesFixture = [range(1, 300, 400, 'completed', 400)];
    headFixture = 5234;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));

    expect(screen.getByPlaceholderText('5234')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('400')).toBeNull();
  });
});

describe('Pause transient state', () => {
  it('shows a disabled Pausing… until the polled status flips away from indexing', async () => {
    vi.useFakeTimers();
    rangesFixture = [range(5, 300, 400, 'indexing', 350)];
    headFixture = 400;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    // Settle the initial fetch (findBy* is unreliable under fake timers).
    await act(async () => {});

    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await act(async () => {});

    // The pause POST resolved but the polled status is still 'indexing'
    // (the job is mid-batch): the button must stay disabled on Pausing….
    expect(screen.getByRole('button', { name: 'Pausing...' })).toBeDisabled();

    // The 3s poll sees the flip to 'paused' and clears the transient state.
    rangesFixture = [range(5, 300, 400, 'paused', 350)];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });

    expect(screen.queryByRole('button', { name: 'Pausing...' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
  });

  it('clears the transient state when the pause request fails', async () => {
    rangesFixture = [range(5, 300, 400, 'indexing', 350)];
    headFixture = 400;
    mockPost.mockRejectedValueOnce(new ApiError('Pause rejected', 500));

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Pause' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled(),
    );
    expect(screen.queryByRole('button', { name: 'Pausing...' })).toBeNull();
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith('Pause rejected');
  });
});

describe('quick create auto-start toasts', () => {
  it('reports indexing as started when the backend auto-start kicked off', async () => {
    mockPost.mockResolvedValue({ rangeId: 3, fromBlock: 100, toBlock: 200, started: true });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recent Blocks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'recent',
        blockCount: 1000,
        abi: undefined,
      }),
    );
    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Indexing started: blocks 100 - 200',
      ),
    );
  });

  it('falls back to a created-with-reason toast when auto-start could not run', async () => {
    mockPost.mockResolvedValue({
      rangeId: 3,
      fromBlock: 100,
      toBlock: 200,
      started: false,
      startError: 'No ABI available — the range stays pending.',
    });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);
    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recent Blocks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Range created: blocks 100 - 200 — not started: No ABI available — the range stays pending.',
      ),
    );
  });
});

describe('admin-token 403 guidance', () => {
  it('appends the RPC admin-token pointer to 403 mutation failures', async () => {
    rangesFixture = [range(2, 100, 200, 'pending')];
    mockPost.mockRejectedValueOnce(new ApiError('Invalid admin token.', 403));

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Start' }));

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        'Invalid admin token. — Set it via ⚙️ RPC → Admin token (stored in this browser)',
      ),
    );
  });

  it('surfaces non-403 API errors verbatim and non-API errors via the fallback', () => {
    expect(describeMutationError(new ApiError('boom', 500), 'Failed to add range')).toBe('boom');
    expect(describeMutationError(new Error('network'), 'Failed to add range')).toBe(
      'Failed to add range',
    );
    expect(describeMutationError('nope', 'Failed to delete range')).toBe(
      'Failed to delete range',
    );
  });
});

describe('one action per range state', () => {
  it('renders a single Resume (continues from checkpoint) for error ranges, with no Start', async () => {
    rangesFixture = [range(4, 100, 200, 'error', 150)];

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    const resume = await screen.findByRole('button', {
      name: 'Resume (continues from checkpoint)',
    });
    expect(resume).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull();
  });

  it('renders Start for pending and plain Resume for paused ranges', async () => {
    rangesFixture = [range(2, 100, 200, 'pending'), range(3, 300, 400, 'paused', 350)];

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    expect(await screen.findByRole('button', { name: 'Start' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Resume' })).toBeEnabled();
    expect(
      screen.queryByRole('button', { name: 'Resume (continues from checkpoint)' }),
    ).toBeNull();
  });
});

describe('cold-start empty state quick actions', () => {
  it('offers one-click Index everything / Index recent when no ranges exist', async () => {
    mockPost.mockResolvedValue({ rangeId: 1, fromBlock: 0, toBlock: 5000, started: true });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    const everything = await screen.findByRole('button', { name: 'Index everything' });
    expect(screen.getByRole('button', { name: 'Index recent' })).toBeEnabled();

    fireEvent.click(everything);

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'all',
        blockCount: undefined,
        abi: undefined,
      }),
    );
    await waitFor(() =>
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        'Indexing started: blocks 0 - 5,000',
      ),
    );
  });

  it('runs the recent quick mode from the Index recent button', async () => {
    mockPost.mockResolvedValue({ rangeId: 1, fromBlock: 4000, toBlock: 5000, started: true });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Index recent' }));

    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'recent',
        blockCount: 1000,
        abi: undefined,
      }),
    );
  });
});

describe('client-side overlap precheck', () => {
  it('gates an overlapping manual create behind a Create anyway second click', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    const [fromInput, toInput] = screen.getAllByRole('textbox');
    fireEvent.change(fromInput, { target: { value: '35000' } });
    fireEvent.change(toInput, { target: { value: '45000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Range' }));

    // The first click only reveals the warning — nothing POSTed yet.
    expect(mockPost).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Overlaps existing range #7 (30,000–40,000) — events in the overlap will be indexed twice',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create anyway' })).toBeEnabled();

    // The explicit second click performs the original submit unchanged.
    fireEvent.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(mockPost).toHaveBeenCalledWith(rangesUrl, {
      fromBlock: 35000,
      toBlock: 45000,
      direction: 'forward',
    });
  });

  it('creates a non-overlapping manual range in one click with no warning', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    const [fromInput, toInput] = screen.getAllByRole('textbox');
    fireEvent.change(fromInput, { target: { value: '45000' } });
    fireEvent.change(toInput, { target: { value: '48000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Range' }));

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Overlaps existing range/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create anyway' })).toBeNull();
  });

  it('gates the continue quick mode, which re-touches the previous range boundary', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // The backend continues from ranges[0].toBlock (40000) INCLUSIVE, so
    // the would-be range [40000, 41000] overlaps range #7 itself.
    expect(mockPost).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        'Overlaps existing range #7 (30,000–40,000) — events in the overlap will be indexed twice',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'continue',
        blockCount: 1000,
        abi: undefined,
      }),
    );
  });

  it('gates the all quick mode against any existing range', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;

    render(
      <IndexingRangeManager
        chainId={CHAIN_ID}
        contractAddress={ADDRESS}
        creationBlock={1000}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Index All' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // 'all' spans [creation, head] = [1000, 50000], which covers range #7.
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByText(/Overlaps existing range #7/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create anyway' })).toBeEnabled();
  });

  it('gates the recent quick mode — its head-anchored window is not overlap-free', async () => {
    rangesFixture = [range(8, 49000, 50000, 'completed', 50000)];
    headFixture = 50000;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Recent Blocks' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    // The recent window [head - 1000, head] = [49000, 50000] exactly
    // re-covers range #8, so the gate must fire.
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByText(/Overlaps existing range #8/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create anyway' }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'recent',
        blockCount: 1000,
        abi: undefined,
      }),
    );
  });

  it('never gates catchup even when ranges exist', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;
    mockPost.mockResolvedValue({ rangeId: 9, fromBlock: 40000, toBlock: 50000, started: true });

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Catch up to head' }));

    // Catchup extends the furthest existing toBlock to the head — it is
    // overlap-free by construction, so it POSTs in a single click.
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'catchup',
        blockCount: undefined,
        abi: undefined,
      }),
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Overlaps existing range/)).toBeNull();
  });

  it('resets the armed manual confirmation when the gated inputs change', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    const [fromInput, toInput] = screen.getAllByRole('textbox');
    fireEvent.change(fromInput, { target: { value: '35000' } });
    fireEvent.change(toInput, { target: { value: '45000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Range' }));
    expect(screen.getByRole('button', { name: 'Create anyway' })).toBeEnabled();

    // Editing From Block drops the gate: warning gone, label back — and
    // the next submit re-runs the precheck (still overlapping → re-gated,
    // still no POST).
    fireEvent.change(fromInput, { target: { value: '36000' } });
    expect(screen.queryByText(/Overlaps existing range/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Add Range' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Add Range' }));
    expect(mockPost).not.toHaveBeenCalled();
    expect(screen.getByText(/Overlaps existing range #7/)).toBeInTheDocument();
  });

  it('resets the quick gate when the selected quick mode changes', async () => {
    rangesFixture = [range(7, 30000, 40000, 'completed', 40000)];
    headFixture = 50000;

    render(<IndexingRangeManager chainId={CHAIN_ID} contractAddress={ADDRESS} />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Add Range' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText(/Overlaps existing range #7/)).toBeInTheDocument();

    // Switching to Recent Blocks drops the gate; its [49000, 50000]
    // window does not overlap #7 (30000–40000), so Create POSTs directly.
    fireEvent.click(screen.getByRole('button', { name: 'Recent Blocks' }));
    expect(screen.queryByText(/Overlaps existing range/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(quickUrl, {
        mode: 'recent',
        blockCount: 1000,
        abi: undefined,
      }),
    );
    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});
