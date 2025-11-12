/**
 * Model Command
 * Switch AI model using component-based UI
 */

import { ModelSelection } from "../../screens/chat/components/ModelSelection.js";
import { getModelCompletions } from "../../completions/model.js";
import type { Command } from "../types.js";

export const modelCommand: Command = {
	id: "model",
	label: "/model",
	description: "Switch AI model",
	args: [
		{
			name: "model-name",
			description: "Model to switch to",
			required: false,
			loadOptions: async () => {
				return getModelCompletions();
			},
		},
	],
	execute: async (context) => {
		// Get zen signals
		const { get } = await import("@sylphx/code-client");
		const {
			$aiConfig,
			$currentSession,
			$selectedProvider,
			$currentSessionId,
			setAIConfig,
			updateSessionModel,
		} = await import("@sylphx/code-client");

		// If arg provided, switch directly
		if (context.args.length > 0) {
			const modelId = context.args[0];
			const currentSession = get($currentSession);
			const aiConfig = get($aiConfig);
			const provider = currentSession?.provider || aiConfig?.defaultProvider;

			if (!provider) {
				return "No provider configured. Please use /provider to select a provider first.";
			}

			if (!aiConfig?.providers?.[provider]) {
				return `Provider ${provider} is not configured. Please configure it using /provider first.`;
			}

			// Validate the model exists for this provider
			try {
				const { fetchModels } = await import("@sylphx/code-core");
				const models = await fetchModels(provider as any, aiConfig.providers[provider]);
				const modelExists = models.some((m) => m.id === modelId);

				if (!modelExists) {
					const availableModels = models.map((m) => m.id).join(", ");
					return `Model '${modelId}' not found for ${provider}. Available models: ${availableModels}`;
				}
			} catch (error) {
				const errorMsg = error instanceof Error ? error.message : String(error);
				context.addLog(`Warning: Could not verify model '${modelId}' for ${provider}: ${errorMsg}`);
			}

			// Update model and save to provider config
			const newConfig = {
				...aiConfig!,
				defaultModel: modelId,
				providers: {
					...aiConfig!.providers,
					[provider]: {
						...aiConfig!.providers?.[provider],
						defaultModel: modelId,
					},
				},
			};
			setAIConfig(newConfig);

			// Save config to file
			await context.saveConfig(newConfig);

			// Update current session's model (preserve history)
			const currentSessionId = get($currentSessionId);
			if (currentSessionId) {
				await updateSessionModel(currentSessionId, modelId);
			}

			return `Switched to model: ${modelId} for ${provider}`;
		}

		// No args - show model selection UI
		const aiConfig = get($aiConfig);
		if (!aiConfig?.providers) {
			return "No providers configured. Please configure a provider first.";
		}

		// Get current session's provider or selected provider from zen signals
		const currentSession = get($currentSession);
		const selectedProvider = get($selectedProvider);
		const currentProviderId = currentSession?.provider || selectedProvider;

		if (!currentProviderId) {
			return "No provider selected. Use /provider to select a provider first.";
		}

		const config = aiConfig.providers[currentProviderId];
		if (!config) {
			return `Provider ${currentProviderId} is not configured.`;
		}

		// Fetch models from current provider
		let allModels: Array<{ id: string; name: string }> = [];
		try {
			const { fetchModels } = await import("@sylphx/code-core");
			const models = await fetchModels(currentProviderId as any, config);
			allModels = models.map((m) => ({ id: m.id, name: m.name }));
			context.addLog(`Loaded ${models.length} models from ${currentProviderId}`);
		} catch (error) {
			const errorMsg = error instanceof Error ? error.message : String(error);
			context.addLog(`Failed to fetch models for ${currentProviderId}: ${errorMsg}`);

			// Provide helpful error messages for common issues
			if (currentProviderId === "claude-code" && errorMsg.includes("claude")) {
				return `Failed to load Claude Code models: ${errorMsg}\n\nTo use Claude Code provider:\n1. Install Claude CLI: npm install -g @anthropic-ai/claude-code\n2. Login: claude login\n3. Then try /model again`;
			}

			return `Failed to load models from ${currentProviderId}: ${errorMsg}`;
		}

		if (allModels.length === 0) {
			return `No models available for ${currentProviderId}`;
		}

		// Use ModelSelection component
		context.setInputComponent(
			<ModelSelection
				models={allModels}
				currentProvider={currentProviderId}
				onSelect={async (modelId) => {
					const provider = currentProviderId;

					// Get fresh zen signal values
					const { get } = await import("@sylphx/code-client");
					const { $aiConfig, $currentSessionId, setAIConfig, updateSessionModel } = await import(
						"@sylphx/code-client"
					);
					const freshAIConfig = get($aiConfig);
					const freshCurrentSessionId = get($currentSessionId);

					// Update model and save to provider config
					const newConfig = {
						...freshAIConfig!,
						defaultModel: modelId,
						providers: {
							...freshAIConfig!.providers,
							[provider]: {
								...freshAIConfig!.providers?.[provider],
								defaultModel: modelId,
							},
						},
					};
					setAIConfig(newConfig);

					// Save config to file
					await context.saveConfig(newConfig);

					// Update current session's model (preserve history)
					if (freshCurrentSessionId) {
						await updateSessionModel(freshCurrentSessionId, modelId);
					}

					context.setInputComponent(null);
					context.addLog(`[model] Switched to model: ${modelId}`);
				}}
				onCancel={() => {
					context.setInputComponent(null);
					context.addLog("[model] Model selection cancelled");
				}}
			/>,
			"Model Selection",
		);

		context.addLog(`[model] Model selection opened`);
	},
};

export default modelCommand;
