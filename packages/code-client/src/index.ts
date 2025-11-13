/**
 * @sylphx/code-client
 * Shared React code for Web and TUI clients
 *
 * This package provides:
 * - State management (Zen signals)
 * - React hooks for common operations
 * - Utility functions
 * - Shared types
 */

// ============================================================================
// tRPC Provider (React Context API)
// ============================================================================
export {
	// React Context API
	TRPCProvider,
	useTRPCClient,
	type TRPCProviderProps,
	// Client factories
	createInProcessClient,
	createHTTPClient,
	type TypedTRPCClient,
	// Internal API for Zen signals (DO NOT USE in React components)
	getTRPCClient,
	_initGlobalClient,
} from "./trpc-provider.js";

// ============================================================================
// tRPC Links (Low-level, use createInProcessClient instead)
// ============================================================================
export {
	inProcessLink,
	type InProcessLinkOptions,
} from "./trpc-links/index.js";

// ============================================================================
// State Management (Zen Signals)
// ============================================================================
export * from "./signals/index.js";

// ============================================================================
// Screen Type (for backwards compatibility in component imports)
// ============================================================================
export type { Screen } from "./signals/domain/ui/index.js";

// ============================================================================
// Event Bus
// ============================================================================
export { eventBus, type AppEvents } from "./lib/event-bus.js";

// ============================================================================
// Types (re-exported from dependencies)
// ============================================================================
export type { Session, MessagePart } from "@sylphx/code-core";
export type { AppRouter } from "@sylphx/code-server";

// ============================================================================
// Command Types
// ============================================================================
export type {
	Command,
	CommandArg,
	CommandContext,
	SelectOption,
	Question,
	WaitForInputOptions,
} from "./types/command-types.js";

// ============================================================================
// React Hooks
// ============================================================================
export { useAIConfig as useAIConfigActions } from "./hooks/useAIConfig.js";
export { useAskToolHandler } from "./hooks/useAskToolHandler.js";
export { useChat } from "./hooks/useChat.js";
export { useCurrentSession } from "./hooks/useCurrentSession.js";
export { useElapsedTime } from "./hooks/useElapsedTime.js";
export {
	useEventStream,
	type EventStreamCallbacks,
	type UseEventStreamOptions,
} from "./hooks/useEventStream.js";
export { useFileAttachments } from "./hooks/useFileAttachments.js";
export { useKeyboard } from "./hooks/useKeyboard.js";
export { useModelDetails } from "./hooks/useModelDetails.js";
export { useModels } from "./hooks/useModels.js";
export { useMouse } from "./hooks/useMouse.js";
export { useProjectFiles } from "./hooks/useProjectFiles.js";
export { useProviders } from "./hooks/useProviders.js";
export { useSessionInitialization } from "./hooks/useSessionInitialization.js";
export { useSessionPersistence } from "./hooks/useSessionPersistence.js";
export { useTokenCalculation } from "./hooks/useTokenCalculation.js";
export { useTotalTokens } from "./hooks/useTotalTokens.js";
export { useSessionList } from "./hooks/useSessionList.js";
export {
	useSessionListSync,
	type SessionListSyncCallbacks,
	type UseSessionListSyncOptions,
} from "./hooks/useSessionListSync.js";

// ============================================================================
// Utilities
// ============================================================================
export * from "./utils/config.js";

// API functions
export * from "./api/sessions.js";

// Re-export shared utilities from @sylphx/code-core (via main export)
export {
	getCursorLinePosition,
	getAbsoluteCursorPosition,
	moveCursorUp,
	moveCursorDown,
	clampCursor,
	calculateScrollViewport,
	truncateString,
	getRelativePath,
	isDefaultCwd,
	pluralize,
	type LinePosition,
	type ScrollViewportResult,
	type InputFormatter,
	type ResultFormatter,
	type FormattedResult,
} from "@sylphx/code-core";

// Client-specific utilities
export * from "./utils/parse-user-input.js";
export * from "./utils/text-rendering-utils.js";
export * from "./utils/todo-formatters.js";
export * from "./utils/tool-configs.js";

// ============================================================================
// Version
// ============================================================================
export const version = "0.1.0";
