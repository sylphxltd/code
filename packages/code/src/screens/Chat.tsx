/**
 * Chat Screen
 * AI chat interface with session management
 *
 * REFACTORED ARCHITECTURE:
 * - All state management extracted to custom hooks
 * - All streaming logic extracted to utility modules
 * - All command handling extracted to separate modules
 * - All autocomplete logic extracted to separate modules
 * - All UI rendering extracted to separate components
 */

import {
	useAIConfig,
	useAIConfigActions,
	useAskToolHandler,
	useChat,
	useCurrentSession,
	useEventStream,
	useFileAttachments,
	useProjectFiles,
	useSessionInitialization,
	useTokenCalculation,
	// Zen signals
	useCurrentScreen,
	useIsLoading,
	useUIError,
	useSelectedProvider,
	useSelectedModel,
	addDebugLog,
	navigateTo,
	updateProvider,
	setAIConfig as setAIConfigSignal,
	setSelectedProvider,
	setSelectedModel,
	// Session signals
	createSession,
	updateSessionModel,
	updateSessionProvider,
	updateSessionTitle,
	setCurrentSessionId,
	getCurrentSessionId,
	// Message signals
	addMessageAsync as addMessage,
} from "@sylphx/code-client";
import { Box, useInput } from "ink";
import { useCallback, useEffect, useMemo, useState } from "react";
import { commands } from "../commands/registry.js";
import StatusBar from "../components/StatusBar.js";
import TodoList from "../components/TodoList.js";
import { useCommandAutocomplete } from "./chat/autocomplete/commandAutocomplete.js";
import { useFileAutocomplete } from "./chat/autocomplete/fileAutocomplete.js";
// Autocomplete
import { createGetHintText } from "./chat/autocomplete/hintText.js";
import { useCommandOptionLoader } from "./chat/autocomplete/optionLoader.js";
// Command handling
import { createCommandContext } from "./chat/commands/commandContext.js";
import { createHandleSubmit } from "./chat/handlers/messageHandler.js";
import { useCommandState } from "./chat/hooks/useCommandState.js";
// Custom hooks
import { useCommandAutocompleteHandlers } from "./chat/hooks/useCommandAutocompleteHandlers.js";
import { useInputState } from "./chat/hooks/useInputState.js";
import { useMessageHistoryNavigation } from "./chat/hooks/useMessageHistoryNavigation.js";
import { useSelectionState } from "./chat/hooks/useSelectionState.js";
import { useStreamingState } from "./chat/hooks/useStreamingState.js";
// Keyboard hooks (local to code package to work with Ink)
import { useAbortHandler } from "../hooks/keyboard/useAbortHandler.js";
import { useKeyboardShortcuts } from "../hooks/keyboard/useKeyboardShortcuts.js";
import { useSelectionMode } from "../hooks/keyboard/useSelectionMode.js";
import { usePendingCommand } from "../hooks/keyboard/usePendingCommand.js";
import { useFileNavigation } from "../hooks/keyboard/useFileNavigation.js";
import { useCommandNavigation } from "../hooks/keyboard/useCommandNavigation.js";
// Streaming utilities
import { createSubscriptionSendUserMessageToAI } from "./chat/streaming/subscriptionAdapter.js";
import { handleStreamEvent } from "./chat/streaming/streamEventHandlers.js";

// Note: useMessageHistory not needed - using useInputState which includes history management

// UI components
import { ChatHeader } from "./chat/components/ChatHeader.js";
import { ChatMessages } from "./chat/components/ChatMessages.js";
import { InputSection } from "./chat/components/InputSection.js";
import { StatusIndicator } from "./chat/components/StatusIndicator.js";

interface ChatProps {
	commandFromPalette?: string | null;
}

// Default notification settings (temporarily hardcoded until signals domain is created)
const notificationSettings = {
	notifyOnCompletion: true,
	notifyOnError: true,
};

export default function Chat(_props: ChatProps) {
	// Zen signals
	const aiConfig = useAIConfig();
	const selectedProvider = useSelectedProvider();
	const selectedModel = useSelectedModel();

	// Pure UI Client: Use hook to fetch session data from server
	const sessionData = useCurrentSession();
	const currentSession = sessionData?.currentSession;
	const currentSessionId = sessionData?.currentSessionId;
	const sessionLoading = sessionData?.isLoading;

	// Helper function (memoized to prevent infinite re-renders)
	const addLog = useCallback((message: string) => {
		addDebugLog(message);
	}, []);

	// Custom hooks
	const { sendMessage } = useChat();
	const { saveConfig } = useAIConfigActions();
	const usedTokens = useTokenCalculation(currentSession || null);

	// LAZY SESSIONS: No auto-session creation on startup
	// Server will create session on-demand when user sends first message

	// State hooks
	const inputState = useInputState();
	const {
		input,
		setInput,
		normalizedCursor,
		setCursor,
		messageHistory,
		setMessageHistory,
		historyIndex,
		setHistoryIndex,
		tempInput,
		setTempInput,
	} = inputState;

	const streamingState = useStreamingState();
	const {
		isStreaming,
		isTitleStreaming,
		streamingTitle,
		abortControllerRef,
		streamingMessageIdRef,
		dbWriteTimerRef,
		pendingDbContentRef,
		setIsStreaming,
		setIsTitleStreaming,
		setStreamingTitle,
	} = streamingState;

	// Note: useAbortHandler is called inside useKeyboardNavigation, not here
	// Calling it twice causes conflicts with Ink's useInput system

	const selectionState = useSelectionState();
	const {
		pendingInput,
		inputResolver,
		selectionFilter,
		isFilterMode,
		multiSelectionPage,
		multiSelectionAnswers,
		multiSelectChoices,
		freeTextInput,
		isFreeTextMode,
		askQueueLength,
		setPendingInput,
		setSelectionFilter,
		setIsFilterMode,
		setMultiSelectionPage,
		setMultiSelectionAnswers,
		setMultiSelectChoices,
		setFreeTextInput,
		setIsFreeTextMode,
		setAskQueueLength,
	} = selectionState;

	const commandState = useCommandState();
	const {
		pendingCommand,
		skipNextSubmit,
		lastEscapeTime,
		cachedOptions,
		currentlyLoading,
		loadError,
		commandSessionRef,
		inputComponent,
		inputComponentTitle,
		setPendingCommand,
		setCachedOptions,
		setCurrentlyLoading,
		setLoadError,
		setInputComponent,
	} = commandState;

	// Local state not in hooks
	const [selectedFileIndex, setSelectedFileIndex] = useState(0);
	const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);
	const [showEscHint, setShowEscHint] = useState(false);

	// Helper function to get AI config
	const getAIConfig = () => aiConfig;

	// File attachment hook
	const {
		pendingAttachments,
		attachmentTokens,
		validTags,
		addAttachment,
		clearAttachments,
		setAttachmentTokenCount,
	} = useFileAttachments(input);

	const { projectFiles, filesLoading } = useProjectFiles();

	// Ask tool handler
	useAskToolHandler({
		setPendingInput,
		setMultiSelectionPage,
		setMultiSelectionAnswers,
		setSelectionFilter,
		setSelectedCommandIndex,
		setAskQueueLength,
		inputResolver,
		addDebugLog,
	});

	// Build context params for event stream callbacks
	const eventContextParams = useMemo(
		() => ({
			updateSessionTitle,
			setIsStreaming,
			setIsTitleStreaming,
			setStreamingTitle,
			streamingMessageIdRef,
			addLog,
			aiConfig,
			notificationSettings,
		}),
		[
			updateSessionTitle,
			setIsStreaming,
			setIsTitleStreaming,
			setStreamingTitle,
			streamingMessageIdRef,
			addLog,
			aiConfig,
			notificationSettings,
		],
	);

	// Multi-client message sync: Subscribe to session:{id} for messages from other clients
	// Filters out own streaming messages by checking streamingMessageIdRef
	// DISABLED: TUI is single-client, no need for multi-client sync callbacks
	// ENABLED: Title streaming callbacks (independent from AI response stream)
	const eventStreamCallbacks = useMemo(
		() => ({
			// ENABLED: Session lifecycle events (for lazy session creation)
			onSessionCreated: (sessionId: string, provider: string, model: string) => {
				handleStreamEvent(
					{ type: "session-created", sessionId, provider, model },
					eventContextParams,
				);
			},

			// ENABLED: Title streaming (independent channel, no loop issues)
			onSessionTitleStart: (sessionId: string) => {
				const currentSessionId = getCurrentSessionId();
				if (sessionId === currentSessionId) {
					setIsTitleStreaming(true);
					setStreamingTitle("");
				}
			},
			onSessionTitleDelta: (sessionId: string, text: string) => {
				const currentSessionId = getCurrentSessionId();
				if (sessionId === currentSessionId) {
					setStreamingTitle((prev) => prev + text);
				}
			},
			onSessionTitleComplete: (sessionId: string, title: string) => {
				const currentSessionId = getCurrentSessionId();
				if (sessionId === currentSessionId) {
					setIsTitleStreaming(false);
					setStreamingTitle("");
				}
			},

			// Message streaming callbacks - unified event stream path
			// All events go through handleStreamEvent (no dual-path complexity)
			onAssistantMessageCreated: (messageId: string) => {
				handleStreamEvent({ type: "assistant-message-created", messageId }, eventContextParams);
			},
			onSystemMessageCreated: (messageId: string, content: string) => {
				handleStreamEvent(
					{ type: "system-message-created", messageId, content },
					eventContextParams,
				);
			},

			// Step events
			onStepStart: (
				stepId: string,
				stepIndex: number,
				metadata: any,
				todoSnapshot: any[],
				systemMessages?: any[],
			) => {
				handleStreamEvent(
					{
						type: "step-start",
						stepId,
						stepIndex,
						metadata,
						todoSnapshot,
						systemMessages,
					},
					eventContextParams,
				);
			},
			onStepComplete: (stepId: string, usage: any, duration: number, finishReason: string) => {
				handleStreamEvent(
					{ type: "step-complete", stepId, usage, duration, finishReason },
					eventContextParams,
				);
			},

			// Text streaming
			onTextStart: () => {
				handleStreamEvent({ type: "text-start" }, eventContextParams);
			},
			onTextDelta: (text: string) => {
				handleStreamEvent({ type: "text-delta", text }, eventContextParams);
			},
			onTextEnd: () => {
				handleStreamEvent({ type: "text-end" }, eventContextParams);
			},

			// Reasoning streaming
			onReasoningStart: () => {
				handleStreamEvent({ type: "reasoning-start" }, eventContextParams);
			},
			onReasoningDelta: (text: string) => {
				handleStreamEvent({ type: "reasoning-delta", text }, eventContextParams);
			},
			onReasoningEnd: (duration: number) => {
				handleStreamEvent({ type: "reasoning-end", duration }, eventContextParams);
			},

			// Tool streaming
			onToolCall: (toolCallId: string, toolName: string, args: unknown) => {
				handleStreamEvent({ type: "tool-call", toolCallId, toolName, args }, eventContextParams);
			},
			onToolResult: (toolCallId: string, toolName: string, result: unknown, duration: number) => {
				handleStreamEvent(
					{ type: "tool-result", toolCallId, toolName, result, duration },
					eventContextParams,
				);
			},
			onToolError: (toolCallId: string, toolName: string, error: string, duration: number) => {
				handleStreamEvent(
					{ type: "tool-error", toolCallId, toolName, error, duration },
					eventContextParams,
				);
			},

			// Completion
			onComplete: (usage?: any, finishReason?: string) => {
				handleStreamEvent({ type: "complete", usage, finishReason }, eventContextParams);
			},

			// Error handling
			onError: (error: string) => {
				handleStreamEvent({ type: "error", error }, eventContextParams);
			},

			// Abort handling
			onAbort: () => {
				console.log("[Chat] onAbort callback fired");
				handleStreamEvent({ type: "abort" }, eventContextParams);
			},

			// Message status updates (UNIFIED STATUS CHANGE EVENT)
			onMessageStatusUpdated: (
				messageId: string,
				status: "active" | "completed" | "error" | "abort",
				usage?: any,
				finishReason?: string,
			) => {
				console.log("[Chat] onMessageStatusUpdated callback fired:", {
					messageId,
					status,
				});
				handleStreamEvent(
					{
						type: "message-status-updated",
						messageId,
						status,
						usage,
						finishReason,
					},
					eventContextParams,
				);
			},
		}),
		[eventContextParams],
	);

	// Event stream for multi-client sync and compact auto-response
	// IMPORTANT: replayLast > 0 required for compact auto-trigger
	// When compact creates new session and starts streaming, client switches session
	// By the time client subscribes, streaming events already published
	// Replay ensures client receives all events (reasoning, text, tool calls)
	useEventStream({
		replayLast: 50, // Replay last 50 events to catch compact auto-response streaming
		callbacks: eventStreamCallbacks,
	});

	// Create sendUserMessageToAI function using new subscription adapter
	const sendUserMessageToAI = useCallback(
		createSubscriptionSendUserMessageToAI({
			aiConfig,
			currentSessionId,
			selectedProvider,
			selectedModel,
			addMessage,
			addLog,
			updateSessionTitle,
			notificationSettings,
			abortControllerRef,
			streamingMessageIdRef,
			setIsStreaming,
			setIsTitleStreaming,
			setStreamingTitle,
		}),
		[
			aiConfig,
			currentSessionId,
			selectedProvider,
			selectedModel,
			addMessage,
			addLog,
			updateSessionTitle,
			notificationSettings,
			abortControllerRef,
			streamingMessageIdRef,
			setIsStreaming,
			setIsTitleStreaming,
			setStreamingTitle,
		],
	);

	// Create factory for command context
	const createCommandContextForArgs = useCallback(
		(args: string[]) =>
			createCommandContext(args, {
				addMessage,
				currentSessionId,
				saveConfig,
				sendUserMessageToAI,
				setInput,
				setPendingInput,
				setMultiSelectionPage,
				setMultiSelectionAnswers,
				setMultiSelectChoices,
				setSelectedCommandIndex,
				setSelectionFilter,
				setIsFilterMode,
				setInputComponent,
				inputResolver,
				commandSessionRef,
				addLog,
				getCommands: () => commands,
			}),
		[
			addMessage,
			currentSessionId,
			saveConfig,
			sendUserMessageToAI,
			setInput,
			setPendingInput,
			setMultiSelectionPage,
			setMultiSelectionAnswers,
			setMultiSelectChoices,
			setSelectedCommandIndex,
			setSelectionFilter,
			setIsFilterMode,
			setInputComponent,
			addLog,
		],
	);

	// Create hint text getter function
	const getHintText = useMemo(() => createGetHintText(commands), []);

	// Autocomplete hooks
	const filteredFileInfo = useFileAutocomplete(input, normalizedCursor, projectFiles);
	const filteredCommands = useCommandAutocomplete(
		input,
		normalizedCursor,
		cachedOptions,
		createCommandContextForArgs,
		commands,
	);

	// Get hint text for current input
	const hintText = useMemo(() => getHintText(input), [input, getHintText]);

	// Clear error when input changes
	useEffect(() => {
		setLoadError(null);
	}, [input, setLoadError]);

	// Use command option loader hook
	useCommandOptionLoader(
		input,
		currentlyLoading,
		cachedOptions,
		setCachedOptions,
		setCurrentlyLoading,
		setLoadError,
		createCommandContextForArgs,
		commands,
		addLog,
	);

	// Sync UI streaming state with server state on session switch
	// When user switches to different session, check if that session has active streaming
	// This syncs UI state (isStreaming) with server state (message.status === 'active')
	useEffect(() => {
		if (!currentSession) {
			setIsStreaming(false);
			return;
		}

		// Check if session has active streaming (server state)
		const activeMessage = currentSession.messages.find((m) => m.status === "active");
		setIsStreaming(!!activeMessage);
	}, [currentSession, setIsStreaming]);

	// Create handleSubmit function with filteredCommands
	const handleSubmit = useMemo(
		() =>
			createHandleSubmit({
				isStreaming,
				addMessage,
				getAIConfig,
				setCurrentSessionId,
				pendingInput,
				filteredCommands,
				pendingAttachments,
				projectFiles,
				setHistoryIndex,
				setTempInput,
				setInput,
				setPendingInput,
				setPendingCommand,
				setMessageHistory,
				clearAttachments,
				inputResolver,
				commandSessionRef,
				skipNextSubmit,
				currentSessionId,
				addLog,
				sendUserMessageToAI,
				createCommandContext: createCommandContextForArgs,
				getCommands: () => commands,
			}),
		[
			isStreaming,
			addMessage,
			getAIConfig,
			setCurrentSessionId,
			pendingInput,
			filteredCommands,
			pendingAttachments,
			projectFiles,
			setHistoryIndex,
			setTempInput,
			setInput,
			setPendingInput,
			setPendingCommand,
			setMessageHistory,
			clearAttachments,
			inputResolver,
			commandSessionRef,
			skipNextSubmit,
			currentSessionId,
			addLog,
			sendUserMessageToAI,
			createCommandContextForArgs,
		],
	);

	// Keyboard navigation hooks (called directly in Chat.tsx for Ink to work)
	// Order matters: Later hooks execute first in Ink

	// 1. Abort handler - ESC to abort streaming (highest priority)
	useAbortHandler({
		isStreaming,
		abortControllerRef,
		addLog,
	});

	// 2. Keyboard shortcuts - Double-ESC to clear input
	useKeyboardShortcuts({
		isStreaming,
		input,
		lastEscapeTime,
		setInput,
		setCursor,
		setShowEscHint,
	});

	// 3. Selection mode - Question/option selection with filter/multi-select
	useSelectionMode({
		pendingInput,
		inputResolver,
		multiSelectionPage,
		multiSelectionAnswers,
		multiSelectChoices,
		selectionFilter,
		isFilterMode,
		freeTextInput,
		isFreeTextMode,
		selectedCommandIndex,
		commandSessionRef,
		currentSessionId,
		setSelectedCommandIndex,
		setMultiSelectionPage,
		setMultiSelectionAnswers,
		setMultiSelectChoices,
		setSelectionFilter,
		setIsFilterMode,
		setFreeTextInput,
		setIsFreeTextMode,
		setPendingInput,
		addLog,
		addMessage,
		getAIConfig,
	});

	// 4. Pending command - Pending command option selection
	usePendingCommand({
		pendingInput,
		pendingCommand,
		cachedOptions,
		selectedCommandIndex,
		currentSessionId,
		setSelectedCommandIndex,
		setPendingCommand,
		createCommandContext: createCommandContextForArgs,
		addMessage,
	});

	// 5. File navigation - @-mention file autocomplete
	useFileNavigation({
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
	});

	// 6. Command navigation - Slash command autocomplete
	useCommandNavigation({
		input,
		pendingInput,
		filteredCommands,
		selectedCommandIndex,
		skipNextSubmit,
		commandSessionRef,
		currentSessionId,
		setInput,
		setCursor,
		setSelectedCommandIndex,
		addLog,
		addMessage,
		getAIConfig,
		createCommandContext: createCommandContextForArgs,
	});

	// Command autocomplete handlers hook
	const {
		handleTab: handleCommandAutocompleteTab,
		handleEnter: handleCommandAutocompleteEnter,
		handleUpArrow: handleCommandAutocompleteUpArrow,
		handleDownArrow: handleCommandAutocompleteDownArrow,
	} = useCommandAutocompleteHandlers({
		filteredCommands,
		selectedCommandIndex,
		pendingInput,
		skipNextSubmit,
		currentSessionId,
		commandSessionRef,
		setInput,
		setCursor,
		setSelectedCommandIndex,
		addLog,
		addMessage,
		getAIConfig,
		createCommandContext: createCommandContextForArgs,
	});

	// File autocomplete handlers
	const handleFileAutocompleteSelect = () => {
		if (filteredFileInfo.files.length === 0) return;

		const selectedFile = filteredFileInfo.files[selectedFileIndex];
		if (!selectedFile) return;

		// Add file to attachments
		addAttachment({
			path: selectedFile.path,
			relativePath: selectedFile.relativePath,
			size: selectedFile.size,
		});

		// Replace @query with @relativePath and space
		const beforeAt = input.slice(0, filteredFileInfo.atIndex);
		const afterQuery = input.slice(filteredFileInfo.atIndex + 1 + filteredFileInfo.query.length);
		const newInput = `${beforeAt}@${selectedFile.relativePath} ${afterQuery}`;

		setInput(newInput);
		setCursor(filteredFileInfo.atIndex + 1 + selectedFile.relativePath.length + 1);
		setSelectedFileIndex(0);
	};

	const handleFileAutocompleteTab = () => {
		handleFileAutocompleteSelect();
	};

	const handleFileAutocompleteEnter = () => {
		handleFileAutocompleteSelect();
	};

	const handleFileAutocompleteUpArrow = () => {
		if (filteredFileInfo.files.length === 0) return;
		setSelectedFileIndex((prev) => (prev === 0 ? filteredFileInfo.files.length - 1 : prev - 1));
	};

	const handleFileAutocompleteDownArrow = () => {
		if (filteredFileInfo.files.length === 0) return;
		setSelectedFileIndex((prev) => (prev === filteredFileInfo.files.length - 1 ? 0 : prev + 1));
	};

	// TEST: Direct useInput in Chat.tsx to verify Ink is working
	useInput((char, key) => {
		if (pendingInput && pendingInput.type === "selection") {
			console.log("[Chat.tsx TEST useInput] Key received:", Object.keys(key).filter(k => key[k]), "char:", char);
			return false; // Don't consume, just log
		}
		return false;
	}, { isActive: true });

	// Message history navigation hook (like bash)
	useMessageHistoryNavigation({
		isStreaming,
		input,
		messageHistory,
		historyIndex,
		tempInput,
		inputComponent,
		pendingInput,
		pendingCommand,
		filteredCommands,
		filteredFileInfo,
		setInput,
		setCursor,
		setHistoryIndex,
		setTempInput,
	});

	// Reset selected indices when filtered lists change
	useEffect(() => {
		setSelectedCommandIndex(0);
	}, [filteredCommands.length]);

	useEffect(() => {
		setSelectedFileIndex(0);
	}, [filteredFileInfo.files.length]);

	return (
		<Box flexDirection="row" flexGrow={1}>
			{/* Main chat area */}
			<Box flexDirection="column" flexGrow={1} width="70%">
				{/* App Header and Chat Title */}
				<Box flexShrink={0}>
					<ChatHeader
						currentSessionTitle={currentSession?.title}
						isTitleStreaming={isTitleStreaming}
						streamingTitle={streamingTitle}
					/>
				</Box>

				{/* Messages */}
				<ChatMessages
					hasSession={!!currentSession}
					messages={currentSession?.messages}
					attachmentTokens={attachmentTokens}
				/>

				{/* Status Indicator */}
				<Box flexShrink={0}>
					<StatusIndicator
						isStreaming={isStreaming}
						streamParts={currentSession?.messages.find((m) => m.status === "active")?.content || []}
					/>
				</Box>

				{/* Todo List */}
				<Box flexShrink={0}>
					<TodoList />
				</Box>

				{/* Input Area */}
				<Box flexShrink={0}>
					<InputSection
						input={input}
						cursor={normalizedCursor}
						pendingInput={pendingInput}
						pendingCommand={pendingCommand}
						multiSelectionPage={multiSelectionPage}
						multiSelectionAnswers={multiSelectionAnswers}
						multiSelectChoices={multiSelectChoices}
						selectionFilter={selectionFilter}
						isFilterMode={isFilterMode}
						freeTextInput={freeTextInput}
						isFreeTextMode={isFreeTextMode}
						selectedCommandIndex={selectedCommandIndex}
						askQueueLength={askQueueLength}
						pendingAttachments={pendingAttachments}
						attachmentTokens={attachmentTokens}
						showEscHint={showEscHint}
						filteredFileInfo={filteredFileInfo}
						filteredCommands={filteredCommands}
						filesLoading={filesLoading}
						selectedFileIndex={selectedFileIndex}
						currentlyLoading={currentlyLoading}
						loadError={loadError}
						cachedOptions={cachedOptions}
						hintText={hintText}
						validTags={validTags}
						currentSessionId={currentSessionId}
						setInput={setInput}
						setCursor={setCursor}
						setSelectionFilter={setSelectionFilter}
						setSelectedCommandIndex={setSelectedCommandIndex}
						onSubmit={handleSubmit}
						onCommandAutocompleteTab={handleCommandAutocompleteTab}
						onCommandAutocompleteEnter={handleCommandAutocompleteEnter}
						onCommandAutocompleteUpArrow={handleCommandAutocompleteUpArrow}
						onCommandAutocompleteDownArrow={handleCommandAutocompleteDownArrow}
						onFileAutocompleteTab={handleFileAutocompleteTab}
						onFileAutocompleteEnter={handleFileAutocompleteEnter}
						onFileAutocompleteUpArrow={handleFileAutocompleteUpArrow}
						onFileAutocompleteDownArrow={handleFileAutocompleteDownArrow}
						addMessage={addMessage}
						createCommandContext={createCommandContextForArgs}
						getAIConfig={getAIConfig}
						setPendingCommand={setPendingCommand}
						inputComponent={inputComponent}
						inputComponentTitle={inputComponentTitle}
						isStreaming={isStreaming}
						abortControllerRef={abortControllerRef}
					/>
				</Box>

				{/* Status Bar */}
				<Box flexShrink={0} paddingTop={1} flexDirection="row">
					<StatusBar
						provider={currentSession?.provider || selectedProvider || null}
						model={currentSession?.model || selectedModel || null}
						modelStatus={currentSession?.modelStatus}
						usedTokens={currentSession ? usedTokens : 0}
					/>
				</Box>
			</Box>
		</Box>
	);
}
