/**
 * Kimi Provider
 * Uses OpenAI-compatible API
 */

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV1 } from "ai";
import type {
	AIProvider,
	ProviderModelDetails,
	ConfigField,
	ProviderConfig,
	ModelInfo,
	ModelCapabilities,
	ModelCapability,
} from "./base-provider.js";
import { hasRequiredFields } from "./base-provider.js";

export class KimiProvider implements AIProvider {
	readonly id = "kimi" as const;
	readonly name = "Kimi";
	readonly description = "Moonshot AI Kimi platform";

	getConfigSchema(): ConfigField[] {
		return [
			{
				key: "apiKey",
				label: "API Key",
				type: "string",
				required: true,
				secret: true,
				description: "Get your API key from https://platform.moonshot.cn",
				placeholder: "sk-...",
			},
		];
	}

	isConfigured(config: ProviderConfig): boolean {
		return hasRequiredFields(this.getConfigSchema(), config);
	}

	async fetchModels(config: ProviderConfig): Promise<ModelInfo[]> {
		const apiKey = config.apiKey as string | undefined;

		if (!apiKey) {
			throw new Error("API key is required to fetch Kimi models");
		}

		const response = await fetch("https://api.kimi.com/coding/v1/models", {
			headers: {
				Authorization: `Bearer ${apiKey}`,
			},
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			throw new Error(`Kimi API returned ${response.status}: ${response.statusText}`);
		}

		const data = (await response.json()) as {
			data?: Array<{ id: string; object?: string }>;
		};

		if (!data.data || data.data.length === 0) {
			throw new Error("No models returned from Kimi API");
		}

		return data.data.map((model) => ({
			id: model.id,
			name: model.id,
		}));
	}

	async getModelDetails(
		modelId: string,
		_config?: ProviderConfig,
	): Promise<ProviderModelDetails | null> {
		// Kimi API doesn't provide detailed model specs via API
		// Return null to indicate no details available
		return null;
	}

	getModelCapabilities(modelId: string): ModelCapabilities {
		// Return empty set - no assumptions about capabilities
		// Let the API/model determine what it supports at runtime
		return new Set<ModelCapability>();
	}

	createClient(config: ProviderConfig, modelId: string): LanguageModelV1 {
		const apiKey = config.apiKey as string;

		const kimi = createOpenAICompatible({
			baseURL: "https://api.kimi.com/coding/v1",
			apiKey,
			name: "kimi",
		});

		return kimi(modelId);
	}
}
