/**
 * UI Domain Signals
 * Manages UI state across the application
 */

import { zen, get, set, computed } from '@sylphx/zen';
import { useStore } from '@sylphx/zen-react';

export type Screen = 'chat' | 'settings' | 'provider' | 'help';

// Core UI signals
export const $currentScreen = zen<Screen>('chat');
export const $previousScreen = zen<Screen | null>(null);
export const $isLoading = zen(false);
export const $error = zen<string | null>(null);
export const $debugLogs = zen<string[]>([]);

// Compacting state (for /compact command)
export const $isCompacting = zen(false);
export const $compactAbortController = zen<AbortController | null>(null);

// Computed signals
export const $canGoBack = computed(
  [$currentScreen, $previousScreen],
  (current, previous) => current !== 'chat' && previous !== null
);

export const $showNavigation = computed(
  [$currentScreen],
  (screen) => ['chat', 'settings'].includes(screen)
);

// Actions
export const navigateTo = (screen: Screen) => {
  const current = get($currentScreen);
  set($previousScreen, current);
  set($currentScreen, screen);
};

export const goBack = () => {
  const previous = get($previousScreen);
  if (previous) {
    navigateTo(previous);
  }
};

export const setLoading = (loading: boolean) => set($isLoading, loading);
export const setError = (error: string | null) => set($error, error);

export const setCompacting = (compacting: boolean) => {
  set($isCompacting, compacting);
  if (!compacting) {
    // Clear abort controller when done
    set($compactAbortController, null);
  }
};

export const setCompactAbortController = (controller: AbortController | null) => {
  set($compactAbortController, controller);
};

export const abortCompact = () => {
  const controller = get($compactAbortController);
  if (controller) {
    controller.abort();
    setCompacting(false);
  }
};

export const addDebugLog = (message: string) => {
  if (!process.env.DEBUG) {
    return;
  }

  const timestamp = new Date().toLocaleTimeString();
  const logs = get($debugLogs) || [];
  const newLogs = [...logs, `[${timestamp}] ${message}`];

  // Keep only last 500 logs
  const MAX_LOGS = 1000;
  if (newLogs.length > MAX_LOGS) {
    newLogs.splice(0, newLogs.length - MAX_LOGS / 2);
  }

  set($debugLogs, newLogs);
};

export const clearDebugLogs = () => set($debugLogs, []);

// Hooks for React components
export const useCurrentScreen = () => useStore($currentScreen);
export const useCanGoBack = () => useStore($canGoBack);
export const useIsLoading = () => useStore($isLoading);
export const useUIError = () => useStore($error);
export const useShowNavigation = () => useStore($showNavigation);
export const useDebugLogs = () => useStore($debugLogs);
export const useIsCompacting = () => useStore($isCompacting);