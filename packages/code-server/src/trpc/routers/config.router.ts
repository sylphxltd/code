/**
 * Config Router
 * Backend-only configuration management (file system access)
 * REACTIVE: Emits events for all state changes
 * SECURITY: Protected mutations (OWASP API2) + Rate limiting (OWASP API4)
 */

import { z } from "zod";
import { router, publicProcedure, moderateProcedure } from "../trpc.js";
import {
	loadAIConfig,
	saveAIConfig,
	getAIConfigPaths,
	getProvider,
	AI_PROVIDERS,
	fetchModels,
	getTokenizerInfo,
	countTokens,
	scanProjectFiles,
	PROVIDER_REGISTRY,
} from "@sylphx/code-core";
import type { AIConfig, ProviderId } from "@sylphx/code-core";

/**
 * Provider ID schema - use flexible string instead of strict enum
 * Reason: Provider registry can be extended dynamically, and hardcoded enums
 * cause validation failures when new providers are added to config files
 */
const AIConfigSchema = z.object({
	defaultProvider: z.string().optional(), // Any provider ID (validated at runtime by getProvider)
	defaultEnabledRuleIds: z.array(z.string()).optional(), // Global default rules
	defaultAgentId: z.string().optional(), // Remember last selected agent
	providers: z
		.record(
			z.string(),
			z
				.object({
					defaultModel: z.string().optional(),
				})
				.passthrough(),
		)
		.optional(),
});

/**
 * Sanitize AI config by REMOVING sensitive fields
 * SECURITY: Uses provider ConfigField schema to determine which fields are secret
 *
 * Client should NEVER see secret fields (not even masked)
 * - Prevents XSS from stealing key prefixes
 * - Zero-knowledge: client doesn't need keys, server does
 * - Server merges keys from disk during save operations
 *
 * @param config - Raw config from file system
 * @returns Sanitized config with secret fields REMOVED (not masked)
 */
function sanitizeAIConfig(config: AIConfig): AIConfig {
	if (!config.providers) {
		return config;
	}

	const sanitizedProviders: Record<string, any> = {};

	for (const [providerId, providerConfig] of Object.entries(config.providers)) {
		const sanitizedProvider: Record<string, any> = {};

		// Get provider schema to know which fields are secret
		let secretFields: Set<string>;
		try {
			const provider = getProvider(providerId as ProviderId);
			const configSchema = provider.getConfigSchema();
			// Extract field keys marked as secret
			secretFields = new Set(
				configSchema.filter((field) => field.secret === true).map((field) => field.key),
			);
		} catch (error) {
			// Fallback: if provider not found, remove nothing (better than breaking)
			console.warn(`Provider ${providerId} not found for config sanitization`);
			secretFields = new Set();
		}

		for (const [fieldName, fieldValue] of Object.entries(providerConfig)) {
			if (secretFields.has(fieldName)) {
				// REMOVE secret field entirely (don't send to client)
				// Server will merge it back from disk during save
				continue;
			} else {
				// Keep non-secret field as-is
				sanitizedProvider[fieldName] = fieldValue;
			}
		}

		sanitizedProviders[providerId] = sanitizedProvider;
	}

	return {
		...config,
		providers: sanitizedProviders,
	};
}

export const configRouter = router({
	/**
	 * Load AI config from file system
	 * Backend reads files, UI stays clean
	 *
	 * SECURITY: Removes sensitive fields (API keys) before returning to client
	 * - API keys REMOVED entirely (not masked)
	 * - Client never sees keys (zero-knowledge)
	 * - Server merges keys from disk during save operations
	 * - Non-sensitive fields (provider, model) returned as-is
	 */
	load: publicProcedure
		.input(z.object({ cwd: z.string().default(process.cwd()) }))
		.query(async ({ input }) => {
			const result = await loadAIConfig(input.cwd);
			if (result.success) {
				// Sanitize config: REMOVE sensitive fields
				const sanitizedConfig = sanitizeAIConfig(result.data);
				return { success: true as const, config: sanitizedConfig };
			}
			// No config yet - return empty
			return { success: true as const, config: { providers: {} } };
		}),

	/**
	 * Update default provider
	 * REACTIVE: Emits config:default-provider-updated event
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 */
	updateDefaultProvider: moderateProcedure
		.input(
			z.object({
				provider: z.string(), // Any provider ID (validated at runtime)
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await loadAIConfig(input.cwd);
			if (!result.success) {
				return { success: false as const, error: result.error.message };
			}

			const updated = { ...result.data, defaultProvider: input.provider };
			const saveResult = await saveAIConfig(updated, input.cwd);

			if (saveResult.success) {
				return { success: true as const };
			}
			return { success: false as const, error: saveResult.error.message };
		}),

	/**
	 * Update default model
	 * REACTIVE: Emits config:default-model-updated event
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 */
	updateDefaultModel: moderateProcedure
		.input(
			z.object({
				model: z.string(),
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await loadAIConfig(input.cwd);
			if (!result.success) {
				return { success: false as const, error: result.error.message };
			}

			const updated = { ...result.data, defaultModel: input.model };
			const saveResult = await saveAIConfig(updated, input.cwd);

			if (saveResult.success) {
				return { success: true as const };
			}
			return { success: false as const, error: saveResult.error.message };
		}),

	/**
	 * Update provider configuration
	 * REACTIVE: Emits config:provider-updated or config:provider-added event
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 *
	 * ZERO-KNOWLEDGE: Client never sends secrets
	 * - Client only sends non-secret fields (model, etc)
	 * - Server auto-merges ALL secret fields from disk
	 * - To update secrets, use dedicated setProviderSecret mutation
	 */
	updateProviderConfig: moderateProcedure
		.input(
			z.object({
				providerId: z.string(),
				config: z.record(z.any()), // Provider-specific config (non-secrets only)
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await loadAIConfig(input.cwd);
			if (!result.success) {
				return { success: false as const, error: result.error.message };
			}

			const isNewProvider = !result.data.providers?.[input.providerId];
			const currentProviderConfig = result.data.providers?.[input.providerId] || {};
			const mergedProviderConfig: Record<string, any> = { ...input.config };

			// Always merge ALL secret fields from disk (client never sends them)
			try {
				const provider = getProvider(input.providerId as ProviderId);
				const configSchema = provider.getConfigSchema();
				const secretFields = new Set(
					configSchema.filter((field) => field.secret === true).map((field) => field.key),
				);

				// Preserve all secrets from disk
				for (const fieldName of secretFields) {
					const currentValue = currentProviderConfig[fieldName];
					if (currentValue !== undefined) {
						mergedProviderConfig[fieldName] = currentValue;
					}
				}
			} catch (error) {
				console.warn(`Provider ${input.providerId} not found during config merge`);
			}

			const updated = {
				...result.data,
				providers: {
					...result.data.providers,
					[input.providerId]: mergedProviderConfig,
				},
			};

			const saveResult = await saveAIConfig(updated, input.cwd);

			if (saveResult.success) {
				// Note: Config changes are persisted in database
				return { success: true as const };
			}
			return { success: false as const, error: saveResult.error.message };
		}),

	/**
	 * Set a provider secret field (API key, token, etc)
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 *
	 * Dedicated endpoint for updating secrets
	 * - Client can set new secret without seeing existing value
	 * - Follows GitHub/Vercel pattern: blind update
	 * - Only way to update secret fields
	 */
	setProviderSecret: moderateProcedure
		.input(
			z.object({
				providerId: z.string(),
				fieldName: z.string(),
				value: z.string(),
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await loadAIConfig(input.cwd);
			if (!result.success) {
				return { success: false as const, error: result.error.message };
			}

			// Verify field is actually a secret field
			try {
				const provider = getProvider(input.providerId as ProviderId);
				const configSchema = provider.getConfigSchema();
				const field = configSchema.find((f) => f.key === input.fieldName);

				if (!field) {
					return {
						success: false as const,
						error: `Field ${input.fieldName} not found in provider ${input.providerId} schema`,
					};
				}

				if (!field.secret) {
					return {
						success: false as const,
						error: `Field ${input.fieldName} is not a secret field. Use updateProviderConfig instead.`,
					};
				}
			} catch (error) {
				return {
					success: false as const,
					error: `Provider ${input.providerId} not found`,
				};
			}

			// Update the secret field
			const currentProviderConfig = result.data.providers?.[input.providerId] || {};
			const updatedProviderConfig = {
				...currentProviderConfig,
				[input.fieldName]: input.value,
			};

			const updated = {
				...result.data,
				providers: {
					...result.data.providers,
					[input.providerId]: updatedProviderConfig,
				},
			};

			const saveResult = await saveAIConfig(updated, input.cwd);

			if (saveResult.success) {
				return { success: true as const };
			}
			return { success: false as const, error: saveResult.error.message };
		}),

	/**
	 * Remove provider configuration
	 * REACTIVE: Emits config:provider-removed event
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 */
	removeProvider: moderateProcedure
		.input(
			z.object({
				providerId: z.string(),
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ input }) => {
			const result = await loadAIConfig(input.cwd);
			if (!result.success) {
				return { success: false as const, error: result.error.message };
			}

			const providers = { ...result.data.providers };
			delete providers[input.providerId];

			const updated = { ...result.data, providers };
			const saveResult = await saveAIConfig(updated, input.cwd);

			if (saveResult.success) {
				return { success: true as const };
			}
			return { success: false as const, error: saveResult.error.message };
		}),

	/**
	 * Save AI config to file system
	 * Backend writes files, UI stays clean
	 * REACTIVE: Emits config-updated event
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 *
	 * ZERO-KNOWLEDGE: Client never sends secrets
	 * - Client only sends non-secret fields
	 * - Server auto-merges ALL secret fields from disk
	 * - To update secrets, use dedicated setProviderSecret mutation
	 */
	save: moderateProcedure
		.input(
			z.object({
				config: AIConfigSchema,
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ input }) => {
			// Load current config from disk to get secrets
			const currentResult = await loadAIConfig(input.cwd);
			const currentConfig = currentResult.success ? currentResult.data : { providers: {} };

			// Merge incoming config with current config
			// Always preserve ALL secret fields from disk
			const mergedConfig = { ...input.config };

			if (input.config.providers && currentConfig.providers) {
				const mergedProviders: Record<string, any> = {};

				for (const [providerId, incomingProviderConfig] of Object.entries(input.config.providers)) {
					const currentProviderConfig = currentConfig.providers[providerId] || {};
					const mergedProviderConfig: Record<string, any> = {
						...incomingProviderConfig,
					};

					// Get provider schema to identify secret fields
					try {
						const provider = getProvider(providerId as ProviderId);
						const configSchema = provider.getConfigSchema();
						const secretFields = new Set(
							configSchema.filter((field) => field.secret === true).map((field) => field.key),
						);

						// Preserve ALL secrets from disk (client never sends them)
						for (const fieldName of secretFields) {
							const currentValue = currentProviderConfig[fieldName];
							if (currentValue !== undefined) {
								mergedProviderConfig[fieldName] = currentValue;
							}
						}
					} catch (error) {
						// Provider not found - just use incoming config as-is
						console.warn(`Provider ${providerId} not found during config merge`);
					}

					mergedProviders[providerId] = mergedProviderConfig;
				}

				mergedConfig.providers = mergedProviders;
			}

			const result = await saveAIConfig(mergedConfig, input.cwd);
			if (result.success) {
				// Note: Config changes are persisted in database
				return { success: true as const };
			}
			return { success: false as const, error: result.error.message };
		}),

	/**
	 * Get config file paths
	 * Useful for debugging
	 */
	getPaths: publicProcedure
		.input(z.object({ cwd: z.string().default(process.cwd()) }))
		.query(async ({ input }) => {
			return getAIConfigPaths(input.cwd);
		}),

	/**
	 * Get all available providers
	 * Returns provider metadata (id, name, description, isConfigured)
	 * SECURITY: No sensitive data exposed
	 */
	getProviders: publicProcedure
		.input(z.object({ cwd: z.string().default(process.cwd()) }).optional())
		.query(async ({ input }) => {
			const cwd = input?.cwd || process.cwd();
			const configResult = await loadAIConfig(cwd);

			// Handle Result type
			if (!configResult.success) {
				throw new Error("Failed to load AI config");
			}

			const config = configResult.data;

			const providersWithStatus: Record<
				string,
				{
					id: string;
					name: string;
					description: string;
					isConfigured: boolean;
				}
			> = {};

			for (const [id, providerInfo] of Object.entries(AI_PROVIDERS)) {
				const provider = getProvider(id as ProviderId);
				const providerConfig = config.providers?.[id] || {};
				const isConfigured = provider.isConfigured(providerConfig);

				providersWithStatus[id] = {
					id,
					name: providerInfo.name,
					description: providerInfo.description,
					isConfigured,
				};
			}

			return providersWithStatus;
		}),

	/**
	 * Get provider config schema
	 * Returns the configuration fields required for a provider
	 * SECURITY: No sensitive data - just schema definition
	 */
	getProviderSchema: publicProcedure
		.input(
			z.object({
				providerId: z.string(),
			}),
		)
		.query(({ input }) => {
			try {
				const provider = getProvider(input.providerId);
				const schema = provider.getConfigSchema();
				return { success: true as const, schema };
			} catch (error) {
				return {
					success: false as const,
					error: error instanceof Error ? error.message : "Failed to get provider schema",
				};
			}
		}),

	/**
	 * Fetch available models for a provider
	 * SECURITY: Requires provider config (API keys if needed)
	 */
	fetchModels: publicProcedure
		.input(
			z.object({
				providerId: z.string(),
				cwd: z.string().default(process.cwd()),
			}),
		)
		.query(async ({ input }) => {
			try {
				// Load config to get provider credentials
				const configResult = await loadAIConfig(input.cwd);
				const providerConfig = configResult.success
					? configResult.data.providers?.[input.providerId] || {}
					: {};

				// Fetch models using provider API
				const models = await fetchModels(input.providerId, providerConfig);
				return { success: true as const, models };
			} catch (error) {
				return {
					success: false as const,
					error: error instanceof Error ? error.message : "Failed to fetch models",
				};
			}
		}),

	/**
	 * Get tokenizer info for a model
	 * Returns tokenizer name and status
	 */
	getTokenizerInfo: publicProcedure
		.input(
			z.object({
				model: z.string(),
			}),
		)
		.query(({ input }) => {
			return getTokenizerInfo(input.model);
		}),

	/**
	 * Count tokens for text
	 * Uses model-specific tokenizer
	 */
	countTokens: publicProcedure
		.input(
			z.object({
				text: z.string(),
				model: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			const count = await countTokens(input.text, input.model);
			return { count };
		}),

	/**
	 * Count tokens for file
	 * Reads file from disk and counts tokens using model-specific tokenizer
	 * ARCHITECTURE: Server reads file, client should never read files directly
	 */
	countFileTokens: publicProcedure
		.input(
			z.object({
				filePath: z.string(),
				model: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			const { readFile } = await import("node:fs/promises");
			try {
				const content = await readFile(input.filePath, "utf8");
				const count = await countTokens(content, input.model);
				return { success: true as const, count };
			} catch (error) {
				return {
					success: false as const,
					error: error instanceof Error ? error.message : "Failed to read file",
				};
			}
		}),

	/**
	 * Scan project files
	 * Returns filtered file list
	 */
	scanProjectFiles: publicProcedure
		.input(
			z.object({
				cwd: z.string().default(process.cwd()),
				query: z.string().optional(),
			}),
		)
		.query(async ({ input }) => {
			const files = await scanProjectFiles(input.cwd, input.query);
			return { files };
		}),

	/**
	 * Update enabled rules
	 * SERVER DECIDES: If sessionId provided → session table, else → global config
	 * MULTI-CLIENT SYNC: Changes propagate to all clients via event stream
	 * SECURITY: Protected + moderate rate limiting (30 req/min)
	 *
	 * Pure UI Client: Client doesn't decide where to persist, server does
	 */
	updateRules: moderateProcedure
		.input(
			z.object({
				ruleIds: z.array(z.string()),
				sessionId: z.string().optional(), // If provided → session-specific, else → global
				cwd: z.string().default(process.cwd()),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.sessionId) {
				// Session-specific rules → persist to session table
				await ctx.sessionRepository.updateSession(input.sessionId, {
					enabledRuleIds: input.ruleIds,
				});
				return { success: true as const, scope: "session" as const };
			} else {
				// Global rules → persist to config file
				const result = await loadAIConfig(input.cwd);
				if (!result.success) {
					return { success: false as const, error: result.error.message };
				}

				const updated = {
					...result.data,
					defaultEnabledRuleIds: input.ruleIds,
				};
				const saveResult = await saveAIConfig(updated, input.cwd);

				if (saveResult.success) {
					return { success: true as const, scope: "global" as const };
				}
				return { success: false as const, error: saveResult.error.message };
			}
		}),

	/**
	 * Get model details (context length, pricing, capabilities, etc.)
	 * SECURITY: No API keys needed - uses hardcoded metadata
	 */
	getModelDetails: publicProcedure
		.input(
			z.object({
				providerId: z.string(),
				modelId: z.string(),
				cwd: z.string().default(process.cwd()),
			}),
		)
		.query(async ({ input }) => {
			try {
				const provider = getProvider(input.providerId);

				// Get model details and capabilities
				const details = await provider.getModelDetails(input.modelId);
				const capabilities = provider.getModelCapabilities(input.modelId);

				return {
					success: true as const,
					details: {
						...details,
						capabilities,
					},
				};
			} catch (error) {
				return {
					success: false as const,
					error: error instanceof Error ? error.message : "Failed to get model details",
				};
			}
		}),

	// Note: Config changes are persisted in database and loaded on demand
});
