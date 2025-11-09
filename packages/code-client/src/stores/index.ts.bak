/**
 * Stores Index
 * Exports all focused domain stores
 *
 * Architecture: Domain-separated stores using Zustand
 * Pattern: Each store manages a single responsibility
 */

// Simple stores (no dependencies)
export { useDebugStore } from './debug-store.js';
export type { DebugState } from './debug-store.js';

export { useUIStore } from './ui-store.js';
export type { UIState } from './ui-store.js';

export { useNavigationStore } from './navigation-store.js';
export type { NavigationState, Screen } from './navigation-store.js';

export { useNotificationStore } from './notification-store.js';
export type { NotificationState, NotificationSettings } from './notification-store.js';

// Model selection (depends on AI config for initialization)
export { useModelSelectionStore } from './model-selection-store.js';
export type { ModelSelectionState } from './model-selection-store.js';

// AI configuration (coordinates with other stores)
export { useAIConfigStore } from './ai-config-store.js';
export type { AIConfigState } from './ai-config-store.js';

// Session management (core domain)
export { useSessionStore } from './session-store.js';
export type { SessionState } from './session-store.js';

// Message operations (depends on session)
export { useMessageStore } from './message-store.js';
export type { MessageState } from './message-store.js';

// Todo operations (depends on session)
export { useTodoStore } from './todo-store.js';
export type { TodoState } from './todo-store.js';

// User settings (depends on session and AI config)
export { useSettingsStore } from './settings-store.js';
export type { SettingsState } from './settings-store.js';

// Legacy compatibility wrapper (deprecated, use focused stores instead)
export { useAppStore } from './app-store.js';
export type { AppState } from './app-store.js';

// Re-export types from core
export type { Session, MessagePart } from '@sylphx/code-core';
