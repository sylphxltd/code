/**
 * Embedded Context Helpers
 * Temporary bridge to access embedded server's AppContext
 *
 * TEMPORARY: These functions are a compatibility layer for the TUI.
 * They will be replaced with proper tRPC calls in the future.
 */

import type { CodeServer } from "@sylphx/code-server";
import type { Agent, Rule } from "@sylphx/code-core";
import { $enabledRuleIds, get } from "@sylphx/code-client";

let embeddedServerInstance: CodeServer | null = null;

/**
 * Set the embedded server instance
 * Called once during TUI initialization
 */
export function setEmbeddedServer(server: CodeServer): void {
	embeddedServerInstance = server;
}

/**
 * Get all available agents
 */
export function getAllAgents(): Agent[] {
	if (!embeddedServerInstance) {
		throw new Error("Embedded server not initialized");
	}
	return embeddedServerInstance.getAppContext().agentManager.getAll();
}

/**
 * Get agent by ID
 */
export function getAgentById(id: string): Agent | null {
	if (!embeddedServerInstance) {
		throw new Error("Embedded server not initialized");
	}
	return embeddedServerInstance.getAppContext().agentManager.getById(id);
}

// REMOVED: getCurrentAgent - use useAppStore.getState().selectedAgentId + getAgentById
// REMOVED: switchAgent - use useAppStore.getState().setSelectedAgent

/**
 * Get all available rules
 */
export function getAllRules(): Rule[] {
	if (!embeddedServerInstance) {
		throw new Error("Embedded server not initialized");
	}
	return embeddedServerInstance.getAppContext().ruleManager.getAll();
}

/**
 * Get rule by ID
 */
export function getRuleById(id: string): Rule | null {
	if (!embeddedServerInstance) {
		throw new Error("Embedded server not initialized");
	}
	return embeddedServerInstance.getAppContext().ruleManager.getById(id);
}

/**
 * Get enabled rule IDs from zen signals
 */
export function getEnabledRuleIds(): string[] {
	return get($enabledRuleIds);
}

/**
 * Set enabled rules in zen signals and persist
 * UNIFIED ARCHITECTURE: Always updates both global AND session (if exists)
 * - Global: To predict user's future preferences
 * - Session: To apply immediately to current conversation
 * - Old sessions: Never affected
 */
export async function setEnabledRules(ruleIds: string[]): Promise<boolean> {
	const {
		setGlobalEnabledRules,
		updateSessionRules,
		getCurrentSessionId,
	} = require("@sylphx/code-client");

	// 1. Update global default (always)
	await setGlobalEnabledRules(ruleIds);

	// 2. Update current session if exists
	const currentSessionId = getCurrentSessionId();
	if (currentSessionId) {
		await updateSessionRules(currentSessionId, ruleIds);
	}

	return true;
}

/**
 * Toggle a rule on/off
 * UNIFIED ARCHITECTURE: Always updates both global AND session (if exists)
 */
export async function toggleRule(ruleId: string): Promise<boolean> {
	const rule = getRuleById(ruleId);
	if (!rule) {
		return false;
	}

	const {
		setGlobalEnabledRules,
		updateSessionRules,
		getCurrentSessionId,
	} = require("@sylphx/code-client");
	const currentEnabled = getEnabledRuleIds();

	const newRuleIds = currentEnabled.includes(ruleId)
		? currentEnabled.filter((id) => id !== ruleId) // Disable: remove from list
		: [...currentEnabled, ruleId]; // Enable: add to list

	// 1. Update global default (always)
	await setGlobalEnabledRules(newRuleIds);

	// 2. Update current session if exists
	const currentSessionId = getCurrentSessionId();
	if (currentSessionId) {
		await updateSessionRules(currentSessionId, newRuleIds);
	}

	return true;
}
