/**
 * Session Store
 * Manages current session and session CRUD operations
 *
 * Single Responsibility: Session lifecycle management
 * Architecture: On-demand loading with tRPC backend
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { Session, ProviderId } from '@sylphx/code-core';
import { getTRPCClient } from '../trpc-provider.js';

export interface SessionState {
  // Current session state
  currentSessionId: string | null;
  currentSession: Session | null;

  // Session operations
  setCurrentSession: (sessionId: string | null) => Promise<void>;
  refreshCurrentSession: () => Promise<void>;

  // Session CRUD
  createSession: (provider: ProviderId, model: string) => Promise<string>;
  updateSessionModel: (sessionId: string, model: string) => Promise<void>;
  updateSessionProvider: (sessionId: string, provider: ProviderId, model: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  updateSessionRules: (sessionId: string, enabledRuleIds: string[]) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>()(
  immer((set, get) => ({
    currentSessionId: null,
    currentSession: null,

    /**
     * Set current session and load it from database
     */
    setCurrentSession: async (sessionId) => {
      console.log('[SessionStore] setCurrentSession called with:', sessionId);

      // First update: set sessionId, clear session
      set({
        currentSessionId: sessionId,
        currentSession: null,
      });
      console.log('[SessionStore] State updated: currentSessionId set, currentSession cleared');

      if (!sessionId) {
        console.log('[SessionStore] No sessionId, clearing rules');
        // Clear enabled rules when no session
        const { useSettingsStore } = await import('./settings-store.js');
        useSettingsStore.getState().setEnabledRuleIds([]);
        console.log('[SessionStore] Done clearing');
        return;
      }

      console.log('[SessionStore] Fetching session from tRPC...');
      // Fetch session from tRPC
      const client = getTRPCClient();
      const session = await client.session.getById.query({ sessionId });
      console.log('[SessionStore] Session fetched:', {
        id: session.id,
        title: session.title,
        messageCount: session.messages?.length || 0,
      });

      // Second update: set session
      set({
        currentSession: session,
      });
      console.log('[SessionStore] State updated: currentSession set');

      // Load session's enabled rules into settings store
      console.log('[SessionStore] Loading enabled rules...');
      const { useSettingsStore } = await import('./settings-store.js');
      useSettingsStore.getState().setEnabledRuleIds(session.enabledRuleIds || []);
      console.log('[SessionStore] setCurrentSession complete');
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

      set((state) => {
        state.currentSession = session;
      });
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
      set((state) => {
        state.currentSessionId = session.id;
        state.currentSession = session;
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
      if (get().currentSessionId === sessionId && get().currentSession) {
        set((state) => {
          if (state.currentSession) {
            state.currentSession.model = model;
          }
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
      if (get().currentSessionId === sessionId && get().currentSession) {
        set((state) => {
          if (state.currentSession) {
            state.currentSession.provider = provider;
            state.currentSession.model = model;
          }
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
      if (get().currentSessionId === sessionId && get().currentSession) {
        set((state) => {
          if (state.currentSession) {
            state.currentSession.title = title;
          }
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
      if (get().currentSessionId === sessionId && get().currentSession) {
        set((state) => {
          if (state.currentSession) {
            state.currentSession.enabledRuleIds = enabledRuleIds;
          }
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
        set((state) => {
          state.currentSessionId = null;
          state.currentSession = null;
        });
      }

      // Delete from database via tRPC
      const client = getTRPCClient();
      await client.session.delete.mutate({ sessionId });
    },
  }))
);
