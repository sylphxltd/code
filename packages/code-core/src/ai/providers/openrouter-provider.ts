/**
 * OpenRouter Provider
 * Uses OpenAI-compatible API
 */

import { openrouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModelV1 } from 'ai';
import type { AIProvider, ProviderModelDetails, ConfigField, ProviderConfig, ModelInfo, ModelCapability, ModelCapabilities } from './base-provider.js';
import { hasRequiredFields } from './base-provider.js';
import { retryNetwork } from '../../utils/retry.js';
import { getModelMetadata } from '../../utils/models-dev.js';
import { TTLCacheManager } from '../../utils/ttl-cache.js';

export class OpenRouterProvider implements AIProvider {
  readonly id = 'openrouter' as const;
  readonly name = 'OpenRouter';
  readonly description = 'Access multiple AI providers';

  /**
   * Shared TTL cache for models list (1 hour)
   * Shared across all instances to avoid duplicate API calls
   */
  private static modelsCache = new TTLCacheManager<ModelInfo[]>(
    60 * 60 * 1000, // 1 hour TTL
    'OpenRouter.models'
  );

  /**
   * Cache for model capabilities from OpenRouter API
   * Maps modelId -> capabilities parsed from API response
   */
  private modelCapabilitiesCache = new Map<string, ModelCapabilities>();

  /**
   * Parse capabilities from OpenRouter API response
   * Uses ONLY actual API data - no hardcoded model name patterns
   * Returns Set of capability strings
   */
  private parseCapabilitiesFromAPI(model: {
    id: string;
    supported_parameters?: string[];
    architecture?: {
      modality?: string;
      input_modalities?: string[];
      output_modalities?: string[];
    };
  }): ModelCapabilities {
    const supportedParams = model.supported_parameters || [];
    const inputModalities = model.architecture?.input_modalities || [];
    const outputModalities = model.architecture?.output_modalities || [];

    const capabilities = new Set<ModelCapability>();

    // API explicitly tells us if model supports tools
    if (supportedParams.includes('tools')) {
      capabilities.add('tools');
    }

    // API tells us if model accepts image input
    if (inputModalities.includes('image')) {
      capabilities.add('image-input');
    }

    // API tells us if model can generate images
    if (outputModalities.includes('image')) {
      capabilities.add('image-output');
    }

    // API tells us if model supports structured outputs
    if (supportedParams.includes('structured_outputs') || supportedParams.includes('response_format')) {
      capabilities.add('structured-output');
    }

    // API doesn't provide reasoning info yet
    // Models with extended thinking should set this via supported_parameters if OpenRouter adds it

    return capabilities;
  }

  /**
   * Default capabilities when API data is not available
   * Returns empty Set - user must call fetchModels first
   */
  private getDefaultCapabilities(): ModelCapabilities {
    return new Set();
  }

  getConfigSchema(): ConfigField[] {
    return [
      {
        key: 'apiKey',
        label: 'API Key',
        type: 'string',
        required: true,
        secret: true,
        description: 'Get your API key from https://openrouter.ai',
        placeholder: 'sk-or-...',
      },
    ];
  }

  isConfigured(config: ProviderConfig): boolean {
    return hasRequiredFields(this.getConfigSchema(), config);
  }

  getModelCapabilities(modelId: string): ModelCapabilities {
    // Use cached capabilities from API if available (accurate)
    const cached = this.modelCapabilitiesCache.get(modelId);
    if (cached) {
      return cached;
    }

    // Return conservative defaults if cache miss
    // User must call fetchModels to populate cache with real API data
    return this.getDefaultCapabilities();
  }

  async fetchModels(config: ProviderConfig): Promise<ModelInfo[]> {
    const apiKey = config.apiKey as string | undefined;

    // Generate cache key based on API key (or 'public' for keyless access)
    const cacheKey = apiKey ? `models:${apiKey.toString().slice(0, 10)}` : 'models:public';

    // Check TTL cache first
    const cached = OpenRouterProvider.modelsCache.get(cacheKey);
    if (cached) {
      // Fresh data from cache - no API call needed
      return cached;
    }

    // Cache miss or expired - fetch from API
    return retryNetwork(async () => {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
        signal: AbortSignal.timeout(10000), // 10s timeout
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as {
        data: Array<{
          id: string;
          name: string;
          context_length?: number;
          supported_parameters?: string[];
          architecture?: {
            modality?: string;
            input_modalities?: string[];
            output_modalities?: string[];
          };
          pricing?: {
            prompt: string;
            completion: string;
          };
        }>;
      };

      const models = data.data.map((model) => {
        // Parse capabilities from API response (use actual data, not guessing)
        const capabilities = this.parseCapabilitiesFromAPI(model);

        // Store in cache for getModelCapabilities to use
        this.modelCapabilitiesCache.set(model.id, capabilities);

        return {
          id: model.id,
          name: model.name || model.id,
          capabilities,
        };
      });

      // Store in TTL cache (1 hour)
      OpenRouterProvider.modelsCache.set(cacheKey, models);

      return models;
    }, 2);
  }

  async getModelDetails(modelId: string, config?: ProviderConfig): Promise<ProviderModelDetails | null> {
    const apiKey = config?.apiKey as string | undefined;

    // Try fetching from OpenRouter API
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      });

      if (response.ok) {
        const data = (await response.json()) as {
          data: Array<{
            id: string;
            context_length?: number;
            top_provider?: {
              max_completion_tokens?: number;
            };
            pricing?: {
              prompt: string;
              completion: string;
            };
          }>;
        };

        const model = data.data.find((m) => m.id === modelId);
        if (model) {
          return {
            contextLength: model.context_length,
            maxOutput: model.top_provider?.max_completion_tokens,
            inputPrice: parseFloat(model.pricing?.prompt || '0'),
            outputPrice: parseFloat(model.pricing?.completion || '0'),
          };
        }
      }
    } catch {
      // Fall through to models.dev
    }

    // Fall back to models.dev
    const metadata = await getModelMetadata(modelId);
    if (metadata) {
      return {
        contextLength: metadata.contextLength,
        maxOutput: metadata.maxOutput,
        inputPrice: metadata.inputPrice,
        outputPrice: metadata.outputPrice,
      };
    }

    return null;
  }

  createClient(config: ProviderConfig, modelId: string): LanguageModelV1 {
    const apiKey = config.apiKey as string;

    // Get capabilities to determine features like image generation
    const capabilities = this.getModelCapabilities(modelId);
    const supportsImageGeneration = capabilities.has('image-output');

    // Use official OpenRouter provider
    // For image generation models, pass modalities via extraBody
    const model = openrouter(modelId, {
      apiKey,
      ...(supportsImageGeneration
        ? {
            extraBody: {
              modalities: ['image', 'text'],
              image_config: {
                aspect_ratio: '16:9',
              },
            },
          }
        : {}),
    });

    console.log('[OpenRouter] Created client for:', modelId, 'with capabilities:', Array.from(capabilities));

    return model;
  }
}
