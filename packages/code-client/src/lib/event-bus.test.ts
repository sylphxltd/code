/**
 * Event Bus Tests
 * Verify pub/sub mechanism for store decoupling
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eventBus, type AppEvents } from './event-bus.js';

describe('EventBus', () => {
  beforeEach(() => {
    // Clear all listeners before each test
    eventBus.clear();
  });

  describe('Basic Pub/Sub', () => {
    it('should emit and receive events', () => {
      const callback = vi.fn();

      eventBus.on('session:changed', callback);
      eventBus.emit('session:changed', { sessionId: 'test-123' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ sessionId: 'test-123' });
    });

    it('should support multiple listeners for same event', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      eventBus.on('session:changed', callback1);
      eventBus.on('session:changed', callback2);
      eventBus.emit('session:changed', { sessionId: 'test-123' });

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should not call listeners for different events', () => {
      const callback = vi.fn();

      eventBus.on('session:changed', callback);
      eventBus.emit('session:created', { sessionId: 'test-123', enabledRuleIds: [] });

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('Unsubscribe', () => {
    it('should unsubscribe listener', () => {
      const callback = vi.fn();

      const unsubscribe = eventBus.on('session:changed', callback);
      eventBus.emit('session:changed', { sessionId: 'test-1' });

      unsubscribe();
      eventBus.emit('session:changed', { sessionId: 'test-2' });

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith({ sessionId: 'test-1' });
    });

    it('should clean up event when last listener unsubscribes', () => {
      const callback = vi.fn();

      const unsubscribe = eventBus.on('session:changed', callback);
      expect(eventBus.listenerCount('session:changed')).toBe(1);

      unsubscribe();
      expect(eventBus.listenerCount('session:changed')).toBe(0);
    });

    it('should not affect other listeners on unsubscribe', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      const unsubscribe1 = eventBus.on('session:changed', callback1);
      eventBus.on('session:changed', callback2);

      unsubscribe1();
      eventBus.emit('session:changed', { sessionId: 'test-123' });

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Handling', () => {
    it('should catch listener errors and continue', () => {
      const errorCallback = vi.fn(() => {
        throw new Error('Listener error');
      });
      const successCallback = vi.fn();

      // Spy on console.error to verify error logging
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      eventBus.on('session:changed', errorCallback);
      eventBus.on('session:changed', successCallback);

      eventBus.emit('session:changed', { sessionId: 'test-123' });

      // Error logged but other listeners still called
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(successCallback).toHaveBeenCalledTimes(1);

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Event Types', () => {
    it('should handle session:created event', () => {
      const callback = vi.fn();

      eventBus.on('session:created', callback);
      eventBus.emit('session:created', {
        sessionId: 'new-session',
        enabledRuleIds: ['rule1', 'rule2']
      });

      expect(callback).toHaveBeenCalledWith({
        sessionId: 'new-session',
        enabledRuleIds: ['rule1', 'rule2'],
      });
    });

    it('should handle session:rulesUpdated event', () => {
      const callback = vi.fn();

      eventBus.on('session:rulesUpdated', callback);
      eventBus.emit('session:rulesUpdated', {
        sessionId: 'session-123',
        enabledRuleIds: ['rule3']
      });

      expect(callback).toHaveBeenCalledWith({
        sessionId: 'session-123',
        enabledRuleIds: ['rule3'],
      });
    });

    it('should handle streaming:started event', () => {
      const callback = vi.fn();

      eventBus.on('streaming:started', callback);
      eventBus.emit('streaming:started', {
        sessionId: 'session-123',
        messageId: 'msg-456'
      });

      expect(callback).toHaveBeenCalledWith({
        sessionId: 'session-123',
        messageId: 'msg-456',
      });
    });

    it('should handle streaming:completed event', () => {
      const callback = vi.fn();

      eventBus.on('streaming:completed', callback);
      eventBus.emit('streaming:completed', {
        sessionId: 'session-123',
        messageId: 'msg-456'
      });

      expect(callback).toHaveBeenCalledWith({
        sessionId: 'session-123',
        messageId: 'msg-456',
      });
    });
  });

  describe('Listener Count', () => {
    it('should track listener count correctly', () => {
      expect(eventBus.listenerCount('session:changed')).toBe(0);

      const unsubscribe1 = eventBus.on('session:changed', vi.fn());
      expect(eventBus.listenerCount('session:changed')).toBe(1);

      const unsubscribe2 = eventBus.on('session:changed', vi.fn());
      expect(eventBus.listenerCount('session:changed')).toBe(2);

      unsubscribe1();
      expect(eventBus.listenerCount('session:changed')).toBe(1);

      unsubscribe2();
      expect(eventBus.listenerCount('session:changed')).toBe(0);
    });
  });

  describe('Clear', () => {
    it('should clear all listeners', () => {
      eventBus.on('session:changed', vi.fn());
      eventBus.on('session:created', vi.fn());
      eventBus.on('streaming:started', vi.fn());

      expect(eventBus.listenerCount('session:changed')).toBe(1);
      expect(eventBus.listenerCount('session:created')).toBe(1);
      expect(eventBus.listenerCount('streaming:started')).toBe(1);

      eventBus.clear();

      expect(eventBus.listenerCount('session:changed')).toBe(0);
      expect(eventBus.listenerCount('session:created')).toBe(0);
      expect(eventBus.listenerCount('streaming:started')).toBe(0);
    });
  });
});
