/**
 * Context Display Component
 * Shows context window usage and token breakdown
 */

import { Box, Text } from "ink";
import React from "react";

interface ContextDisplayProps {
	output: string;
	onComplete: () => void;
}

export function ContextDisplay({ output, onComplete }: ContextDisplayProps) {
	return (
		<Box flexDirection="column" paddingY={1}>
			<Box borderStyle="round" borderColor="cyan" paddingX={1} paddingY={1}>
				<Box flexDirection="column">
					<Text color="cyan" bold>
						Context Usage
					</Text>
					<Box paddingTop={1}>
						<Text>{output}</Text>
					</Box>
					<Box paddingTop={1}>
						<Text color="gray" dimColor>
							Press ESC to close
						</Text>
					</Box>
				</Box>
			</Box>
		</Box>
	);
}
