/**
 * Session Repository
 * Database operations for chat sessions using Drizzle ORM
 *
 * Advantages over file-based storage:
 * - Indexed queries: Fast search by title, provider, date
 * - Pagination: Load only needed sessions (no memory bloat)
 * - Aggregations: Count messages without loading full session
 * - Transactions: Data consistency for complex operations
 * - Concurrent access: Proper locking and consistency
 * - Efficient updates: Update specific fields without rewriting entire file
 */

import { eq, desc, and, like, sql, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import {
  sessions,
  messages,
  messageSteps,
  stepParts,
  stepUsage,
  stepTodoSnapshots,
  messageAttachments,
  messageUsage,
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

/**
 * Retry helper for handling SQLITE_BUSY errors
 * Exponential backoff: 50ms, 100ms, 200ms, 400ms, 800ms
 */
async function retryOnBusy<T>(
  operation: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error: any) {
      lastError = error;

      // Only retry on SQLITE_BUSY errors
      if (error.message?.includes('SQLITE_BUSY') || error.code === 'SQLITE_BUSY') {
        const delay = 50 * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      // Other errors: throw immediately
      throw error;
    }
  }

  // Max retries exceeded
  throw lastError;
}

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

    await this.db.insert(sessions).values(newSession);

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
    await retryOnBusy(async () => {
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
    const query = this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updated))
      .limit(limit + 1); // Fetch one extra to determine if there's a next page

    if (cursor) {
      query.where(sql`${sessions.updated} < ${cursor}`);
    }

    const sessionRecords = await query;

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
      created: session.created,
      updated: session.updated,
    };

    return result;
  }

  /**
   * Get messages for a session with cursor-based pagination
   * DATA ON DEMAND: Fetch only needed messages, not entire history
   * CURSOR-BASED PAGINATION: Use message timestamp as cursor
   *
   * TODO: Update to use step-based architecture
   */
  async getMessagesBySession(sessionId: string, limit = 50, cursor?: number): Promise<{
    messages: SessionMessage[];
    nextCursor: number | null;
  }> {
    throw new Error('getMessagesBySession not yet updated for step-based architecture. Use getSessionById instead.');
  }

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

    // Fetch all step-related data and message-level data in parallel
    const [allParts, allStepUsage, allStepSnapshots, allAttachments, allMsgUsage] = await Promise.all([
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

      // Step todo snapshots
      this.db
        .select()
        .from(stepTodoSnapshots)
        .where(inArray(stepTodoSnapshots.stepId, stepIds))
        .orderBy(stepTodoSnapshots.ordering),

      // Message attachments
      this.db
        .select()
        .from(messageAttachments)
        .where(inArray(messageAttachments.messageId, messageIds)),

      // Message usage (aggregated)
      this.db
        .select()
        .from(messageUsage)
        .where(inArray(messageUsage.messageId, messageIds)),
    ]);

    // Group by step ID
    const partsByStep = new Map<string, typeof allParts>();
    const usageByStep = new Map<string, (typeof allStepUsage)[0]>();
    const snapshotsByStep = new Map<string, typeof allStepSnapshots>();

    for (const part of allParts) {
      if (!partsByStep.has(part.stepId)) {
        partsByStep.set(part.stepId, []);
      }
      partsByStep.get(part.stepId)!.push(part);
    }

    for (const usage of allStepUsage) {
      usageByStep.set(usage.stepId, usage);
    }

    for (const snapshot of allStepSnapshots) {
      if (!snapshotsByStep.has(snapshot.stepId)) {
        snapshotsByStep.set(snapshot.stepId, []);
      }
      snapshotsByStep.get(snapshot.stepId)!.push(snapshot);
    }

    // Group by message ID
    const stepsByMessage = new Map<string, typeof allSteps>();
    const attachmentsByMessage = new Map<string, typeof allAttachments>();
    const usageByMessage = new Map<string, (typeof allMsgUsage)[0]>();

    for (const step of allSteps) {
      if (!stepsByMessage.has(step.messageId)) {
        stepsByMessage.set(step.messageId, []);
      }
      stepsByMessage.get(step.messageId)!.push(step);
    }

    for (const attachment of allAttachments) {
      if (!attachmentsByMessage.has(attachment.messageId)) {
        attachmentsByMessage.set(attachment.messageId, []);
      }
      attachmentsByMessage.get(attachment.messageId)!.push(attachment);
    }

    for (const usage of allMsgUsage) {
      usageByMessage.set(usage.messageId, usage);
    }

    // Assemble messages using grouped data
    const fullMessages = messageRecords.map((msg) => {
      const steps = stepsByMessage.get(msg.id) || [];
      const attachments = attachmentsByMessage.get(msg.id) || [];
      const usage = usageByMessage.get(msg.id);

      // Build steps
      const messageSteps: MessageStep[] = steps.map((step) => {
        const parts = partsByStep.get(step.id) || [];
        const stepUsageData = usageByStep.get(step.id);
        const todoSnap = snapshotsByStep.get(step.id) || [];

        const messageStep: MessageStep = {
          id: step.id,
          stepIndex: step.stepIndex,
          parts: parts.map((p) => JSON.parse(p.content) as MessagePart),
          status: (step.status as 'active' | 'completed' | 'error' | 'abort') || 'completed',
        };

        if (step.metadata) {
          messageStep.metadata = JSON.parse(step.metadata) as MessageMetadata;
        }

        if (todoSnap.length > 0) {
          messageStep.todoSnapshot = todoSnap.map((t) => ({
            id: t.todoId,
            content: t.content,
            activeForm: t.activeForm,
            status: t.status as 'pending' | 'in_progress' | 'completed',
            ordering: t.ordering,
          }));
        }

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

      // Self-healing: Normalize attachments on read
      if (attachments.length > 0) {
        const validAttachments = attachments.filter((a) =>
          a && typeof a === 'object' && a.path && a.relativePath
        );

        if (validAttachments.length > 0) {
          sessionMessage.attachments = validAttachments.map((a) => ({
            path: a.path,
            relativePath: a.relativePath,
            size: a.size || undefined,
          }));
        }
      }

      // Aggregated usage (for UI convenience)
      if (usage) {
        sessionMessage.usage = {
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        };
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

  /**
   * Add message to session with step-based structure
   * Atomically inserts message with initial step containing parts
   *
   * Design: Message = Container, Step = Content
   * - Creates message container
   * - Creates step-0 with provided content, metadata, todoSnapshot
   * - Attachments at message level (apply to all steps)
   * - Usage aggregated at message level (sum of step usage)
   */
  async addMessage(
    sessionId: string,
    role: 'user' | 'assistant',
    content: MessagePart[],
    attachments?: FileAttachment[],
    usage?: TokenUsage,
    finishReason?: string,
    metadata?: MessageMetadata,
    todoSnapshot?: TodoType[],
    status?: 'active' | 'completed' | 'error' | 'abort'
  ): Promise<string> {
    return await retryOnBusy(async () => {
      const messageId = randomUUID();
      const stepId = `${messageId}-step-0`;
      const now = Date.now();

      // Get current message count for ordering
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)` })
        .from(messages)
        .where(eq(messages.sessionId, sessionId));

      const ordering = count;

      // Insert in transaction
      await this.db.transaction(async (tx) => {
        // 1. Insert message container
        await tx.insert(messages).values({
          id: messageId,
          sessionId,
          role,
          timestamp: now,
          ordering,
          finishReason: finishReason || null,
          status: status || 'completed',
        });

        // 2-5. For streaming messages (status='active', empty content), skip step creation
        // The step will be created separately by createMessageStep when streaming starts
        const isStreamingMessage = status === 'active' && content.length === 0;

        if (!isStreamingMessage) {
          // 2. Insert step-0 with content
          await tx.insert(messageSteps).values({
            id: stepId,
            messageId,
            stepIndex: 0,
            status: status || 'completed',
            metadata: metadata ? JSON.stringify(metadata) : null,
            startTime: now,
            endTime: status === 'completed' ? now : null,
            provider: null,
            model: null,
            duration: null,
            finishReason: finishReason || null,
          });

          // 3. Insert step parts
          for (let i = 0; i < content.length; i++) {
            await tx.insert(stepParts).values({
              id: randomUUID(),
              stepId,
              ordering: i,
              type: content[i].type,
              content: JSON.stringify(content[i]),
            });
          }

          // 4. Insert step todo snapshot
          if (todoSnapshot && todoSnapshot.length > 0) {
            for (const todo of todoSnapshot) {
              await tx.insert(stepTodoSnapshots).values({
                id: randomUUID(),
                stepId,
                todoId: todo.id,
                content: todo.content,
                activeForm: todo.activeForm,
                status: todo.status,
                ordering: todo.ordering,
              });
            }
          }

          // 5. Insert step usage
          if (usage) {
            await tx.insert(stepUsage).values({
              stepId,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            });
          }
        }

        // 6. Insert message attachments (message-level, not step-level)
        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            await tx.insert(messageAttachments).values({
              id: randomUUID(),
              messageId,
              path: att.path,
              relativePath: att.relativePath,
              size: att.size || null,
            });
          }
        }

        // 7. Insert aggregated message usage (for UI convenience)
        // Skip for streaming messages (usage will be added later)
        if (usage && !isStreamingMessage) {
          await tx.insert(messageUsage).values({
            messageId,
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          });
        }

        // 8. Update session timestamp
        await tx
          .update(sessions)
          .set({ updated: now })
          .where(eq(sessions.id, sessionId));
      });

      return messageId;
    });
  }

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ title, updated: Date.now() })
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Update session model
   */
  async updateSessionModel(sessionId: string, model: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ model, updated: Date.now() })
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Update session provider and model
   */
  async updateSessionProvider(sessionId: string, provider: ProviderId, model: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ provider, model, updated: Date.now() })
      .where(eq(sessions.id, sessionId));
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
    await this.db
      .update(sessions)
      .set({ ...updates, updated: Date.now() })
      .where(eq(sessions.id, sessionId));
  }

  /**
   * Update step parts (used during streaming)
   * Replaces all parts for a step atomically
   *
   * MIGRATION NOTE: This replaces updateMessageParts
   * - Old: Updated parts for entire message
   * - New: Updates parts for specific step (more granular)
   */
  async updateStepParts(stepId: string, parts: MessagePart[]): Promise<void> {
    await retryOnBusy(async () => {
      await this.db.transaction(async (tx) => {
        // Delete existing parts for this step
        await tx.delete(stepParts).where(eq(stepParts.stepId, stepId));

        // Insert new parts
        for (let i = 0; i < parts.length; i++) {
          await tx.insert(stepParts).values({
            id: randomUUID(),
            stepId,
            ordering: i,
            type: parts[i].type,
            content: JSON.stringify(parts[i]),
          });
        }
      });
    });
  }

  /**
   * @deprecated Use updateStepParts instead
   * Legacy method for backward compatibility - updates step-0 parts
   */
  async updateMessageParts(messageId: string, parts: MessagePart[]): Promise<void> {
    const stepId = `${messageId}-step-0`;
    await this.updateStepParts(stepId, parts);
  }

  /**
   * Update message status (used when streaming completes/aborts)
   */
  async updateMessageStatus(
    messageId: string,
    status: 'active' | 'completed' | 'error' | 'abort',
    finishReason?: string
  ): Promise<void> {
    await retryOnBusy(async () => {
      // Only update finishReason if explicitly provided
      const updates: {
        status: 'active' | 'completed' | 'error' | 'abort';
        finishReason?: string | null;
      } = { status };

      if (finishReason !== undefined) {
        updates.finishReason = finishReason || null;
      }

      await this.db
        .update(messages)
        .set(updates)
        .where(eq(messages.id, messageId));
    });
  }

  /**
   * Update message usage (used when streaming completes)
   * Inserts or replaces usage data for a message
   */
  async updateMessageUsage(messageId: string, usage: TokenUsage): Promise<void> {
    await retryOnBusy(async () => {
      // Check if usage already exists
      const [existing] = await this.db
        .select()
        .from(messageUsage)
        .where(eq(messageUsage.messageId, messageId))
        .limit(1);

      if (existing) {
        // Update existing usage
        await this.db
          .update(messageUsage)
          .set({
            promptTokens: usage.promptTokens,
            completionTokens: usage.completionTokens,
            totalTokens: usage.totalTokens,
          })
          .where(eq(messageUsage.messageId, messageId));
      } else {
        // Insert new usage
        await this.db.insert(messageUsage).values({
          messageId,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
        });
      }
    });
  }

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
    const queryBuilder = this.db
      .select()
      .from(sessions)
      .where(like(sessions.title, `%${query}%`))
      .orderBy(desc(sessions.updated))
      .limit(limit + 1);

    if (cursor) {
      queryBuilder.where(
        and(
          like(sessions.title, `%${query}%`),
          sql`${sessions.updated} < ${cursor}`
        )
      );
    }

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

  /**
   * Get message count for session
   * Efficient: No need to load messages
   */
  async getMessageCount(sessionId: string): Promise<number> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(messages)
      .where(eq(messages.sessionId, sessionId));

    return count;
  }

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

  /**
   * Update todos for session
   */
  async updateTodos(sessionId: string, newTodos: TodoType[], nextTodoId: number): Promise<void> {
    await retryOnBusy(async () => {
      await this.db.transaction(async (tx) => {
        // Delete existing todos
        await tx.delete(todos).where(eq(todos.sessionId, sessionId));

        // Insert new todos
        for (const todo of newTodos) {
          await tx.insert(todos).values({
            id: todo.id,
            sessionId,
            content: todo.content,
            activeForm: todo.activeForm,
            status: todo.status,
            ordering: todo.ordering,
          });
        }

        // Update nextTodoId and timestamp
        await tx
          .update(sessions)
          .set({ nextTodoId, updated: Date.now() })
          .where(eq(sessions.id, sessionId));
      });
    });
  }

  /**
   * Get recent user messages for command history (cursor-based pagination)
   * DATA ON DEMAND: Returns only needed messages with pagination
   * CURSOR-BASED PAGINATION: Efficient for large datasets
   */
  async getRecentUserMessages(limit = 100, cursor?: number): Promise<{
    messages: string[];
    nextCursor: number | null;
  }> {
    return retryOnBusy(async () => {
      // Query user messages with cursor
      const queryBuilder = this.db
        .select({
          messageId: messages.id,
          timestamp: messages.timestamp,
        })
        .from(messages)
        .where(eq(messages.role, 'user'))
        .orderBy(desc(messages.timestamp))
        .limit(limit + 1);

      if (cursor) {
        queryBuilder.where(
          and(
            eq(messages.role, 'user'),
            sql`${messages.timestamp} < ${cursor}`
          )
        );
      }

      const userMessages = await queryBuilder;

      const hasMore = userMessages.length > limit;
      const messagesToReturn = hasMore ? userMessages.slice(0, limit) : userMessages;
      const nextCursor = hasMore ? messagesToReturn[messagesToReturn.length - 1].timestamp : null;

      if (messagesToReturn.length === 0) {
        return { messages: [], nextCursor: null };
      }

      // Get text parts for these messages via step parts
      const messageIds = messagesToReturn.map(m => m.messageId);

      // Get steps for these messages
      const steps = await this.db
        .select()
        .from(messageSteps)
        .where(inArray(messageSteps.messageId, messageIds));

      if (steps.length === 0) {
        // No steps found, return empty texts
        const messageTexts = new Map<string, string[]>();
        return {
          messages: messagesToReturn.map(m => ({
            id: m.messageId,
            role: m.role,
            text: messageTexts.get(m.messageId)?.join(' ') || '',
            timestamp: m.timestamp,
          })),
          nextCursor: cursor,
        };
      }

      const stepIds = steps.map(s => s.id);
      const parts = await this.db
        .select()
        .from(stepParts)
        .where(
          and(
            inArray(stepParts.stepId, stepIds),
            eq(stepParts.type, 'text')
          )
        )
        .orderBy(stepParts.ordering);

      // Map step IDs to message IDs
      const stepToMessage = new Map<string, string>();
      for (const step of steps) {
        stepToMessage.set(step.id, step.messageId);
      }

      // Group parts by message and extract text content
      const messageTexts = new Map<string, string[]>();
      for (const part of parts) {
        const messageId = stepToMessage.get(part.stepId);
        if (!messageId) continue;

        const content = JSON.parse(part.content);
        const text = content.content || '';
        if (text.trim()) {
          if (!messageTexts.has(messageId)) {
            messageTexts.set(messageId, []);
          }
          messageTexts.get(messageId)!.push(text);
        }
      }

      // Build result in timestamp order (most recent first)
      const result: string[] = [];
      for (const msg of messagesToReturn) {
        const texts = messageTexts.get(msg.messageId);
        if (texts && texts.length > 0) {
          const fullText = texts.join(' ').trim();
          if (fullText) {
            result.push(fullText);
          }
        }
      }

      return { messages: result, nextCursor };
    });
  }
}
