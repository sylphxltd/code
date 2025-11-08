/**
 * Normalized Model and Provider Types
 *
 * This file defines the normalized entity model for AI providers and models.
 * Key principles:
 * - Each entity has a unique ID
 * - Relationships use IDs, not nested objects
 * - Input/output capabilities are separated
 * - Complete metadata including pricing and limits
 */

/**
 * Model capabilities for input or output
 * Describes what content types the model can handle
 */
export interface ModelCapabilities {
  /** Can process/generate plain text */
  text: boolean;
  /** Can process/generate images */
  image: boolean;
  /** Can process/generate video */
  video: boolean;
  /** Can process/generate audio */
  audio: boolean;
  /** Can read files (as structured input) */
  file: boolean;
  /** Can use/call tools/functions */
  tools: boolean;
}

/**
 * Model pricing information
 * All prices in USD per 1M tokens
 */
export interface ModelPricing {
  /** Price per 1M input tokens */
  inputPer1M: number;
  /** Price per 1M output tokens */
  outputPer1M: number;
  /** Price per 1M cached input tokens (if supported) */
  cachedInputPer1M?: number;
}

/**
 * Reasoning capability level
 */
export type ReasoningCapability =
  | 'yes'   // Always provides reasoning
  | 'no'    // Never provides reasoning
  | 'auto'; // Reasoning available but optional

/**
 * Model status
 */
export type ModelStatus =
  | 'active'      // Currently available
  | 'deprecated'  // Still works but not recommended
  | 'beta';       // In testing, may be unstable

/**
 * AI Model entity
 * Represents a specific AI model (e.g., GPT-4, Claude Sonnet)
 */
export interface Model {
  /** Unique model ID (e.g., 'gpt-4', 'claude-sonnet-4') */
  id: string;

  /** Display name (e.g., 'GPT-4', 'Claude Sonnet 4') */
  name: string;

  /** Provider ID this model belongs to */
  providerId: string;

  /** Current status of the model */
  status: ModelStatus;

  /** What the model can accept as input */
  inputCapabilities: ModelCapabilities;

  /** What the model can generate as output */
  outputCapabilities: ModelCapabilities;

  /** Whether model supports reasoning/chain-of-thought */
  reasoning?: ReasoningCapability;

  /** Maximum context window in tokens */
  maxContext: number;

  /** Pricing information */
  pricing: ModelPricing;

  /** Optional description */
  description?: string;
}

/**
 * Provider status
 */
export type ProviderStatus =
  | 'active'    // Available for use
  | 'inactive'; // Temporarily unavailable

/**
 * AI Provider entity
 * Represents an AI service provider (e.g., OpenAI, Anthropic)
 */
export interface Provider {
  /** Unique provider ID (e.g., 'openai', 'anthropic', 'openrouter') */
  id: string;

  /** Display name (e.g., 'OpenAI', 'Anthropic', 'OpenRouter') */
  name: string;

  /** Current status of the provider */
  status: ProviderStatus;

  /** Whether this provider requires an API key */
  apiKeyRequired: boolean;

  /** List of model IDs available from this provider */
  modelIds: string[];

  /** Optional description */
  description?: string;

  /** Optional website URL */
  website?: string;
}

/**
 * Helper type for model with its provider information
 * Used for display purposes
 */
export interface ModelWithProvider extends Model {
  provider: Provider;
}
