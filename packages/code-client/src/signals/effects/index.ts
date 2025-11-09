/**
 * Signal Effects
 * Handles side effects and cross-domain communication
 */

import { subscribe } from '@sylphx/zen';
import * as session from '../domain/session';
import * as ai from '../domain/ai';
import * as ui from '../domain/ui';
import { emitSessionEvent, emitAIEvent, emitUIEvent } from '../events';

export let initialized = false;

export const initializeEffects = () => {
  if (initialized) return;
  initialized = true;

  // Session domain effects
  const unsubscribeSession = subscribe(session.$currentSession, (currentSession) => {
    if (currentSession) {
      emitSessionEvent('session:loaded', { sessionId: currentSession.id });
    }
  });

  const unsubscribeStreaming = subscribe(session.$isStreaming, (isStreaming) => {
    emitUIEvent(isStreaming ? 'loading:started' : 'loading:finished', {
      context: 'streaming'
    });
  });

  // AI domain effects
  const unsubscribeConfig = subscribe(ai.$aiConfig, (config) => {
    if (config) {
      emitAIEvent('config:loaded', { config });
    }
  });

  const unsubscribeSelectedProvider = subscribe(ai.$selectedProvider, (providerId) => {
    if (providerId) {
      emitAIEvent('provider:selected', { providerId });
    }
  });

  const unsubscribeSelectedModel = subscribe(ai.$selectedModel, (modelId) => {
    const providerId = ai.get?.(ai.$selectedProvider);
    if (providerId && modelId) {
      emitAIEvent('model:selected', { providerId, modelId: modelId });
    }
  });

  const unsubscribeConfigError = subscribe(ai.$configError, (error) => {
    if (error) {
      emitUIEvent('error:shown', { error });
    }
  });

  // UI domain effects
  const unsubscribeNavigation = subscribe(ui.$currentScreen, (currentScreen) => {
    const previousScreen = ui.get?.(ui.$previousScreen);
    if (previousScreen && previousScreen !== currentScreen) {
      emitUIEvent('navigation:changed', { from: previousScreen, to: currentScreen });
    }
  });

  // Cross-domain effects
  const unsubscribeAIConfigSession = subscribe(ai.$aiConfig, (config) => {
    // When AI config loads, set default provider if not already set
    if (config?.defaultProvider && !ai.get?.(ai.$selectedProvider)) {
      ai.setSelectedProvider(config.defaultProvider);
    }
  });

  // Auto-select session when config loads
  const unsubscribeAIConfigCurrentSession = subscribe(ai.$aiConfig, () => {
    const currentSessionId = session.get?.(session.$currentSessionId);
    if (!currentSessionId) {
      // Auto-create temp session when config is ready
      session.setCurrentSessionId('temp-session');
    }
  });

  // Clean global loading state
  const unsubscribeAnyLoading = subscribe(
    ai.$isConfigLoading,
    (loading) => ui.setLoading?.(loading)
  );

  // Return cleanup function
  return () => {
    unsubscribeSession();
    unsubscribeStreaming();
    unsubscribeConfig();
    unsubscribeSelectedProvider();
    unsubscribeSelectedModel();
    unsubscribeConfigError();
    unsubscribeNavigation();
    unsubscribeAIConfigSession();
    unsubscribeAIConfigCurrentSession();
    unsubscribeAnyLoading();
  };
};