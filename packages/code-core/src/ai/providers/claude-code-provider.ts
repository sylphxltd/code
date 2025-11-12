/**
 * Claude Code Provider
 * Uses Claude Code CLI with OAuth authentication
 * Supports Vercel AI SDK tools (executed by framework, not CLI)
 */

import type { LanguageModelV2 } from "@ai-sdk/provider";
import type {
	AIProvider,
	ProviderModelDetails,
	ConfigField,
	ProviderConfig,
	ModelInfo,
	ModelCapability,
} from "./base-provider.js";
import which from "which";
import { execSync } from "node:child_process";

import { ClaudeCodeLanguageModel } from "./claude-code-language-model.js";

export class ClaudeCodeProvider implements AIProvider {
	readonly id = "claude-code" as const;
	readonly name = "Claude Code";
	readonly description = "Claude Code local models";

	getConfigSchema(): ConfigField[] {
		// No configuration needed - uses Claude CLI OAuth
		return [];
	}

	isConfigured(_config: ProviderConfig): boolean {
		// Claude Code uses CLI OAuth - check if 'claude' command exists
		// Use execSync instead of which.sync - which doesn't work with asdf/nvm in Bun
		try {
			execSync("claude --version", { stdio: "ignore", timeout: 2000 });
			return true;
		} catch {
			return false;
		}
	}

	async fetchModels(_config: ProviderConfig): Promise<ModelInfo[]> {
		// Claude Code has fixed set of models
		// All models support vision, reasoning, and structured output (but not native tools)
		return [
			{
				id: "opus",
				name: "Claude 4.1 Opus (Most Capable)",
				capabilities: new Set<ModelCapability>(["image-input", "reasoning", "structured-output"]),
			},
			{
				id: "sonnet",
				name: "Claude 4.5 Sonnet (Balanced)",
				capabilities: new Set<ModelCapability>(["image-input", "reasoning", "structured-output"]),
			},
			{
				id: "haiku",
				name: "Claude 4.5 Haiku (Fastest)",
				capabilities: new Set<ModelCapability>(["image-input", "reasoning", "structured-output"]),
			},
		];
	}

	getModelCapabilities(_modelId: string): import("./base-provider.js").ModelCapabilities {
		// All Claude models have the same capabilities (no native tools)
		return new Set<ModelCapability>(["image-input", "reasoning", "structured-output"]);
	}

	async getModelDetails(
		modelId: string,
		_config?: ProviderConfig,
	): Promise<ProviderModelDetails | null> {
		// Claude Code models have known specs
		const specs: Record<string, ProviderModelDetails> = {
			opus: {
				contextLength: 200000,
				maxOutput: 4096,
				inputPrice: 0,
				outputPrice: 0,
			},
			sonnet: {
				contextLength: 200000,
				maxOutput: 8192,
				inputPrice: 0,
				outputPrice: 0,
			},
			haiku: {
				contextLength: 200000,
				maxOutput: 4096,
				inputPrice: 0,
				outputPrice: 0,
			},
		};

		return specs[modelId] || null;
	}

	createClient(_config: ProviderConfig, modelId: string): LanguageModelV2 {
		// Use custom LanguageModelV2 implementation with Claude Code CLI
		// This implementation:
		// - Uses Claude Agent SDK query() function
		// - Accesses Claude Code CLI via OAuth (no API key needed)
		// - Supports basic text generation
		// - Returns LanguageModelV2 compatible with AI SDK v5
		// Note: Custom Vercel tools support is limited - Claude Agent SDK only supports
		// built-in tools and MCP servers, not arbitrary tool schemas
		return new ClaudeCodeLanguageModel({
			modelId,
		});
	}
}
