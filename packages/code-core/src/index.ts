/**
 * @sylphx/code-core
 * Complete headless SDK with all business logic
 *
 * This package contains all core functionality:
 * - AI streaming and providers
 * - Session management
 * - Message handling
 * - Database layer (pure functions)
 * - Tools execution
 * - Configuration
 *
 * NOTE: This is SDK/Library layer - NO application context management
 * Application composition happens in code-server package
 */

// ============================================================================
// AI & Streaming
// ============================================================================
export { createAIStream, getSystemStatus, buildSystemStatusFromMetadata, getSystemPrompt, type SystemStatus } from './ai/ai-sdk.js'
export { processStream, type StreamCallbacks } from './ai/stream-handler.js'
export { buildModelMessages } from './ai/message-builder/index.js'

// ============================================================================
// System Messages (Dynamic LLM Hints)
// ============================================================================
export { SystemMessages, createSystemMessage, parseSystemMessageType, isSystemMessage } from './ai/system-messages/index.js'
export { checkAllTriggers, insertSystemMessage, initializeTriggers, triggerRegistry } from './ai/system-messages/triggers.js'
export type { SystemMessageType } from './ai/system-messages/index.js'
export type { TriggerHook, TriggerRegistration, TriggerContext, TriggerResult } from './ai/system-messages/registry.js'

// ============================================================================
// Agent Manager (Pure Functions Only)
// ============================================================================
export { DEFAULT_AGENT_ID } from './ai/builtin-agents.js'
export { loadAllAgents } from './ai/agent-loader.js'

// NOTE: Global state functions removed (moved to code-server AppContext):
// - initializeAgentManager, getAllAgents, getAgentById, reloadAgents
// Use AgentManagerService from code-server/src/context.ts instead

// ============================================================================
// System Prompt Builder
// ============================================================================
export { buildSystemPrompt } from './ai/system-prompt-builder.js'

// ============================================================================
// Rule Manager (Pure Functions Only)
// ============================================================================
export { loadAllRules } from './ai/rule-loader.js'

// NOTE: Global state functions removed (moved to code-server AppContext):
// - initializeRuleManager, getAllRules, getRuleById, getEnabledRuleIds,
//   getEnabledRules, toggleRule, enableRule, disableRule, setEnabledRules
// - setRuleAppStoreGetter (horror anti-pattern removed)
// Use RuleManagerService from code-server/src/context.ts instead

// ============================================================================
// Providers
// ============================================================================
export { getProvider } from './ai/providers/index.js'
export { AnthropicProvider } from './ai/providers/anthropic-provider.js'
export { OpenAIProvider } from './ai/providers/openai-provider.js'
export { GoogleProvider } from './ai/providers/google-provider.js'
export { OpenRouterProvider } from './ai/providers/openrouter-provider.js'
export { ClaudeCodeProvider } from './ai/providers/claude-code-provider.js'
export { ZaiProvider } from './ai/providers/zai-provider.js'

// ============================================================================
// Database & Repositories (Pure Functions)
// ============================================================================
export { SessionRepository } from './database/session-repository.js'
export { MessageRepository } from './database/message-repository.js'
export { TodoRepository } from './database/todo-repository.js'
export { initializeDatabase } from './database/auto-migrate.js'
export {
  createMessageStep,
  updateStepParts,
  completeMessageStep,
  loadMessageSteps,
} from './database/step-repository-helpers.js'
export { events } from './database/schema.js'
export type { Event, NewEvent } from './database/schema.js'

// NOTE: Global state functions removed (moved to code-server AppContext):
// - getDatabase, getSessionRepository
// Use DatabaseService from code-server/src/context.ts instead

// ============================================================================
// Configuration
// ============================================================================
export {
  loadAIConfig,
  saveAIConfig,
  getAIConfigPaths,
  AI_PROVIDERS,
  getConfiguredProviders,
  getProviderApiKey,
  getProviderConfigWithApiKey,
} from './config/ai-config.js'
export type { AIConfig, ProviderId } from './config/ai-config.js'
export type { ProviderConfig } from './ai/providers/base-provider.js'

// ============================================================================
// Credential Management (Normalized Credential System)
// ============================================================================
export type * from './types/credential.types.js'
export {
  getAllCredentials,
  getCredential,
  getCredentialsByProvider,
  getDefaultCredential,
  getActiveCredentials,
  getCredentialsByScope,
  createCredential,
  updateCredential,
  deleteCredential,
  maskApiKey,
  getMaskedCredential,
  getAllMaskedCredentials,
  hasActiveCredential,
  getCredentialStats,
} from './registry/credential-registry.js'
export {
  loadCredentials,
  saveCredentials,
  addCredential,
  removeCredential,
  modifyCredential,
  credentialsExist,
  migrateProviderConfigToCredentials,
  getCredentialPaths,
} from './config/credential-manager.js'

// ============================================================================
// Types
// ============================================================================
export type * from './types/session.types.js'
export type * from './types/common.types.js'
export type * from './types/interaction.types.js'
export type * from './types/todo.types.js'
export type * from './types/model.types.js'
export type * from './types/tool.types.js'
export type * from './types/mcp-entity.types.js'

// ============================================================================
// Model Registry (Normalized Model System)
// ============================================================================
export {
  PROVIDERS,
  MODELS,
  getAllProviders,
  getProviderEntity,
  getAllModels,
  getModel,
  getModelsByProvider,
  getModelWithProvider,
  modelSupportsInput,
  modelSupportsOutput,
} from './registry/model-registry.js'

export {
  migrateToModelId,
  getDefaultModelIdForProvider,
  getProviderIdFromModelId,
  migrateSessionModel,
} from './registry/model-migration.js'

// ============================================================================
// Entity Migration Utilities
// ============================================================================
export {
  migrateSessionToModelId,
  migrateSessionMetadata,
  migrateSession,
  migrateMessagePart,
  migrateTodo,
  migrateAIConfig,
  batchMigrateSessions,
  batchMigrateMessageParts,
  batchMigrateTodos,
  getSessionMigrationStats,
} from './database/entity-migrations.js'

// ============================================================================
// Tool Registry (Normalized Tool System)
// ============================================================================
export {
  TOOL_CATEGORIES,
  TOOLS,
  getAllTools,
  getTool,
  getToolsByCategory,
  getAllCategories,
  getCategory,
  isToolSupportedByModel,
  getToolsSupportedByModel,
  getToolsBySecurityLevel,
  getDangerousTools,
  getSafeTools,
} from './registry/tool-registry.js'

// ============================================================================
// MCP Server Registry (Model Context Protocol)
// ============================================================================
export {
  getAllMCPServers,
  getMCPServer,
  registerMCPServer,
  unregisterMCPServer,
  updateMCPServerStatus,
  getAllMCPTools,
  getMCPServerTools,
  getMCPTool,
  getAllMCPResources,
  getMCPServerResources,
  getAllMCPPrompts,
  getMCPServerPrompts,
  getActiveMCPServers,
  getEnabledMCPServers,
  isMCPServerActive,
  getMCPStats,
  clearMCPRegistry,
} from './registry/mcp-registry.js'

// ============================================================================
// Session Management
// ============================================================================
export { getOrCreateSession, showModelToolSupportError } from './ai/session-service.js'
export { compactSession, shouldCompactSession, type CompactResult } from './ai/compact-service.js'
export { createHeadlessDisplay } from './ai/headless-display.js'
export { addMessage } from './utils/session-manager.js'

// ============================================================================
// Utils
// ============================================================================
export { buildTodoContext } from './utils/todo-context.js'
export { generateSessionTitleWithStreaming, cleanAITitle } from './utils/session-title.js'
export { generateSessionTitle } from './utils/session-title.js'
export { formatSessionDisplay } from './session/utils/title.js'
// NOTE: formatTodoChange and formatTodoCount are used internally by tools/todo.ts
// Exporting them here causes duplicate exports in the bundle. Keep them internal.
export { formatTokenCount, getTokenizerInfo, countTokens } from './utils/token-counter.js'
export { filterFiles, type FileInfo } from './utils/file-scanner.js'
export { fetchModels, type ModelInfo } from './utils/ai-model-fetcher.js'
export { debugLog, createLogger } from './utils/debug-logger.js'
export * from './utils/cursor-utils.js'
export * from './utils/scroll-viewport.js'
export * from './utils/tool-formatters.js'

// ============================================================================
// Tools
// ============================================================================
// NOTE: './tools/index.js' exports all tool-related functions including:
// - Filesystem tools (read, write, edit)
// - Shell tools (bash, bash-output, kill-bash)
// - Search tools (glob, grep)
// - Interaction tools (ask)
// - Registry functions (getAISDKTools, getToolCategories, getAllToolNames)
// - Todo tools (createTodoTool)
// - Bash manager (bashManager)
export * from './tools/index.js'
export { scanProjectFiles } from './utils/file-scanner.js'
export { sendNotification } from './utils/notifications.js'

// ============================================================================
// Version
// ============================================================================
export const version = '0.1.0'
