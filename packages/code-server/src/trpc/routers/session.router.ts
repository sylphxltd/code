/**
 * Session Router
 * Enterprise-grade session management with pagination and lazy loading
 * REACTIVE: Emits events for all state changes
 * SECURITY: Protected mutations (OWASP API2) + Rate limiting (OWASP API4)
 */

import { z } from 'zod';
import {
  router,
  publicProcedure,
  strictProcedure,
  moderateProcedure,
} from '../trpc.js';
import type { ProviderId } from '@sylphx/code-core';
import { publishTitleUpdate } from '../../services/event-publisher.js';

export const sessionRouter = router({
  /**
   * Get recent sessions metadata (cursor-based pagination)
   * DATA ON DEMAND: Returns ONLY metadata (id, title, provider, model, timestamps, messageCount)
   * NO messages, NO todos - client fetches full session via getById when needed
   * CURSOR-BASED PAGINATION: Efficient for large datasets, works with concurrent updates
   */
  getRecent: publicProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.number().optional(), // Timestamp of last session from previous page
      })
    )
    .query(async ({ ctx, input }) => {
      return await ctx.sessionRepository.getRecentSessionsMetadata(input.limit, input.cursor);
    }),

  /**
   * Get session by ID with full data
   * LAZY LOADING: Only called when user opens a specific session
   * SERVER-SIDE VALIDATION: Checks if session's model is still available
   */
  getById: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      const session = await ctx.sessionRepository.getSessionById(input.sessionId);
      if (!session) {
        return null;
      }

      // Validate model availability (server-side autonomous)
      // Uses TTL cache (1 hour) - no API call if cache fresh
      let modelStatus: 'available' | 'unavailable' | 'unknown' = 'unknown';

      try {
        const { getProvider } = await import('@sylphx/code-core');
        const provider = getProvider(session.provider);
        const providerConfig = ctx.aiConfig.providers[session.provider];

        if (provider && providerConfig) {
          // fetchModels uses TTL cache - only hits API on cache miss/expiry
          const models = await provider.fetchModels(providerConfig);
          modelStatus = models.some(m => m.id === session.model)
            ? 'available'
            : 'unavailable';
        }
      } catch (err) {
        // Network error or provider not available - can't determine
        // Default to 'unknown' (assume available, don't block user)
        console.error('[session.getById] Failed to validate model:', err);
        modelStatus = 'unknown';
      }

      return {
        ...session,
        modelStatus,
      };
    }),

  /**
   * Get session count
   * EFFICIENT: Database count without loading any data
   */
  getCount: publicProcedure.query(async ({ ctx }) => {
    return await ctx.sessionRepository.getSessionCount();
  }),

  /**
   * Get last session (for headless mode)
   */
  getLast: publicProcedure.query(async ({ ctx }) => {
    return await ctx.sessionRepository.getLastSession();
  }),

  /**
   * Search sessions by title (metadata only, cursor-based pagination)
   * DATA ON DEMAND: Returns ONLY metadata, no messages
   * CURSOR-BASED PAGINATION: Efficient for large result sets
   * INDEXED: Uses database index for fast search
   */
  search: publicProcedure
    .input(
      z.object({
        query: z.string(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.number().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      return await ctx.sessionRepository.searchSessionsMetadata(input.query, input.limit, input.cursor);
    }),

  /**
   * Create new session
   * REACTIVE: Emits session-created event
   * SECURITY: Protected + strict rate limiting (10 req/min)
   */
  create: strictProcedure
    .input(
      z.object({
        provider: z.string() as z.ZodType<ProviderId>,
        model: z.string(),
        agentId: z.string().optional(),
        enabledRuleIds: z.array(z.string()).optional(), // Optional: global default rules
      })
    )
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.sessionRepository.createSession(
        input.provider,
        input.model,
        input.agentId || 'coder',
        input.enabledRuleIds || [] // Initialize with provided rules or empty
      );

      // Publish to event stream for multi-client sync
      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-created' as const,
        sessionId: session.id,
        provider: input.provider,
        model: input.model,
      });

      return session;
    }),

  /**
   * Update session title
   * REACTIVE: Emits session-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateTitle: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
        title: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateSessionTitle(input.sessionId, input.title);

      // Publish to both channels for UC5: Selective Event Delivery
      await publishTitleUpdate(ctx.appContext.eventStream, input.sessionId, input.title);
    }),

  /**
   * Update session model
   * REACTIVE: Emits session-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateModel: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
        model: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateSessionModel(input.sessionId, input.model);

      // Publish to event stream for multi-client sync
      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-model-updated' as const,
        sessionId: input.sessionId,
        model: input.model,
      });
    }),

  /**
   * Update session provider and model
   * REACTIVE: Emits session-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateProvider: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
        provider: z.string() as z.ZodType<ProviderId>,
        model: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateSessionProvider(
        input.sessionId,
        input.provider,
        input.model
      );

      // Publish to event stream for multi-client sync
      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-provider-updated' as const,
        sessionId: input.sessionId,
        provider: input.provider,
        model: input.model,
      });
    }),

  /**
   * Update session enabled rules
   * REACTIVE: Emits session-updated event
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  updateRules: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
        enabledRuleIds: z.array(z.string()),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateSession(input.sessionId, {
        enabledRuleIds: input.enabledRuleIds,
      });

      // Note: Rules updates are internal, no event stream needed
    }),

  /**
   * Delete session
   * CASCADE: Automatically deletes all messages, todos, attachments
   * REACTIVE: Emits session-deleted event
   * SECURITY: Protected + strict rate limiting (10 req/min)
   */
  delete: strictProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.deleteSession(input.sessionId);

      // Publish to event stream for multi-client sync
      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-deleted' as const,
        sessionId: input.sessionId,
      });
    }),

  /**
   * Compact session: Summarize conversation and create new session
   * SERVER-SIDE LOGIC: All AI summarization and session creation on server
   * REACTIVE: Emits session-created and session-compacted events
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   * ATOMIC: Rolls back on failure
   * PROGRESS: Streams progress updates to client
   *
   * Flow:
   * 1. Validate session exists and has messages
   * 2. Generate AI summary (streams progress)
   * 3. Create new session atomically
   * 4. Mark old session as compacted
   * 5. Emit events for multi-client sync
   */
  compact: moderateProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { compactSession, getProviderConfigWithApiKey } = await import('@sylphx/code-core');

      // Get session to find provider
      const session = await ctx.sessionRepository.getSessionById(input.sessionId);
      if (!session) {
        return { success: false, error: 'Session not found' };
      }

      // Get provider config with API key (server-side only)
      const providerConfig = await getProviderConfigWithApiKey(
        ctx.aiConfig,
        session.provider
      );

      if (!providerConfig) {
        return {
          success: false,
          error: `Provider ${session.provider} is not configured`,
        };
      }

      // Compact session with progress tracking (TODO: stream progress via subscription)
      const result = await compactSession(
        ctx.sessionRepository,
        input.sessionId,
        providerConfig,
        (status, detail) => {
          // TODO: Emit progress events for real-time updates
          console.log(`[Compact] ${status}: ${detail || ''}`);
        }
      );

      if (!result.success) {
        return { success: false, error: result.error };
      }

      // Emit events for multi-client sync
      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-compacted' as const,
        oldSessionId: input.sessionId,
        newSessionId: result.newSessionId!,
        summary: result.summary!,
        messageCount: result.messageCount!,
      });

      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-created' as const,
        sessionId: result.newSessionId!,
        provider: session.provider,
        model: session.model,
      });

      // Auto-trigger AI streaming in new session (server-side business logic)
      // The new session has a system message (summary) that will be converted to model user message
      // Events are published to session:${newSessionId} channel for all clients
      // Clients with deduplication enabled will receive and display the streaming
      const { streamAIResponse } = await import('../../services/streaming.service.js');

      // Start streaming in background (don't await - return immediately)
      // Events will be published to session:{newSessionId} channel for multi-client sync
      streamAIResponse({
        appContext: ctx.appContext,
        sessionRepository: ctx.sessionRepository,
        messageRepository: ctx.messageRepository,
        aiConfig: ctx.aiConfig,
        sessionId: result.newSessionId!,
        userMessageContent: null, // No new user message - use existing system message
      }).subscribe({
        next: (event) => {
          console.log('[Compact] Streaming event:', event.type);
          // Publish streaming events to event stream for all clients
          ctx.appContext.eventStream.publish(`session:${result.newSessionId}`, event).catch(err => {
            console.error('[Compact] Event publish error:', err);
          });
        },
        error: (error) => {
          console.error('[Compact] AI streaming error:', error);
        },
        complete: () => {
          console.log('[Compact] AI streaming completed');
        },
      });

      return {
        success: true,
        newSessionId: result.newSessionId,
        oldSessionId: result.oldSessionId,
        oldSessionTitle: result.oldSessionTitle,
        messageCount: result.messageCount,
        // Don't return full summary to client - it's in the new session
      };
    }),

  // Note: Session events are now delivered via events.subscribeToAllSessions
  // which subscribes to the 'session-events' channel
});
