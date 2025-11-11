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

import { observable } from '@trpc/server/observable';
import type {
  SessionRepository,
  MessageRepository,
  AIConfig,
  TokenUsage,
  MessagePart,
} from '@sylphx/code-core';
import {
  createAIStream,
  buildSystemPrompt,
  createMessageStep,
  updateStepParts,
  completeMessageStep,
  getProvider,
} from '@sylphx/code-core';
import type { StreamCallbacks } from '@sylphx/code-core';
import type { AppContext } from '../context.js';
import { ensureSession } from './streaming/session-manager.js';
import { buildModelMessages } from './streaming/message-builder.js';
import { generateSessionTitle, needsTitleGeneration } from './streaming/title-generator.js';
import { validateProvider } from './streaming/provider-validator.js';

// Re-export StreamEvent type from message router
export type StreamEvent =
  // Session-level events
  | { type: 'session-created'; sessionId: string; provider: string; model: string }
  | { type: 'session-updated'; sessionId: string }
  | { type: 'session-title-updated-start'; sessionId: string }
  | { type: 'session-title-updated-delta'; sessionId: string; text: string }
  | { type: 'session-title-updated-end'; sessionId: string; title: string }

  // Message-level events
  | { type: 'user-message-created'; messageId: string; content: string }
  | { type: 'assistant-message-created'; messageId: string }
  | { type: 'system-message-created'; messageId: string; content: string }

  // Step-level events (NEW)
  | { type: 'step-start'; stepId: string; stepIndex: number; metadata: { cpu: string; memory: string }; todoSnapshot: any[]; systemMessages?: Array<{ type: string; content: string; timestamp: number }> }
  | { type: 'step-complete'; stepId: string; usage: TokenUsage; duration: number; finishReason: string }

  // Content streaming events (within a step)
  | { type: 'text-start' }
  | { type: 'text-delta'; text: string }
  | { type: 'text-end' }
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'reasoning-end'; duration: number }
  | { type: 'tool-call'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool-input-start'; toolCallId: string }
  | { type: 'tool-input-delta'; toolCallId: string; argsTextDelta: string }
  | { type: 'tool-input-end'; toolCallId: string }
  | { type: 'tool-result'; toolCallId: string; toolName: string; result: any; duration: number }
  | { type: 'tool-error'; toolCallId: string; toolName: string; error: string; duration: number }
  | { type: 'file'; mediaType: string; base64: string }

  // Message completion
  | { type: 'complete'; usage?: TokenUsage; finishReason?: string }
  | { type: 'error'; error: string }
  | { type: 'abort' };

/**
 * Parsed content part from frontend
 */
type ParsedContentPart =
  | { type: 'text'; content: string }
  | {
      type: 'file';
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
  sessionId: string | null;  // null = create new session
  agentId?: string;   // Optional - override session agent
  provider?: string;  // Required if sessionId is null
  model?: string;     // Required if sessionId is null

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
export function streamAIResponse(opts: StreamAIResponseOptions) {
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
            inputAgentId
          );
          sessionId = result.sessionId;
          isNewSession = result.isNewSession;

          // Emit session-created event if new
          if (isNewSession && inputProvider && inputModel) {
            observer.next({
              type: 'session-created',
              sessionId: sessionId,
              provider: inputProvider,
              model: inputModel,
            });
          }
        } catch (error) {
          observer.next({
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
          });
          observer.complete();
          return;
        }

        // 2. Load session from database
        const session = await sessionRepository.getSessionById(sessionId);
        if (!session) {
          observer.error(new Error('Session not found'));
          return;
        }

        // 2. Validate provider configuration
        const validationError = validateProvider(aiConfig, session);
        if (validationError) {
          observer.next({
            type: 'error',
            error: validationError.message,
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
          const fs = await import('node:fs/promises');
          const { lookup } = await import('mime-types');

          for (const part of userMessageContent) {
            if (part.type === 'text') {
              frozenContent.push({
                type: 'text',
                content: part.content,
                status: 'completed',
              });
            } else if (part.type === 'file') {
              try {
                // READ NOW and freeze - never re-read from disk
                const buffer = await fs.readFile(part.path);
                const mimeType = part.mimeType || lookup(part.path) || 'application/octet-stream';

                // LEGACY format for backward compatibility
                // New messages will migrate to file-ref after step creation
                frozenContent.push({
                  type: 'file',
                  relativePath: part.relativePath,
                  size: buffer.length,
                  mediaType: mimeType,
                  base64: buffer.toString('base64'), // Temporary - will be moved to file_contents
                  status: 'completed',
                });
              } catch (error) {
                // File read failed - save error
                console.error('[streamAIResponse] File read failed:', error);
                frozenContent.push({
                  type: 'error',
                  error: `Failed to read file: ${part.relativePath}`,
                  status: 'completed',
                });
              }
            }
          }
        }

        // 4. Add user message to session (with frozen content)
        // Only if userMessageContent is provided (not null/undefined)
        // If not provided, use existing session messages (e.g., after compact with summary)
        let userMessageId: string | null = null;
        let userMessageText = '';

        if (userMessageContent) {
          userMessageId = await messageRepository.addMessage({
            sessionId,
            role: 'user',
            content: frozenContent,
            // REMOVED: metadata with cpu/memory (now provided via dynamic system messages)
            // REMOVED: todoSnapshot (no longer stored, see TODOSNAPSHOT-REALITY.md)
          });

          // 4.1. Emit user-message-created event
          // Extract text content for display (omit file details)
          userMessageText = userMessageContent
            .map((part) =>
              part.type === 'text' ? part.content : `@${part.relativePath}`
            )
          .join('');

          observer.next({
            type: 'user-message-created',
            messageId: userMessageId,
            content: userMessageText,
          });
        }

        // 4. Reload session to get updated messages
        let updatedSession = await sessionRepository.getSessionById(sessionId);
        if (!updatedSession) {
          observer.error(new Error('Session not found after adding message'));
          return;
        }

        // 4.5. Import trigger checker for use in onPrepareMessages
        // All trigger checks happen dynamically in onPrepareMessages hook (unified for all steps)
        const { checkAllTriggers } = await import('@sylphx/code-core');

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
            console.error('[Streaming] Failed to fetch model capabilities:', err);
            // Continue with empty capabilities (degraded mode)
          }
        }

        // 6. Build ModelMessage[] for AI (transforms frozen content, no file reading)
        const messages = await buildModelMessages(
          updatedSession.messages,
          modelCapabilities,
          messageRepository.getFileRepository()
        );

        // 7. Determine agentId and build system prompt
        // STATELESS: Use explicit parameters from AppContext
        const agentId = inputAgentId || session.agentId || 'coder';
        const agents = opts.appContext.agentManager.getAll();
        const enabledRuleIds = session.enabledRuleIds || [];
        const enabledRules = opts.appContext.ruleManager.getEnabled(enabledRuleIds);
        const systemPrompt = buildSystemPrompt(agentId, agents, enabledRules);

        // 8. Create AI model
        const model = providerInstance.createClient(providerConfig, modelName);

        // 9. Determine tool support from capabilities
        const enableTools = modelCapabilities.has('tools');

        // 9.5. Check if title generation is needed (before creating streams)
        const isFirstMessage =
          updatedSession.messages.filter((m) => m.role === 'user').length === 1;
        const needsTitle = needsTitleGeneration(updatedSession, isNewSession, isFirstMessage);

        // 10. Create AI stream with system prompt
        // Only enable native tools if model supports them
        // Models without native support (like claude-code) will fall back to text-based tools

        let currentStepNumber = 0;

        const stream = createAIStream({
          model,
          providerInstance, // Pass provider for reasoning control
          messages,
          system: systemPrompt,
          enableTools, // Conditional tool usage based on model capabilities
          ...(abortSignal ? { abortSignal } : {}),
          // REMOVED: onTransformToolResult - system status now injected via system-message mechanism
          // ⭐ NEW: Prepare messages before each step (allows injecting system messages mid-stream)
          onPrepareMessages: async (messages, stepNumber) => {
            // Update current step number
            currentStepNumber = stepNumber;

            try {
              // Reload session to get latest state (includes new tool results)
              const currentSession = await sessionRepository.getSessionById(sessionId);
              if (!currentSession) {
                console.warn(`[onPrepareMessages] Session ${sessionId} not found`);
                return messages;
              }

              // Calculate context token usage
              let contextTokens: { current: number; max: number } | undefined;
              try {
                let totalTokens = 0;
                for (const message of currentSession.messages) {
                  if (message.usage) {
                    totalTokens += message.usage.totalTokens;
                  }
                }

                const modelDetails = await providerInstance.getModelDetails(modelName, providerConfig);
                const maxContextLength = modelDetails?.contextLength;

                if (maxContextLength && totalTokens > 0) {
                  contextTokens = {
                    current: totalTokens,
                    max: maxContextLength,
                  };
                }
              } catch (error) {
                console.error('[onPrepareMessages] Failed to calculate context tokens:', error);
              }

              // Check all triggers for this step (unified for all steps)
              const triggerResults = await checkAllTriggers(
                currentSession,
                messageRepository,
                sessionRepository,
                contextTokens
              );

              // Build SystemMessage array from trigger results (may be empty)
              const systemMessages = triggerResults.length > 0
                ? triggerResults.map(trigger => ({
                    type: trigger.messageType || 'unknown',
                    content: trigger.message,
                    timestamp: Date.now(),
                  }))
                : [];

              // Always create step (even if no system messages)
              const newStepId = `${assistantMessageId}-step-${stepNumber}`;
              try {
                await createMessageStep(
                  sessionRepository.db,
                  assistantMessageId,
                  stepNumber,
                  undefined, // metadata
                  undefined, // todoSnapshot (deprecated)
                  systemMessages.length > 0 ? systemMessages : undefined
                );

                // Emit step-start event for UI
                const stepStartEvent = {
                  type: 'step-start' as const,
                  stepId: newStepId,
                  stepIndex: stepNumber,
                  metadata: { cpu: 'N/A', memory: 'N/A' }, // Placeholder (resources now in system messages)
                  todoSnapshot: [], // Deprecated
                  systemMessages: systemMessages.length > 0 ? systemMessages : undefined,
                };
                observer.next(stepStartEvent);
              } catch (stepError) {
                console.error('[onPrepareMessages] Failed to create step:', stepError);
              }

              // If there are system messages, inject them into model messages
              if (systemMessages.length > 0) {
                // Combine system messages (already wrapped in <system_message> tags)
                const combinedContent = systemMessages
                  .map(sm => sm.content)
                  .join('\n\n');

                // Append to last message to avoid consecutive user messages
                const lastMessage = messages[messages.length - 1];
                if (lastMessage && lastMessage.role === 'user') {
                  // Append system message to last user message
                  const lastContent = lastMessage.content;
                  const updatedContent = Array.isArray(lastContent)
                    ? [...lastContent, { type: 'text' as const, text: '\n\n' + combinedContent }]
                    : [{ type: 'text' as const, text: combinedContent }];

                  const updatedMessages = [
                    ...messages.slice(0, -1),
                    { ...lastMessage, content: updatedContent }
                  ];

                  return updatedMessages;
                } else {
                  // Fallback: add as separate user message (shouldn't happen in practice)
                  const updatedMessages = [...messages, {
                    role: 'user' as const,
                    content: [{ type: 'text' as const, text: combinedContent }],
                  }];
                  return updatedMessages;
                }
              }

              return messages;
            } catch (error) {
              console.error('[onPrepareMessages] Error checking triggers:', error);
              // Don't crash the stream, just skip trigger check
              return messages;
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
            userMessageText
          ).catch((error) => {
            console.error('[Title Generation] Background error:', error);
          });
        }

        // 9. Create assistant message in database (status: active)
        const assistantMessageId = await messageRepository.addMessage({
          sessionId,
          role: 'assistant',
          content: [], // Empty content initially
          status: 'active',
        });

        // 9.1. Emit assistant message created event
        observer.next({ type: 'assistant-message-created', messageId: assistantMessageId });

        // 9.2. Step creation now handled by onPrepareMessages hook
        // All steps (including step-0) are created dynamically with system messages if needed
        // step-start event will be emitted by onPrepareMessages

        // 10. Process stream and emit events
        const callbacks: StreamCallbacks = {
          onTextStart: () => {
            observer.next({ type: 'text-start' });
          },
          onTextDelta: (text) => {
            observer.next({ type: 'text-delta', text });
          },
          onTextEnd: () => {
            observer.next({ type: 'text-end' });
          },
          onReasoningStart: () => {
            observer.next({ type: 'reasoning-start' });
          },
          onReasoningDelta: (text) => {
            observer.next({ type: 'reasoning-delta', text });
          },
          onReasoningEnd: (duration) => {
            observer.next({ type: 'reasoning-end', duration });
          },
          onToolCall: (toolCallId, toolName, args) =>
            observer.next({ type: 'tool-call', toolCallId, toolName, args }),
          onToolResult: (toolCallId, toolName, result, duration) =>
            observer.next({ type: 'tool-result', toolCallId, toolName, result, duration }),
          onToolError: (toolCallId, toolName, error, duration) =>
            observer.next({ type: 'tool-error', toolCallId, toolName, error, duration }),
          onFile: (mediaType, base64) => {
            observer.next({ type: 'file', mediaType, base64 });
          },
          onAbort: () => {
            aborted = true;
            observer.next({ type: 'abort' });
          },
          onError: (error) => {
            observer.next({ type: 'error', error });
          },
        };

        // 10. Process stream with step-aware part accumulation
        // CRITICAL: We need to save parts PER STEP, not accumulate all steps into one array
        // Each step-end event should trigger saving parts for that step
        let currentStepParts: MessagePart[] = [];
        const activeTools = new Map<string, { name: string; startTime: number; args: unknown }>();

        // Track active parts by index (for updating on delta/end events)
        let currentTextPartIndex: number | null = null;
        let currentReasoningPartIndex: number | null = null;

        let finalUsage: TokenUsage | undefined;
        let finalFinishReason: string | undefined;
        let hasError = false;

        try {
          for await (const chunk of stream) {
            // Handle step-end event: save current step's parts
            if ((chunk as any).type === 'step-end') {
              const stepNum = (chunk as any).stepNumber;
              const stepId = `${assistantMessageId}-step-${stepNum}`;
              const responseMessages = (chunk as any).responseMessages;

              // Update tool results with AI SDK's wrapped format from response.messages
              if (responseMessages && Array.isArray(responseMessages)) {
                for (const msg of responseMessages) {
                  if (msg.role === 'tool') {
                    // Tool message contains wrapped tool results
                    for (const part of msg.content) {
                      if (part.type === 'tool-result') {
                        // Find matching tool part in currentStepParts
                        const toolPart = currentStepParts.find(
                          (p) => p.type === 'tool' && p.toolId === part.toolCallId
                        );

                        if (toolPart && toolPart.type === 'tool') {
                          // Update with AI SDK's wrapped format
                          toolPart.result = part.output;  // ← Store wrapped format: { type: 'json', value: {...} }
                        }
                      }
                    }
                  }
                }
              }

              // Update step parts in database
              try {
                await updateStepParts(sessionRepository.db, stepId, currentStepParts);
              } catch (dbError) {
                console.error(`[streamAIResponse] Failed to update step ${stepNum} parts:`, dbError);
              }

              // Complete the step
              try {
                await completeMessageStep(sessionRepository.db, stepId, {
                  status: aborted ? 'abort' : finalUsage ? 'completed' : 'error',
                  finishReason: (chunk as any).finishReason,
                  usage: finalUsage,
                  provider: session.provider,
                  model: session.model,
                });
              } catch (dbError) {
                console.error(`[streamAIResponse] Failed to complete step ${stepNum}:`, dbError);
              }

              // Emit step-complete event
              const stepDuration = 0; // TODO: Calculate from step startTime
              observer.next({
                type: 'step-complete',
                stepId,
                usage: finalUsage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                duration: stepDuration,
                finishReason: (chunk as any).finishReason || 'unknown',
              });

              // Reset parts accumulation for next step
              currentStepParts = [];
              continue;
            }

            // Handle step-start event
            if ((chunk as any).type === 'step-start') {
              // Just reset parts (step record already created by onPrepareMessages)
              currentStepParts = [];
              continue;
            }

            // Regular chunk processing
            // CRITICAL: Part ordering is determined by START events, not END events
            // This ensures correct ordering regardless of when end events arrive
            switch (chunk.type) {
              case 'text-start': {
                // Create text part immediately (determines position in array)
                const partIndex = currentStepParts.length;
                currentStepParts.push({
                  type: 'text',
                  content: '',
                  status: 'active',
                });
                currentTextPartIndex = partIndex;
                callbacks.onTextStart?.();
                break;
              }

              case 'text-delta': {
                // Update active text part
                if (currentTextPartIndex !== null) {
                  const part = currentStepParts[currentTextPartIndex];
                  if (part && part.type === 'text') {
                    part.content += chunk.textDelta;
                  }
                }
                callbacks.onTextDelta?.(chunk.textDelta);
                break;
              }

              case 'text-end': {
                // Mark text part as completed
                if (currentTextPartIndex !== null) {
                  const part = currentStepParts[currentTextPartIndex];
                  if (part && part.type === 'text') {
                    part.status = 'completed';
                  }
                  currentTextPartIndex = null;
                }
                callbacks.onTextEnd?.();
                break;
              }

              case 'reasoning-start': {
                // Create reasoning part immediately (determines position in array)
                const partIndex = currentStepParts.length;
                const startTime = Date.now();
                currentStepParts.push({
                  type: 'reasoning',
                  content: '',
                  status: 'active',
                  duration: 0,
                  startTime, // Store for duration calculation
                });
                currentReasoningPartIndex = partIndex;
                callbacks.onReasoningStart?.();
                break;
              }

              case 'reasoning-delta': {
                // Update active reasoning part
                if (currentReasoningPartIndex !== null) {
                  const part = currentStepParts[currentReasoningPartIndex];
                  if (part && part.type === 'reasoning') {
                    part.content += chunk.textDelta;
                  }
                }
                callbacks.onReasoningDelta?.(chunk.textDelta);
                break;
              }

              case 'reasoning-end': {
                // Mark reasoning part as completed and calculate duration
                if (currentReasoningPartIndex !== null) {
                  const part = currentStepParts[currentReasoningPartIndex];
                  if (part && part.type === 'reasoning') {
                    part.status = 'completed';
                    const duration = (part as any).startTime ? Date.now() - (part as any).startTime : 0;
                    part.duration = duration;
                    delete (part as any).startTime; // Clean up temp field
                    callbacks.onReasoningEnd?.(duration);
                  }
                  currentReasoningPartIndex = null;
                }
                break;
              }

              case 'tool-call': {
                // Create tool part (position determined by when tool-call event arrives)
                currentStepParts.push({
                  type: 'tool',
                  toolId: chunk.toolCallId,
                  name: chunk.toolName,
                  status: 'active',
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

              case 'tool-result': {
                const tool = activeTools.get(chunk.toolCallId);
                if (tool) {
                  const duration = Date.now() - tool.startTime;
                  activeTools.delete(chunk.toolCallId);

                  const toolPart = currentStepParts.find(
                    (p) => p.type === 'tool' && p.name === chunk.toolName && p.status === 'active'
                  );

                  if (toolPart && toolPart.type === 'tool') {
                    toolPart.status = 'completed';
                    toolPart.duration = duration;
                    toolPart.result = chunk.result;
                  }

                  callbacks.onToolResult?.(chunk.toolCallId, chunk.toolName, chunk.result, duration);
                }
                break;
              }

              case 'tool-error': {
                const tool = activeTools.get(chunk.toolCallId);
                if (tool) {
                  const duration = Date.now() - tool.startTime;
                  activeTools.delete(chunk.toolCallId);

                  const toolPart = currentStepParts.find(
                    (p) => p.type === 'tool' && p.name === chunk.toolName && p.status === 'active'
                  );

                  if (toolPart && toolPart.type === 'tool') {
                    toolPart.status = 'error';
                    toolPart.duration = duration;
                    toolPart.error = chunk.error;
                  }

                  callbacks.onToolError?.(chunk.toolCallId, chunk.toolName, chunk.error, duration);
                }
                break;
              }

              case 'file': {
                currentStepParts.push({
                  type: 'file',
                  mediaType: chunk.mediaType,
                  base64: chunk.base64,
                  status: 'completed',
                });

                callbacks.onFile?.(chunk.mediaType, chunk.base64);
                break;
              }

              case 'abort': {
                // Mark all active parts as aborted
                currentStepParts.forEach(part => {
                  if (part.status === 'active') {
                    part.status = 'abort';
                  }
                });

                callbacks.onAbort?.();
                break;
              }

              case 'error': {
                currentStepParts.push({ type: 'error', error: chunk.error, status: 'completed' });
                hasError = true;
                callbacks.onError?.(chunk.error);
                break;
              }

              case 'finish': {
                finalUsage = chunk.usage;
                finalFinishReason = chunk.finishReason;
                callbacks.onFinish?.(chunk.usage, chunk.finishReason);
                break;
              }
            }
          }

          // No cleanup needed - all parts created on start events

        } catch (error) {
          console.error('[streamAIResponse] Stream processing error:', error);
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Add error part
          currentStepParts.push({ type: 'error', error: errorMessage, status: 'completed' });
          hasError = true;
          callbacks.onError?.(errorMessage);
        }

        // Emit error event if no valid response
        if (!finalUsage && !aborted && !hasError) {
          const errorPart = currentStepParts.find(p => p.type === 'error');
          if (errorPart && errorPart.type === 'error') {
            observer.next({
              type: 'error',
              error: errorPart.error,
            });
          } else {
            observer.next({
              type: 'error',
              error: 'API request failed to generate a response. Please check your API credentials and configuration.',
            });
          }
        }

        // 11. Update message status (aggregated from all steps)
        try {
          await messageRepository.updateMessageStatus(
            assistantMessageId,
            aborted ? 'abort' : finalUsage ? 'completed' : 'error',
            finalFinishReason
          );
        } catch (dbError) {
          console.error('[streamAIResponse] Failed to update message status:', dbError);
          // Continue - not critical for user experience
        }

        // 12. Emit complete event (message content done)
        observer.next({
          type: 'complete',
          usage: finalUsage,
          finishReason: finalFinishReason,
        });

        // 13. Complete observable (title continues independently via eventStream)
        observer.complete();
      } catch (error) {
        console.error('[streamAIResponse] Error in execution:', error);
        console.error('[streamAIResponse] Error type:', error?.constructor?.name);
        console.error('[streamAIResponse] Error message:', error instanceof Error ? error.message : String(error));
        console.error('[streamAIResponse] Error stack:', error instanceof Error ? error.stack : 'N/A');
        if (error && typeof error === 'object') {
          console.error('[streamAIResponse] Error keys:', Object.keys(error));
          console.error('[streamAIResponse] Error JSON:', JSON.stringify(error, null, 2));
        }
        observer.next({
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
        });
        observer.complete();
      }
    })();

    // Catch unhandled promise rejections
    // NOTE: This should theoretically never fire because try-catch above handles all errors
    // But if it does, we need to handle it gracefully without crashing
    executionPromise.catch((error) => {
      console.error('[streamAIResponse] Unhandled promise rejection:', error);

      // Extract detailed error message (unwrap if it's a wrapped error)
      let errorMessage = error instanceof Error ? error.message : String(error);

      // If it's NoOutputGeneratedError, try to get the underlying cause
      if (error && typeof error === 'object' && 'cause' in error && error.cause) {
        const causeMessage = error.cause instanceof Error ? error.cause.message : String(error.cause);
        console.error('[streamAIResponse] Error cause:', causeMessage);
        // Use the cause message if it's more informative
        if (causeMessage && !causeMessage.includes('No output generated')) {
          errorMessage = causeMessage;
        }
      }

      // DON'T use observer.error() - it causes the entire observable to error and can crash
      // Instead, send error event and complete normally
      try {
        observer.next({
          type: 'error',
          error: errorMessage,
        });
        observer.complete();
      } catch (observerError) {
        console.error('[streamAIResponse] Failed to emit error event:', observerError);
        // Last resort - try to complete the observer to prevent hanging
        try {
          observer.complete();
        } catch (completeError) {
          console.error('[streamAIResponse] Failed to complete observer:', completeError);
        }
      }
    });

    // Cleanup function
    return () => {
      aborted = true;
    };
  });
}
