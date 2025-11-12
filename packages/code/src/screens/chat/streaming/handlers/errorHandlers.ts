/**
 * Error and Status Event Handlers
 * Handles error events and message status updates
 */

import { getCurrentSessionId, $currentSession, set as setSignal, get as getSignal } from "@sylphx/code-client";
import type { MessagePart } from "@sylphx/code-core";
import { createLogger } from "@sylphx/code-core";
import type { StreamEvent } from "@sylphx/code-server";
import type { EventHandlerContext } from "../types.js";
import { updateActiveMessageContent } from "../utils.js";

// Create debug logger
const logContent = createLogger("subscription:content");

// ============================================================================
// Error Events
// ============================================================================

export function handleError(event: Extract<StreamEvent, { type: "error" }>, context: EventHandlerContext) {
	const currentSessionId = getCurrentSessionId();

	logContent("Error event received:", event.error);

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newContent = [
			...prev,
			{
				type: "error",
				error: event.error,
				status: "completed",
			} as MessagePart,
		];
		logContent("Updated content with error, total parts:", newContent.length);
		return newContent;
	});

	// Stop streaming UI indicator on error
	context.setIsStreaming(false);
}

/**
 * Handle message status update (UNIFIED STATUS CHANGE EVENT)
 *
 * Server is the source of truth for message status.
 * This handler receives status updates from the database and applies them to the UI.
 *
 * Replaces client-side status calculation in handleComplete/handleAbort/handleError.
 *
 * Architecture:
 * - Server updates database → emits message-status-updated event
 * - All clients receive event → update UI state
 * - Multi-client sync automatically consistent
 */
export function handleMessageStatusUpdated(
	event: Extract<StreamEvent, { type: "message-status-updated" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();
	const currentSession = getSignal($currentSession);

	console.log(
		"[handleMessageStatusUpdated] Status updated:",
		event.status,
		"for message:",
		event.messageId,
	);
	context.addLog(`[StreamEvent] Message status updated to: ${event.status}`);

	// Update message status in session (server is source of truth)
	if (currentSession && currentSession.messages.some((m) => m.id === event.messageId)) {
		const updatedMessages = currentSession.messages.map((msg) =>
			msg.id === event.messageId
				? {
						...msg,
						status: event.status,
						usage: event.usage || msg.usage,
						finishReason: event.finishReason || msg.finishReason,
					}
				: msg,
		);

		setSignal($currentSession, {
			...currentSession,
			messages: updatedMessages,
		});
	}

	// If this is the currently streaming message, clean up streaming state
	if (context.streamingMessageIdRef.current === event.messageId) {
		// Mark all active parts with the final status
		// For reasoning parts without duration, calculate elapsed time
		updateActiveMessageContent(currentSessionId, event.messageId, (prev) =>
			prev.map((part) => {
				if (part.status !== "active") return part;

				const updatedPart = { ...part, status: event.status };

				// If reasoning part without duration, calculate elapsed time
				if (part.type === "reasoning" && !part.duration && part.startTime) {
					updatedPart.duration = Date.now() - part.startTime;
				}

				return updatedPart;
			}),
		);

		// Clear streaming state
		context.streamingMessageIdRef.current = null;
		context.setIsStreaming(false);

		console.log(
			"[handleMessageStatusUpdated] Cleared streaming state for message:",
			event.messageId,
		);
	}
}
