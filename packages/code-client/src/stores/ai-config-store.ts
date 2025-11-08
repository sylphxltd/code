/**
 * AI Config Store
 * Manages AI configuration and provider settings
 *
 * Single Responsibility: AI configuration management
 * Note: Coordinates with Model Selection Store for initialization
 */

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { AIConfig, ProviderId } from '@sylphx/code-core';

export interface AIConfigState {
  aiConfig: AIConfig | null;
  setAIConfig: (config: AIConfig) => void;
  updateProvider: (provider: ProviderId, data: { apiKey?: string; defaultModel?: string }) => void;
  removeProvider: (provider: ProviderId) => void;
}

export const useAIConfigStore = create<AIConfigState>()(
  immer((set) => ({
    aiConfig: null,

    setAIConfig: (config) => {
      set((state) => {
        state.aiConfig = config;
      });

      // Coordinate with other stores for initialization
      // Import here to avoid circular dependency
      import('./model-selection-store.js').then(({ useModelSelectionStore }) => {
        const modelStore = useModelSelectionStore.getState();

        // Set selectedProvider/Model from config defaults
        if (config.defaultProvider) {
          modelStore.setSelectedProvider(config.defaultProvider);

          // Auto-select the provider's default model
          const providerConfig = config.providers?.[config.defaultProvider];
          if (providerConfig?.defaultModel) {
            modelStore.setSelectedModel(providerConfig.defaultModel);
          }
        }
      });

      // Initialize settings store with defaults (only if no session)
      Promise.all([
        import('./settings-store.js'),
        import('./session-store.js')
      ]).then(([{ useSettingsStore }, { useSessionStore }]) => {
        const settingsStore = useSettingsStore.getState();
        const sessionStore = useSessionStore.getState();

        if (!sessionStore.currentSessionId) {
          if (config.defaultEnabledRuleIds) {
            settingsStore.setEnabledRuleIds(config.defaultEnabledRuleIds);
          }
          if (config.defaultAgentId) {
            settingsStore.setSelectedAgent(config.defaultAgentId);
          }
        }
      });
    },

    updateProvider: (provider, data) =>
      set((state) => {
        if (!state.aiConfig) {
          state.aiConfig = { providers: {} };
        }
        if (!state.aiConfig.providers) {
          state.aiConfig.providers = {};
        }
        state.aiConfig.providers[provider] = {
          ...state.aiConfig.providers[provider],
          ...data,
        };
      }),

    removeProvider: (provider) =>
      set((state) => {
        if (state.aiConfig?.providers) {
          delete state.aiConfig.providers[provider];
        }
        if (state.aiConfig?.defaultProvider === provider) {
          state.aiConfig.defaultProvider = undefined;
        }
      }),
  }))
);
