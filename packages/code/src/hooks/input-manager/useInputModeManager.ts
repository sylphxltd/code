/**
 * Input Mode Manager Hook
 *
 * Central coordinator for all input handlers.
 * Routes keyboard events to the appropriate handler based on current mode.
 */

import { useInput } from "ink";
import { useMemo, useRef } from "react";
import type { InputHandler, InputModeContext, InputModeManagerConfig } from "./types.js";

export interface UseInputModeManagerProps {
	/** Input mode context */
	context: InputModeContext;

	/** Array of input handlers (order determines priority) */
	handlers: InputHandler[];

	/** Configuration */
	config?: InputModeManagerConfig;
}

/**
 * Hook to manage input routing to handlers
 *
 * Responsibilities:
 * - Find active handler based on current mode
 * - Route keyboard events to appropriate handler
 * - Handle event consumption (prevent propagation)
 * - Debug logging and monitoring
 *
 * @example
 * ```tsx
 * const handlers = useMemo(() => [
 *   new SelectionModeHandler({ ... }),
 *   new CommandAutocompleteModeHandler({ ... }),
 *   // ... other handlers
 * ], [deps]);
 *
 * useInputModeManager({
 *   context: inputModeContext,
 *   handlers,
 *   config: { debug: true },
 * });
 * ```
 */
export function useInputModeManager(props: UseInputModeManagerProps) {
	const { context, handlers, config = {} } = props;
	const { debug = false } = config;

	// Track event counts for debugging
	const eventCountRef = useRef({ handled: 0, unhandled: 0 });

	// Sort handlers by priority (highest first)
	const sortedHandlers = useMemo(() => {
		return [...handlers].sort((a, b) => (b.priority || 0) - (a.priority || 0));
	}, [handlers]);

	// Check if there's any active handler for current context
	const hasActiveHandler = sortedHandlers.some((h) => h.isActive(context));

	useInput(
		async (char, key) => {
			// Find active handler
			const activeHandler = sortedHandlers.find((h) => h.isActive(context));

			if (!activeHandler) {
				if (debug) {
					console.warn(
						`[InputModeManager] No active handler for mode: ${context.mode}`,
						{ char, key },
					);
				}
				eventCountRef.current.unhandled++;
				return false;
			}

			// Delegate to handler
			try {
				const consumed = await activeHandler.handleInput(char, key, context);

				// Debug logging
				if (debug && consumed) {
					eventCountRef.current.handled++;
					const keyInfo = getKeyInfo(char, key);
					console.log(
						`[InputModeManager:${context.mode}] Key consumed by ${activeHandler.constructor.name}: ${keyInfo}`,
					);
				}

				if (debug && !consumed) {
					eventCountRef.current.unhandled++;
					const keyInfo = getKeyInfo(char, key);
					console.log(
						`[InputModeManager:${context.mode}] Key NOT consumed by ${activeHandler.constructor.name}: ${keyInfo}`,
					);
				}

				return consumed;
			} catch (error) {
				console.error(
					`[InputModeManager] Error in handler ${activeHandler.constructor.name}:`,
					error,
				);
				return false;
			}
		},
		{ isActive: hasActiveHandler }, // Only active when there's a handler for current mode
	);

	// Expose event counts in debug mode
	if (debug) {
		// Log stats periodically
		const statsInterval = setInterval(() => {
			const { handled, unhandled } = eventCountRef.current;
			const total = handled + unhandled;
			if (total > 0) {
				console.log(
					`[InputModeManager] Stats: ${handled} handled, ${unhandled} unhandled (${((handled / total) * 100).toFixed(1)}% handled)`,
				);
			}
		}, 10000); // Every 10 seconds

		// Cleanup
		return () => clearInterval(statsInterval);
	}
}

/**
 * Get human-readable key info for logging
 */
function getKeyInfo(char: string, key: any): string {
	if (key.upArrow) return "↑";
	if (key.downArrow) return "↓";
	if (key.leftArrow) return "←";
	if (key.rightArrow) return "→";
	if (key.return) return "Enter";
	if (key.escape) return "Esc";
	if (key.tab) return "Tab";
	if (key.backspace) return "Backspace";
	if (key.delete) return "Delete";
	if (key.pageUp) return "PageUp";
	if (key.pageDown) return "PageDown";
	if (char === " ") return "Space";
	if (char) return `'${char}'`;
	return "unknown";
}
