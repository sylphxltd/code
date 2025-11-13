/**
 * Settings Command
 * Configure tool display settings and other preferences
 */

import { SettingsManagement } from "../../screens/chat/components/SettingsManagement.js";
import type { Command } from "../types.js";

export const settingsCommand: Command = {
	id: "settings",
	label: "/settings",
	description: "Configure tool display settings and preferences",
	args: [],

	execute: async (context) => {
		// Get current config
		const { get } = await import("@sylphx/code-client");
		const { $aiConfig } = await import("@sylphx/code-client");
		const aiConfig = get($aiConfig);

		// Show settings UI
		context.setInputComponent(
			<SettingsManagement
				aiConfig={aiConfig}
				onComplete={() => {
					context.setInputComponent(null);
					context.addLog("[settings] Settings management closed");
				}}
				onSave={async (updatedConfig) => {
					// Update zen signal
					const { setAIConfig } = await import("@sylphx/code-client");
					setAIConfig(updatedConfig);

					// Save to file
					await context.saveConfig(updatedConfig);

					context.addLog("[settings] Settings saved successfully");
					context.setInputComponent(null);
				}}
			/>,
			"Settings",
		);
	},
};

export default settingsCommand;
