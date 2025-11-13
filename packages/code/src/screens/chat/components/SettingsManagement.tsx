/**
 * Settings Management Component
 * UI for configuring tool display settings and other preferences
 */

import { Box, Text } from "ink";
import SelectInput from "ink-select-input";
import React, { useState } from "react";
import type { AIConfig } from "@sylphx/code-core";
import { DEFAULT_TOOL_DISPLAY_SETTINGS } from "@sylphx/code-core";

interface SettingsManagementProps {
	aiConfig: AIConfig | null;
	onComplete: () => void;
	onSave: (config: AIConfig) => Promise<void>;
}

type View = "main" | "tool-display";

interface ToolDisplayItem {
	label: string;
	value: string;
	toolName: string;
	enabled: boolean;
	isDefault: boolean;
}

export function SettingsManagement({ aiConfig, onComplete, onSave }: SettingsManagementProps) {
	const [view, setView] = useState<View>("main");
	const [toolDisplaySettings, setToolDisplaySettings] = useState<Record<string, boolean>>(
		aiConfig?.toolDisplaySettings || {},
	);
	const [selectedToolIndex, setSelectedToolIndex] = useState(0);

	// Main menu options
	const mainMenuItems = [
		{ label: "Tool Display Settings", value: "tool-display" },
		{ label: "← Back", value: "back" },
	];

	// Get tool display items with current settings
	const getToolDisplayItems = (): ToolDisplayItem[] => {
		const toolNames = Object.keys(DEFAULT_TOOL_DISPLAY_SETTINGS);

		return toolNames.map((toolName) => {
			const userSetting = toolDisplaySettings[toolName];
			const defaultSetting = DEFAULT_TOOL_DISPLAY_SETTINGS[toolName];
			const isDefault = userSetting === undefined;
			const enabled = userSetting !== undefined ? userSetting : defaultSetting;

			// Format tool name nicely
			const displayName = toolName
				.split("-")
				.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
				.join(" ");

			const status = enabled ? "ON" : "OFF";
			const defaultIndicator = isDefault ? " (default)" : "";

			return {
				label: `${displayName.padEnd(20)} ${status}${defaultIndicator}`,
				value: toolName,
				toolName,
				enabled,
				isDefault,
			};
		});
	};

	const handleMainMenuSelect = (item: { value: string }) => {
		if (item.value === "back") {
			onComplete();
		} else if (item.value === "tool-display") {
			setView("tool-display");
		}
	};

	const handleToolDisplaySelect = (item: ToolDisplayItem) => {
		if (item.value === "save") {
			// Save settings
			const updatedConfig = {
				...aiConfig,
				toolDisplaySettings,
			} as AIConfig;

			onSave(updatedConfig);
			return;
		}

		if (item.value === "back") {
			setView("main");
			return;
		}

		if (item.value === "reset-all") {
			// Reset all to defaults
			setToolDisplaySettings({});
			return;
		}

		// Toggle tool setting
		const currentValue = toolDisplaySettings[item.toolName];
		const defaultValue = DEFAULT_TOOL_DISPLAY_SETTINGS[item.toolName];

		if (currentValue === undefined) {
			// No user override, set opposite of default
			setToolDisplaySettings({
				...toolDisplaySettings,
				[item.toolName]: !defaultValue,
			});
		} else if (currentValue === defaultValue) {
			// User override matches default, remove it
			const newSettings = { ...toolDisplaySettings };
			delete newSettings[item.toolName];
			setToolDisplaySettings(newSettings);
		} else {
			// User override differs from default, toggle it
			setToolDisplaySettings({
				...toolDisplaySettings,
				[item.toolName]: !currentValue,
			});
		}
	};

	// Main menu view
	if (view === "main") {
		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={1}>
					<Text bold>Settings</Text>
				</Box>

				<Box marginBottom={1}>
					<Text dimColor>Select a category to configure:</Text>
				</Box>

				<SelectInput items={mainMenuItems} onSelect={handleMainMenuSelect} />
			</Box>
		);
	}

	// Tool display settings view
	if (view === "tool-display") {
		const toolItems = getToolDisplayItems();

		// Add action items at the end
		const items = [
			...toolItems,
			{ label: "", value: "separator", toolName: "", enabled: false, isDefault: false }, // Separator
			{
				label: "Save Changes",
				value: "save",
				toolName: "",
				enabled: false,
				isDefault: false,
			},
			{
				label: "Reset All to Defaults",
				value: "reset-all",
				toolName: "",
				enabled: false,
				isDefault: false,
			},
			{ label: "← Back", value: "back", toolName: "", enabled: false, isDefault: false },
		];

		return (
			<Box flexDirection="column" padding={1}>
				<Box marginBottom={1}>
					<Text bold>Tool Display Settings</Text>
				</Box>

				<Box marginBottom={1} flexDirection="column">
					<Text dimColor>Configure which tools show details by default:</Text>
					<Text dimColor>• ON = Show full output</Text>
					<Text dimColor>• OFF = Show summary only</Text>
					<Text dimColor>Press Enter to toggle</Text>
				</Box>

				<SelectInput items={items} onSelect={handleToolDisplaySelect} />
			</Box>
		);
	}

	return null;
}
