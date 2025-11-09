/**
 * Settings Domain Signals
 * Manages user settings (agent selection, enabled rules)
 */

import { zen, get, set } from '@sylphx/zen';
import { useStore } from '@sylphx/zen-react';
import { getTRPCClient } from '../../../trpc-provider.js';
import { eventBus } from '../../../lib/event-bus.js';
import * as ai from '../ai/index.js';
import * as session from '../session/index.js';

// Core settings signals
export const $selectedAgentId = zen<string>('coder');
export const $enabledRuleIds = zen<string[]>([]);

// Actions
export const setSelectedAgent = async (agentId: string) => {
  // Update client state immediately (optimistic)
  set($selectedAgentId, agentId);

  // Persist to global config (remember last selected agent)
  const config = get(ai.$aiConfig);
  if (config) {
    const client = getTRPCClient();
    await client.config.save.mutate({
      config: {
        ...config,
        defaultAgentId: agentId,
      },
    });

    // Update AI config cache
    set(ai.$aiConfig, {
      ...config,
      defaultAgentId: agentId,
    });
  }
};

export const setEnabledRuleIds = async (ruleIds: string[], sessionId?: string | null) => {
  // Update client state immediately (optimistic)
  set($enabledRuleIds, ruleIds);

  // Call server endpoint - SERVER decides where to persist
  const client = getTRPCClient();
  await client.config.updateRules.mutate({
    ruleIds,
    sessionId: sessionId || undefined,
  });
};

// Hooks for React components
export const useSelectedAgentId = () => useStore($selectedAgentId);
export const useEnabledRuleIds = () => useStore($enabledRuleIds);

// Setup event listeners
eventBus.on('session:changed', ({ sessionId }: { sessionId: string | null }) => {
  // Clear enabled rules when no session
  if (!sessionId) {
    set($enabledRuleIds, []);
  }
});

eventBus.on('session:created', ({ enabledRuleIds }: { enabledRuleIds: string[] }) => {
  // Update settings with new session's rules
  set($enabledRuleIds, enabledRuleIds);
});

eventBus.on('session:loaded', ({ enabledRuleIds }: { enabledRuleIds: string[] }) => {
  // Update settings when session loaded from server
  set($enabledRuleIds, enabledRuleIds);
});

eventBus.on('session:rulesUpdated', ({ enabledRuleIds }: { enabledRuleIds: string[] }) => {
  // Update settings when current session's rules change
  set($enabledRuleIds, enabledRuleIds);
});