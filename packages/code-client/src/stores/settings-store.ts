/**
 * Settings Store
 * Manages user settings (agent, rules)
 *
 * Single Responsibility: User preference management
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getTRPCClient } from '../trpc-provider.js';
import { eventBus } from '../lib/event-bus.js';

export interface SettingsState {
  // Agent selection
  selectedAgentId: string;
  setSelectedAgent: (agentId: string) => Promise<void>;

  // Rule selection
  enabledRuleIds: string[];
  setEnabledRuleIds: (ruleIds: string[], sessionId?: string | null) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>()(
  immer((set, get) => ({
    selectedAgentId: 'coder',
    enabledRuleIds: [],

    /**
     * Set selected agent and persist to config
     */
    setSelectedAgent: async (agentId) => {
      // Update client state immediately (optimistic)
      set((state) => {
        state.selectedAgentId = agentId;
      });

      // Persist to global config (remember last selected agent)
      const { useAIConfigStore } = await import('./ai-config-store.js');
      const { aiConfig } = useAIConfigStore.getState();

      const client = getTRPCClient();
      await client.config.save.mutate({
        config: {
          ...aiConfig,
          defaultAgentId: agentId,
        },
      });

      // Update AI config store cache
      useAIConfigStore.setState((state) => {
        if (state.aiConfig) {
          state.aiConfig.defaultAgentId = agentId;
        }
      });
    },

    /**
     * Set enabled rules and persist
     * Pure UI Client: Server decides where to persist (session vs global config)
     *
     * Note: Requires sessionId as parameter
     * Caller should provide currentSessionId from session store
     */
    setEnabledRuleIds: async (ruleIds, sessionId?: string | null) => {
      // Update client state immediately (optimistic)
      set((state) => {
        state.enabledRuleIds = ruleIds;
      });

      // Call server endpoint - SERVER decides where to persist
      const client = getTRPCClient();
      await client.config.updateRules.mutate({
        ruleIds,
        sessionId: sessionId || undefined,
      });

      // Multi-client sync: Server events will propagate changes to all clients
    },
  }))
);

/**
 * Setup event listeners
 * Called on module load and can be called again in tests after eventBus.clear()
 */
export function setupSettingsStoreEventListeners() {
  eventBus.on('session:changed', ({ sessionId }) => {
    // Clear enabled rules when no session
    // Use setState directly (not setEnabledRuleIds) to avoid triggering server call
    if (!sessionId) {
      useSettingsStore.setState({ enabledRuleIds: [] });
    }
  });

  eventBus.on('session:created', ({ enabledRuleIds }) => {
    // Update settings with new session's rules
    useSettingsStore.setState({ enabledRuleIds });
  });

  eventBus.on('session:loaded', ({ enabledRuleIds }) => {
    // Update settings when session loaded from server
    useSettingsStore.setState({ enabledRuleIds });
  });

  eventBus.on('session:rulesUpdated', ({ enabledRuleIds }) => {
    // Update settings when current session's rules change
    useSettingsStore.setState({ enabledRuleIds });
  });
}

// Subscribe to session events on module load
setupSettingsStoreEventListeners();
