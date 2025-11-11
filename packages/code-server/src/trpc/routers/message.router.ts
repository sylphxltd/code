/**
 * Message Router
 * Efficient message operations with lazy loading and streaming support
 * REACTIVE: Emits events for all state changes
 * SECURITY: Protected mutations (OWASP API2) + Rate limiting (OWASP API4)
 */

import { z } from 'zod';

/**
 * Abort Signal Manager
 * Tracks active AbortControllers for each session's streaming
 * Allows client to abort server-side streaming via mutation
 */
const activeStreamAbortControllers = new Map<string, AbortController>();
import { observable } from '@trpc/server/observable';
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
  mimeType: z.string().optional(),
});

// Parsed content part schema (from frontend parseUserInput)
const ParsedContentPartSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), content: z.string() }),
  z.object({
    type: z.literal('file'),
    path: z.string(),
    relativePath: z.string(),
    size: z.number().optional(),
    mimeType: z.string().optional(),
  }),
]);

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

/**
 * Session Event Type
 * Alias for StreamEvent with semantic naming
 * Used by message.subscribe() for strongly-typed session event subscriptions
 */
export type SessionEvent = StreamEvent;

export const messageRouter = router({
  // REMOVED: getBySession
  // Use session.getById instead - loads all messages with step-based architecture
  // Pagination not needed for current use cases (sessions are reasonably sized)

  /**
   * Get message count for session
   * EFFICIENT: Count only, no data loading
   */
  getCount: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.messageRepository.getMessageCount(input.sessionId);
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

      const messageId = await ctx.messageRepository.addMessage({
        sessionId,
        role: input.role,
        content: input.content,
        attachments: input.attachments,
        usage: input.usage,
        finishReason: input.finishReason,
        metadata: input.metadata,
        todoSnapshot: input.todoSnapshot,
        status: input.status,
      });

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
      await ctx.messageRepository.updateMessageParts(input.messageId, input.parts);
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
      await ctx.messageRepository.updateMessageStatus(
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
      await ctx.messageRepository.updateMessageUsage(input.messageId, input.usage);
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
      return await ctx.messageRepository.getRecentUserMessages(input.limit, input.cursor);
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

  /**
   * Trigger AI streaming (MUTATION - Single Event Stream Architecture)
   *
   * This mutation triggers server-side AI streaming and returns immediately.
   * All events (user-message-created, assistant-message-created, text-delta,
   * reasoning-delta, complete, error, etc.) are published to event bus.
   *
   * Client receives events via useEventStream subscription (unified path).
   *
   * Architecture:
   * 1. Client calls mutation → Returns immediately with success
   * 2. Server streams in background → Publishes all events to event bus
   * 3. Client's useEventStream subscription → Receives and handles events
   *
   * Benefits:
   * - Single event path (no dual subscription/event stream)
   * - Clean separation: mutation triggers, event stream delivers
   * - Supports replay, multi-client, late join
   *
   * SECURITY: Protected + streaming rate limiting (5 streams/min)
   */
  triggerStream: streamingProcedure
    .input(
      z.object({
        sessionId: z.string().nullish(), // Optional - will create if null
        agentId: z.string().optional(),   // Optional - override session agent
        provider: z.string().optional(),  // Required if sessionId is null
        model: z.string().optional(),     // Required if sessionId is null
        content: z.array(ParsedContentPartSchema), // User message content
      })
    )
    .mutation(async ({ ctx, input }) => {
      // Import streaming service
      const { streamAIResponse } = await import('../../services/streaming.service.js');

      // Get or create sessionId for event channel
      let eventSessionId = input.sessionId || null;

      // Create AbortController for this stream
      // Will be associated with sessionId once known (for lazy sessions, after session-created event)
      const abortController = new AbortController();
      let abortControllerId: string | null = null;

      // Start streaming
      const streamObservable = streamAIResponse({
        appContext: ctx.appContext,
        sessionRepository: ctx.sessionRepository,
        messageRepository: ctx.messageRepository,
        aiConfig: ctx.aiConfig,
        sessionId: eventSessionId,
        agentId: input.agentId,
        provider: input.provider,
        model: input.model,
        userMessageContent: input.content.length > 0 ? input.content : null,
        abortSignal: abortController.signal,
      });

      /**
       * ARCHITECTURE: Subscribe to stream and wait for session-created (lazy sessions only)
       *
       * Problem: Observable must be subscribed to execute streaming
       * Solution: Always subscribe, but only wait for session-created if sessionId is null
       *
       * Flow:
       * 1. Existing session → Subscribe immediately, resolve with existing sessionId
       * 2. Lazy session → Subscribe, wait for session-created event, resolve with new sessionId
       * 3. Client uses returned sessionId to subscribe via message.subscribe
       *
       * Memory: Subscription cleaned up after complete/error
       */
      const sessionIdPromise = new Promise<string>((resolve, reject) => {
        // CRITICAL: Always subscribe to observable to trigger streaming execution
        // For existing sessions: Resolve immediately with sessionId
        // For lazy sessions: Wait for session-created event

        let hasResolved = false;

        // If session already exists, resolve immediately (but continue subscription for streaming)
        if (eventSessionId) {
          resolve(eventSessionId);
          hasResolved = true;
        }

        // Subscribe to stream to capture session-created event (lazy sessions)
        // CRITICAL: Must subscribe to trigger observable execution
        const subscription = streamObservable.subscribe({
          next: (event) => {
            // Capture sessionId from session-created event (lazy sessions only)
            if (event.type === 'session-created' && !hasResolved) {
              eventSessionId = event.sessionId;
              // Resolve promise with new sessionId
              resolve(eventSessionId);
              hasResolved = true;
            }

            // Register AbortController once sessionId is known
            if (eventSessionId && !abortControllerId) {
              abortControllerId = eventSessionId;
              activeStreamAbortControllers.set(eventSessionId, abortController);
              console.log('[AbortDebug] Registered AbortController for session:', eventSessionId);
            }

            // Publish all events to event stream for client subscriptions
            if (eventSessionId) {
              ctx.appContext.eventStream.publish(`session:${eventSessionId}`, event).catch(err => {
                console.error('[TriggerStream] Event publish error:', err);
              });
            }
          },
          error: (error) => {
            // Publish error to event stream
            if (eventSessionId) {
              ctx.appContext.eventStream.publish(`session:${eventSessionId}`, {
                type: 'error' as const,
                error: error instanceof Error ? error.message : String(error),
              }).catch(err => {
                console.error('[TriggerStream] Error event publish error:', err);
              });
            }
            // CRITICAL: Cleanup before rejecting
            subscription.unsubscribe();
            // Cleanup AbortController
            if (abortControllerId) {
              activeStreamAbortControllers.delete(abortControllerId);
            }
            // Only reject if promise not already resolved (for existing sessions, already resolved)
            if (!hasResolved) {
              reject(error);
            }
          },
          complete: () => {
            // Publish complete to event stream
            if (eventSessionId) {
              ctx.appContext.eventStream.publish(`session:${eventSessionId}`, {
                type: 'complete' as const,
              }).catch(err => {
                console.error('[TriggerStream] Complete event publish error:', err);
              });
            }
            // CRITICAL: Cleanup on complete
            subscription.unsubscribe();
            // Cleanup AbortController
            if (abortControllerId) {
              activeStreamAbortControllers.delete(abortControllerId);
            }
          },
        });
      });

      // Wait for sessionId (either immediate or from session-created event)
      const finalSessionId = await sessionIdPromise;

      // Return sessionId so client can subscribe
      return {
        success: true,
        sessionId: finalSessionId,
      };
    }),

  /**
   * Abort active stream for a session
   *
   * Allows client to abort server-side streaming in progress.
   * - Aborts the AI SDK stream generation
   * - Stops any pending tool executions
   * - Marks active message parts as 'abort' status
   *
   * SECURITY: Protected (user can only abort their own sessions)
   */
  abortStream: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId } = input;

      console.log('[AbortDebug] abortStream mutation called for session:', sessionId);
      console.log('[AbortDebug] Active controllers:', Array.from(activeStreamAbortControllers.keys()));

      // Find and abort the active stream
      const abortController = activeStreamAbortControllers.get(sessionId);

      if (!abortController) {
        // No active stream for this session (might have already completed)
        console.log('[AbortDebug] No active stream found for session:', sessionId);
        return {
          success: false,
          message: 'No active stream found for this session',
        };
      }

      // Abort the stream
      console.log('[AbortDebug] Calling abort() on controller for session:', sessionId);
      abortController.abort();
      console.log('[AbortDebug] abort() called successfully');

      // Cleanup will happen in triggerStream's error/complete handlers
      // No need to delete here - let the subscription cleanup do it

      return {
        success: true,
        message: 'Stream aborted successfully',
      };
    }),

  /**
   * Subscribe to session events (SUBSCRIPTION - Strongly Typed)
   *
   * Subscribe to strongly-typed session events with replay support.
   * Receives all streaming events for a specific session.
   *
   * Architecture:
   * - Client calls triggerStream mutation to start streaming
   * - Client subscribes to session events (this endpoint)
   * - Server publishes events to session:{id} channel
   * - Client receives strongly-typed SessionEvent (not StoredEvent wrapper)
   *
   * Usage:
   * ```ts
   * // Trigger streaming
   * await client.message.triggerStream.mutate({ sessionId: 'abc123', content: [...] });
   *
   * // Subscribe to events
   * client.message.subscribe.subscribe(
   *   { sessionId: 'abc123', replayLast: 10 },
   *   {
   *     onData: (event: SessionEvent) => {
   *       // Strongly typed, no need to unwrap payload
   *       if (event.type === 'text-delta') {
   *         console.log(event.text);
   *       }
   *     },
   *     onError: (error) => console.error(error),
   *   }
   * );
   * ```
   *
   * Benefits:
   * - Strongly typed SessionEvent (not any)
   * - No StoredEvent wrapper to unwrap
   * - IDE autocomplete for event types
   * - Clean separation: mutation triggers, subscription receives
   *
   * Transport:
   * - TUI: In-process observable (zero overhead)
   * - Web: SSE (httpSubscriptionLink)
   *
   * SECURITY: Protected + streaming rate limiting (5 streams/min)
   */
  subscribe: streamingProcedure
    .input(
      z.object({
        sessionId: z.string(),
        replayLast: z.number().min(0).max(100).default(0), // Replay last N events
      })
    )
    .subscription(({ ctx, input }) => {
      const channel = `session:${input.sessionId}`;

      return observable<StreamEvent>((emit) => {
        const subscription = ctx.appContext.eventStream
          .subscribeWithHistory(channel, input.replayLast)
          .subscribe({
            next: (storedEvent) => {
              // Unwrap StoredEvent and emit the actual SessionEvent
              emit.next(storedEvent.payload);
            },
            error: (err) => emit.error(err),
            complete: () => emit.complete(),
          });

        return () => subscription.unsubscribe();
      });
    }),
});
