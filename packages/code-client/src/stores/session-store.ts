/**
 * Session Store
 * Manages current session and session CRUD operations
 *
 * Single Responsibility: Session lifecycle management
 * Architecture: On-demand loading with tRPC backend
 */

import { create } from 'zustand';
import type { Session, ProviderId } from '@sylphx/code-core';
import { getTRPCClient } from '../trpc-provider.js';

export interface SessionState {
  // Current session state
  currentSessionId: string | null;
  currentSession: Session | null;

  // Session operations
  setCurrentSession: (sessionId: string | null) => Promise<void>;
  loadSession: (sessionId: string) => Promise<Session>;
  refreshCurrentSession: () => Promise<void>;

  // Session CRUD
  createSession: (provider: ProviderId, model: string) => Promise<string>;
  updateSessionModel: (sessionId: string, model: string) => Promise<void>;
  updateSessionProvider: (sessionId: string, provider: ProviderId, model: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  updateSessionRules: (sessionId: string, enabledRuleIds: string[]) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
    currentSessionId: null,
    currentSession: null,

    /**
     * Set current session ID (synchronous)
     * Session data will be loaded by React layer
     */
    setCurrentSession: async (sessionId) => {
      set({
        currentSessionId: sessionId,
        currentSession: null, // Will be loaded by useEffect
      });

      if (!sessionId) {
        // Clear enabled rules when no session
        const { useSettingsStore } = await import('./settings-store.js');
        useSettingsStore.getState().setEnabledRuleIds([]);
      }
    },

    /**
     * Load session data (called from React layer)
     */
    loadSession: async (sessionId: string) => {
      const client = getTRPCClient();
      const session = await client.session.getById.query({ sessionId });

      set({
        currentSession: session,
      });

      // Load session's enabled rules into settings store
      const { useSettingsStore } = await import('./settings-store.js');
      useSettingsStore.getState().setEnabledRuleIds(session.enabledRuleIds || []);

      return session;
    },

    /**
     * Refresh current session from database
     */
    refreshCurrentSession: async () => {
      const { currentSessionId } = get();
      if (!currentSessionId) {
        return;
      }

      const client = getTRPCClient();
      const session = await client.session.getById.query({ sessionId: currentSessionId });

      set({ currentSession: session });
    },

    /**
     * Create new session
     */
    createSession: async (provider, model) => {
      const client = getTRPCClient();

      // Get agent and rules from settings store
      const { useSettingsStore } = await import('./settings-store.js');
      const { selectedAgentId, enabledRuleIds } = useSettingsStore.getState();

      const session = await client.session.create.mutate({
        provider,
        model,
        agentId: selectedAgentId,
        enabledRuleIds,
      });

      // Set as current session
      set({
        currentSessionId: session.id,
        currentSession: session,
      });

      // Update settings store with session's rules
      useSettingsStore.getState().setEnabledRuleIds(session.enabledRuleIds || []);

      return session.id;
    },

    /**
     * Update session model
     */
    updateSessionModel: async (sessionId, model) => {
      // Optimistic update if it's the current session
      const currentSession = get().currentSession;
      if (get().currentSessionId === sessionId && currentSession) {
        set({
          currentSession: {
            ...currentSession,
            model,
          },
        });
      }

      // Sync to database via tRPC
      const client = getTRPCClient();
      await client.session.updateModel.mutate({ sessionId, model });
    },

    /**
     * Update session provider
     */
    updateSessionProvider: async (sessionId, provider, model) => {
      // Optimistic update if it's the current session
      const currentSession = get().currentSession;
      if (get().currentSessionId === sessionId && currentSession) {
        set({
          currentSession: {
            ...currentSession,
            provider,
            model,
          },
        });
      }

      // Sync to database via tRPC
      const client = getTRPCClient();
      await client.session.updateProvider.mutate({ sessionId, provider, model });
    },

    /**
     * Update session title
     */
    updateSessionTitle: async (sessionId, title) => {
      // Optimistic update if it's the current session
      const currentSession = get().currentSession;
      if (get().currentSessionId === sessionId && currentSession) {
        set({
          currentSession: {
            ...currentSession,
            title,
          },
        });
      }

      // Sync to database via tRPC
      const client = getTRPCClient();
      await client.session.updateTitle.mutate({ sessionId, title });
    },

    /**
     * Update session enabled rules
     */
    updateSessionRules: async (sessionId, enabledRuleIds) => {
      // Optimistic update if it's the current session
      const currentSession = get().currentSession;
      if (get().currentSessionId === sessionId && currentSession) {
        set({
          currentSession: {
            ...currentSession,
            enabledRuleIds,
          },
        });

        // Also update settings store for UI
        const { useSettingsStore } = await import('./settings-store.js');
        useSettingsStore.getState().setEnabledRuleIds(enabledRuleIds);
      }

      // Sync to database via tRPC
      const client = getTRPCClient();
      await client.session.updateRules.mutate({ sessionId, enabledRuleIds });
    },

    /**
     * Delete session
     */
    deleteSession: async (sessionId) => {
      // Clear if it's the current session
      if (get().currentSessionId === sessionId) {
        set({
          currentSessionId: null,
          currentSession: null,
        });
      }

      // Delete from database via tRPC
      const client = getTRPCClient();
      await client.session.delete.mutate({ sessionId });
    },
  })
);
