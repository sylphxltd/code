/**
 * Message Router
 * Efficient message operations with lazy loading and streaming support
 * REACTIVE: Emits events for all state changes
 * SECURITY: Protected mutations (OWASP API2) + Rate limiting (OWASP API4)
 */

import { z } from 'zod';
import {
  router,
  publicProcedure,
  moderateProcedure,
  streamingProcedure,
} from '../trpc.js';

// Zod schemas for type safety
const MessagePartSchema = z.union([
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('tool-use'),
    toolUseId: z.string(),
    toolName: z.string(),
    toolInput: z.any(),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolUseId: z.string(),
    toolName: z.string(),
    content: z.string(),
    isError: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('reasoning'),
    reasoning: z.string(),
  }),
]);

const FileAttachmentSchema = z.object({
  path: z.string(),
  relativePath: z.string(),
  size: z.number().optional(),
});

const TokenUsageSchema = z.object({
  promptTokens: z.number(),
  completionTokens: z.number(),
  totalTokens: z.number(),
});

const MessageMetadataSchema = z.object({
  agentId: z.string().optional(),
  ruleIds: z.array(z.string()).optional(),
  isCommandExecution: z.boolean().optional(),
});

const TodoSnapshotSchema = z.object({
  id: z.number(),
  content: z.string(),
  activeForm: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  ordering: z.number(),
});

// Streaming event types (unified interface for TUI and Web)
const StreamEventSchema = z.discriminatedUnion('type', [
  // Session events
  z.object({ type: z.literal('session-created'), sessionId: z.string(), provider: z.string(), model: z.string() }),
  z.object({ type: z.literal('session-deleted'), sessionId: z.string() }),
  z.object({ type: z.literal('session-title-updated'), sessionId: z.string(), title: z.string() }),
  z.object({ type: z.literal('session-title-updated-start'), sessionId: z.string() }),
  z.object({ type: z.literal('session-title-updated-delta'), sessionId: z.string(), text: z.string() }),
  z.object({ type: z.literal('session-title-updated-end'), sessionId: z.string(), title: z.string() }),
  z.object({ type: z.literal('session-model-updated'), sessionId: z.string(), model: z.string() }),
  z.object({ type: z.literal('session-provider-updated'), sessionId: z.string(), provider: z.string(), model: z.string() }),

  // Message creation
  z.object({ type: z.literal('assistant-message-created'), messageId: z.string() }),

  // Text streaming
  z.object({ type: z.literal('text-start') }),
  z.object({ type: z.literal('text-delta'), text: z.string() }),
  z.object({ type: z.literal('text-end') }),

  // Reasoning streaming
  z.object({ type: z.literal('reasoning-start') }),
  z.object({ type: z.literal('reasoning-delta'), text: z.string() }),
  z.object({ type: z.literal('reasoning-end'), duration: z.number() }),

  // Tool streaming
  z.object({
    type: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.any(),
  }),
  z.object({
    type: z.literal('tool-result'),
    toolCallId: z.string(),
    toolName: z.string(),
    result: z.any(),
    duration: z.number(),
  }),
  z.object({
    type: z.literal('tool-error'),
    toolCallId: z.string(),
    toolName: z.string(),
    error: z.string(),
    duration: z.number(),
  }),

  // Ask tool (client-server architecture)
  z.object({
    type: z.literal('ask-question'),
    questionId: z.string(),
    questions: z.array(z.object({
      question: z.string(),
      header: z.string(),
      multiSelect: z.boolean(),
      options: z.array(z.object({
        label: z.string(),
        description: z.string(),
      })),
    })),
  }),

  // Completion
  z.object({
    type: z.literal('complete'),
    usage: TokenUsageSchema.optional(),
    finishReason: z.string().optional(),
  }),

  // Error/Abort
  z.object({ type: z.literal('error'), error: z.string() }),
  z.object({ type: z.literal('abort') }),
]);

export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const messageRouter = router({
  /**
   * Get messages for session (cursor-based pagination)
   * DATA ON DEMAND: Fetch only needed messages, not entire history
   * CURSOR-BASED PAGINATION: Use timestamp as cursor for efficient pagination
   *
   * Usage: For infinite scroll, lazy loading, chat history
   */
  getBySession: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().min(1).max(100).default(50),
        cursor: z.number().optional(), // Timestamp of last message
      })
    )
    .query(async ({ ctx, input }) => {
      return await ctx.sessionRepository.getMessagesBySession(
        input.sessionId,
        input.limit,
        input.cursor
      );
    }),

  /**
   * Get message count for session
   * EFFICIENT: Count only, no data loading
   */
  getCount: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.sessionRepository.getMessageCount(input.sessionId);
    }),

  /**
   * Add message to session
   * Used for both user messages and assistant messages
   * AUTO-CREATE: If sessionId is null, creates new session with provider/model
   * REACTIVE: Emits message-added event (and session-created if new)
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  add: moderateProcedure
    .input(
      z.object({
        sessionId: z.string().nullish(), // null = create new session
        provider: z.string().optional(), // Required if sessionId is null
        model: z.string().optional(),    // Required if sessionId is null
        agentId: z.string().optional(),  // Optional - defaults to 'coder'
        role: z.enum(['user', 'assistant']),
        content: z.array(MessagePartSchema),
        attachments: z.array(FileAttachmentSchema).optional(),
        usage: TokenUsageSchema.optional(),
        finishReason: z.string().optional(),
        metadata: MessageMetadataSchema.optional(),
        todoSnapshot: z.array(TodoSnapshotSchema).optional(),
        status: z.enum(['active', 'completed', 'error', 'abort']).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      let sessionId = input.sessionId;

      // Create session if null
      if (!sessionId) {
        if (!input.provider || !input.model) {
          throw new Error('Provider and model required when sessionId is null');
        }

        const session = await ctx.sessionRepository.createSession(
          input.provider as any,
          input.model,
          input.agentId || 'coder'
        );
        sessionId = session.id;

        // Publish session-created event to event stream
        await ctx.appContext.eventStream.publish('session-events', {
          type: 'session-created' as const,
          sessionId: sessionId,
          provider: input.provider,
          model: input.model,
        });
      }

      const messageId = await ctx.sessionRepository.addMessage(
        sessionId,
        input.role,
        input.content,
        input.attachments,
        input.usage,
        input.finishReason,
        input.metadata,
        input.todoSnapshot,
        input.status
      );

      // Note: Message events are published by streaming.service.ts
      return { messageId, sessionId };
    }),

  /**
   * Update message parts (during streaming)
   * Replaces all parts atomically
   * REACTIVE: Emits message-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateParts: moderateProcedure
    .input(
      z.object({
        messageId: z.string(),
        parts: z.array(MessagePartSchema),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateMessageParts(input.messageId, input.parts);
      // Note: Message updates are published by streaming.service.ts
    }),

  /**
   * Update message status
   * Used when streaming completes/aborts
   * REACTIVE: Emits message-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateStatus: moderateProcedure
    .input(
      z.object({
        messageId: z.string(),
        status: z.enum(['active', 'completed', 'error', 'abort']),
        finishReason: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateMessageStatus(
        input.messageId,
        input.status,
        input.finishReason
      );
      // Note: Message updates are published by streaming.service.ts
    }),

  /**
   * Update message usage
   * Used when streaming completes with token counts
   * REACTIVE: Emits message-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateUsage: moderateProcedure
    .input(
      z.object({
        messageId: z.string(),
        usage: TokenUsageSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateMessageUsage(input.messageId, input.usage);
      // Note: Message updates are published by streaming.service.ts
    }),

  /**
   * Get recent user messages for command history (cursor-based pagination)
   * DATA ON DEMAND: Returns paginated results, not all messages at once
   * CURSOR-BASED PAGINATION: Efficient for large message history
   * INDEXED: Uses efficient database query with role index
   */
  getRecentUserMessages: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(500).default(100),
        cursor: z.number().optional(), // Timestamp of last message
      })
    )
    .query(async ({ ctx, input }) => {
      return await ctx.sessionRepository.getRecentUserMessages(input.limit, input.cursor);
    }),

  /**
   * Stream AI response (SUBSCRIPTION)
   * Unified interface for TUI (in-process) and Web (SSE)
   *
   * Usage:
   * ```typescript
   * // TUI and Web use same API!
   * client.message.streamResponse.subscribe(
   *   { sessionId, userMessage, attachments },
   *   {
   *     onData: (event) => {
   *       if (event.type === 'text-delta') {
   *         appendText(event.text);
   *       }
   *     },
   *     onError: (error) => console.error(error),
   *     onComplete: () => console.log('Done'),
   *   }
   * );
   * ```
   *
   * Transport:
   * - TUI: In-process observable (zero overhead)
   * - Web: SSE (httpSubscriptionLink)
   *
   * SECURITY: Protected + streaming rate limiting (5 streams/min)
   */
  streamResponse: streamingProcedure
    .input(
      z.object({
        sessionId: z.string().nullish(), // Optional - will create if null
        agentId: z.string().optional(),   // Optional - override session agent
        provider: z.string().optional(),  // Required if sessionId is null
        model: z.string().optional(),     // Required if sessionId is null
        userMessage: z.string(),
        attachments: z.array(FileAttachmentSchema).optional(),
      })
    )
    .subscription(async ({ ctx, input }) => {
      // Import streaming service
      const { streamAIResponse } = await import('../../services/streaming.service.js');

      // Get or create sessionId for event channel
      let eventSessionId = input.sessionId || null;

      // Stream AI response and publish events to event stream
      return observable<StreamEvent>((emit) => {
        const streamObservable = streamAIResponse({
          appContext: ctx.appContext,
          sessionRepository: ctx.sessionRepository,
          aiConfig: ctx.aiConfig,
          sessionId: eventSessionId,
          agentId: input.agentId,
          provider: input.provider,
          model: input.model,
          userMessage: input.userMessage,
          attachments: input.attachments,
        });

        const subscription = streamObservable.subscribe({
          next: (event) => {
            // Capture sessionId from session-created event
            if (event.type === 'session-created') {
              eventSessionId = event.sessionId;
            }

            // Publish event to event stream (for replay and multi-client support)
            if (eventSessionId) {
              ctx.appContext.eventStream.publish(`session:${eventSessionId}`, event).catch(err => {
                console.error('[StreamResponse] Event publish error:', err);
              });
            }

            // Emit to current subscriber
            emit.next(event);
          },
          error: (error) => emit.error(error),
          complete: () => emit.complete(),
        });

        return () => subscription.unsubscribe();
      });
    }),

  /**
   * Answer Ask tool question
   * Called by client when user answers Ask tool question
   * Resolves pending Ask tool Promise on server
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  answerAsk: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
        questionId: z.string(),
        answers: z.record(z.union([z.string(), z.array(z.string())])),
      })
    )
    .mutation(async ({ input }) => {
      // Import pending asks manager
      const { resolvePendingAsk } = await import('../../services/ask-manager.service.js');

      // Resolve the pending ask
      const resolved = await resolvePendingAsk(input.questionId, input.answers);

      if (!resolved) {
        throw new Error('Question not found or already answered');
      }

      return { success: true };
    }),

  // Note: Message events are now delivered via events.subscribeToSession
  // which subscribes to the 'session:{id}' channel and receives all streaming events
});
