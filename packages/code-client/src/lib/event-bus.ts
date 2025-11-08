/**
 * Event Bus - Lightweight pub/sub for decoupling stores
 *
 * Pure UI Client Architecture:
 * - Stores should not import each other (creates tight coupling)
 * - Use events for cross-store communication
 * - Each store subscribes to events it cares about
 *
 * Benefits:
 * - No circular dependencies
 * - Clear data flow
 * - Easy to trace which stores react to which events
 */

type EventCallback<T = unknown> = (data: T) => void;
type Unsubscribe = () => void;

/**
 * Event Types
 */
export interface AppEvents {
  // Session events
  'session:created': { sessionId: string; enabledRuleIds: string[] };
  'session:changed': { sessionId: string | null };
  'session:rulesUpdated': { sessionId: string; enabledRuleIds: string[] };

  // Settings events
  'settings:agentChanged': { agentId: string };
  'settings:rulesChanged': { ruleIds: string[] };
}

class EventBus {
  private listeners = new Map<keyof AppEvents, Set<EventCallback>>();

  /**
   * Subscribe to an event
   */
  on<K extends keyof AppEvents>(
    event: K,
    callback: EventCallback<AppEvents[K]>
  ): Unsubscribe {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    const callbacks = this.listeners.get(event)!;
    callbacks.add(callback as EventCallback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback as EventCallback);
      if (callbacks.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit an event
   */
  emit<K extends keyof AppEvents>(event: K, data: AppEvents[K]): void {
    const callbacks = this.listeners.get(event);
    if (!callbacks) return;

    // Call all listeners
    callbacks.forEach((callback) => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[EventBus] Error in ${event} listener:`, error);
      }
    });
  }

  /**
   * Remove all listeners (useful for cleanup in tests)
   */
  clear(): void {
    this.listeners.clear();
  }

  /**
   * Get listener count for an event (useful for debugging)
   */
  listenerCount(event: keyof AppEvents): number {
    return this.listeners.get(event)?.size || 0;
  }
}

// Singleton instance
export const eventBus = new EventBus();
