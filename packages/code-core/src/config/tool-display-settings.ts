/**
 * Tool Display Settings
 * Configuration for which tools show details by default
 *
 * Philosophy (like Claude Code):
 * - Important tools (write, edit, bash) → details ON by default
 * - Less important tools (read, search) → details OFF by default
 * - User can override via /settings
 */

import { z } from "zod";

/**
 * Tool display settings
 * Map of tool name → should show details
 */
export const toolDisplaySettingsSchema = z.record(z.string(), z.boolean()).optional();

export type ToolDisplaySettings = z.infer<typeof toolDisplaySettingsSchema>;

/**
 * Default tool display settings
 * Based on Claude Code's approach:
 * - Important tools: ON (write, edit, bash)
 * - Less important: OFF (read, search tools)
 */
export const DEFAULT_TOOL_DISPLAY_SETTINGS: ToolDisplaySettings = {
	// File tools
	read: false, // OFF - summary is enough
	write: true, // ON - preview is valuable
	edit: true, // ON - diff is critical

	// Shell tools
	bash: true, // ON - command output important
	"bash-output": true, // ON - monitoring output
	"kill-bash": false, // OFF - simple action

	// Search tools
	grep: false, // OFF - summary count is enough
	glob: false, // OFF - summary count is enough

	// Interaction tools
	ask: false, // OFF - question shown in summary

	// Todo tools
	updateTodos: false, // OFF - summary shows changes
};

/**
 * Get whether a tool should show details by default
 * Falls back to true for unknown tools (conservative - show details)
 */
export function getToolShowDetailsDefault(toolName: string): boolean {
	return DEFAULT_TOOL_DISPLAY_SETTINGS[toolName] ?? true;
}

/**
 * Get effective tool display setting
 * Priority: user setting > default setting > true (fallback)
 */
export function shouldShowToolDetails(
	toolName: string,
	userSettings?: ToolDisplaySettings,
): boolean {
	// User override takes priority
	if (userSettings && toolName in userSettings) {
		return userSettings[toolName];
	}

	// Fall back to default
	return getToolShowDetailsDefault(toolName);
}

/**
 * Update tool display setting
 * Returns new settings object with updated value
 */
export function updateToolDisplaySetting(
	toolName: string,
	showDetails: boolean,
	currentSettings?: ToolDisplaySettings,
): ToolDisplaySettings {
	return {
		...currentSettings,
		[toolName]: showDetails,
	};
}

/**
 * Reset tool display setting to default
 * Returns new settings object with tool removed (will use default)
 */
export function resetToolDisplaySetting(
	toolName: string,
	currentSettings?: ToolDisplaySettings,
): ToolDisplaySettings {
	const newSettings = { ...currentSettings };
	delete newSettings[toolName];
	return newSettings;
}

/**
 * Reset all tool display settings to defaults
 */
export function resetAllToolDisplaySettings(): ToolDisplaySettings {
	return {};
}

/**
 * Get display info for a tool
 */
export interface ToolDisplayInfo {
	name: string;
	showDetails: boolean;
	isDefault: boolean;
}

/**
 * Get display info for all tools
 */
export function getAllToolDisplayInfo(userSettings?: ToolDisplaySettings): ToolDisplayInfo[] {
	const toolNames = Object.keys(DEFAULT_TOOL_DISPLAY_SETTINGS);

	return toolNames.map((name) => ({
		name,
		showDetails: shouldShowToolDetails(name, userSettings),
		isDefault: userSettings?.[name] === undefined,
	}));
}
