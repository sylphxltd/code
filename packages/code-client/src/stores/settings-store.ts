/**
 * Settings Store
 * Manages user settings (agent, rules)
 *
 * Single Responsibility: User preference management
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getTRPCClient } from '../trpc-provider.js';

export interface SettingsState {
  // Agent selection
  selectedAgentId: string;
  setSelectedAgent: (agentId: string) => Promise<void>;

  // Rule selection
  enabledRuleIds: string[];
  setEnabledRuleIds: (ruleIds: string[]) => Promise<void>;
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
     */
    setEnabledRuleIds: async (ruleIds) => {
      // Update client state immediately (optimistic)
      set((state) => {
        state.enabledRuleIds = ruleIds;
      });

      // Get current session ID (if any)
      const { useSessionStore } = await import('./session-store.js');
      const { currentSessionId } = useSessionStore.getState();

      // Call server endpoint - SERVER decides where to persist
      const client = getTRPCClient();
      await client.config.updateRules.mutate({
        ruleIds,
        sessionId: currentSessionId || undefined,
      });

      // Multi-client sync: Server events will propagate changes to all clients
    },
  }))
);
