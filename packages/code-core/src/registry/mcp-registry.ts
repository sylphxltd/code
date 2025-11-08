/**
 * MCP Server Registry
 *
 * Centralized registry for Model Context Protocol servers.
 * Tracks server configurations, capabilities, and provided tools/resources.
 */

import type {
  MCPServer,
  MCPTool,
  MCPResource,
  MCPPrompt,
  MCPServerStatus,
} from '../types/mcp-entity.types.js';

/**
 * In-memory MCP server registry
 * This is populated at runtime when servers are discovered
 */
const mcpServers: Map<string, MCPServer> = new Map();

/**
 * Get all registered MCP servers
 */
export function getAllMCPServers(): MCPServer[] {
  return Array.from(mcpServers.values());
}

/**
 * Get MCP server by ID
 */
export function getMCPServer(serverId: string): MCPServer | undefined {
  return mcpServers.get(serverId);
}

/**
 * Register or update an MCP server
 */
export function registerMCPServer(server: MCPServer): void {
  mcpServers.set(server.id, server);
}

/**
 * Remove an MCP server from registry
 */
export function unregisterMCPServer(serverId: string): boolean {
  return mcpServers.delete(serverId);
}

/**
 * Update MCP server status
 */
export function updateMCPServerStatus(
  serverId: string,
  status: MCPServerStatus,
  error?: string
): void {
  const server = mcpServers.get(serverId);
  if (server) {
    server.status = status;
    server.error = error;
    server.lastUpdated = Date.now();
  }
}

/**
 * Get all tools from all MCP servers
 */
export function getAllMCPTools(): MCPTool[] {
  const tools: MCPTool[] = [];
  for (const server of mcpServers.values()) {
    if (server.status === 'active' && server.tools) {
      tools.push(...server.tools);
    }
  }
  return tools;
}

/**
 * Get tools from a specific MCP server
 */
export function getMCPServerTools(serverId: string): MCPTool[] {
  const server = mcpServers.get(serverId);
  return server?.tools || [];
}

/**
 * Get MCP tool by ID
 *
 * @param toolId - Full tool ID (format: serverId:toolName)
 * @returns The tool if found
 */
export function getMCPTool(toolId: string): MCPTool | undefined {
  const [serverId] = toolId.split(':');
  const server = mcpServers.get(serverId);
  return server?.tools.find(t => t.id === toolId);
}

/**
 * Get all resources from all MCP servers
 */
export function getAllMCPResources(): MCPResource[] {
  const resources: MCPResource[] = [];
  for (const server of mcpServers.values()) {
    if (server.status === 'active' && server.resources) {
      resources.push(...server.resources);
    }
  }
  return resources;
}

/**
 * Get resources from a specific MCP server
 */
export function getMCPServerResources(serverId: string): MCPResource[] {
  const server = mcpServers.get(serverId);
  return server?.resources || [];
}

/**
 * Get all prompts from all MCP servers
 */
export function getAllMCPPrompts(): MCPPrompt[] {
  const prompts: MCPPrompt[] = [];
  for (const server of mcpServers.values()) {
    if (server.status === 'active' && server.prompts) {
      prompts.push(...server.prompts);
    }
  }
  return prompts;
}

/**
 * Get prompts from a specific MCP server
 */
export function getMCPServerPrompts(serverId: string): MCPPrompt[] {
  const server = mcpServers.get(serverId);
  return server?.prompts || [];
}

/**
 * Get active (running) MCP servers
 */
export function getActiveMCPServers(): MCPServer[] {
  return Array.from(mcpServers.values()).filter(
    server => server.status === 'active'
  );
}

/**
 * Get enabled MCP servers (configured to be used)
 */
export function getEnabledMCPServers(): MCPServer[] {
  return Array.from(mcpServers.values()).filter(
    server => server.isEnabled
  );
}

/**
 * Check if an MCP server is active
 */
export function isMCPServerActive(serverId: string): boolean {
  const server = mcpServers.get(serverId);
  return server?.status === 'active';
}

/**
 * Get statistics about MCP servers
 */
export function getMCPStats() {
  const servers = Array.from(mcpServers.values());

  return {
    total: servers.length,
    active: servers.filter(s => s.status === 'active').length,
    inactive: servers.filter(s => s.status === 'inactive').length,
    error: servers.filter(s => s.status === 'error').length,
    enabled: servers.filter(s => s.isEnabled).length,
    totalTools: servers.reduce((sum, s) => sum + (s.tools?.length || 0), 0),
    totalResources: servers.reduce((sum, s) => sum + (s.resources?.length || 0), 0),
    totalPrompts: servers.reduce((sum, s) => sum + (s.prompts?.length || 0), 0),
  };
}

/**
 * Clear all registered MCP servers
 * Useful for testing or reset
 */
export function clearMCPRegistry(): void {
  mcpServers.clear();
}
