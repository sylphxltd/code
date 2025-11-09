/**
 * Signal Persistence Layer
 * Handles saving and loading signal state from local storage
 */

import { get, set, subscribe } from '@sylphx/zen';
import * as ai from '../domain/ai';
import * as ui from '../domain/ui';
import * as session from '../domain/session';

interface PersistenceConfig {
  signal: any; // Zen signal
  key: string;
  serialize?: (value: any) => string;
  deserialize?: (value: string) => any;
}

const PERSISTENCE_CONFIGS: PersistenceConfig[] = [
  {
    signal: ai.$selectedProvider,
    key: 'sylphx:selected-provider'
  },
  {
    signal: ai.$selectedModel,
    key: 'sylphx:selected-model'
  },
  {
    signal: ui.$currentScreen,
    key: 'sylphx:last-screen'
  }
];

// More complex object persistence
const OBJECT_PERSISTENCE_CONFIGS: PersistenceConfig[] = [
  {
    signal: ai.$aiConfig,
    key: 'sylphx:ai-config',
    serialize: (value) => JSON.stringify(value),
    deserialize: (value) => {
      try {
        return JSON.parse(value);
      } catch {
        return null;
      }
    }
  }
];

export const initializePersistence = () => {
  // Load persisted values
  [...PERSISTENCE_CONFIGS, ...OBJECT_PERSISTENCE_CONFIGS].forEach(config => {
    try {
      const stored = localStorage.getItem(config.key);
      if (stored !== null && stored !== undefined) {
        const value = config.deserialize ? config.deserialize(stored) :
                      (typeof stored === 'string' ? stored : JSON.parse(stored));

        // Only set if current value is null/undefined (don't override initial state)
        const current = get(config.signal);
        if (current === null || current === undefined || current === '') {
          set(config.signal, value);
        }
      }
    } catch (error) {
      console.warn(`Failed to load persisted value for ${config.key}:`, error);
    }
  });

  // Save on changes (with debouncing)
  const debouncedSave = new Map<string, NodeJS.Timeout>();

  PERSISTENCE_CONFIGS.forEach(config => {
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
          console.warn(`Failed to persist value for ${config.key}:`, error);
        }
        debouncedSave.delete(config.key);
      }, 500); // 500ms debounce

      debouncedSave.set(config.key, timeout);
    });
  });

  // Save object changes immediately (no debounce)
  OBJECT_PERSISTENCE_CONFIGS.forEach(config => {
    subscribe(config.signal, (value) => {
      try {
        const serialized = config.serialize ? config.serialize(value) : JSON.stringify(value);
        localStorage.setItem(config.key, serialized);
      } catch (error) {
        console.warn(`Failed to persist object for ${config.key}:`, error);
      }
    });
  });
};

// Export functions to clear persistence
export const clearPersistence = () => {
  [...PERSISTENCE_CONFIGS, ...OBJECT_PERSISTENCE_CONFIGS].forEach(config => {
    localStorage.removeItem(config.key);
  });
};

export const clearSignalPersistence = (key: string) => {
  localStorage.removeItem(key);
};