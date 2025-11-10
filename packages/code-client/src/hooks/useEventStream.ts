/**
 * Event Stream Hook
 * Strongly-typed session event subscription
 *
 * Architecture: Mutation + Subscription
 * - Client calls triggerStream mutation to start streaming
 * - Client subscribes to session events via message.subscribe
 * - Server publishes events to session:{id} channel
 * - Client receives strongly-typed SessionEvent (not StoredEvent wrapper)
 *
 * Benefits:
 * - Strongly typed SessionEvent
 * - No StoredEvent wrapper to unwrap
 * - IDE autocomplete for event types
 * - Automatically resubscribes when session changes
 */

import { useEffect, useRef } from 'react';
import { useCurrentSessionId, $currentSession } from '../signals/domain/session/index.js';
import { setError } from '../signals/domain/ui/index.js';
import { getTRPCClient } from '../trpc-provider.js';
import { get as getSignal, set as setSignal } from '@sylphx/zen';

export interface EventStreamCallbacks {
  // Session events
  onSessionCreated?: (sessionId: string, provider: string, model: string) => void;
  onSessionUpdated?: (sessionId: string) => void;
  onSessionTitleStart?: (sessionId: string) => void;
  onSessionTitleDelta?: (sessionId: string, text: string) => void;
  onSessionTitleComplete?: (sessionId: string, title: string) => void;

  // Message events
  onAssistantMessageCreated?: (messageId: string) => void;
  onSystemMessageCreated?: (messageId: string, content: string) => void;

  // Text streaming
  onTextStart?: () => void;
  onTextDelta?: (text: string) => void;
  onTextEnd?: () => void;

  // Reasoning streaming
  onReasoningStart?: () => void;
  onReasoningDelta?: (text: string) => void;
  onReasoningEnd?: (duration: number) => void;

  // Tool streaming
  onToolCall?: (toolCallId: string, toolName: string, args: unknown) => void;
  onToolResult?: (toolCallId: string, toolName: string, result: unknown, duration: number) => void;
  onToolError?: (toolCallId: string, toolName: string, error: string, duration: number) => void;

  // File streaming (images, PDFs, etc.)
  onFile?: (mediaType: string, base64: string) => void;

  // Ask tool
  onAskQuestion?: (questionId: string, questions: Array<{
    question: string;
    header: string;
    multiSelect: boolean;
    options: Array<{
      label: string;
      description: string;
    }>;
  }>) => void;

  // Completion
  onComplete?: (usage?: any, finishReason?: string) => void;
  onError?: (error: string) => void;
  onAbort?: () => void;
}

export interface UseEventStreamOptions {
  /**
   * Number of events to replay when subscribing
   * 0 = no replay, only new events
   * N = replay last N events + new events
   */
  replayLast?: number;

  /**
   * Event callbacks
   */
  callbacks?: EventStreamCallbacks;
}

/**
 * Hook to subscribe to event stream for current session
 * Automatically handles subscription lifecycle and session switching
 */
export function useEventStream(options: UseEventStreamOptions = {}) {
  const { replayLast = 0, callbacks = {} } = options;
  const currentSessionId = useCurrentSessionId();

  // Ref to track subscription
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

  /**
   * CRITICAL: Store callbacks in ref to avoid stale closures
   *
   * Problem: If callbacks are in dependency array, useEffect re-runs on every render
   * (callbacks object is recreated each render). This causes infinite subscription loops.
   *
   * Solution: Store callbacks in ref, update ref on each render, use ref in subscription.
   * This ensures callbacks always reference current state without triggering re-subscription.
   */
  const callbacksRef = useRef(callbacks);
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    // Cleanup previous subscription
    if (subscriptionRef.current) {
      subscriptionRef.current.unsubscribe();
      subscriptionRef.current = null;
    }

    // Skip if no session
    if (!currentSessionId) {
      return;
    }

    // Subscribe to strongly-typed session events
    const client = getTRPCClient();

    const subscription = client.message.subscribe.subscribe(
      {
        sessionId: currentSessionId,
        replayLast,
      },
      {
        onData: (event: any) => {
          // Event is directly SessionEvent (no need to unwrap payload)

          // Handle all event types
          // Use callbacksRef.current to access latest callbacks (avoid stale closures)
          switch (event.type) {
            case 'session-created':
              callbacksRef.current.onSessionCreated?.(event.sessionId, event.provider, event.model);
              break;

            case 'session-updated':
              // Reload session data when updated (e.g., system messages inserted)
              callbacksRef.current.onSessionUpdated?.(event.sessionId);
              break;

            case 'session-title-updated-start':
              callbacksRef.current.onSessionTitleStart?.(event.sessionId);
              break;

            case 'session-title-updated-delta':
              callbacksRef.current.onSessionTitleDelta?.(event.sessionId, event.text);
              break;

            case 'session-title-updated-end':
              // Update session title in local state ONLY (passive reaction to server event)
              // DO NOT call updateSessionTitle() - that would trigger another API call → event loop!
              // Just update local signals directly
              if (event.sessionId === currentSessionId) {
                const currentSession = getSignal($currentSession);
                if (currentSession && currentSession.id === event.sessionId) {
                  setSignal($currentSession, {
                    ...currentSession,
                    title: event.title,
                  });
                }
              }
              callbacksRef.current.onSessionTitleComplete?.(event.sessionId, event.title);
              break;

            case 'assistant-message-created':
              callbacksRef.current.onAssistantMessageCreated?.(event.messageId);
              break;

            case 'system-message-created':
              callbacksRef.current.onSystemMessageCreated?.(event.messageId, event.content);
              break;

            case 'text-start':
              callbacksRef.current.onTextStart?.();
              break;

            case 'text-delta':
              callbacksRef.current.onTextDelta?.(event.text);
              break;

            case 'text-end':
              callbacksRef.current.onTextEnd?.();
              break;

            case 'reasoning-start':
              callbacksRef.current.onReasoningStart?.();
              break;

            case 'reasoning-delta':
              callbacksRef.current.onReasoningDelta?.(event.text);
              break;

            case 'reasoning-end':
              callbacksRef.current.onReasoningEnd?.(event.duration);
              break;

            case 'tool-call':
              callbacksRef.current.onToolCall?.(event.toolCallId, event.toolName, event.args);
              break;

            case 'tool-result':
              callbacksRef.current.onToolResult?.(event.toolCallId, event.toolName, event.result, event.duration);
              break;

            case 'tool-error':
              callbacksRef.current.onToolError?.(event.toolCallId, event.toolName, event.error, event.duration);
              break;

            case 'file':
              callbacksRef.current.onFile?.(event.mediaType, event.base64);
              break;

            case 'ask-question':
              callbacksRef.current.onAskQuestion?.(event.questionId, event.questions);
              break;

            case 'complete':
              callbacksRef.current.onComplete?.(event.usage, event.finishReason);
              break;

            case 'error':
              callbacksRef.current.onError?.(event.error);
              setError(event.error);
              break;

            case 'abort':
              callbacksRef.current.onAbort?.();
              break;
          }
        },
        onError: (error: any) => {
          const errorMessage = error instanceof Error ? error.message : 'Event stream error';
          callbacksRef.current.onError?.(errorMessage);
          setError(errorMessage);
        },
        onComplete: () => {
          // Stream completed
        },
      }
    );

    subscriptionRef.current = subscription;

    // Cleanup on unmount or session change
    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
  }, [currentSessionId, replayLast]);
  // NOTE: callbacks NOT in dependency array to avoid infinite loop
  // callbacks object is recreated on every render, would trigger constant resubscription
  // Only resubscribe when sessionId or replayLast changes
}
