/**
 * Signal Initialization
 * Initialize zen signals before React app starts
 */

import { initializePersistence } from '@sylphx/code-client/signals';

// Initialize signal persistence and effects
export const initializeSignals = () => {
  console.log('🔄 Initializing zen signals...');

  // Initialize persistence layer first
  initializePersistence();

  // Initialize effects and event listeners
  // initializeEffects(); // Will be called later when hooks are ready

  console.log('✅ Zen signals initialized');
};