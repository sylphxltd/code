/**
 * Event Bus for Cross-Domain Communication
 * Enables loose coupling between different signal domains
 */

type EventCallback<T = any> = (data: T) => void;

class EventBus {
  private events = new Map<string, Set<EventCallback>>();

  on<T = any>(event: string, callback: EventCallback<T>): () => void {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }

    const callbacks = this.events.get(event)!;
    callbacks.add(callback);

    // Return unsubscribe function
    return () => {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.events.delete(event);
      }
    };
  }

  emit<T = any>(event: string, data: T): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.forEach(callback => callback(data));
    }
  }

  off(event: string, callback: EventCallback): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  clear(): void {
    this.events.clear();
  }
}

export const eventBus = new EventBus();

// Type-safe event definitions
export interface SessionEvents {
  'session:started': { sessionId: string };
  'session:loaded': { sessionId: string };
  'session:title-updated': { sessionId: string; title: string };
  'session:deleted': { sessionId: string };
}

export interface AIEvents {
  'config:loaded': { config: any };
  'provider:selected': { providerId: string };
  'model:selected': { providerId: string; modelId: string };
  'config:error': { error: string };
}

export interface UIEvents {
  'navigation:changed': { from: string; to: string };
  'loading:started': { context: string };
  'loading:finished': { context: string };
  'error:shown': { error: string };
  'error:cleared': {};
}

export type AppEvents = SessionEvents & AIEvents & UIEvents;

// Type-safe event emitters
export const emitSessionEvent = <K extends keyof SessionEvents>(
  event: K,
  data: SessionEvents[K]
) => eventBus.emit(event, data);

export const emitAIEvent = <K extends keyof AIEvents>(
  event: K,
  data: AIEvents[K]
) => eventBus.emit(event, data);

export const emitUIEvent = <K extends keyof UIEvents>(
  event: K,
  data: UIEvents[K]
) => eventBus.emit(event, data);