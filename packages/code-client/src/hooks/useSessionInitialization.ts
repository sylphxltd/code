/**
 * Session Initialization Hook
 * Creates a new session on mount if none exists
 *
 * DESIGN: Falls back to provider-specific default-model when top-level defaultModel is missing
 * This handles configs where only defaultProvider is set (common after initial setup)
 */

import { useEffect, useState } from 'react';
import type { AIConfig } from '@sylphx/code-core';
import { useTRPCClient } from '../trpc-provider.js';

interface UseSessionInitializationProps {
  currentSessionId: string | null;
  aiConfig: AIConfig | null;
  createSession: (provider: string, model: string) => Promise<string>;
}

export function useSessionInitialization({
  currentSessionId,
  aiConfig,
  createSession,
}: UseSessionInitializationProps) {
  const trpc = useTRPCClient();
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (initialized || currentSessionId || !aiConfig?.defaultProvider) {
      return;
    }

    async function initializeSession() {
      if (!aiConfig?.defaultProvider) return;

      // IMPORTANT: Always fetch models to populate provider capabilities cache
      // This ensures image generation and other capabilities are detected correctly
      let model: string | undefined;
      try {
        const result = await trpc.config.fetchModels.query({
          providerId: aiConfig.defaultProvider,
        });
        if (result.success && result.models.length > 0) {
          // Use configured default model if available, otherwise use first from API
          const providerConfig = aiConfig.providers?.[aiConfig.defaultProvider];
          const configuredModel = providerConfig?.defaultModel as string | undefined;
          model = configuredModel || result.models[0].id;
        }
      } catch (err) {
        console.error('Failed to fetch models:', err);
        // Fallback to configured model if fetch fails
        const providerConfig = aiConfig.providers?.[aiConfig.defaultProvider];
        model = providerConfig?.defaultModel as string | undefined;
      }

      if (model) {
        // Always create a new session on app start
        // Old sessions are loaded and available in the store but not auto-selected
        await createSession(aiConfig.defaultProvider, model);
        setInitialized(true);
      }
    }

    initializeSession();
  }, [initialized, currentSessionId, aiConfig, createSession, trpc]);
}
