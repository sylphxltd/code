/**
 * Session Token Calculator
 * Calculates base context tokens (system prompt + tools)
 *
 * ARCHITECTURE: Dynamic calculation (NO database cache)
 * - Uses Hugging Face tokenizer for accurate counting
 * - Calculates in real-time on demand (not cached)
 * - Server-side only (never runs on client)
 *
 * RATIONALE: Why no caching?
 * - Agent can change mid-session → system prompt changes
 * - Rules can change mid-session → system prompt changes
 * - Model can change mid-session → tokenizer changes (different counts for same text)
 * - All token calculations must be dynamic to reflect current state
 *
 * CRITICAL: Token calculation must use MODEL messages (via buildModelMessages)
 * - Session messages = database storage format
 * - Model messages = actual AI SDK format sent to model
 * - Model messages include: system message injection, file loading, format conversion
 * - Only model messages reflect actual context usage
 */

import { countTokens } from "../utils/token-counter.js";
import { buildSystemPrompt } from "./system-prompt-builder.js";
import { loadAllAgents } from "./agent-loader.js";
import { loadAllRules } from "./rule-loader.js";
import { getAISDKTools } from "../tools/registry.js";

/**
 * Calculate base context tokens (system prompt + tools)
 * Called dynamically on demand (no caching)
 */
export async function calculateBaseContextTokens(
	modelName: string,
	agentId: string,
	enabledRuleIds: string[],
	cwd: string,
): Promise<number> {
	// Load agent and rules
	const allAgents = await loadAllAgents(cwd);
	const allRules = await loadAllRules(cwd);
	const enabledRules = allRules.filter((rule) => enabledRuleIds.includes(rule.id));

	// Build system prompt
	const systemPrompt = buildSystemPrompt(agentId, allAgents, enabledRules);
	const systemPromptTokens = await countTokens(systemPrompt, modelName);

	// Calculate tools tokens
	const tools = getAISDKTools();
	let toolsTokens = 0;

	for (const [toolName, toolDef] of Object.entries(tools)) {
		const toolRepresentation = {
			name: toolName,
			description: toolDef.description || "",
			parameters: toolDef.parameters || {},
		};
		const toolJson = JSON.stringify(toolRepresentation, null, 0);
		const tokens = await countTokens(toolJson, modelName);
		toolsTokens += tokens;
	}

	return systemPromptTokens + toolsTokens;
}

