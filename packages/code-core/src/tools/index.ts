/**
 * Tools Index
 * Unified exports for all tools
 * Using explicit exports instead of wildcards to avoid bundler duplicate export issues
 */

// Filesystem tools
export { readFileTool, writeFileTool, editFileTool, filesystemTools } from './filesystem.js';

// Shell tools
export { executeBashTool, bashOutputTool, killBashTool, shellTools } from './shell.js';

// Search tools
export { globTool, grepTool, searchTools } from './search.js';

// Interaction tools
export {
  setQueueUpdateCallback,
  hasUserInputHandler,
  getQueueLength,
  setUserInputHandler,
  clearUserInputHandler,
  askUserSelectionTool,
  interactionTools,
} from './interaction.js';

// Registry
export { getAISDKTools, getToolCategories, getAllToolNames } from './registry.js';
export type { GetToolsOptions } from './registry.js';

// Bash manager
export { bashManager } from './bash-manager.js';

// Todo tool
export { createTodoTool } from './todo.js';
export type { TodoToolContext } from './todo.js';
