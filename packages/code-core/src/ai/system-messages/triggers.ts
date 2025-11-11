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
 * Check all triggers and return system message to insert
 * Uses TriggerRegistry to check all enabled triggers by priority
 *
 * Returns object with message and flag updates, or null if no triggers fired
 */
export async function checkAllTriggers(
  session: Session,
  messageRepository: MessageRepository,
  sessionRepository: SessionRepository,
  contextTokens?: { current: number; max: number }
): Promise<{ message: string; flagUpdates: Record<string, boolean> } | null> {
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
  const result = await triggerRegistry.checkAll(context);

  if (result) {
    console.log(`🎯 [checkAllTriggers] Trigger fired! Flag updates:`, result.flagUpdates);
    // Update session flags
    if (Object.keys(result.flagUpdates).length > 0) {
      await sessionRepository.updateSessionFlags(session.id, result.flagUpdates);
    }
  } else {
    console.log(`🎯 [checkAllTriggers] No triggers fired`);
  }

  return result;
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
