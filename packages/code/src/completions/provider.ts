/**
 * Provider Completions
 * Lazy loading from zen signals, no extra cache needed
 */

import { getTRPCClient } from '@sylphx/code-client';
import { get } from '@sylphx/zen';
import { $aiConfig, setAIConfig } from '@sylphx/code-client';
import type { AIConfig } from '@sylphx/code-core';

export interface CompletionOption {
  id: string;
  label: string;
  value: string;
}

/**
 * Get AI config from zen signals
 * First access: async load from server → cache in zen signal
 * Subsequent access: sync read from zen signal cache
 * Update: event-driven via setAIConfig()
 */
async function getAIConfig(): Promise<AIConfig | null> {
  // Already in zen signal? Return cached (fast!)
  const currentConfig = get($aiConfig);
  if (currentConfig) {
    return currentConfig;
  }

  // First access - lazy load from server
  try {
    const trpc = getTRPCClient();
    const config = await trpc.config.load.query({ cwd: process.cwd() });

    // Cache in zen signal (stays until explicitly updated)
    setAIConfig(config);

    return config;
  } catch (error) {
    console.error('[completions] Failed to load AI config:', error);
    return null;
  }
}

/**
 * Get provider completion options
 * Returns ALL available providers from the registry (not just configured ones)
 */
export async function getProviderCompletions(partial = ''): Promise<CompletionOption[]> {
  try {
    const trpc = getTRPCClient();
    const result = await trpc.config.getProviders.query({ cwd: process.cwd() });

    const providers = Object.keys(result);
    const filtered = partial
      ? providers.filter(id => id.toLowerCase().includes(partial.toLowerCase()))
      : providers;

    return filtered.map(id => ({
      id,
      label: id,
      value: id,
    }));
  } catch (error) {
    console.error('[completions] Failed to load providers:', error);
    return [];
  }
}

/**
 * Get action completion options (static)
 */
export function getActionCompletions(): CompletionOption[] {
  return [
    { id: 'use', label: 'use', value: 'use' },
    { id: 'configure', label: 'configure', value: 'configure' },
  ];
}

/**
 * Get subaction completion options for configure command (static)
 */
export function getSubactionCompletions(): CompletionOption[] {
  return [
    { id: 'set', label: 'set', value: 'set' },
    { id: 'get', label: 'get', value: 'get' },
    { id: 'show', label: 'show', value: 'show' },
  ];
}

/**
 * Get provider configuration key completions
 * Dynamically fetches schema from provider
 */
export async function getProviderKeyCompletions(providerId: string): Promise<CompletionOption[]> {
  try {
    const trpc = getTRPCClient();
    const result = await trpc.config.getProviderSchema.query({
      providerId: providerId as any
    });

    if (!result.success || !result.schema) {
      return [];
    }

    // Return all config field keys
    return result.schema.map(field => ({
      id: field.key,
      label: field.key,
      value: field.key,
    }));
  } catch (error) {
    console.error('[completions] Failed to load provider schema:', error);
    return [];
  }
}
