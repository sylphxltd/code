/**
 * Streaming Source Management
 * Tracks the source of streaming events for deduplication
 */

import type React from 'react';

/**
 * Streaming source types
 * - null: No active streaming
 * - direct: Direct subscription (normal user message)
 * - event-stream: Event stream only (compact auto-trigger, other clients)
 */
export type StreamingSource = null | 'direct' | 'event-stream';

/**
 * Streaming source state
 * Combines messageId and source for cleaner tracking
 */
export interface StreamingSourceState {
  messageId: string | null;
  source: StreamingSource;
}

/**
 * Check if event stream event should be skipped for a specific message
 * Skip ONLY when this specific message ID is being handled by direct subscription
 *
 * ARCHITECTURE: Message-specific deduplication
 * - Each message ID is tracked individually in the Set
 * - Allows compact auto-trigger (no direct subscription) to work alongside normal streaming
 * - Prevents global blocking that would break concurrent operations
 */
export function shouldSkipEventStreamEvent(
  messageId: string | undefined,
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>
): boolean {
  if (!messageId) return false;
  return directSubscriptionMessageIdsRef.current.has(messageId);
}

/**
 * Initialize streaming source refs
 */
export function resetStreamingSource(
  streamingMessageIdRef: React.MutableRefObject<string | null>,
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>
): void {
  streamingMessageIdRef.current = null;
  directSubscriptionMessageIdsRef.current.clear();
}

/**
 * Add message ID to direct subscription tracking
 * Called when a direct subscription starts handling a message
 */
export function addDirectSubscriptionMessage(
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>,
  messageId: string
): void {
  directSubscriptionMessageIdsRef.current.add(messageId);
}

/**
 * Remove message ID from direct subscription tracking
 * Called when a direct subscription completes/errors for a message
 */
export function removeDirectSubscriptionMessage(
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>,
  messageId: string | null
): void {
  if (messageId) {
    directSubscriptionMessageIdsRef.current.delete(messageId);
  }
}

/**
 * Mark as event stream source (no direct subscription tracking needed)
 */
export function markAsEventStream(
  streamingMessageIdRef: React.MutableRefObject<string | null>,
  messageId: string
): void {
  streamingMessageIdRef.current = messageId;
  // No Set modification - event stream messages are NOT in the direct subscription set
}
