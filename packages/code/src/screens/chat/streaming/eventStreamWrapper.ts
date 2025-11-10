/**
 * Event Stream Callback Wrapper
 * Handles deduplication and optional debug logging
 */

import type React from 'react';
import type { StreamEvent } from '@sylphx/code-server';
import { handleStreamEvent } from './streamEventHandlers.js';
import { shouldSkipEventStreamEvent } from './streamingSource.js';
import type { EventContextParams } from './eventContextBuilder.js';
import { buildEventContext } from './eventContextBuilder.js';

const DEBUG_EVENT_STREAM = true; // Toggle for debugging

function logToFile(message: string) {
  console.log(`🔍 ${message}`);
}

/**
 * Wrap event stream callback with deduplication
 * Skips events if this specific message is being handled by direct subscription
 *
 * ARCHITECTURE: Message-specific deduplication
 * - For assistant-message-created: extracts messageId from event
 * - For other events: uses streamingMessageIdRef.current (set by assistant-message-created)
 * - Checks if message ID is in the direct subscription Set
 * - If yes → skip (avoid duplicate from direct subscription)
 * - If no → process (compact auto-trigger, other clients, or different message)
 */
export function wrapEventStreamCallback<TArgs extends any[]>(
  eventType: string,
  streamingMessageIdRef: React.MutableRefObject<string | null>,
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>,
  contextParams: EventContextParams,
  eventBuilder: (...args: TArgs) => StreamEvent
) {
  return (...args: TArgs) => {
    // Build event first
    const event = eventBuilder(...args);

    // Extract messageId based on event type
    // - assistant-message-created: has messageId in event
    // - all other events: use streamingMessageIdRef (set by assistant-message-created)
    const messageId = event.type === 'assistant-message-created'
      ? event.messageId
      : streamingMessageIdRef.current;

    if (DEBUG_EVENT_STREAM) {
      logToFile(`[EventStream] ${eventType} - messageId: ${messageId}, directSubscriptionSet: [${Array.from(directSubscriptionMessageIdsRef.current).join(', ')}]`);
    }

    // Skip if this specific message is being handled by direct subscription
    if (shouldSkipEventStreamEvent(messageId ?? undefined, directSubscriptionMessageIdsRef)) {
      if (DEBUG_EVENT_STREAM) {
        logToFile(`[EventStream] SKIPPED ${eventType} - message ${messageId} has direct subscription`);
      }
      return;
    }

    if (DEBUG_EVENT_STREAM) {
      logToFile(`[EventStream] HANDLING ${eventType} from event stream`);
    }

    // Build context and handle event
    const context = buildEventContext(contextParams);
    handleStreamEvent(event, context);
  };
}
