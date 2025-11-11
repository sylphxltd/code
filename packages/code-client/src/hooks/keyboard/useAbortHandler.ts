/**
 * Abort Handler Hook
 * Handles ESC key to abort streaming AI response and compact operations
 *
 * Single Responsibility: Abort control during streaming and compacting
 */

import { useInput } from 'ink';
import type React from 'react';
import { get } from '@sylphx/zen';
import { $isCompacting, abortCompact } from '../../signals/domain/ui/index.js';

export interface UseAbortHandlerOptions {
  isStreaming: boolean;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  addLog: (message: string) => void;
}

/**
 * Handles abort control during AI streaming and compact operations
 * - ESC while compacting → abort compact operation (highest priority)
 * - ESC while streaming → abort current AI response
 * - Takes priority over other ESC actions
 */
export function useAbortHandler(options: UseAbortHandlerOptions) {
  const { isStreaming, abortControllerRef, addLog } = options;

  console.log('[AbortDebug] useAbortHandler called, isStreaming:', isStreaming);

  useInput(
    (char, key) => {
      if (!key.escape) {
        return false;
      }

      console.log('[AbortDebug] ESC key pressed in useAbortHandler');
      console.log('[AbortDebug] isStreaming:', isStreaming);
      console.log('[AbortDebug] abortControllerRef.current:', !!abortControllerRef.current);

      // Check if compacting (highest priority)
      const isCompacting = get($isCompacting);
      if (isCompacting) {
        addLog('[abort] Cancelling session compaction...');
        abortCompact();
        return true; // Consumed
      }

      // ESC to abort streaming AI response
      if (isStreaming) {
        if (abortControllerRef.current) {
          console.log('[AbortDebug] Calling abortControllerRef.current.abort()');
          addLog('[abort] Cancelling AI response...');
          abortControllerRef.current.abort();
          console.log('[AbortDebug] abort() called, setting ref to null');
          abortControllerRef.current = null;
        }
        return true; // Consumed
      }

      console.log('[AbortDebug] ESC not consumed (not streaming)');
      return false; // Not consumed, let other handlers process
    },
    { isActive: true }
  );
}
