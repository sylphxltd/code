/**
 * Base Context Tokens Hook
 * Calculates base context tokens WITHOUT session
 *
 * ARCHITECTURE: Pure UI - server calculates, client displays
 * - Used for StatusBar display before user sends first message
 * - Shows system prompts + tools usage even without session
 * - Multi-client sync: all clients see same tokens (from server)
 *
 * WHY: User expects to see usage immediately on startup
 * - "我期望一開就會見到自己用量，而唔係只寫 256k"
 * - Even without messages, base context has fixed usage
 * - Base context = system prompts + tools
 */

import { useEffect, useState } from "react";
import { useTRPCClient } from "../trpc-provider.js";

/**
 * Calculate base context tokens for current UI state
 *
 * @param provider - Selected provider (null = not selected yet)
 * @param model - Selected model (null = not selected yet)
 * @param agentId - Selected agent ID
 * @param enabledRuleIds - Enabled rule IDs
 * @returns Base context tokens or 0 if not calculable
 */
export function useBaseContextTokens(
	provider: string | null,
	model: string | null,
	agentId: string | null,
	enabledRuleIds: string[],
): number {
	const trpc = useTRPCClient();
	const [baseContextTokens, setBaseContextTokens] = useState(0);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		// Only calculate if we have provider and model
		if (!provider || !model) {
			console.log("[useBaseContextTokens] No provider/model selected");
			setBaseContextTokens(0);
			return;
		}

		let mounted = true;

		async function fetchBaseContext() {
			try {
				setLoading(true);

				console.log("[useBaseContextTokens] Fetching for:", {
					provider,
					model,
					agentId: agentId || "coder",
					ruleCount: enabledRuleIds.length,
				});

				const result = await trpc.session.getBaseContextTokens.query({
					model,
					agentId: agentId || "coder",
					enabledRuleIds: enabledRuleIds || [],
				});

				if (mounted) {
					if (result.success) {
						console.log("[useBaseContextTokens] Success:", {
							baseContextTokens: result.baseContextTokens,
						});
						setBaseContextTokens(result.baseContextTokens);
					} else {
						console.error("[useBaseContextTokens] Failed:", result.error);
						setBaseContextTokens(0);
					}
				}
			} catch (error) {
				if (mounted) {
					console.error("[useBaseContextTokens] Error:", error);
					setBaseContextTokens(0);
				}
			} finally {
				if (mounted) {
					setLoading(false);
				}
			}
		}

		fetchBaseContext();

		return () => {
			mounted = false;
		};
	}, [trpc, provider, model, agentId, enabledRuleIds.length]);

	return baseContextTokens;
}
