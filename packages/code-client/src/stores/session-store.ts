/**
 * Session Store - Pure UI Client
 * Manages ONLY currentSessionId (which session is being viewed)
 *
 * Architecture: Server-driven, Pure UI Client
 * - Store ONLY stores currentSessionId (a simple string)
 * - All data fetching handled by tRPC React Query (server is source of truth)
 * - No business logic in client - just UI state
 */

import { create } from 'zustand';
import type { ProviderId } from '@sylphx/code-core';
import { getTRPCClient } from '../trpc-provider.js';

export interface SessionState {
  // UI State: Which session is currently being viewed
  currentSessionId: string | null;

  // UI Actions: Simple state setters (synchronous)
  setCurrentSessionId: (sessionId: string | null) => void;

  // Server Actions: Delegate to tRPC (return sessionId for convenience)
  createSession: (provider: ProviderId, model: string) => Promise<string>;
  updateSessionModel: (sessionId: string, model: string) => Promise<void>;
  updateSessionProvider: (sessionId: string, provider: ProviderId, model: string) => Promise<void>;
  updateSessionTitle: (sessionId: string, title: string) => Promise<void>;
  updateSessionRules: (sessionId: string, enabledRuleIds: string[]) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  currentSessionId: null,

  /**
   * Set current session ID (pure UI state)
   * Data will be fetched by React Query in components
   */
  setCurrentSessionId: (sessionId) => {
    set({ currentSessionId: sessionId });

    // Clear enabled rules when no session
    if (!sessionId) {
      import('./settings-store.js').then(({ useSettingsStore }) => {
        useSettingsStore.getState().setEnabledRuleIds([]);
      });
    }
  },

  /**
   * Create new session (server action)
   * Returns sessionId, sets it as current
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

    // Set as current session (UI state only)
    set({ currentSessionId: session.id });

    // Update settings store with session's rules
    useSettingsStore.getState().setEnabledRuleIds(session.enabledRuleIds || []);

    return session.id;
  },

  /**
   * Update session model (server action)
   * React Query will refetch and update UI automatically
   */
  updateSessionModel: async (sessionId, model) => {
    const client = getTRPCClient();
    await client.session.updateModel.mutate({ sessionId, model });
  },

  /**
   * Update session provider (server action)
   * React Query will refetch and update UI automatically
   */
  updateSessionProvider: async (sessionId, provider, model) => {
    const client = getTRPCClient();
    await client.session.updateProvider.mutate({ sessionId, provider, model });
  },

  /**
   * Update session title (server action)
   * React Query will refetch and update UI automatically
   */
  updateSessionTitle: async (sessionId, title) => {
    const client = getTRPCClient();
    await client.session.updateTitle.mutate({ sessionId, title });
  },

  /**
   * Update session enabled rules (server action)
   * React Query will refetch and update UI automatically
   */
  updateSessionRules: async (sessionId, enabledRuleIds) => {
    const client = getTRPCClient();
    await client.session.updateRules.mutate({ sessionId, enabledRuleIds });

    // Also update settings store for UI (if current session)
    if (get().currentSessionId === sessionId) {
      const { useSettingsStore } = await import('./settings-store.js');
      useSettingsStore.getState().setEnabledRuleIds(enabledRuleIds);
    }
  },

  /**
   * Delete session (server action)
   */
  deleteSession: async (sessionId) => {
    // Clear if it's the current session
    if (get().currentSessionId === sessionId) {
      set({ currentSessionId: null });
    }

    // Delete from database via tRPC
    const client = getTRPCClient();
    await client.session.delete.mutate({ sessionId });
  },
}));
