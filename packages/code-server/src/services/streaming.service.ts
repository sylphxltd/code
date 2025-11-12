/**
 * Streaming Service
 * Backend service for AI streaming - used by tRPC subscription
 *
 * Architecture:
 * - Loads session data from database
 * - Builds message context for AI
 * - Streams AI response
 * - Saves results to database
 * - Emits events to subscription observer
 *
 * This service is called by message.streamResponse subscription procedure
 */

import { streamText, type TextStreamPart, type LanguageModelUsage } from "ai";
import { observable, type Observable } from "@trpc/server/observable";
import type {
	SessionRepository,
	MessageRepository,
	AIConfig,
	TokenUsage,
	MessagePart,
	ProviderId,
} from "@sylphx/code-core";
import {
	buildSystemPrompt,
	createMessageStep,
	updateStepParts,
	completeMessageStep,
	getProvider,
	getAISDKTools,
	hasUserInputHandler,
} from "@sylphx/code-core";

import type { StreamCallbacks } from "@sylphx/code-core";
import type { AppContext } from "../context.js";
import { ensureSession } from "./streaming/session-manager.js";
import { buildModelMessages } from "./streaming/message-builder.js";
import { generateSessionTitle, needsTitleGeneration } from "./streaming/title-generator.js";
import { validateProvider } from "./streaming/provider-validator.js";

// ============================================================================
// AI SDK Type Helpers
// ============================================================================
// Extract specific chunk types from AI SDK's TextStreamPart union for type safety
type TextDeltaChunk = Extract<TextStreamPart<any>, { type: "text-delta" }>;
type ReasoningDeltaChunk = Extract<TextStreamPart<any>, { type: "reasoning-delta" }>;
type FinishChunk = Extract<TextStreamPart<any>, { type: "finish" }>;

// Reasoning part with internal startTime tracking
interface ReasoningPartWithStartTime extends MessagePart {
	type: "reasoning";
	startTime?: number; // Internal field for duration calculation
}

// ============================================================================
// Re-export StreamEvent type from message router
// ============================================================================
export type StreamEvent =
	// Session-level events
	| {
			type: "session-created";
			sessionId: string;
			provider: string;
			model: string;
	  }
	| { type: "session-updated"; sessionId: string }
	| { type: "session-title-updated-start"; sessionId: string }
	| { type: "session-title-updated-delta"; sessionId: string; text: string }
	| { type: "session-title-updated-end"; sessionId: string; title: string }

	// Message-level events
	| { type: "user-message-created"; messageId: string; content: string }
	| { type: "assistant-message-created"; messageId: string }
	| { type: "system-message-created"; messageId: string; content: string }
	| {
			type: "message-status-updated";
			messageId: string;
			status: "active" | "completed" | "error" | "abort";
			usage?: TokenUsage;
			finishReason?: string;
	  }

	// Step-level events (NEW)
	| {
			type: "step-start";
			stepId: string;
			stepIndex: number;
			metadata: { cpu: string; memory: string };
			todoSnapshot: any[];
			systemMessages?: Array<{
				type: string;
				content: string;
				timestamp: number;
			}>;
	  }
	| {
			type: "step-complete";
			stepId: string;
			usage: TokenUsage;
			duration: number;
			finishReason: string;
	  }

	// Content streaming events (within a step)
	| { type: "text-start" }
	| { type: "text-delta"; text: string }
	| { type: "text-end" }
	| { type: "reasoning-start" }
	| { type: "reasoning-delta"; text: string }
	| { type: "reasoning-end"; duration: number }
	| { type: "tool-call"; toolCallId: string; toolName: string; args: any }
	| { type: "tool-input-start"; toolCallId: string }
	| { type: "tool-input-delta"; toolCallId: string; argsTextDelta: string }
	| { type: "tool-input-end"; toolCallId: string }
	| {
			type: "tool-result";
			toolCallId: string;
			toolName: string;
			result: any;
			duration: number;
	  }
	| {
			type: "tool-error";
			toolCallId: string;
			toolName: string;
			error: string;
			duration: number;
	  }
	| { type: "file"; mediaType: string; base64: string }

	// Error events
	| { type: "error"; error: string };

/**
 * Parsed content part from frontend
 */
type ParsedContentPart =
	| { type: "text"; content: string }
	| {
			type: "file";
			path: string;
			relativePath: string;
			size?: number;
			mimeType?: string;
	  };

export interface StreamAIResponseOptions {
	appContext: AppContext;
	sessionRepository: SessionRepository;
	messageRepository: MessageRepository;
	aiConfig: AIConfig;
	sessionId: string | null; // null = create new session
	agentId?: string; // Optional - override session agent
	provider?: ProviderId; // Required if sessionId is null
	model?: string; // Required if sessionId is null

	// User message content to add before streaming
	// - If provided: adds new user message with this content, then streams AI response
	// - If undefined/null: uses existing session messages only (e.g., after compact)
	userMessageContent?: ParsedContentPart[] | null;

	abortSignal?: AbortSignal;
}

/**
 * Stream AI response as Observable<StreamEvent>
 *
 * This function:
 * 1. Loads session from database
 * 2. Adds user message to session
 * 3. Builds message context for AI
 * 4. Streams AI response
 * 5. Emits events to observer
 * 6. Saves final result to database
 */
export function streamAIResponse(opts: StreamAIResponseOptions): Observable<StreamEvent, unknown> {
	return observable<StreamEvent>((observer) => {
		let aborted = false;

		// Async execution wrapped in promise
		const executionPromise = (async () => {
			try {
				const {
					sessionRepository,
					messageRepository,
					aiConfig,
					sessionId: inputSessionId,
					agentId: inputAgentId,
					provider: inputProvider,
					model: inputModel,
					userMessageContent,
					abortSignal,
				} = opts;

				// 1. Ensure session exists (create if needed)
				let sessionId: string;
				let isNewSession: boolean;

				try {
					const result = await ensureSession(
						sessionRepository,
						aiConfig,
						inputSessionId,
						inputProvider,
						inputModel,
						inputAgentId,
					);
					sessionId = result.sessionId;
					isNewSession = result.type === 'new';

					// Emit session-created event if new
					if (isNewSession) {
						observer.next({
							type: "session-created",
							sessionId: result.sessionId,
							provider: result.provider,
							model: result.model,
						});
					}
				} catch (error) {
					observer.next({
						type: "error",
						error: error instanceof Error ? error.message : String(error),
					});
					observer.complete();
					return;
				}

				// 2. Load session from database
				const session = await sessionRepository.getSessionById(sessionId);
				if (!session) {
					observer.error(new Error("Session not found"));
					return;
				}

				// 2. Validate provider configuration
				const validationError = validateProvider(aiConfig, session);
				if (validationError) {
					try {
						// Create assistant message to display error
						const assistantMessageId = await messageRepository.addMessage({
							sessionId,
							role: "assistant",
							content: [],
							status: "error",
						});

						// Emit assistant message created event
						observer.next({
							type: "assistant-message-created",
							messageId: assistantMessageId,
						});

						// Create step with error content
						const db = sessionRepository.getDatabase();
						const stepId = await createMessageStep(
							db,
							assistantMessageId,
							0,
						);

						// Add error content to step
						await updateStepParts(db, stepId, [
							{
								type: "error",
								error: validationError.message,
								status: "completed",
							},
						]);

						// Complete the step
						await completeMessageStep(db, stepId, "error");

						// Emit message status updated
						observer.next({
							type: "message-status-updated",
							messageId: assistantMessageId,
							status: "error",
						});
					} catch (dbError) {
						console.error("[streamAIResponse] Failed to save validation error to database:", dbError);
						// Even if database save fails, still emit the error event
					}

					// Emit error event
					observer.next({
						type: "error",
						error: validationError.message,
					});

					// Complete
					observer.next({
						type: "complete",
					});
					observer.complete();
					return;
				}

				const provider = session.provider;
				const modelName = session.model;
				const providerConfig = aiConfig?.providers?.[provider]!;
				const providerInstance = getProvider(provider);

				// 3. Read and freeze file content (immutable history)
				// Only if userMessageContent is provided
				let frozenContent: MessagePart[] = [];

				if (userMessageContent) {
					const fs = await import("node:fs/promises");
					const { lookup } = await import("mime-types");

					for (const part of userMessageContent) {
						if (part.type === "text") {
							frozenContent.push({
								type: "text",
								content: part.content,
								status: "completed",
							});
						} else if (part.type === "file") {
							try {
								// READ NOW and freeze - never re-read from disk
								const buffer = await fs.readFile(part.path);
								const mimeType = part.mimeType || lookup(part.path) || "application/octet-stream";

								// LEGACY format for backward compatibility
								// New messages will migrate to file-ref after step creation
								frozenContent.push({
									type: "file",
									relativePath: part.relativePath,
									size: buffer.length,
									mediaType: mimeType,
									base64: buffer.toString("base64"), // Temporary - will be moved to file_contents
									status: "completed",
								});
							} catch (error) {
								// File read failed - save error
								console.error("[streamAIResponse] File read failed:", error);
								frozenContent.push({
									type: "error",
									error: `Failed to read file: ${part.relativePath}`,
									status: "completed",
								});
							}
						}
					}
				}

				// 4. Add user message to session (with frozen content)
				// Only if userMessageContent is provided (not null/undefined)
				// If not provided, use existing session messages (e.g., after compact with summary)
				let userMessageId: string | null = null;
				let userMessageText = "";

				if (userMessageContent) {
					userMessageId = await messageRepository.addMessage({
						sessionId,
						role: "user",
						content: frozenContent,
						// REMOVED: metadata with cpu/memory (now provided via dynamic system messages)
						// REMOVED: todoSnapshot (no longer stored, see TODOSNAPSHOT-REALITY.md)
					});

					// 4.1. Emit user-message-created event
					// Extract text content for display (omit file details)
					userMessageText = userMessageContent
						.map((part) => (part.type === "text" ? part.content : `@${part.relativePath}`))
						.join("");

					observer.next({
						type: "user-message-created",
						messageId: userMessageId,
						content: userMessageText,
					});
				}

				// 4. Reload session to get updated messages
				let updatedSession = await sessionRepository.getSessionById(sessionId);
				if (!updatedSession) {
					observer.error(new Error("Session not found after adding message"));
					return;
				}

				// 4.5. Import trigger checker for use in onPrepareMessages
				// All trigger checks happen dynamically in onPrepareMessages hook (unified for all steps)
				const { checkAllTriggers } = await import("@sylphx/code-core");

				// 5. Lazy load model capabilities (server-side autonomous)
				// Check if capabilities are cached, if not, fetch from API to populate cache
				// This ensures image generation and other capabilities are detected correctly
				let modelCapabilities = providerInstance.getModelCapabilities(modelName);
				if (modelCapabilities.size === 0) {
					// Cache miss - fetch models from API to populate capabilities cache
					// This is lazy loading: only fetch when needed, fully server-side
					try {
						await providerInstance.fetchModels(providerConfig);
						// Re-fetch capabilities after cache populated
						modelCapabilities = providerInstance.getModelCapabilities(modelName);
					} catch (err) {
						console.error("[Streaming] Failed to fetch model capabilities:", err);
						// Continue with empty capabilities (degraded mode)
					}
				}

				// 6. Build ModelMessage[] for AI (transforms frozen content, no file reading)
				const messages = await buildModelMessages(
					updatedSession.messages,
					modelCapabilities,
					messageRepository.getFileRepository(),
				);

				// 7. Determine agentId and build system prompt
				// STATELESS: Use explicit parameters from AppContext
				const agentId = inputAgentId || session.agentId || "coder";
				const agents = opts.appContext.agentManager.getAll();
				const enabledRuleIds = session.enabledRuleIds || [];
				const enabledRules = opts.appContext.ruleManager.getEnabled(enabledRuleIds);
				const systemPrompt = buildSystemPrompt(agentId, agents, enabledRules);

				// 8. Create AI model
				const model = providerInstance.createClient(providerConfig, modelName);

				// 9. Determine tool support from capabilities and load tools if supported
				const supportsTools = modelCapabilities.has("tools");
				const tools = supportsTools
					? getAISDKTools({ interactive: hasUserInputHandler() })
					: undefined;

				// 9.5. Check if title generation is needed (before creating streams)
				const isFirstMessage =
					updatedSession.messages.filter((m) => m.role === "user").length === 1;
				const needsTitle = needsTitleGeneration(updatedSession, isNewSession, isFirstMessage);

				// 9.6. Create assistant message in database BEFORE stream (need ID for prepareStep)
				const assistantMessageId = await messageRepository.addMessage({
					sessionId,
					role: "assistant",
					content: [], // Empty content initially
					status: "active",
				});

				// 9.7. Emit assistant message created event
				observer.next({
					type: "assistant-message-created",
					messageId: assistantMessageId,
				});

				// 10. Create AI stream with system prompt using AI SDK's native prepareStep
				// Only provide tools if model supports them
				// Models without native support (like claude-code) will fall back to text-based tools

				let currentStepParts: MessagePart[] = [];
				let lastCompletedStepNumber = -1;

				const { fullStream } = streamText({
					model,
					messages,
					system: systemPrompt, // AI SDK uses 'system' not 'systemPrompt'
					tools,
					...(abortSignal ? { abortSignal } : {}),
					maxSteps: 10, // Reasonable limit for multi-step tool calling
					// ⭐ AI SDK's native prepareStep hook - called before each step
					prepareStep: async ({ steps, stepNumber }) => {
						try {
							// 1. Complete previous step if this is not the first step
							if (stepNumber > 0 && lastCompletedStepNumber < stepNumber - 1) {
								const prevStepId = `${assistantMessageId}-step-${stepNumber - 1}`;
								const prevStep = steps[steps.length - 1];

								// Update step parts
								try {
									await updateStepParts(sessionRepository.db, prevStepId, currentStepParts);
								} catch (dbError) {
									console.error(`[prepareStep] Failed to update step ${stepNumber - 1} parts:`, dbError);
								}

								// Complete step
								try {
									await completeMessageStep(sessionRepository.db, prevStepId, {
										status: "completed",
										finishReason: prevStep.finishReason,
										usage: prevStep.usage,
										provider: session.provider,
										model: session.model,
									});
								} catch (dbError) {
									console.error(`[prepareStep] Failed to complete step ${stepNumber - 1}:`, dbError);
								}

								// Emit step-complete event
								observer.next({
									type: "step-complete",
									stepId: prevStepId,
									usage: prevStep.usage,
									duration: 0, // TODO: track duration
									finishReason: prevStep.finishReason,
								});

								lastCompletedStepNumber = stepNumber - 1;
								currentStepParts = [];
							}

							// 2. Reload session to get latest state (includes new tool results)
							const currentSession = await sessionRepository.getSessionById(sessionId);
							if (!currentSession) {
								console.warn(`[prepareStep] Session ${sessionId} not found`);
								return {};
							}

							// 3. Calculate context token usage
							let contextTokens: { current: number; max: number } | undefined;
							try {
								let totalTokens = 0;
								for (const message of currentSession.messages) {
									if (message.usage) {
										totalTokens += message.usage.totalTokens;
									}
								}

								const modelDetails = await providerInstance.getModelDetails(
									modelName,
									providerConfig,
								);
								const maxContextLength = modelDetails?.contextLength;

								if (maxContextLength && totalTokens > 0) {
									contextTokens = {
										current: totalTokens,
										max: maxContextLength,
									};
								}
							} catch (error) {
								console.error("[prepareStep] Failed to calculate context tokens:", error);
							}

							// 4. Check all triggers for this step (unified for all steps)
							const triggerResults = await checkAllTriggers(
								currentSession,
								messageRepository,
								sessionRepository,
								contextTokens,
							);

							// 5. Build SystemMessage array from trigger results (may be empty)
							const systemMessages =
								triggerResults.length > 0
									? triggerResults.map((trigger) => ({
											type: trigger.messageType || "unknown",
											content: trigger.message,
											timestamp: Date.now(),
										}))
									: [];

							// 6. Create step record in database
							const stepId = `${assistantMessageId}-step-${stepNumber}`;
							try {
								await createMessageStep(
									sessionRepository.db,
									assistantMessageId,
									stepNumber,
									undefined, // metadata
									undefined, // todoSnapshot (deprecated)
									systemMessages.length > 0 ? systemMessages : undefined,
								);
							} catch (stepError) {
								console.error("[prepareStep] Failed to create step:", stepError);
							}

							// 7. Emit step-start event for UI
							observer.next({
								type: "step-start",
								stepId,
								stepIndex: stepNumber,
								metadata: { cpu: "N/A", memory: "N/A" },
								todoSnapshot: [],
								systemMessages: systemMessages.length > 0 ? systemMessages : undefined,
							});

							// 8. Inject system messages if present
							if (systemMessages.length > 0) {
								// Get base messages (from last step or initial messages)
								const baseMessages = steps.length > 0 ? steps[steps.length - 1].messages : messages;

								// Combine system messages (already wrapped in <system_message> tags)
								const combinedContent = systemMessages.map((sm) => sm.content).join("\n\n");

								// Append to last message to avoid consecutive user messages
								const lastMessage = baseMessages[baseMessages.length - 1];
								if (lastMessage && lastMessage.role === "user") {
									// Append system message to last user message
									const lastContent = lastMessage.content;
									const updatedContent = Array.isArray(lastContent)
										? [
												...lastContent,
												{
													type: "text" as const,
													text: "\n\n" + combinedContent,
												},
											]
										: [{ type: "text" as const, text: combinedContent }];

									const updatedMessages = [
										...baseMessages.slice(0, -1),
										{ ...lastMessage, content: updatedContent },
									];

									return { messages: updatedMessages };
								} else {
									// Fallback: add as separate user message (shouldn't happen in practice)
									const updatedMessages = [
										...baseMessages,
										{
											role: "user" as const,
											content: [{ type: "text" as const, text: combinedContent }],
										},
									];
									return { messages: updatedMessages };
								}
							}

							return {}; // No modifications needed
						} catch (error) {
							console.error("[prepareStep] Error:", error);
							// Don't crash the stream, just skip modifications
							return {};
						}
					},
				});

				// 10.1. Start title generation immediately (parallel API requests)
				// Fire-and-forget to allow true parallelism with main stream
				if (needsTitle) {
					generateSessionTitle(
						opts.appContext,
						sessionRepository,
						aiConfig,
						updatedSession,
						userMessageText,
					).catch((error) => {
						console.error("[Title Generation] Background error:", error);
					});
				}

				// 11. Process stream and emit events
				const callbacks: StreamCallbacks = {
					onTextStart: () => {
						observer.next({ type: "text-start" });
					},
					onTextDelta: (text) => {
						observer.next({ type: "text-delta", text });
					},
					onTextEnd: () => {
						observer.next({ type: "text-end" });
					},
					onReasoningStart: () => {
						observer.next({ type: "reasoning-start" });
					},
					onReasoningDelta: (text) => {
						observer.next({ type: "reasoning-delta", text });
					},
					onReasoningEnd: (duration) => {
						observer.next({ type: "reasoning-end", duration });
					},
					onToolCall: (toolCallId, toolName, args) =>
						observer.next({ type: "tool-call", toolCallId, toolName, args }),
					onToolResult: (toolCallId, toolName, result, duration) =>
						observer.next({
							type: "tool-result",
							toolCallId,
							toolName,
							result,
							duration,
						}),
					onToolError: (toolCallId, toolName, error, duration) =>
						observer.next({
							type: "tool-error",
							toolCallId,
							toolName,
							error,
							duration,
						}),
					onFile: (mediaType, base64) => {
						observer.next({ type: "file", mediaType, base64 });
					},
					onAbort: () => {
						aborted = true;
						// Note: Abort notification now handled by message-status-updated event
					},
					onError: (error) => {
						observer.next({ type: "error", error });
					},
				};

				// 12. Initialize stream processing state
				// Track active parts by index (for updating on delta/end events)
				const activeTools = new Map<string, { name: string; startTime: number; args: unknown }>();
				let currentTextPartIndex: number | null = null;
				let currentReasoningPartIndex: number | null = null;

				let finalUsage: TokenUsage | undefined;
				let finalFinishReason: string | undefined;
				let hasError = false;

				try {
					for await (const chunk of fullStream) {
						// Process AI SDK stream chunks
						// CRITICAL: Part ordering is determined by START events, not END events
						// This ensures correct ordering regardless of when end events arrive
						switch (chunk.type) {
							case "text-start": {
								// Create text part immediately (determines position in array)
								const partIndex = currentStepParts.length;
								currentStepParts.push({
									type: "text",
									content: "",
									status: "active",
								});
								currentTextPartIndex = partIndex;
								callbacks.onTextStart?.();
								break;
							}

							case "text-delta": {
								// Update active text part
								// AI SDK v5 uses 'text' property
								const textDelta = chunk as TextDeltaChunk;
								if (currentTextPartIndex !== null && textDelta.text !== undefined) {
									const part = currentStepParts[currentTextPartIndex];
									if (part && part.type === "text") {
										part.content += textDelta.text;
									}
									callbacks.onTextDelta?.(textDelta.text);
								}
								break;
							}

							case "text-end": {
								// Mark text part as completed
								if (currentTextPartIndex !== null) {
									const part = currentStepParts[currentTextPartIndex];
									if (part && part.type === "text") {
										part.status = "completed";
									}
									currentTextPartIndex = null;
								}
								callbacks.onTextEnd?.();
								break;
							}

							case "reasoning-start": {
								// Create reasoning part immediately (determines position in array)
								const partIndex = currentStepParts.length;
								const startTime = Date.now();
								currentStepParts.push({
									type: "reasoning",
									content: "",
									status: "active",
									duration: 0,
									startTime, // Store for duration calculation
								});
								currentReasoningPartIndex = partIndex;
								callbacks.onReasoningStart?.();
								break;
							}

							case "reasoning-delta": {
								// Update active reasoning part
								// AI SDK v5 uses 'text' property
								const reasoningDelta = chunk as ReasoningDeltaChunk;
								if (currentReasoningPartIndex !== null && reasoningDelta.text !== undefined) {
									const part = currentStepParts[currentReasoningPartIndex];
									if (part && part.type === "reasoning") {
										part.content += reasoningDelta.text;
									}
									callbacks.onReasoningDelta?.(reasoningDelta.text);
								}
								break;
							}

							case "reasoning-end": {
								// Mark reasoning part as completed and calculate duration
								if (currentReasoningPartIndex !== null) {
									const part = currentStepParts[currentReasoningPartIndex] as ReasoningPartWithStartTime;
									if (part && part.type === "reasoning") {
										part.status = "completed";
										const duration = part.startTime ? Date.now() - part.startTime : 0;
										part.duration = duration;
										delete part.startTime; // Clean up temp field
										callbacks.onReasoningEnd?.(duration);
									}
									currentReasoningPartIndex = null;
								}
								break;
							}

							case "tool-call": {
								// Create tool part (position determined by when tool-call event arrives)
								currentStepParts.push({
									type: "tool",
									toolId: chunk.toolCallId,
									name: chunk.toolName,
									status: "active",
									args: chunk.args,
								});

								activeTools.set(chunk.toolCallId, {
									name: chunk.toolName,
									startTime: Date.now(),
									args: chunk.args,
								});

								callbacks.onToolCall?.(chunk.toolCallId, chunk.toolName, chunk.args);
								break;
							}

							case "tool-result": {
								const tool = activeTools.get(chunk.toolCallId);
								if (tool) {
									const duration = Date.now() - tool.startTime;
									activeTools.delete(chunk.toolCallId);

									const toolPart = currentStepParts.find(
										(p) => p.type === "tool" && p.name === chunk.toolName && p.status === "active",
									);

									if (toolPart && toolPart.type === "tool") {
										toolPart.status = "completed";
										toolPart.duration = duration;
										toolPart.result = chunk.result;
									}

									callbacks.onToolResult?.(
										chunk.toolCallId,
										chunk.toolName,
										chunk.result,
										duration,
									);
								}
								break;
							}

							case "tool-error": {
								const tool = activeTools.get(chunk.toolCallId);
								if (tool) {
									const duration = Date.now() - tool.startTime;
									activeTools.delete(chunk.toolCallId);

									const toolPart = currentStepParts.find(
										(p) => p.type === "tool" && p.name === chunk.toolName && p.status === "active",
									);

									if (toolPart && toolPart.type === "tool") {
										toolPart.status = "error";
										toolPart.duration = duration;
										toolPart.error = chunk.error;
									}

									callbacks.onToolError?.(chunk.toolCallId, chunk.toolName, chunk.error, duration);
								}
								break;
							}

							case "file": {
								currentStepParts.push({
									type: "file",
									mediaType: chunk.mediaType,
									base64: chunk.base64,
									status: "completed",
								});

								callbacks.onFile?.(chunk.mediaType, chunk.base64);
								break;
							}

							case "abort": {
								// Mark all active parts as aborted
								currentStepParts.forEach((part) => {
									if (part.status === "active") {
										part.status = "abort";
									}
								});

								callbacks.onAbort?.();
								break;
							}

							case "error": {
								currentStepParts.push({
									type: "error",
									error: chunk.error,
									status: "completed",
								});
								hasError = true;
								callbacks.onError?.(chunk.error);
								break;
							}

							case "finish": {
								// AI SDK v5 uses 'totalUsage' property with standardized field names
								const finishChunk = chunk as FinishChunk;
								const sdkUsage: LanguageModelUsage = finishChunk.totalUsage;

								// Map AI SDK v5 usage to our database schema
								// AI SDK v5: inputTokens, outputTokens, totalTokens
								// Database: promptTokens, completionTokens, totalTokens
								if (sdkUsage) {
									finalUsage = {
										promptTokens: sdkUsage.inputTokens ?? 0,
										completionTokens: sdkUsage.outputTokens ?? 0,
										totalTokens: sdkUsage.totalTokens ?? 0,
									};
								}

								finalFinishReason = finishChunk.finishReason;
								callbacks.onFinish?.(finalUsage, finishChunk.finishReason);
								break;
							}

							// AI SDK v5 multi-step events - handled by prepareStep
							case "start": {
								// Stream started - no action needed
								break;
							}

							case "start-step": {
								// Step started - prepareStep hook already handles step creation
								break;
							}

							case "finish-step": {
								// Step finished - prepareStep hook handles step completion
								break;
							}

							default: {
								// Log truly unhandled event types for debugging
								console.log("[streamAIResponse] Unhandled chunk type:", chunk.type);
								break;
							}
						}
					}

					// No cleanup needed - all parts created on start events
				} catch (error) {
					const errorMessage = error instanceof Error ? error.message : String(error);

					// Check if this is an abort error (NoOutputGeneratedError when aborted)
					const isAbortError =
						(error instanceof Error && error.message.includes("No output generated")) ||
						(abortSignal && abortSignal.aborted);

					if (isAbortError) {
						// This is an abort, not an error - don't log as error
						aborted = true;
						// Emit abort event (only if not already emitted by onAbort callback)
						// Note: onAbort callback should have already emitted, but emit again as safety net
						console.log("[streamAIResponse] Abort detected in catch, aborted flag:", aborted);
					} else {
						// Real error - log it
						console.error("[streamAIResponse] Stream processing error:", error);
						// Add error part for real errors
						currentStepParts.push({
							type: "error",
							error: errorMessage,
							status: "completed",
						});
						hasError = true;
						callbacks.onError?.(errorMessage);
					}
				}

				// 13. Complete final step (if there is one)
				// prepareStep only completes previous steps, so we need to manually complete the last step
				if (lastCompletedStepNumber >= 0 || currentStepParts.length > 0) {
					const finalStepNumber = lastCompletedStepNumber + 1;
					const finalStepId = `${assistantMessageId}-step-${finalStepNumber}`;

					// Update final step parts
					try {
						await updateStepParts(sessionRepository.db, finalStepId, currentStepParts);
					} catch (dbError) {
						console.error(`[streamAIResponse] Failed to update final step ${finalStepNumber} parts:`, dbError);
					}

					// Complete final step
					try {
						await completeMessageStep(sessionRepository.db, finalStepId, {
							status: aborted ? "abort" : finalUsage ? "completed" : "error",
							finishReason: finalFinishReason,
							usage: finalUsage,
							provider: session.provider,
							model: session.model,
						});
					} catch (dbError) {
						console.error(`[streamAIResponse] Failed to complete final step ${finalStepNumber}:`, dbError);
					}

					// Emit final step-complete event
					observer.next({
						type: "step-complete",
						stepId: finalStepId,
						usage: finalUsage || {
							promptTokens: 0,
							completionTokens: 0,
							totalTokens: 0,
						},
						duration: 0, // TODO: track duration
						finishReason: finalFinishReason || "unknown",
					});
				}

				// 14. Emit error event if no valid response
				if (!finalUsage && !aborted && !hasError) {
					const errorPart = currentStepParts.find((p) => p.type === "error");
					if (errorPart && errorPart.type === "error") {
						observer.next({
							type: "error",
							error: errorPart.error,
						});
					} else {
						observer.next({
							type: "error",
							error:
								"API request failed to generate a response. Please check your API credentials and configuration.",
						});
					}
				}

				// 11. Update message status (aggregated from all steps)
				const finalStatus = aborted ? "abort" : finalUsage ? "completed" : "error";
				console.log(
					"[streamAIResponse] Updating message status to:",
					finalStatus,
					"messageId:",
					assistantMessageId,
				);
				try {
					await messageRepository.updateMessageStatus(
						assistantMessageId,
						finalStatus,
						finalFinishReason,
					);
					console.log("[streamAIResponse] Message status updated in DB");

					// Emit message-status-updated event (unified status change event)
					console.log("[streamAIResponse] Emitting message-status-updated event");
					observer.next({
						type: "message-status-updated",
						messageId: assistantMessageId,
						status: finalStatus,
						usage: finalUsage,
						finishReason: finalFinishReason,
					});
					console.log("[streamAIResponse] message-status-updated event emitted successfully");
				} catch (dbError) {
					console.error("[streamAIResponse] Failed to update message status:", dbError);
					// Continue - not critical for user experience
				}

				// 11.5. Create system message to notify LLM about abort (if enabled)
				// IMPORTANT: Only create notification for USER-INITIATED abort (via ESC key)
				// - Error/timeout/network issues are NOT user abort
				// - Status 'abort' is only set when abortSignal.aborted is true (line 805-807, 842)
				// - This ensures we only notify LLM when user explicitly cancels
				if (finalStatus === "abort" && aiConfig.notifyLLMOnAbort) {
					try {
						console.log("[streamAIResponse] Creating system message to notify LLM about abort");
						const systemMessageId = await messageRepository.addMessage({
							sessionId,
							role: "system",
							content: [
								{
									type: "text",
									content: "Previous assistant message was aborted by user.",
									status: "completed",
								},
							],
							status: "completed",
						});
						console.log("[streamAIResponse] System message created:", systemMessageId);

						// Emit system-message-created event
						observer.next({
							type: "system-message-created",
							messageId: systemMessageId,
							content: "Previous assistant message was aborted by user.",
						});
						console.log("[streamAIResponse] system-message-created event emitted");
					} catch (systemMessageError) {
						console.error(
							"[streamAIResponse] Failed to create abort notification system message:",
							systemMessageError,
						);
						// Continue - not critical for user experience
					}
				}

				// 12. Complete observable (title continues independently via eventStream)
				observer.complete();
			} catch (error) {
				console.error("[streamAIResponse] Error in execution:", error);
				console.error("[streamAIResponse] Error type:", error?.constructor?.name);
				console.error(
					"[streamAIResponse] Error message:",
					error instanceof Error ? error.message : String(error),
				);
				console.error(
					"[streamAIResponse] Error stack:",
					error instanceof Error ? error.stack : "N/A",
				);
				if (error && typeof error === "object") {
					console.error("[streamAIResponse] Error keys:", Object.keys(error));
					console.error("[streamAIResponse] Error JSON:", JSON.stringify(error, null, 2));
				}
				observer.next({
					type: "error",
					error: error instanceof Error ? error.message : String(error),
				});
				observer.complete();
			}
		})();

		// Catch unhandled promise rejections
		// NOTE: This should theoretically never fire because try-catch above handles all errors
		// But if it does, we need to handle it gracefully without crashing
		executionPromise.catch((error) => {
			console.error("[streamAIResponse] Unhandled promise rejection:", error);

			// Extract detailed error message (unwrap if it's a wrapped error)
			let errorMessage = error instanceof Error ? error.message : String(error);

			// If it's NoOutputGeneratedError, try to get the underlying cause
			if (error && typeof error === "object" && "cause" in error && error.cause) {
				const causeMessage =
					error.cause instanceof Error ? error.cause.message : String(error.cause);
				console.error("[streamAIResponse] Error cause:", causeMessage);
				// Use the cause message if it's more informative
				if (causeMessage && !causeMessage.includes("No output generated")) {
					errorMessage = causeMessage;
				}
			}

			// DON'T use observer.error() - it causes the entire observable to error and can crash
			// Instead, send error event and complete normally
			try {
				observer.next({
					type: "error",
					error: errorMessage,
				});
				observer.complete();
			} catch (observerError) {
				console.error("[streamAIResponse] Failed to emit error event:", observerError);
				// Last resort - try to complete the observer to prevent hanging
				try {
					observer.complete();
				} catch (completeError) {
					console.error("[streamAIResponse] Failed to complete observer:", completeError);
				}
			}
		});

		// Cleanup function
		return () => {
			aborted = true;
		};
	});
}
