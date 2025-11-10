/**
 * Model Selection Screen
 * Select provider and model with dynamic loading
 */

import {
  useAIConfig,
  useAIConfigActions,
  useKeyboard,
  useModels,
  useProviders,
  useSelectedProvider,
  useSelectedModel,
  setSelectedProvider,
  setSelectedModel,
  updateProvider,
  setError,
  navigateTo
} from '@sylphx/code-client';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import React, { useEffect, useState } from 'react';

type Mode = 'provider' | 'model' | 'search';

interface MenuItem {
  label: string;
  value: string;
}

/**
 * ModelSelection Component
 *
 * ARCHITECTURE: No provider hardcoding
 * - Fetches available providers from server (useProviders hook)
 * - Fetches models dynamically (useModels hook)
 * - Client is agnostic to which providers exist
 * - Server is source of truth
 */
export default function ModelSelection() {
  const [mode, setMode] = useState<Mode>('provider');
  const [searchQuery, setSearchQuery] = useState('');

  const aiConfig = useAIConfig();
  const selectedProvider = useSelectedProvider();
  const selectedModel = useSelectedModel();
  const { saveConfig } = useAIConfigActions();

  const configuredProviders = Object.keys(aiConfig?.providers || {});

  // Load AI providers from server
  const { providers: aiProviders, loading: loadingProviders } = useProviders();

  // Load models when provider is selected
  const { models, loading: isLoadingModels, error: modelsError } = useModels(selectedProvider);

  // Handle models loading error
  useEffect(() => {
    if (modelsError) {
      setError(modelsError);
    }
  }, [modelsError, setError]);

  // Auto-select default model when models are loaded
  useEffect(() => {
    if (selectedProvider && mode === 'model' && models.length > 0 && !isLoadingModels) {
      loadModelsAndSelectDefault();
    }
  }, [selectedProvider, mode, models, isLoadingModels]);

  const loadModelsAndSelectDefault = async () => {
    if (!selectedProvider || models.length === 0) return;

    // Auto-select: last used (provider's defaultModel) or first in list
    const providerConfig = aiConfig?.providers?.[selectedProvider] || {};
    const defaultModel = providerConfig.defaultModel as string | undefined;
    const modelToSelect = defaultModel || models[0]?.id;

    if (modelToSelect) {
      // Automatically select and save the model
      setSelectedModel(modelToSelect);

      // Update config
      const newConfig = {
        ...aiConfig!,
        defaultProvider: selectedProvider,
        // ❌ No top-level defaultModel
        providers: {
          ...aiConfig!.providers,
          [selectedProvider]: {
            ...aiConfig!.providers?.[selectedProvider],
            defaultModel: modelToSelect,  // ✅ Save as provider's default
          },
        },
      };

      // Update store
      await updateProvider(selectedProvider, { defaultModel: modelToSelect });
      await saveConfig(newConfig);

      // Reset and go back to chat
      await setSelectedProvider(null);
      setSearchQuery('');
      setMode('provider');
      navigateTo('chat');
    }
  };

  // Provider selection
  if (mode === 'provider') {
    if (configuredProviders.length === 0) {
      return (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text bold color="cyan">
              Model Selection
            </Text>
          </Box>

          <Box marginBottom={1}>
            <Text color="yellow">⚠️ No providers configured</Text>
          </Box>

          <Box>
            <Text dimColor>Please configure providers first</Text>
          </Box>

          <Box marginTop={1}>
            <Text dimColor>Press Esc to go back</Text>
          </Box>
        </Box>
      );
    }

    const items: MenuItem[] = [
      ...configuredProviders.map((id) => ({
        label: `${aiProviders[id]?.name || id}${aiConfig?.defaultProvider === id ? ' (Default)' : ''}`,
        value: id,
      })),
      { label: 'Back to Chat', value: 'back' },
    ];

    const handleSelect = async (item: MenuItem) => {
      if (item.value === 'back') {
        navigateTo('chat');
      } else {
        await setSelectedProvider(item.value);
        setMode('model');
      }
    };

    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexShrink={0} paddingBottom={1}>
          <Text color="#00D9FF">▌ SELECT PROVIDER</Text>
        </Box>

        <Box flexGrow={1} paddingY={1}>
          <SelectInput items={items} onSelect={handleSelect} />
        </Box>

        <Box flexShrink={0} paddingTop={1}>
          <Text dimColor>↑↓ Navigate · Enter Select · Esc Back</Text>
        </Box>
      </Box>
    );
  }

  // Model selection
  if (mode === 'model') {
    if (isLoadingModels) {
      return (
        <Box>
          <Text color="yellow">Loading models...</Text>
        </Box>
      );
    }

    // Filter models by search query
    const filteredModels = models.filter(
      (m) =>
        m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.name.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const items: MenuItem[] = filteredModels.slice(0, 20).map((model) => {
      // Format capabilities with emoji
      const caps: string[] = [];
      if (model.capabilities && model.capabilities.size > 0) {
        if (model.capabilities.has('image-input')) caps.push('👁️');
        if (model.capabilities.has('file-input')) caps.push('📎');
        if (model.capabilities.has('image-output')) caps.push('🎨');
        if (model.capabilities.has('tools')) caps.push('🔧');
        if (model.capabilities.has('reasoning')) caps.push('🧠');
      }
      const capsLabel = caps.length > 0 ? ` ${caps.join('')}` : '';

      const nameLabel = model.name !== model.id ? `${model.name} (${model.id})` : model.id;

      return {
        label: `${nameLabel}${capsLabel}`,
        value: model.id,
      };
    });

    const handleSelect = async (item: MenuItem) => {
      if (!selectedProvider) return;

      await setSelectedModel(item.value);

      // Update config: save selected model as provider's default-model
      const newConfig = {
        ...aiConfig!,
        defaultProvider: selectedProvider,
        // ❌ No top-level defaultModel
        providers: {
          ...aiConfig!.providers,
          [selectedProvider]: {
            ...aiConfig!.providers?.[selectedProvider],
            defaultModel: item.value,  // ✅ Save as provider's default
          },
        },
      };

      // Update store
      await updateProvider(selectedProvider, { defaultModel: item.value });
      await saveConfig(newConfig);

      // Reset and go back
      await setSelectedProvider(null);
      setSearchQuery('');
      setMode('provider');
      navigateTo('chat');
    };

    return (
      <Box flexDirection="column" flexGrow={1}>
        <Box flexShrink={0} paddingBottom={1}>
          <Text color="#00D9FF">▌ SELECT MODEL</Text>
          <Text dimColor> · {selectedProvider && (aiProviders[selectedProvider]?.name || selectedProvider)}</Text>
        </Box>

        {/* Search input */}
        <Box flexShrink={0} paddingY={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>Search</Text>
          </Box>
          <TextInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Type to filter..."
            showCursor
          />
        </Box>

        {/* Model list */}
        <Box flexGrow={1} paddingY={1} flexDirection="column">
          {filteredModels.length === 0 ? (
            <Box>
              <Text color="#FFD700">▌</Text>
              <Text dimColor> No models found</Text>
            </Box>
          ) : (
            <>
              <Box marginBottom={1}>
                <Text dimColor>
                  Showing {Math.min(filteredModels.length, 20)} of {models.length} models
                </Text>
              </Box>
              <SelectInput items={items} onSelect={handleSelect} />
            </>
          )}
        </Box>

        <Box flexShrink={0} paddingTop={1} flexDirection="column">
          <Box marginBottom={1}>
            <Text dimColor>👁️=Vision 📎=Files 🎨=Image Gen 🔧=Tools 🧠=Reasoning</Text>
          </Box>
          <Box>
            <Text dimColor>↑↓ Navigate · Type Search · Enter Select · Esc Cancel</Text>
          </Box>
        </Box>
      </Box>
    );
  }

  return null;
}
