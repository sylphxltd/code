/**
 * Session Domain Signals
 * Manages chat sessions and messages
 */

import type { Session, SessionMessage, ProviderId } from '@sylphx/code-core';
import { zen, get, set, computed } from '@sylphx/zen';
import { useStore } from '@sylphx/zen-react';
import { getTRPCClient } from '../../../trpc-provider.js';
import { eventBus } from '../../../lib/event-bus.js';

// Core session signals
export const $currentSessionId = zen<string | null>(null);
export const $currentSession = zen<Session | null>(null);
export const $isStreaming = zen(false);
export const $streamingMessageId = zen<string | null>(null);

// Message management
export const $messages = zen<SessionMessage[]>([]);
export const $messageLimit = 100;

// Session list
export const $recentSessions = zen<Session[]>([]);
export const $sessionsLoading = zen(false);

// Computed signals
export const $hasCurrentSession = computed([$currentSessionId], sessionId => sessionId !== null);
export const $currentSessionTitle = computed(
  [$currentSession],
  session => session?.title || 'New Chat'
);

export const $messageCount = computed(
  [$messages],
  messages => messages.length
);

export const $lastMessage = computed(
  [$messages],
  messages => messages[messages.length - 1] || null
);

export const $hasMessages = computed(
  [$messages],
  messages => messages.length > 0
);

// Actions
export const setCurrentSessionId = (sessionId: string | null) => set($currentSessionId, sessionId);
export const getCurrentSessionId = () => get($currentSessionId);

export const setCurrentSession = (session: Session | null) => {
  set($currentSession, session);
  if (session) {
    set($currentSessionId, session.id);
  }
};

export const setIsStreaming = (streaming: boolean) => set($isStreaming, streaming);
export const setStreamingMessageId = (messageId: string | null) => set($streamingMessageId, messageId);

export const addMessage = (message: SessionMessage) => {
  const messages = get($messages);
  set($messages, [...messages, message]);
};

export const addMessages = (newMessages: SessionMessage[]) => {
  const messages = get($messages);
  const messageLimit = get($messageLimit);
  const allMessages = [...messages, ...newMessages];

  // Keep only last N messages
  set($messages, allMessages.slice(-messageLimit));
};

export const updateMessage = (messageId: string, updates: Partial<SessionMessage>) => {
  const messages = get($messages);
  set($messages, messages.map(msg =>
    msg.id === messageId ? { ...msg, ...updates } : msg
  ));
};

export const clearMessages = () => set($messages, []);

export const setRecentSessions = (sessions: Session[]) => set($recentSessions, sessions);
export const setSessionsLoading = (loading: boolean) => set($sessionsLoading, loading);

// Session CRUD operations (async, server-side)
export const createSession = async (provider: ProviderId, model: string, agentId?: string, enabledRuleIds?: string[]) => {
  const client = getTRPCClient();
  const session = await client.session.create.mutate({
    provider,
    model,
    agentId,
    enabledRuleIds,
  });

  // Set as current session (UI state only)
  setCurrentSessionId(session.id);

  // Emit event for other stores to react
  eventBus.emit('session:created', {
    sessionId: session.id,
    enabledRuleIds: session.enabledRuleIds || [],
  });

  return session.id;
};

export const updateSessionModel = async (sessionId: string, model: string) => {
  const client = getTRPCClient();
  await client.session.updateModel.mutate({ sessionId, model });
};

export const updateSessionProvider = async (sessionId: string, provider: ProviderId, model: string) => {
  const client = getTRPCClient();
  await client.session.updateProvider.mutate({ sessionId, provider, model });
};

export const updateSessionTitle = async (sessionId: string, title: string) => {
  const client = getTRPCClient();
  await client.session.updateTitle.mutate({ sessionId, title });

  // Update local state if this is the current session
  const currentSession = get($currentSession);
  if (currentSession && currentSession.id === sessionId) {
    setCurrentSession({
      ...currentSession,
      title,
    });
  }
};

export const updateSessionRules = async (sessionId: string, enabledRuleIds: string[]) => {
  const client = getTRPCClient();
  await client.session.updateRules.mutate({ sessionId, enabledRuleIds });

  // Emit event for other stores to react (if current session)
  if (get($currentSessionId) === sessionId) {
    eventBus.emit('session:rulesUpdated', { sessionId, enabledRuleIds });
  }
};

export const deleteSession = async (sessionId: string) => {
  // Clear if it's the current session
  if (get($currentSessionId) === sessionId) {
    setCurrentSessionId(null);
  }

  // Delete from database via tRPC
  const client = getTRPCClient();
  await client.session.delete.mutate({ sessionId });
};

// Message operations
export const addMessageAsync = async (params: {
  sessionId: string | null;
  role: 'user' | 'assistant';
  content: string | any[];
  attachments?: any[];
  usage?: any;
  finishReason?: string;
  metadata?: any;
  todoSnapshot?: any[];
  status?: 'active' | 'completed' | 'error' | 'abort';
  provider?: ProviderId;
  model?: string;
}) => {
  const client = getTRPCClient();

  // Normalize content for tRPC wire format
  const wireContent = typeof params.content === 'string'
    ? [{ type: 'text', content: params.content }]
    : params.content;

  // Persist via tRPC
  const result = await client.message.add.mutate({
    sessionId: params.sessionId || undefined,
    provider: params.provider,
    model: params.model,
    role: params.role,
    content: wireContent,
    attachments: params.attachments,
    usage: params.usage,
    finishReason: params.finishReason,
    metadata: params.metadata,
    todoSnapshot: params.todoSnapshot,
    status: params.status,
  });

  return result.sessionId;
};

// Hooks for React components
export const useCurrentSessionId = () => useStore($currentSessionId);
export const useCurrentSession = () => useStore($currentSession);
export const useIsStreaming = () => useStore($isStreaming);
export const useMessages = () => useStore($messages);
export const useMessageCount = () => useStore($messageCount);
export const useLastMessage = () => useStore($lastMessage);
export const useHasCurrentSession = () => useStore($hasCurrentSession);
export const useCurrentSessionTitle = () => useStore($currentSessionTitle);

// Setup event listeners
eventBus.on('streaming:started', () => {
  setIsStreaming(true);
});

eventBus.on('streaming:completed', () => {
  setIsStreaming(false);
});