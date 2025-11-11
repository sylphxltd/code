/**
 * Session Repository
 * Database operations for chat sessions using Drizzle ORM
 *
 * Responsibilities:
 * - Session CRUD: Create, read, delete sessions
 * - Session queries: Get by ID, recent sessions, last session
 * - Session search: Search by title
 * - Session updates: Update title, model, provider, etc.
 * - Session aggregations: Count sessions
 *
 * Note: Message and todo operations moved to dedicated repositories:
 * - MessageRepository: Message operations (addMessage, updateStepParts, etc.)
 * - TodoRepository: Todo operations (updateTodos)
 *
 * Advantages over file-based storage:
 * - Indexed queries: Fast search by title, provider, date
 * - Pagination: Load only needed sessions (no memory bloat)
 * - Aggregations: Count messages without loading full session
 * - Transactions: Data consistency for complex operations
 * - Concurrent access: Proper locking and consistency
 * - Efficient updates: Update specific fields without rewriting entire file
 */

import { eq, desc, and, like, sql, inArray, lt } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import {
  sessions,
  messages,
  messageSteps,
  stepParts,
  stepUsage,
  todos,
  type Session,
  type NewSession,
  type Message,
  type NewMessage,
  type MessageStep as DBMessageStep,
  type NewMessageStep,
} from './schema.js';
import type {
  Session as SessionType,
  SessionMessage,
  MessageStep,
  MessagePart,
  FileAttachment,
  TokenUsage,
  MessageMetadata,
} from '../types/session.types.js';
import type { Todo as TodoType } from '../types/todo.types.js';
import type { ProviderId } from '../config/ai-config.js';
import { retryDatabase } from '../utils/retry.js';

export class SessionRepository {
  constructor(private db: LibSQLDatabase) {}

  /**
   * Create a new session
   */
  async createSession(
    provider: ProviderId,
    model: string,
    agentId: string = 'coder',
    enabledRuleIds: string[] = []
  ): Promise<SessionType> {
    const now = Date.now();
    const sessionId = `session-${now}`;

    const newSession: NewSession = {
      id: sessionId,
      provider,
      model,
      agentId,
      enabledRuleIds,
      nextTodoId: 1,
      created: now,
      updated: now,
    };

    await retryDatabase(() => this.db.insert(sessions).values(newSession));

    return {
      id: sessionId,
      provider,
      model,
      agentId,
      enabledRuleIds,
      messages: [],
      todos: [],
      nextTodoId: 1,
      created: now,
      updated: now,
    };
  }

  /**
   * Create session with specific ID and timestamps (for migration)
   */
  async createSessionFromData(sessionData: {
    id: string;
    provider: ProviderId;
    model: string;
    agentId?: string;
    title?: string;
    enabledRuleIds?: string[];
    nextTodoId: number;
    created: number;
    updated: number;
  }): Promise<void> {
    await retryDatabase(async () => {
      const newSession: NewSession = {
        id: sessionData.id,
        title: sessionData.title || null,
        provider: sessionData.provider,
        model: sessionData.model,
        agentId: sessionData.agentId || 'coder',
        enabledRuleIds: sessionData.enabledRuleIds || [],
        nextTodoId: sessionData.nextTodoId,
        created: sessionData.created,
        updated: sessionData.updated,
      };

      await this.db.insert(sessions).values(newSession);
    });
  }

  /**
   * Get recent sessions metadata ONLY (cursor-based pagination)
   * DATA ON DEMAND: Returns only id, title, provider, model, created, updated
   * NO messages, NO todos - client fetches those separately when needed
   *
   * CURSOR-BASED PAGINATION: More efficient than offset for large datasets
   * - Cursor = updated timestamp of last item
   * - Works even with concurrent updates
   */
  async getRecentSessionsMetadata(limit = 20, cursor?: number): Promise<{
    sessions: Array<{
      id: string;
      title?: string;
      provider: ProviderId;
      model: string;
      agentId: string;
      created: number;
      updated: number;
      messageCount: number;
    }>;
    nextCursor: number | null;
  }> {
    // Build query with cursor
    const queryBuilder = this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updated))
      .limit(limit + 1); // Fetch one extra to determine if there's a next page

    if (cursor) {
      queryBuilder.where(lt(sessions.updated, cursor));
    }

    let sessionRecords: typeof sessions.$inferSelect[];

    try {
      sessionRecords = await queryBuilder;
    } catch (error) {
      // JSON parse error in corrupted session data - fix corrupted records
      console.warn('[getRecentSessionsMetadata] Detected corrupted JSON, auto-repairing...');

      // Query with raw SQL to bypass Drizzle's JSON parsing
      // Note: Raw SQL needed here to skip JSON validation on corrupted data
      const rawSessions = await this.db.all(sql`
        SELECT * FROM sessions
        ${cursor ? sql`WHERE ${sessions.updated} < ${cursor}` : sql``}
        ORDER BY ${sessions.updated} DESC
        LIMIT ${limit + 1}
      `);

      // Manually parse and fix corrupted records
      sessionRecords = [];
      for (const raw of rawSessions) {
        try {
          // Try to parse enabledRuleIds
          let enabledRuleIds: string[] = [];
          if (raw.enabled_rule_ids) {
            try {
              enabledRuleIds = JSON.parse(raw.enabled_rule_ids as string);
            } catch {
              // Corrupted JSON - default to empty array and fix it
              enabledRuleIds = [];
              // Fix the corrupted record
              await this.db.update(sessions)
                .set({ enabledRuleIds: [] })
                .where(eq(sessions.id, raw.id as string));
            }
          }

          sessionRecords.push({
            id: raw.id as string,
            title: raw.title as string | null,
            modelId: raw.model_id as string | null,
            provider: raw.provider as string | null,
            model: raw.model as string | null,
            agentId: raw.agent_id as string,
            enabledRuleIds,
            toolIds: raw.tool_ids ? JSON.parse(raw.tool_ids as string) : null,
            mcpServerIds: raw.mcp_server_ids ? JSON.parse(raw.mcp_server_ids as string) : null,
            nextTodoId: raw.next_todo_id as number,
            created: raw.created as number,
            updated: raw.updated as number,
          });
        } catch (parseError) {
          // Skip this session - too corrupted to parse
        }
      }
    }

    // Check if there are more results
    const hasMore = sessionRecords.length > limit;
    const sessionsToReturn = hasMore ? sessionRecords.slice(0, limit) : sessionRecords;
    const nextCursor = hasMore ? sessionsToReturn[sessionsToReturn.length - 1].updated : null;

    // Get message counts for all sessions in one query (OPTIMIZED!)
    const sessionIds = sessionsToReturn.map(s => s.id);
    const messageCounts = await this.db
      .select({
        sessionId: messages.sessionId,
        count: sql<number>`count(*)`,
      })
      .from(messages)
      .where(inArray(messages.sessionId, sessionIds))
      .groupBy(messages.sessionId);

    // Create lookup map
    const countMap = new Map(messageCounts.map(m => [m.sessionId, m.count]));

    return {
      sessions: sessionsToReturn.map(s => ({
        id: s.id,
        title: s.title || undefined,
        provider: s.provider as ProviderId,
        model: s.model,
        agentId: s.agentId,
        created: s.created,
        updated: s.updated,
        messageCount: countMap.get(s.id) || 0,
      })),
      nextCursor,
    };
  }

  /**
   * Get recent sessions with full data (for backward compatibility)
   * DEPRECATED: Use getRecentSessionsMetadata + getSessionById instead
   */
  async getRecentSessions(limit = 20, offset = 0): Promise<SessionType[]> {
    // Get session metadata only (no messages yet - lazy loading!)
    const sessionRecords = await this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updated))
      .limit(limit)
      .offset(offset);

    // For each session, load messages, todos, etc.
    const fullSessions = await Promise.all(
      sessionRecords.map((session) => this.getSessionById(session.id))
    );

    return fullSessions.filter((s): s is SessionType => s !== null);
  }

  /**
   * Get session by ID with all related data
   */
  async getSessionById(sessionId: string): Promise<SessionType | null> {
    // Get session metadata
    const [session] = await this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) {
      return null;
    }

    // Get messages with all parts, attachments, usage
    const sessionMessages = await this.getSessionMessages(sessionId);

    // Get todos
    const sessionTodos = await this.getSessionTodos(sessionId);

    // Build return object
    const result: SessionType = {
      id: session.id,
      title: session.title || undefined,
      provider: session.provider as ProviderId,
      model: session.model,
      agentId: session.agentId,
      enabledRuleIds: session.enabledRuleIds || [],
      messages: sessionMessages,
      todos: sessionTodos,
      nextTodoId: session.nextTodoId,
      flags: session.flags || undefined,
      created: session.created,
      updated: session.updated,
    };

    return result;
  }

  // REMOVED: getMessagesBySession - not implemented for step-based architecture
  // Use getSessionById instead (loads all messages efficiently)

  /**
   * Get messages for a session (all messages) with step-based structure
   * Assembles steps, parts, attachments, usage into SessionMessage format
   * OPTIMIZED: Batch queries instead of N+1 queries
   */
  private async getSessionMessages(sessionId: string): Promise<SessionMessage[]> {
    // Get all messages for session
    const messageRecords = await this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .orderBy(messages.ordering);

    if (messageRecords.length === 0) {
      return [];
    }

    // Batch fetch all related data (MASSIVE performance improvement!)
    const messageIds = messageRecords.map((m) => m.id);

    // Get all steps for all messages
    const allSteps = await this.db
      .select()
      .from(messageSteps)
      .where(inArray(messageSteps.messageId, messageIds))
      .orderBy(messageSteps.stepIndex);

    const stepIds = allSteps.map((s) => s.id);

    // Fetch all step-related data in parallel
    const [allParts, allStepUsage] = await Promise.all([
      // Step parts
      this.db
        .select()
        .from(stepParts)
        .where(inArray(stepParts.stepId, stepIds))
        .orderBy(stepParts.ordering),

      // Step usage
      this.db
        .select()
        .from(stepUsage)
        .where(inArray(stepUsage.stepId, stepIds)),
    ]);

    // Group by step ID
    const partsByStep = new Map<string, typeof allParts>();
    const usageByStep = new Map<string, (typeof allStepUsage)[0]>();

    for (const part of allParts) {
      if (!partsByStep.has(part.stepId)) {
        partsByStep.set(part.stepId, []);
      }
      partsByStep.get(part.stepId)!.push(part);
    }

    for (const usage of allStepUsage) {
      usageByStep.set(usage.stepId, usage);
    }

    // Group by message ID
    const stepsByMessage = new Map<string, typeof allSteps>();

    for (const step of allSteps) {
      if (!stepsByMessage.has(step.messageId)) {
        stepsByMessage.set(step.messageId, []);
      }
      stepsByMessage.get(step.messageId)!.push(step);
    }

    // Assemble messages using grouped data
    const fullMessages = messageRecords.map((msg) => {
      const steps = stepsByMessage.get(msg.id) || [];

      // Compute message usage from step usage
      let messageUsage: TokenUsage | undefined;
      const stepUsages = steps
        .map((s) => usageByStep.get(s.id))
        .filter((u): u is NonNullable<typeof u> => u !== undefined);

      if (stepUsages.length > 0) {
        messageUsage = {
          promptTokens: stepUsages.reduce((sum, u) => sum + u.promptTokens, 0),
          completionTokens: stepUsages.reduce((sum, u) => sum + u.completionTokens, 0),
          totalTokens: stepUsages.reduce((sum, u) => sum + u.totalTokens, 0),
        };
      }

      // Build steps
      const messageSteps: MessageStep[] = steps.map((step) => {
        const parts = partsByStep.get(step.id) || [];
        const stepUsageData = usageByStep.get(step.id);

        const messageStep: MessageStep = {
          id: step.id,
          stepIndex: step.stepIndex,
          parts: parts.map((p) => JSON.parse(p.content) as MessagePart),
          status: (step.status as 'active' | 'completed' | 'error' | 'abort') || 'completed',
        };

        if (step.metadata) {
          messageStep.metadata = JSON.parse(step.metadata) as MessageMetadata;
        }

        // REMOVED: todoSnapshot - no longer stored per-step
        // Todos are only sent on first user message after /compact

        if (stepUsageData) {
          messageStep.usage = {
            promptTokens: stepUsageData.promptTokens,
            completionTokens: stepUsageData.completionTokens,
            totalTokens: stepUsageData.totalTokens,
          };
        }

        if (step.provider) {
          messageStep.provider = step.provider;
        }

        if (step.model) {
          messageStep.model = step.model;
        }

        if (step.duration) {
          messageStep.duration = step.duration;
        }

        if (step.finishReason) {
          messageStep.finishReason = step.finishReason as 'stop' | 'tool-calls' | 'length' | 'error';
        }

        if (step.startTime) {
          messageStep.startTime = step.startTime;
        }

        if (step.endTime) {
          messageStep.endTime = step.endTime;
        }

        return messageStep;
      });

      const sessionMessage: SessionMessage = {
        id: msg.id,
        role: msg.role as 'user' | 'assistant',
        steps: messageSteps,
        timestamp: msg.timestamp,
        status: (msg.status as 'active' | 'completed' | 'error' | 'abort') || 'completed',
      };

      // REMOVED: Attachments - files now stored as frozen content in step parts
      // File content is captured at creation time and stored as base64 in MessagePart

      // Aggregated usage (computed from step usage)
      if (messageUsage) {
        sessionMessage.usage = messageUsage;
      }

      // Final finish reason (from last step or message-level)
      if (msg.finishReason) {
        sessionMessage.finishReason = msg.finishReason;
      }

      return sessionMessage;
    });

    return fullMessages;
  }

  /**
   * Get todos for a session
   */
  private async getSessionTodos(sessionId: string): Promise<TodoType[]> {
    const todoRecords = await this.db
      .select()
      .from(todos)
      .where(eq(todos.sessionId, sessionId))
      .orderBy(todos.ordering);

    return todoRecords.map((t) => ({
      id: t.id,
      content: t.content,
      activeForm: t.activeForm,
      status: t.status as 'pending' | 'in_progress' | 'completed',
      ordering: t.ordering,
    }));
  }

  // REMOVED: addMessage - moved to MessageRepository

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await retryDatabase(() =>
      this.db
        .update(sessions)
        .set({ title, updated: Date.now() })
        .where(eq(sessions.id, sessionId))
    );
  }

  /**
   * Update session model
   */
  async updateSessionModel(sessionId: string, model: string): Promise<void> {
    await retryDatabase(() =>
      this.db
        .update(sessions)
        .set({ model, updated: Date.now() })
        .where(eq(sessions.id, sessionId))
    );
  }

  /**
   * Update session provider and model
   */
  async updateSessionProvider(sessionId: string, provider: ProviderId, model: string): Promise<void> {
    await retryDatabase(() =>
      this.db
        .update(sessions)
        .set({ provider, model, updated: Date.now() })
        .where(eq(sessions.id, sessionId))
    );
  }

  /**
   * Update session (partial update)
   */
  async updateSession(sessionId: string, updates: {
    title?: string;
    provider?: ProviderId;
    model?: string;
    agentId?: string;
    enabledRuleIds?: string[];
  }): Promise<void> {
    await retryDatabase(() =>
      this.db
        .update(sessions)
        .set({ ...updates, updated: Date.now() })
        .where(eq(sessions.id, sessionId))
    );
  }

  /**
   * Update session flags (system message trigger states)
   * Merges new flags with existing flags
   */
  async updateSessionFlags(sessionId: string, flagUpdates: Record<string, boolean>): Promise<void> {
    await retryDatabase(async () => {
      // Read current session
      const [session] = await this.db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }

      // Merge flags
      const currentFlags = session.flags || {};
      const newFlags = { ...currentFlags, ...flagUpdates };

      // Update
      await this.db
        .update(sessions)
        .set({ flags: newFlags, updated: Date.now() })
        .where(eq(sessions.id, sessionId));
    });
  }

  // REMOVED: updateStepParts - moved to MessageRepository
  // REMOVED: updateMessageParts - moved to MessageRepository
  // REMOVED: updateMessageStatus - moved to MessageRepository
  // REMOVED: updateMessageUsage - moved to MessageRepository

  /**
   * Delete session (CASCADE will delete all related data)
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.db.delete(sessions).where(eq(sessions.id, sessionId));
  }

  /**
   * Search sessions by title (metadata only, cursor-based)
   * DATA ON DEMAND: Returns only metadata, no messages
   * CURSOR-BASED PAGINATION: Efficient for large result sets
   */
  async searchSessionsMetadata(query: string, limit = 20, cursor?: number): Promise<{
    sessions: Array<{
      id: string;
      title?: string;
      provider: ProviderId;
      model: string;
      agentId: string;
      created: number;
      updated: number;
      messageCount: number;
    }>;
    nextCursor: number | null;
  }> {
    const conditions = [like(sessions.title, `%${query}%`)];
    if (cursor) {
      conditions.push(lt(sessions.updated, cursor));
    }

    const queryBuilder = this.db
      .select()
      .from(sessions)
      .where(and(...conditions))
      .orderBy(desc(sessions.updated))
      .limit(limit + 1);

    const sessionRecords = await queryBuilder;

    const hasMore = sessionRecords.length > limit;
    const sessionsToReturn = hasMore ? sessionRecords.slice(0, limit) : sessionRecords;
    const nextCursor = hasMore ? sessionsToReturn[sessionsToReturn.length - 1].updated : null;

    // Get message counts
    const sessionIds = sessionsToReturn.map(s => s.id);
    const messageCounts = sessionIds.length > 0 ? await this.db
      .select({
        sessionId: messages.sessionId,
        count: sql<number>`count(*)`,
      })
      .from(messages)
      .where(inArray(messages.sessionId, sessionIds))
      .groupBy(messages.sessionId) : [];

    const countMap = new Map(messageCounts.map(m => [m.sessionId, m.count]));

    return {
      sessions: sessionsToReturn.map(s => ({
        id: s.id,
        title: s.title || undefined,
        provider: s.provider as ProviderId,
        model: s.model,
        agentId: s.agentId,
        created: s.created,
        updated: s.updated,
        messageCount: countMap.get(s.id) || 0,
      })),
      nextCursor,
    };
  }

  /**
   * Search sessions by title (full data)
   * DEPRECATED: Use searchSessionsMetadata + getSessionById instead
   */
  async searchSessionsByTitle(query: string, limit = 20): Promise<SessionType[]> {
    const sessionRecords = await this.db
      .select()
      .from(sessions)
      .where(like(sessions.title, `%${query}%`))
      .orderBy(desc(sessions.updated))
      .limit(limit);

    const fullSessions = await Promise.all(
      sessionRecords.map((session) => this.getSessionById(session.id))
    );

    return fullSessions.filter((s): s is SessionType => s !== null);
  }

  /**
   * Get session count
   * Efficient: No need to load sessions into memory
   */
  async getSessionCount(): Promise<number> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(sessions);

    return count;
  }

  // REMOVED: getMessageCount - moved to MessageRepository

  /**
   * Get most recently updated session (for headless mode continuation)
   * Returns the last active session
   */
  async getLastSession(): Promise<SessionType | null> {
    // Get most recent session by updated timestamp
    const [lastSession] = await this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updated))
      .limit(1);

    if (!lastSession) {
      return null;
    }

    // Load full session data
    return this.getSessionById(lastSession.id);
  }

  // REMOVED: updateTodos - moved to TodoRepository
  // REMOVED: getRecentUserMessages - moved to MessageRepository
}
