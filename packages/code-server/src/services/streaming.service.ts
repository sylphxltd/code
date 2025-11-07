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
  FileAttachment,
} from '@sylphx/code-core';
import {
  createAIStream,
  getSystemStatus,
  injectSystemStatusToOutput,
  buildSystemPrompt,
  createMessageStep,
  updateStepParts,
  completeMessageStep,
  processStream,
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
  | { type: 'session-title-updated-start'; sessionId: string }
  | { type: 'session-title-updated-delta'; sessionId: string; text: string }
  | { type: 'session-title-updated-end'; sessionId: string; title: string }

  // Message-level events
  | { type: 'user-message-created'; messageId: string; content: string }
  | { type: 'assistant-message-created'; messageId: string }

  // Step-level events (NEW)
  | { type: 'step-start'; stepId: string; stepIndex: number; metadata: { cpu: string; memory: string }; todoSnapshot: any[] }
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

export interface StreamAIResponseOptions {
  appContext: AppContext;
  sessionRepository: SessionRepository;
  messageRepository: MessageRepository;
  aiConfig: AIConfig;
  sessionId: string | null;  // null = create new session
  agentId?: string;   // Optional - override session agent
  provider?: string;  // Required if sessionId is null
  model?: string;     // Required if sessionId is null
  userMessage: string;
  attachments?: FileAttachment[];
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
          userMessage,
          attachments = [],
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

        // 3. Add user message to session (with system status + attachments)
        const systemStatus = getSystemStatus();
        const userMessageId = await messageRepository.addMessage({
          sessionId,
          role: 'user',
          content: [{ type: 'text', content: userMessage, status: 'completed' }],
          attachments,
          metadata: {
            cpu: systemStatus.cpu,
            memory: systemStatus.memory,
          },
          todoSnapshot: session.todos,
        });

        // 3.1. Emit user-message-created event
        observer.next({
          type: 'user-message-created',
          messageId: userMessageId,
          content: userMessage,
        });

        // 4. Reload session to get updated messages
        const updatedSession = await sessionRepository.getSessionById(sessionId);
        if (!updatedSession) {
          observer.error(new Error('Session not found after adding message'));
          return;
        }

        // 5. Build ModelMessage[] for AI
        const messages = await buildModelMessages(updatedSession.messages);

        // 6. Determine agentId and build system prompt
        // STATELESS: Use explicit parameters from AppContext
        const agentId = inputAgentId || session.agentId || DEFAULT_AGENT_ID;
        const agents = opts.appContext.agentManager.getAll();
        const enabledRuleIds = session.enabledRuleIds || [];
        const enabledRules = opts.appContext.ruleManager.getEnabled(enabledRuleIds);
        const systemPrompt = buildSystemPrompt(agentId, agents, enabledRules);

        // 7. Create AI model
        const model = providerInstance.createClient(providerConfig, modelName);

        // 7.1. Get model capabilities to determine tool support
        const modelCapabilities = providerInstance.getModelCapabilities(modelName);
        const enableTools = modelCapabilities.has('tools');

        // 8. Create AI stream with system prompt
        // Only enable native tools if model supports them
        // Models without native support (like claude-code) will fall back to text-based tools
        const stream = createAIStream({
          model,
          messages,
          system: systemPrompt,
          enableTools, // Conditional tool usage based on model capabilities
          ...(abortSignal ? { abortSignal } : {}),
          onTransformToolResult: (output, toolName) => {
            const systemStatus = getSystemStatus();
            return injectSystemStatusToOutput(output, systemStatus);
          },
        });

        // 9. Create assistant message in database (status: active)
        const assistantMessageId = await messageRepository.addMessage({
          sessionId,
          role: 'assistant',
          content: [], // Empty content initially
          status: 'active',
        });

        // 9.1. Emit assistant message created event
        observer.next({ type: 'assistant-message-created', messageId: assistantMessageId });

        // 9.2. Capture metadata and todoSnapshot for step-0
        const currentSystemStatus = getSystemStatus();
        const currentTodos = updatedSession.todos || [];
        const stepMetadata = {
          cpu: currentSystemStatus.cpu,
          memory: currentSystemStatus.memory,
        };

        // 9.3. Create step-0 in database
        const stepId = `${assistantMessageId}-step-0`;
        await createMessageStep(
          sessionRepository.db,
          assistantMessageId,
          0, // stepIndex
          stepMetadata,
          currentTodos
        );

        // 9.4. Emit step-start event
        observer.next({
          type: 'step-start',
          stepId,
          stepIndex: 0,
          metadata: stepMetadata,
          todoSnapshot: currentTodos,
        });

        // 9.5. Start title generation in parallel with streaming (real-time updates)
        const isFirstMessage =
          updatedSession.messages.filter((m) => m.role === 'user').length === 1;

        let titlePromise: Promise<string | null> = Promise.resolve(null);
        if (needsTitleGeneration(updatedSession, isNewSession, isFirstMessage)) {
          titlePromise = generateSessionTitle(
            opts.appContext,
            sessionRepository,
            aiConfig,
            updatedSession,
            userMessage
          );
        }

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
          onFile: (mediaType, base64) =>
            observer.next({ type: 'file', mediaType, base64 }),
          onAbort: () => {
            aborted = true;
            observer.next({ type: 'abort' });
          },
          onError: (error) => {
            observer.next({ type: 'error', error });
          },
        };

        const result = await processStream(stream, callbacks);

        // Emit error event if no valid response (ensures error message reaches UI)
        if (!result.usage && !aborted) {
          // Check if there's an error part in messageParts
          const errorPart = result.messageParts.find(p => p.type === 'error');
          if (errorPart && errorPart.type === 'error') {
            // Re-emit error event to ensure it reaches subscription handlers
            observer.next({
              type: 'error',
              error: errorPart.error,
            });
          } else {
            // No error part found, emit generic error
            observer.next({
              type: 'error',
              error: 'API request failed to generate a response. Please check your API credentials and configuration.',
            });
          }
        }

        // 11. Complete step-0 and save final message to database
        const stepEndTime = Date.now();

        // 11.1. Update step parts (with error handling - don't let DB errors crash the stream)
        try {
          await updateStepParts(sessionRepository.db, stepId, result.messageParts);
        } catch (dbError) {
          console.error('[streamAIResponse] Failed to update step parts:', dbError);
          // Continue - error is already in messageParts, will be shown to user
        }

        // 11.2. Complete the step
        try {
          await completeMessageStep(sessionRepository.db, stepId, {
            status: aborted ? 'abort' : result.usage ? 'completed' : 'error',
            finishReason: result.finishReason,
            usage: result.usage,
            provider: session.provider,
            model: session.model,
          });
        } catch (dbError) {
          console.error('[streamAIResponse] Failed to complete step:', dbError);
          // Continue - not critical for user experience
        }

        // 11.3. Emit step-complete event
        const stepDuration = stepEndTime - Date.now(); // FIXME: Calculate from step startTime
        observer.next({
          type: 'step-complete',
          stepId,
          usage: result.usage || { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
          duration: stepDuration,
          finishReason: result.finishReason || 'unknown',
        });

        // 11.4. Update message status (aggregated from steps)
        try {
          await messageRepository.updateMessageStatus(
            assistantMessageId,
            aborted ? 'abort' : result.usage ? 'completed' : 'error',
            result.finishReason
          );
        } catch (dbError) {
          console.error('[streamAIResponse] Failed to update message status:', dbError);
          // Continue - not critical for user experience
        }

        // 11.5. Update message usage (aggregated from steps)
        if (result.usage) {
          try {
            await messageRepository.updateMessageUsage(assistantMessageId, result.usage);
          } catch (dbError) {
            console.error('[streamAIResponse] Failed to update message usage:', dbError);
            // Continue - not critical for user experience
          }
        }

        // 12. Emit complete event (message content done, title continues in background)
        observer.next({
          type: 'complete',
          usage: result.usage,
          finishReason: result.finishReason,
        });

        // 13. Complete observable (clients receive title events via useEventStream)
        observer.complete();

        // 14. Let title generation finish in background
        // NOTE: This catch() should never fire because titlePromise has internal try-catch
        // But we add it as a safety net to prevent any unhandled rejections
        titlePromise.catch((error) => {
          console.error('[Title Generation] Background error (should not happen):', error);
          return null; // Return null to complete the promise chain
        });
      } catch (error) {
        console.error('[streamAIResponse] Error in execution:', error);
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
