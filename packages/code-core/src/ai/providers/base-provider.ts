/**
 * Base Provider Interface
 * Defines contract for all AI providers
 */

import type { LanguageModelV2 } from '@ai-sdk/provider';
import type { ProviderId } from '../types/provider.types.js';

/**
 * Model capability types
 * Set-based for uniqueness and semantic correctness (serialized via superjson)
 *
 * Hierarchy:
 * - file-input: Universal file support (documents, images, videos, etc.)
 * - image-input: Subset of file-input (image understanding/vision)
 * - file-output: Universal file generation
 * - image-output: Subset of file-output (image generation)
 *
 * Note: image-* capabilities are kept separate for backward compatibility
 * and because image support is often explicitly advertised by providers.
 */
export type ModelCapability =
  | 'tools'              // Native tool/function calling
  | 'file-input'         // File input support (any file type)
  | 'file-output'        // File generation (any file type)
  | 'image-input'        // Image understanding (vision) - implies file-input for images
  | 'image-output'       // Image generation - implies file-output for images
  | 'reasoning'          // Extended thinking/reasoning
  | 'structured-output'; // JSON schema support

/**
 * Model capabilities as ReadonlySet for type safety and uniqueness
 * Serialized/deserialized via superjson transformer
 * Examples:
 * - new Set(['tools', 'file-input', 'structured-output'])
 * - new Set(['image-output'])
 * - new Set(['tools', 'reasoning', 'file-input'])
 */
export type ModelCapabilities = ReadonlySet<ModelCapability>;

/**
 * Model information from provider
 */
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  capabilities?: ModelCapabilities;
}

export interface ProviderModelDetails {
  contextLength?: number;
  maxOutput?: number;
  inputPrice?: number;
  outputPrice?: number;
  supportedFeatures?: string[];
}

/**
 * Configuration field definition
 */
export interface ConfigField {
  key: string;
  label: string;
  type: 'string' | 'number' | 'boolean';
  required: boolean;
  secret?: boolean; // Whether to hide value in UI (for API keys)
  description?: string;
  placeholder?: string;
}

/**
 * Provider configuration (values)
 */
export type ProviderConfig = Record<string, string | number | boolean | undefined>;

export interface AIProvider {
  readonly id: ProviderId;
  readonly name: string;
  readonly description: string;

  /**
   * Get configuration schema for this provider
   * Defines what config fields are needed (API keys, project IDs, regions, etc)
   */
  getConfigSchema(): ConfigField[];

  /**
   * Check if provider is configured properly
   */
  isConfigured(config: ProviderConfig): boolean;

  /**
   * Fetch available models from provider
   * Uses provider config instead of just apiKey
   */
  fetchModels(config: ProviderConfig): Promise<ModelInfo[]>;

  /**
   * Get detailed information about a model
   * Should try provider API first, then fall back to models.dev
   */
  getModelDetails(modelId: string, config?: ProviderConfig): Promise<ProviderModelDetails | null>;

  /**
   * Get model capabilities
   * Returns capabilities for a specific model (tools, image support, etc)
   * Used to conditionally enable features based on model capabilities
   */
  getModelCapabilities(modelId: string): ModelCapabilities;

  /**
   * Create AI SDK client for this provider
   * Uses provider config instead of just apiKey
   */
  createClient(config: ProviderConfig, modelId: string): LanguageModelV2;
}

/**
 * Helper: Check if all required fields from schema are present in config
 * Uses camelCase format only
 */
export function hasRequiredFields(schema: ConfigField[], config: ProviderConfig): boolean {
  const requiredFields = schema.filter(f => f.required);

  for (const field of requiredFields) {
    const value = config[field.key];
    if (value === undefined || value === '') {
      return false;
    }
  }

  return true;
}
