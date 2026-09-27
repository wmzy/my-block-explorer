import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { toHex, type Address, type Hex } from 'viem';
import { getStorageAt } from 'viem/actions';
import { createRpcClient } from '@/utils/realTimeData';

export type SlotValueState = {
  status: 'idle' | 'loading' | 'ok' | 'error';
  value: Hex | null;
  error: string | null;
};

// Injectable slot read; a resolved null is a VALID read (empty word),
// never an error.
export type SlotReader = (slot: Hex) => Promise<Hex | null>;

export type StorageValueStore = {
  getState(slot: Hex): SlotValueState;
  subscribe(slot: Hex, listener: () => void): () => void;
  request(slots: Hex[]): void;
  refresh(slots?: Hex[]): void;
  readMany(slots: Hex[]): Promise<Array<Hex | null>>;
  setEnabled(enabled: boolean): void;
  pendingCount(): number;
  // Additive (not in the pinned minimal surface): useStorageValuesPending
  // needs a notification channel for the pending count.
  subscribePending(listener: () => void): () => void;
  dispose(): void;
};

const IDLE: SlotValueState = { status: 'idle', value: null, error: null };

const DEFAULT_CONCURRENCY = 6;

// Canonical dedupe key for a slot: minimal-form hex ('0x03' and '0x3'
// address the same storage word, keccak-derived slots differ only in
// case). Falls back to plain lowercasing for shapes BigInt cannot parse.
const normalizeSlotKey = (slot: Hex): string => {
  try {
    return toHex(BigInt(slot));
  } catch {
    return slot.toLowerCase();
  }
};

const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// eth_getStorageAt is ephemeral chain state: read browser-side through the
// cached viem PublicClient, never through the backend HTTP API.
const createDefaultReader = (chainId: number, address: string): SlotReader => {
  const target = address as Address;
  return async slot => {
    const client = await createRpcClient(chainId);
    // viem resolves absent words to undefined; null is our "empty word".
    return (await getStorageAt(client, { address: target, slot })) ?? null;
  };
};

type SlotEntry = {
  state: SlotValueState;
  listeners: Set<() => void>;
};

// A queued unit of work. `cancel` settles readMany waiters that would
// otherwise hang forever when dispose() drops the queue.
type QueueItem = { run: () => Promise<void>; cancel: () => void };

export function createStorageValueStore(opts: {
  chainId: number;
  address: string;
  reader?: SlotReader;
  concurrency?: number;
}): StorageValueStore {
  const reader = opts.reader ?? createDefaultReader(opts.chainId, opts.address);
  const maxConcurrent = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  const entries = new Map<string, SlotEntry>();
  const pendingListeners = new Set<() => void>();
  const queue: QueueItem[] = [];
  let active = 0;
  let enabled = true;
  let disposed = false;
  let lastPendingCount = 0;

  const createEntry = (key: string): SlotEntry => {
    const entry: SlotEntry = { state: IDLE, listeners: new Set() };
    entries.set(key, entry);
    return entry;
  };

  const loadingCount = (): number => {
    let count = 0;
    for (const entry of entries.values()) {
      if (entry.state.status === 'loading') count += 1;
    }
    return count;
  };

  // Replace a slot's state object ONLY on a real status/value/error
  // transition. Snapshot identity must be stable between notifications or
  // useSyncExternalStore consumers re-render forever.
  const applyState = (key: string, next: SlotValueState): void => {
    const entry = entries.get(key);
    if (!entry) return;
    const prev = entry.state;
    if (prev.status === next.status && prev.value === next.value && prev.error === next.error) {
      return;
    }
    entry.state = next;
    for (const listener of entry.listeners) listener();
    const count = loadingCount();
    if (count !== lastPendingCount) {
      lastPendingCount = count;
      for (const listener of pendingListeners) listener();
    }
  };

  const onTaskSettled = (): void => {
    active -= 1;
    pump();
  };

  const pump = (): void => {
    while (!disposed && active < maxConcurrent && queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      active += 1;
      void item.run().finally(onTaskSettled);
    }
  };

  const runRead = async (key: string): Promise<void> => {
    try {
      const value = await reader(key as Hex);
      if (disposed) return;
      applyState(key, { status: 'ok', value, error: null });
    } catch (err) {
      if (disposed) return;
      applyState(key, { status: 'error', value: null, error: errorMessage(err) });
    }
  };

  const enqueueRead = (key: string): void => {
    const entry = entries.get(key);
    if (!entry) return;
    applyState(key, { status: 'loading', value: entry.state.value, error: null });
    queue.push({ run: () => runRead(key), cancel: () => {} });
    pump();
  };

  const request = (slots: Hex[]): void => {
    if (disposed || !enabled) return;
    for (const slot of slots) {
      const key = normalizeSlotKey(slot);
      const entry = entries.get(key) ?? createEntry(key);
      // Already satisfied or in flight: share the pending read.
      if (entry.state.status === 'ok' || entry.state.status === 'loading') continue;
      enqueueRead(key);
    }
  };

  const refresh = (slots?: Hex[]): void => {
    if (disposed || !enabled) return;
    const keys = slots ? slots.map(normalizeSlotKey) : [...entries.keys()];
    for (const key of keys) {
      const entry = entries.get(key) ?? (slots ? createEntry(key) : null);
      if (!entry) continue;
      // Force re-read (wakes 'ok' and 'error' alike), but never stack a
      // second read behind one already pending for the same slot.
      if (entry.state.status === 'loading') continue;
      enqueueRead(key);
    }
  };

  const readMany = (slots: Hex[]): Promise<Array<Hex | null>> => {
    if (disposed) return Promise.resolve(slots.map(() => null));
    const promises = slots.map(
      slot =>
        new Promise<Hex | null>(resolve => {
          queue.push({
            run: async () => {
              if (disposed) {
                resolve(null);
                return;
              }
              try {
                const value = await reader(normalizeSlotKey(slot) as Hex);
                resolve(disposed ? null : value);
              } catch {
                // readMany never rejects: a failed slot reads as null.
                resolve(null);
              }
            },
            cancel: () => resolve(null),
          });
        }),
    );
    pump();
    return Promise.all(promises);
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const item of queue) item.cancel();
    queue.length = 0;
    entries.clear();
    pendingListeners.clear();
  };

  return {
    getState: slot => entries.get(normalizeSlotKey(slot))?.state ?? IDLE,
    subscribe(slot, listener) {
      const key = normalizeSlotKey(slot);
      const entry = entries.get(key) ?? createEntry(key);
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    request,
    refresh,
    readMany,
    setEnabled(next) {
      enabled = next;
    },
    pendingCount: () => (disposed ? 0 : loadingCount()),
    subscribePending(listener) {
      pendingListeners.add(listener);
      return () => {
        pendingListeners.delete(listener);
      };
    },
    dispose,
  };
}

type StorageValuesContextValue = {
  store: StorageValueStore;
  enabled: boolean;
};

const StorageValuesContext = createContext<StorageValuesContextValue | null>(null);

const noop = (): void => {};

export function StorageValuesProvider(props: {
  chainId: number;
  address: string;
  enabled?: boolean;
  reader?: SlotReader;
  children: ReactNode;
}): React.ReactElement {
  const { chainId, address, enabled = true, reader, children } = props;
  // One store per (chainId, address, reader); the dispose effect below
  // tears the previous store down whenever this memo produces a new one.
  const store = useMemo(
    () => createStorageValueStore({ chainId, address, reader }),
    [chainId, address, reader],
  );

  // Layout effect on purpose: child passive effects (auto request()) run
  // before a parent's useEffect, so the enabled gate must be applied
  // earlier than that.
  useLayoutEffect(() => {
    store.setEnabled(enabled);
  }, [store, enabled]);

  useEffect(() => () => store.dispose(), [store]);

  const contextValue = useMemo(() => ({ store, enabled }), [store, enabled]);

  return createElement(StorageValuesContext.Provider, { value: contextValue }, children);
}

export function useSlotValue(slot: Hex): SlotValueState {
  const ctx = useContext(StorageValuesContext);
  const store = ctx?.store ?? null;
  const enabled = ctx?.enabled ?? false;

  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(slot, listener) : noop),
    [store, slot],
  );
  const getSnapshot = useCallback(() => (store ? store.getState(slot) : IDLE), [store, slot]);
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  // Auto-request on mount and whenever the store or slot changes or the
  // enabled flag flips true; request() itself dedupes against in-flight
  // and already-ok reads.
  useEffect(() => {
    if (!store || !enabled) return;
    store.request([slot]);
  }, [store, enabled, slot]);

  return state;
}

export function useRefreshStorageValues(): (slots?: Hex[]) => void {
  const store = useContext(StorageValuesContext)?.store ?? null;
  return useCallback((slots?: Hex[]) => store?.refresh(slots), [store]);
}

export function useStorageValuesPending(): number {
  const store = useContext(StorageValuesContext)?.store ?? null;
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribePending(listener) : noop),
    [store],
  );
  const getSnapshot = useCallback(() => (store ? store.pendingCount() : 0), [store]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
