/**
 * Base Input Handler
 *
 * Abstract base class for all input mode handlers.
 * Provides common utilities and enforces consistent interface.
 */

import type { Key } from "ink";
import { InputMode, type InputHandler, type InputModeContext } from "../types.js";

/**
 * Abstract base class for input handlers
 *
 * Subclasses must:
 * - Define their mode
 * - Implement handleInput method
 *
 * Optionally can override:
 * - isActive (default: checks if context.mode matches handler's mode)
 * - priority (default: 0)
 */
export abstract class BaseInputHandler implements InputHandler {
	/** The mode this handler is responsible for */
	abstract mode: InputMode;

	/** Priority for conflict resolution (higher = checked first) */
	priority = 0;

	/**
	 * Check if this handler should be active
	 * Default implementation: active when context.mode matches this handler's mode
	 *
	 * Override this for custom activation logic
	 */
	isActive(context: InputModeContext): boolean {
		return context.mode === this.mode;
	}

	/**
	 * Handle keyboard input
	 * Must be implemented by subclasses
	 */
	abstract handleInput(char: string, key: Key, context: InputModeContext): boolean | Promise<boolean>;

	// ============================================================================
	// Common Utilities
	// ============================================================================

	/**
	 * Handle arrow up key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleArrowUp(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Handle arrow down key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleArrowDown(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Handle arrow left key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleArrowLeft(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Handle arrow right key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleArrowRight(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Handle Enter key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleEnter(callback: () => void | Promise<void>): boolean | Promise<boolean> {
		const result = callback();
		if (result instanceof Promise) {
			return result.then(() => true).catch((error) => {
				console.error("[BaseHandler] Unhandled error in handleEnter:", error);
				console.error("[BaseHandler] Stack trace:", error?.stack);
				return true; // Still consume the event
			});
		}
		return true;
	}

	/**
	 * Handle Escape key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleEscape(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Handle Tab key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleTab(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Handle Space key
	 * @param callback - Function to execute
	 * @returns true (event consumed)
	 */
	protected handleSpace(callback: () => void): boolean {
		callback();
		return true;
	}

	/**
	 * Check if a modifier key is pressed
	 */
	protected hasModifier(key: Key): boolean {
		return !!(key.ctrl || key.shift || key.meta);
	}

	/**
	 * Log debug message if debug mode is enabled
	 */
	protected log(message: string, data?: any): void {
		console.log(`[${this.mode}] ${message}`, data || "");
	}

	/**
	 * Check if key is a navigation key (arrows, tab, etc.)
	 */
	protected isNavigationKey(key: Key): boolean {
		return !!(
			key.upArrow ||
			key.downArrow ||
			key.leftArrow ||
			key.rightArrow ||
			key.tab ||
			key.pageUp ||
			key.pageDown
		);
	}

	/**
	 * Check if key is an action key (enter, space, etc.)
	 */
	protected isActionKey(key: Key): boolean {
		return !!(key.return || key.escape);
	}
}
