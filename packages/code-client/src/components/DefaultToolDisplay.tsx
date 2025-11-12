/**
 * Default Tool Display Factory
 * Creates a tool display component with custom formatters
 * Generic - does not know about specific tools
 */

import React from "react";
import { Box, Text } from "ink";
import Spinner from "./Spinner.js";
import { useElapsedTime } from "@sylphx/code-client";
import type { InputFormatter, ResultFormatter } from "@sylphx/code-core";
import type { ToolDisplayProps } from "@sylphx/code-client";
import dJSON from "dirty-json";

/**
 * Parse partial/dirty JSON into an object with best-effort parsing
 * Handles incomplete JSON during streaming like `{"file_path": "/User` or `{"pattern":"test`
 */
function parsePartialJSON(jsonString: string): Record<string, unknown> {
	// Try standard JSON.parse first (fastest)
	try {
		return JSON.parse(jsonString);
	} catch {
		// Use dirty-json for partial/malformed JSON
		try {
			const parsed = dJSON.parse(jsonString);
			return typeof parsed === "object" && parsed !== null ? parsed : {};
		} catch {
			// Even dirty-json failed, return empty object
			return {};
		}
	}
}

interface StatusIndicatorProps {
	status: "running" | "completed" | "failed";
}

const StatusIndicator: React.FC<StatusIndicatorProps> = ({ status }) => {
	if (status === "running") {
		return (
			<>
				<Spinner color="#FFD700" />
				<Text> </Text>
			</>
		);
	}

	return status === "completed" ? <Text color="#00FF88">✓ </Text> : <Text color="#FF3366">✗ </Text>;
};

interface ToolHeaderProps {
	statusIndicator: React.ReactNode;
	displayName: string;
	formattedArgs: string;
	durationDisplay?: string;
	status: "running" | "completed" | "failed";
}

const ToolHeader: React.FC<ToolHeaderProps> = ({
	statusIndicator,
	displayName,
	formattedArgs,
	durationDisplay,
	status,
}) => (
	<Box>
		{statusIndicator}
		<Text bold>{displayName}</Text>
		{formattedArgs && (
			<>
				<Text> </Text>
				<Text>{formattedArgs}</Text>
			</>
		)}
		{durationDisplay && (status === "completed" || status === "running") && (
			<Text dimColor> {durationDisplay}</Text>
		)}
	</Box>
);

interface ResultDisplayProps {
	status: "running" | "completed" | "failed";
	result: unknown;
	formattedResult: { lines: string[]; summary?: string };
	error?: string;
}

/**
 * Detect if a line is a diff line (starts with line number followed by +/-)
 * Format: "   123 - old line" or "   123 + new line" or "   123   context"
 */
function getDiffLineType(line: string): "added" | "removed" | "context" | null {
	// Check if line matches diff format (6 spaces for line number, then +/- or space)
	if (line.length > 7) {
		const marker = line[7]; // Character at position 7 (after 6-digit line number and space)
		if (marker === "+") return "added";
		if (marker === "-") return "removed";
		if (marker === " ") return "context";
	}
	return null;
}

const ResultDisplay: React.FC<ResultDisplayProps> = ({ status, formattedResult, error }) => {
	// Don't show anything for running tools
	if (status === "running") {
		return null;
	}

	if (status === "failed") {
		return (
			<Box marginLeft={2}>
				<Text color="#FF3366">{error || "Failed"}</Text>
			</Box>
		);
	}

	// For completed tools, show summary and/or lines
	if (status === "completed") {
		const hasLines = formattedResult.lines && formattedResult.lines.length > 0;
		const hasSummary = formattedResult.summary;

		// Show nothing if neither summary nor lines exist
		if (!hasLines && !hasSummary) {
			return null;
		}

		return (
			<Box flexDirection="column" marginLeft={2}>
				{/* Show summary if available */}
				{hasSummary && <Text dimColor>{formattedResult.summary}</Text>}
				{/* Show lines if available (limit to first 20 for diffs) */}
				{hasLines && (
					<Box flexDirection="column" marginTop={hasSummary ? 1 : 0}>
						{formattedResult.lines.slice(0, 20).map((line, i) => {
							const diffType = getDiffLineType(line);

							// Colorize diff lines
							if (diffType === "added") {
								return (
									<Text key={i} color="#00FF88">
										{line}
									</Text>
								);
							} else if (diffType === "removed") {
								return (
									<Text key={i} color="#FF3366">
										{line}
									</Text>
								);
							} else if (diffType === "context") {
								return (
									<Text key={i} dimColor>
										{line}
									</Text>
								);
							} else {
								// Regular line (not diff format)
								return <Text key={i}>{line}</Text>;
							}
						})}
						{formattedResult.lines.length > 20 && (
							<Text dimColor>
								... and {formattedResult.lines.length - 20} more lines
							</Text>
						)}
					</Box>
				)}
			</Box>
		);
	}

	return null;
};

/**
 * Factory function to create a default tool display component
 *
 * @param displayName - Tool display name
 * @param formatArgs - Function to format tool arguments
 * @param formatResult - Function to format tool results
 * @returns A React component for displaying the tool
 */
export function createDefaultToolDisplay(
	displayName: string,
	formatArgs: InputFormatter,
	formatResult: ResultFormatter,
): React.FC<ToolDisplayProps> {
	return function DefaultToolDisplay(props: ToolDisplayProps) {
		const { status, duration, input, result, error, startTime } = props;

		// Calculate real-time elapsed time for running tools
		const { display: durationDisplay } = useElapsedTime({
			startTime,
			duration,
			isRunning: status === "running",
		});

		// Handle streaming case: input might be a partial JSON string during streaming
		// Parse dirty JSON progressively to show partial input as it streams
		const formattedArgs = (() => {
			if (!input) return "";

			if (typeof input === "string") {
				// Dirty JSON - extract what we can and format it
				const partial = parsePartialJSON(input);
				return formatArgs(partial);
			}

			// Valid object
			return formatArgs(input as Record<string, unknown>);
		})();
		const formattedResult = formatResult(result);

		return (
			<Box flexDirection="column">
				<ToolHeader
					statusIndicator={<StatusIndicator status={status} />}
					displayName={displayName}
					formattedArgs={formattedArgs}
					durationDisplay={durationDisplay}
					status={status}
				/>
				<ResultDisplay
					status={status}
					result={result}
					formattedResult={formattedResult}
					error={error}
				/>
			</Box>
		);
	};
}
