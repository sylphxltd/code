/**
 * Session Event Handlers
 * Handles session lifecycle and title events
 */

import {
	getCurrentSessionId,
	setCurrentSessionId,
	$currentSession,
	set as setSignal,
	get as getSignal,
} from "@sylphx/code-client";
import { createLogger } from "@sylphx/code-core";
import type { StreamEvent } from "@sylphx/code-server";
import type { EventHandlerContext } from "../types.js";

// Create debug logger
const logSession = createLogger("subscription:session");

// ============================================================================
// Session Events
// ============================================================================

export function handleSessionCreated(
	event: Extract<StreamEvent, { type: "session-created" }>,
	context: EventHandlerContext,
) {
	context.addLog(`[Session] Created: ${event.sessionId}`);

	// Get current session state to preserve optimistic messages
	const currentSession = getSignal($currentSession);

	// RACE CONDITION FIX: If the session was already transitioned by subscriptionAdapter
	// (mutation completed before event arrived), just skip - messages already preserved
	if (currentSession?.id === event.sessionId && currentSession.messages.length > 0) {
		logSession("Session already transitioned with messages, skipping event handler");
		return;
	}

	// Check if there's a temporary session with optimistic messages
	const optimisticMessages = currentSession?.id === "temp-session" ? currentSession.messages : [];

	logSession("Creating session, preserving optimistic messages:", optimisticMessages.length);

	// IMMUTABLE UPDATE: Create new session with optimistic messages preserved
	setCurrentSessionId(event.sessionId);
	setSignal($currentSession, {
		id: event.sessionId,
		title: "New Chat",
		agentId: "coder",
		provider: event.provider,
		model: event.model,
		createdAt: Date.now(),
		updatedAt: Date.now(),
		messages: optimisticMessages, // Preserve optimistic user message
		todos: [],
		enabledRuleIds: [],
	});

	logSession("Created session with optimistic messages:", event.sessionId);
}

export function handleSessionDeleted(
	event: Extract<StreamEvent, { type: "session-deleted" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	if (event.sessionId === currentSessionId) {
		setCurrentSessionId(null);
		setSignal($currentSession, null);
		context.addLog(`[Session] Deleted: ${event.sessionId}`);
	}
}

export function handleSessionModelUpdated(
	event: Extract<StreamEvent, { type: "session-model-updated" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();
	const currentSession = getSignal($currentSession);

	if (event.sessionId === currentSessionId && currentSession) {
		setSignal($currentSession, {
			...currentSession,
			model: event.model,
		});
		context.addLog(`[Session] Model updated: ${event.model}`);
	}
}

export function handleSessionProviderUpdated(
	event: Extract<StreamEvent, { type: "session-provider-updated" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();
	const currentSession = getSignal($currentSession);

	if (event.sessionId === currentSessionId && currentSession) {
		setSignal($currentSession, {
			...currentSession,
			provider: event.provider,
			model: event.model,
		});
		context.addLog(`[Session] Provider updated: ${event.provider}`);
	}
}

// ============================================================================
// Title Events
// ============================================================================

export function handleSessionTitleUpdatedStart(
	event: Extract<StreamEvent, { type: "session-title-updated-start" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	if (event.sessionId === currentSessionId) {
		context.setIsTitleStreaming(true);
		context.setStreamingTitle("");
	}
}

export function handleSessionTitleUpdatedDelta(
	event: Extract<StreamEvent, { type: "session-title-updated-delta" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	if (event.sessionId === currentSessionId) {
		context.setStreamingTitle((prev) => prev + event.text);
	}
}

export function handleSessionTitleUpdatedEnd(
	event: Extract<StreamEvent, { type: "session-title-updated-end" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	if (event.sessionId === currentSessionId) {
		context.setIsTitleStreaming(false);
		context.updateSessionTitle(event.sessionId, event.title);
	}
}

export function handleSessionTitleUpdated(
	event: Extract<StreamEvent, { type: "session-title-updated" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	if (event.sessionId === currentSessionId) {
		context.updateSessionTitle(event.sessionId, event.title);
	}
}
