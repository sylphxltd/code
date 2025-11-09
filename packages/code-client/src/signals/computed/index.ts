/**
 * Cross-Domain Computed Signals
 * Combines signals from different domains for derived state
 */

import { computed } from '@sylphx/zen';
import { useStore } from '@sylphx/zen-react';
import * as ui from '../domain/ui';
import * as ai from '../domain/ai';
import * as session from '../domain/session';

// App readiness computed signal
export const $isAppReady = computed(
  [ai.$hasConfig, session.$hasCurrentSession],
  (hasConfig, hasSession) => hasConfig && hasSession
);

// Chat availability computed signal
export const $canStartChat = computed(
  [ai.$hasConfig, session.$currentSessionId, ui.$currentScreen],
  (hasConfig, sessionId, currentScreen) => {
    return hasConfig && sessionId && currentScreen === 'chat';
  }
);

// Active provider configuration
export const $activeProviderConfig = computed(
  [ai.$aiConfig, ai.$selectedProvider],
  (config, providerId) => {
    if (!config || !providerId) return null;
    return config.providers?.[providerId] || null;
  }
);

// Current model configuration
export const $currentModelConfig = computed(
  [ai.$aiConfig, ai.$selectedProvider, ai.$selectedModel],
  (config, providerId, modelId) => {
    if (!config || !providerId || !modelId) return null;
    return config.providers?.[providerId]?.models?.find(m => m.id === modelId) || null;
  }
);

// Session context for AI requests
export const $sessionContext = computed(
  [session.$currentSession, session.$messages],
  (currentSession, messages) => ({
    sessionId: currentSession?.id,
    messageCount: messages.length,
    hasMessages: messages.length > 0
  })
);

// UI state combined with loading states
export const $isAnyLoading = computed(
  [ai.$isConfigLoading, session.$sessionsLoading, ui.$isLoading],
  (configLoading, sessionsLoading, uiLoading) => configLoading || sessionsLoading || uiLoading
);

// Error state aggregation
export const $hasAnyError = computed(
  [ui.$error, ai.$configError],
  (uiError, configError) => !!(uiError || configError)
);

export const $firstError = computed(
  [ui.$error, ai.$configError],
  (uiError, configError) => uiError || configError || null
);

// Hooks for React components
export const useIsAppReady = () => useStore($isAppReady);
export const useCanStartChat = () => useStore($canStartChat);
export const useActiveProviderConfig = () => useStore($activeProviderConfig);
export const useCurrentModelConfig = () => useStore($currentModelConfig);
export const useSessionContext = () => useStore($sessionContext);
export const useIsAnyLoading = () => useStore($isAnyLoading);
export const useHasAnyError = () => useStore($hasAnyError);
export const useFirstError = () => useStore($firstError);