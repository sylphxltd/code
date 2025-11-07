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
   */
  getById: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.sessionRepository.getSessionById(input.sessionId);
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

      // Publish to event stream for multi-client sync
      await ctx.appContext.eventStream.publish('session-events', {
        type: 'session-title-updated' as const,
        sessionId: input.sessionId,
        title: input.title,
      });
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

  // Note: Session events are now delivered via events.subscribeToAllSessions
  // which subscribes to the 'session-events' channel
});
