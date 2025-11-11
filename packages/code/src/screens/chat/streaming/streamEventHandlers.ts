/**
 * Stream Event Handlers
 * Event handler pattern for processing tRPC subscription events
 *
 * Each event type has its own dedicated handler function.
 * This replaces the large switch statement with a cleaner, more maintainable approach.
 *
 * ARCHITECTURE: Direct zen signal updates (no AppStore wrapper)
 * - All session data managed by zen signals
 * - Immutable updates only (no Immer middleware)
 * - Clean, direct state mutations
 */

import {
  eventBus,
  getCurrentSessionId,
  setCurrentSessionId,
  $currentSession,
  set as setSignal,
  get as getSignal
} from '@sylphx/code-client';
import type { AIConfig, Message, MessagePart, TokenUsage } from '@sylphx/code-core';
import { createLogger } from '@sylphx/code-core';
import type { StreamEvent } from '@sylphx/code-server';
import type React from 'react';

// Create debug loggers
const logSession = createLogger('subscription:session');
const logMessage = createLogger('subscription:message');
const logContent = createLogger('subscription:content');

/**
 * Context passed to all event handlers
 */
export interface EventHandlerContext {
  currentSessionId: string | null;
  updateSessionTitle: (sessionId: string, title: string) => void;
  setIsStreaming: (value: boolean) => void;
  setIsTitleStreaming: (value: boolean) => void;
  setStreamingTitle: React.Dispatch<React.SetStateAction<string>>;
  streamingMessageIdRef: React.MutableRefObject<string | null>;
  addLog: (message: string) => void;
  aiConfig: AIConfig | null;
  userMessage: string;
  notificationSettings: { notifyOnCompletion: boolean; notifyOnError: boolean };
}

/**
 * Event handler function type
 */
type EventHandler = (event: any, context: EventHandlerContext) => void;

/**
 * Helper to update active message content in SessionStore
 * Exported for use in error handlers and cleanup
 * Uses immutable updates (no Immer middleware)
 */
export function updateActiveMessageContent(
  currentSessionId: string | null,
  messageId: string | null | undefined,
  updater: (prev: MessagePart[]) => MessagePart[]
) {
  const session = getSignal($currentSession);

  if (!session || session.id !== currentSessionId) {
    logContent('Session mismatch! expected:', currentSessionId, 'got:', session?.id);
    return;
  }

  // Find message by ID if provided, otherwise find any active message
  // When messageId is provided, find by ID regardless of status (allows updating parts after status change)
  const activeMessage = messageId
    ? session.messages.find((m) => m.id === messageId)
    : session.messages.find((m) => m.status === 'active');

  if (!activeMessage) {
    logContent('No active message found! messages:', session.messages.length, 'messageId:', messageId);
    return;
  }

  // IMMUTABLE UPDATE: Create new messages array with updated content
  const updatedMessages = session.messages.map(msg =>
    msg.id === activeMessage.id
      ? { ...msg, content: updater(msg.content || []) }  // Ensure content is array
      : msg
  );

  // Update signal with new session object
  setSignal($currentSession, {
    ...session,
    messages: updatedMessages
  });
}

// ============================================================================
// Session Events
// ============================================================================

function handleSessionCreated(event: Extract<StreamEvent, { type: 'session-created' }>, context: EventHandlerContext) {
  context.addLog(`[Session] Created: ${event.sessionId}`);

  // Get current session state to preserve optimistic messages
  const currentSession = getSignal($currentSession);

  // Check if there's a temporary session with optimistic messages
  const optimisticMessages = currentSession?.id === 'temp-session'
    ? currentSession.messages
    : [];

  logSession('Creating session, preserving optimistic messages:', optimisticMessages.length);

  // IMMUTABLE UPDATE: Create new session with optimistic messages preserved
  setCurrentSessionId(event.sessionId);
  setSignal($currentSession, {
    id: event.sessionId,
    title: 'New Chat',
    agentId: 'coder',
    provider: event.provider,
    model: event.model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: optimisticMessages, // Preserve optimistic user message
    todos: [],
    enabledRuleIds: [],
  });

  logSession('Created session with optimistic messages:', event.sessionId);
}

function handleSessionDeleted(event: Extract<StreamEvent, { type: 'session-deleted' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  if (event.sessionId === currentSessionId) {
    setCurrentSessionId(null);
    setSignal($currentSession, null);
    context.addLog(`[Session] Deleted: ${event.sessionId}`);
  }
}

function handleSessionModelUpdated(event: Extract<StreamEvent, { type: 'session-model-updated' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();
  const currentSession = getSignal($currentSession);

  if (event.sessionId === currentSessionId && currentSession) {
    setSignal($currentSession, {
      ...currentSession,
      model: event.model,
    });
    context.addLog(`[Session] Model updated: ${event.model}`);
  }
}

function handleSessionProviderUpdated(event: Extract<StreamEvent, { type: 'session-provider-updated' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();
  const currentSession = getSignal($currentSession);

  if (event.sessionId === currentSessionId && currentSession) {
    setSignal($currentSession, {
      ...currentSession,
      provider: event.provider,
      model: event.model,
    });
    context.addLog(`[Session] Provider updated: ${event.provider}`);
  }
}

// ============================================================================
// Title Events
// ============================================================================

function handleSessionTitleUpdatedStart(event: Extract<StreamEvent, { type: 'session-title-updated-start' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  if (event.sessionId === currentSessionId) {
    context.setIsTitleStreaming(true);
    context.setStreamingTitle('');
  }
}

function handleSessionTitleUpdatedDelta(event: Extract<StreamEvent, { type: 'session-title-updated-delta' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  if (event.sessionId === currentSessionId) {
    context.setStreamingTitle((prev) => prev + event.text);
  }
}

function handleSessionTitleUpdatedEnd(event: Extract<StreamEvent, { type: 'session-title-updated-end' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  if (event.sessionId === currentSessionId) {
    context.setIsTitleStreaming(false);
    context.updateSessionTitle(event.sessionId, event.title);
  }
}

function handleSessionTitleUpdated(event: Extract<StreamEvent, { type: 'session-title-updated' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  if (event.sessionId === currentSessionId) {
    context.updateSessionTitle(event.sessionId, event.title);
  }
}

// ============================================================================
// Message Events
// ============================================================================

function handleUserMessageCreated(event: Extract<StreamEvent, { type: 'user-message-created' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();
  const currentSession = getSignal($currentSession);

  logMessage('User message created:', event.messageId);

  if (!currentSession || currentSession.id !== currentSessionId) {
    logMessage('Session mismatch! expected:', currentSessionId, 'got:', currentSession?.id);
    return;
  }

  // Find and replace optimistic message (temp-user-*)
  const optimisticIndex = currentSession.messages.findIndex(
    m => m.role === 'user' && m.id.startsWith('temp-user-')
  );

  let updatedMessages: Message[];

  if (optimisticIndex !== -1) {
    // Replace optimistic message ID with server's ID
    updatedMessages = currentSession.messages.map((msg, idx) =>
      idx === optimisticIndex
        ? { ...msg, id: event.messageId }
        : msg
    );
    logMessage('Replaced optimistic message with server ID:', event.messageId);
  } else {
    // No optimistic message found (shouldn't happen), add new message
    updatedMessages = [
      ...currentSession.messages,
      {
        id: event.messageId,
        role: 'user',
        content: [{ type: 'text', content: event.content, status: 'completed' }],
        timestamp: Date.now(),
        status: 'completed',
      }
    ];
    logMessage('Added user message (no optimistic found), total:', updatedMessages.length);
  }

  setSignal($currentSession, {
    ...currentSession,
    messages: updatedMessages,
  });
}

function handleAssistantMessageCreated(event: Extract<StreamEvent, { type: 'assistant-message-created' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();
  const currentSession = getSignal($currentSession);

  context.streamingMessageIdRef.current = event.messageId;
  logMessage('Message created:', event.messageId, 'session:', currentSessionId);

  // Start streaming UI
  context.setIsStreaming(true);

  // Emit streaming:started event for store coordination
  if (currentSessionId) {
    eventBus.emit('streaming:started', {
      sessionId: currentSessionId,
      messageId: event.messageId,
    });
  }

  if (!currentSession || currentSession.id !== currentSessionId) {
    logMessage('Session mismatch! expected:', currentSessionId, 'got:', currentSession?.id);
    return;
  }

  // Check if message already exists (prevent duplicates)
  const messageExists = currentSession.messages.some(m => m.id === event.messageId);
  if (messageExists) {
    logMessage('Message already exists, skipping:', event.messageId);
    return;
  }

  // Add new assistant message to session
  const newMessage = {
    id: event.messageId,
    role: 'assistant',
    content: [],
    timestamp: Date.now(),
    status: 'active',
  };

  setSignal($currentSession, {
    ...currentSession,
    messages: [
      ...currentSession.messages,
      newMessage
    ]
  });

  logMessage('Added assistant message, total:', currentSession.messages.length + 1);
}

function handleSystemMessageCreated(event: Extract<StreamEvent, { type: 'system-message-created' }>, context: EventHandlerContext) {
  const currentSession = getSignal($currentSession);

  logMessage('System message created:', event.messageId);

  if (!currentSession) {
    return;
  }

  // NOTE: Don't check session ID match - during session creation, $currentSessionId
  // may be updated before $currentSession, causing race condition.
  // Since this event comes from the subscription which is already filtered by session,
  // we can trust it belongs to the current session.

  // Check if message already exists (prevent duplicates)
  const messageExists = currentSession.messages?.some(m => m.id === event.messageId);
  if (messageExists) {
    logMessage('System message already exists, skipping:', event.messageId);
    return;
  }

  // Add new system message to session (completed, not streaming)
  const newMessage = {
    id: event.messageId,
    role: 'system',
    content: [{ type: 'text', content: event.content }],
    timestamp: Date.now(),
    status: 'completed',
  };

  const updatedMessages = [
    ...currentSession.messages,
    newMessage
  ];

  setSignal($currentSession, {
    ...currentSession,
    messages: updatedMessages
  });

  logMessage('Added system message, total:', currentSession.messages.length + 1);
}

// ============================================================================
// Step Events
// ============================================================================

function handleStepStart(event: Extract<StreamEvent, { type: 'step-start' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  logMessage('Step started:', event.stepId, 'index:', event.stepIndex, 'systemMessages:', event.systemMessages?.length || 0);

  // If there are system messages, add them to the active message content
  if (event.systemMessages && event.systemMessages.length > 0) {
    logMessage('Adding', event.systemMessages.length, 'system messages to active message');

    updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
      // Add each system message as a 'system-message' part
      const systemMessageParts = event.systemMessages!.map(sm => ({
        type: 'system-message' as const,
        content: sm.content,
        messageType: sm.type,
        timestamp: sm.timestamp,
        status: 'completed' as const,
      } as MessagePart));

      return [...prev, ...systemMessageParts];
    });
  }
}

function handleStepComplete(event: Extract<StreamEvent, { type: 'step-complete' }>, context: EventHandlerContext) {
  logMessage('Step completed:', event.stepId, 'duration:', event.duration, 'ms');
}

// ============================================================================
// Reasoning Events
// ============================================================================

function handleReasoningStart(event: Extract<StreamEvent, { type: 'reasoning-start' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  logContent('Reasoning start, session:', currentSessionId);
  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    logContent('Adding reasoning part, existing parts:', prev.length);
    return [
      ...prev,
      { type: 'reasoning', content: '', status: 'active', startTime: Date.now() } as MessagePart,
    ];
  });
}

function handleReasoningDelta(event: Extract<StreamEvent, { type: 'reasoning-delta' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    const newParts = [...prev];
    const lastPart = newParts[newParts.length - 1];
    if (lastPart && lastPart.type === 'reasoning') {
      newParts[newParts.length - 1] = {
        ...lastPart,
        content: lastPart.content + event.text,
      };
    }
    return newParts;
  });
}

function handleReasoningEnd(event: Extract<StreamEvent, { type: 'reasoning-end' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    const newParts = [...prev];
    const lastReasoningIndex = newParts
      .map((p, i) => ({ p, i }))
      .reverse()
      .find(({ p }) => p.type === 'reasoning' && p.status === 'active')?.i;

    if (lastReasoningIndex !== undefined) {
      const reasoningPart = newParts[lastReasoningIndex];
      if (reasoningPart && reasoningPart.type === 'reasoning') {
        newParts[lastReasoningIndex] = {
          ...reasoningPart,
          status: 'completed',
          duration: event.duration,
        } as MessagePart;
      }
    }
    return newParts;
  });
}

// ============================================================================
// Text Events
// ============================================================================

function handleTextStart(event: Extract<StreamEvent, { type: 'text-start' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    return [
      ...prev,
      { type: 'text', content: '', status: 'active' } as MessagePart,
    ];
  });
}

function handleTextDelta(event: Extract<StreamEvent, { type: 'text-delta' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    const newParts = [...prev];
    const lastPart = newParts[newParts.length - 1];

    if (lastPart && lastPart.type === 'text' && lastPart.status === 'active') {
      newParts[newParts.length - 1] = {
        type: 'text',
        content: lastPart.content + event.text,
        status: 'active' as const,
      };
    } else {
      newParts.push({
        type: 'text',
        content: event.text,
        status: 'active' as const,
      });
    }

    return newParts;
  });
}

function handleTextEnd(event: Extract<StreamEvent, { type: 'text-end' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    const newParts = [...prev];
    const lastTextIndex = newParts
      .map((p, i) => ({ p, i }))
      .reverse()
      .find(({ p }) => p.type === 'text' && p.status === 'active')?.i;

    if (lastTextIndex !== undefined) {
      const textPart = newParts[lastTextIndex];
      if (textPart && textPart.type === 'text') {
        newParts[lastTextIndex] = {
          ...textPart,
          status: 'completed',
        } as MessagePart;
      }
    }

    return newParts;
  });
}

// ============================================================================
// File Events
// ============================================================================

function handleFile(event: Extract<StreamEvent, { type: 'file' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  logContent('File received, mediaType:', event.mediaType, 'size:', event.base64.length);
  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => [
    ...prev,
    {
      type: 'file',
      mediaType: event.mediaType,
      base64: event.base64,
      status: 'completed',
    } as MessagePart,
  ]);
}

// ============================================================================
// Tool Events
// ============================================================================

function handleToolCall(event: Extract<StreamEvent, { type: 'tool-call' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => [
    ...prev,
    {
      type: 'tool',
      toolId: event.toolCallId,
      name: event.toolName,
      status: 'active',
      args: event.args,
      startTime: Date.now(),
    } as MessagePart,
  ]);
}

function handleToolResult(event: Extract<StreamEvent, { type: 'tool-result' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) =>
    prev.map((part) =>
      part.type === 'tool' && part.toolId === event.toolCallId
        ? {
            ...part,
            status: 'completed' as const,
            duration: event.duration,
            result: event.result,
          }
        : part
    )
  );
}

function handleToolError(event: Extract<StreamEvent, { type: 'tool-error' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) =>
    prev.map((part) =>
      part.type === 'tool' && part.toolId === event.toolCallId
        ? { ...part, status: 'error' as const, error: event.error, duration: event.duration }
        : part
    )
  );
}

// ============================================================================
// Completion Events
// ============================================================================

function handleError(event: Extract<StreamEvent, { type: 'error' }>, context: EventHandlerContext) {
  const currentSessionId = getCurrentSessionId();

  logContent('Error event received:', event.error);

  updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
    const newContent = [
      ...prev,
      { type: 'error', error: event.error, status: 'completed' } as MessagePart,
    ];
    logContent('Updated content with error, total parts:', newContent.length);
    return newContent;
  });

  // Stop streaming UI indicator on error
  context.setIsStreaming(false);
}

/**
 * Handle message status update (UNIFIED STATUS CHANGE EVENT)
 *
 * Server is the source of truth for message status.
 * This handler receives status updates from the database and applies them to the UI.
 *
 * Replaces client-side status calculation in handleComplete/handleAbort/handleError.
 *
 * Architecture:
 * - Server updates database → emits message-status-updated event
 * - All clients receive event → update UI state
 * - Multi-client sync automatically consistent
 */
function handleMessageStatusUpdated(
  event: Extract<StreamEvent, { type: 'message-status-updated' }>,
  context: EventHandlerContext
) {
  const currentSessionId = getCurrentSessionId();
  const currentSession = getSignal($currentSession);

  console.log('[handleMessageStatusUpdated] Status updated:', event.status, 'for message:', event.messageId);
  context.addLog(`[StreamEvent] Message status updated to: ${event.status}`);

  // Update message status in session (server is source of truth)
  if (currentSession && currentSession.messages.some(m => m.id === event.messageId)) {
    const updatedMessages = currentSession.messages.map(msg =>
      msg.id === event.messageId
        ? {
            ...msg,
            status: event.status,
            usage: event.usage || msg.usage,
            finishReason: event.finishReason || msg.finishReason,
          }
        : msg
    );

    setSignal($currentSession, {
      ...currentSession,
      messages: updatedMessages,
    });
  }

  // If this is the currently streaming message, clean up streaming state
  if (context.streamingMessageIdRef.current === event.messageId) {
    // Mark all active parts with the final status
    updateActiveMessageContent(currentSessionId, event.messageId, (prev) =>
      prev.map((part) =>
        part.status === 'active' ? { ...part, status: event.status } : part
      )
    );

    // Clear streaming state
    context.streamingMessageIdRef.current = null;
    context.setIsStreaming(false);

    console.log('[handleMessageStatusUpdated] Cleared streaming state for message:', event.messageId);
  }
}

// ============================================================================
// Event Handler Registry
// ============================================================================

/**
 * Registry mapping event types to their handlers
 * This replaces the large switch statement with a cleaner lookup pattern
 */
const eventHandlers: Record<StreamEvent['type'], EventHandler> = {
  // Session events
  'session-created': handleSessionCreated,
  'session-deleted': handleSessionDeleted,
  'session-model-updated': handleSessionModelUpdated,
  'session-provider-updated': handleSessionProviderUpdated,

  // Title events
  'session-title-updated-start': handleSessionTitleUpdatedStart,
  'session-title-updated-delta': handleSessionTitleUpdatedDelta,
  'session-title-updated-end': handleSessionTitleUpdatedEnd,
  'session-title-updated': handleSessionTitleUpdated,

  // Message events
  'user-message-created': handleUserMessageCreated,
  'assistant-message-created': handleAssistantMessageCreated,
  'system-message-created': handleSystemMessageCreated,
  'message-status-updated': handleMessageStatusUpdated,

  // Step events
  'step-start': handleStepStart,
  'step-complete': handleStepComplete,

  // Reasoning events
  'reasoning-start': handleReasoningStart,
  'reasoning-delta': handleReasoningDelta,
  'reasoning-end': handleReasoningEnd,

  // Text events
  'text-start': handleTextStart,
  'text-delta': handleTextDelta,
  'text-end': handleTextEnd,

  // Tool events
  'tool-call': handleToolCall,
  'tool-result': handleToolResult,
  'tool-error': handleToolError,
  'tool-input-start': () => {},  // Not used in TUI
  'tool-input-delta': () => {},  // Not used in TUI
  'tool-input-end': () => {},    // Not used in TUI

  // File events
  'file': handleFile,

  // Error events
  'error': handleError,
};

/**
 * Process stream event using handler registry
 * Replaces the large switch statement with a clean lookup
 */
export function handleStreamEvent(event: StreamEvent, context: EventHandlerContext): void {
  const handler = eventHandlers[event.type];

  if (handler) {
    handler(event, context);
  } else {
    console.warn('[handleStreamEvent] Unknown event type:', event.type);
  }
}
