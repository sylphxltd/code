/**
 * AI SDK - Generic streaming interface
 * Unified AI streaming with tool support and message history management
 */

import { streamText, type AssistantContent, type ModelMessage } from "ai";
import type { LanguageModel, ToolSet } from "ai";

/**
 * Stream chunk types (our own)
 */
export type TextStartChunk = {
	type: "text-start";
};

export type TextDeltaChunk = {
	type: "text-delta";
	textDelta: string;
};

export type TextEndChunk = {
	type: "text-end";
};

export type ReasoningStartChunk = {
	type: "reasoning-start";
};

export type ReasoningDeltaChunk = {
	type: "reasoning-delta";
	textDelta: string;
};

export type ReasoningEndChunk = {
	type: "reasoning-end";
};

export type ToolCallChunk = {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	args: unknown;
};

export type ToolInputStartChunk = {
	type: "tool-input-start";
	toolCallId: string;
	toolName: string;
};

export type ToolInputDeltaChunk = {
	type: "tool-input-delta";
	toolCallId: string;
	argsTextDelta: string;
};

export type ToolInputEndChunk = {
	type: "tool-input-end";
	toolCallId: string;
};

export type ToolResultChunk = {
	type: "tool-result";
	toolCallId: string;
	toolName: string;
	result: unknown;
};

export type ToolErrorChunk = {
	type: "tool-error";
	toolCallId: string;
	toolName: string;
	error: string;
};

export type FileChunk = {
	type: "file";
	mediaType: string;
	base64: string;
};

export type StreamErrorChunk = {
	type: "error";
	error: string;
};

export type AbortChunk = {
	type: "abort";
};

export type FinishChunk = {
	type: "finish";
	finishReason: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
};

export type StepStartChunk = {
	type: "step-start";
	stepNumber: number;
};

export type StepEndChunk = {
	type: "step-end";
	stepNumber: number;
	finishReason: string;
	responseMessages: ModelMessage[];
};

export type StreamChunk =
	| TextStartChunk
	| TextDeltaChunk
	| TextEndChunk
	| ReasoningStartChunk
	| ReasoningDeltaChunk
	| ReasoningEndChunk
	| ToolCallChunk
	| ToolInputStartChunk
	| ToolInputDeltaChunk
	| ToolInputEndChunk
	| ToolResultChunk
	| ToolErrorChunk
	| FileChunk
	| StreamErrorChunk
	| AbortChunk
	| FinishChunk
	| StepStartChunk
	| StepEndChunk;

/**
 * Step info (our own)
 */
export interface StepInfo {
	finishReason: string;
	usage: {
		promptTokens: number;
		completionTokens: number;
		totalTokens: number;
	};
	content: AssistantContent[];
}

/**
 * Create AI stream options
 */
export interface CreateAIStreamOptions {
	model: LanguageModel;
	messages: ModelMessage[];
	systemPrompt?: string;
	/**
	 * Tools to provide to the model
	 * If not provided, no tools will be available
	 */
	tools?: ToolSet;
	/**
	 * Optional abort signal to cancel the stream
	 */
	abortSignal?: AbortSignal;
	/**
	 * Called after each step finishes
	 */
	onStepFinish?: (step: StepInfo) => void;
	/**
	 * Called before each step to prepare messages
	 * Can be used to inject context dynamically
	 * @param messages - Current message history
	 * @param stepNumber - Current step number
	 * @returns Modified messages array
	 */
	onPrepareMessages?: (messages: ModelMessage[], stepNumber: number) => ModelMessage[];
}


/**
 * Normalize content to modern array format
 * Converts legacy string content to Array<TextPart | ImagePart | FilePart | ... >
 */
function normalizeMessage(message: ModelMessage): ModelMessage {
	const content = message.content;
	if (typeof content === "string") {
		// Legacy string format → convert to TextPart array
		return {
			...message,
			content: [
				{
					type: "text" as const,
					text: content,
				},
			],
		} as ModelMessage;
	}

	// Already array format (or other object)
	return message;
}

/**
 * Create AI stream with tool support
 * Uses manual loop to control message history
 */
async function* createAIStream(options: CreateAIStreamOptions): AsyncIterable<StreamChunk> {
	const {
		systemPrompt,
		model,
		messages: initialMessages,
		tools,
		abortSignal,
		onStepFinish,
		onPrepareMessages,
	} = options;

	// Normalize all messages to array format
	let messageHistory = initialMessages.map(normalizeMessage);

	let stepNumber = 0;
	const MAX_STEPS = 1000;

	while (stepNumber < MAX_STEPS) {
		// Emit step-start event
		yield {
			type: "step-start",
			stepNumber,
		};

		// Prepare messages for this step (caller can inject context)
		const preparedMessages = onPrepareMessages
			? await onPrepareMessages(messageHistory, stepNumber)
			: messageHistory;

		// Call AI SDK with single step
		const { fullStream, response, finishReason, usage, content } = streamText({
			model,
			messages: preparedMessages,
			system: systemPrompt,
			tools,
			abortSignal,
		});

		// Stream all chunks to user
		for await (const chunk of fullStream) {
			switch (chunk.type) {
				case "text-start":
					yield { type: "text-start" };
					break;

				case "text-delta":
					yield { type: "text-delta", textDelta: chunk.text };
					break;

				case "text-end":
					yield { type: "text-end" };
					break;

				case "reasoning-start":
					yield { type: "reasoning-start" };
					break;

				case "reasoning-delta":
					yield { type: "reasoning-delta", textDelta: chunk.text };
					break;

				case "reasoning-end":
					yield { type: "reasoning-end" };
					break;

				case "tool-call":
					yield {
						type: "tool-call",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						args: chunk.input,
					};
					break;

				case "tool-input-start":
					yield {
						type: "tool-input-start",
						toolCallId: chunk.id,
						toolName: chunk.toolName,
					};
					break;

				case "tool-input-delta":
					yield {
						type: "tool-input-delta",
						toolCallId: chunk.id,
						argsTextDelta: chunk.delta,
					};
					break;

				case "tool-input-end":
					yield {
						type: "tool-input-end",
						toolCallId: chunk.id,
					};
					break;

				case "tool-result":
					yield {
						type: "tool-result",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						result: chunk.output,
					};
					break;

				case "finish":
					yield {
						type: "finish",
						finishReason: chunk.finishReason,
						usage: {
							promptTokens: chunk.totalUsage.inputTokens ?? 0,
							completionTokens: chunk.totalUsage.outputTokens ?? 0,
							totalTokens: chunk.totalUsage.totalTokens ?? 0,
						},
					};
					break;

				case "error":
					yield {
						type: "error",
						error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
					};
					break;

				case "tool-error":
					yield {
						type: "tool-error",
						toolCallId: chunk.toolCallId,
						toolName: chunk.toolName,
						error: chunk.error instanceof Error ? chunk.error.message : String(chunk.error),
					};
					break;

				case "file":
					// File/image generated by model
					yield {
						type: "file",
						mediaType: chunk.file.mediaType,
						base64: chunk.file.base64,
					};
					break;

				case "abort":
					yield {
						type: "abort",
					};
					break;

				default:
					break;
			}
		}

		// Call onStepFinish callback if provided
		if (onStepFinish) {
			const stepInfo: StepInfo = {
				finishReason: await finishReason,
				usage: {
					promptTokens: (await usage).inputTokens ?? 0,
					completionTokens: (await usage).outputTokens ?? 0,
					totalTokens: (await usage).totalTokens ?? 0,
				},
				content: await content,
			};
			onStepFinish(stepInfo);
		}

		// Save LLM response messages to history
		const responseMessages = (await response).messages;

		// Push all messages to history (no transformation needed)
		for (const msg of responseMessages) {
			messageHistory.push(msg);
		}

		const currentFinishReason = await finishReason;

		// Emit step-end event with response messages
		// These messages contain tool results in AI SDK's wrapped format
		yield {
			type: "step-end",
			stepNumber,
			finishReason: currentFinishReason,
			responseMessages, // Include AI SDK's processed messages
		};

		// Check if we should continue the loop
		if (currentFinishReason !== "tool-calls") {
			// No more tool calls, exit loop
			break;
		}

		stepNumber++;
	}
}

// Export value functions and constants
// NOTE: index.ts uses wildcard re-export for this file to avoid explicit duplicate listings
export { normalizeMessage, createAIStream };
