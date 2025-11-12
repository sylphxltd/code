/**
 * AI Model Fetcher
 * Dynamically fetch available models from providers using provider registry
 */

import type { ProviderConfig, ModelInfo } from "../ai/providers/base-provider.js";
import { getProvider, type ProviderId } from "../ai/providers/index.js";

// Re-export ModelInfo for backward compatibility
export type { ModelInfo } from "../ai/providers/base-provider.js";

/**
 * Fetch models for a provider using provider registry
 */
export async function fetchModels(
	provider: ProviderId,
	config: ProviderConfig = {},
): Promise<ModelInfo[]> {
	const providerInstance = getProvider(provider);
	return providerInstance.fetchModels(config);
}
