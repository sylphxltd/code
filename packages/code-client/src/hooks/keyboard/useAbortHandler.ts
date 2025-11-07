/**
 * Abort Handler Hook
 * Handles ESC key to abort streaming AI response
 *
 * Single Responsibility: Abort control during streaming
 */

import { useInput } from 'ink';
import type React from 'react';

export interface UseAbortHandlerOptions {
  isStreaming: boolean;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  addLog: (message: string) => void;
}

/**
 * Handles abort control during AI streaming
 * - ESC while streaming → abort current response
 * - Takes priority over other ESC actions
 */
export function useAbortHandler(options: UseAbortHandlerOptions) {
  const { isStreaming, abortControllerRef, addLog } = options;

  useInput(
    (char, key) => {
      // ESC to abort streaming AI response (takes priority over other ESC actions)
      if (key.escape && isStreaming) {
        if (abortControllerRef.current) {
          addLog('[abort] Cancelling AI response...');
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        return true; // Consumed
      }
      return false; // Not consumed, let other handlers process
    },
    { isActive: true }
  );
}
