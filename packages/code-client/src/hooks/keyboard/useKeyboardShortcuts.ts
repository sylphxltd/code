/**
 * Keyboard Shortcuts Hook
 * Handles general keyboard shortcuts (double-ESC to clear)
 *
 * Single Responsibility: Global keyboard shortcuts
 */

import { useInput } from "ink";
import type React from "react";

export interface UseKeyboardShortcutsOptions {
	isStreaming: boolean;
	input: string;
	lastEscapeTime: React.MutableRefObject<number>;
	setInput: (value: string) => void;
	setCursor: (value: number) => void;
	setShowEscHint: (value: boolean) => void;
}

/**
 * Handles global keyboard shortcuts
 * - Double ESC → clear input completely
 * - Single ESC → show hint (if input exists)
 */
export function useKeyboardShortcuts(options: UseKeyboardShortcutsOptions) {
	const { isStreaming, input, lastEscapeTime, setInput, setCursor, setShowEscHint } = options;

	useInput(
		(char, key) => {
			// Skip if streaming (abort handler takes priority)
			if (isStreaming) {
				return false;
			}

			// Double ESC to clear input (works in any mode)
			if (key.escape) {
				const now = Date.now();
				const timeSinceLastEscape = now - lastEscapeTime.current;

				if (timeSinceLastEscape < 500 && lastEscapeTime.current > 0) {
					// Double ESC detected - clear input
					setInput("");
					setCursor(0);
					lastEscapeTime.current = 0;
					setShowEscHint(false);
					return true; // Consumed
				}

				// Single ESC - show hint and update timestamp
				if (input.length > 0) {
					setShowEscHint(true);
					// Auto-hide hint after 2 seconds
					setTimeout(() => {
						setShowEscHint(false);
					}, 2000);
				}
				lastEscapeTime.current = now;
				return false; // Not consumed - let other handlers process
			}

			return false; // Not our concern
		},
		{ isActive: true },
	);
}
