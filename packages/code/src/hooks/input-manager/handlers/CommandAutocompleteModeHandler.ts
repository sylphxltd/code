/**
 * Command Autocomplete Mode Handler
 *
 * Handles command autocomplete navigation (slash commands)
 * Migrated from useCommandNavigation hook
 */

import type { Key } from "ink";
import type React from "react";
import { InputMode, type InputModeContext } from "../types.js";
import { BaseInputHandler } from "./BaseHandler.js";
import type { Command, CommandContext } from "../../../commands/types.js";

export interface CommandAutocompleteModeHandlerDeps {
	filteredCommands: Command[];
	selectedCommandIndex: number;
	skipNextSubmit: React.MutableRefObject<boolean>;
	setInput: (value: string) => void;
	setCursor: (value: number) => void;
	setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
	createCommandContext: (args: string[]) => CommandContext;
}

/**
 * Handler for command autocomplete mode
 *
 * Active when:
 * - Input starts with "/" (command prefix)
 * - There are filtered commands available
 * - Not in selection/pending mode
 *
 * Features:
 * - Arrow navigation through command list
 * - Tab to fill in autocomplete text
 * - Enter to execute command (output shown in UI, not saved to chat)
 * - Escape to cancel command mode
 */
export class CommandAutocompleteModeHandler extends BaseInputHandler {
	mode = InputMode.COMMAND_AUTOCOMPLETE;
	priority = 10; // Higher priority than normal mode

	private deps: CommandAutocompleteModeHandlerDeps;

	constructor(deps: CommandAutocompleteModeHandlerDeps) {
		super();
		this.deps = deps;
	}

	/**
	 * Check if handler should be active
	 * Active when there are filtered commands and not in pending input mode
	 */
	isActive(context: InputModeContext): boolean {
		// Must be in command autocomplete mode
		if (context.mode !== this.mode) {
			return false;
		}

		// Must have filtered commands available
		if (this.deps.filteredCommands.length === 0) {
			return false;
		}

		// Must not be in pending input mode (selection/text input)
		if (context.pendingInput) {
			return false;
		}

		return true;
	}

	/**
	 * Handle keyboard input for command autocomplete
	 */
	async handleInput(char: string, key: Key, _context: InputModeContext): Promise<boolean> {
		const {
			filteredCommands,
			selectedCommandIndex,
			skipNextSubmit,
			setInput,
			setCursor,
			setSelectedCommandIndex,
			createCommandContext,
		} = this.deps;

		// Arrow down - next command
		if (key.downArrow) {
			return this.handleArrowDown(() => {
				setSelectedCommandIndex((prev) =>
					prev < filteredCommands.length - 1 ? prev + 1 : prev,
				);
			});
		}

		// Arrow up - previous command
		if (key.upArrow) {
			return this.handleArrowUp(() => {
				setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : 0));
			});
		}

		// Tab - fill in autocomplete text only
		if (key.tab) {
			return this.handleTab(() => {
				const selected = filteredCommands[selectedCommandIndex];
				if (selected) {
					const hasArgs = selected.args && selected.args.length > 0;
					const completedText = hasArgs ? `${selected.label} ` : selected.label;

					setInput(completedText);
					setCursor(completedText.length); // Move cursor to end
					setSelectedCommandIndex(0);
				}
			});
		}

		// Enter - execute autocomplete selection
		if (key.return) {
			return this.handleEnter(async () => {
				const selected = filteredCommands[selectedCommandIndex];
				if (selected) {
					// Prevent TextInput's onSubmit from also executing
					skipNextSubmit.current = true;

					// Clear input immediately before execution
					setInput("");
					setSelectedCommandIndex(0);

					// Execute command
					// Command will handle its own display via context.setInputComponent()
					await selected.execute(createCommandContext([]));
				}
			});
		}

		// Escape - cancel command mode
		if (key.escape) {
			return this.handleEscape(() => {
				setInput("");
				setSelectedCommandIndex(0);
			});
		}

		return false; // Not handled
	}
}
