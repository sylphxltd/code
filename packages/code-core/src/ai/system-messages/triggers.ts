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
    console.log('[Triggers] Registered', triggerRegistry.getAll().length, 'triggers');
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

  console.log(`🎯 [checkAllTriggers] Session ${session.id.substring(0, 8)}... current flags:`, session.flags);

  // Build trigger context
  const context: TriggerContext = {
    session,
    messageRepository,
    contextTokens,
  };

  // Check all triggers (registry handles priority)
  const results = await triggerRegistry.checkAll(context);

  if (results.length > 0) {
    console.log(`🎯 [checkAllTriggers] ${results.length} trigger(s) fired!`);

    // Merge all flag updates and apply them once
    const mergedFlagUpdates: Record<string, boolean> = {};
    for (const result of results) {
      Object.assign(mergedFlagUpdates, result.flagUpdates);
    }

    console.log(`🎯 [checkAllTriggers] Merged flag updates:`, mergedFlagUpdates);

    // Update session flags once with all changes
    if (Object.keys(mergedFlagUpdates).length > 0) {
      await sessionRepository.updateSessionFlags(session.id, mergedFlagUpdates);
    }
  } else {
    console.log(`🎯 [checkAllTriggers] No triggers fired`);
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

  console.log(`[Triggers] Inserted system message ${messageId.substring(0, 8)}...`);
  return messageId;
}

/**
 * Export registry for advanced usage (enable/disable triggers, etc.)
 */
export { triggerRegistry } from './registry.js';
