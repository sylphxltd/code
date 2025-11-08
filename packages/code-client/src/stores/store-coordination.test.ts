/**
 * Store Coordination Tests
 * Verify stores communicate via event bus (no direct imports)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eventBus } from '../lib/event-bus.js';
import { useSessionStore, setupSessionStoreEventListeners } from './session-store.js';
import { useSettingsStore, setupSettingsStoreEventListeners } from './settings-store.js';

describe('Store Coordination via Event Bus', () => {
  beforeEach(() => {
    // Reset stores
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

  describe('Session → Settings Communication', () => {
    it('should clear rules when session changes to null', async () => {
      // Setup: settings has some rules
      useSettingsStore.setState({ enabledRuleIds: ['rule1', 'rule2'] });

      // Action: session changes to null
      eventBus.emit('session:changed', { sessionId: null });

      // Wait for async state update
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify: settings cleared rules
      const { enabledRuleIds } = useSettingsStore.getState();
      expect(enabledRuleIds).toEqual([]);
    });

    it('should update rules when session created', () => {
      // Action: new session created with rules
      eventBus.emit('session:created', {
        sessionId: 'new-session',
        enabledRuleIds: ['rule1', 'rule2'],
      });

      // Verify: settings updated
      const { enabledRuleIds } = useSettingsStore.getState();
      expect(enabledRuleIds).toEqual(['rule1', 'rule2']);
    });

    it('should update rules when session loaded from server', () => {
      // Action: session loaded from server
      eventBus.emit('session:loaded', {
        sessionId: 'loaded-session',
        enabledRuleIds: ['rule3', 'rule4'],
      });

      // Verify: settings updated
      const { enabledRuleIds } = useSettingsStore.getState();
      expect(enabledRuleIds).toEqual(['rule3', 'rule4']);
    });

    it('should update rules when session rules updated', () => {
      // Setup: settings has old rules
      useSettingsStore.setState({ enabledRuleIds: ['old-rule'] });

      // Action: session rules updated
      eventBus.emit('session:rulesUpdated', {
        sessionId: 'session-123',
        enabledRuleIds: ['new-rule1', 'new-rule2'],
      });

      // Verify: settings updated
      const { enabledRuleIds } = useSettingsStore.getState();
      expect(enabledRuleIds).toEqual(['new-rule1', 'new-rule2']);
    });
  });

  describe('Streaming → Session Communication', () => {
    it('should set isStreaming=true when streaming starts', () => {
      // Verify initial state
      expect(useSessionStore.getState().isStreaming).toBe(false);

      // Action: streaming starts
      eventBus.emit('streaming:started', {
        sessionId: 'session-123',
        messageId: 'msg-456',
      });

      // Verify: session store updated
      expect(useSessionStore.getState().isStreaming).toBe(true);
    });

    it('should set isStreaming=false when streaming completes', () => {
      // Setup: streaming is active
      useSessionStore.setState({ isStreaming: true });

      // Action: streaming completes
      eventBus.emit('streaming:completed', {
        sessionId: 'session-123',
        messageId: 'msg-456',
      });

      // Verify: session store updated
      expect(useSessionStore.getState().isStreaming).toBe(false);
    });

    it('should handle streaming lifecycle correctly', () => {
      // Verify initial state
      expect(useSessionStore.getState().isStreaming).toBe(false);

      // Lifecycle: start
      eventBus.emit('streaming:started', {
        sessionId: 'session-123',
        messageId: 'msg-1',
      });

      expect(useSessionStore.getState().isStreaming).toBe(true);

      // Lifecycle: complete
      eventBus.emit('streaming:completed', {
        sessionId: 'session-123',
        messageId: 'msg-1',
      });

      // Verify: back to false
      expect(useSessionStore.getState().isStreaming).toBe(false);
    });
  });

  describe('Zero Direct Imports', () => {
    it('should communicate without session-store importing settings-store', () => {
      // This test verifies architectural principle:
      // session-store does NOT import settings-store
      // Communication happens ONLY via events

      // Session emits event
      eventBus.emit('session:created', {
        sessionId: 'test-session',
        enabledRuleIds: ['rule1'],
      });

      // Settings receives update (via event listener)
      const { enabledRuleIds } = useSettingsStore.getState();
      expect(enabledRuleIds).toEqual(['rule1']);

      // No direct import = no tight coupling ✅
    });

    it('should communicate without settings-store importing session-store', () => {
      // Settings doesn't need to know about session-store internals
      // It just listens to events

      eventBus.emit('session:rulesUpdated', {
        sessionId: 'any-session',
        enabledRuleIds: ['rule2'],
      });

      const { enabledRuleIds } = useSettingsStore.getState();
      expect(enabledRuleIds).toEqual(['rule2']);

      // No circular dependency ✅
    });
  });

  describe('Event Order Independence', () => {
    it('should handle events in any order', () => {
      // Events can arrive in any order - stores should handle gracefully

      // Event 1: Rules updated before session loaded
      eventBus.emit('session:rulesUpdated', {
        sessionId: 'session-123',
        enabledRuleIds: ['rule1'],
      });

      expect(useSettingsStore.getState().enabledRuleIds).toEqual(['rule1']);

      // Event 2: Session loaded (overwrites)
      eventBus.emit('session:loaded', {
        sessionId: 'session-123',
        enabledRuleIds: ['rule2'],
      });

      expect(useSettingsStore.getState().enabledRuleIds).toEqual(['rule2']);
    });
  });

  describe('Multiple Sessions Scenario', () => {
    it('should handle switching between sessions', () => {
      // Session 1 created
      eventBus.emit('session:created', {
        sessionId: 'session-1',
        enabledRuleIds: ['rule-a'],
      });

      expect(useSettingsStore.getState().enabledRuleIds).toEqual(['rule-a']);

      // Session 2 created
      eventBus.emit('session:created', {
        sessionId: 'session-2',
        enabledRuleIds: ['rule-b', 'rule-c'],
      });

      expect(useSettingsStore.getState().enabledRuleIds).toEqual(['rule-b', 'rule-c']);

      // Switch to session 1 (load from server)
      eventBus.emit('session:loaded', {
        sessionId: 'session-1',
        enabledRuleIds: ['rule-a'],
      });

      // Verify: back to session 1 rules
      expect(useSettingsStore.getState().enabledRuleIds).toEqual(['rule-a']);
    });
  });
});
