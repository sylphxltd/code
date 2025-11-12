/**
 * Keyboard Navigation Hooks
 *
 * NOTE: Most keyboard input handling is now managed by the centralized
 * InputModeManager system. See src/hooks/input-manager/ for the new implementation.
 *
 * These remaining hooks handle specific cases:
 * - useAbortHandler: ESC to abort streaming
 * - useKeyboardShortcuts: Double-ESC to clear input
 */

export { useAbortHandler } from "./useAbortHandler.js";
export type { UseAbortHandlerOptions } from "./useAbortHandler.js";

export { useKeyboardShortcuts } from "./useKeyboardShortcuts.js";
export type { UseKeyboardShortcutsOptions } from "./useKeyboardShortcuts.js";
