/**
 * Claude Code Language Model
 * Custom LanguageModelV2 implementation using Claude Agent SDK
 * Supports Vercel AI SDK tools (executed by Vercel framework via MCP delegation)
 *
 * Session Management & Message Tracking:
 * --------------------------------------
 * This provider intelligently manages Claude Code sessions to avoid duplication.
 *
 * How it works:
 * 1. Provider tracks which messages were sent to Claude Code session
 * 2. When resuming, only NEW messages are sent (avoids duplication)
 * 3. Message count is returned to caller for next request
 *
 * Usage Pattern:
 * ```typescript
 * // First call - creates new session
 * const result1 = await generateText({
 *   model: claudeCode('sonnet'),
 *   messages: [{ role: 'user', content: 'Hello' }]
 * });
 *
 * // Extract session info for reuse
 * const sessionId = result1.response.headers['x-claude-code-session-id'];
 * const messageCount = parseInt(result1.response.headers['x-claude-code-message-count'] || '0');
 * const fingerprints = JSON.parse(result1.response.headers['x-claude-code-message-fingerprints'] || '[]');
 *
 * // Second call - reuses session (provider only sends NEW messages)
 * const result2 = await generateText({
 *   model: claudeCode('sonnet'),
 *   messages: [
 *     { role: 'user', content: 'Hello' },        // Already in Claude Code session
 *     { role: 'assistant', content: 'Hi!' },     // Already in Claude Code session
 *     { role: 'user', content: 'How are you?' }  // NEW - will be sent
 *   ],
 *   providerOptions: {
 *     'claude-code': {
 *       sessionId: sessionId,                      // Resume this session
 *       lastProcessedMessageCount: messageCount,   // Skip first N messages
 *       messageFingerprints: fingerprints          // Detect rewind/edit
 *     }
 *   }
 * });
 *
 * // Check if session was force-created due to rewind/edit
 * if (result2.warnings?.length > 0) {
 *   console.log('New session created:', result2.warnings[0]);
 * }
 * ```
 *
 * For streaming (streamText):
 * ```typescript
 * const result = await streamText({ ... });
 * for await (const chunk of result.fullStream) {
 *   if (chunk.type === 'finish') {
 *     const metadata = chunk.providerMetadata?.['claude-code'];
 *     const sessionId = metadata?.sessionId;
 *     const messageCount = metadata?.messageCount;
 *     const fingerprints = metadata?.messageFingerprints;
 *     const forcedNew = metadata?.forcedNewSession;
 *     // Save these for next request
 *     if (forcedNew) {
 *       console.log('Message history changed, new session created');
 *     }
 *   }
 * }
 * ```
 *
 * Rewind / Edit Detection:
 * -------------------------
 * Provider automatically detects when message history changes:
 * - Rewind: Message count decreased (user deleted messages)
 * - Edit: Previously sent message content changed
 * - When detected: Automatically creates new session, returns warning
 * - Detection via messageFingerprints (role + first 100 chars of content)
 *
 * Fallback behavior (when lastProcessedMessageCount not provided):
 * - Provider sends only last user message + any tool results after it
 * - This is safer than sending full history which would duplicate
 * - But explicit tracking via lastProcessedMessageCount + messageFingerprints is recommended
 *
 * Key Points:
 * -----------
 * ✅ Provider handles message deduplication automatically
 * ✅ You always pass full message history to Vercel AI SDK
 * ✅ Provider internally skips messages already in Claude Code session
 * ✅ Provider detects rewind/edit and creates new session automatically
 * ✅ No need to manually track what was sent - just pass tracking info back
 * ⚠️  Session IDs are stored in ~/.claude/sessions/ by Claude Code CLI
 * 📦 Tracking data: sessionId, messageCount, messageFingerprints (all in response)
 */

import type {
	LanguageModelV2,
	LanguageModelV2CallOptions,
	LanguageModelV2StreamPart,
} from "@ai-sdk/provider";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { parseContentBlocks } from "./text-based-tools.js";
import { convertMessagesToString } from "./message-converter.js";
import { convertTools, buildQueryOptions } from "./query-builder.js";
import { extractUsage, handleResultError } from "./usage-handler.js";
import { processStream } from "./stream-processor.js";

export interface ClaudeCodeLanguageModelConfig {
	modelId: string;
}

export class ClaudeCodeLanguageModel implements LanguageModelV2 {
	readonly specificationVersion = "v2" as const;
	readonly provider = "claude-code" as const;
	readonly modelId: string;

	constructor(config: ClaudeCodeLanguageModelConfig) {
		this.modelId = config.modelId;
	}

	get supportedUrls(): Record<string, RegExp[]> {
		// Claude supports various image formats
		return {
			"image/*": [/.*/],
		};
	}

	async doGenerate(
		options: LanguageModelV2CallOptions,
	): Promise<Awaited<ReturnType<LanguageModelV2["doGenerate"]>>> {
		try {
			console.log("[ClaudeCode] Starting doGenerate with model:", this.modelId);
			// Convert tools and build query options
			const tools = convertTools(options.tools || []);
			const { queryOptions } = buildQueryOptions(this.modelId, options, tools);

			// Check if resuming existing session
			const isResuming = !!queryOptions.resume;

			// Convert messages - will skip already processed messages if resuming
			// Also detects message inconsistencies (rewind/edit)
			const {
				prompt: promptString,
				shouldForceNewSession,
				messageFingerprints,
			} = convertMessagesToString(options, isResuming);

			// If inconsistency detected, clear resume to create new session
			if (shouldForceNewSession) {
				delete queryOptions.resume;
			}

			// Execute query
			const queryResult = query({
				prompt: promptString,
				options: queryOptions,
			});

			// Collect results
			const contentParts: any[] = [];
			let inputTokens = 0;
			let outputTokens = 0;
			let finishReason: "stop" | "length" | "tool-calls" = "stop";
			let sessionId: string | undefined;

			for await (const event of queryResult) {
				// Extract session ID from any event (all events have session_id)
				if ("session_id" in event && typeof event.session_id === "string") {
					sessionId = event.session_id;
				}

				if (event.type === "assistant") {
					// Extract content from assistant message
					const content = event.message.content;
					for (const block of content) {
						if (block.type === "thinking") {
							// Handle thinking/reasoning blocks
							contentParts.push({
								type: "reasoning",
								reasoning: block.thinking,
							});
						} else if (block.type === "text") {
							// Parse text for tool calls if tools are available
							if (tools && Object.keys(tools).length > 0) {
								const parsedBlocks = parseContentBlocks(block.text);
								for (const parsedBlock of parsedBlocks) {
									if (parsedBlock.type === "text") {
										contentParts.push({
											type: "text",
											text: parsedBlock.text,
										});
									} else if (parsedBlock.type === "tool_use") {
										contentParts.push({
											type: "tool-call",
											toolCallId: parsedBlock.toolCallId,
											toolName: parsedBlock.toolName,
											input: JSON.stringify(parsedBlock.arguments),
										});
										finishReason = "tool-calls";
									}
								}
							} else {
								// No tools, just add text
								contentParts.push({
									type: "text",
									text: block.text,
								});
							}
						}
					}

					// Check stop reason
					if (event.message.stop_reason === "end_turn") {
						// Keep tool-calls finish reason if we detected tool calls
						if (finishReason !== "tool-calls") {
							finishReason = "stop";
						}
					} else if (event.message.stop_reason === "max_tokens") {
						finishReason = "length";
					}
				} else if (event.type === "result") {
					handleResultError(event);
					const usage = extractUsage(event);
					inputTokens = usage.inputTokens;
					outputTokens = usage.outputTokens;
				}
			}

			// Calculate total message count for next call
			const totalMessageCount = options.prompt.length;

			// Build response headers with session tracking info
			const headers: Record<string, string> = {};
			if (sessionId) {
				headers["x-claude-code-session-id"] = sessionId;
				headers["x-claude-code-message-count"] = String(totalMessageCount);
				// Include fingerprints for next call's consistency check
				headers["x-claude-code-message-fingerprints"] = JSON.stringify(messageFingerprints);
			}
			// Add warning if session was force-created due to inconsistency
			if (shouldForceNewSession) {
				headers["x-claude-code-session-forced-new"] = "true";
			}

			return {
				content: contentParts,
				finishReason,
				usage: {
					inputTokens: inputTokens,
					outputTokens: outputTokens,
					totalTokens: inputTokens + outputTokens,
				},
				warnings: shouldForceNewSession
					? [
							"Message history inconsistency detected (rewind or edit). Created new Claude Code session.",
						]
					: [],
				response: {
					headers,
				},
			};
		} catch (error) {
			// Log detailed error information
			console.error("[ClaudeCode] Execution failed:", {
				message: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
				modelId: this.modelId,
			});
			throw new Error(
				`Claude Code execution failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	doStream(
		options: LanguageModelV2CallOptions,
	): Promise<Awaited<ReturnType<LanguageModelV2["doStream"]>>> {
		try {
			console.log("[ClaudeCode] Starting doStream with model:", this.modelId);
			// Convert tools and build query options
			const tools = convertTools(options.tools || []);
			const { queryOptions } = buildQueryOptions(this.modelId, options, tools, true);

			// Check if resuming existing session
			const isResuming = !!queryOptions.resume;

			// Convert messages - will skip already processed messages if resuming
			// Also detects message inconsistencies (rewind/edit)
			const {
				prompt: promptString,
				shouldForceNewSession,
				messageFingerprints,
			} = convertMessagesToString(options, isResuming);

			// If inconsistency detected, clear resume to create new session
			if (shouldForceNewSession) {
				delete queryOptions.resume;
			}

			// Calculate total message count for metadata
			const totalMessageCount = options.prompt.length;

			// Execute query
			const queryResult = query({
				prompt: promptString,
				options: queryOptions,
			});

			// Create streaming response using stream processor
			const stream = new ReadableStream<LanguageModelV2StreamPart>({
				async start(controller) {
					try {
						for await (const part of processStream({
							queryResult,
							tools,
							totalMessageCount,
							messageFingerprints,
							shouldForceNewSession,
						})) {
							controller.enqueue(part);
						}
						controller.close();
					} catch (error) {
						controller.error(error);
					}
				},
			});

			return {
				stream,
				response: { headers: {} },
				warnings: [],
			};
		} catch (error) {
			throw new Error(
				`Claude Code streaming failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
}
