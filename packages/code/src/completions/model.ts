/**
 * Model Completions
 * Fetches models from provider API for current provider
 */

import { getTRPCClient } from "@sylphx/code-client";
import { fetchModels } from "@sylphx/code-core";
import { get } from "@sylphx/zen";
import { $aiConfig, $currentSession, setAIConfig } from "@sylphx/code-client";
import type { AIConfig, ProviderId } from "@sylphx/code-core";

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
		const config = await trpc.config.load.query();

		// Cache in zen signal (stays until explicitly updated)
		setAIConfig(config);

		return config;
	} catch (error) {
		console.error("[completions] Failed to load AI config:", error);
		return null;
	}
}

/**
 * Get model completion options for current provider
 * Fetches models from provider API (not cached - models can change frequently)
 */
export async function getModelCompletions(partial = ""): Promise<CompletionOption[]> {
	try {
		const config = await getAIConfig();

		if (!config?.providers) {
			return [];
		}

		// Get current provider from session or config
		const currentSession = get($currentSession);
		const currentProviderId = currentSession?.provider || config.defaultProvider;

		if (!currentProviderId) {
			return [];
		}

		// Get provider config
		const providerConfig = config.providers[currentProviderId];
		if (!providerConfig) {
			return [];
		}

		// Fetch models from provider API
		const models = await fetchModels(currentProviderId as ProviderId, providerConfig);

		// Filter by partial match
		const filtered = partial
			? models.filter((m) => m.name.toLowerCase().includes(partial.toLowerCase()))
			: models;

		return filtered.map((m) => ({
			id: m.id,
			label: m.name,
			value: m.id,
		}));
	} catch (error) {
		console.error("[completions] Failed to fetch models:", error);
		return [];
	}
}
