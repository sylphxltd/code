/**
 * Session Types
 * Unified session and message types used across TUI and headless modes
 */

import type { ProviderId } from "../config/ai-config.js";
import type { Todo } from "./todo.types.js";
import type { Model } from "./model.types.js";

/**
 * Message Part - unified type for all content parts
 *
 * ALL parts have status field to track their lifecycle state:
 * - 'active': Being generated/processed
 * - 'completed': Successfully finished
 * - 'error': Failed with error
 * - 'abort': User cancelled
 *
 * Design: No separate "StreamingPart" type needed
 * - Streaming parts ARE message parts
 * - Status field tracks state during and after streaming
 * - No conversion required between streaming/stored formats
 *
 * Multiple parts can be active simultaneously (parallel tool calls).
 */
export type MessagePart =
	| {
			type: "text";
			content: string;
			status: "active" | "completed" | "error" | "abort";
	  }
	| {
			type: "reasoning";
			content: string;
			status: "active" | "completed" | "error" | "abort";
			duration?: number;
			startTime?: number;
	  }
	| {
			type: "tool";
			toolId: string; // Normalized: references Tool.id for builtin, or 'serverId:toolName' for MCP
			name: string; // Preserved for historical messages (even if tool is removed from registry)
			mcpServerId?: string; // NEW: If this is an MCP tool, references MCPServer.id
			status: "active" | "completed" | "error" | "abort";
			input?: unknown;
			result?: unknown;
			error?: string;
			duration?: number;
			startTime?: number;
	  }
	| {
			type: "file";
			relativePath: string; // Display path (e.g., "src/app.ts")
			size: number; // File size in bytes
			mediaType: string; // MIME type (e.g., "text/plain", "image/png")
			base64: string; // LEGACY: Frozen content - never re-read from disk
			status: "completed"; // Files are immediately completed when received
	  }
	| {
			type: "file-ref";
			fileContentId: string; // Reference to file_contents table
			relativePath: string; // Denormalized for display (avoid JOIN for lists)
			size: number; // Denormalized for display
			mediaType: string; // Denormalized for display
			status: "completed"; // Files are immediately completed when received
	  }
	| {
			type: "system-message";
			content: string; // Full XML content with <system_message> tags
			messageType: string; // Type identifier (e.g., 'resource-warning-memory')
			timestamp: number; // When the message was generated
			status: "completed"; // System messages are immediately completed
	  }
	| {
			type: "error";
			error: string;
			status: "completed"; // Errors are immediately completed
	  };

/**
 * Legacy type alias for backwards compatibility
 * @deprecated Use MessagePart directly
 */
export type StreamingPart = MessagePart;

/**
 * Message Step - represents one reasoning/generation cycle (ONE REQUEST)
 *
 * Design: Step = Request/Turn, not just content grouping
 * ======================================================
 *
 * CRITICAL: Step represents ONE AI call at ONE point in time
 * - Has its own timestamp → its own system status (cpu, memory)
 * - Has its own cost → usage, provider, model, duration
 *
 * Why steps have metadata:
 * 1. Step = request at specific time → captures system status at that moment
 * 2. Multi-step execution → step 0 may have different CPU/memory than step 1
 *
 * Note: todoSnapshot REMOVED for performance
 * - Original design: Each step stored todos (step 0 sees [A,B], step 1 sees [A,B,C])
 * - Problem: 100+ steps per message × todos = excessive storage
 * - Current: Todos managed at session level only (session.todos)
 * - See: TODOSNAPSHOT-REALITY.md
 *
 * Example multi-step flow:
 * Step 0 (t=0): metadata={cpu:20%, memory:2GB}
 *   → Tool calls to read files
 * Step 1 (t=5s): metadata={cpu:45%, memory:3GB}
 *   → Process tool results, generate response
 *
 * Step lifecycle:
 * - status: 'active' → generating this step
 * - status: 'completed' → step finished successfully
 * - status: 'error' → step failed
 * - status: 'abort' → user cancelled
 *
 * Step boundaries (when to start new step):
 * - finishReason === 'tool-calls' → automatic new step for processing tool results
 * - finishReason === 'stop' → end of message, no new step
 * - finishReason === 'length' → token limit, may continue in new step
 */
export interface MessageStep {
	id: string; // Step ID (e.g., "step-0", "step-1")
	stepIndex: number; // 0, 1, 2, ... (order)
	parts: MessagePart[]; // Content parts for this step

	// System messages to insert BEFORE this step (for LLM context)
	// When building model messages, these become 'user' role messages inserted before step content
	// Multiple messages can fire simultaneously (e.g., context + memory warnings)
	systemMessages?: SystemMessage[];

	// Per-step context (captured at step start time)
	metadata?: MessageMetadata; // System status at THIS step's start time

	/**
	 * @deprecated No longer stored per-step (REMOVED for performance)
	 *
	 * Rationale:
	 * - User reported 100+ steps per message being common
	 * - Storing todos on every step is excessive and wasteful
	 * - Todos are managed at session level (session.todos)
	 *
	 * Current Status:
	 * - NOT stored in database (no column exists)
	 * - MAY appear in runtime events (step-start event)
	 * - NOT injected into LLM context (buildUserMessage check never executes)
	 *
	 * See: TODOSNAPSHOT-REALITY.md for complete analysis
	 */
	todoSnapshot?: Todo[]; // ❌ DEPRECATED - Not stored, not used

	// Per-step execution metadata
	usage?: TokenUsage;
	provider?: string; // Future: may route different steps to different providers
	model?: string; // Future: may use different models per step
	duration?: number; // Step execution time (ms)
	finishReason?: "stop" | "tool-calls" | "length" | "error";
	status: "active" | "completed" | "error" | "abort";

	startTime?: number; // Timestamp when step started
	endTime?: number; // Timestamp when step ended
}

/**
 * File attachment input (from frontend before persistence)
 * Used during message creation to tag files that will be read and frozen
 */
export interface FileAttachmentInput {
	path: string; // Absolute path (for reading file content)
	relativePath: string; // Display path (e.g., "src/app.ts")
	size?: number; // File size in bytes (optional)
	mimeType?: string; // MIME type (optional, will be detected if not provided)
}

/**
 * @deprecated Use FileAttachmentInput for new code
 * Legacy type kept for backwards compatibility
 */
export type FileAttachment = FileAttachmentInput;

/**
 * System Message - Runtime warnings/notifications inserted between steps
 * Used for mid-execution alerts (context warnings, resource warnings, etc.)
 */
export interface SystemMessage {
	type: string; // Message type (e.g., 'context-warning-80', 'resource-warning-memory')
	content: string; // Full message content (for LLM context)
	timestamp?: number; // When this message was triggered (Unix timestamp)
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
	promptTokens: number;
	completionTokens: number;
	totalTokens: number;
}

/**
 * Message metadata - system information at message creation time
 *
 * IMPORTANT: This metadata is captured ONCE when the message is created and NEVER changes.
 * This is critical for prompt cache effectiveness - historical messages must remain immutable.
 *
 * Design decisions:
 * 1. Stored separately from content - not shown in UI, only sent to LLM
 * 2. Captured at creation time - never updated to preserve prompt cache
 * 3. Used to build system status context when constructing ModelMessage for LLM
 *
 * What goes in metadata vs top-level fields:
 * - metadata: Info for LLM but NOT shown in UI (cpu, memory, future: sessionId, requestId)
 * - usage/finishReason: Info for UI/monitoring but NOT sent to LLM
 * - timestamp: Shown in UI AND used to construct metadata for LLM
 * - content: Shown in UI AND sent to LLM
 */
export interface MessageMetadata {
	cpu?: string; // CPU usage at creation time (e.g., "45.3% (8 cores)")
	memory?: string; // Memory usage at creation time (e.g., "4.2GB/16.0GB")
	// Future: add more fields as needed (sessionId, requestId, modelVersion, etc.)
}

/**
 * Session message - Container for steps representing a conversation turn
 *
 * Design: Message = Container, Step = Request
 * ===========================================
 *
 * CORRECTED: Messages are CONTAINERS for steps
 * - User message: 1 step (user input at one time)
 * - Assistant message: 1+ steps (may need multiple AI calls for tool execution)
 * - metadata/todoSnapshot belong to STEPS, not messages
 *
 * Why steps have their own metadata/todoSnapshot:
 * - Step = ONE AI call at ONE point in time
 * - System status (cpu, memory) captured PER step (not per message)
 * - Todo state captured PER step (todos change during execution)
 * - Example: Step 0 has todos=[A,B], then tool creates C, Step 1 has todos=[A,B,C]
 *
 * Message-level fields:
 * - id, role, timestamp: Identity and conversation structure
 * - attachments: Files uploaded with user message (applies to all steps)
 * - usage: SUM of all steps (total cost for this message)
 * - finishReason: FINAL reason from last step
 * - status: Overall message status (derived from steps)
 *
 * UI Display:
 * - Render each step with its own header (step index, duration, usage)
 * - Show per-step system status and todos if needed
 * - Total message cost = sum of step costs
 *
 * LLM Context:
 * - Each step's metadata + todoSnapshot injected when building ModelMessage
 * - Attachments (files) read and injected for first step
 * - Steps after first only get tool results context
 */
export interface SessionMessage {
	id: string; // Unique message ID from database
	role: "system" | "user" | "assistant"; // Session-level roles
	steps: MessageStep[]; // Steps representing AI call(s) for this message

	// Message-level metadata
	timestamp: number; // When message was created
	status?: "active" | "completed" | "error" | "abort"; // Overall status (derived from steps)

	// REMOVED: attachments field - files are now stored as frozen content in message steps
	// File content is captured at creation time and stored as base64 in step.parts
	// This ensures immutable history and preserves order with text content

	// Aggregated from steps (for UI convenience)
	usage?: TokenUsage; // Total usage (sum of all steps)
	finishReason?: string; // Final finish reason (from last step)
}

/**
 * Role conversion rules when building ModelMessage for LLM:
 * - 'system' → 'user'  (system messages become user context for attention decay)
 * - 'user' → 'user'    (direct mapping)
 * - 'assistant' → 'assistant' (direct mapping)
 *
 * UI behavior:
 * - 'system' messages: Skip in history navigation (up/down arrows), show with special styling
 * - 'user' messages: Normal user input, included in history navigation
 * - 'assistant' messages: AI responses, not in history navigation
 */

/**
 * Convenience type alias for SessionMessage
 * Used throughout codebase for brevity
 */
export type Message = SessionMessage;

/**
 * Model availability status
 * Used to indicate if a session's configured model is still available
 */
export type ModelStatus = "available" | "unavailable" | "unknown";

/**
 * Session metadata (lightweight)
 * Used for lists and selection UI - no messages or todos included
 *
 * Design: Data on demand
 * ======================
 * - SessionMetadata: Lightweight, for lists/selection (this type)
 * - Session: Full data with messages/todos (below)
 *
 * Why separate types:
 * - Avoids loading all messages when showing session list
 * - Efficient cursor-based pagination
 * - Clear API contracts (metadata vs full session)
 */
export interface SessionMetadata {
	id: string;
	title?: string;

	/**
	 * Model ID (normalized)
	 * References Model.id in model registry
	 * @example 'claude-sonnet-4', 'gpt-4o', 'openrouter/anthropic/claude-sonnet-3.5'
	 */
	modelId: string;

	modelStatus?: ModelStatus; // Optional: validated against model registry
	agentId: string;
	enabledRuleIds?: string[]; // Enabled rules for this session
	enabledToolIds?: string[]; // NEW: Enabled tools (references Tool.id[])
	enabledMcpServerIds?: string[]; // NEW: Enabled MCP servers (references MCPServer.id[])

	created: number;
	updated: number;
	messageCount: number;

	// DEPRECATED: Legacy fields kept for backward compatibility during migration
	// These will be removed in next major version
	/** @deprecated Use modelId instead */
	provider?: ProviderId;
	/** @deprecated Use modelId instead */
	model?: string;
}

/**
 * Chat session
 *
 * Design: Per-session todo lists
 * ================================
 *
 * Why todos are scoped to sessions (not global):
 * 1. Context isolation - Each conversation has its own task context
 * 2. Prevents cross-contamination - New session won't see old todos
 * 3. LLM clarity - AI only sees tasks relevant to current conversation
 *
 * Before (global todos):
 * - Session A creates todos ["Build feature X", "Test feature X"]
 * - Session B starts, user says "hi"
 * - LLM sees Session A's todos and tries to complete them ❌
 *
 * After (per-session todos):
 * - Session A has its own todos
 * - Session B starts with empty todos ✅
 * - Each session manages independent task lists
 *
 * Implementation notes:
 * - nextTodoId is also per-session to avoid ID conflicts
 * - Todos are persisted with session to disk
 * - updateTodos tool requires sessionId parameter
 *
 * Design: Message status-based state
 * ===================================
 *
 * Streaming state is derived from message status, not stored separately:
 * - message.status: 'active' | 'completed' | 'error' | 'abort'
 * - part.status: 'active' | 'completed' | 'error' | 'abort'
 *
 * Session recovery:
 * 1. Find messages with status === 'active'
 * 2. Display their parts directly
 * 3. No separate streaming state needed
 *
 * Streaming lifecycle:
 * 1. User sends message → Create message with status='active'
 * 2. Parts arrive → Add/update parts in message
 * 3. User switches session → Message stays in DB with status='active'
 * 4. Streaming completes → Update message status='completed'
 * 5. User aborts (ESC) → Update message status='abort'
 *
 * Benefits:
 * - Single source of truth (message data)
 * - No conversion between streaming/persistent formats
 * - Recovery is just "display active messages"
 * - Archives naturally (status='archived')
 */
export interface Session {
	id: string;
	title?: string; // Auto-generated from first user message

	/**
	 * Model ID (normalized)
	 * References Model.id in model registry
	 * @example 'claude-sonnet-4', 'gpt-4o', 'openrouter/anthropic/claude-sonnet-3.5'
	 */
	modelId: string;

	modelStatus?: ModelStatus; // Optional: validated against model registry (server-side)
	agentId: string; // Agent configuration for this session
	enabledRuleIds: string[]; // Enabled rules for this session (persisted to DB)

	/**
	 * Enabled tools for this session (normalized)
	 * References Tool.id[] from tool registry
	 * If undefined/empty, all tools enabled by default
	 */
	enabledToolIds?: string[];

	/**
	 * Enabled MCP servers for this session (normalized)
	 * References MCPServer.id[] from MCP server registry
	 * If undefined/empty, all enabled MCP servers are used
	 */
	enabledMcpServerIds?: string[];

	messages: SessionMessage[];
	todos: Todo[]; // Per-session todo list (not global!)
	nextTodoId: number; // Next todo ID for this session (starts at 1)

	// System message trigger flags (state tracking)
	// Used to prevent duplicate system messages (e.g., memoryWarning, cpuWarning)
	flags?: Record<string, boolean>;

	// Note: Streaming state derived from message.status, not stored here
	// To check if streaming: messages.some(m => m.status === 'active')

	created: number;
	updated: number;

	// DEPRECATED: Legacy fields kept for backward compatibility during migration
	// These will be removed in next major version
	/** @deprecated Use modelId instead */
	provider?: ProviderId;
	/** @deprecated Use modelId instead */
	model?: string;
}
