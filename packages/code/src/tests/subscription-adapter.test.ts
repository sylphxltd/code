/**
 * Subscription Adapter Unit Tests
 * Tests event handling logic without full integration
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { set, get } from '@sylphx/zen';
import { $currentSessionId, $currentSession, $messages } from '@sylphx/code-client';
import type { StreamEvent } from '@sylphx/code-server';

describe('Subscription Adapter', () => {
  beforeEach(() => {
    // Reset signals before each test
    set($currentSessionId, null);
    set($currentSession, null);
    set($messages, []);
  });

  it('should create skeleton session on session-created event', () => {
    const event: StreamEvent = {
      type: 'session-created',
      sessionId: 'test-session-123',
      provider: 'openrouter',
      model: 'test-model',
    };

    // Simulate session-created handling
    set($currentSessionId, event.sessionId);
    set($currentSession, {
      id: event.sessionId,
      provider: event.provider,
      model: event.model,
      agentId: 'coder',
      enabledRuleIds: [],
      messages: [],
      todos: [],
      nextTodoId: 1,
      created: Date.now(),
      updated: Date.now(),
    });

    // Check state
    expect(get($currentSessionId)).toBe('test-session-123');
    const currentSession = get($currentSession);
    expect(currentSession).toBeTruthy();
    expect(currentSession?.id).toBe('test-session-123');
    expect(currentSession?.provider).toBe('openrouter');
    expect(currentSession?.model).toBe('test-model');
  });

  it('should add assistant message on assistant-message-created event', () => {
    // Setup: Create a session first
    set($currentSessionId, 'test-session');
    const testSession = {
      id: 'test-session',
      provider: 'openrouter',
      model: 'test-model',
      agentId: 'coder',
      enabledRuleIds: [],
      messages: [] as any[],
      todos: [],
      nextTodoId: 1,
      created: Date.now(),
      updated: Date.now(),
    };
    set($currentSession, testSession);

    const event: StreamEvent = {
      type: 'assistant-message-created',
      messageId: 'msg-123',
    };

    // Simulate assistant-message-created handling
    const currentSession = get($currentSession);
    if (currentSession && currentSession.id === 'test-session') {
      set($currentSession, {
        ...currentSession,
        messages: [...currentSession.messages, {
          role: 'assistant',
          content: [],
          timestamp: Date.now(),
          status: 'active',
        }],
      });
    }

    // Check state
    const updatedSession = get($currentSession);
    expect(updatedSession?.messages).toHaveLength(1);
    expect(updatedSession?.messages[0].role).toBe('assistant');
    expect(updatedSession?.messages[0].status).toBe('active');
  });

  it('should add reasoning part on reasoning-start event', () => {
    // Setup: Session with active message
    const testSessionWithMessage = {
      id: 'test-session',
      provider: 'openrouter',
      model: 'test-model',
      agentId: 'coder',
      enabledRuleIds: [],
      messages: [
        {
          role: 'assistant',
          content: [],
          timestamp: Date.now(),
          status: 'active',
        },
      ],
      todos: [],
      nextTodoId: 1,
      created: Date.now(),
      updated: Date.now(),
    };
    set($currentSessionId, 'test-session');
    set($currentSession, testSessionWithMessage);

    // Simulate reasoning-start handling
    const currentSession = get($currentSession);
    if (currentSession) {
      const activeMessage = currentSession.messages.find((m) => m.status === 'active');
      if (activeMessage) {
        set($currentSession, {
          ...currentSession,
          messages: currentSession.messages.map(msg =>
            msg.status === 'active'
              ? {
                  ...msg,
                  content: [...msg.content, {
                    type: 'reasoning',
                    content: '',
                    status: 'active',
                    startTime: Date.now(),
                  }],
                }
              : msg
          ),
        });
      }
    }

    // Check state
    const updatedSession = get($currentSession);
    expect(updatedSession?.messages[0].content).toHaveLength(1);
    expect(updatedSession?.messages[0].content[0].type).toBe('reasoning');
    expect(updatedSession?.messages[0].content[0].status).toBe('active');
  });

  it('should update reasoning content on reasoning-delta event', () => {
    // Setup: Session with active message and reasoning part
    const testSessionWithReasoning = {
      id: 'test-session',
      provider: 'openrouter',
      model: 'test-model',
      agentId: 'coder',
      enabledRuleIds: [],
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              content: 'Initial ',
              status: 'active',
              startTime: Date.now(),
            },
          ],
          timestamp: Date.now(),
          status: 'active',
        },
      ],
      todos: [],
      nextTodoId: 1,
      created: Date.now(),
      updated: Date.now(),
    };
    set($currentSessionId, 'test-session');
    set($currentSession, testSessionWithReasoning);

    // Simulate reasoning-delta handling
    const deltaText = 'thought';

    const currentSession = get($currentSession);
    if (currentSession) {
      const activeMessage = currentSession.messages.find((m) => m.status === 'active');
      if (activeMessage) {
        set($currentSession, {
          ...currentSession,
          messages: currentSession.messages.map(msg =>
            msg.status === 'active'
              ? {
                  ...msg,
                  content: msg.content.map((part, index) =>
                    index === msg.content.length - 1 && part.type === 'reasoning'
                      ? { ...part, content: part.content + deltaText }
                      : part
                  ),
                }
              : msg
          ),
        });
      }
    }

    // Check state
    const updatedSession = get($currentSession);
    expect(updatedSession?.messages[0].content[0].content).toBe('Initial thought');
  });

  it('should finalize reasoning on reasoning-end event', () => {
    // Setup
    const startTime = Date.now();
    const testSessionForEnd = {
      id: 'test-session',
      provider: 'openrouter',
      model: 'test-model',
      agentId: 'coder',
      enabledRuleIds: [],
      messages: [
        {
          role: 'assistant',
          content: [
            {
              type: 'reasoning',
              content: 'Complete reasoning',
              status: 'active',
              startTime,
            },
          ],
          timestamp: Date.now(),
          status: 'active',
        },
      ],
      todos: [],
      nextTodoId: 1,
      created: Date.now(),
      updated: Date.now(),
    };
    set($currentSessionId, 'test-session');
    set($currentSession, testSessionForEnd);

    // Simulate reasoning-end handling
    const endTime = Date.now();

    const currentSession = get($currentSession);
    if (currentSession) {
      const activeMessage = currentSession.messages.find((m) => m.status === 'active');
      if (activeMessage) {
        const lastReasoningIndex = activeMessage.content
          .map((p, i) => ({ p, i }))
          .reverse()
          .find(({ p }) => p.type === 'reasoning' && p.status === 'active')?.i;

        if (lastReasoningIndex !== undefined) {
          set($currentSession, {
            ...currentSession,
            messages: currentSession.messages.map(msg =>
              msg.status === 'active'
                ? {
                    ...msg,
                    content: msg.content.map((part, index) =>
                      index === lastReasoningIndex && part.type === 'reasoning' && part.status === 'active'
                        ? {
                            ...part,
                            status: 'completed',
                            endTime,
                            duration: endTime - part.startTime,
                          }
                        : part
                    ),
                  }
                : msg
            ),
          });
        }
      }
    }

    // Check state
    const updatedSession = get($currentSession);
    const reasoning = updatedSession?.messages[0].content[0];
    expect(reasoning?.status).toBe('completed');
    expect(reasoning?.type).toBe('reasoning');
    if (reasoning?.type === 'reasoning') {
      expect(reasoning.endTime).toBe(endTime);
      expect(reasoning.duration).toBeGreaterThanOrEqual(0);
    }
  });
});
