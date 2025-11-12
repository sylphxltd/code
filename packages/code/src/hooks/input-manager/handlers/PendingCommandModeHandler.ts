/**
 * Pending Command Mode Handler
 *
 * Handles pending command option selection (e.g., model selection, provider selection)
 * Migrated from usePendingCommand hook
 */

import type { Key } from "ink";
import type React from "react";
import { InputMode, type InputModeContext } from "../types.js";
import { BaseInputHandler } from "./BaseHandler.js";
import type { Command, CommandContext } from "../../../commands/types.js";

export interface PendingCommandModeHandlerDeps {
	pendingCommand: { command: Command; currentInput: string } | null;
	cachedOptions: Map<string, Array<{ id: string; name: string }>>;
	selectedCommandIndex: number;
	currentSessionId: string | null;
	setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
	setPendingCommand: (value: { command: Command; currentInput: string } | null) => void;
	createCommandContext: (args: string[]) => CommandContext;
	addMessage: (params: any) => Promise<string>;
}

/**
 * Handler for pending command mode
 *
 * Active when:
 * - There is a pending command waiting for option selection
 * - Not in selection/text input mode
 *
 * Features:
 * - Arrow navigation through options
 * - Enter to select option and execute command
 * - Escape to cancel command
 *
 * Used for commands like /model, /provider that require user to select from options
 */
export class PendingCommandModeHandler extends BaseInputHandler {
	mode = InputMode.PENDING_COMMAND;
	priority = 15; // Higher priority - pending commands should take precedence

	private deps: PendingCommandModeHandlerDeps;

	constructor(deps: PendingCommandModeHandlerDeps) {
		super();
		this.deps = deps;
	}

	/**
	 * Check if handler should be active
	 * Active when there's a pending command and not in selection mode
	 */
	isActive(context: InputModeContext): boolean {
		// Must be in pending command mode
		if (context.mode !== this.mode) {
			return false;
		}

		// Must have a pending command
		if (!this.deps.pendingCommand) {
			return false;
		}

		// Must not be in pending input mode (selection takes precedence)
		if (context.pendingInput) {
			return false;
		}

		return true;
	}

	/**
	 * Handle keyboard input for pending command
	 */
	async handleInput(char: string, key: Key, _context: InputModeContext): Promise<boolean> {
		const {
			pendingCommand,
			cachedOptions,
			selectedCommandIndex,
			currentSessionId,
			setSelectedCommandIndex,
			setPendingCommand,
			createCommandContext,
			addMessage,
		} = this.deps;

		if (!pendingCommand) {
			return false;
		}

		// Get options for the pending command's first arg
		const firstArg = pendingCommand.command.args?.[0];
		const cacheKey = firstArg ? `${pendingCommand.command.id}:${firstArg.name}` : "";
		const options = cacheKey ? cachedOptions.get(cacheKey) || [] : [];
		const maxIndex = options.length - 1;

		// Arrow down - next option
		if (key.downArrow) {
			return this.handleArrowDown(() => {
				setSelectedCommandIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
			});
		}

		// Arrow up - previous option
		if (key.upArrow) {
			return this.handleArrowUp(() => {
				setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : 0));
			});
		}

		// Enter - select option
		if (key.return) {
			return this.handleEnter(async () => {
				const selectedOption = options[selectedCommandIndex];
				if (selectedOption) {
					const response = await pendingCommand.command.execute(
						createCommandContext([selectedOption.id]),
					);

					if (currentSessionId && response) {
						await addMessage({
							sessionId: currentSessionId,
							role: "assistant",
							content: response,
						});
					}

					setPendingCommand(null);
					setSelectedCommandIndex(0);
				}
			});
		}

		// Escape - cancel
		if (key.escape) {
			return this.handleEscape(async () => {
				if (currentSessionId) {
					await addMessage({
						sessionId: currentSessionId,
						role: "assistant",
						content: "Command cancelled",
					});
				}

				setPendingCommand(null);
				setSelectedCommandIndex(0);
			});
		}

		return false; // Not handled
	}
}
