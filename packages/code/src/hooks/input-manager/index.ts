/**
 * Input Mode Manager
 *
 * Centralized keyboard input management system with explicit modes.
 *
 * @example
 * ```tsx
 * import { useInputMode, useInputModeManager, InputMode } from './hooks/input-manager';
 * import { SelectionModeHandler } from './hooks/input-manager/handlers/SelectionModeHandler';
 *
 * function MyComponent() {
 *   // Setup mode context
 *   const inputMode = useInputMode({
 *     pendingInput,
 *     input,
 *     pendingCommand,
 *     debug: true,
 *   });
 *
 *   // Create handlers
 *   const handlers = useMemo(() => [
 *     new SelectionModeHandler({ ... }),
 *     // ... other handlers
 *   ], [deps]);
 *
 *   // Setup manager
 *   useInputModeManager({
 *     context: inputMode,
 *     handlers,
 *     config: { debug: true },
 *   });
 *
 *   return <div>Current mode: {inputMode.mode}</div>;
 * }
 * ```
 */

// Core types and enums
export { InputMode } from "./types.js";
export type {
	InputModeContext,
	InputHandler,
	ModeTransition,
	InputModeManagerConfig,
} from "./types.js";

// Hooks
export { useInputMode } from "./useInputMode.js";
export type { UseInputModeProps, UseInputModeReturn } from "./useInputMode.js";

export { useInputModeManager } from "./useInputModeManager.js";
export type { UseInputModeManagerProps } from "./useInputModeManager.js";

// Base handler
export { BaseInputHandler } from "./handlers/BaseHandler.js";

// Concrete handlers
export { SelectionModeHandler } from "./handlers/SelectionModeHandler.js";
export type { SelectionModeHandlerDeps } from "./handlers/SelectionModeHandler.js";

export { CommandAutocompleteModeHandler } from "./handlers/CommandAutocompleteModeHandler.js";
export type { CommandAutocompleteModeHandlerDeps } from "./handlers/CommandAutocompleteModeHandler.js";

export { PendingCommandModeHandler } from "./handlers/PendingCommandModeHandler.js";
export type { PendingCommandModeHandlerDeps } from "./handlers/PendingCommandModeHandler.js";

export { FileNavigationModeHandler } from "./handlers/FileNavigationModeHandler.js";
export type { FileNavigationModeHandlerDeps } from "./handlers/FileNavigationModeHandler.js";
