/**
 * Keyboard Hook
 * Handle global keyboard shortcuts
 * TODO: Migrate to zen signals
 */

import { useInput } from 'ink';

export function useKeyboard() {
  // Disabled temporarily - will migrate to zen signals
  // useInput((input, key) => {
  //   // Handle Escape key - go back to chat
  //   if (key.escape) {
  //     navigateTo('chat');
  //     return;
  //   }
  // });
}