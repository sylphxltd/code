/**
 * Message Repository
 * Database operations for messages and steps
 *
 * Responsibilities:
 * - Add messages to sessions
 * - Update message status, parts, and usage
 * - Query message counts and user message history
 */

import { eq, desc, and, sql, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import {
  sessions,
  messages,
  messageSteps,
  stepParts,
  stepUsage,
} from './schema.js';
import type {
  MessagePart,
  TokenUsage,
  MessageMetadata,
} from '../types/session.types.js';
import type { Todo as TodoType } from '../types/todo.types.js';
import { retryDatabase } from '../utils/retry.js';

export class MessageRepository {
  constructor(private db: LibSQLDatabase) {}

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
  async addMessage(options: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: MessagePart[];
    usage?: TokenUsage;
    finishReason?: string;
    metadata?: MessageMetadata;
    todoSnapshot?: TodoType[];
    status?: 'active' | 'completed' | 'error' | 'abort';
  }): Promise<string> {
    const {
      sessionId,
      role,
      content,
      usage,
      finishReason,
      metadata,
      todoSnapshot,
      status,
    } = options;

    return await retryDatabase(async () => {
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

          // 4. Insert step usage
          if (usage) {
            await tx.insert(stepUsage).values({
              stepId,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
            });
          }
        }

        // REMOVED: Message attachments - files now stored as frozen content in step parts
        // File content is captured at creation time and stored as base64 in MessagePart
        // This ensures immutable history and preserves order with text content

        // REMOVED: Message usage table - now computed from stepUsage on demand
        // Eliminates redundant storage and update operations

        // 5. Update session timestamp
        await tx
          .update(sessions)
          .set({ updated: now })
          .where(eq(sessions.id, sessionId));
      });

      return messageId;
    });
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
    await retryDatabase(async () => {
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
    await retryDatabase(async () => {
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
   * @deprecated Message usage table removed
   * Usage is now computed from stepUsage table on demand
   * This method is a no-op for backward compatibility
   */
  async updateMessageUsage(_messageId: string, _usage: TokenUsage): Promise<void> {
    // No-op: messageUsage table removed, usage computed from stepUsage
    // Kept for backward compatibility during migration
  }

  /**
   * Compute message usage from step usage (replaces messageUsage table)
   */
  async computeMessageUsage(messageId: string): Promise<TokenUsage | null> {
    return retryDatabase(async () => {
      const [result] = await this.db
        .select({
          promptTokens: sql<number>`COALESCE(SUM(${stepUsage.promptTokens}), 0)`,
          completionTokens: sql<number>`COALESCE(SUM(${stepUsage.completionTokens}), 0)`,
          totalTokens: sql<number>`COALESCE(SUM(${stepUsage.totalTokens}), 0)`,
        })
        .from(stepUsage)
        .innerJoin(messageSteps, eq(messageSteps.id, stepUsage.stepId))
        .where(eq(messageSteps.messageId, messageId));

      if (!result || result.totalTokens === 0) {
        return null;
      }

      return {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
      };
    });
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
   * Get recent user messages for command history (cursor-based pagination)
   * DATA ON DEMAND: Returns only needed messages with pagination
   * CURSOR-BASED PAGINATION: Efficient for large datasets
   */
  async getRecentUserMessages(limit = 100, cursor?: number): Promise<{
    messages: string[];
    nextCursor: number | null;
  }> {
    return retryDatabase(async () => {
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
        // No steps found, return empty array
        return {
          messages: [],
          nextCursor,
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
