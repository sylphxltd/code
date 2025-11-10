/**
 * Subscription Adapter for tRPC Streaming
 * Converts tRPC subscription events to UI updates
 *
 * This adapter bridges the new tRPC subscription architecture with the existing UI.
 * It maintains the same interface as the old sendUserMessageToAI function but uses
 * the new unified subscription backend.
 *
 * Architecture:
 * - TUI: Uses in-process subscription link (zero overhead)
 * - Web: Will use httpSubscriptionLink (SSE over network)
 * - Same interface for both!
 *
 * PASSIVE SUBSCRIBER MODEL:
 * - Client NEVER proactively sets state or adds messages
 * - Client ONLY reacts to server events via handleStreamEvent()
 * - Server pushes all updates via observable (session-created, title-delta, text-delta, etc.)
 * - Multi-client sync works automatically (TUI + GUI receive same events)
 * - No optimistic updates, no predictions, no assumptions
 * - All state changes are event-driven in switch/case handlers
 */

import {
  getTRPCClient,
  parseUserInput,
  eventBus,
  getCurrentSessionId,
  setCurrentSessionId,
  $currentSession,
  set as setSignal,
  get as getSignal
} from '@sylphx/code-client';
import type { AIConfig, FileAttachment, MessagePart, TokenUsage } from '@sylphx/code-core';
import { createLogger } from '@sylphx/code-core';
import type { StreamEvent } from '@sylphx/code-server';
import type React from 'react';
import { handleStreamEvent, updateActiveMessageContent } from './streamEventHandlers.js';
import { addDirectSubscriptionMessage, removeDirectSubscriptionMessage } from './streamingSource.js';

// Create debug loggers for different components
const logSession = createLogger('subscription:session');
const logMessage = createLogger('subscription:message');

/**
 * Options for triggering AI streaming
 * Currently no options needed - kept for future extensibility
 */
export interface TriggerAIOptions {
  // Reserved for future options
}

/**
 * Parameters for subscription adapter
 */
export interface SubscriptionAdapterParams {
  // Configuration
  aiConfig: AIConfig | null;
  currentSessionId: string | null;
  selectedProvider: string | null;
  selectedModel: string | null;

  // Functions from hooks/store
  addMessage: (params: {
    sessionId: string | null;
    role: 'user' | 'assistant';
    content: string | MessagePart[];
    attachments?: FileAttachment[];
    usage?: TokenUsage;
    finishReason?: string;
    metadata?: any;
    todoSnapshot?: any[];
    status?: 'active' | 'completed' | 'error' | 'abort';
    provider?: string;
    model?: string;
  }) => Promise<string>;
  addLog: (message: string) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;
  notificationSettings: { notifyOnCompletion: boolean; notifyOnError: boolean };

  // Refs for streaming state
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  wasAbortedRef: React.MutableRefObject<boolean>;
  lastErrorRef: React.MutableRefObject<string | null>;
  usageRef: React.MutableRefObject<TokenUsage | null>;
  finishReasonRef: React.MutableRefObject<string | null>;
  streamingMessageIdRef: React.MutableRefObject<string | null>;
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>;

  // State setters
  setIsStreaming: (value: boolean) => void;
  setIsTitleStreaming: (value: boolean) => void;
  setStreamingTitle: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Creates sendUserMessageToAI function using tRPC subscription
 *
 * Maintains same interface as old implementation but uses new subscription backend.
 *
 * OPTIONS:
 * - skipUserMessage: When true, triggers AI with existing messages only (no new user message)
 *   Use case: /compact command where session already has system message that converts to user message
 */
export function createSubscriptionSendUserMessageToAI(params: SubscriptionAdapterParams) {
  const {
    aiConfig,
    currentSessionId,
    selectedProvider,
    selectedModel,
    addMessage,
    addLog,
    updateSessionTitle,
    notificationSettings,
    abortControllerRef,
    wasAbortedRef,
    lastErrorRef,
    usageRef,
    finishReasonRef,
    streamingMessageIdRef,
    directSubscriptionMessageIdsRef,
    setIsStreaming,
    setIsTitleStreaming,
    setStreamingTitle,
  } = params;

  return async (
    userMessage: string,
    attachments?: FileAttachment[],
    options?: TriggerAIOptions
  ) => {
    logSession('Send user message called');
    logSession('User message length:', userMessage.length);
    logSession('Provider:', selectedProvider, 'Model:', selectedModel);

    // Block if no provider configured
    // Use selectedProvider and selectedModel from store (reactive state)
    const provider = selectedProvider;
    const model = selectedModel;

    if (!provider || !model) {
      logSession('No provider or model configured!', { provider, model });
      addLog('[subscriptionAdapter] No AI provider configured. Use /provider to configure.');

      // Add error message to UI (pre-validation error, no streaming involved)
      if (currentSessionId) {
        await addMessage({
          sessionId: currentSessionId,
          role: 'assistant',
          content: [
            {
              type: 'error',
              error: 'No AI provider configured. Please configure a provider using the /provider command.',
              status: 'completed',
            } as MessagePart,
          ],
          provider,
          model,
        });
      }
      return;
    }

    logSession('Provider configured, proceeding with streaming');

    // LAZY SESSIONS: Server will create session if currentSessionId is null
    // Client just passes null, server handles creation
    const sessionId = currentSessionId;

    // Reset flags for new stream
    wasAbortedRef.current = false;
    lastErrorRef.current = null;
    usageRef.current = null;
    finishReasonRef.current = null;
    streamingMessageIdRef.current = null;
    // Note: directSubscriptionMessageIdsRef will be populated when assistant-message-created arrives

    // Create abort controller for this stream
    abortControllerRef.current = new AbortController();

    try {
      logSession('Getting tRPC client');
      // Get tRPC caller (in-process client)
      const caller = await getTRPCClient();
      logSession('tRPC client obtained');

      // Parse user input into ordered content parts
      const { parts: content } = parseUserInput(userMessage, attachments || []);

      logSession('Parsed content:', JSON.stringify(content, null, 2));

      // Optimistic update: Add user message immediately for better UX
      // Only add if there is actual content (empty message = using existing messages only)
      if (content.length > 0) {
        // Convert ParsedContentPart to MessagePart with proper structure
        const optimisticMessageId = `temp-user-${Date.now()}`;

        logSession('Creating optimistic update:', { sessionId, hasSession: !!sessionId });

        // Build MessagePart[] from content and attachments
        const messageParts: MessagePart[] = content.map((part) => {
          if (part.type === 'text') {
            return {
              type: 'text',
              content: part.content,
              status: 'completed' as const,
            };
          } else if (part.type === 'file') {
            // For optimistic update, create file part WITHOUT base64
            // Server will handle actual file reading and freezing
            // We just need to display it correctly in UI
            const attachment = attachments?.find(a => a.relativePath === part.relativePath);

            return {
              type: 'file',
              relativePath: part.relativePath,
              mediaType: attachment?.mimeType || 'application/octet-stream',
              // Use empty base64 for optimistic display - server will provide real data
              base64: '',
              size: part.size || attachment?.size || 0,
              status: 'completed' as const,
            };
          }
          // Shouldn't reach here, but return text fallback
          return {
            type: 'text',
            content: '',
            status: 'completed' as const,
          };
        });

        logSession('Built message parts:', messageParts.length, 'parts');

        // Add optimistic message to store (works for both existing and new sessions)
        // IMPORTANT: Use get() to avoid triggering re-renders during subscription setup
        const currentSession = getSignal($currentSession);
        const shouldCreateTempSession = !sessionId || !currentSession || currentSession.id !== sessionId;

        // IMMUTABLE UPDATE: zen signals need immutable updates to trigger re-renders
        if (sessionId && currentSession?.id === sessionId) {
          // For existing sessions, add to current session
          const beforeCount = currentSession.messages.length;

          setSignal($currentSession, {
            ...currentSession,
            messages: [
              ...currentSession.messages,
              {
                id: optimisticMessageId,
                role: 'user',
                content: messageParts,
                timestamp: Date.now(),
                status: 'completed',
              }
            ]
          });

          logSession('Added optimistic message to existing session:', {
            id: optimisticMessageId,
            beforeCount,
            afterCount: beforeCount + 1,
          });
        } else {
          // For new sessions or no current session, create temporary session for display
          logSession('Creating temporary session for optimistic display');

          setCurrentSessionId('temp-session');
          setSignal($currentSession, {
            id: 'temp-session',
            title: 'New Chat',
            agentId: 'coder',
            provider: provider || '',
            model: model || '',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [{
              id: optimisticMessageId,
              role: 'user',
              content: messageParts,
              timestamp: Date.now(),
              status: 'completed',
            }],
            todos: [],
          });

          logSession('Created temporary session with optimistic message');
        }
      } else {
        logSession('Skipping optimistic update (skipUserMessage=true - triggering with existing messages)');
      }

      logSession('Calling streamResponse subscription', {
        sessionId,
        hasProvider: !!provider,
        hasModel: !!model,
        messageLength: userMessage.length,
        contentParts: content.length,
      });

      // Call subscription procedure (returns Observable)
      // If sessionId is null, pass provider/model for lazy session creation
      // NOTE: Don't await subscriptions - they return observables synchronously

      // tRPC v11 subscription API: client.procedure.subscribe(input, callbacks)
      const subscription = caller.message.streamResponse.subscribe(
        {
          sessionId: sessionId,
          provider: sessionId ? undefined : provider,
          model: sessionId ? undefined : model,
          content, // Empty array = use existing messages, non-empty = add new user message
        },
        {
          onStarted: () => {
            logSession('Subscription started successfully');
          },
          onData: (event: StreamEvent) => {
            logMessage('Received event:', event.type);

            // Track message IDs from direct subscription for deduplication
            if (event.type === 'assistant-message-created') {
              addDirectSubscriptionMessage(directSubscriptionMessageIdsRef, event.messageId);
              logMessage('Added to direct subscription set:', event.messageId);
            }

            // Direct subscription events
            handleStreamEvent(event, {
              currentSessionId: sessionId,
              updateSessionTitle,
              setIsStreaming,
              setIsTitleStreaming,
              setStreamingTitle,
              streamingMessageIdRef,
              usageRef,
              finishReasonRef,
              lastErrorRef,
              addLog,
              aiConfig,
              userMessage,
              notificationSettings,
            });
          },
          onError: (error: any) => {
            try {
              logSession('Subscription error:', error.message || String(error));
              addLog(`[Subscription] Error: ${error.message || String(error)}`);
              lastErrorRef.current = error.message || String(error);

              // Add error message part to UI
              updateActiveMessageContent(sessionId, streamingMessageIdRef.current, (prev) => [
                ...prev,
                {
                  type: 'error',
                  error: error.message || String(error),
                  status: 'completed',
                } as MessagePart,
              ]);

              // Cleanup
              cleanupAfterStream({
                currentSessionId: sessionId,
                wasAbortedRef,
                lastErrorRef,
                usageRef,
                finishReasonRef,
                streamingMessageIdRef,
                directSubscriptionMessageIdsRef,
                setIsStreaming,
                notificationSettings,
              });
            } catch (handlerError) {
              console.error('[subscriptionAdapter] Error in onError handler:', handlerError);
              // Ensure streaming state is reset even if error handling fails
              setIsStreaming(false);
            }
          },
          onComplete: () => {
            try {
              logSession('Subscription completed successfully');
              addLog('[Subscription] Complete');

              // Cleanup
              cleanupAfterStream({
                currentSessionId: sessionId,
                wasAbortedRef,
                lastErrorRef,
                usageRef,
                finishReasonRef,
                streamingMessageIdRef,
                directSubscriptionMessageIdsRef,
                setIsStreaming,
                notificationSettings,
              });
            } catch (handlerError) {
              console.error('[subscriptionAdapter] Error in onComplete handler:', handlerError);
              // Ensure streaming state is reset even if cleanup fails
              setIsStreaming(false);
            }
          },
        }
      );

      logSession('Subscription created, listening for events');

      // Handle abort
      abortControllerRef.current.signal.addEventListener('abort', () => {
        try {
          addLog('[Subscription] Aborted by user');
          wasAbortedRef.current = true;
          subscription.unsubscribe();

          // Mark active parts as aborted
          updateActiveMessageContent(sessionId, streamingMessageIdRef.current, (prev) =>
            prev.map((part) =>
              part.status === 'active' ? { ...part, status: 'abort' as const } : part
            )
          );

          // Cleanup
          cleanupAfterStream({
            currentSessionId: sessionId,
            wasAbortedRef,
            lastErrorRef,
            usageRef,
            finishReasonRef,
            streamingMessageIdRef,
            directSubscriptionMessageIdsRef,
            setIsStreaming,
            notificationSettings,
          });
        } catch (handlerError) {
          console.error('[subscriptionAdapter] Error in abort handler:', handlerError);
          // Ensure streaming state is reset even if abort handling fails
          setIsStreaming(false);
        }
      });
    } catch (error) {
      logSession('Subscription setup error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      try {
        addLog(
          `[subscriptionAdapter] Error: ${error instanceof Error ? error.message : String(error)}`
        );
        lastErrorRef.current = error instanceof Error ? error.message : String(error);
      } catch (logError) {
        console.error('[subscriptionAdapter] Error logging failed:', logError);
      } finally {
        // Always reset streaming state
        setIsStreaming(false);
      }
    }
  };
}

/**
 * DEPRECATED: Title generation is now handled by backend streaming service
 *
 * Backend emits session-title-start/delta/complete events during streaming.
 * The subscription adapter handles these events (lines 405-419) and updates the UI.
 * This function is no longer needed but kept for reference.
 */

/**
 * Cleanup after stream completes or errors
 * NOTE: All operations wrapped in try-catch to prevent cleanup errors from crashing
 */
async function cleanupAfterStream(context: {
  currentSessionId: string | null;
  wasAbortedRef: React.MutableRefObject<boolean>;
  lastErrorRef: React.MutableRefObject<string | null>;
  usageRef: React.MutableRefObject<TokenUsage | null>;
  finishReasonRef: React.MutableRefObject<string | null>;
  streamingMessageIdRef: React.MutableRefObject<string | null>;
  directSubscriptionMessageIdsRef: React.MutableRefObject<Set<string>>;
  setIsStreaming: (value: boolean) => void;
  notificationSettings: { notifyOnCompletion: boolean; notifyOnError: boolean };
}) {
  try {
    // IMPORTANT: Get current session ID from signals (not from context)
    // For lazy sessions, the sessionId is updated in signals after session-created event
    const currentSessionId = getCurrentSessionId();

    const wasAborted = context.wasAbortedRef.current;
    const hasError = context.lastErrorRef.current;

    // Update message status in zen signals
    const finalStatus = wasAborted ? 'abort' : hasError ? 'error' : 'completed';

    try {
      const session = getSignal($currentSession);
      if (!session || session.id !== currentSessionId) {
        return;
      }

      const activeMessage = [...session.messages]
        .reverse()
        .find((m) => m.role === 'assistant' && m.status === 'active');

      if (!activeMessage) {
        return;
      }

      // IMMUTABLE UPDATE: Update message status and metadata
      const updatedMessages = session.messages.map(msg =>
        msg.id === activeMessage.id
          ? {
              ...msg,
              status: finalStatus,
              usage: context.usageRef.current || msg.usage,
              finishReason: context.finishReasonRef.current || msg.finishReason,
            }
          : msg
      );

      setSignal($currentSession, {
        ...session,
        messages: updatedMessages,
      });
    } catch (stateError) {
      console.error('[cleanupAfterStream] Failed to update message status:', stateError);
    }

    // Reload message from database to get steps structure
    // IMPORTANT: Only reload if stream completed successfully
    // If there were errors (no usage), database save likely failed (SQLITE_BUSY)
    // and we want to preserve in-memory error parts in message.content
    if (currentSessionId && context.streamingMessageIdRef.current && !hasError && context.usageRef.current) {
      try {
        const client = getTRPCClient();
        const session = await client.session.getById.query({ sessionId: currentSessionId });

        if (session) {
          // Update signals with fresh data from database
          const currentSessionIdSignal = getCurrentSessionId();
          if (currentSessionIdSignal === currentSessionId) {
            setSignal($currentSession, session);
          }
        }
      } catch (error) {
        console.error('[cleanupAfterStream] Failed to reload session:', error);
      }
    }

    // Send notifications
    try {
      if (context.notificationSettings.notifyOnCompletion && !wasAborted && !hasError) {
        // TODO: Send notification (platform-specific)
      }
      if (context.notificationSettings.notifyOnError && hasError) {
        // TODO: Send error notification (platform-specific)
      }
    } catch (notificationError) {
      console.error('[cleanupAfterStream] Failed to send notification:', notificationError);
    }

    // Remove message from direct subscription tracking
    removeDirectSubscriptionMessage(context.directSubscriptionMessageIdsRef, context.streamingMessageIdRef.current);

    // Reset flags
    context.wasAbortedRef.current = false;
    context.lastErrorRef.current = null;
    context.streamingMessageIdRef.current = null;
    context.usageRef.current = null;
    context.finishReasonRef.current = null;
  } catch (cleanupError) {
    console.error('[cleanupAfterStream] Critical error during cleanup:', cleanupError);
  } finally {
    // ALWAYS reset streaming state, even if cleanup fails
    try {
      context.setIsStreaming(false);

      // Emit streaming:completed event for store coordination
      const currentSessionIdSignal = getCurrentSessionId();
      if (currentSessionIdSignal && context.streamingMessageIdRef.current) {
        eventBus.emit('streaming:completed', {
          sessionId: currentSessionIdSignal,
          messageId: context.streamingMessageIdRef.current,
        });
      }
    } catch (setStateError) {
      console.error('[cleanupAfterStream] Failed to set isStreaming to false:', setStateError);
    }
  }
}
