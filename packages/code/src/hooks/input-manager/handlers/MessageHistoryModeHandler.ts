/**
 * Message History Mode Handler
 *
 * Handles bash-like message history navigation with up/down arrows
 * Migrated from useMessageHistoryNavigation hook
 */

import type { Key } from "ink";
import type React from "react";
import { InputMode, type InputModeContext } from "../types.js";
import { BaseInputHandler } from "./BaseHandler.js";
import type { FilteredFile, FilteredCommand } from "@sylphx/code-client";

export interface MessageHistoryModeHandlerDeps {
	messageHistory: string[];
	historyIndex: number;
	tempInput: string;
	input: string;
	isStreaming: boolean;
	inputComponent: React.ReactNode | null;
	filteredCommands: FilteredCommand[];
	filteredFileInfo: FilteredFile | null;
	setInput: (value: string) => void;
	setCursor: (value: number) => void;
	setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
	setTempInput: (value: string) => void;
}

/**
 * Handler for message history navigation mode
 *
 * Active when:
 * - In NORMAL mode (no selection/pending/autocomplete)
 * - Not streaming
 * - No autocomplete showing (no filtered commands or files)
 * - No custom inputComponent active
 *
 * Features:
 * - Up arrow: navigate to previous message in history
 * - Down arrow: navigate to next message in history
 * - Any other key: exit history browsing mode
 */
export class MessageHistoryModeHandler extends BaseInputHandler {
	mode = InputMode.NORMAL;
	priority = 5; // Lower than autocomplete (10), higher than default (0)

	private deps: MessageHistoryModeHandlerDeps;

	constructor(deps: MessageHistoryModeHandlerDeps) {
		super();
		this.deps = deps;
	}

	/**
	 * Check if handler should be active
	 * Active only when in normal mode with no autocomplete or other UI
	 */
	isActive(context: InputModeContext): boolean {
		// Must be in NORMAL mode
		if (context.mode !== this.mode) {
			return false;
		}

		const {
			isStreaming,
			inputComponent,
			filteredCommands,
			filteredFileInfo,
		} = this.deps;

		// Don't handle when streaming
		if (isStreaming) {
			return false;
		}

		// Don't handle when custom inputComponent is active (e.g. ProviderManagement)
		if (inputComponent) {
			return false;
		}

		// Don't handle when autocomplete is showing
		const hasAutocomplete =
			filteredCommands.length > 0 || (filteredFileInfo && filteredFileInfo.files.length > 0);

		if (hasAutocomplete) {
			return false;
		}

		return true;
	}

	/**
	 * Handle keyboard input for message history navigation
	 */
	async handleInput(_char: string, key: Key, _context: InputModeContext): Promise<boolean> {
		const {
			messageHistory,
			historyIndex,
			tempInput,
			input,
			setInput,
			setCursor,
			setHistoryIndex,
			setTempInput,
		} = this.deps;

		// Arrow up - navigate to previous message in history
		if (key.upArrow) {
			return this.handleArrowUp(() => {
				if (messageHistory.length === 0) return;

				if (historyIndex === -1) {
					// First time going up - save current input
					setTempInput(input);
					const newIndex = messageHistory.length - 1;
					setHistoryIndex(newIndex);
					setInput(messageHistory[newIndex]);
					setCursor(0);
				} else if (historyIndex > 0) {
					// Navigate up in history
					const newIndex = historyIndex - 1;
					setHistoryIndex(newIndex);
					setInput(messageHistory[newIndex]);
					setCursor(0);
				}
			});
		}

		// Arrow down - navigate to next message in history
		if (key.downArrow) {
			return this.handleArrowDown(() => {
				if (historyIndex === -1) return;

				if (historyIndex === messageHistory.length - 1) {
					// Reached end - restore original input
					setHistoryIndex(-1);
					setInput(tempInput);
					setCursor(0);
				} else {
					// Navigate down in history
					const newIndex = historyIndex + 1;
					setHistoryIndex(newIndex);
					setInput(messageHistory[newIndex]);
					setCursor(0);
				}
			});
		}

		// Exit history browsing mode on any other key
		// Don't consume the event - let other handlers process it
		if (historyIndex !== -1) {
			setHistoryIndex(-1);
			setTempInput("");
		}

		return false; // Not consumed - let other handlers process
	}
}
