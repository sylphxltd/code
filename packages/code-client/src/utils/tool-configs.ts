/**
 * Tool Display Configurations
 * Single source of truth for all tool display logic
 *
 * Two ways to configure tool display:
 * 1. Formatter config (simple): displayName + formatArgs + formatResult
 * 2. Custom component (advanced): complete control over rendering
 */

import type { InputFormatter, ResultFormatter } from "@sylphx/code-core";
import {
	truncateString,
	getRelativePath,
	isDefaultCwd,
	pluralize,
	formatDiffLine,
} from "@sylphx/code-core";
import { createDefaultToolDisplay } from "../components/DefaultToolDisplay.js";
import type { ToolDisplayProps, ToolConfig } from "../types/tool.types.js";

// Re-export types for backward compatibility
export type { ToolDisplayProps, ToolConfig } from "../types/tool.types.js";

/**
 * Helper to convert result to lines
 */
const resultToLines = (result: unknown): string[] => {
	if (result === null || result === undefined) return [];

	const resultStr =
		typeof result === "string"
			? result
			: typeof result === "object"
				? JSON.stringify(result, null, 2)
				: String(result);

	return resultStr.split("\n").filter((line) => line.trim());
};

/**
 * Tool configurations registry
 * Add new tools here - single source of truth
 *
 * Examples:
 * - Default display: createDefaultToolDisplay('Name', formatArgs, formatResult)
 * - Custom component: MyCustomComponent
 */
export const toolConfigs = {
	// Ask tool
	ask: createDefaultToolDisplay(
		"Ask",
		(args) => (args?.question ? truncateString(String(args.question), 80) : ""),
		(result) => ({
			lines: resultToLines(result),
			summary: undefined,
		}),
	),

	// Read tool
	read: createDefaultToolDisplay(
		"Read",
		(input) => (input?.file_path ? getRelativePath(String(input.file_path)) : ""),
		(result) => {
			// Handle undefined/null results
			if (result === null || result === undefined) {
				return {
					lines: [],
					summary: "Read 0 lines",
				};
			}

			const content =
				typeof result === "object" && result !== null && "content" in result
					? String((result as any).content)
					: typeof result === "string"
						? result
						: JSON.stringify(result);

			const lines = content.split("\n").filter((line) => line.trim());
			const lineCount = lines.length;
			const fileName = typeof result === "object" && "path" in result
				? String((result as any).path).split("/").pop()
				: "";

			// Smart preview: show ~20 lines, or first/last 10 if too long
			let displayLines: string[];
			if (lineCount <= 20) {
				displayLines = lines;
			} else {
				displayLines = [
					...lines.slice(0, 10),
					`... ${lineCount - 20} ${pluralize(lineCount - 20, "line")} omitted ...`,
					...lines.slice(-10),
				];
			}

			// Format with diff-style line numbers (space marker for context)
			const formattedLines = displayLines.map((line, i) => {
				if (line.includes("...") && line.includes("omitted")) {
					return `       ${line}`;
				}
				const lineNum = i > 10 && lineCount > 20 ? lineCount - (displayLines.length - i - 1) : i + 1;
				return formatDiffLine(lineNum, " ", line);
			});

			return {
				lines: formattedLines,
				summary: fileName
					? `Read ${fileName} (${lineCount} ${pluralize(lineCount, "line")})`
					: `Read ${lineCount} ${pluralize(lineCount, "line")}`,
			};
		},
	),

	// Write tool
	write: createDefaultToolDisplay(
		"Write",
		(input) => (input?.file_path ? getRelativePath(String(input.file_path)) : ""),
		(result) => {
			if (typeof result !== "object" || result === null) {
				return { lines: resultToLines(result) };
			}

			const res = result as any;
			const { fileName, lineCount } = res;

			let displayLines: string[];

			if ("preview" in res) {
				// Short file (<= 10 lines), show all
				displayLines = res.preview;
			} else if ("previewFirst" in res && "previewLast" in res) {
				// Long file (> 10 lines), show first 5, omitted message, last 5
				const omittedCount = lineCount - 10;
				displayLines = [
					...res.previewFirst,
					`... ${omittedCount} ${pluralize(omittedCount, "line")} omitted ...`,
					...res.previewLast,
				];
			} else {
				// Fallback to default
				return { lines: resultToLines(result) };
			}

			// Add line numbers using shared diff formatter (all lines marked as additions)
			const formattedLines = displayLines.map((line, i) => {
				// For long files with omitted section, handle the omitted message specially
				if (line.startsWith("...") && line.includes("omitted")) {
					return `       ${line}`; // Indent to align with content
				}
				// Calculate actual line number (for truncated files, second half starts at lineCount - 4)
				const lineNum =
					"previewFirst" in res && i > res.previewFirst.length
						? lineCount - (displayLines.length - i - 1)
						: i + 1;
				return formatDiffLine(lineNum, "+", line);
			});

			return {
				lines: formattedLines,
				summary: `Wrote ${fileName} (${lineCount} ${pluralize(lineCount, "line")})`,
			};
		},
	),

	// Edit tool
	edit: createDefaultToolDisplay(
		"Update",
		(input) => (input?.file_path ? getRelativePath(String(input.file_path)) : ""),
		(result) => {
			if (typeof result !== "object" || result === null || !("diff" in result)) {
				return { lines: resultToLines(result) };
			}

			const { diff, path, old_string, new_string } = result as any;
			const fileName = path ? path.split("/").pop() : "";
			const additions = new_string.split("\n").length;
			const removals = old_string.split("\n").length;

			return {
				lines: diff,
				summary: `Updated ${fileName} with ${additions} ${pluralize(additions, "addition")} and ${removals} ${pluralize(removals, "removal")}`,
			};
		},
	),

	// Bash tool
	bash: createDefaultToolDisplay(
		"Bash",
		(input) => {
			const command = input?.command ? String(input.command) : "";
			const cwd = input?.cwd ? String(input.cwd) : "";
			const runInBackground = input?.run_in_background;

			let display = truncateString(command, 80);

			if (runInBackground) {
				display += " [background]";
			}

			if (cwd && cwd !== process.cwd()) {
				display += ` [in ${getRelativePath(cwd)}]`;
			}

			return display;
		},
		(result) => {
			// Background mode
			if (
				typeof result === "object" &&
				result !== null &&
				"mode" in result &&
				(result as any).mode === "background"
			) {
				const { bash_id, message } = result as any;
				return {
					lines: [`bash_id: ${bash_id}`],
					summary: message,
				};
			}

			// Foreground mode
			if (typeof result === "object" && result !== null && "stdout" in result) {
				const { stdout, stderr, exitCode } = result as any;
				const output = stderr && exitCode !== 0 ? stderr : stdout;
				const lines = output ? output.split("\n").filter((line: string) => line.trim()) : [];
				const lineCount = lines.length;

				// Format with line numbers and separator
				let formattedLines = lines.map((line, i) =>
					`${(i + 1).toString().padStart(6)} │ ${line}`
				);

				// Truncate to 20 lines
				if (lineCount > 20) {
					formattedLines = [
						...formattedLines.slice(0, 20),
						`       ... ${lineCount - 20} more ${pluralize(lineCount - 20, "line")}`,
					];
				}

				return {
					lines: formattedLines,
					summary: lineCount > 0
						? `Completed (exit: ${exitCode})`
						: "Command completed",
				};
			}

			const lines = resultToLines(result);
			return {
				lines,
				summary: lines.length > 0 ? undefined : "Command completed",
			};
		},
	),

	// Bash output tool
	"bash-output": createDefaultToolDisplay(
		"BashOutput",
		(input) => (input?.bash_id ? String(input.bash_id) : ""),
		(result) => {
			if (typeof result === "object" && result !== null && "bash_id" in result) {
				const { stdout, stderr, exitCode, isRunning, duration } = result as any;
				const output = stderr && exitCode !== 0 ? stderr : stdout;
				const lines = output ? output.split("\n").filter((line: string) => line.trim()) : [];
				const lineCount = lines.length;

				// Format with line numbers and separator
				let formattedLines = lines.map((line, i) =>
					`${(i + 1).toString().padStart(6)} │ ${line}`
				);

				// Truncate to 20 lines
				if (lineCount > 20) {
					formattedLines = [
						...formattedLines.slice(0, 20),
						`       ... ${lineCount - 20} more ${pluralize(lineCount - 20, "line")}`,
					];
				}

				const status = isRunning ? "Still running" : `Completed (exit: ${exitCode})`;
				const durationSec = Math.floor((duration as number) / 1000);

				return {
					lines: formattedLines,
					summary: `${status} - ${durationSec}s`,
				};
			}

			return { lines: resultToLines(result) };
		},
	),

	// Kill bash tool
	"kill-bash": createDefaultToolDisplay(
		"KillBash",
		(input) => (input?.bash_id ? String(input.bash_id) : ""),
		(result) => {
			if (typeof result === "object" && result !== null && "message" in result) {
				const { message } = result as any;
				return {
					lines: [],
					summary: message,
				};
			}

			return { lines: resultToLines(result) };
		},
	),

	// Grep tool
	grep: createDefaultToolDisplay(
		"Search Content",
		(input) => {
			const pattern = input?.pattern ? String(input.pattern) : "";
			const globPattern = input?.glob ? String(input.glob) : "";
			const type = input?.type ? String(input.type) : "";
			const path = input?.path ? String(input.path) : "";

			let display = `"${truncateString(pattern, 40)}"`;

			if (globPattern) {
				display += ` in ${globPattern}`;
			} else if (type) {
				display += ` [${type}]`;
			}

			if (path && !isDefaultCwd(path)) {
				display += ` [${getRelativePath(path)}]`;
			}

			return display;
		},
		(result) => {
			if (typeof result !== "object" || result === null) {
				return { lines: resultToLines(result) };
			}

			const res = result as any;

			// Content mode
			if ("matches" in res) {
				const matches = res.matches as Array<{
					file: string;
					line: number;
					content: string;
				}>;
				const matchCount = matches.length;

				// Format with aligned line numbers
				let lines = matches.map((m) =>
					`${getRelativePath(m.file)}:${m.line.toString().padStart(4)}: ${m.content}`
				);

				// Truncate to 15 results
				if (matchCount > 15) {
					lines = [
						...lines.slice(0, 15),
						`... ${matchCount - 15} more ${pluralize(matchCount - 15, "match", "matches")}`,
					];
				}

				return {
					lines,
					summary: `Found ${matchCount} ${pluralize(matchCount, "match", "matches")}`,
				};
			}

			// Files mode
			if ("files" in res) {
				const files = res.files as string[];
				const fileCount = files.length;

				// Truncate to 15 results
				let displayFiles = files.map(f => getRelativePath(f));
				if (fileCount > 15) {
					displayFiles = [
						...displayFiles.slice(0, 15),
						`... ${fileCount - 15} more ${pluralize(fileCount - 15, "file")}`,
					];
				}

				return {
					lines: displayFiles,
					summary: `Found ${fileCount} ${pluralize(fileCount, "file")}`,
				};
			}

			// Count mode
			if ("count" in res && !("matches" in res) && !("files" in res)) {
				return {
					lines: [],
					summary: `Found ${res.count} ${pluralize(res.count, "match", "matches")}`,
				};
			}

			return { lines: resultToLines(result) };
		},
	),

	// Glob tool
	glob: createDefaultToolDisplay(
		"Find Files",
		(input) => {
			const pattern = input?.pattern ? String(input.pattern) : "";
			const path = input?.path ? String(input.path) : "";

			return path && !isDefaultCwd(path) ? `${pattern} in ${getRelativePath(path)}` : pattern;
		},
		(result) => {
			if (typeof result === "object" && result !== null && "files" in result) {
				const files = (result as any).files as string[];
				const fileCount = files.length;

				// Truncate to 15 results
				let displayFiles = files.map(f => getRelativePath(f));
				if (fileCount > 15) {
					displayFiles = [
						...displayFiles.slice(0, 15),
						`... ${fileCount - 15} more ${pluralize(fileCount - 15, "file")}`,
					];
				}

				return {
					lines: displayFiles,
					summary: `Found ${fileCount} ${pluralize(fileCount, "file")}`,
				};
			}

			const lines = resultToLines(result);
			return {
				lines,
				summary: `Found ${lines.length} ${pluralize(lines.length, "file")}`,
			};
		},
	),

	// Update todos tool
	updateTodos: createDefaultToolDisplay(
		"Tasks",
		(input) => {
			const todos = input?.todos as any[] | undefined;
			if (!todos || todos.length === 0) return "";

			const adding = todos.filter((t) => !t.id).length;
			const updating = todos.filter((t) => t.id).length;

			const parts: string[] = [];
			if (adding > 0) parts.push(`${adding} new`);
			if (updating > 0) parts.push(`${updating} updated`);

			return parts.join(", ");
		},
		(result) => {
			if (typeof result === "object" && result !== null && "summary" in result) {
				const { summary, changes, total } = result as any;
				return {
					lines: changes || [],
					summary: `${summary} • ${total} active`,
				};
			}

			return { lines: resultToLines(result) };
		},
	),
} as const satisfies Record<string, ToolConfig>;

/**
 * Get tool display component
 */
export const getToolComponent = (toolName: string): ToolConfig | null => {
	return toolConfigs[toolName] || null;
};

/**
 * Check if tool has a registered display component
 */
export const isBuiltInTool = (toolName: string): boolean => {
	return toolName in toolConfigs;
};

/**
 * Register a tool display component
 *
 * Examples:
 * ```ts
 * // Using factory for default display
 * registerTool('myTool', createDefaultToolDisplay(
 *   'My Tool',
 *   (args) => args.foo,
 *   (result) => ({ lines: [String(result)] })
 * ));
 *
 * // Using custom component
 * registerTool('myTool', MyCustomComponent);
 * ```
 */
export const registerTool = (toolName: string, component: ToolConfig): void => {
	toolConfigs[toolName] = component;
};
