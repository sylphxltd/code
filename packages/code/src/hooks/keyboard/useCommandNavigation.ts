/**
 * Command Navigation Hook
 * Handles command autocomplete navigation (slash commands)
 *
 * Single Responsibility: Command autocomplete navigation and execution
 */

import { useInput } from "ink";
import type React from "react";
import type { Command, CommandContext } from "../../commands/types.js";

export interface UseCommandNavigationOptions {
	input: string;
	pendingInput: any | null;
	filteredCommands: Command[];
	selectedCommandIndex: number;
	skipNextSubmit: React.MutableRefObject<boolean>;
	commandSessionRef: React.MutableRefObject<string | null>;
	currentSessionId: string | null;
	setInput: (value: string) => void;
	setCursor: (value: number) => void;
	setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
	addLog: (message: string) => void;
	addMessage: (params: any) => Promise<string>;
	getAIConfig: () => { defaultProvider?: string; defaultModel?: string } | null;
	createCommandContext: (args: string[]) => CommandContext;
}

/**
 * Handles command autocomplete navigation
 * - Up/Down arrows → navigate command list
 * - Tab → fill in autocomplete text
 * - Enter → execute command
 * - ESC → cancel command mode
 */
export function useCommandNavigation(options: UseCommandNavigationOptions) {
	const {
		input,
		pendingInput,
		filteredCommands,
		selectedCommandIndex,
		skipNextSubmit,
		commandSessionRef,
		currentSessionId,
		setInput,
		setCursor,
		setSelectedCommandIndex,
		addLog,
		addMessage,
		getAIConfig,
		createCommandContext,
	} = options;

	useInput(
		async (char, key) => {
			// Only handle when command autocomplete is active
			if (filteredCommands.length === 0 || pendingInput) {
				return false;
			}

			// Arrow down - next command
			if (key.downArrow) {
				setSelectedCommandIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : prev));
				return true; // Consumed
			}

			// Arrow up - previous command
			if (key.upArrow) {
				setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : 0));
				return true; // Consumed
			}

			// Tab - fill in autocomplete text only
			if (key.tab) {
				const selected = filteredCommands[selectedCommandIndex];
				if (selected) {
					const hasArgs = selected.args && selected.args.length > 0;
					const completedText = hasArgs ? `${selected.label} ` : selected.label;

					addLog(`[useInput] Tab autocomplete fill: ${completedText}`);
					setInput(completedText);
					setCursor(completedText.length); // Move cursor to end
					setSelectedCommandIndex(0);
				}
				return true; // Consumed
			}

			// Enter - execute autocomplete selection
			if (key.return) {
				const selected = filteredCommands[selectedCommandIndex];
				if (selected) {
					skipNextSubmit.current = true; // Prevent TextInput's onSubmit from also executing

					// Clear input immediately before execution
					setInput("");
					setSelectedCommandIndex(0);

					// Execute command directly - let command handle interaction via CommandContext
					addLog(`[useInput] Enter autocomplete execute: ${selected.label}`);

					// Add user message to conversation (lazy create session if needed)
					const aiConfig = getAIConfig();
					const provider = aiConfig?.defaultProvider || "openrouter";
					const model = aiConfig?.defaultModel || "anthropic/claude-3.5-sonnet";

					const sessionIdToUse = commandSessionRef.current || currentSessionId;
					const resultSessionId = await addMessage({
						sessionId: sessionIdToUse,
						role: "user",
						content: selected.label,
						provider,
						model,
					});

					if (!commandSessionRef.current) {
						commandSessionRef.current = resultSessionId;
					}

					// Execute command - it will use waitForInput if needed
					const response = await selected.execute(createCommandContext([]));

					// Add final response if any
					if (response) {
						await addMessage({
							sessionId: commandSessionRef.current,
							role: "assistant",
							content: response,
							provider,
							model,
						});
					}
				}
				return true; // Consumed
			}

			// Escape - cancel command mode
			if (key.escape) {
				setInput("");
				setSelectedCommandIndex(0);
				return true; // Consumed
			}

			return false; // Not our concern
		},
		{ isActive: !pendingInput }, // Disable when in selection/text input mode
	);
}
