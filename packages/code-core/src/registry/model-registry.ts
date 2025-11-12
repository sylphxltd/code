/**
 * Model Registry
 *
 * Centralized registry of all supported AI providers and models.
 * This is the single source of truth for model metadata.
 */

import type { Model, Provider } from "../types/model.types.js";

/**
 * All supported providers
 */
export const PROVIDERS = {
	openai: {
		id: "openai",
		name: "OpenAI",
		status: "active",
		apiKeyRequired: true,
		modelIds: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"],
		description: "OpenAI models including GPT-4 and O1",
		website: "https://openai.com",
	},
	anthropic: {
		id: "anthropic",
		name: "Anthropic",
		status: "active",
		apiKeyRequired: true,
		modelIds: ["claude-sonnet-4", "claude-sonnet-3.5", "claude-opus-3.5", "claude-haiku-3.5"],
		description: "Anthropic Claude models",
		website: "https://anthropic.com",
	},
	openrouter: {
		id: "openrouter",
		name: "OpenRouter",
		status: "active",
		apiKeyRequired: true,
		modelIds: [
			"openrouter/anthropic/claude-sonnet-4.5",
			"openrouter/anthropic/claude-sonnet-3.5",
			"openrouter/openai/gpt-4o",
			"openrouter/google/gemini-2.0-flash-exp",
		],
		description: "Unified API for multiple AI providers",
		website: "https://openrouter.ai",
	},
} as const satisfies Record<string, Provider>;

/**
 * All supported models
 */
export const MODELS = {
	// OpenAI Models
	"gpt-4o": {
		id: "gpt-4o",
		name: "GPT-4o",
		providerId: "openai",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: true,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: true,
			file: false,
			tools: true,
		},
		reasoning: "no",
		maxContext: 128000,
		pricing: {
			inputPer1M: 2.5,
			outputPer1M: 10,
			cachedInputPer1M: 1.25,
		},
		description: "OpenAI flagship multimodal model",
	},
	"gpt-4o-mini": {
		id: "gpt-4o-mini",
		name: "GPT-4o Mini",
		providerId: "openai",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: true,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: true,
			file: false,
			tools: true,
		},
		reasoning: "no",
		maxContext: 128000,
		pricing: {
			inputPer1M: 0.15,
			outputPer1M: 0.6,
			cachedInputPer1M: 0.075,
		},
		description: "Affordable small model for fast tasks",
	},
	o1: {
		id: "o1",
		name: "O1",
		providerId: "openai",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: false,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: false,
		},
		reasoning: "yes",
		maxContext: 200000,
		pricing: {
			inputPer1M: 15,
			outputPer1M: 60,
			cachedInputPer1M: 7.5,
		},
		description: "Advanced reasoning model",
	},
	"o1-mini": {
		id: "o1-mini",
		name: "O1 Mini",
		providerId: "openai",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: false,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: false,
		},
		reasoning: "yes",
		maxContext: 128000,
		pricing: {
			inputPer1M: 3,
			outputPer1M: 12,
			cachedInputPer1M: 1.5,
		},
		description: "Faster reasoning model",
	},

	// Anthropic Models
	"claude-sonnet-4": {
		id: "claude-sonnet-4",
		name: "Claude Sonnet 4",
		providerId: "anthropic",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "auto",
		maxContext: 200000,
		pricing: {
			inputPer1M: 3,
			outputPer1M: 15,
			cachedInputPer1M: 0.3,
		},
		description: "Latest Claude model with extended thinking",
	},
	"claude-sonnet-3.5": {
		id: "claude-sonnet-3.5",
		name: "Claude Sonnet 3.5",
		providerId: "anthropic",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "auto",
		maxContext: 200000,
		pricing: {
			inputPer1M: 3,
			outputPer1M: 15,
			cachedInputPer1M: 0.3,
		},
		description: "Balanced performance and speed",
	},
	"claude-opus-3.5": {
		id: "claude-opus-3.5",
		name: "Claude Opus 3.5",
		providerId: "anthropic",
		status: "beta",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "auto",
		maxContext: 200000,
		pricing: {
			inputPer1M: 15,
			outputPer1M: 75,
			cachedInputPer1M: 1.5,
		},
		description: "Most capable Claude model",
	},
	"claude-haiku-3.5": {
		id: "claude-haiku-3.5",
		name: "Claude Haiku 3.5",
		providerId: "anthropic",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "no",
		maxContext: 200000,
		pricing: {
			inputPer1M: 0.8,
			outputPer1M: 4,
			cachedInputPer1M: 0.08,
		},
		description: "Fastest Claude model",
	},

	// OpenRouter Models
	"openrouter/anthropic/claude-sonnet-4.5": {
		id: "openrouter/anthropic/claude-sonnet-4.5",
		name: "Claude Sonnet 4.5 (OpenRouter)",
		providerId: "openrouter",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "auto",
		maxContext: 200000,
		pricing: {
			inputPer1M: 3,
			outputPer1M: 15,
		},
	},
	"openrouter/anthropic/claude-sonnet-3.5": {
		id: "openrouter/anthropic/claude-sonnet-3.5",
		name: "Claude Sonnet 3.5 (OpenRouter)",
		providerId: "openrouter",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "auto",
		maxContext: 200000,
		pricing: {
			inputPer1M: 3,
			outputPer1M: 15,
		},
	},
	"openrouter/openai/gpt-4o": {
		id: "openrouter/openai/gpt-4o",
		name: "GPT-4o (OpenRouter)",
		providerId: "openrouter",
		status: "active",
		inputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: false,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: false,
			video: false,
			audio: false,
			file: false,
			tools: true,
		},
		reasoning: "no",
		maxContext: 128000,
		pricing: {
			inputPer1M: 2.5,
			outputPer1M: 10,
		},
	},
	"openrouter/google/gemini-2.0-flash-exp": {
		id: "openrouter/google/gemini-2.0-flash-exp",
		name: "Gemini 2.0 Flash (OpenRouter)",
		providerId: "openrouter",
		status: "beta",
		inputCapabilities: {
			text: true,
			image: true,
			video: true,
			audio: true,
			file: true,
			tools: true,
		},
		outputCapabilities: {
			text: true,
			image: true,
			video: false,
			audio: true,
			file: false,
			tools: true,
		},
		reasoning: "no",
		maxContext: 1000000,
		pricing: {
			inputPer1M: 0,
			outputPer1M: 0,
		},
		description: "Free experimental multimodal model",
	},
} as const satisfies Record<string, Model>;

/**
 * Get all providers
 */
export function getAllProviders(): Provider[] {
	return Object.values(PROVIDERS);
}

/**
 * Get provider entity by ID
 * Returns Provider metadata from registry
 */
export function getProviderEntity(providerId: string): Provider | undefined {
	return PROVIDERS[providerId];
}

/**
 * @deprecated Use getProviderEntity instead
 * Kept for backward compatibility
 */
export function getProvider(providerId: string): Provider | undefined {
	return getProviderEntity(providerId);
}

/**
 * Get all models
 */
export function getAllModels(): Model[] {
	return Object.values(MODELS);
}

/**
 * Get model by ID
 */
export function getModel(modelId: string): Model | undefined {
	return MODELS[modelId];
}

/**
 * Get all models for a provider
 */
export function getModelsByProvider(providerId: string): Model[] {
	const provider = PROVIDERS[providerId];
	if (!provider) return [];

	return provider.modelIds
		.map((id) => MODELS[id])
		.filter((model): model is Model => model !== undefined);
}

/**
 * Get model with its provider information
 */
export function getModelWithProvider(
	modelId: string,
): (Model & { provider: Provider }) | undefined {
	const model = MODELS[modelId];
	if (!model) return undefined;

	const provider = PROVIDERS[model.providerId];
	if (!provider) return undefined;

	return { ...model, provider };
}

/**
 * Check if model supports a specific input capability
 */
export function modelSupportsInput(
	modelId: string,
	capability: keyof Model["inputCapabilities"],
): boolean {
	const model = MODELS[modelId];
	return model?.inputCapabilities[capability] ?? false;
}

/**
 * Check if model supports a specific output capability
 */
export function modelSupportsOutput(
	modelId: string,
	capability: keyof Model["outputCapabilities"],
): boolean {
	const model = MODELS[modelId];
	return model?.outputCapabilities[capability] ?? false;
}
