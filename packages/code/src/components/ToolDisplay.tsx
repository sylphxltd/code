/**
 * Tool Display Component
 * Simply renders the registered component for a tool
 */

import { getToolComponent, type ToolDisplayProps, useElapsedTime } from "@sylphx/code-client";
import { Box, Text } from "ink";
import React from "react";
import Spinner from "./Spinner.js";

/**
 * Fallback display for unregistered tools (e.g., MCP tools)
 * Provides smart summary + details display like built-in tools
 */
function FallbackToolDisplay(props: ToolDisplayProps) {
	const { name, status, duration, startTime, input, result, error, showDetails = true } = props;

	// Calculate real-time elapsed time for running tools
	const { display: durationDisplay } = useElapsedTime({
		startTime,
		duration,
		isRunning: status === "running",
	});

	// Format input for display
	const formattedInput = React.useMemo(() => {
		if (!input || typeof input !== "object") return "";
		const entries = Object.entries(input);
		if (entries.length === 0) return "";
		// Show first key-value pair as preview
		const [key, value] = entries[0];
		const valueStr = typeof value === "string" ? value : JSON.stringify(value);
		return `${key}: ${valueStr.length > 40 ? valueStr.slice(0, 40) + "..." : valueStr}`;
	}, [input]);

	// Format result for display
	const formattedResult = React.useMemo(() => {
		if (!result) return { summary: undefined, lines: [] };

		// Try to extract meaningful summary
		let summary: string | undefined;
		if (typeof result === "object" && result !== null) {
			// Check for common summary fields
			if ("message" in result) summary = String((result as any).message);
			else if ("summary" in result) summary = String((result as any).summary);
			else if ("content" in result && typeof (result as any).content === "string") {
				const content = String((result as any).content);
				summary = content.length > 100 ? `${content.slice(0, 100)}...` : content;
			}
		}

		// Convert result to lines
		const resultStr =
			typeof result === "string"
				? result
				: typeof result === "object"
					? JSON.stringify(result, null, 2)
					: String(result);
		const lines = resultStr.split("\n").filter((line) => line.trim());

		return { summary, lines };
	}, [result]);

	// Use config-based showDetails
	// Always show details for errors
	const shouldShowDetails = status === "failed" || showDetails;

	return (
		<Box flexDirection="column">
			{/* Tool header */}
			<Box>
				{status === "running" && (
					<>
						<Spinner color="yellow" />
						<Text> </Text>
					</>
				)}
				{status === "completed" && <Text color="green">✓ </Text>}
				{status === "failed" && <Text color="red">✗ </Text>}
				<Text bold>{name}</Text>
				{formattedInput && (
					<>
						<Text> </Text>
						<Text>{formattedInput}</Text>
					</>
				)}
				{durationDisplay && (status === "completed" || status === "running") && (
					<Text dimColor> {durationDisplay}</Text>
				)}
			</Box>

			{/* Results */}
			{status === "completed" && (
				<Box flexDirection="column" marginLeft={2}>
					{/* Summary */}
					{formattedResult.summary && <Text dimColor>{formattedResult.summary}</Text>}
					{/* Details (smart auto-collapse) */}
					{shouldShowDetails && formattedResult.lines.length > 0 && (
						<Box flexDirection="column" marginTop={formattedResult.summary ? 1 : 0}>
							{formattedResult.lines.slice(0, 20).map((line, i) => (
								<Text key={i} dimColor>
									{line}
								</Text>
							))}
							{formattedResult.lines.length > 20 && (
								<Text dimColor>... {formattedResult.lines.length - 20} more lines</Text>
							)}
						</Box>
					)}
				</Box>
			)}

			{/* Errors */}
			{status === "failed" && error && (
				<Box marginLeft={2}>
					<Text color="red">{error}</Text>
				</Box>
			)}
		</Box>
	);
}

/**
 * Main ToolDisplay component
 * Uses registered component or falls back to basic display
 */
export function ToolDisplay(props: ToolDisplayProps) {
	const Component = getToolComponent(props.name);

	if (!Component) {
		return <FallbackToolDisplay {...props} />;
	}

	return <Component {...props} />;
}
