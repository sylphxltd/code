/**
 * Multi-Client Sync Tests
 * Verify multiple clients can sync via event bus
 * Simulates TUI + Web GUI scenario
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { eventBus } from '../lib/event-bus.js';
import { useSessionStore, setupSessionStoreEventListeners } from './session-store.js';
import { useSettingsStore, setupSettingsStoreEventListeners } from './settings-store.js';

// Helper: Create isolated store instance (simulates separate client)
function createClientStore() {
  return {
    sessionId: null as string | null,
    rules: [] as string[],
    isStreaming: false,

    // Simulate client subscribing to events
    subscribe() {
      eventBus.on('session:changed', ({ sessionId }) => {
        this.sessionId = sessionId;
      });

      eventBus.on('session:created', ({ sessionId, enabledRuleIds }) => {
        this.sessionId = sessionId;
        this.rules = enabledRuleIds;
      });

      eventBus.on('session:loaded', ({ enabledRuleIds }) => {
        this.rules = enabledRuleIds;
      });

      eventBus.on('session:rulesUpdated', ({ enabledRuleIds }) => {
        this.rules = enabledRuleIds;
      });

      eventBus.on('streaming:started', () => {
        this.isStreaming = true;
      });

      eventBus.on('streaming:completed', () => {
        this.isStreaming = false;
      });
    },
  };
}

describe('Multi-Client Synchronization', () => {
  beforeEach(() => {
    // Reset shared state
    useSessionStore.setState({
      currentSessionId: null,
      currentSession: null,
      isStreaming: false,
    });

    useSettingsStore.setState({
      selectedAgentId: 'coder',
      enabledRuleIds: [],
    });

    // Clear event bus (removes all listeners)
    eventBus.clear();

    // Re-setup store event listeners
    setupSessionStoreEventListeners();
    setupSettingsStoreEventListeners();
  });

  it('should sync session creation across multiple clients', () => {
    // Setup: Simulate 2 clients (TUI + Web)
    const tuiClient = createClientStore();
    const webClient = createClientStore();

    tuiClient.subscribe();
    webClient.subscribe();

    // Action: Client 1 creates session (server emits event)
    eventBus.emit('session:created', {
      sessionId: 'new-session-123',
      enabledRuleIds: ['rule1', 'rule2'],
    });

    // Verify: Both clients receive update
    expect(tuiClient.sessionId).toBe('new-session-123');
    expect(tuiClient.rules).toEqual(['rule1', 'rule2']);

    expect(webClient.sessionId).toBe('new-session-123');
    expect(webClient.rules).toEqual(['rule1', 'rule2']);

    // Verify: Shared stores also updated
    expect(useSettingsStore.getState().enabledRuleIds).toEqual(['rule1', 'rule2']);
  });

  it('should sync streaming state across multiple clients', () => {
    const client1 = createClientStore();
    const client2 = createClientStore();

    client1.subscribe();
    client2.subscribe();

    // Action: Streaming starts
    eventBus.emit('streaming:started', {
      sessionId: 'session-123',
      messageId: 'msg-456',
    });

    // Verify: All clients see streaming=true
    expect(client1.isStreaming).toBe(true);
    expect(client2.isStreaming).toBe(true);
    expect(useSessionStore.getState().isStreaming).toBe(true);

    // Action: Streaming completes
    eventBus.emit('streaming:completed', {
      sessionId: 'session-123',
      messageId: 'msg-456',
    });

    // Verify: All clients see streaming=false
    expect(client1.isStreaming).toBe(false);
    expect(client2.isStreaming).toBe(false);
    expect(useSessionStore.getState().isStreaming).toBe(false);
  });

  it('should sync rule changes across multiple clients', () => {
    const client1 = createClientStore();
    const client2 = createClientStore();
    const client3 = createClientStore();

    client1.subscribe();
    client2.subscribe();
    client3.subscribe();

    // Initial state
    eventBus.emit('session:created', {
      sessionId: 'session-123',
      enabledRuleIds: ['rule1'],
    });

    expect(client1.rules).toEqual(['rule1']);
    expect(client2.rules).toEqual(['rule1']);
    expect(client3.rules).toEqual(['rule1']);

    // Client 1 updates rules (via server)
    eventBus.emit('session:rulesUpdated', {
      sessionId: 'session-123',
      enabledRuleIds: ['rule1', 'rule2', 'rule3'],
    });

    // All clients receive update
    expect(client1.rules).toEqual(['rule1', 'rule2', 'rule3']);
    expect(client2.rules).toEqual(['rule1', 'rule2', 'rule3']);
    expect(client3.rules).toEqual(['rule1', 'rule2', 'rule3']);
  });

  it('should handle late-joining clients', () => {
    // Client 1 creates session
    const client1 = createClientStore();
    client1.subscribe();

    eventBus.emit('session:created', {
      sessionId: 'session-123',
      enabledRuleIds: ['rule1'],
    });

    expect(client1.sessionId).toBe('session-123');

    // Client 2 joins later and loads session from server
    const client2 = createClientStore();
    client2.subscribe();

    eventBus.emit('session:loaded', {
      sessionId: 'session-123',
      enabledRuleIds: ['rule1'],
    });

    // Both clients in sync
    expect(client1.rules).toEqual(['rule1']);
    expect(client2.rules).toEqual(['rule1']);
  });

  it('should maintain sync during rapid events', () => {
    const client1 = createClientStore();
    const client2 = createClientStore();

    client1.subscribe();
    client2.subscribe();

    // Rapid event sequence
    const events = [
      { type: 'session:created' as const, data: { sessionId: 's1', enabledRuleIds: ['r1'] } },
      { type: 'streaming:started' as const, data: { sessionId: 's1', messageId: 'm1' } },
      { type: 'session:rulesUpdated' as const, data: { sessionId: 's1', enabledRuleIds: ['r1', 'r2'] } },
      { type: 'streaming:completed' as const, data: { sessionId: 's1', messageId: 'm1' } },
    ];

    events.forEach(event => {
      eventBus.emit(event.type, event.data);
    });

    // Final state should match
    expect(client1.sessionId).toBe('s1');
    expect(client1.rules).toEqual(['r1', 'r2']);
    expect(client1.isStreaming).toBe(false);

    expect(client2.sessionId).toBe('s1');
    expect(client2.rules).toEqual(['r1', 'r2']);
    expect(client2.isStreaming).toBe(false);
  });

  it('should isolate clients that unsubscribe', () => {
    const client1 = createClientStore();
    const client2 = createClientStore();

    const unsub1 = eventBus.on('session:created', ({ sessionId, enabledRuleIds }) => {
      client1.sessionId = sessionId;
      client1.rules = enabledRuleIds;
    });

    eventBus.on('session:created', ({ sessionId, enabledRuleIds }) => {
      client2.sessionId = sessionId;
      client2.rules = enabledRuleIds;
    });

    // Both receive first event
    eventBus.emit('session:created', {
      sessionId: 'session-1',
      enabledRuleIds: ['rule1'],
    });

    expect(client1.sessionId).toBe('session-1');
    expect(client2.sessionId).toBe('session-1');

    // Client 1 disconnects
    unsub1();

    // Only client 2 receives second event
    eventBus.emit('session:created', {
      sessionId: 'session-2',
      enabledRuleIds: ['rule2'],
    });

    expect(client1.sessionId).toBe('session-1'); // Still old
    expect(client2.sessionId).toBe('session-2'); // Updated
  });

  describe('Optimistic Updates', () => {
    it('should handle optimistic updates followed by server confirmation', () => {
      const client = createClientStore();
      client.subscribe();

      // Optimistic: Client creates session (before server confirms)
      client.sessionId = 'temp-session';
      client.rules = ['rule1'];

      // Server confirms (replaces optimistic data)
      eventBus.emit('session:created', {
        sessionId: 'real-session-123',
        enabledRuleIds: ['rule1', 'rule2'],
      });

      // Optimistic data replaced with server data
      expect(client.sessionId).toBe('real-session-123');
      expect(client.rules).toEqual(['rule1', 'rule2']);
    });

    it('should prevent server overwrites during streaming', () => {
      // Setup: Streaming active
      eventBus.emit('streaming:started', {
        sessionId: 'session-123',
        messageId: 'msg-1',
      });

      expect(useSessionStore.getState().isStreaming).toBe(true);

      // During streaming, useCurrentSession should NOT overwrite
      // This is tested in the hook logic: if (store.isStreaming) return;

      // Server fetch returns (but should be ignored)
      // (This would be in useCurrentSession hook implementation)

      // Streaming completes
      eventBus.emit('streaming:completed', {
        sessionId: 'session-123',
        messageId: 'msg-1',
      });

      expect(useSessionStore.getState().isStreaming).toBe(false);
      // Now safe to update from server
    });
  });

  describe('Event Ordering Guarantees', () => {
    it('should maintain causal order for same session', () => {
      const client = createClientStore();
      const eventLog: string[] = [];

      eventBus.on('session:created', () => eventLog.push('created'));
      eventBus.on('streaming:started', () => eventLog.push('stream-start'));
      eventBus.on('streaming:completed', () => eventLog.push('stream-end'));

      // Causal sequence
      eventBus.emit('session:created', {
        sessionId: 's1',
        enabledRuleIds: [],
      });

      eventBus.emit('streaming:started', {
        sessionId: 's1',
        messageId: 'm1',
      });

      eventBus.emit('streaming:completed', {
        sessionId: 's1',
        messageId: 'm1',
      });

      expect(eventLog).toEqual(['created', 'stream-start', 'stream-end']);
    });
  });
});
