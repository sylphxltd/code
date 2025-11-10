/**
 * Event Publisher Utilities
 * Centralizes event publishing logic for multi-channel scenarios
 */

import type { EventStream } from './event-stream.service.js';

/**
 * Publish session title update to both channels
 * - session:${sessionId} - for clients viewing that specific session
 * - session-events - for global sidebar sync across all clients
 */
export async function publishTitleUpdate(
  eventStream: EventStream,
  sessionId: string,
  title: string
): Promise<void> {
  await Promise.all([
    // Session-specific channel (real-time display for current session)
    eventStream.publish(`session:${sessionId}`, {
      type: 'session-title-updated-end' as const,
      sessionId,
      title,
    }),
    // Global channel (sidebar sync for all clients)
    eventStream.publish('session-events', {
      type: 'session-title-updated' as const,
      sessionId,
      title,
    }),
  ]);
}

/**
 * Publish session creation to global channel
 */
export async function publishSessionCreated(
  eventStream: EventStream,
  sessionId: string,
  provider: string,
  model: string
): Promise<void> {
  await eventStream.publish('session-events', {
    type: 'session-created' as const,
    sessionId,
    provider,
    model,
  });
}

/**
 * Publish session deletion to global channel
 */
export async function publishSessionDeleted(
  eventStream: EventStream,
  sessionId: string
): Promise<void> {
  await eventStream.publish('session-events', {
    type: 'session-deleted' as const,
    sessionId,
  });
}

/**
 * Publish session model update to global channel
 */
export async function publishModelUpdate(
  eventStream: EventStream,
  sessionId: string,
  model: string
): Promise<void> {
  await eventStream.publish('session-events', {
    type: 'session-model-updated' as const,
    sessionId,
    model,
  });
}

/**
 * Publish session provider update to global channel
 */
export async function publishProviderUpdate(
  eventStream: EventStream,
  sessionId: string,
  provider: string,
  model: string
): Promise<void> {
  await eventStream.publish('session-events', {
    type: 'session-provider-updated' as const,
    sessionId,
    provider,
    model,
  });
}
