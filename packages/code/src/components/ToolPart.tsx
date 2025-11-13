/**
 * ToolPart Component
 * Handles rendering of tool message parts with config-based display settings
 */

import React, { useState, useEffect } from "react";
import { Box } from "ink";
import { loadAIConfig, shouldShowToolDetails } from "@sylphx/code-core";
import { ToolDisplay } from "./ToolDisplay.js";

interface ToolPartProps {
	name: string;
	status: "active" | "completed" | "error" | "abort";
	duration?: number;
	startTime?: number;
	input?: unknown;
	result?: unknown;
	error?: string;
}

export const ToolPart = React.memo(function ToolPart(props: ToolPartProps) {
	const { name, status, duration, startTime, input, result, error } = props;

	// Load tool display settings from config
	const [toolDisplaySettings, setToolDisplaySettings] = useState<Record<string, boolean>>({});

	useEffect(() => {
		loadAIConfig().then((result) => {
			if (result.success) {
				setToolDisplaySettings(result.data.toolDisplaySettings || {});
			}
		});
	}, []);

	// Map status to ToolDisplay status
	const toolStatus: "running" | "completed" | "failed" =
		status === "active" ? "running" : status === "error" || status === "abort" ? "failed" : "completed";

	// Compute showDetails from config
	const showDetails = shouldShowToolDetails(name, toolDisplaySettings);

	// Build props conditionally
	const toolProps: {
		name: string;
		status: "running" | "completed" | "failed";
		duration?: number;
		startTime?: number;
		input?: unknown;
		result?: unknown;
		error?: string;
		showDetails?: boolean;
	} = { name, status: toolStatus, showDetails };

	// Pass optional properties
	if (duration !== undefined) toolProps.duration = duration;
	if (startTime !== undefined) toolProps.startTime = startTime;
	if (input !== undefined) toolProps.input = input;
	if (result !== undefined) toolProps.result = result;
	if (error !== undefined) toolProps.error = error;

	return (
		<Box marginLeft={2} marginBottom={1}>
			<ToolDisplay {...toolProps} />
		</Box>
	);
});
