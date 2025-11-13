/**
 * Context Display Component
 * Shows context window usage and token breakdown in minimal, clean design
 */

import { Box, Text } from "ink";
import React from "react";

interface ContextDisplayProps {
	output: string;
	onComplete: () => void;
}

interface ParsedContextData {
	sessionNote: string;
	usedTokens: string;
	contextLimit: string;
	usedPercent: string;
	modelName: string;
	systemPromptTokens: string;
	systemPromptPercent: string;
	toolsTokens: string;
	toolsPercent: string;
	messagesTokens: string;
	messagesPercent: string;
	freeTokens: string;
	freePercent: string;
	bufferTokens: string;
	bufferPercent: string;
	systemPromptBreakdown: Array<{ name: string; tokens: string }>;
	tools: Array<{ name: string; tokens: string }>;
	toolCount: string;
}

function parseContextOutput(output: string): ParsedContextData | null {
	try {
		const lines = output.split("\n");
		const data: any = {};

		// Parse session note
		data.sessionNote = lines[0]?.includes("📌") ? lines[0] : "";

		// Parse context usage line
		const usageLine = lines.find((l) => l.includes("Context Usage:"));
		if (usageLine) {
			const match = usageLine.match(/(\d+\.?\d*[KM]?)\/(\d+\.?\d*[KM]?) tokens \((\d+\.?\d*)%\)/);
			if (match) {
				data.usedTokens = match[1];
				data.contextLimit = match[2];
				data.usedPercent = match[3];
			}
		}

		// Parse model
		const modelLine = lines.find((l) => l.includes("Model:"));
		if (modelLine) {
			data.modelName = modelLine.split("Model:")[1]?.trim() || "";
		}

		// Parse visual breakdown
		const systemLine = lines.find((l) => l.includes("System prompt:"));
		if (systemLine) {
			const match = systemLine.match(/System prompt:\s*(\d+\.?\d*[KM]?)\s*\((\d+\.?\d*)%\)/);
			if (match) {
				data.systemPromptTokens = match[1];
				data.systemPromptPercent = match[2];
			}
		}

		const toolsLine = lines.find((l) => l.includes("Tools:") && !l.includes("System Tools"));
		if (toolsLine) {
			const match = toolsLine.match(/Tools:\s*(\d+\.?\d*[KM]?)\s*\((\d+\.?\d*)%\)/);
			if (match) {
				data.toolsTokens = match[1];
				data.toolsPercent = match[2];
			}
		}

		const messagesLine = lines.find((l) => l.includes("Messages:"));
		if (messagesLine) {
			const match = messagesLine.match(/Messages:\s*(\d+\.?\d*[KM]?)\s*\((\d+\.?\d*)%\)/);
			if (match) {
				data.messagesTokens = match[1];
				data.messagesPercent = match[2];
			}
		}

		// Parse available space
		const freeLine = lines.find((l) => l.includes("• Free:"));
		if (freeLine) {
			const match = freeLine.match(/(\d+\.?\d*[KM]?) tokens \((\d+\.?\d*)%\)/);
			if (match) {
				data.freeTokens = match[1];
				data.freePercent = match[2];
			}
		}

		const bufferLine = lines.find((l) => l.includes("• Buffer:"));
		if (bufferLine) {
			const match = bufferLine.match(/(\d+\.?\d*[KM]?) tokens \((\d+\.?\d*)%\)/);
			if (match) {
				data.bufferTokens = match[1];
				data.bufferPercent = match[2];
			}
		}

		// Parse system prompt breakdown
		data.systemPromptBreakdown = [];
		let inBreakdown = false;
		for (const line of lines) {
			if (line.includes("System Prompt Breakdown:")) {
				inBreakdown = true;
				continue;
			}
			if (inBreakdown && line.includes("System Tools")) {
				break;
			}
			if (inBreakdown && line.trim() && line.includes(":")) {
				const match = line.match(/\s*(.+?):\s*(\d+\.?\d*[KM]?)\s*tokens/);
				if (match) {
					data.systemPromptBreakdown.push({ name: match[1].trim(), tokens: match[2] });
				}
			}
		}

		// Parse tools
		data.tools = [];
		let inTools = false;
		const toolCountMatch = output.match(/System Tools \((\d+) total\)/);
		data.toolCount = toolCountMatch ? toolCountMatch[1] : "0";

		for (const line of lines) {
			if (line.includes("System Tools")) {
				inTools = true;
				continue;
			}
			if (inTools && line.trim() && line.includes(":")) {
				const match = line.match(/\s*(.+?):\s*(\d+\.?\d*[KM]?)\s*tokens/);
				if (match) {
					data.tools.push({ name: match[1].trim(), tokens: match[2] });
				}
			}
		}

		return data;
	} catch (error) {
		return null;
	}
}

function createProgressBar(percent: number, width: number = 50): string {
	const filled = Math.round((percent / 100) * width);
	const empty = width - filled;
	return "█".repeat(filled) + "░".repeat(empty);
}

function createSeparator(width: number = 70): string {
	return "─".repeat(width);
}

export function ContextDisplay({ output, onComplete }: ContextDisplayProps) {
	const data = parseContextOutput(output);

	// If parsing fails, show raw output
	if (!data) {
		return (
			<Box flexDirection="column" paddingY={1} paddingX={2}>
				<Text>{output}</Text>
				<Box paddingTop={2}>
					<Text color="gray" dimColor>
						Press ESC to close
					</Text>
				</Box>
			</Box>
		);
	}

	const usedPercent = parseFloat(data.usedPercent);
	const systemPercent = parseFloat(data.systemPromptPercent);
	const toolsPercent = parseFloat(data.toolsPercent);
	const messagesPercent = parseFloat(data.messagesPercent);
	const freePercent = parseFloat(data.freePercent);
	const bufferPercent = parseFloat(data.bufferPercent);

	return (
		<Box flexDirection="column" paddingY={1} paddingX={2}>
			{/* Model name and session note */}
			<Box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
				<Text color="gray" dimColor>
					{data.modelName}
				</Text>
			</Box>

			{data.sessionNote && (
				<Box paddingBottom={1}>
					<Text color="yellow">{data.sessionNote}</Text>
				</Box>
			)}

			{/* Total Usage */}
			<Box flexDirection="column" paddingBottom={1}>
				<Box flexDirection="row" justifyContent="space-between">
					<Text dimColor>Total</Text>
					<Text>
						{data.usedTokens}/{data.contextLimit} ({data.usedPercent}%)
					</Text>
				</Box>
				<Text color="cyan">{createProgressBar(usedPercent, 60)}</Text>
			</Box>

			{/* Separator */}
			<Box paddingY={1}>
				<Text color="gray" dimColor>
					{createSeparator(60)}
				</Text>
			</Box>

			{/* Usage Breakdown */}
			<Box flexDirection="column">
				{/* System Prompt */}
				<Box flexDirection="column" paddingBottom={1}>
					<Box flexDirection="row" justifyContent="space-between">
						<Text color="blue">System Prompt</Text>
						<Text dimColor>
							{data.systemPromptTokens} ({data.systemPromptPercent}%)
						</Text>
					</Box>
					<Text color="blue" dimColor>
						{createProgressBar(systemPercent, 60)}
					</Text>
					{data.systemPromptBreakdown.length > 0 && (
						<Box paddingLeft={2} paddingTop={1} flexDirection="column">
							{data.systemPromptBreakdown.map((item, i) => (
								<Text key={i} dimColor>
									• {item.name}: {item.tokens}
								</Text>
							))}
						</Box>
					)}
				</Box>

				{/* Tools */}
				<Box flexDirection="column" paddingBottom={1}>
					<Box flexDirection="row" justifyContent="space-between">
						<Text color="green">Tools ({data.toolCount})</Text>
						<Text dimColor>
							{data.toolsTokens} ({data.toolsPercent}%)
						</Text>
					</Box>
					<Text color="green" dimColor>
						{createProgressBar(toolsPercent, 60)}
					</Text>
					{data.tools.length > 0 && (
						<Box paddingLeft={2} paddingTop={1} flexDirection="column">
							{data.tools.slice(0, 6).map((item, i) => (
								<Text key={i} dimColor>
									• {item.name}: {item.tokens}
								</Text>
							))}
							{data.tools.length > 6 && (
								<Text dimColor>• ...{data.tools.length - 6} more</Text>
							)}
						</Box>
					)}
				</Box>

				{/* Messages */}
				<Box flexDirection="column" paddingBottom={1}>
					<Box flexDirection="row" justifyContent="space-between">
						<Text color="yellow">Messages</Text>
						<Text dimColor>
							{data.messagesTokens} ({data.messagesPercent}%)
						</Text>
					</Box>
					<Text color="yellow" dimColor>
						{createProgressBar(messagesPercent, 60)}
					</Text>
				</Box>
			</Box>

			{/* Separator */}
			<Box paddingY={1}>
				<Text color="gray" dimColor>
					{createSeparator(60)}
				</Text>
			</Box>

			{/* Available Space */}
			<Box flexDirection="column">
				<Box flexDirection="column" paddingBottom={1}>
					<Box flexDirection="row" justifyContent="space-between">
						<Text color="green">Free Space</Text>
						<Text dimColor>
							{data.freeTokens} ({data.freePercent}%)
						</Text>
					</Box>
					<Text color="green" dimColor>
						{createProgressBar(freePercent, 60)}
					</Text>
				</Box>

				<Box flexDirection="column">
					<Box flexDirection="row" justifyContent="space-between">
						<Text color="gray">Reserved (auto-compact)</Text>
						<Text dimColor>
							{data.bufferTokens} ({data.bufferPercent}%)
						</Text>
					</Box>
					<Text dimColor>{createProgressBar(bufferPercent, 60)}</Text>
					<Box paddingLeft={2} paddingTop={1}>
						<Text dimColor>Triggers automatic compaction when reached</Text>
					</Box>
				</Box>
			</Box>

			{/* Footer */}
			<Box paddingTop={2}>
				<Text color="gray" dimColor>
					Press ESC to close
				</Text>
			</Box>
		</Box>
	);
}
