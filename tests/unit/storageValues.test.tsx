import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { toHex, type Hex } from 'viem';
import {
  createStorageValueStore,
  StorageValuesProvider,
  useSlotValue,
  useRefreshStorageValues,
  useStorageValuesPending,
  type SlotReader,
} from '@/services/storageValues';

const ADDR = '0x0000000000000000000000000000000000000001';

// A reader whose promises settle only when the test decides, giving exact
// control over what is in flight.
type ManualCall = {
  slot: Hex;
  resolve: (value: Hex | null) => void;
  reject: (err: unknown) => void;
};

const createManualReader = (): { reader: SlotReader; calls: ManualCall[] } => {
  const calls: ManualCall[] = [];
  return {
    calls,
    reader: slot =>
      new Promise<Hex | null>((resolve, reject) => {
        calls.push({ slot, resolve, reject });
      }),
  };
};

// Let queued microtasks (reader resolution -> state transition -> pump)
// run through at least one macrotask boundary.
const flush = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
};

const slotOf = (n: number): Hex => toHex(BigInt(n));

const createStore = (reader: SlotReader, concurrency?: number) =>
  createStorageValueStore({ chainId: 1, address: ADDR, reader, concurrency });

describe('createStorageValueStore', () => {
  it('dedupes concurrent and repeated requests by normalized slot', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader);

    store.request(['0x03']);
    store.request(['0x3']);
    store.request([slotOf(3)]);
    expect(calls).toHaveLength(1);

    calls[0].resolve('0xaa');
    await flush();

    // '0x03', '0x3' and the canonical form all share one entry.
    expect(store.getState('0x03')).toEqual({ status: 'ok', value: '0xaa', error: null });
    expect(store.getState('0x3')).toBe(store.getState('0x03'));

    // Already ok: request() is a noop.
    store.request(['0x3']);
    expect(calls).toHaveLength(1);
  });

  it('keeps snapshot objects identity-stable between transitions', () => {
    const { reader } = createManualReader();
    const store = createStore(reader);

    const before = store.getState('0x7');
    expect(store.getState('0x7')).toBe(before);
    store.request(['0x7']);
    const loading = store.getState('0x7');
    expect(loading).not.toBe(before);
    expect(loading.status).toBe('loading');
    expect(store.getState('0x7')).toBe(loading);
  });

  it('runs at most `concurrency` reads simultaneously (default 6)', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader);
    const slots = Array.from({ length: 10 }, (_, i) => slotOf(i));

    store.request(slots);
    // Default concurrency 6: exactly 6 readers in flight, 4 still queued
    // (all 10 requested slots are pending from the consumer's view).
    expect(calls).toHaveLength(6);
    expect(store.pendingCount()).toBe(10);

    for (let i = 0; i < 6; i++) calls[i].resolve(slotOf(0x100 + i));
    await flush();
    expect(calls).toHaveLength(10);
    expect(store.pendingCount()).toBe(4);

    for (let i = 6; i < 10; i++) calls[i].resolve(slotOf(0x100 + i));
    await flush();

    for (let i = 0; i < 10; i++) {
      expect(store.getState(slots[i])).toEqual({
        status: 'ok',
        value: slotOf(0x100 + i),
        error: null,
      });
    }
    expect(store.pendingCount()).toBe(0);
  });

  it('never exceeds an explicit concurrency cap while draining', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const reader: SlotReader = async () => {
      inFlight += 1;
      if (inFlight > maxInFlight) maxInFlight = inFlight;
      await Promise.resolve();
      inFlight -= 1;
      return '0x42';
    };
    const store = createStore(reader, 3);
    const slots = Array.from({ length: 10 }, (_, i) => slotOf(i));

    store.request(slots);
    await flush();

    expect(maxInFlight).toBe(3);
    for (const slot of slots) {
      expect(store.getState(slot)).toEqual({ status: 'ok', value: '0x42', error: null });
    }
  });

  it('refresh force-requeues ok and error slots but shares in-flight reads', async () => {
    const reader = vi.fn<SlotReader>(async () => '0xbb');
    reader.mockImplementationOnce(async () => '0xaa');
    const store = createStore(reader);

    store.request(['0x5']);
    await flush();
    expect(store.getState('0x5').value).toBe('0xaa');

    store.refresh(['0x5']);
    expect(reader).toHaveBeenCalledTimes(2);
    // Second refresh while the re-read is pending shares it.
    store.refresh(['0x5']);
    expect(reader).toHaveBeenCalledTimes(2);
    await flush();
    expect(store.getState('0x5')).toEqual({ status: 'ok', value: '0xbb', error: null });
  });

  it('refresh keeps the previous value visible while re-reading', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader);

    store.request(['0x5']);
    calls[0].resolve('0xaa');
    await flush();

    store.refresh(['0x5']);
    const reloading = store.getState('0x5');
    expect(reloading.status).toBe('loading');
    expect(reloading.value).toBe('0xaa');

    calls[1].resolve('0xbb');
    await flush();
    expect(store.getState('0x5').value).toBe('0xbb');
  });

  it('refresh() without arguments re-reads every known slot', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const store = createStore(reader);

    store.request(['0x1', '0x2']);
    await flush();
    expect(reader).toHaveBeenCalledTimes(2);

    store.refresh();
    await flush();
    expect(reader).toHaveBeenCalledTimes(4);
    expect(store.getState('0x1').status).toBe('ok');
    expect(store.getState('0x2').status).toBe('ok');
  });

  it('refresh wakes error slots and error states carry the real message', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x9');
    reader.mockImplementationOnce(async () => {
      throw new Error('rpc down');
    });
    reader.mockImplementationOnce(async () => {
      throw 'plain string failure';
    });
    const store = createStore(reader);

    store.request(['0x1']);
    await flush();
    expect(store.getState('0x1')).toEqual({
      status: 'error',
      value: null,
      error: 'rpc down',
    });

    store.request(['0x1']); // error slots are re-requestable
    await flush();
    expect(store.getState('0x1').error).toBe('plain string failure');

    store.refresh(['0x1']); // refresh also wakes error slots
    await flush();
    expect(store.getState('0x1')).toEqual({ status: 'ok', value: '0x9', error: null });
    expect(reader).toHaveBeenCalledTimes(3);
  });

  it('readMany preserves order, maps failures to null and never rejects', async () => {
    const reader = vi.fn<SlotReader>(async slot => {
      if (slot === '0xa') return '0xaa';
      if (slot === '0xb') throw new Error('nope');
      if (slot === '0xc') return '0xcc';
      return null;
    });
    const store = createStore(reader);

    const result = await store.readMany(['0xa', '0xb', '0xc', '0xd']);
    expect(result).toEqual(['0xaa', null, '0xcc', null]);
  });

  it('readMany is bounded by the same queue as stateful reads', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader, 1);

    store.request(['0x1']);
    const bulk = store.readMany(['0x2']);
    expect(calls).toHaveLength(1);

    calls[0].resolve('0xaa');
    await flush();
    expect(calls).toHaveLength(2);
    expect(calls[1].slot).toBe('0x2');

    calls[1].resolve('0xbb');
    expect(await bulk).toEqual(['0xbb']);
  });

  it('readMany settles queued slots with null when the store is disposed', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader, 1);

    const bulk = store.readMany(['0x1', '0x2']);
    expect(calls).toHaveLength(1);
    store.dispose();
    // The in-flight read resolves after dispose: its value is ignored.
    calls[0].resolve('0xaa');
    expect(await bulk).toEqual([null, null]);
  });

  it('readMany on a disposed store resolves all-null without reading', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const store = createStore(reader);
    store.dispose();
    expect(await store.readMany(['0x1', '0x2'])).toEqual([null, null]);
    expect(reader).not.toHaveBeenCalled();
  });

  it('setEnabled(false) parks new requests without touching existing state', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const store = createStore(reader);

    store.setEnabled(false);
    store.request(['0x1']);
    store.refresh(['0x1']);
    await flush();
    expect(reader).not.toHaveBeenCalled();
    expect(store.getState('0x1')).toEqual({ status: 'idle', value: null, error: null });

    // Imperative bulk reads are explicit calls, not parked by the flag.
    expect(await store.readMany(['0x1'])).toEqual(['0x1']);

    store.setEnabled(true);
    store.request(['0x1']);
    await flush();
    expect(reader).toHaveBeenCalledTimes(2); // readMany + request
    expect(store.getState('0x1').status).toBe('ok');
  });

  it('dispose stops notifications and ignores pending results', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader, 1);
    const listener = vi.fn();
    store.subscribe('0x1', listener);

    store.request(['0x1', '0x2']);
    expect(listener).toHaveBeenCalledTimes(1); // idle -> loading

    store.dispose();
    calls[0].resolve('0xff');
    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1); // the queued slot never ran
    expect(store.pendingCount()).toBe(0);
    expect(store.getState('0x1').status).toBe('idle');
  });

  it('unsubscribing stops callbacks for that slot', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const store = createStore(reader);
    const listener = vi.fn();
    const unsubscribe = store.subscribe('0x1', listener);

    store.request(['0x1']);
    await flush();
    expect(listener).toHaveBeenCalledTimes(2); // loading + ok
    unsubscribe();

    store.refresh(['0x1']);
    await flush();
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('notifies pending-count subscribers as reads start and finish', async () => {
    const { reader, calls } = createManualReader();
    const store = createStore(reader);
    const observed: number[] = [];
    store.subscribePending(() => observed.push(store.pendingCount()));

    store.request(['0x1', '0x2']);
    expect(store.pendingCount()).toBe(2);
    calls[0].resolve('0x1');
    await flush();
    calls[1].resolve('0x2');
    await flush();

    // Reads enqueue one slot at a time: 0 -> 1 -> 2, then back down.
    expect(observed).toEqual([1, 2, 1, 0]);
    expect(store.pendingCount()).toBe(0);
  });
});

// Default-reader wiring: the viem client factory and action are mocked so
// the data path (createRpcClient -> getStorageAt, undefined word -> null)
// is asserted without any network.
const { mockCreateRpcClient, mockGetStorageAt } = vi.hoisted(() => ({
  mockCreateRpcClient: vi.fn(),
  mockGetStorageAt: vi.fn(),
}));

vi.mock('@/utils/realTimeData', () => ({ createRpcClient: mockCreateRpcClient }));
vi.mock('viem/actions', () => ({ getStorageAt: mockGetStorageAt }));

describe('default reader', () => {
  it('reads via createRpcClient + getStorageAt and coerces absent words to null', async () => {
    const dummyClient = { name: 'client' };
    mockCreateRpcClient.mockReset().mockResolvedValue(dummyClient);
    mockGetStorageAt.mockReset().mockResolvedValueOnce('0xab').mockResolvedValueOnce(undefined);

    const store = createStorageValueStore({ chainId: 7, address: ADDR });
    store.request(['0x1', '0x2']);
    await flush();

    expect(mockCreateRpcClient).toHaveBeenCalledWith(7);
    expect(mockGetStorageAt).toHaveBeenCalledWith(dummyClient, {
      address: ADDR,
      slot: '0x1',
    });
    expect(store.getState('0x1')).toEqual({ status: 'ok', value: '0xab', error: null });
    // An undefined word is a valid empty read, not an error.
    expect(store.getState('0x2')).toEqual({ status: 'ok', value: null, error: null });
  });
});

const SlotProbe = ({ slot, label }: { slot: Hex; label: string }) => {
  const state = useSlotValue(slot);
  return (
    <div data-testid={label}>
      {state.status}:{state.value ?? 'none'}:{state.error ?? 'none'}
    </div>
  );
};

const PendingProbe = () => {
  const pending = useStorageValuesPending();
  return <div data-testid="pending">{pending}</div>;
};

describe('StorageValuesProvider and hooks', () => {
  it('two components on the same slot trigger a single read', async () => {
    const reader = vi.fn<SlotReader>(async () => '0xab');
    render(
      <StorageValuesProvider chainId={1} address={ADDR} reader={reader}>
        <SlotProbe slot="0x1" label="a" />
        <SlotProbe slot="0x1" label="b" />
      </StorageValuesProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('a')).toHaveTextContent(/^ok:0xab:none$/));
    expect(screen.getByTestId('b')).toHaveTextContent(/^ok:0xab:none$/);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('useSlotValue outside a provider stays idle', () => {
    render(<SlotProbe slot="0x1" label="bare" />);
    expect(screen.getByTestId('bare')).toHaveTextContent(/^idle:none:none$/);
  });

  it('parks reads while disabled and auto-requests when enabled flips true', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const { rerender } = render(
      <StorageValuesProvider chainId={1} address={ADDR} enabled={false} reader={reader}>
        <SlotProbe slot="0x1" label="s" />
      </StorageValuesProvider>,
    );

    expect(reader).not.toHaveBeenCalled();
    expect(screen.getByTestId('s')).toHaveTextContent(/^idle:none:none$/);

    rerender(
      <StorageValuesProvider chainId={1} address={ADDR} enabled reader={reader}>
        <SlotProbe slot="0x1" label="s" />
      </StorageValuesProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('s')).toHaveTextContent(/^ok:0x1:none$/));
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('recreates the store when chainId changes', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const props = (chainId: number) => (
      <StorageValuesProvider chainId={chainId} address={ADDR} reader={reader}>
        <SlotProbe slot="0x1" label="s" />
      </StorageValuesProvider>
    );
    const { rerender } = render(props(1));

    await waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('s')).toHaveTextContent(/^ok:0x1:none$/);

    rerender(props(2));
    // New store: the fresh cache re-requests the same slot.
    await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('s')).toHaveTextContent(/^ok:0x1:none$/));
  });

  it('exposes the pending count through useStorageValuesPending', async () => {
    const { reader, calls } = createManualReader();
    render(
      <StorageValuesProvider chainId={1} address={ADDR} reader={reader}>
        <SlotProbe slot="0x1" label="s" />
        <PendingProbe />
      </StorageValuesProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('pending')).toHaveTextContent(/^1$/));
    await act(async () => {
      calls[0].resolve('0xaa');
      await flush();
    });
    expect(screen.getByTestId('pending')).toHaveTextContent(/^0$/);
    expect(screen.getByTestId('s')).toHaveTextContent(/^ok:0xaa:none$/);
  });

  it('useRefreshStorageValues forces a re-read', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x1');
    const Refresher = () => {
      const refresh = useRefreshStorageValues();
      return (
        <button type="button" onClick={() => refresh()}>
          refresh
        </button>
      );
    };
    render(
      <StorageValuesProvider chainId={1} address={ADDR} reader={reader}>
        <SlotProbe slot="0x1" label="s" />
        <Refresher />
      </StorageValuesProvider>,
    );

    await waitFor(() => expect(reader).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'refresh' }));
    await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('s')).toHaveTextContent(/^ok:0x1:none$/);
  });

  it('does not loop on stable snapshots (bounded render count)', async () => {
    const reader = vi.fn<SlotReader>(async () => '0x7');
    let renders = 0;
    const RenderCounter = () => {
      renders += 1;
      const state = useSlotValue('0x1');
      return <div data-testid="counted">{state.status}</div>;
    };
    render(
      <StorageValuesProvider chainId={1} address={ADDR} reader={reader}>
        <RenderCounter />
      </StorageValuesProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('counted')).toHaveTextContent(/^ok$/));
    // idle mount, loading transition, ok transition — a notification storm
    // from unstable snapshots would blow far past this bound.
    expect(renders).toBeLessThan(6);
  });
});
