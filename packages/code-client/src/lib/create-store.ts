/**
 * Create Store Utility
 * Provides a zustand-like API using zen underneath
 *
 * This utility allows stores to maintain the same API surface
 * while using zen's high-performance internals.
 */

import { zen, get, set as zenSet, type Zen } from '@sylphx/zen';
import { useStore as useZenStore } from '@sylphx/zen-react';
import { produce } from '@sylphx/craft';

type SetStateAction<T> = T | Partial<T> | ((state: T) => void | Partial<T>);

/**
 * Store creator function signature (zustand-compatible)
 */
export type StateCreator<T> = (
  set: (action: SetStateAction<T>) => void,
  get: () => T
) => T;

/**
 * Store instance with zustand-like API
 */
export interface Store<T> {
  (): T; // Hook for React components (no selector)
  <U>(selector: (state: T) => U): U; // Hook with selector
  getState: () => T;
  setState: (action: SetStateAction<T>) => void;
  subscribe: (listener: (state: T) => void) => () => void;
  destroy: () => void;
}

/**
 * Create a store with zustand-like API powered by zen
 *
 * @example
 * ```typescript
 * const useCountStore = createStore<CountState>((set, get) => ({
 *   count: 0,
 *   increment: () => set(state => { state.count++ }),
 *   decrement: () => set(state => { state.count-- }),
 * }));
 *
 * // In components:
 * const count = useCountStore(state => state.count); // With selector
 * const { count, increment } = useCountStore(); // Without selector
 * ```
 */
export function createStore<T extends object>(
  creator: StateCreator<T>
): Store<T> {
  // Declare store reference (will be assigned after initialization)
  let store: Zen<T>;

  // Define setState implementation (uses store reference)
  const setState = (action: SetStateAction<T>): void => {
    if (typeof action === 'function') {
      // Function update - use produce for immer-style draft pattern
      const current = get(store);
      const nextState = produce(current, action as (draft: T) => void);
      zenSet(store, nextState);
    } else {
      // Object update - merge with current state
      const current = get(store);
      const updates = action as Partial<T>;
      zenSet(store, { ...current, ...updates });
    }
  };

  // Define getState implementation
  const getState = (): T => get(store);

  // Call creator to get initial state
  // Creator defines methods that reference setState/getState
  const initialState = creator(setState, getState);

  // Create zen store with full initial state
  store = zen(initialState);

  // Create React hook with optional selector support
  function useStore(): T;
  function useStore<U>(selector: (state: T) => U): U;
  function useStore<U>(selector?: (state: T) => U): T | U {
    const state = useZenStore(store);
    if (selector) {
      return selector(state);
    }
    return state;
  }

  // Add zustand-compatible methods
  useStore.getState = getState;
  useStore.setState = setState;
  useStore.subscribe = (listener: (state: T) => void) => {
    // Zen's subscribe API
    return (store as any).listen(listener);
  };
  useStore.destroy = () => {
    // Cleanup if needed
  };

  return useStore as Store<T>;
}
