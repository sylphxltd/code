/**
 * Tool Registry
 *
 * Centralized registry of all AI tools with metadata.
 * This is the single source of truth for tool information.
 */

import type { Tool, ToolCategoryInfo } from '../types/tool.types.js';

/**
 * Tool category metadata
 */
export const TOOL_CATEGORIES: Record<string, ToolCategoryInfo> = {
  filesystem: {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'File and directory operations',
    icon: '📁',
  },
  shell: {
    id: 'shell',
    name: 'Shell',
    description: 'Execute shell commands and scripts',
    icon: '🖥️',
  },
  search: {
    id: 'search',
    name: 'Search',
    description: 'Search and find content in files',
    icon: '🔍',
  },
  interaction: {
    id: 'interaction',
    name: 'Interaction',
    description: 'User interaction and communication',
    icon: '💬',
  },
  todo: {
    id: 'todo',
    name: 'Todo',
    description: 'Task and todo management',
    icon: '✅',
  },
  mcp: {
    id: 'mcp',
    name: 'MCP',
    description: 'Model Context Protocol tools',
    icon: '🔌',
  },
};

/**
 * All registered tools
 */
export const TOOLS: Record<string, Tool> = {
  // ============================================================================
  // Filesystem Tools
  // ============================================================================
  read: {
    id: 'read',
    name: 'Read File',
    category: 'filesystem',
    description: 'Read contents of a file from the filesystem. Supports pagination with offset and limit parameters for large files.',
    capabilities: {
      isAsync: true,
      supportsParallel: true,
    },
    securityLevel: 'safe',
    enabledByDefault: true,
    source: 'builtin',
    examples: [
      'read({ file_path: "src/app.ts" })',
      'read({ file_path: "large.log", offset: 100, limit: 50 })',
    ],
  },

  write: {
    id: 'write',
    name: 'Write File',
    category: 'filesystem',
    description: 'Write or overwrite a file with new content. Creates parent directories if needed.',
    capabilities: {
      isAsync: true,
      isStateful: true,
      supportsParallel: false,
    },
    securityLevel: 'dangerous',
    enabledByDefault: true,
    source: 'builtin',
    relatedTools: ['read'],
    examples: [
      'write({ file_path: "config.json", content: "{\\"key\\": \\"value\\"}" })',
    ],
  },

  edit: {
    id: 'edit',
    name: 'Edit File',
    category: 'filesystem',
    description: 'Edit a file by replacing specific content. Safer than rewriting the entire file.',
    capabilities: {
      isAsync: true,
      isStateful: true,
      supportsParallel: false,
    },
    securityLevel: 'moderate',
    enabledByDefault: true,
    source: 'builtin',
    relatedTools: ['read', 'write'],
    examples: [
      'edit({ file_path: "app.ts", old_content: "const x = 1", new_content: "const x = 2" })',
    ],
  },

  // ============================================================================
  // Shell Tools
  // ============================================================================
  bash: {
    id: 'bash',
    name: 'Execute Bash',
    category: 'shell',
    description: 'Execute a bash command and return output. Supports background execution and timeouts.',
    capabilities: {
      requiresConfirmation: false,
      isDangerous: true,
      isAsync: true,
      isStateful: true,
      supportsParallel: true,
    },
    securityLevel: 'dangerous',
    enabledByDefault: true,
    source: 'builtin',
    examples: [
      'bash({ command: "ls -la" })',
      'bash({ command: "npm test", timeout: 60000 })',
      'bash({ command: "npm run dev", run_in_background: true })',
    ],
  },

  // ============================================================================
  // Search Tools
  // ============================================================================
  grep: {
    id: 'grep',
    name: 'Grep (Search)',
    category: 'search',
    description: 'Search for patterns in files using ripgrep. Supports regex, glob filters, and context lines.',
    capabilities: {
      isAsync: true,
      supportsParallel: true,
    },
    securityLevel: 'safe',
    enabledByDefault: true,
    source: 'builtin',
    relatedTools: ['glob'],
    examples: [
      'grep({ pattern: "TODO", path: "src/" })',
      'grep({ pattern: "function.*async", glob: "*.ts", output_mode: "files_with_matches" })',
    ],
  },

  glob: {
    id: 'glob',
    name: 'Glob (Find Files)',
    category: 'search',
    description: 'Find files matching glob patterns. Fast file pattern matching.',
    capabilities: {
      isAsync: true,
      supportsParallel: true,
    },
    securityLevel: 'safe',
    enabledByDefault: true,
    source: 'builtin',
    relatedTools: ['grep'],
    examples: [
      'glob({ pattern: "**/*.ts" })',
      'glob({ pattern: "src/**/*.test.ts" })',
    ],
  },

  // ============================================================================
  // Interaction Tools
  // ============================================================================
  ask: {
    id: 'ask',
    name: 'Ask User',
    category: 'interaction',
    description: 'Ask the user a question and get their response. Supports multiple choice and free text.',
    capabilities: {
      isAsync: true,
      isStateful: true,
      supportsParallel: false,
    },
    securityLevel: 'safe',
    enabledByDefault: true,
    source: 'builtin',
    // Only supported by models with tool support
    unsupportedByModels: ['o1', 'o1-mini'], // Reasoning models don't support tools
    examples: [
      'ask({ questions: [{ question: "Which approach?", options: [...] }] })',
    ],
  },

  // ============================================================================
  // Todo Tools
  // ============================================================================
  updateTodos: {
    id: 'updateTodos',
    name: 'Update Todos',
    category: 'todo',
    description: 'Update the todo list for the current session. Can add, modify, or remove todos.',
    capabilities: {
      isAsync: true,
      isStateful: true,
      supportsParallel: false,
    },
    securityLevel: 'safe',
    enabledByDefault: true,
    source: 'builtin',
    unsupportedByModels: ['o1', 'o1-mini'],
    examples: [
      'updateTodos({ todos: [{ content: "Fix bug", status: "in_progress" }] })',
    ],
  },
};

/**
 * Get all tools
 */
export function getAllTools(): Tool[] {
  return Object.values(TOOLS);
}

/**
 * Get tool by ID
 */
export function getTool(toolId: string): Tool | undefined {
  return TOOLS[toolId];
}

/**
 * Get tools by category
 */
export function getToolsByCategory(category: string): Tool[] {
  return Object.values(TOOLS).filter(tool => tool.category === category);
}

/**
 * Get all tool categories
 */
export function getAllCategories(): ToolCategoryInfo[] {
  return Object.values(TOOL_CATEGORIES);
}

/**
 * Get category info
 */
export function getCategory(categoryId: string): ToolCategoryInfo | undefined {
  return TOOL_CATEGORIES[categoryId];
}

/**
 * Check if tool is supported by model
 *
 * @param toolId - Tool ID
 * @param modelId - Model ID
 * @returns true if tool is supported by the model
 */
export function isToolSupportedByModel(toolId: string, modelId: string): boolean {
  const tool = TOOLS[toolId];
  if (!tool) return false;

  // Check unsupported list first (takes precedence)
  if (tool.unsupportedByModels?.includes(modelId)) {
    return false;
  }

  // If supportedByModels is defined, check if model is in the list
  if (tool.supportedByModels) {
    return tool.supportedByModels.includes(modelId);
  }

  // If no restrictions, supported by all
  return true;
}

/**
 * Get tools supported by a specific model
 *
 * @param modelId - Model ID
 * @returns List of tools supported by the model
 */
export function getToolsSupportedByModel(modelId: string): Tool[] {
  return Object.values(TOOLS).filter(tool =>
    isToolSupportedByModel(tool.id, modelId)
  );
}

/**
 * Get tools by security level
 */
export function getToolsBySecurityLevel(level: Tool['securityLevel']): Tool[] {
  return Object.values(TOOLS).filter(tool => tool.securityLevel === level);
}

/**
 * Get dangerous tools
 */
export function getDangerousTools(): Tool[] {
  return getToolsBySecurityLevel('dangerous');
}

/**
 * Get safe (read-only) tools
 */
export function getSafeTools(): Tool[] {
  return getToolsBySecurityLevel('safe');
}
