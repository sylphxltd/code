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
import { useInputState } from "./chat/hooks/useInputState.js";
import { useSelectionState } from "./chat/hooks/useSelectionState.js";
import { useStreamingState } from "./chat/hooks/useStreamingState.js";
import { useFileAutocompleteHandlers } from "./chat/hooks/useFileAutocompleteHandlers.js";
import { useEventStreamCallbacks } from "./chat/hooks/useEventStreamCallbacks.js";
// Feature flags
import { USE_NEW_INPUT_MANAGER, DEBUG_INPUT_MANAGER } from "../config/features.js";
// Keyboard hooks (local to code package to work with Ink)
import { useAbortHandler } from "../hooks/keyboard/useAbortHandler.js";
import { useKeyboardShortcuts } from "../hooks/keyboard/useKeyboardShortcuts.js";
// Input Mode Manager (new system)
import {
	useInputMode,
	useInputModeManager,
	useInputHandlers,
} from "../hooks/input-manager/index.js";
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
	// Event stream callbacks - extracted to hook for better modularity
	const eventStreamCallbacks = useEventStreamCallbacks({
		updateSessionTitle,
		setIsStreaming,
		setIsTitleStreaming,
		setStreamingTitle,
		streamingMessageIdRef,
		addLog,
		aiConfig,
		notificationSettings,
	});

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
	// New centralized input management system (when feature flag enabled)
	const inputModeContext = useInputMode({
		pendingInput,
		input,
		pendingCommand,
		debug: DEBUG_INPUT_MANAGER,
	});

	// Create all input handlers using consolidated hook
	const handlers = useInputHandlers({
		// Selection mode
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
		setCurrentSessionId,
		// Pending command mode
		pendingCommand,
		cachedOptions,
		setPendingCommand,
		createCommandContext: createCommandContextForArgs,
		// File navigation mode
		filteredFileInfo,
		selectedFileIndex,
		currentSession,
		input,
		setInput,
		setCursor,
		setSelectedFileIndex,
		addAttachment,
		setAttachmentTokenCount,
		// Command autocomplete mode
		filteredCommands,
		skipNextSubmit,
		// Message history mode
		messageHistory,
		historyIndex,
		tempInput,
		isStreaming,
		inputComponent,
		setHistoryIndex,
		setTempInput,
	});

	// Setup input mode manager (only active when feature flag is enabled)
	useInputModeManager({
		context: inputModeContext,
		handlers: USE_NEW_INPUT_MANAGER ? handlers : [],
		config: { debug: DEBUG_INPUT_MANAGER },
	});

	// Legacy hooks removed - all input handling now managed by InputModeManager
	// Command/file autocomplete callbacks no longer needed (handled by InputModeManager)
	const handleCommandAutocompleteTab = undefined;
	const handleCommandAutocompleteEnter = undefined;
	const handleCommandAutocompleteUpArrow = undefined;
	const handleCommandAutocompleteDownArrow = undefined;

	// File autocomplete handlers - extracted to hook for reusability
	const {
		handleSelect: handleFileAutocompleteSelect,
		handleTab: handleFileAutocompleteTab,
		handleEnter: handleFileAutocompleteEnter,
		handleUpArrow: handleFileAutocompleteUpArrow,
		handleDownArrow: handleFileAutocompleteDownArrow,
	} = useFileAutocompleteHandlers({
		filteredFileInfo,
		selectedFileIndex,
		input,
		setInput,
		setCursor,
		setSelectedFileIndex,
		addAttachment,
	});

	// Message history navigation - now handled by MessageHistoryModeHandler in InputModeManager

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
