/**
 * Tool Event Handlers
 * Handles tool call lifecycle including input streaming
 */

import { getCurrentSessionId } from "@sylphx/code-client";
import type { MessagePart } from "@sylphx/code-core";
import type { StreamEvent } from "@sylphx/code-server";
import type { EventHandlerContext } from "../types.js";
import { updateActiveMessageContent } from "../utils.js";

// ============================================================================
// Tool Events
// ============================================================================

export function handleToolCall(
	event: Extract<StreamEvent, { type: "tool-call" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		// Check if tool part already exists (from tool-input-start)
		const existingToolPart = prev.find(
			(p) => p.type === "tool" && p.toolId === event.toolCallId,
		);

		if (existingToolPart && existingToolPart.type === "tool") {
			// Update existing tool part with name (input already set by tool-input-end)
			return prev.map((p) =>
				p.type === "tool" && p.toolId === event.toolCallId
					? { ...p, name: event.toolName }
					: p,
			);
		} else {
			// No streaming - create new tool part with complete input
			return [
				...prev,
				{
					type: "tool" as const,
					toolId: event.toolCallId,
					name: event.toolName,
					status: "active" as const,
					input: event.input,
					startTime: Date.now(),
				},
			];
		}
	});
}

export function handleToolInputStart(
	event: Extract<StreamEvent, { type: "tool-input-start" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	// Create tool part with empty input (will be populated by deltas)
	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => [
		...prev,
		{
			type: "tool" as const,
			toolId: event.toolCallId,
			name: "", // Will be set when tool-call completes
			status: "active" as const,
			input: "", // Will be populated by deltas as JSON string
			startTime: Date.now(),
		},
	]);
}

export function handleToolInputDelta(
	event: Extract<StreamEvent, { type: "tool-input-delta" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	// Update tool input as it streams in
	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newParts = [...prev];
		// Find the tool part by toolId
		const toolPart = newParts.find(
			(p) => p.type === "tool" && p.toolId === event.toolCallId && p.status === "active",
		);

		if (toolPart && toolPart.type === "tool") {
			// Accumulate input as JSON text string
			const currentInput = typeof toolPart.input === "string" ? toolPart.input : "";
			toolPart.input = currentInput + event.inputTextDelta;
		}

		return newParts;
	});
}

export function handleToolInputEnd(
	event: Extract<StreamEvent, { type: "tool-input-end" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	// Parse accumulated JSON input
	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) => {
		const newParts = [...prev];
		const toolPart = newParts.find(
			(p) => p.type === "tool" && p.toolId === event.toolCallId && p.status === "active",
		);

		if (toolPart && toolPart.type === "tool") {
			try {
				// Parse accumulated JSON string
				const inputText = typeof toolPart.input === "string" ? toolPart.input : "";
				toolPart.input = inputText ? JSON.parse(inputText) : {};
			} catch (e) {
				console.error("[handleToolInputEnd] Failed to parse tool input:", toolPart.input);
				toolPart.input = {};
			}
		}

		return newParts;
	});
}

export function handleToolResult(
	event: Extract<StreamEvent, { type: "tool-result" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) =>
		prev.map((part) =>
			part.type === "tool" && part.toolId === event.toolCallId
				? {
						...part,
						status: "completed" as const,
						duration: event.duration,
						result: event.result,
					}
				: part,
		),
	);
}

export function handleToolError(
	event: Extract<StreamEvent, { type: "tool-error" }>,
	context: EventHandlerContext,
) {
	const currentSessionId = getCurrentSessionId();

	updateActiveMessageContent(currentSessionId, context.streamingMessageIdRef.current, (prev) =>
		prev.map((part) =>
			part.type === "tool" && part.toolId === event.toolCallId
				? {
						...part,
						status: "error" as const,
						error: event.error,
						duration: event.duration,
					}
				: part,
		),
	);
}
