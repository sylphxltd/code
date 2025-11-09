/**
 * Zen Signals Public API
 * Main entry point for all signal functionality
 */

// Domain signals
export * from './domain/ui';
export * from './domain/ai';
export * from './domain/session';
export * from './domain/settings';

// Cross-domain computed signals
export * from './computed';

// Event system
export * from './events';

// Effects and side effects
export * from './effects';

// Persistence: DISABLED - Client should not persist any state
// All state comes from server via tRPC
// export * from './persistence';

// Convenience re-exports from zen
import { zen, computed, subscribe, get, set } from '@sylphx/zen';
export { zen, computed, subscribe, get, set };

// Note: useStore is exported by individual domain modules that need it