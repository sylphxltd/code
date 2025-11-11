/**
 * System Message Triggers
 * Main entry point for checking and inserting system messages
 *
 * Architecture:
 * - Uses TriggerRegistry for managing triggers
 * - Each trigger returns message + flag updates
 * - Flags stored in session.flags for state tracking
 * - Bidirectional notifications (enter + exit states)
 */

import type { SessionRepository } from '../../database/session-repository.js';
import type { MessageRepository } from '../../database/message-repository.js';
import { registerBuiltinTriggers } from './builtin-triggers.js';
import { triggerRegistry } from './registry.js';
import type { TriggerContext } from './registry.js';

/**
 * Initialize trigger system (call once at startup)
 */
let triggersInitialized = false;

export function initializeTriggers(): void {
  if (!triggersInitialized) {
    registerBuiltinTriggers();
    triggersInitialized = true;
  }
}

/**
 * Check all triggers and return system messages to insert
 * Uses TriggerRegistry to check all enabled triggers by priority
 *
 * Returns array of results with messages and flag updates
 */
export async function checkAllTriggers(
  session: Session,
  messageRepository: MessageRepository,
  sessionRepository: SessionRepository,
  contextTokens?: { current: number; max: number }
): Promise<Array<{ message: string; flagUpdates: Record<string, boolean> }>> {
  // Ensure triggers are initialized
  initializeTriggers();

  // Build trigger context
  const context: TriggerContext = {
    session,
    messageRepository,
    contextTokens,
  };

  // Check all triggers (registry handles priority)
  const results = await triggerRegistry.checkAll(context);

  if (results.length > 0) {
    // Merge all flag updates and apply them once
    const mergedFlagUpdates: Record<string, boolean> = {};
    for (const result of results) {
      Object.assign(mergedFlagUpdates, result.flagUpdates);
    }

    // Update session flags once with all changes
    if (Object.keys(mergedFlagUpdates).length > 0) {
      await sessionRepository.updateSessionFlags(session.id, mergedFlagUpdates);
    }
  }

  return results;
}

/**
 * Insert system message into session
 * Creates a 'system' role message with the provided content
 */
export async function insertSystemMessage(
  messageRepository: MessageRepository,
  sessionId: string,
  content: string
): Promise<string> {
  const messageId = await messageRepository.addMessage({
    sessionId,
    role: 'system',
    content: [{ type: 'text', content, status: 'completed' }],
    status: 'completed',
  });

  return messageId;
}

/**
 * Export registry for advanced usage (enable/disable triggers, etc.)
 */
export { triggerRegistry } from './registry.js';
