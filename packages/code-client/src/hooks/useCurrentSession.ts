/**
 * useCurrentSession Hook
 * Fetches current session data from server using tRPC
 *
 * Pure UI Client Architecture:
 * - Store only has currentSessionId (UI state)
 * - This hook fetches session data from server (source of truth)
 * - Manual caching with useEffect dependency on currentSessionId
 */

import { useEffect, useState } from 'react';
import type { Session } from '@sylphx/code-core';
import { getTRPCClient } from '../trpc-provider.js';
import { useSessionStore } from '../stores/session-store.js';

export function useCurrentSession() {
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Fetch session data when currentSessionId changes
  useEffect(() => {
    if (!currentSessionId) {
      setCurrentSession(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);

    const client = getTRPCClient();
    client.session.getById.query({ sessionId: currentSessionId })
      .then((session) => {
        setCurrentSession(session);
        setIsLoading(false);

        // Load session's enabled rules into settings store
        import('../stores/settings-store.js').then(({ useSettingsStore }) => {
          useSettingsStore.getState().setEnabledRuleIds(session.enabledRuleIds || []);
        });
      })
      .catch((err) => {
        setError(err as Error);
        setIsLoading(false);
      });
  }, [currentSessionId]);

  return {
    currentSession,
    currentSessionId,
    isLoading,
    error,
  };
}
