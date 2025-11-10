/**
 * Drizzle ORM schema for Sylphx Flow
 * Type-safe database schema with migrations support
 */

import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Memory table for persistent storage
export const memory = sqliteTable(
  'memory',
  {
    key: text('key').notNull(),
    namespace: text('namespace').notNull().default('default'),
    value: text('value').notNull(),
    timestamp: integer('timestamp').notNull(),
    created_at: text('created_at').notNull(),
    updated_at: text('updated_at').notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.key, table.namespace] }),
    namespaceIdx: index('idx_memory_namespace').on(table.namespace),
    timestampIdx: index('idx_memory_timestamp').on(table.timestamp),
    keyIdx: index('idx_memory_key').on(table.key),
  })
);

// Codebase files table
export const codebaseFiles = sqliteTable(
  'codebase_files',
  {
    path: text('path').primaryKey(),
    mtime: integer('mtime').notNull(),
    hash: text('hash').notNull(),
    content: text('content'), // Optional full content
    language: text('language'), // Detected programming language
    size: integer('size'), // File size in bytes
    indexedAt: text('indexed_at').notNull(),
  },
  (table) => ({
    mtimeIdx: index('idx_codebase_files_mtime').on(table.mtime),
    hashIdx: index('idx_codebase_files_hash').on(table.hash),
  })
);

// TF-IDF terms table
export const tfidfTerms = sqliteTable(
  'tfidf_terms',
  {
    filePath: text('file_path')
      .notNull()
      .references(() => codebaseFiles.path, { onDelete: 'cascade' }),
    term: text('term').notNull(),
    frequency: real('frequency').notNull(),
  },
  (table) => ({
    termIdx: index('idx_tfidf_terms_term').on(table.term),
    fileIdx: index('idx_tfidf_terms_file').on(table.filePath),
  })
);

// TF-IDF documents table (document vectors)
export const tfidfDocuments = sqliteTable('tfidf_documents', {
  filePath: text('file_path')
    .primaryKey()
    .references(() => codebaseFiles.path, { onDelete: 'cascade' }),
  magnitude: real('magnitude').notNull(),
  termCount: integer('term_count').notNull(),
  rawTerms: text('raw_terms').notNull(), // JSON string of Record<string, number>
});

// IDF values table
export const tfidfIdf = sqliteTable('tfidf_idf', {
  term: text('term').primaryKey(),
  idfValue: real('idf_value').notNull(),
});

// Codebase metadata table
export const codebaseMetadata = sqliteTable('codebase_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// Export types for TypeScript
export type Memory = typeof memory.$inferSelect;
export type NewMemory = typeof memory.$inferInsert;

export type CodebaseFile = typeof codebaseFiles.$inferSelect;
export type NewCodebaseFile = typeof codebaseFiles.$inferInsert;

export type TfidfTerm = typeof tfidfTerms.$inferSelect;
export type NewTfidfTerm = typeof tfidfTerms.$inferInsert;

export type TfidfDocument = typeof tfidfDocuments.$inferSelect;
export type NewTfidfDocument = typeof tfidfDocuments.$inferInsert;

export type TfidfIdf = typeof tfidfIdf.$inferSelect;
export type NewTfidfIdf = typeof tfidfIdf.$inferInsert;

export type CodebaseMetadata = typeof codebaseMetadata.$inferSelect;
export type NewCodebaseMetadata = typeof codebaseMetadata.$inferInsert;

// ============================================
// Session Management Tables
// ============================================

/**
 * Sessions table - Main chat sessions
 * Stores session metadata and configuration
 */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    title: text('title'),

    // NEW: Normalized model ID (references model registry)
    // Examples: 'claude-sonnet-4', 'gpt-4o', 'openrouter/anthropic/claude-sonnet-3.5'
    // Nullable to support migration from old provider+model format
    modelId: text('model_id'),

    // DEPRECATED: Legacy provider/model columns kept for migration
    // Will be removed in next major version
    // Made nullable for forward compatibility when creating new sessions with modelId
    provider: text('provider'), // Legacy: 'anthropic' | 'openai' | 'google' | 'openrouter'
    model: text('model'),       // Legacy: model name string

    agentId: text('agent_id').notNull().default('coder'), // Agent configuration per session
    enabledRuleIds: text('enabled_rule_ids', { mode: 'json' }).notNull().default('[]').$type<string[]>(), // Enabled rules for this session

    // NEW: Normalized tool and MCP server IDs
    enabledToolIds: text('enabled_tool_ids', { mode: 'json' }).$type<string[]>(), // References Tool.id[]
    enabledMcpServerIds: text('enabled_mcp_server_ids', { mode: 'json' }).$type<string[]>(), // References MCPServer.id[]

    nextTodoId: integer('next_todo_id').notNull().default(1),

    // Note: Streaming state moved to messages table (message-level, not session-level)
    // Each message can be in streaming state with isStreaming flag

    created: integer('created').notNull(), // Unix timestamp (ms)
    updated: integer('updated').notNull(), // Unix timestamp (ms)
  },
  (table) => ({
    updatedIdx: index('idx_sessions_updated').on(table.updated),
    createdIdx: index('idx_sessions_created').on(table.created),
    // NEW: Index on normalized modelId
    modelIdIdx: index('idx_sessions_model_id').on(table.modelId),
    // DEPRECATED: Legacy provider index (will be removed)
    providerIdx: index('idx_sessions_provider').on(table.provider),
    titleIdx: index('idx_sessions_title').on(table.title),
  })
);

/**
 * Messages table - Chat messages in sessions (containers for steps)
 * Stores message metadata and role
 *
 * Design: Message = Container, Step = Request
 * - User message: 1 step (user input at one time)
 * - Assistant message: 1+ steps (may need multiple AI calls for tool execution)
 * - metadata/todoSnapshot moved to steps table (per-request context)
 */
export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'system' | 'user' | 'assistant'
    timestamp: integer('timestamp').notNull(), // Unix timestamp (ms)
    ordering: integer('ordering').notNull(), // For display order
    // Aggregated from steps (for UI convenience)
    finishReason: text('finish_reason'), // Final finish reason from last step
    status: text('status').notNull().default('completed'), // Overall status (derived from steps)
  },
  (table) => ({
    sessionIdx: index('idx_messages_session').on(table.sessionId),
    orderingIdx: index('idx_messages_ordering').on(table.sessionId, table.ordering),
    timestampIdx: index('idx_messages_timestamp').on(table.timestamp),
    statusIdx: index('idx_messages_status').on(table.status),
  })
);

/**
 * Message steps table - Steps representing AI call(s) within a message
 * Each step = ONE request at ONE point in time
 *
 * Design: Step = Request/Turn
 * - User message: 1 step (user input)
 * - Assistant message: 1+ steps (initial response, then tool execution steps)
 * - Each step has its own metadata (system status at step start time)
 * - Each step has its own todoSnapshot (todo state at step start time)
 */
export const messageSteps = sqliteTable(
  'message_steps',
  {
    id: text('id').primaryKey(), // e.g., "step-0", "step-1"
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull(), // 0, 1, 2, ... (order)

    // Per-step execution metadata
    provider: text('provider'), // May route different steps to different providers
    model: text('model'), // May use different models per step
    duration: integer('duration'), // Step execution time (ms)
    finishReason: text('finish_reason'), // 'stop' | 'tool-calls' | 'length' | 'error'
    status: text('status').notNull().default('completed'), // 'active' | 'completed' | 'error' | 'abort'

    // Per-step context (captured at step start time)
    metadata: text('metadata'), // JSON: { cpu?: string, memory?: string }

    // Timestamps
    startTime: integer('start_time'), // Unix timestamp (ms)
    endTime: integer('end_time'), // Unix timestamp (ms)
  },
  (table) => ({
    messageIdx: index('idx_message_steps_message').on(table.messageId),
    stepIndexIdx: index('idx_message_steps_step_index').on(table.messageId, table.stepIndex),
    statusIdx: index('idx_message_steps_status').on(table.status),
  })
);

/**
 * Step usage table - Token usage for steps
 * 1:1 relationship with steps (only assistant steps have usage)
 */
export const stepUsage = sqliteTable('step_usage', {
  stepId: text('step_id')
    .primaryKey()
    .references(() => messageSteps.id, { onDelete: 'cascade' }),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  totalTokens: integer('total_tokens').notNull(),
});

/**
 * @deprecated Step todo snapshots table - REMOVED
 *
 * Todo snapshots are NO LONGER stored per-step.
 * Only send todos on first user message after /compact command.
 *
 * Rationale:
 * - User reported 100+ steps per message being common
 * - Storing todos on every step is excessive and wasteful
 * - Todos are only needed when starting new context after /compact
 *
 * New behavior:
 * - /compact command sets flag on session
 * - Next user message includes full todo snapshot
 * - Subsequent steps in same session don't include todos
 * - Reduces database size significantly for long conversations
 *
 * Migration: Table dropped, streaming service updated
 */

/**
 * Step parts table - Content parts within a step
 * Stores text, reasoning, tool calls, errors
 * Content structure varies by type, stored as JSON
 *
 * ALL parts have unified status field: 'active' | 'completed' | 'error' | 'abort'
 */
export const stepParts = sqliteTable(
  'step_parts',
  {
    id: text('id').primaryKey(),
    stepId: text('step_id')
      .notNull()
      .references(() => messageSteps.id, { onDelete: 'cascade' }),
    ordering: integer('ordering').notNull(), // Order within step
    type: text('type').notNull(), // 'text' | 'reasoning' | 'tool' | 'error'
    // Content structure (JSON) - ALL parts include status field:
    // - text: { type: 'text', content: string, status: 'active' | 'completed' | ... }
    // - reasoning: { type: 'reasoning', content: string, status: ..., duration?: number }
    // - tool: { type: 'tool', toolId: string, name: string, status: ..., duration?: number, args?: any, result?: any, error?: string }
    // - error: { type: 'error', error: string, status: 'completed' }
    content: text('content').notNull(), // JSON string
  },
  (table) => ({
    stepIdx: index('idx_step_parts_step').on(table.stepId),
    orderingIdx: index('idx_step_parts_ordering').on(table.stepId, table.ordering),
    typeIdx: index('idx_step_parts_type').on(table.type),
  })
);

/**
 * @deprecated Message attachments table - DEPRECATED
 *
 * File content is now stored as frozen base64 in step_parts.content (MessagePart type='file')
 * This ensures immutable history and preserves order with text content
 *
 * Migration path:
 * - Old messages: Keep table for backward compatibility (read-only)
 * - New messages: Files stored in step_parts as frozen content
 * - Future: Drop table after migration tool created
 */
export const messageAttachments = sqliteTable(
  'message_attachments',
  {
    id: text('id').primaryKey(),
    messageId: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
    relativePath: text('relative_path').notNull(),
    size: integer('size'),
  },
  (table) => ({
    messageIdx: index('idx_message_attachments_message').on(table.messageId),
    pathIdx: index('idx_message_attachments_path').on(table.path),
  })
);

/**
 * @deprecated Message usage table - REMOVED
 *
 * Token usage is now computed from stepUsage table on demand
 * This eliminates redundant storage and update operations
 *
 * To get message usage:
 * SELECT
 *   SUM(prompt_tokens) as promptTokens,
 *   SUM(completion_tokens) as completionTokens,
 *   SUM(total_tokens) as totalTokens
 * FROM step_usage su
 * JOIN message_steps ms ON ms.id = su.step_id
 * WHERE ms.message_id = ?
 *
 * Migration: Table dropped, queries updated to use computed property
 */

/**
 * Todos table - Per-session todo lists
 */
export const todos = sqliteTable(
  'todos',
  {
    id: integer('id').notNull(), // Per-session ID (not globally unique!)
    sessionId: text('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    activeForm: text('active_form').notNull(),
    status: text('status').notNull(), // 'pending' | 'in_progress' | 'completed'
    ordering: integer('ordering').notNull(),

    // NEW: Entity relationships (normalized)
    createdByToolId: text('created_by_tool_id'), // References Tool.id or MCP tool ID
    createdByStepId: text('created_by_step_id'), // References MessageStep.id
    relatedFiles: text('related_files', { mode: 'json' }).$type<string[]>(), // Related file paths
    metadata: text('metadata', { mode: 'json' }).$type<{
      tags?: string[];
      priority?: 'low' | 'medium' | 'high';
      estimatedMinutes?: number;
      dependencies?: number[];
    }>(), // Additional metadata
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.id] }),
    sessionIdx: index('idx_todos_session').on(table.sessionId),
    statusIdx: index('idx_todos_status').on(table.status),
    orderingIdx: index('idx_todos_ordering').on(table.sessionId, table.ordering),
    createdByStepIdx: index('idx_todos_created_by_step').on(table.createdByStepId),
  })
);

/**
 * Events table - Event stream storage
 * Stores application events with cursor-based replay support
 *
 * Design: Similar to Redis Streams (XADD/XREAD)
 * - Events are append-only
 * - Each event has a cursor (timestamp + sequence)
 * - Supports reading from any cursor position
 * - Channels for routing (session:*, config:*, app:*, etc.)
 */
export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(),                                        // evt_1234567890_0
    channel: text('channel').notNull(),                                 // 'session:abc', 'config:ai'
    type: text('type').notNull(),                                       // 'title-updated', 'text-delta'
    timestamp: integer('timestamp').notNull(),                          // Unix ms (part of cursor)
    sequence: integer('sequence').notNull(),                            // Sequence within timestamp (part of cursor)
    payload: text('payload', { mode: 'json' }).$type<any>().notNull(), // Event data as JSON
    createdAt: integer('created_at').notNull(),                         // When saved to DB
  },
  (table) => ({
    // Composite index for cursor-based queries (channel + cursor)
    channelCursorIdx: index('idx_events_channel_cursor').on(
      table.channel,
      table.timestamp,
      table.sequence
    ),
    // Index for cleanup queries
    timestampIdx: index('idx_events_timestamp').on(table.timestamp),
    // Index for channel queries
    channelIdx: index('idx_events_channel').on(table.channel),
  })
);


/**
 * File contents table - Frozen file storage for conversation history
 *
 * Design: Immutable file storage supporting multiple use cases
 * =============================================================
 *
 * Use Cases:
 * 1. Frozen History: Files never change → prompt cache preserved
 * 2. Conversation Search: FTS5 index on text content
 * 3. Rewind/Checkpoint: Each user message = checkpoint, can restore files
 * 4. Deduplication: SHA256 hash to share identical files (future)
 *
 * Storage Format:
 * - BLOB storage (no base64 overhead = 33% smaller than JSON)
 * - Text files: content + text_content for FTS5 search
 * - Binary files: content only (images, PDFs, etc.)
 *
 * Relationship:
 * - step_parts contains file-ref type with fileContentId
 * - file_contents stores actual frozen content
 * - ordering preserves position within step for reconstruction
 *
 * Migration from base64-in-JSON:
 * - Old: step_parts.content = { type: 'file', base64: '...' }
 * - New: step_parts.content = { type: 'file-ref', fileContentId: '...' }
 *       + file_contents row with BLOB
 */
export const fileContents = sqliteTable(
  'file_contents',
  {
    id: text('id').primaryKey(),
    stepId: text('step_id')
      .notNull()
      .references(() => messageSteps.id, { onDelete: 'cascade' }),
    ordering: integer('ordering').notNull(), // Position within step (preserves text-to-file order)

    // File metadata
    relativePath: text('relative_path').notNull(),
    mediaType: text('media_type').notNull(),
    size: integer('size').notNull(),

    // Frozen content (immutable for prompt cache + rewind)
    content: text('content', { mode: 'blob' }).notNull(), // Binary BLOB (no base64!)

    // Search support
    isText: integer('is_text').notNull(), // 1 for text files, 0 for binary
    textContent: text('text_content'), // Decoded UTF-8 for FTS5 index (text files only)

    // Deduplication (future optimization)
    sha256: text('sha256'), // Share identical files across checkpoints

    createdAt: integer('created_at').notNull(),
  },
  (table) => ({
    stepOrderingIdx: index('idx_file_contents_step_ordering').on(table.stepId, table.ordering),
    typeIdx: index('idx_file_contents_type').on(table.mediaType),
    pathIdx: index('idx_file_contents_path').on(table.relativePath),
    sha256Idx: index('idx_file_contents_sha256').on(table.sha256), // For deduplication queries
  })
);

// TEMPORARY ALIASES for backward compatibility during transition
// These reference old table names but point to new step-based tables
export const messageParts = stepParts;

// Export types for TypeScript
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type MessageStep = typeof messageSteps.$inferSelect;
export type NewMessageStep = typeof messageSteps.$inferInsert;

export type StepUsage = typeof stepUsage.$inferSelect;
export type NewStepUsage = typeof stepUsage.$inferInsert;

export type StepPart = typeof stepParts.$inferSelect;
export type NewStepPart = typeof stepParts.$inferInsert;

export type FileContent = typeof fileContents.$inferSelect;
export type NewFileContent = typeof fileContents.$inferInsert;

export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

// Legacy aliases
export type MessagePart = StepPart;
export type NewMessagePart = NewStepPart;

export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NewMessageAttachment = typeof messageAttachments.$inferInsert;

export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;
