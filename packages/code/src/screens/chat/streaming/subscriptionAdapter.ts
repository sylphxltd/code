/**
 * Streaming Trigger Adapter for tRPC
 * Triggers AI streaming via mutation and handles optimistic updates
 *
 * MUTATION + EVENT STREAM ARCHITECTURE:
 * - Client calls triggerStream mutation to start streaming
 * - Server streams in background and publishes all events to event bus
 * - Client receives events via useEventStream (Chat.tsx)
 * - All event handling in streamEventHandlers.ts
 *
 * Architecture:
 * - TUI: Uses in-process tRPC (zero overhead)
 * - Web: Will use HTTP tRPC (over network)
 * - Same interface for both!
 *
 * OPTIMISTIC UPDATE + PASSIVE EVENT MODEL:
 * - Client adds optimistic user message before mutation call
 * - Client calls mutation to trigger streaming
 * - Server streams and publishes events to event bus
 * - Client receives events via useEventStream and reacts in handleStreamEvent()
 * - Multi-client sync works automatically (all clients subscribe to session's event stream)
 * - All streaming state changes are event-driven
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
  streamingMessageIdRef: React.MutableRefObject<string | null>;

  // State setters
  setIsStreaming: (value: boolean) => void;
  setIsTitleStreaming: (value: boolean) => void;
  setStreamingTitle: React.Dispatch<React.SetStateAction<string>>;
}

/**
 * Creates sendUserMessageToAI function using tRPC mutation + event stream
 *
 * Flow:
 * 1. Adds optimistic user message to UI (for instant feedback)
 * 2. Calls triggerStream mutation to start server streaming
 * 3. Server publishes events to event bus
 * 4. useEventStream receives events and calls handleStreamEvent
 * 5. Event handlers update UI state
 *
 * Note: Empty content array = trigger with existing messages only (no new user message)
 * Use case: /compact command where session already has messages
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
    streamingMessageIdRef,
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

    // Reset streaming state for new stream
    streamingMessageIdRef.current = null;

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

      /**
       * OPTIMISTIC UPDATE STRATEGY
       *
       * Goal: Show user message immediately without waiting for server confirmation
       *
       * New Session Flow:
       * 1. Create temp session ('temp-session') with optimistic message
       * 2. Display temp session in UI (instant feedback)
       * 3. Call triggerStream mutation → Server creates real session
       * 4. Server emits session-created event with real sessionId
       * 5. handleSessionCreated (streamEventHandlers.ts) replaces temp with real session
       * 6. User sees seamless transition from temp → real session
       *
       * Existing Session Flow:
       * 1. Add optimistic message to current session with temp ID
       * 2. Display message immediately (instant feedback)
       * 3. Call triggerStream mutation → Server saves real message
       * 4. Server emits user-message-created with real messageId
       * 5. handleUserMessageCreated replaces temp ID with real ID
       * 6. User doesn't notice the ID swap
       *
       * Rollback Strategy:
       * - If mutation fails: Error is displayed as assistant error message
       * - Optimistic message is NOT removed (keeps user input visible)
       * - User can retry by sending again
       *
       * File Attachments:
       * - Optimistic display: Show file metadata only (no base64)
       * - Server reads and freezes actual file content
       * - Real message contains full base64 data
       */

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

      logSession('Calling triggerStream mutation', {
        sessionId,
        hasProvider: !!provider,
        hasModel: !!model,
        messageLength: userMessage.length,
        contentParts: content.length,
      });

      // MUTATION ARCHITECTURE: Trigger streaming via mutation, receive via event stream
      // - Mutation triggers server to start streaming in background
      // - Server publishes all events to event bus
      // - Client receives events via useEventStream (Chat.tsx)
      // - No subscription callbacks needed - all handled in event handlers
      const result = await caller.message.triggerStream.mutate({
        sessionId: sessionId,
        provider: sessionId ? undefined : provider,
        model: sessionId ? undefined : model,
        content, // Empty array = use existing messages, non-empty = add new user message
      });

      logSession('Mutation completed:', result);

      // CRITICAL: Update sessionId if lazy session was created
      // This ensures useEventStream subscribes to the correct session
      if (result.sessionId && result.sessionId !== sessionId) {
        logSession('Lazy session created, updating currentSessionId:', result.sessionId);
        setCurrentSessionId(result.sessionId);
      }

      // Set streaming flag immediately after mutation triggers
      setIsStreaming(true);

      // Handle abort (client-side state management only)
      // TODO: Add abort mutation to notify server to stop generation
      abortControllerRef.current.signal.addEventListener('abort', () => {
        try {
          logSession('Stream aborted by user');
          addLog('[Mutation] Aborted by user');

          // Mark active parts as aborted
          updateActiveMessageContent(sessionId, streamingMessageIdRef.current, (prev) =>
            prev.map((part) =>
              part.status === 'active' ? { ...part, status: 'abort' as const } : part
            )
          );

          // Reset streaming state (client-side only)
          setIsStreaming(false);
          streamingMessageIdRef.current = null;
        } catch (handlerError) {
          console.error('[subscriptionAdapter] Error in abort handler:', handlerError);
          setIsStreaming(false);
        }
      });
    } catch (error) {
      logSession('Mutation call error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

      try {
        addLog(
          `[subscriptionAdapter] Error: ${error instanceof Error ? error.message : String(error)}`
        );
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
 * The subscription adapter handles these events and updates the UI.
 * This function is no longer needed but kept for reference.
 */

/**
 * DEPRECATED: Cleanup after stream completes or errors
 *
 * With mutation-based architecture, all cleanup is handled by event handlers
 * (handleComplete, handleError in streamEventHandlers.ts).
 * This function is no longer needed but kept for reference.
 */
