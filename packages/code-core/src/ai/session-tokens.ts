/**
 * Session Token Calculator
 * Calculates and updates token counts for sessions
 *
 * ARCHITECTURE: Server-side only
 * - Uses Hugging Face tokenizer for accurate counting
 * - Calculates baseContextTokens on session creation
 * - Updates totalTokens after each message
 * - Never runs on client (pure UI)
 */

import type { SessionRepository } from "../database/session-repository.js";
import type { ProviderId } from "../config/ai-config.js";
import { countTokens } from "../utils/token-counter.js";
import { buildSystemPrompt } from "./system-prompt-builder.js";
import { loadAllAgents } from "./agent-loader.js";
import { loadAllRules } from "./rule-loader.js";
import { getAISDKTools } from "../tools/registry.js";
import type { SessionMessage } from "../types/session.types.js";

/**
 * Calculate base context tokens (system prompt + tools)
 * Called once on session creation
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

/**
 * Calculate message tokens
 * Converts message parts to text and counts tokens
 */
async function calculateMessageTokens(
	message: SessionMessage,
	modelName: string,
): Promise<number> {
	let totalTokens = 0;

	for (const step of message.steps) {
		for (const part of step.parts) {
			if (part.type === "text") {
				const tokens = await countTokens(part.content, modelName);
				totalTokens += tokens;
			} else if (part.type === "file" && "base64" in part) {
				// File content is frozen as base64, decode and count
				try {
					const content = Buffer.from(part.base64, "base64").toString("utf-8");
					const tokens = await countTokens(content, modelName);
					totalTokens += tokens;
				} catch {
					// Skip invalid file content
				}
			} else if (part.type === "file-ref") {
				// File-ref: read from file_contents table
				// For now, skip (requires repository access)
				// TODO: Add file content reading if needed
			}
		}
	}

	return totalTokens;
}

/**
 * Calculate total tokens for session (base + all messages)
 * Called after each message is added
 */
export async function calculateTotalTokens(
	sessionId: string,
	sessionRepository: SessionRepository,
): Promise<{ baseContextTokens: number; totalTokens: number }> {
	// Get session to access model and messages
	const session = await sessionRepository.getSessionById(sessionId);
	if (!session) {
		throw new Error(`Session ${sessionId} not found`);
	}

	// If baseContextTokens not calculated yet, calculate it now
	let baseContextTokens = session.baseContextTokens || 0;
	if (baseContextTokens === 0) {
		const cwd = process.cwd();
		baseContextTokens = await calculateBaseContextTokens(
			session.model,
			session.agentId,
			session.enabledRuleIds,
			cwd,
		);
	}

	// Calculate messages tokens
	let messagesTokens = 0;
	for (const message of session.messages) {
		const tokens = await calculateMessageTokens(message, session.model);
		messagesTokens += tokens;
	}

	const totalTokens = baseContextTokens + messagesTokens;

	return { baseContextTokens, totalTokens };
}

/**
 * Update session tokens after message is added
 * Called automatically by streaming service after each message
 */
export async function updateSessionTokens(
	sessionId: string,
	sessionRepository: SessionRepository,
): Promise<void> {
	const tokens = await calculateTotalTokens(sessionId, sessionRepository);
	await sessionRepository.updateSessionTokens(sessionId, tokens);
}
