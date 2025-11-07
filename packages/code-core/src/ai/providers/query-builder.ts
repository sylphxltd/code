/**
 * Query Builder
 * Handles query options building, system prompt extraction, and tool conversion
 */

import type { LanguageModelV2CallOptions } from '@ai-sdk/provider';
import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { generateToolsSystemPrompt, type ToolDefinition } from './text-based-tools.js';

// All Claude Code built-in tools to disable
const CLAUDE_CODE_BUILTIN_TOOLS = [
  'Task',
  'Bash',
  'Glob',
  'Grep',
  'ExitPlanMode',
  'Read',
  'Edit',
  'Write',
  'NotebookEdit',
  'WebFetch',
  'TodoWrite',
  'WebSearch',
  'BashOutput',
  'KillShell',
  'Skill',
  'SlashCommand',
];

/**
 * Convert tools from Vercel AI SDK format to our internal format
 */
export function convertTools(tools: unknown[]): Record<string, ToolDefinition> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }

  const toolsMap: Record<string, ToolDefinition> = {};
  for (const tool of tools) {
    if (typeof tool !== 'object' || !tool || !('name' in tool)) continue;

    // Vercel AI SDK uses 'inputSchema' field for the JSON Schema
    const parameters =
      ('inputSchema' in tool && tool.inputSchema) ||
      ('parameters' in tool && tool.parameters) ||
      { type: 'object', properties: {} };

    toolsMap[String(tool.name)] = {
      type: 'function',
      name: String(tool.name),
      description: 'description' in tool ? String(tool.description) : undefined,
      parameters: parameters as ToolDefinition['parameters'],
    };
  }
  return toolsMap;
}

/**
 * Extract system prompt from messages
 */
export function extractSystemPrompt(options: LanguageModelV2CallOptions): string | undefined {
  const systemMessages = options.prompt.filter((msg) => msg.role === 'system');
  if (systemMessages.length === 0) {
    return undefined;
  }

  const systemTexts = systemMessages
    .flatMap((msg) => {
      // Handle both array and non-array content
      const content = Array.isArray(msg.content) ? msg.content : [msg.content];
      return content
        .filter((part) => typeof part === 'object' && part.type === 'text')
        .map((part) => part.text);
    })
    .join('\n');

  return systemTexts || undefined;
}

/**
 * Build query options from call options
 */
export function buildQueryOptions(
  modelId: string,
  options: LanguageModelV2CallOptions,
  tools: Record<string, ToolDefinition> | undefined,
  includePartialMessages = false
): { queryOptions: Options; systemPrompt: string } {
  // Build system prompt
  let systemPrompt = extractSystemPrompt(options) || '';

  // Add tools description to system prompt if tools are provided
  if (tools && Object.keys(tools).length > 0) {
    const toolsPrompt = generateToolsSystemPrompt(tools);
    systemPrompt = systemPrompt ? `${systemPrompt}\n\n${toolsPrompt}` : toolsPrompt;
  }

  // Build query options
  const queryOptions: Options = {
    model: modelId,
    settingSources: [],
    disallowedTools: CLAUDE_CODE_BUILTIN_TOOLS,
  };

  if (systemPrompt) {
    queryOptions.systemPrompt = systemPrompt;
  }

  if (includePartialMessages) {
    queryOptions.includePartialMessages = true;
  }

  // Extract provider-specific options
  const providerOptions = options.providerOptions?.['claude-code'] as
    | Record<string, unknown>
    | undefined;

  // Add maxThinkingTokens from providerOptions if provided
  if (
    providerOptions &&
    'maxThinkingTokens' in providerOptions &&
    typeof providerOptions.maxThinkingTokens === 'number'
  ) {
    queryOptions.maxThinkingTokens = providerOptions.maxThinkingTokens;
  }

  // Add sessionId (resume) from providerOptions if provided
  // This allows reusing Claude Code sessions instead of creating new ones each time
  if (
    providerOptions &&
    'sessionId' in providerOptions &&
    typeof providerOptions.sessionId === 'string'
  ) {
    queryOptions.resume = providerOptions.sessionId;
  }

  return { queryOptions, systemPrompt };
}
