/**
 * Stream Event Handler Types
 * Shared types used across all event handlers
 */

import type { AIConfig } from "@sylphx/code-core";
import type React from "react";

/**
 * Context passed to all event handlers
 */
export interface EventHandlerContext {
	currentSessionId: string | null;
	updateSessionTitle: (sessionId: string, title: string) => void;
	setIsStreaming: (value: boolean) => void;
	setIsTitleStreaming: (value: boolean) => void;
	setStreamingTitle: React.Dispatch<React.SetStateAction<string>>;
	streamingMessageIdRef: React.MutableRefObject<string | null>;
	addLog: (message: string) => void;
	aiConfig: AIConfig | null;
	userMessage: string;
	notificationSettings: { notifyOnCompletion: boolean; notifyOnError: boolean };
}

/**
 * Event handler function type
 */
export type EventHandler = (event: any, context: EventHandlerContext) => void;
