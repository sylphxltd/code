/**
 * Model Migration Utilities
 *
 * Helpers to migrate from old provider+model format to new normalized modelId
 */

import type { ProviderId } from '../config/ai-config.js';
import { MODELS } from './model-registry.js';

/**
 * Legacy provider to new model ID mapping
 * Maps old (provider, model) pairs to new modelId
 */
const LEGACY_MODEL_MAPPING: Record<string, Record<string, string>> = {
  openai: {
    'gpt-4o': 'gpt-4o',
    'gpt-4o-mini': 'gpt-4o-mini',
    'o1': 'o1',
    'o1-mini': 'o1-mini',
  },
  anthropic: {
    'claude-sonnet-4': 'claude-sonnet-4',
    'claude-sonnet-4.5': 'claude-sonnet-4',
    'anthropic/claude-sonnet-4.5': 'claude-sonnet-4',
    'claude-sonnet-3.5': 'claude-sonnet-3.5',
    'anthropic/claude-sonnet-3.5': 'claude-sonnet-3.5',
    'claude-opus-3.5': 'claude-opus-3.5',
    'claude-haiku-3.5': 'claude-haiku-3.5',
  },
  openrouter: {
    'anthropic/claude-sonnet-4.5': 'openrouter/anthropic/claude-sonnet-4.5',
    'anthropic/claude-sonnet-3.5': 'openrouter/anthropic/claude-sonnet-3.5',
    'openai/gpt-4o': 'openrouter/openai/gpt-4o',
    'google/gemini-2.0-flash-exp': 'openrouter/google/gemini-2.0-flash-exp',
  },
};

/**
 * Migrate legacy provider+model to normalized modelId
 *
 * @param provider - Old provider ID
 * @param model - Old model name
 * @returns Normalized modelId, or null if unable to migrate
 *
 * @example
 * migrateToModelId('openrouter', 'anthropic/claude-sonnet-4.5')
 * // Returns: 'openrouter/anthropic/claude-sonnet-4.5'
 *
 * migrateToModelId('anthropic', 'claude-sonnet-4')
 * // Returns: 'claude-sonnet-4'
 */
export function migrateToModelId(provider: ProviderId | string, model: string): string | null {
  // Check legacy mapping
  const providerMapping = LEGACY_MODEL_MAPPING[provider];
  if (providerMapping) {
    const modelId = providerMapping[model];
    if (modelId && MODELS[modelId]) {
      return modelId;
    }
  }

  // Try direct lookup (might already be a valid modelId)
  if (MODELS[model]) {
    return model;
  }

  // Try provider prefix format
  const prefixedId = `${provider}/${model}`;
  if (MODELS[prefixedId]) {
    return prefixedId;
  }

  // Unable to migrate
  console.warn(`[Model Migration] Unable to migrate: provider=${provider}, model=${model}`);
  return null;
}

/**
 * Get default modelId for a provider
 *
 * @param provider - Provider ID
 * @returns Default modelId for the provider
 */
export function getDefaultModelIdForProvider(provider: ProviderId | string): string | null {
  const defaults: Record<string, string> = {
    openai: 'gpt-4o',
    anthropic: 'claude-sonnet-4',
    openrouter: 'openrouter/anthropic/claude-sonnet-4.5',
  };

  return defaults[provider] || null;
}

/**
 * Extract provider ID from modelId
 *
 * @param modelId - Normalized model ID
 * @returns Provider ID
 *
 * @example
 * getProviderIdFromModelId('claude-sonnet-4') // Returns: 'anthropic'
 * getProviderIdFromModelId('openrouter/anthropic/claude-sonnet-3.5') // Returns: 'openrouter'
 */
export function getProviderIdFromModelId(modelId: string): string | null {
  const model = MODELS[modelId];
  return model?.providerId || null;
}

/**
 * Migrate session data from old format to new format
 *
 * @param session - Session with old provider+model format
 * @returns Session with new modelId format
 */
export function migrateSessionModel<T extends { provider?: string; model?: string; modelId?: string }>(
  session: T
): T & { modelId: string } {
  // Already has modelId
  if (session.modelId && MODELS[session.modelId]) {
    return session as T & { modelId: string };
  }

  // Try to migrate from provider+model
  if (session.provider && session.model) {
    const modelId = migrateToModelId(session.provider, session.model);
    if (modelId) {
      return {
        ...session,
        modelId,
      };
    }

    // Fallback to default for provider
    const defaultModelId = getDefaultModelIdForProvider(session.provider);
    if (defaultModelId) {
      console.warn(
        `[Model Migration] Using default model for provider=${session.provider}: ${defaultModelId}`
      );
      return {
        ...session,
        modelId: defaultModelId,
      };
    }
  }

  // Last resort: use first available model
  const firstModelId = Object.keys(MODELS)[0];
  console.error(
    `[Model Migration] Failed to migrate session model, using fallback: ${firstModelId}`
  );
  return {
    ...session,
    modelId: firstModelId,
  };
}
