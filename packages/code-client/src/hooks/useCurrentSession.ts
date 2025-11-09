/**
 * useCurrentSession Hook
 * Fetches current session data from server using tRPC
 *
 * Pure Data Fetching Hook:
 * - Fetches session from server when currentSessionId changes
 * - Respects streaming state (won't overwrite optimistic data during streaming)
 * - Emits events for cross-store communication (no direct store imports)
 * - Simple, focused responsibility: fetch data and emit events
 */

import { useEffect, useState } from 'react';
import type { Session } from '@sylphx/code-core';
import { getTRPCClient } from '../trpc-provider.js';
import { useCurrentSessionId, useCurrentSession as useOptimisticSession, useIsStreaming, setCurrentSession, $isStreaming } from '../signals/domain/session/index.js';
import { eventBus } from '../lib/event-bus.js';
import { get } from '@sylphx/zen';

export function useCurrentSession() {
  const currentSessionId = useCurrentSessionId();
  const optimisticSession = useOptimisticSession();
  const isStreaming = useIsStreaming();

  const [serverSession, setServerSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch session data from server when currentSessionId changes
  useEffect(() => {
    if (!currentSessionId) {
      setServerSession(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    // Skip server fetch if we have optimistic data for a temp session
    if (currentSessionId === 'temp-session') {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const client = getTRPCClient();
    client.session.getById.query({ sessionId: currentSessionId })
      .then((session) => {
        setServerSession(session);
        setIsLoading(false);

        // Only update store and emit events if not streaming
        // During streaming, optimistic data is authoritative
        if (!get($isStreaming)) {
          // Safe to replace with server data
          setCurrentSession(session);

          // Emit event for other stores to react (e.g., settings store updates rules)
          eventBus.emit('session:loaded', {
            sessionId: session.id,
            enabledRuleIds: session.enabledRuleIds || [],
          });
        }
      })
      .catch((err) => {
        setError(err as Error);
        setIsLoading(false);
      });
  }, [currentSessionId]);

  // Return optimistic data if available (instant UI), otherwise server data
  const currentSession = optimisticSession || serverSession;

  return {
    currentSession,
    currentSessionId,
    isStreaming,
    isLoading,
    error,
  };
}
