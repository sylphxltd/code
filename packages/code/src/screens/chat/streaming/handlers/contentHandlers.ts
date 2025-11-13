/**
 * Content Event Handlers
 * Handles reasoning, text, and file content streaming
 */

import { getCurrentSessionId } from "@sylphx/code-client";
import type { MessagePart } from "@sylphx/code-core";
import { createLogger } from "@sylphx/code-core";
import type { StreamEvent } from "@sylphx/code-server";
import type { EventHandlerContext } from "../types.js";
import { updateActiveMessageContent } from "../utils.js";

// Create debug logger
const logContent = createLogger("subscription:content");

// ============================================================================
// Reasoning Events
// ============================================================================

export function handleReasoningStart(
	event: Extract<StreamEvent, { type: "reasoning-start" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	logContent("Reasoning start, session:", currentSessionId);
	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		logContent("Adding reasoning part, existing parts:", prev.length);
		return [
			...prev,
			{
				type: "reasoning" as const,
				content: "",
				status: "active" as const,
				startTime: Date.now(),
			},
		];
	});
}

export function handleReasoningDelta(
	event: Extract<StreamEvent, { type: "reasoning-delta" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newParts = [...prev];
		const lastPart = newParts[newParts.length - 1];
		if (lastPart && lastPart.type === "reasoning") {
			newParts[newParts.length - 1] = {
				...lastPart,
				content: lastPart.content + event.text,
			};
		}
		return newParts;
	});
}

export function handleReasoningEnd(
	event: Extract<StreamEvent, { type: "reasoning-end" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newParts = [...prev];
		const lastReasoningIndex = newParts
			.map((p, i) => ({ p, i }))
			.reverse()
			.find(({ p }) => p.type === "reasoning" && p.status === "active")?.i;

		if (lastReasoningIndex !== undefined) {
			const reasoningPart = newParts[lastReasoningIndex];
			if (reasoningPart && reasoningPart.type === "reasoning") {
				newParts[lastReasoningIndex] = {
					...reasoningPart,
					status: "completed" as const,
					duration: event.duration,
				};
			}
		}
		return newParts;
	});
}

// ============================================================================
// Text Events
// ============================================================================

export function handleTextStart(
	event: Extract<StreamEvent, { type: "text-start" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		return [...prev, { type: "text" as const, content: "", status: "active" as const }];
	});
}

export function handleTextDelta(
	event: Extract<StreamEvent, { type: "text-delta" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newParts = [...prev];
		const lastPart = newParts[newParts.length - 1];

		if (lastPart && lastPart.type === "text" && lastPart.status === "active") {
			newParts[newParts.length - 1] = {
				type: "text",
				content: lastPart.content + event.text,
				status: "active" as const,
			};
		} else {
			newParts.push({
				type: "text",
				content: event.text,
				status: "active" as const,
			});
		}

		return newParts;
	});
}

export function handleTextEnd(
	event: Extract<StreamEvent, { type: "text-end" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newParts = [...prev];
		const lastTextIndex = newParts
			.map((p, i) => ({ p, i }))
			.reverse()
			.find(({ p }) => p.type === "text" && p.status === "active")?.i;

		if (lastTextIndex !== undefined) {
			const textPart = newParts[lastTextIndex];
			if (textPart && textPart.type === "text") {
				newParts[lastTextIndex] = {
					...textPart,
					status: "completed" as const,
				};
			}
		}

		return newParts;
	});
}

// ============================================================================
// File Events
// ============================================================================

export function handleFile(event: Extract<StreamEvent, { type: "file" }>, context: EventHandlerContext) {
	const currentSessionId = getCurrentSessionId();

	logContent("File received, mediaType:", event.mediaType, "size:", event.base64.length);
	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => [
		...prev,
		{
			type: "file" as const,
			relativePath: "", // Not provided in stream event
			size: Math.round((event.base64.length * 3) / 4), // Approximate from base64
			mediaType: event.mediaType,
			base64: event.base64,
			status: "completed" as const,
		},
	]);
}
