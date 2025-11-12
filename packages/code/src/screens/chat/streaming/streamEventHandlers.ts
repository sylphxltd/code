/**
 * Stream Event Handlers
 * Event handler pattern for processing tRPC subscription events
 *
 * Each event type has its own dedicated handler function.
 * This replaces the large switch statement with a cleaner, more maintainable approach.
 *
 * ARCHITECTURE: Direct zen signal updates (no AppStore wrapper)
 * - All session data managed by zen signals
 * - Immutable updates only (no Immer middleware)
 * - Clean, direct state mutations
 */

import type { StreamEvent } from "@sylphx/code-server";

// Export types
export type { EventHandlerContext, EventHandler } from "./types.js";

// Export utilities
export { updateActiveMessageContent } from "./utils.js";

// Export all handlers
export {
	handleSessionCreated,
	handleSessionDeleted,
	handleSessionModelUpdated,
	handleSessionProviderUpdated,
	handleSessionTitleUpdatedStart,
	handleSessionTitleUpdatedDelta,
	handleSessionTitleUpdatedEnd,
	handleSessionTitleUpdated,
} from "./handlers/sessionHandlers.js";

export {
	handleUserMessageCreated,
	handleAssistantMessageCreated,
	handleSystemMessageCreated,
	handleStepStart,
	handleStepComplete,
} from "./handlers/messageHandlers.js";

export {
	handleReasoningStart,
	handleReasoningDelta,
	handleReasoningEnd,
	handleTextStart,
	handleTextDelta,
	handleTextEnd,
	handleFile,
} from "./handlers/contentHandlers.js";

export {
	handleToolCall,
	handleToolInputStart,
	handleToolInputDelta,
	handleToolInputEnd,
	handleToolResult,
	handleToolError,
} from "./handlers/toolHandlers.js";

export {
	handleError,
	handleMessageStatusUpdated,
} from "./handlers/errorHandlers.js";

// Import all handlers for registry
import {
	handleSessionCreated,
	handleSessionDeleted,
	handleSessionModelUpdated,
	handleSessionProviderUpdated,
	handleSessionTitleUpdatedStart,
	handleSessionTitleUpdatedDelta,
	handleSessionTitleUpdatedEnd,
	handleSessionTitleUpdated,
} from "./handlers/sessionHandlers.js";

import {
	handleUserMessageCreated,
	handleAssistantMessageCreated,
	handleSystemMessageCreated,
	handleStepStart,
	handleStepComplete,
} from "./handlers/messageHandlers.js";

import {
	handleReasoningStart,
	handleReasoningDelta,
	handleReasoningEnd,
	handleTextStart,
	handleTextDelta,
	handleTextEnd,
	handleFile,
} from "./handlers/contentHandlers.js";

import {
	handleToolCall,
	handleToolInputStart,
	handleToolInputDelta,
	handleToolInputEnd,
	handleToolResult,
	handleToolError,
} from "./handlers/toolHandlers.js";

import {
	handleError,
	handleMessageStatusUpdated,
} from "./handlers/errorHandlers.js";

import type { EventHandler } from "./types.js";

// ============================================================================
// Event Handler Registry
// ============================================================================

/**
 * Registry mapping event types to their handlers
 * This replaces the large switch statement with a cleaner lookup pattern
 */
const eventHandlers: Record<StreamEvent["type"], EventHandler> = {
	// Session events
	"session-created": handleSessionCreated,
	"session-deleted": handleSessionDeleted,
	"session-model-updated": handleSessionModelUpdated,
	"session-provider-updated": handleSessionProviderUpdated,

	// Title events
	"session-title-updated-start": handleSessionTitleUpdatedStart,
	"session-title-updated-delta": handleSessionTitleUpdatedDelta,
	"session-title-updated-end": handleSessionTitleUpdatedEnd,
	"session-title-updated": handleSessionTitleUpdated,

	// Message events
	"user-message-created": handleUserMessageCreated,
	"assistant-message-created": handleAssistantMessageCreated,
	"system-message-created": handleSystemMessageCreated,
	"message-status-updated": handleMessageStatusUpdated,

	// Step events
	"step-start": handleStepStart,
	"step-complete": handleStepComplete,

	// Reasoning events
	"reasoning-start": handleReasoningStart,
	"reasoning-delta": handleReasoningDelta,
	"reasoning-end": handleReasoningEnd,

	// Text events
	"text-start": handleTextStart,
	"text-delta": handleTextDelta,
	"text-end": handleTextEnd,

	// Tool events
	"tool-call": handleToolCall,
	"tool-result": handleToolResult,
	"tool-error": handleToolError,
	"tool-input-start": handleToolInputStart,
	"tool-input-delta": handleToolInputDelta,
	"tool-input-end": handleToolInputEnd,

	// File events
	file: handleFile,

	// Error events
	error: handleError,
};

/**
 * Process stream event using handler registry
 * Replaces the large switch statement with a clean lookup
 */
export function handleStreamEvent(event: StreamEvent, context: import("./types.js").EventHandlerContext): void {
	const handler = eventHandlers[event.type];

	if (handler) {
		handler(event, context);
	} else {
		console.warn("[handleStreamEvent] Unknown event type:", event.type);
	}
}
