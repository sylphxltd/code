/**
 * File Navigation Hook
 * Handles file autocomplete navigation (@-mention files)
 *
 * Single Responsibility: File autocomplete navigation and selection
 */

import { useInput } from "ink";
import type React from "react";
import { USE_NEW_INPUT_MANAGER } from "../../config/features.js";

export interface UseFileNavigationOptions {
	input: string;
	pendingInput: any | null;
	filteredFileInfo: {
		hasAt: boolean;
		files: Array<{ path: string; relativePath: string; size: number }>;
		query: string;
		atIndex: number;
	};
	selectedFileIndex: number;
	currentSession: any;
	setInput: (value: string) => void;
	setCursor: (value: number) => void;
	setSelectedFileIndex: React.Dispatch<React.SetStateAction<number>>;
	addAttachment: (attachment: { path: string; relativePath: string; size?: number }) => void;
	setAttachmentTokenCount: (path: string, count: number) => void;
}

/**
 * Handles file autocomplete navigation
 * - Up/Down arrows → navigate file list
 * - Tab/Enter → select file and add to attachments
 * - Calculates token count for selected file
 */
export function useFileNavigation(options: UseFileNavigationOptions) {
	const {
		input,
		pendingInput,
		filteredFileInfo,
		selectedFileIndex,
		currentSession,
		setInput,
		setCursor,
		setSelectedFileIndex,
		addAttachment,
		setAttachmentTokenCount,
	} = options;

	useInput(
		(char, key) => {
			// Only handle when file autocomplete is active
			if (!filteredFileInfo.hasAt || filteredFileInfo.files.length === 0 || pendingInput) {
				return false;
			}

			// Arrow down - next file
			if (key.downArrow) {
				setSelectedFileIndex((prev) =>
					prev < filteredFileInfo.files.length - 1 ? prev + 1 : prev,
				);
				return true; // Consumed
			}

			// Arrow up - previous file
			if (key.upArrow) {
				setSelectedFileIndex((prev) => (prev > 0 ? prev - 1 : 0));
				return true; // Consumed
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
							const { getTRPCClient } = await import("../../trpc-provider.js");
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

			return false; // Not our concern
		},
		{
			// Only active when new input manager is disabled AND not in pending input mode
			isActive: !USE_NEW_INPUT_MANAGER && !pendingInput,
		},
	);
}
