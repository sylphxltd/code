/**
 * Model Command
 * Switch AI model using component-based UI
 */

import { ModelSelection } from '../../screens/chat/components/ModelSelection.js';
import { getModelCompletions } from '../../completions/model.js';
import type { Command } from '../types.js';

export const modelCommand: Command = {
  id: 'model',
  label: '/model',
  description: 'Switch AI model',
  args: [
    {
      name: 'model-name',
      description: 'Model to switch to',
      required: false,
      loadOptions: async () => {
        return getModelCompletions();
      },
    },
  ],
  execute: async (context) => {
    // Get zen signals
    const { get } = await import('@sylphx/code-client');
    const { $aiConfig, $currentSession, $selectedProvider, $currentSessionId, setAIConfig, updateSessionModel } = await import('@sylphx/code-client');

    // If arg provided, switch directly
    if (context.args.length > 0) {
      const modelId = context.args[0];
      const currentSession = get($currentSession);
      const aiConfig = get($aiConfig);
      const provider = currentSession?.provider || aiConfig?.defaultProvider;

      if (!provider) {
        return 'No provider configured. Please configure a provider first.';
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

      return `Switched to model: ${modelId}`;
    }

    // No args - show model selection UI
    const aiConfig = get($aiConfig);
    if (!aiConfig?.providers) {
      return 'No providers configured. Please configure a provider first.';
    }

    // Get current session's provider or selected provider from zen signals
    const currentSession = get($currentSession);
    const selectedProvider = get($selectedProvider);
    const currentProviderId = currentSession?.provider || selectedProvider;

    if (!currentProviderId) {
      return 'No provider selected. Use /provider to select a provider first.';
    }

    const config = aiConfig.providers[currentProviderId];
    if (!config) {
      return `Provider ${currentProviderId} is not configured.`;
    }

    // Fetch models from current provider
    let allModels: Array<{ id: string; name: string }> = [];
    try {
      const { fetchModels } = await import('@sylphx/code-core');
      const models = await fetchModels(currentProviderId as any, config);
      allModels = models.map((m) => ({ id: m.id, name: m.name }));
      context.addLog(`Loaded ${models.length} models from ${currentProviderId}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      context.addLog(`Failed to fetch models for ${currentProviderId}: ${errorMsg}`);
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
          const { get } = await import('@sylphx/code-client');
          const { $aiConfig, $currentSessionId, setAIConfig, updateSessionModel } = await import('@sylphx/code-client');
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
          context.addLog('[model] Model selection cancelled');
        }}
      />,
      'Model Selection'
    );

    context.addLog(`[model] Model selection opened`);
  },
};

export default modelCommand;
