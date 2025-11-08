/**
 * MCP Entity Types - Normalized MCP Server System
 *
 * Model Context Protocol (MCP) servers provide dynamic tools, resources, and prompts.
 * This file defines the normalized entity structure for MCP servers and their capabilities.
 */

import type { MCPServerConfig, MCPServerConfigHTTP } from './mcp.types.js';

/**
 * MCP Server status
 */
export type MCPServerStatus =
  | 'active'      // Running and available
  | 'inactive'    // Configured but not started
  | 'error'       // Failed to start or crashed
  | 'loading';    // Currently initializing

/**
 * MCP Tool provided by a server
 * Represents a callable tool exposed via MCP protocol
 */
export interface MCPTool {
  /** Unique tool ID (format: serverId:toolName) */
  id: string;

  /** Server that provides this tool */
  serverId: string;

  /** Tool name as defined by the server */
  name: string;

  /** Tool description from server */
  description: string;

  /** Input schema (JSON Schema format from MCP) */
  inputSchema: Record<string, unknown>;

  /** Whether this tool is currently available */
  isAvailable: boolean;
}

/**
 * MCP Resource provided by a server
 * Represents a readable resource (file, data, etc.)
 */
export interface MCPResource {
  /** Unique resource ID (format: serverId:resourceUri) */
  id: string;

  /** Server that provides this resource */
  serverId: string;

  /** Resource URI as defined by the server */
  uri: string;

  /** Resource name/title */
  name: string;

  /** Resource description */
  description?: string;

  /** MIME type of the resource */
  mimeType?: string;

  /** Whether this resource is currently available */
  isAvailable: boolean;
}

/**
 * MCP Prompt template provided by a server
 */
export interface MCPPrompt {
  /** Unique prompt ID (format: serverId:promptName) */
  id: string;

  /** Server that provides this prompt */
  serverId: string;

  /** Prompt name as defined by the server */
  name: string;

  /** Prompt description */
  description?: string;

  /** Arguments the prompt accepts */
  arguments?: Array<{
    name: string;
    description?: string;
    required?: boolean;
  }>;

  /** Whether this prompt is currently available */
  isAvailable: boolean;
}

/**
 * MCP Server capabilities
 * What features the server supports
 */
export interface MCPServerCapabilities {
  /** Server provides callable tools */
  tools?: boolean;

  /** Server provides readable resources */
  resources?: boolean;

  /** Server provides prompt templates */
  prompts?: boolean;

  /** Server supports subscriptions */
  subscriptions?: boolean;
}

/**
 * MCP Server entity
 * Represents a running or configured MCP server
 */
export interface MCPServer {
  /** Unique server ID (user-defined) */
  id: string;

  /** Display name */
  name: string;

  /** Server description */
  description?: string;

  /** Server configuration (stdio or http) */
  config: MCPServerConfig | MCPServerConfigHTTP;

  /** Current server status */
  status: MCPServerStatus;

  /** Server capabilities (discovered on connection) */
  capabilities: MCPServerCapabilities;

  /** Tools provided by this server */
  tools: MCPTool[];

  /** Resources provided by this server */
  resources: MCPResource[];

  /** Prompts provided by this server */
  prompts: MCPPrompt[];

  /** Server metadata (version, vendor, etc.) */
  metadata?: {
    version?: string;
    vendor?: string;
    homepage?: string;
  };

  /** Whether server is enabled */
  isEnabled: boolean;

  /** Error message if status is 'error' */
  error?: string;

  /** Last update timestamp */
  lastUpdated?: number;
}

/**
 * MCP Server discovery result
 * Information returned when discovering MCP servers
 */
export interface MCPServerDiscovery {
  /** Server ID */
  serverId: string;

  /** Discovered capabilities */
  capabilities: MCPServerCapabilities;

  /** Number of tools found */
  toolCount: number;

  /** Number of resources found */
  resourceCount: number;

  /** Number of prompts found */
  promptCount: number;

  /** Discovery timestamp */
  discoveredAt: number;
}

/**
 * MCP Server connection info
 * Runtime connection details
 */
export interface MCPServerConnection {
  /** Server ID */
  serverId: string;

  /** Connection status */
  status: 'connected' | 'disconnected' | 'connecting' | 'error';

  /** Connection established timestamp */
  connectedAt?: number;

  /** Last activity timestamp */
  lastActivity?: number;

  /** Error details if status is 'error' */
  error?: {
    message: string;
    code?: string;
    timestamp: number;
  };
}
