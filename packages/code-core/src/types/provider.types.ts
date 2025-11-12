/**
 * Provider Type Definitions
 * Shared types to prevent circular dependencies
 *
 * This file contains only type definitions with no imports,
 * allowing it to be safely imported from anywhere.
 */

/**
 * Provider configuration value
 * Generic provider config interface
 */
export interface ProviderConfigValue {
	defaultModel?: string;
	[key: string]: string | number | boolean | undefined;
}
