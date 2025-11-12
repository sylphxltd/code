/**
 * Entity Migration Utilities
 *
 * Utilities for migrating data to the new normalized entity structure.
 * Handles migration of:
 * - Sessions: provider+model → modelId
 * - MessagePart: tool naming and MCP server tracking
 * - Todos: entity relationships
 * - AIConfig: credential system
 */

import type { Session, SessionMetadata, MessagePart } from "../types/session.types.js";
import type { Todo } from "../types/todo.types.js";
import type { AIConfig } from "../config/ai-config.js";
import type { ProviderId } from "../ai/providers/index.js";
import { migrateToModelId, getDefaultModelIdForProvider } from "../registry/model-migration.js";
import { getTool } from "../registry/tool-registry.js";
import { getMCPServer } from "../registry/mcp-registry.js";
import { createLogger } from "../utils/logger.js";

const logger = createLogger("EntityMigrations");

/**
 * Migrate session to use normalized modelId
 * Converts legacy provider+model to normalized modelId
 */
export function migrateSessionToModelId<
	T extends {
		provider?: ProviderId | string;
		model?: string;
		modelId?: string;
	},
>(session: T): T & { modelId: string } {
	// Already has modelId, return as-is
	if (session.modelId) {
		return session as T & { modelId: string };
	}

	// Try to migrate from provider+model
	if (session.provider && session.model) {
		const modelId = migrateToModelId(session.provider, session.model);
		if (modelId) {
			return {
				...session,
				modelId,
			};
		}
	}

	// Fallback: use default model for provider
	if (session.provider) {
		const defaultModelId = getDefaultModelIdForProvider(session.provider as ProviderId);
		if (defaultModelId) {
			logger.warn("Using default model for provider during migration", {
				provider: session.provider,
				model: session.model,
				defaultModelId,
			});
			return {
				...session,
				modelId: defaultModelId,
			};
		}
	}

	// Last resort: use a common default
	logger.error("Failed to migrate session to modelId, using fallback", {
		provider: session.provider,
		model: session.model,
	});

	return {
		...session,
		modelId: "claude-sonnet-4", // Fallback default
	};
}

/**
 * Migrate session metadata to normalized structure
 */
export function migrateSessionMetadata(metadata: Partial<SessionMetadata>): SessionMetadata {
	const migrated = migrateSessionToModelId(metadata);

	return {
		id: metadata.id || "unknown",
		title: metadata.title,
		modelId: migrated.modelId,
		agentId: metadata.agentId || "coder",
		enabledRuleIds: metadata.enabledRuleIds,
		enabledToolIds: metadata.enabledToolIds,
		enabledMcpServerIds: metadata.enabledMcpServerIds,
		created: metadata.created || Date.now(),
		updated: metadata.updated || Date.now(),
		messageCount: metadata.messageCount || 0,
		// Preserve legacy fields for backward compatibility
		provider: metadata.provider,
		model: metadata.model,
	};
}

/**
 * Migrate full session to normalized structure
 */
export function migrateSession(session: Partial<Session>): Session {
	const migrated = migrateSessionToModelId(session);

	return {
		id: session.id || "unknown",
		title: session.title,
		modelId: migrated.modelId,
		agentId: session.agentId || "coder",
		enabledRuleIds: session.enabledRuleIds || [],
		enabledToolIds: session.enabledToolIds,
		enabledMcpServerIds: session.enabledMcpServerIds,
		messages: session.messages || [],
		todos: session.todos?.map(migrateTodo) || [],
		nextTodoId: session.nextTodoId || 1,
		created: session.created || Date.now(),
		updated: session.updated || Date.now(),
		// Preserve legacy fields
		provider: session.provider,
		model: session.model,
	};
}

/**
 * Migrate MessagePart to add MCP server tracking
 * Adds mcpServerId field for MCP tools
 */
export function migrateMessagePart(part: MessagePart): MessagePart {
	// Only process tool parts
	if (part.type !== "tool") {
		return part;
	}

	// Check if this is an MCP tool (format: serverId:toolName)
	if (part.toolId.includes(":")) {
		const [serverId] = part.toolId.split(":", 2);

		// Verify server exists in registry
		const server = getMCPServer(serverId);
		if (server) {
			return {
				...part,
				mcpServerId: serverId,
			};
		} else {
			logger.warn("MCP server not found in registry", {
				toolId: part.toolId,
				serverId,
			});
			// Still add mcpServerId even if server not found (for historical data)
			return {
				...part,
				mcpServerId: serverId,
			};
		}
	}

	// Builtin tool - verify it exists
	const tool = getTool(part.toolId);
	if (!tool) {
		logger.warn("Builtin tool not found in registry", { toolId: part.toolId });
	}

	return part;
}

/**
 * Migrate Todo to add entity relationships
 */
export function migrateTodo(todo: Todo): Todo {
	// Already has new fields, return as-is
	if (todo.createdByToolId || todo.createdByStepId || todo.relatedFiles || todo.metadata) {
		return todo;
	}

	// No migration needed for old todos - they'll work without relationships
	return todo;
}

/**
 * Migrate AIConfig to use normalized structure
 */
export function migrateAIConfig(config: Partial<AIConfig>): AIConfig {
	const migrated: AIConfig = {
		defaultProvider: config.defaultProvider,
		defaultEnabledRuleIds: config.defaultEnabledRuleIds,
		defaultAgentId: config.defaultAgentId,
		defaultModelId: config.defaultModelId,
		defaultToolIds: config.defaultToolIds,
		defaultMcpServerIds: config.defaultMcpServerIds,
		providers: config.providers,
	};

	return migrated;
}

/**
 * Batch migrate multiple sessions
 */
export function batchMigrateSessions(sessions: Partial<Session>[]): Session[] {
	return sessions.map(migrateSession);
}

/**
 * Batch migrate message parts
 */
export function batchMigrateMessageParts(parts: MessagePart[]): MessagePart[] {
	return parts.map(migrateMessagePart);
}

/**
 * Batch migrate todos
 */
export function batchMigrateTodos(todos: Todo[]): Todo[] {
	return todos.map(migrateTodo);
}

/**
 * Get migration statistics for a session
 */
export function getSessionMigrationStats(session: Partial<Session>): {
	needsModelIdMigration: boolean;
	needsToolMigration: boolean;
	needsTodoMigration: boolean;
	totalMessageParts: number;
	totalTodos: number;
} {
	const needsModelIdMigration = !session.modelId && !!(session.provider && session.model);

	let toolPartsCount = 0;
	for (const message of session.messages || []) {
		for (const step of message.steps || []) {
			toolPartsCount += step.parts.filter((p) => p.type === "tool").length;
		}
	}

	const needsToolMigration = toolPartsCount > 0;
	const needsTodoMigration = (session.todos || []).length > 0;

	return {
		needsModelIdMigration,
		needsToolMigration,
		needsTodoMigration,
		totalMessageParts: toolPartsCount,
		totalTodos: (session.todos || []).length,
	};
}
