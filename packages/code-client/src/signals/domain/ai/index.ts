/**
 * AI Domain Signals
 * Manages AI configuration and provider state
 */

import type { AIConfig, LanguageModel } from '@sylphx/code-core';
import { zen, get, set, computed } from '@sylphx/zen';
import { useStore } from '@sylphx/zen-react';

// Core AI signals
export const $aiConfig = zen<AIConfig | null>(null);
export const $isConfigLoading = zen(false);
export const $configError = zen<string | null>(null);
export const $selectedProvider = zen<string | null>(null);
export const $selectedModel = zen<string | null>(null);

// Computed signals
export const $hasConfig = computed([$aiConfig], config => config !== null);
export const $defaultProvider = computed([$aiConfig], config => config?.defaultProvider || null);
export const $availableProviders = computed(
  [$aiConfig],
  config => Object.keys(config?.providers || {})
);

export const $providerModels = computed(
  [$aiConfig, $selectedProvider],
  (config, providerId) => {
    if (!config || !providerId) return [];
    return config.providers?.[providerId]?.models || [];
  }
);

export const $selectedModelConfig = computed(
  [$aiConfig, $selectedProvider, $selectedModel],
  (config, providerId, modelId) => {
    if (!config || !providerId || !modelId) return null;
    return config.providers?.[providerId]?.models?.find(m => m.id === modelId) || null;
  }
);

// Actions
export const setAIConfig = (config: AIConfig | null) => {
  set($aiConfig, config);

  // Update selected provider and model when config loads
  if (config) {
    if (config.defaultProvider) {
      set($selectedProvider, config.defaultProvider);
    }

    // Set selected model from default provider
    if (config.defaultProvider && config.providers?.[config.defaultProvider]) {
      const providerConfig = config.providers[config.defaultProvider];
      if (providerConfig.defaultModel) {
        set($selectedModel, providerConfig.defaultModel);
      }
    }
  }
};

export const updateProvider = (providerId: string, data: any) => {
  const config = get($aiConfig);
  if (!config) return;

  set($aiConfig, {
    ...config,
    providers: {
      ...config.providers,
      [providerId]: {
        ...config.providers?.[providerId],
        ...data
      }
    }
  });
};

export const removeProvider = (providerId: string) => {
  const config = get($aiConfig);
  if (!config) return;

  const providers = { ...config.providers };
  delete providers[providerId];

  set($aiConfig, {
    ...config,
    providers,
    defaultProvider: config.defaultProvider === providerId ? undefined : config.defaultProvider
  });
};

export const setSelectedProvider = (providerId: string | null) => {
  set($selectedProvider, providerId);
  // Reset selected model when provider changes
  set($selectedModel, null);
};

export const setSelectedModel = (modelId: string | null) => {
  set($selectedModel, modelId);
};

export const setConfigLoading = (loading: boolean) => set($isConfigLoading, loading);
export const setConfigError = (error: string | null) => set($configError, error);

// Hooks for React components
export const useAIConfig = () => useStore($aiConfig);
export const useHasAIConfig = () => useStore($hasConfig);
export const useSelectedProvider = () => useStore($selectedProvider);
export const useSelectedModel = () => useStore($selectedModel);
export const useAvailableProviders = () => useStore($availableProviders);
export const useProviderModels = () => useStore($providerModels);
export const useSelectedModelConfig = () => useStore($selectedModelConfig);
export const useIsConfigLoading = () => useStore($isConfigLoading);