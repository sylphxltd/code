/**
 * Status Bar Component
 * Display important session info at the bottom
 */

import {
	useModelDetails,
	useSelectedAgentId,
	useEnabledRuleIds,
	useBaseContextTokens,
} from "@sylphx/code-client";
import { getAgentById } from "../embedded-context.js";
import { Box, Text } from "ink";
import React from "react";

interface StatusBarProps {
	provider: string | null;
	model: string | null;
	modelStatus?: "available" | "unavailable" | "unknown";
	usedTokens?: number;
}

/**
 * StatusBar Component
 *
 * ARCHITECTURE: Client-agnostic design
 * - No hardcoded provider knowledge
 * - Uses tRPC hooks for all server communication
 * - Provider IDs are opaque strings to client
 *
 * SECURITY: Uses tRPC server endpoints for all data
 * - No API keys exposed on client side
 * - All business logic on server
 * - Safe for Web GUI and remote mode
 */
export default function StatusBar({
	provider,
	model,
	modelStatus,
	usedTokens = 0,
}: StatusBarProps) {
	// Subscribe to current agent from store (event-driven, no polling!)
	const selectedAgentId = useSelectedAgentId();
	const currentAgent = getAgentById(selectedAgentId);
	const agentName = currentAgent?.metadata.name || "";

	// Subscribe to enabled rules count
	const enabledRuleIds = useEnabledRuleIds();
	const enabledRulesCount = enabledRuleIds.length;

	// Calculate base context tokens (even without session)
	// This shows system prompts + tools usage immediately on startup
	// "我期望一開就會見到自己用量，而唔係只寫 256k"
	const baseContextTokens = useBaseContextTokens(
		provider,
		model,
		selectedAgentId,
		enabledRuleIds,
	);

	// Final used tokens: session tokens OR base context (fallback)
	// - With session: usedTokens from session.totalTokens (includes messages)
	// - Without session: baseContextTokens (system prompts + tools)
	const finalUsedTokens = usedTokens > 0 ? usedTokens : baseContextTokens;

	// DEBUG: Log props received
	console.log("[StatusBar] Props:", { provider, model, modelStatus, usedTokens });
	console.log("[StatusBar] Token calculation:", {
		usedTokens,
		baseContextTokens,
		finalUsedTokens,
	});

	// Fetch model details from server
	const { details, loading } = useModelDetails(provider, model);
	console.log("[StatusBar] Model details:", { details, loading });
	const contextLength = details.contextLength;
	const capabilities = details.capabilities;

	const formatNumber = (num: number): string => {
		if (num >= 1000000) {
			return `${(num / 1000000).toFixed(1)}M`;
		}
		if (num >= 1000) {
			return `${(num / 1000).toFixed(0)}k`;
		}
		return num.toString();
	};

	// Calculate usage percentage
	// finalUsedTokens = session.totalTokens OR base context tokens
	const usagePercent =
		contextLength && finalUsedTokens > 0
			? Math.round((finalUsedTokens / contextLength) * 100)
			: 0;

	// Handle unconfigured states
	if (!provider) {
		return (
			<Box flexGrow={1} justifyContent="space-between" marginBottom={1}>
				<Box>
					<Text dimColor>
						{agentName && `${agentName} · `}
						{enabledRulesCount} {enabledRulesCount === 1 ? "rule" : "rules"}
					</Text>
				</Box>
				<Box>
					<Text color="yellow">⚠ No AI provider selected - use /provider to select one</Text>
				</Box>
			</Box>
		);
	}

	if (!model) {
		return (
			<Box flexGrow={1} justifyContent="space-between" marginBottom={1}>
				<Box>
					<Text dimColor>
						{agentName && `${agentName} · `}
						{enabledRulesCount} {enabledRulesCount === 1 ? "rule" : "rules"} · {provider}
					</Text>
				</Box>
				<Box>
					<Text color="yellow">
						⚠ No model selected - type "/model" to select a model
					</Text>
				</Box>
			</Box>
		);
	}

	// Format capabilities with emoji
	let capabilityLabel = "";
	if (!loading && capabilities && capabilities.size > 0) {
		const caps: string[] = [];
		if (capabilities.has("image-input")) caps.push("👁️");
		if (capabilities.has("file-input")) caps.push("📎");
		if (capabilities.has("image-output")) caps.push("🎨");
		if (capabilities.has("tools")) caps.push("🔧");
		if (capabilities.has("reasoning")) caps.push("🧠");

		if (caps.length > 0) {
			capabilityLabel = ` ${caps.join("")}`;
		}
	}

	return (
		<Box flexGrow={1} justifyContent="space-between" marginBottom={1}>
			{/* Left side: Agent, Rules, Provider and Model */}
			<Box>
				<Text dimColor>
					{agentName && `${agentName} · `}
					{enabledRulesCount} {enabledRulesCount === 1 ? "rule" : "rules"} · {provider} ·{" "}
				</Text>
				<Text
					color={modelStatus === "unavailable" ? "red" : undefined}
					dimColor={modelStatus !== "unavailable"}
				>
					{model}
					{modelStatus === "unavailable" && " (unavailable)"}
				</Text>
				{capabilityLabel && <Text dimColor>{capabilityLabel}</Text>}
			</Box>

			{/* Right side: Context usage (tokenizer info moved to /context) */}
			<Box>
				{!loading && contextLength && finalUsedTokens > 0 ? (
					<Text dimColor>
						{formatNumber(finalUsedTokens)} / {formatNumber(contextLength)} ({usagePercent}%)
					</Text>
				) : null}
				{!loading && contextLength && finalUsedTokens === 0 ? (
					<Text dimColor>{formatNumber(contextLength)}</Text>
				) : null}
			</Box>
		</Box>
	);
}
