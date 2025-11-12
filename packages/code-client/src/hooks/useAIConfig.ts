/**
 * AI Config Hook
 * Load and save AI configuration via tRPC (backend handles file system)
 */

import type { AIConfig } from "@sylphx/code-core";
import { useCallback } from "react";
import { useTRPCClient } from "../trpc-provider.js";
import { setAIConfig } from "../signals/domain/ai/index.js";
import { setError, setLoading } from "../signals/domain/ui/index.js";

export function useAIConfig() {
	const client = useTRPCClient();

	const loadConfig = useCallback(
		async () => {
			setLoading(true);
			try {
				const result = await client.config.load.query({});

				if (result.success) {
					// Use setAIConfig to trigger logic for loading defaultEnabledRuleIds and defaultAgentId
					setAIConfig(result.config);
				} else {
					// No config yet, start with empty
					setAIConfig({ providers: {} });
				}
			} catch (err) {
				console.error("[useAIConfig] Load error:", err);
				setError(err instanceof Error ? err.message : "Failed to load AI config");
			} finally {
				setLoading(false);
			}
		},
		[client],
	);

	const saveConfig = useCallback(
		async (config: AIConfig) => {
			setLoading(true);
			try {
				const result = await client.config.save.mutate({ config });

				if (result.success) {
					setAIConfig(config);
					return true;
				}
				setError(result.error || "Failed to save AI config");
				return false;
			} catch (err) {
				setError(err instanceof Error ? err.message : "Failed to save AI config");
				return false;
			} finally {
				setLoading(false);
			}
		},
		[client],
	);

	return { loadConfig, saveConfig };
}
