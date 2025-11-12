/**
 * File Navigation Mode Handler
 *
 * Handles file autocomplete navigation (@-mention files)
 * Migrated from useFileNavigation hook
 */

import type { Key } from "ink";
import type React from "react";
import { InputMode, type InputModeContext } from "../types.js";
import { BaseInputHandler } from "./BaseHandler.js";

export interface FileNavigationModeHandlerDeps {
	filteredFileInfo: {
		hasAt: boolean;
		files: Array<{ path: string; relativePath: string; size: number }>;
		query: string;
		atIndex: number;
	};
	selectedFileIndex: number;
	currentSession: any;
	input: string;
	setInput: (value: string) => void;
	setCursor: (value: number) => void;
	setSelectedFileIndex: React.Dispatch<React.SetStateAction<number>>;
	addAttachment: (attachment: { path: string; relativePath: string; size?: number }) => void;
	setAttachmentTokenCount: (path: string, count: number) => void;
}

/**
 * Handler for file navigation mode
 *
 * Active when:
 * - Input contains "@" (file mention trigger)
 * - There are filtered files available
 * - Not in selection/text input mode
 *
 * Features:
 * - Arrow navigation through file list
 * - Tab/Enter to select file and add to attachments
 * - Token count calculation for selected files
 */
export class FileNavigationModeHandler extends BaseInputHandler {
	mode = InputMode.FILE_NAVIGATION;
	priority = 12; // High priority for file mentions

	private deps: FileNavigationModeHandlerDeps;

	constructor(deps: FileNavigationModeHandlerDeps) {
		super();
		this.deps = deps;
	}

	/**
	 * Check if handler should be active
	 * Active when file autocomplete is triggered and not in pending input mode
	 */
	isActive(context: InputModeContext): boolean {
		// Must be in file navigation mode
		if (context.mode !== this.mode) {
			return false;
		}

		// Must have @ symbol and filtered files
		if (!this.deps.filteredFileInfo.hasAt || this.deps.filteredFileInfo.files.length === 0) {
			return false;
		}

		// Must not be in pending input mode (selection takes precedence)
		if (context.pendingInput) {
			return false;
		}

		return true;
	}

	/**
	 * Handle keyboard input for file navigation
	 */
	handleInput(char: string, key: Key, _context: InputModeContext): boolean {
		const {
			filteredFileInfo,
			selectedFileIndex,
			currentSession,
			input,
			setInput,
			setCursor,
			setSelectedFileIndex,
			addAttachment,
			setAttachmentTokenCount,
		} = this.deps;

		// Arrow down - next file
		if (key.downArrow) {
			return this.handleArrowDown(() => {
				setSelectedFileIndex((prev) =>
					prev < filteredFileInfo.files.length - 1 ? prev + 1 : prev,
				);
			});
		}

		// Arrow up - previous file
		if (key.upArrow) {
			return this.handleArrowUp(() => {
				setSelectedFileIndex((prev) => (prev > 0 ? prev - 1 : 0));
			});
		}

		// Tab or Enter - select file and add to attachments
		if (key.tab || key.return) {
			const selected = filteredFileInfo.files[selectedFileIndex];
			if (selected) {
				// Add to pending attachments
				addAttachment({
					path: selected.path,
					relativePath: selected.relativePath,
					size: selected.size,
				});

				// Calculate token count for this file using model-aware BPE tokenizer
				// ARCHITECTURE: Server reads file and counts tokens
				(async () => {
					try {
						const { getTRPCClient } = await import("../../../trpc-provider.js");
						const client = getTRPCClient();
						const result = await client.config.countFileTokens.query({
							filePath: selected.path,
							model: currentSession?.model,
						});
						if (result.success) {
							setAttachmentTokenCount(selected.path, result.count);
						} else {
							console.error("Failed to count tokens:", result.error);
						}
					} catch (error) {
						console.error("Failed to count tokens:", error);
					}
				})();

				// Replace @query with the file name, preserving text after the query
				const beforeAt = input.slice(0, filteredFileInfo.atIndex);
				const afterQuery = input.slice(
					filteredFileInfo.atIndex + 1 + filteredFileInfo.query.length,
				);
				const newInput = `${beforeAt}@${selected.relativePath} ${afterQuery}`;
				const newCursorPos = beforeAt.length + selected.relativePath.length + 2; // +2 for @ and space

				setInput(newInput);
				setCursor(newCursorPos); // Position cursor right after the inserted file name + space
				setSelectedFileIndex(0);
			}

			return true; // Consumed
		}

		return false; // Not handled
	}
}
