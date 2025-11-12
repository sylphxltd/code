/**
 * Stream Event Handler Utilities
 * Shared helper functions used across all event handlers
 */

import { $currentSession, set as setSignal, get as getSignal } from "@sylphx/code-client";
import type { MessagePart } from "@sylphx/code-core";
import { createLogger } from "@sylphx/code-core";

const logContent = createLogger("subscription:content");

/**
 * Helper to update active message content in SessionStore
 * Exported for use in error handlers and cleanup
 * Uses immutable updates (no Immer middleware)
 */
export function updateActiveMessageContent(
	currentSessionId: string | null,
	messageId: string | null | undefined,
	updater: (prev: MessagePart[]) => MessagePart[],
) {
	const session = getSignal($currentSession);

	if (!session || session.id !== currentSessionId) {
		logContent("Session mismatch! expected:", currentSessionId, "got:", session?.id);
		return;
	}

	// Find message by ID if provided, otherwise find any active message
	// When messageId is provided, find by ID regardless of status (allows updating parts after status change)
	const activeMessage = messageId
		? session.messages.find((m) => m.id === messageId)
		: session.messages.find((m) => m.status === "active");

	if (!activeMessage) {
		logContent(
			"No active message found! messages:",
			session.messages.length,
			"messageId:",
			messageId,
		);
		return;
	}

	// IMMUTABLE UPDATE: Create new messages array with updated content
	const updatedMessages = session.messages.map((msg) =>
		msg.id === activeMessage.id
			? { ...msg, content: updater(msg.content || []) } // Ensure content is array
			: msg,
	);

	// Update signal with new session object
	setSignal($currentSession, {
		...session,
		messages: updatedMessages,
	});
}
