/**
 * System Message Trigger Registry
 * Hook-based trigger system for registering and managing system messages
 *
 * Design:
 * - Each trigger is a hook that can be registered/unregistered
 * - Uses session flags to track state changes
 * - Triggers on state transitions (not just thresholds)
 * - Bidirectional notifications (enter + exit states)
 */

import type { Session } from "../../types/session.types.js";
import type { MessageRepository } from "../../database/message-repository.js";

/**
 * Trigger result - message to insert and flag updates
 */
export interface TriggerResult {
	messageType: string; // Trigger type (e.g., 'context-warning-80', 'resource-warning-memory')
	message: string; // Full message content
	flagUpdates: Record<string, boolean>;
}

/**
 * Trigger context - all data available to triggers
 */
export interface TriggerContext {
	session: Session;
	messageRepository: MessageRepository;
	contextTokens?: { current: number; max: number };
}

/**
 * Trigger hook function
 * Returns null if no action needed, or TriggerResult to insert message
 */
export type TriggerHook = (context: TriggerContext) => Promise<TriggerResult | null>;

/**
 * Trigger registration
 */
export interface TriggerRegistration {
	id: string;
	name: string;
	description: string;
	priority: number; // Lower = higher priority (0 = highest)
	enabled: boolean;
	hook: TriggerHook;
}

/**
 * Trigger Registry
 * Manages all registered triggers
 */
class TriggerRegistry {
	private triggers = new Map<string, TriggerRegistration>();

	/**
	 * Register a trigger
	 */
	register(trigger: TriggerRegistration): void {
		this.triggers.set(trigger.id, trigger);
	}

	/**
	 * Unregister a trigger
	 */
	unregister(triggerId: string): void {
		this.triggers.delete(triggerId);
	}

	/**
	 * Enable/disable a trigger
	 */
	setEnabled(triggerId: string, enabled: boolean): void {
		const trigger = this.triggers.get(triggerId);
		if (trigger) {
			trigger.enabled = enabled;
		}
	}

	/**
	 * Get all registered triggers
	 */
	getAll(): TriggerRegistration[] {
		return Array.from(this.triggers.values());
	}

	/**
	 * Get enabled triggers sorted by priority
	 */
	getEnabled(): TriggerRegistration[] {
		return Array.from(this.triggers.values())
			.filter((t) => t.enabled)
			.sort((a, b) => a.priority - b.priority);
	}

	/**
	 * Check all enabled triggers
	 * Returns ALL triggers that need to fire (sorted by priority)
	 */
	async checkAll(context: TriggerContext): Promise<TriggerResult[]> {
		const enabledTriggers = this.getEnabled();
		const firedTriggers: TriggerResult[] = [];

		for (const trigger of enabledTriggers) {
			try {
				const result = await trigger.hook(context);
				if (result) {
					firedTriggers.push(result);
				}
			} catch (error) {
				console.error(`[TriggerRegistry] Trigger ${trigger.id} failed:`, error);
				// Continue checking other triggers
			}
		}

		return firedTriggers;
	}
}

/**
 * Global trigger registry instance
 */
export const triggerRegistry: TriggerRegistry = new TriggerRegistry();

/**
 * Helper to get session flags safely
 */
export function getSessionFlags(session: Session): Record<string, boolean> {
	return session.flags || {};
}

/**
 * Helper to check if flag is set
 */
export function isFlagSet(session: Session, flagName: string): boolean {
	const flags = getSessionFlags(session);
	return flags[flagName] === true;
}
