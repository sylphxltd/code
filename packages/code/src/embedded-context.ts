/**
 * Embedded Context Helpers
 * Temporary bridge to access embedded server's AppContext
 *
 * TEMPORARY: These functions are a compatibility layer for the TUI.
 * They will be replaced with proper tRPC calls in the future.
 */

import type { CodeServer } from '@sylphx/code-server';
import type { Agent, Rule } from '@sylphx/code-core';
import { $enabledRuleIds, get } from '@sylphx/code-client';

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
    throw new Error('Embedded server not initialized');
  }
  return embeddedServerInstance.getAppContext().agentManager.getAll();
}

/**
 * Get agent by ID
 */
export function getAgentById(id: string): Agent | null {
  if (!embeddedServerInstance) {
    throw new Error('Embedded server not initialized');
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
    throw new Error('Embedded server not initialized');
  }
  return embeddedServerInstance.getAppContext().ruleManager.getAll();
}

/**
 * Get rule by ID
 */
export function getRuleById(id: string): Rule | null {
  if (!embeddedServerInstance) {
    throw new Error('Embedded server not initialized');
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
 * Set enabled rules in zen signals and persist to session
 */
export async function setEnabledRules(ruleIds: string[]): Promise<boolean> {
  const { setEnabledRuleIds } = require('@sylphx/code-client');
  await setEnabledRuleIds(ruleIds);
  return true;
}

/**
 * Toggle a rule on/off
 * Updates zen signals and persists to session
 */
export async function toggleRule(ruleId: string): Promise<boolean> {
  const rule = getRuleById(ruleId);
  if (!rule) {
    return false;
  }

  const { useEnabledRuleIds, setEnabledRuleIds } = require('@sylphx/code-client');
  const currentEnabled = useEnabledRuleIds();

  if (currentEnabled.includes(ruleId)) {
    // Disable: remove from list
    await setEnabledRuleIds(currentEnabled.filter(id => id !== ruleId));
  } else {
    // Enable: add to list
    await setEnabledRuleIds([...currentEnabled, ruleId]);
  }

  return true;
}
