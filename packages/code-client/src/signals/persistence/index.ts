/**
 * UI State Persistence Layer
 * Handles saving UI state ONLY (no configuration or business logic)
 *
 * ARCHITECTURAL NOTE:
 * - Client should NOT read configuration files
 * - All AI config comes from server via tRPC
 * - This only persists UI state like current screen, etc.
 */

import { get, set, subscribe } from '@sylphx/zen';
import * as ui from '../domain/ui';

interface UIPersistenceConfig {
  signal: any; // Zen signal
  key: string;
  serialize?: (value: any) => string;
  deserialize?: (value: string) => any;
}

// ONLY UI state persistence - NO configuration
const UI_PERSISTENCE_CONFIGS: UIPersistenceConfig[] = [
  {
    signal: ui.$currentScreen,
    key: 'sylphx:ui:last-screen'
  }
  // NOTE: AI configuration is NOT persisted here - it comes from server via tRPC
];

export const initializeUIPersistence = () => {
  // Use browser localStorage only
  if (typeof localStorage === 'undefined') {
    return;
  }

  // Load persisted UI values
  UI_PERSISTENCE_CONFIGS.forEach(config => {
    try {
      const stored = localStorage.getItem(config.key);
      if (stored !== null && stored !== undefined) {
        const value = config.deserialize ? config.deserialize(stored) : stored;

        // Only set if current value is null/undefined (don't override initial state)
        const current = get(config.signal);
        if (current === null || current === undefined) {
          set(config.signal, value);
        }
      }
    } catch (error) {
      // Silent fail for UI persistence
    }
  });

  // Save UI changes (with debouncing)
  const debouncedSave = new Map<string, NodeJS.Timeout>();

  UI_PERSISTENCE_CONFIGS.forEach(config => {
    subscribe(config.signal, (value) => {
      // Clear existing timeout
      const existingTimeout = debouncedSave.get(config.key);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      // Debounce save
      const timeout = setTimeout(() => {
        try {
          const serialized = config.serialize ? config.serialize(value) : String(value);
          localStorage.setItem(config.key, serialized);
        } catch (error) {
          // Silent fail for UI persistence
        }
        debouncedSave.delete(config.key);
      }, 500); // 500ms debounce

      debouncedSave.set(config.key, timeout);
    });
  });
};

// Export functions to clear UI persistence
export const clearUIPersistence = () => {
  UI_PERSISTENCE_CONFIGS.forEach(config => {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(config.key);
    }
  });
};

export const clearUIStatePersistence = (key: string) => {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(key);
  }
};

// Backward compatibility - deprecated
export const initializePersistence = initializeUIPersistence;
export const clearPersistence = clearUIPersistence;
export const clearSignalPersistence = clearUIStatePersistence;