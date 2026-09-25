// Deep Scan panel tests: the real panel + the real useScanJob hook run
// against a mocked util/http edge, so the tests pin the full wiring —
// the GET envelope parsing (404 → no-job intro), the POST bodies of the
// mutating actions, the honest renderings per job state (progress/pause,
// error/resume, the genesis-anchored complete line), the scan_conflict
// force-restart affordance, the settled-only catch-up affordance (202 →
// optimistic notice + immediate refetch, already_caught_up as a friendly
// notice, invalid_state verbatim, 404 vanish → refetch), the poll
// lifecycle (3s while pending/running, stopped when settled, nothing
// after unmount), the includeTraces opt-in (unchecked wire stays
// byte-identical) and the per-job traces meta line. The ETA wrappers'
// sampler math (window threshold, void-on-pause, void-on-regression) is
// pinned as pure functions the same way the range manager's own sampler
// is.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { ApiError } from '@/util/apiError';
import { clearAllCaches } from '@/util/useQuery';
import {
  DeepScan,
  estimateScanEta,
  recordScanEtaSample,
} from '@/views/Address/DeepScan';
import { parseScanJob, type ScanJob } from '@/services/addressScan';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}));

// Only the network edge is replaced: the query layer, the conditional
// poller and the panel logic all stay real. `api` needs a pipe() stub
// because the service derives its scanApi chain at module level.
vi.mock('@/util/http', () => ({
  get: (...args: unknown[]) => mocks.get(...args),
  post: (...args: unknown[]) => mocks.post(...args),
  put: vi.fn(),
  del: (...args: unknown[]) => mocks.del(...args),
  api: { pipe: () => ({}) },
  longRunningApi: { pipe: () => ({}) },
  withSignal: (o: unknown) => o,
  isBackendUnreachable: (e: unknown) => e instanceof ApiError && e.status === 0,
}));

const CHAIN_ID = 1;
const ADDRESS = '0x1234567890abcdef1234567890abcdef12345678';
const SCAN_URL = `/api/chains/${CHAIN_ID}/addresses/${ADDRESS}/scan`;

const runningJob: ScanJob = {
  status: 'running',
  fromBlock: 0,
  toBlock: 20_000_000,
  cursorBlock: 1_234_567,
  blocksWalked: 1_234_568,
  blocksTotal: 20_000_001,
  txsFound: 42,
  errorMessage: null,
  coverage: null,
  updatedAt: '2026-09-24T00:00:00.000Z',
  tracesRequested: false,
  tracesSupported: null,
  tracesRecorded: 0,
};

const envelope = (job: ScanJob | null) => (job === null ? null : { job });

const renderPanel = (txPayload: unknown = { transactions: [], total: 0 }) =>
  render(<DeepScan chainId={CHAIN_ID} address={ADDRESS} txPayload={txPayload} />);

// Real-timer settle helper for the render describes: flushes the mount
// fetch's microtask chain so the panel lands in its settled branch.
const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

describe('DeepScan panel rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllCaches();
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.del.mockReset();
  });

  it('renders the no-job intro and posts the contract body on start', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();

    await settle();
    // 404-shaped absence → intro, not an error.
    expect(mocks.get).toHaveBeenCalledWith(SCAN_URL, undefined, expect.anything());
    expect(
      screen.getByText(/walks the chain from a start block verifying balance/i),
    ).toBeInTheDocument();
    // The honesty hints ride the intro.
    expect(screen.getByText(/archive-capable RPC/i)).toBeInTheDocument();
    expect(screen.getByText(/Non-genesis starts can never claim complete/i)).toBeInTheDocument();
    expect(screen.getByText(/only while the explorer backend runs/i)).toBeInTheDocument();

    // Empty from-block input → the wire body says 'earliest' explicitly.
    mocks.post.mockResolvedValue(envelope({ ...runningJob, status: 'pending' }));
    fireEvent.click(screen.getByTestId('deep-scan-start'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        SCAN_URL,
        { fromBlock: 'earliest' },
        expect.anything(),
      ),
    );
  });

  it('sends the typed from-block as a number and disables start on junk input', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();
    await settle();

    fireEvent.change(screen.getByLabelText('Deep scan start block'), {
      target: { value: '5000' },
    });
    mocks.post.mockResolvedValue(envelope({ ...runningJob, status: 'pending', fromBlock: 5000 }));
    fireEvent.click(screen.getByTestId('deep-scan-start'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        SCAN_URL,
        { fromBlock: 5000 },
        expect.anything(),
      ),
    );

    // Junk input never reaches the wire.
    fireEvent.change(screen.getByLabelText('Deep scan start block'), {
      target: { value: '-7' },
    });
    expect(screen.getByTestId('deep-scan-start')).toBeDisabled();
    expect(screen.getByText(/non-negative integer/i)).toBeInTheDocument();
  });

  it('renders a running job with progress and pause, and pauses via POST', async () => {
    mocks.get.mockResolvedValue(envelope(runningJob));
    renderPanel();
    await settle();

    expect(screen.getByTestId('deep-scan-status').textContent).toMatch(/Running/i);
    expect(screen.getByTestId('deep-scan-progress').textContent).toContain(
      'Walked 1,234,568 / 20,000,001 blocks (6.2%)',
    );
    expect(screen.getByTestId('deep-scan-txs').textContent).toContain(
      'Transactions found: 42',
    );
    // No honest rate measured yet → no promised date.
    expect(screen.getByTestId('deep-scan-eta').textContent).toMatch(
      /no honest estimate yet/i,
    );

    mocks.post.mockResolvedValue(envelope({ ...runningJob, status: 'paused' }));
    fireEvent.click(screen.getByTestId('deep-scan-pause'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        `${SCAN_URL}/pause`,
        {},
        expect.anything(),
      ),
    );
    // The resolved job flows through: the panel refetches the live state.
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });

  it('renders an errored job with the provider message and resumes via POST', async () => {
    mocks.get.mockResolvedValue(
      envelope({
        ...runningJob,
        status: 'error',
        errorMessage: 'provider: historical state not available',
      }),
    );
    renderPanel();
    await settle();

    expect(screen.getByTestId('deep-scan-error').textContent).toContain(
      'historical state not available',
    );
    expect(screen.queryByTestId('deep-scan-pause')).not.toBeInTheDocument();

    mocks.post.mockResolvedValue(envelope(runningJob));
    fireEvent.click(screen.getByTestId('deep-scan-resume'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        `${SCAN_URL}/resume`,
        {},
        expect.anything(),
      ),
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
  });

  it('renders the complete line only for the genesis-anchored complete walk', async () => {
    mocks.get.mockResolvedValue(
      envelope({
        ...runningJob,
        status: 'complete',
        cursorBlock: 20_000_000,
        blocksWalked: 20_000_001,
        coverage: 'complete',
      }),
    );
    renderPanel();
    await settle();

    const completeLine = screen.getByTestId('deep-scan-complete');
    expect(completeLine.textContent).toContain('every block from genesis (0)');
    expect(completeLine.textContent).toContain('only provable "complete" coverage');
    // The completeness claim is scoped to the walk's own end bound —
    // the chain may have moved past it (see catch-up below).
    expect(completeLine.textContent).toContain('… up to block 20,000,000');
  });

  it('keeps a finished non-genesis walk honest: no complete line, genesis caveat instead', async () => {
    mocks.get.mockResolvedValue(
      envelope({
        ...runningJob,
        fromBlock: 9_000_000,
        status: 'complete',
        cursorBlock: 20_000_000,
        blocksWalked: 11_000_001,
        blocksTotal: 11_000_001,
        coverage: null,
      }),
    );
    renderPanel();
    await settle();

    expect(screen.queryByTestId('deep-scan-complete')).not.toBeInTheDocument();
    expect(
      screen.getByText(/non-genesis start cannot prove there was no activity/i),
    ).toBeInTheDocument();
  });

  it('offers the force restart inline when the start 400s with scan_conflict', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();
    await settle();

    mocks.post.mockRejectedValueOnce(
      new ApiError('A scan job already exists with different bounds', 400, 'scan_conflict'),
    );
    fireEvent.click(screen.getByTestId('deep-scan-start'));
    await waitFor(() =>
      expect(screen.getByTestId('deep-scan-conflict')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('deep-scan-conflict').textContent).toContain(
      'different bounds',
    );
    expect(screen.queryByTestId('deep-scan-action-error')).not.toBeInTheDocument();

    // The force path re-POSTs with force: true (bounds replaced, progress reset).
    mocks.post.mockResolvedValueOnce(envelope({ ...runningJob, status: 'pending' }));
    fireEvent.click(screen.getByTestId('deep-scan-force-restart'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenLastCalledWith(
        SCAN_URL,
        { fromBlock: 'earliest', force: true },
        expect.anything(),
      ),
    );
  });

  it('surfaces a 403 with the admin-token guidance inline', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();
    await settle();

    mocks.post.mockRejectedValueOnce(new ApiError('Invalid admin token.', 403));
    fireEvent.click(screen.getByTestId('deep-scan-start'));
    await waitFor(() =>
      expect(screen.getByTestId('deep-scan-action-error').textContent).toContain(
        'Admin token',
      ),
    );
  });

  it('seeds from the payload job before the live GET settles and deletes via DELETE', async () => {
    // The payload's inline job renders immediately; the live read never
    // settles in this test, pinning that the panel does not wait for it.
    mocks.get.mockReturnValue(new Promise(() => undefined));
    renderPanel({ transactions: [], total: 42, deepScan: runningJob });

    expect(screen.getByTestId('deep-scan-status').textContent).toMatch(/Running/i);
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(1);

    mocks.del.mockResolvedValue(undefined);
    fireEvent.click(screen.getByTestId('deep-scan-delete'));
    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith(SCAN_URL, expect.anything()));
  });
});

describe('DeepScan traces opt-in and per-job traces meta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllCaches();
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.del.mockReset();
  });

  it('leaves includeTraces unchecked by default — the start body stays byte-identical to today', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();
    await settle();

    expect(screen.getByTestId('deep-scan-include-traces')).not.toBeChecked();
    // The intro explains the checkbox's honest scope.
    expect(
      screen.getByText(/only in blocks where this address changed/i),
    ).toBeInTheDocument();

    mocks.post.mockResolvedValue(envelope({ ...runningJob, status: 'pending' }));
    fireEvent.click(screen.getByTestId('deep-scan-start'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        SCAN_URL,
        { fromBlock: 'earliest' },
        expect.anything(),
      ),
    );
  });

  it('rides includeTraces: true only when the checkbox is checked', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();
    await settle();

    fireEvent.click(screen.getByTestId('deep-scan-include-traces'));
    expect(screen.getByTestId('deep-scan-include-traces')).toBeChecked();

    mocks.post.mockResolvedValue(
      envelope({ ...runningJob, status: 'pending', tracesRequested: true }),
    );
    fireEvent.click(screen.getByTestId('deep-scan-start'));
    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(
        SCAN_URL,
        { fromBlock: 'earliest', includeTraces: true },
        expect.anything(),
      ),
    );
  });

  it('renders the recorded count for a traces-requested job', async () => {
    mocks.get.mockResolvedValue(
      envelope({
        ...runningJob,
        tracesRequested: true,
        tracesSupported: true,
        tracesRecorded: 1_234,
      }),
    );
    renderPanel();
    await settle();

    expect(screen.getByTestId('deep-scan-traces').textContent).toBe(
      'Internal transactions recorded: 1,234',
    );
  });

  it('renders the honest refusal verbatim when the RPC cannot trace', async () => {
    mocks.get.mockResolvedValue(
      envelope({
        ...runningJob,
        tracesRequested: true,
        tracesSupported: false,
        tracesRecorded: 0,
      }),
    );
    renderPanel();
    await settle();

    expect(screen.getByTestId('deep-scan-traces').textContent).toBe(
      'traces unavailable on this RPC — the walk continued without them',
    );
  });

  it('renders no traces line for walks that never asked for recording', async () => {
    mocks.get.mockResolvedValue(envelope(runningJob));
    renderPanel();
    await settle();

    expect(screen.queryByTestId('deep-scan-traces')).not.toBeInTheDocument();
  });
});

// The additive seam: legacy inline deepScan payloads (no traces keys at
// all) must keep parsing with honest defaults so the payload-seeded path
// never regresses.
describe('parseScanJob traces fields (additive seam)', () => {
  // The pre-traces wire shape, exactly as legacy rows serialized it.
  const legacyWireJob = {
    status: 'running',
    fromBlock: 0,
    toBlock: 20_000_000,
    cursorBlock: 1_234_567,
    blocksWalked: 1_234_568,
    blocksTotal: 20_000_001,
    txsFound: 42,
    errorMessage: null,
    coverage: null,
    updatedAt: '2026-09-24T00:00:00.000Z',
  };

  it('defaults absent traces fields so legacy payloads keep parsing', () => {
    const job = parseScanJob(legacyWireJob);
    expect(job).not.toBeNull();
    expect(job?.tracesRequested).toBe(false);
    expect(job?.tracesSupported).toBeNull();
    expect(job?.tracesRecorded).toBe(0);
  });

  it('keeps junk in the additive fields from rendering a lie', () => {
    const job = parseScanJob({
      ...legacyWireJob,
      tracesRequested: 'yes',
      tracesSupported: 'no',
      tracesRecorded: -3,
    });
    expect(job?.tracesRequested).toBe(false);
    expect(job?.tracesSupported).toBeNull();
    expect(job?.tracesRecorded).toBe(0);
  });

  it('flows the fields through when the wire carries them', () => {
    const job = parseScanJob({
      ...legacyWireJob,
      tracesRequested: true,
      tracesSupported: true,
      tracesRecorded: 7,
    });
    expect(job?.tracesRequested).toBe(true);
    expect(job?.tracesSupported).toBe(true);
    expect(job?.tracesRecorded).toBe(7);
  });
});

describe('DeepScan catch-up affordance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAllCaches();
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.del.mockReset();
  });

  // Fresh mount per status: the query cache is keyed by (chainId,
  // address), so a second render of the same key would read the first
  // render's cached job instead of the new mock unless cleared.
  const mountWithStatus = async (status: ScanJob['status']) => {
    clearAllCaches();
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status }));
    const view = renderPanel();
    await settle();
    return view;
  };

  it('offers catch-up only on settled jobs (complete/paused/error), never while live', async () => {
    // A live walk: the bound is what it is — no catch-up.
    const running = await mountWithStatus('running');
    expect(screen.queryByTestId('deep-scan-catchup')).not.toBeInTheDocument();
    running.unmount();

    const pending = await mountWithStatus('pending');
    expect(screen.queryByTestId('deep-scan-catchup')).not.toBeInTheDocument();
    pending.unmount();

    for (const status of ['complete', 'paused', 'error'] as const) {
      const view = await mountWithStatus(status);
      const button = screen.getByTestId('deep-scan-catchup');
      expect(button).toBeInTheDocument();
      expect(button.textContent).toContain('Catch up to latest');
      view.unmount();
    }
  });

  it('POSTs /catchup on click and shows the optimistic notice + immediate refetch on 202', async () => {
    mocks.get.mockResolvedValueOnce(envelope({ ...runningJob, status: 'paused' }));
    const view = renderPanel();
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(1);

    // The refetch hangs: pins that 'Catching up…' renders optimistically,
    // straight off the 202, before any live read replaces it.
    mocks.get.mockReturnValue(new Promise(() => undefined));
    mocks.post.mockResolvedValueOnce(envelope({ ...runningJob, status: 'pending' }));
    fireEvent.click(screen.getByTestId('deep-scan-catchup'));

    await waitFor(() =>
      expect(mocks.post).toHaveBeenCalledWith(`${SCAN_URL}/catchup`, {}, expect.anything()),
    );
    await waitFor(() =>
      expect(screen.getByTestId('deep-scan-catchup-notice').textContent)
        .toContain('Catching up'),
    );
    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    view.unmount();
  });

  it('hands the story to the polled GET once the refetch sees the walk active again', async () => {
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status: 'paused' }));
    renderPanel();
    await settle();

    mocks.post.mockResolvedValueOnce(envelope({ ...runningJob, status: 'pending' }));
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status: 'pending' }));
    fireEvent.click(screen.getByTestId('deep-scan-catchup'));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId('deep-scan-status').textContent).toMatch(/Pending/i),
    );
    // The live walk hides the affordance again and retires the notice.
    expect(screen.queryByTestId('deep-scan-catchup')).not.toBeInTheDocument();
    expect(screen.queryByTestId('deep-scan-catchup-notice')).not.toBeInTheDocument();
  });

  it('renders already_caught_up as a friendly inline notice, not an error, and keeps the controls', async () => {
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status: 'complete' }));
    renderPanel();
    await settle();

    mocks.post.mockRejectedValueOnce(
      new ApiError('Scan is already at the chain head', 400, 'already_caught_up'),
    );
    fireEvent.click(screen.getByTestId('deep-scan-catchup'));

    await waitFor(() =>
      expect(screen.getByTestId('deep-scan-catchup-notice').textContent)
        .toContain('Already at the chain head'),
    );
    expect(screen.queryByTestId('deep-scan-action-error')).not.toBeInTheDocument();
    expect(screen.getByTestId('deep-scan-catchup')).toBeInTheDocument();
    expect(screen.getByTestId('deep-scan-delete')).toBeInTheDocument();

    // The notice self-clears on the next action (here: one that hangs).
    mocks.post.mockReset().mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByTestId('deep-scan-catchup'));
    await waitFor(() =>
      expect(screen.queryByTestId('deep-scan-catchup-notice')).not.toBeInTheDocument(),
    );
  });

  it('surfaces invalid_state verbatim and keeps the existing controls', async () => {
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status: 'paused' }));
    renderPanel();
    await settle();

    mocks.post.mockRejectedValueOnce(
      new ApiError('Scan is running — wait for it to finish or pause it first', 400, 'invalid_state'),
    );
    fireEvent.click(screen.getByTestId('deep-scan-catchup'));

    await waitFor(() =>
      expect(screen.getByTestId('deep-scan-action-error').textContent)
        .toContain('Scan is running — wait for it to finish or pause it first'),
    );
    expect(screen.queryByTestId('deep-scan-catchup-notice')).not.toBeInTheDocument();
    expect(screen.getByTestId('deep-scan-catchup')).toBeInTheDocument();
    expect(screen.getByTestId('deep-scan-resume')).toBeInTheDocument();
    expect(screen.getByTestId('deep-scan-delete')).toBeInTheDocument();
  });

  it('refetches without an error when the job vanished (404 — e.g. deleted in another tab)', async () => {
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status: 'paused' }));
    renderPanel();
    await settle();
    expect(mocks.get).toHaveBeenCalledTimes(1);

    // The helper resolves a 404 as null → the action's then-branch
    // refetches; the live read now reports the absence → the intro.
    // (The refetch rejects the way the real 404 does — envelope(null)
    // would be a malformed 200, not the backend's no_scan_job 404.)
    mocks.post.mockRejectedValueOnce(new ApiError('no_scan_job', 404, 'no_scan_job'));
    mocks.get.mockRejectedValueOnce(new ApiError('no_scan_job', 404, 'no_scan_job'));
    fireEvent.click(screen.getByTestId('deep-scan-catchup'));

    await waitFor(() => expect(mocks.get).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText(/walks the chain from a start block verifying balance/i))
        .toBeInTheDocument(),
    );
    expect(screen.queryByTestId('deep-scan-action-error')).not.toBeInTheDocument();
  });
});

describe('DeepScan poll lifecycle', () => {
  // Fake-timer advance wrapped in act: each tick's settle must land inside
  // the React act scope to observe the re-render it triggers.
  const tick = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clearAllCaches();
    mocks.get.mockReset().mockResolvedValue(envelope(runningJob));
    mocks.post.mockReset();
    mocks.del.mockReset();
  });

  afterEach(() => {
    clearAllCaches();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls every 3s while running and stops once the job settles', async () => {
    renderPanel();
    await tick(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    await tick(3_000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    await tick(3_000);
    expect(mocks.get).toHaveBeenCalledTimes(3);

    // The next tick observes a settled job (paused) — after it, silence.
    mocks.get.mockResolvedValue(envelope({ ...runningJob, status: 'paused' }));
    await tick(3_000);
    expect(mocks.get).toHaveBeenCalledTimes(4);

    await tick(30_000);
    expect(mocks.get).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId('deep-scan-status').textContent).toMatch(/Paused/i);
  });

  it('stops polling on unmount (tab switch) — no dangling timers', async () => {
    const { unmount } = renderPanel();
    await tick(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    await tick(9_000);
    expect(mocks.get).toHaveBeenCalledTimes(4);

    unmount();
    await tick(60_000);
    expect(mocks.get).toHaveBeenCalledTimes(4);
  });

  it('never polls when no job row exists', async () => {
    mocks.get.mockResolvedValue(envelope(null));
    renderPanel();
    await tick(0);
    expect(mocks.get).toHaveBeenCalledTimes(1);

    await tick(30_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/walks the chain from a start block/i)).toBeInTheDocument();
  });
});

// The scan-shaped wrappers around the range manager's sampler: the same
// honesty rules (≥2 samples ≥6s apart, voided on pause, voided when the
// cursor walks backwards) must hold through the scan mapping.
describe('scan ETA sampler', () => {
  const walking = (cursorBlock: number): ScanJob => ({
    ...runningJob,
    status: 'running',
    cursorBlock,
    blocksWalked: cursorBlock + 1,
  });

  it('accumulates samples only while running, keyed off the cursor', () => {
    let tracker = recordScanEtaSample(undefined, walking(150_000), 0);
    expect(tracker).toEqual({ status: 'indexing', samples: [{ t: 0, block: 150_000 }] });

    tracker = recordScanEtaSample(tracker, walking(155_000), 3_000);
    expect(tracker.samples).toEqual([
      { t: 0, block: 150_000 },
      { t: 3_000, block: 155_000 },
    ]);
  });

  it('refuses to promise a date with fewer than two samples or a sub-6s window', () => {
    expect(estimateScanEta([], walking(160_000))).toBeNull();

    const shortWindow = recordScanEtaSample(
      recordScanEtaSample(undefined, walking(150_000), 0),
      walking(160_000),
      5_999,
    );
    expect(estimateScanEta(shortWindow.samples, walking(160_000))).toBeNull();

    // One more millisecond of span tips it over the threshold.
    const ok = recordScanEtaSample(
      recordScanEtaSample(undefined, walking(150_000), 0),
      walking(160_000),
      6_000,
    );
    expect(estimateScanEta(ok.samples, walking(160_000))).not.toBeNull();
  });

  it('extrapolates the remaining walk from the sampled rate', () => {
    // 10,000 blocks in 10s → 1,000 blocks/s; 40,000 to toBlock → 40s.
    const tracker = recordScanEtaSample(
      recordScanEtaSample(undefined, walking(150_000), 0),
      walking(160_000),
      10_000,
    );
    const job = { ...walking(160_000), toBlock: 200_000 };
    expect(estimateScanEta(tracker.samples, job)).toEqual({
      blocksPerSec: 1_000,
      remainingMs: 40_000,
    });
  });

  it('voids the rate window across a pause', () => {
    let tracker = recordScanEtaSample(undefined, walking(150_000), 0);
    tracker = recordScanEtaSample(tracker, walking(160_000), 7_000);
    expect(estimateScanEta(tracker.samples, walking(160_000))).not.toBeNull();

    tracker = recordScanEtaSample(tracker, { ...walking(160_000), status: 'paused' }, 8_000);
    expect(tracker).toEqual({ status: 'paused', samples: [] });

    // The resume restarts from one fresh observation.
    tracker = recordScanEtaSample(tracker, walking(160_100), 9_000);
    expect(tracker.samples).toEqual([{ t: 9_000, block: 160_100 }]);
    expect(estimateScanEta(tracker.samples, walking(160_100))).toBeNull();
  });

  it('voids the rate window when the cursor regresses (job restarted from scratch)', () => {
    let tracker = recordScanEtaSample(undefined, walking(150_000), 0);
    tracker = recordScanEtaSample(tracker, walking(160_000), 7_000);

    // Force-restart reset the cursor behind the window's floor.
    tracker = recordScanEtaSample(tracker, walking(100_000), 8_000);
    expect(tracker.samples).toEqual([{ t: 8_000, block: 100_000 }]);
    expect(estimateScanEta(tracker.samples, walking(100_000))).toBeNull();
  });

  it('keeps no samples while the job is pending (nothing walking yet)', () => {
    const tracker = recordScanEtaSample(undefined, { ...walking(0), status: 'pending' }, 0);
    expect(tracker).toEqual({ status: 'pending', samples: [] });
  });
});
