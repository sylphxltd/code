/**
 * Event Stream Hook
 * Passive subscriber architecture for session events
 *
 * Architecture: Server-driven, client is passive
 * - Server publishes all events to session:${sessionId} channel
 * - Client subscribes and reacts to events
 * - Supports cursor-based replay for session switching
 * - Automatically resubscribes when session changes
 */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/app-store.js';
import { getTRPCClient } from '../trpc-provider.js';

export interface EventStreamCallbacks {
  // Session events
  onSessionCreated?: (sessionId: string, provider: string, model: string) => void;
  onSessionTitleStart?: (sessionId: string) => void;
  onSessionTitleDelta?: (sessionId: string, text: string) => void;
  onSessionTitleComplete?: (sessionId: string, title: string) => void;

  // Message events
  onAssistantMessageCreated?: (messageId: string) => void;

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
  const currentSessionId = useAppStore((state) => state.currentSessionId);
  const setError = useAppStore((state) => state.setError);
  const updateSessionTitle = useAppStore((state) => state.updateSessionTitle);

  // Ref to track subscription
  const subscriptionRef = useRef<{ unsubscribe: () => void } | null>(null);

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

    // Subscribe to event stream
    const client = getTRPCClient();

    const subscription = client.events.subscribeToSession.subscribe(
      {
        sessionId: currentSessionId,
        replayLast,
      },
      {
        onData: (storedEvent: any) => {
          const event = storedEvent.payload;

          // Handle all event types
          switch (event.type) {
            case 'session-created':
              callbacks.onSessionCreated?.(event.sessionId, event.provider, event.model);
              break;

            case 'session-title-updated-start':
              callbacks.onSessionTitleStart?.(event.sessionId);
              break;

            case 'session-title-updated-delta':
              callbacks.onSessionTitleDelta?.(event.sessionId, event.text);
              break;

            case 'session-title-updated-end':
              // Update session title in store (passive reaction to server event)
              if (event.sessionId === currentSessionId) {
                updateSessionTitle(event.sessionId, event.title).catch((err) => {
                  console.error('[EventStream] Failed to update title:', err);
                });
              }
              callbacks.onSessionTitleComplete?.(event.sessionId, event.title);
              break;

            case 'assistant-message-created':
              callbacks.onAssistantMessageCreated?.(event.messageId);
              break;

            case 'text-start':
              callbacks.onTextStart?.();
              break;

            case 'text-delta':
              callbacks.onTextDelta?.(event.text);
              break;

            case 'text-end':
              callbacks.onTextEnd?.();
              break;

            case 'reasoning-start':
              callbacks.onReasoningStart?.();
              break;

            case 'reasoning-delta':
              callbacks.onReasoningDelta?.(event.text);
              break;

            case 'reasoning-end':
              callbacks.onReasoningEnd?.(event.duration);
              break;

            case 'tool-call':
              callbacks.onToolCall?.(event.toolCallId, event.toolName, event.args);
              break;

            case 'tool-result':
              callbacks.onToolResult?.(event.toolCallId, event.toolName, event.result, event.duration);
              break;

            case 'tool-error':
              callbacks.onToolError?.(event.toolCallId, event.toolName, event.error, event.duration);
              break;

            case 'file':
              callbacks.onFile?.(event.mediaType, event.base64);
              break;

            case 'ask-question':
              callbacks.onAskQuestion?.(event.questionId, event.questions);
              break;

            case 'complete':
              callbacks.onComplete?.(event.usage, event.finishReason);
              break;

            case 'error':
              callbacks.onError?.(event.error);
              setError(event.error);
              break;

            case 'abort':
              callbacks.onAbort?.();
              break;
          }
        },
        onError: (error: any) => {
          const errorMessage = error instanceof Error ? error.message : 'Event stream error';
          callbacks.onError?.(errorMessage);
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
  }, [currentSessionId, replayLast, callbacks, setError, updateSessionTitle]);
}
