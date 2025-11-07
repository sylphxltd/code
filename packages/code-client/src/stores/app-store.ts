/**
 * App Store (Legacy Compatibility Wrapper)
 *
 * ⚠️ DEPRECATED: This is a compatibility wrapper for the old monolithic store.
 * New code should use focused stores from './stores/index.js' instead:
 *
 * - useNavigationStore() - Screen navigation
 * - useAIConfigStore() - AI configuration
 * - useModelSelectionStore() - Model selection
 * - useSessionStore() - Session management
 * - useMessageStore() - Message operations
 * - useTodoStore() - Todo operations
 * - useUIStore() - Loading/error state
 * - useSettingsStore() - Agent/rules settings
 * - useDebugStore() - Debug logs
 * - useNotificationStore() - Notification settings
 *
 * This wrapper exists for backward compatibility during migration.
 * Components will be gradually migrated to use focused stores.
 */

import type { NavigationState } from './navigation-store.js';
import type { AIConfigState } from './ai-config-store.js';
import type { ModelSelectionState } from './model-selection-store.js';
import type { SessionState } from './session-store.js';
import type { MessageState } from './message-store.js';
import type { TodoState } from './todo-store.js';
import type { UIState } from './ui-store.js';
import type { SettingsState } from './settings-store.js';
import type { DebugState } from './debug-store.js';
import type { NotificationState } from './notification-store.js';

// Import focused stores
import { useNavigationStore } from './navigation-store.js';
import { useAIConfigStore } from './ai-config-store.js';
import { useModelSelectionStore } from './model-selection-store.js';
import { useSessionStore } from './session-store.js';
import { useMessageStore } from './message-store.js';
import { useTodoStore } from './todo-store.js';
import { useUIStore } from './ui-store.js';
import { useSettingsStore } from './settings-store.js';
import { useDebugStore } from './debug-store.js';
import { useNotificationStore } from './notification-store.js';

// Re-export types
export type { Session, MessagePart } from '@sylphx/code-core';
export type { Screen } from './navigation-store.js';

/**
 * Combined AppState type (for backward compatibility)
 * This combines all focused store interfaces
 */
export type AppState =
  & NavigationState
  & AIConfigState
  & ModelSelectionState
  & SessionState
  & MessageState
  & TodoState
  & UIState
  & SettingsState
  & DebugState
  & NotificationState;

/**
 * Legacy useAppStore hook
 *
 * @deprecated Use focused stores instead (useNavigationStore, useSessionStore, etc.)
 *
 * This hook provides a compatibility layer by combining all focused stores.
 * Selector functions work across all stores, allowing gradual migration.
 *
 * Example migration:
 * ```typescript
 * // Old (deprecated):
 * const currentScreen = useAppStore(state => state.currentScreen);
 *
 * // New (preferred):
 * const currentScreen = useNavigationStore(state => state.currentScreen);
 * ```
 */
export function useAppStore<T>(selector: (state: AppState) => T): T {
  // Combine all store states
  const navigationState = useNavigationStore();
  const aiConfigState = useAIConfigStore();
  const modelSelectionState = useModelSelectionStore();
  const sessionState = useSessionStore();
  const messageState = useMessageStore();
  const todoState = useTodoStore();
  const uiState = useUIStore();
  const settingsState = useSettingsStore();
  const debugState = useDebugStore();
  const notificationState = useNotificationStore();

  const combinedState: AppState = {
    ...navigationState,
    ...aiConfigState,
    ...modelSelectionState,
    ...sessionState,
    ...messageState,
    ...todoState,
    ...uiState,
    ...settingsState,
    ...debugState,
    ...notificationState,
  };

  return selector(combinedState);
}

/**
 * Backward compatibility: getState() method for non-React contexts
 * Combines all focused stores' states into a single object
 */
useAppStore.getState = (): AppState => {
  return {
    ...useNavigationStore.getState(),
    ...useAIConfigStore.getState(),
    ...useModelSelectionStore.getState(),
    ...useSessionStore.getState(),
    ...useMessageStore.getState(),
    ...useTodoStore.getState(),
    ...useUIStore.getState(),
    ...useSettingsStore.getState(),
    ...useDebugStore.getState(),
    ...useNotificationStore.getState(),
  };
};

/**
 * Backward compatibility: setState() method for non-React contexts
 * Applies updates to all focused stores
 *
 * IMPORTANT: This is a compatibility shim. The updater function receives
 * the combined state from all stores, but only stores that actually have
 * the properties being modified will be updated.
 */
useAppStore.setState = (
  partial: AppState | Partial<AppState> | ((state: AppState) => void)
): void => {
  // Get current combined state
  const currentState = useAppStore.getState();

  // If partial is a function, execute it with current state (immer pattern)
  if (typeof partial === 'function') {
    // For immer-based updates, we need to apply the function to each store
    // Most updates affect the session store, so we prioritize that
    const stores = [
      useSessionStore,
      useMessageStore,
      useTodoStore,
      useNavigationStore,
      useAIConfigStore,
      useModelSelectionStore,
      useUIStore,
      useSettingsStore,
      useDebugStore,
      useNotificationStore,
    ];

    // Apply the update function to all stores
    // Each store's setState will handle the update if it affects that store's slice
    for (const store of stores) {
      try {
        store.setState(partial as any);
      } catch (error) {
        // Ignore errors - store might not have the properties being updated
      }
    }
  } else {
    // For object updates, update each focused store with its slice
    const updates = partial as Partial<AppState>;

    // Update each store with only its relevant properties
    if ('currentScreen' in updates || 'previousScreen' in updates) {
      useNavigationStore.setState(updates as any);
    }
    if ('aiConfig' in updates) {
      useAIConfigStore.setState(updates as any);
    }
    if ('selectedProvider' in updates || 'selectedModel' in updates) {
      useModelSelectionStore.setState(updates as any);
    }
    if ('currentSession' in updates || 'currentSessionId' in updates) {
      useSessionStore.setState(updates as any);
    }
    if ('isLoading' in updates || 'error' in updates) {
      useUIStore.setState(updates as any);
    }
    if ('selectedAgentId' in updates || 'enabledRuleIds' in updates) {
      useSettingsStore.setState(updates as any);
    }
    if ('logs' in updates) {
      useDebugStore.setState(updates as any);
    }
    if ('notificationSettings' in updates) {
      useNotificationStore.setState(updates as any);
    }
  }
};

// Export focused stores for direct access
useAppStore.navigation = useNavigationStore;
useAppStore.aiConfig = useAIConfigStore;
useAppStore.modelSelection = useModelSelectionStore;
useAppStore.session = useSessionStore;
useAppStore.message = useMessageStore;
useAppStore.todo = useTodoStore;
useAppStore.ui = useUIStore;
useAppStore.settings = useSettingsStore;
useAppStore.debug = useDebugStore;
useAppStore.notification = useNotificationStore;
