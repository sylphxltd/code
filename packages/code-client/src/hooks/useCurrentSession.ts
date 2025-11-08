/**
 * useCurrentSession Hook
 * Fetches current session data from server using tRPC
 *
 * Hybrid Architecture:
 * - Store has currentSessionId (UI state) and currentSession (optimistic state)
 * - Prioritizes optimistic store data for instant UI updates
 * - Falls back to server fetch when optimistic data unavailable
 * - Server data replaces optimistic data after fetch
 */

import { useEffect, useState } from 'react';
import type { Session } from '@sylphx/code-core';
import { getTRPCClient } from '../trpc-provider.js';
import { useSessionStore } from '../stores/session-store.js';

export function useCurrentSession() {
  const currentSessionId = useSessionStore((state) => state?.currentSessionId ?? null);
  const optimisticSession = useSessionStore((state) => state?.currentSession ?? null);
  const setCurrentSession = useSessionStore((state) => state?.setCurrentSession);

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

        // Replace optimistic data with server data
        // IMPORTANT: Don't include setCurrentSession in dependencies to avoid infinite loop
        const store = useSessionStore.getState();
        if (store.setCurrentSession) {
          store.setCurrentSession(session);
        }

        // Load session's enabled rules into settings store
        import('../stores/settings-store.js').then(({ useSettingsStore }) => {
          useSettingsStore.getState().setEnabledRuleIds(session.enabledRuleIds || []);
        });
      })
      .catch((err) => {
        setError(err as Error);
        setIsLoading(false);
      });
  }, [currentSessionId]);  // ONLY depend on currentSessionId to prevent infinite loop

  // Return optimistic data if available (instant UI), otherwise server data
  const currentSession = optimisticSession || serverSession;

  return {
    currentSession,
    currentSessionId,
    isLoading,
    error,
  };
}
