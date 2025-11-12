/**
 * Feature Flags
 *
 * Central configuration for experimental features and gradual rollouts.
 * This allows us to toggle features on/off without code changes.
 */

/**
 * Input Mode Management System
 *
 * New centralized input handling system that replaces individual hooks
 * with a coordinated mode-based architecture.
 *
 * When enabled:
 * - Uses InputModeManager with explicit modes
 * - All input handlers unified under single system
 * - Better conflict prevention and debugging
 *
 * When disabled:
 * - Uses legacy individual hooks (useSelectionMode, etc.)
 * - Existing behavior maintained
 *
 * All handlers implemented: Selection, CommandAutocomplete, PendingCommand, FileNavigation
 */
export const USE_NEW_INPUT_MANAGER = true;

/**
 * Debug mode for input management
 * Enables verbose logging of input events and mode transitions
 */
export const DEBUG_INPUT_MANAGER = false;

/**
 * Track input mode history
 * Useful for debugging mode transition issues
 */
export const TRACK_INPUT_MODE_HISTORY = false;
