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

	// Create visual bar chart with multiple segments
	const parseTokenValue = (tokenStr: string): number => {
		if (tokenStr.endsWith("K")) {
			return parseFloat(tokenStr) * 1000;
		} else if (tokenStr.endsWith("M")) {
			return parseFloat(tokenStr) * 1000000;
		}
		return parseFloat(tokenStr);
	};

	const totalTokens = parseTokenValue(data.contextLimit);
	const systemTokens = parseTokenValue(data.systemPromptTokens);
	const toolsTokens = parseTokenValue(data.toolsTokens);
	const messagesTokens = parseTokenValue(data.messagesTokens);
	const freeTokens = parseTokenValue(data.freeTokens);
	const reservedTokens = parseTokenValue(data.bufferTokens);

	// Create 25x4 grid visualization (100 blocks total, wider layout)
	const createGrid = (): string[] => {
		const totalBlocks = 100;
		const systemBlocks = Math.round((systemTokens / totalTokens) * totalBlocks);
		const toolsBlocks = Math.round((toolsTokens / totalTokens) * totalBlocks);
		const messagesBlocks = Math.round((messagesTokens / totalTokens) * totalBlocks);
		const reservedBlocks = Math.round((reservedTokens / totalTokens) * totalBlocks);
		const usedBlocks = systemBlocks + toolsBlocks + messagesBlocks;
		const freeBlocks = totalBlocks - usedBlocks - reservedBlocks;

		// Create array of blocks with type markers
		const blocks: string[] = [];
		for (let i = 0; i < systemBlocks; i++) blocks.push("S");
		for (let i = 0; i < toolsBlocks; i++) blocks.push("T");
		for (let i = 0; i < messagesBlocks; i++) blocks.push("M");
		for (let i = 0; i < Math.max(0, freeBlocks); i++) blocks.push("F");
		for (let i = 0; i < reservedBlocks; i++) blocks.push("R");

		// Split into 4 rows of 25 blocks each (wider layout)
		const rows: string[] = [];
		for (let i = 0; i < 4; i++) {
			const rowBlocks = blocks.slice(i * 25, (i + 1) * 25);
			// Pad with free space if needed
			while (rowBlocks.length < 25) rowBlocks.push("F");
			rows.push(rowBlocks.join(""));
		}
		return rows;
	};

	return (
		<Box flexDirection="column" paddingY={1} paddingX={2}>
			{/* Header - Model and Tokenizer */}
			<Box paddingBottom={1}>
				<Text>Model: </Text>
				<Text bold>{data.modelName}</Text>
				<Text dimColor> | Tokenizer: gpt-4 - {data.contextLimit} tokens total</Text>
			</Box>

			{/* Visual grid - 25x4 */}
			<Box flexDirection="column" paddingY={1}>
				{createGrid().map((row, i) => (
					<Box key={i}>
						{row.split("").map((block, j) => {
							if (block === "S") return <Text key={j} color="blue">█</Text>;
							if (block === "T") return <Text key={j} color="green">█</Text>;
							if (block === "M") return <Text key={j} color="yellow">█</Text>;
							if (block === "R") return <Text key={j} color="magenta">█</Text>;
							return <Text key={j} dimColor>░</Text>;
						})}
					</Box>
				))}
			</Box>

			{/* Used */}
			<Box flexDirection="column" gap={0}>
				<Box flexDirection="row">
					<Box width={18}>
						<Text>Used</Text>
					</Box>
					<Box width={16}>
						<Text>{data.usedTokens} tokens</Text>
					</Box>
					<Text dimColor> {data.usedPercent}%</Text>
				</Box>
				<Box flexDirection="row" paddingLeft={2}>
					<Box width={16}>
						<Text color="blue">System</Text>
					</Box>
					<Box width={16}>
						<Text color="blue">{data.systemPromptTokens} tokens</Text>
					</Box>
					<Text dimColor> {data.systemPromptPercent}%</Text>
				</Box>
				<Box flexDirection="row" paddingLeft={2}>
					<Box width={16}>
						<Text color="green">Tools</Text>
					</Box>
					<Box width={16}>
						<Text color="green">{data.toolsTokens} tokens</Text>
					</Box>
					<Text dimColor> {data.toolsPercent}%</Text>
				</Box>
				<Box flexDirection="row" paddingLeft={2}>
					<Box width={16}>
						<Text color="yellow">Messages</Text>
					</Box>
					<Box width={16}>
						<Text color="yellow">{data.messagesTokens} tokens</Text>
					</Box>
					<Text dimColor> {data.messagesPercent}%</Text>
				</Box>
			</Box>

			{/* Free */}
			<Box paddingTop={1}>
				<Box flexDirection="row">
					<Box width={18}>
						<Text>Free</Text>
					</Box>
					<Box width={16}>
						<Text>{data.freeTokens} tokens</Text>
					</Box>
					<Text dimColor> {data.freePercent}%</Text>
				</Box>
			</Box>

			{/* Reserved */}
			<Box paddingTop={1}>
				<Box flexDirection="row">
					<Box width={18}>
						<Text color="magenta">Reserved</Text>
					</Box>
					<Box width={16}>
						<Text color="magenta">{data.bufferTokens} tokens</Text>
					</Box>
					<Text dimColor> {data.bufferPercent}%</Text>
				</Box>
			</Box>

			{/* Tools breakdown */}
			{data.tools.length > 0 && (
				<>
					<Box paddingTop={2} paddingBottom={1}>
						<Text dimColor>Tools ({data.toolCount})</Text>
					</Box>
					{data.tools.slice(0, 6).map((tool, i) => (
						<Box key={i} flexDirection="row" paddingLeft={2}>
							<Box width={26}>
								<Text dimColor>{tool.name}</Text>
							</Box>
							<Text dimColor>{tool.tokens} tokens</Text>
						</Box>
					))}
					{data.tools.length > 6 && (
						<Box paddingLeft={2}>
							<Text dimColor>... {data.tools.length - 6} more</Text>
						</Box>
					)}
				</>
			)}

			{/* Footer */}
			<Box paddingTop={2}>
				<Text color="gray" dimColor>
					ESC to close
				</Text>
			</Box>
		</Box>
	);
}
