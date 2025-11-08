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
  useAppStore,
  useAskToolHandler,
  useChat,
  useEventStream,
  useFileAttachments,
  useKeyboardNavigation,
  useProjectFiles,
  useSessionInitialization,
  useSessionStore,
  useTokenCalculation,
} from '@sylphx/code-client';
import { Box, useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { commands } from '../commands/registry.js';
import StatusBar from '../components/StatusBar.js';
import TodoList from '../components/TodoList.js';
import { useCommandAutocomplete } from './chat/autocomplete/commandAutocomplete.js';
import { useFileAutocomplete } from './chat/autocomplete/fileAutocomplete.js';
// Autocomplete
import { createGetHintText } from './chat/autocomplete/hintText.js';
import { useCommandOptionLoader } from './chat/autocomplete/optionLoader.js';
// Command handling
import { createCommandContext } from './chat/commands/commandContext.js';
import { createHandleSubmit } from './chat/handlers/messageHandler.js';
import { useCommandState } from './chat/hooks/useCommandState.js';
// Custom hooks
import { useCommandAutocompleteHandlers } from './chat/hooks/useCommandAutocompleteHandlers.js';
import { useInputState } from './chat/hooks/useInputState.js';
import { useMessageHistoryNavigation } from './chat/hooks/useMessageHistoryNavigation.js';
import { useSelectionState } from './chat/hooks/useSelectionState.js';
import { useStreamingState } from './chat/hooks/useStreamingState.js';
// Streaming utilities
import { createSubscriptionSendUserMessageToAI } from './chat/streaming/subscriptionAdapter.js';

// Note: useMessageHistory not needed - using useInputState which includes history management

// UI components
import { ChatHeader } from './chat/components/ChatHeader.js';
import { ChatMessages } from './chat/components/ChatMessages.js';
import { InputSection } from './chat/components/InputSection.js';
import { StatusIndicator } from './chat/components/StatusIndicator.js';

interface ChatProps {
  commandFromPalette?: string | null;
}

export default function Chat(_props: ChatProps) {
  // Store selectors
  const addDebugLog = useAppStore((state) => state.addDebugLog);
  const navigateTo = useAppStore((state) => state.navigateTo);
  const aiConfig = useAppStore((state) => state.aiConfig);
  // IMPORTANT: Use useSessionStore directly for better reactivity
  const currentSessionId = useSessionStore((state) => state.currentSessionId);
  const currentSession = useSessionStore((state) => state.currentSession);
  const createSession = useSessionStore((state) => state.createSession);
  const updateSessionModel = useSessionStore((state) => state.updateSessionModel);
  const updateSessionProvider = useSessionStore((state) => state.updateSessionProvider);
  const updateSessionTitle = useSessionStore((state) => state.updateSessionTitle);
  const setCurrentSession = useSessionStore((state) => state.setCurrentSession);
  const updateProvider = useAppStore((state) => state.updateProvider);
  const setAIConfig = useAppStore((state) => state.setAIConfig);
  const addMessage = useAppStore((state) => state.addMessage);
  const setSelectedProvider = useAppStore((state) => state.setSelectedProvider);
  const setSelectedModel = useAppStore((state) => state.setSelectedModel);
  const updateNotificationSettings = useAppStore((state) => state.updateNotificationSettings);
  const notificationSettings = useAppStore((state) => state.notificationSettings);
  const selectedProvider = useAppStore((state) => state.selectedProvider);
  const selectedModel = useAppStore((state) => state.selectedModel);

  // Helper function (memoized to prevent infinite re-renders)
  const addLog = useCallback((message: string) => {
    addDebugLog(message);
  }, [addDebugLog]);

  // Custom hooks
  const { sendMessage } = useChat();
  const { saveConfig } = useAIConfig();
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
    lastErrorRef,
    wasAbortedRef,
    streamingMessageIdRef,
    usageRef,
    finishReasonRef,
    dbWriteTimerRef,
    pendingDbContentRef,
    setIsStreaming,
    setIsTitleStreaming,
    setStreamingTitle,
  } = streamingState;

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
  const getAIConfig = () => useAppStore.getState().aiConfig;

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

  // Multi-client message sync: Subscribe to session:{id} for messages from other clients
  // Filters out own streaming messages by checking streamingMessageIdRef
  // DISABLED: TUI is single-client, no need for multi-client sync callbacks
  const eventStreamCallbacks = useMemo(
    () => ({
      onAssistantMessageCreated: (messageId: string) => {
        // DISABLED: Causes infinite loop in single-client TUI
        // Event stream replay keeps triggering addMessage() creating duplicates
        return;

        // Skip if this is our own streaming message
        if (streamingMessageIdRef.current === messageId) {
          return;
        }
        // Other client created assistant message - create placeholder
        addLog(`[MultiClient] Assistant message created: ${messageId}`);
        addMessage({
          sessionId: currentSessionId,
          role: 'assistant',
          content: '',
          attachments: [],
          status: 'active',
        });
      },
      onTextDelta: (text: string) => {
        // DISABLED: TUI is single-client, no multi-client sync needed
        return;

        // Skip if currently streaming (own message)
        if (isStreaming) {
          return;
        }
        // Other client streaming text - append to last assistant message
        const currentSession = useSessionStore.getState().currentSession;
        if (currentSession && currentSession.messages.length > 0) {
          const lastMessage = currentSession.messages[currentSession.messages.length - 1];
          if (lastMessage.role === 'assistant') {
            useSessionStore.setState((state) => {
              if (state.currentSession && state.currentSession.messages.length > 0) {
                const messages = [...state.currentSession.messages];
                const lastMsg = { ...messages[messages.length - 1] };
                const parts = [...(lastMsg.content || [])];
                const lastPart = parts[parts.length - 1];

                if (lastPart && lastPart.type === 'text') {
                  parts[parts.length - 1] = { ...lastPart, content: lastPart.content + text };
                } else {
                  parts.push({ type: 'text', content: text });
                }

                lastMsg.content = parts;
                messages[messages.length - 1] = lastMsg;
                state.currentSession.messages = messages;
              }
            });
          }
        }
      },
      onToolCall: (toolCallId: string, toolName: string, args: unknown) => {
        // DISABLED: TUI is single-client
        return;
      },
      onComplete: () => {
        // DISABLED: TUI is single-client
        return;
      },
    }),
    [addLog, addMessage, currentSessionId, isStreaming, streamingMessageIdRef]
  );

  // Event stream for multi-client sync
  useEventStream({
    replayLast: 0, // Don't replay - we already loaded history
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
      lastErrorRef,
      wasAbortedRef,
      streamingMessageIdRef,
      usageRef,
      finishReasonRef,
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
      setIsStreaming,
      setIsTitleStreaming,
      setStreamingTitle,
    ]
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
    ]
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
    commands
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
    addLog
  );

  // Sync UI streaming state with server state on session switch
  // When user switches to different session, check if that session has active streaming
  // This syncs UI state (isStreaming) with server state (message.status === 'active')
  useEffect(() => {
    if (!currentSessionId) {
      setIsStreaming(false);
      return;
    }

    // Get current session from store (server state already loaded)
    const session = useSessionStore.getState().currentSession;
    if (!session || session.id !== currentSessionId) {
      setIsStreaming(false);
      return;
    }

    // Check if session has active streaming (server state)
    const activeMessage = session.messages.find((m) => m.status === 'active');
    setIsStreaming(!!activeMessage);
  }, [currentSessionId, setIsStreaming]);

  // Create handleSubmit function with filteredCommands
  const handleSubmit = useMemo(
    () =>
      createHandleSubmit({
        isStreaming,
        addMessage,
        getAIConfig,
        setCurrentSession,
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
      setCurrentSession,
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
    ]
  );

  // Keyboard navigation hook
  useKeyboardNavigation({
    input,
    cursor: normalizedCursor,
    isStreaming,
    pendingInput,
    pendingCommand,
    filteredFileInfo,
    filteredCommands,
    multiSelectionPage,
    multiSelectionAnswers,
    multiSelectChoices,
    selectionFilter,
    isFilterMode,
    freeTextInput,
    isFreeTextMode,
    selectedCommandIndex,
    selectedFileIndex,
    skipNextSubmit,
    lastEscapeTime,
    inputResolver,
    commandSessionRef,
    abortControllerRef,
    cachedOptions,
    setInput,
    setCursor,
    setShowEscHint,
    setMultiSelectionPage,
    setSelectedCommandIndex,
    setMultiSelectionAnswers,
    setMultiSelectChoices,
    setSelectionFilter,
    setIsFilterMode,
    setFreeTextInput,
    setIsFreeTextMode,
    setSelectedFileIndex,
    setPendingInput,
    setPendingCommand,
    addLog,
    addMessage,
    addAttachment,
    setAttachmentTokenCount,
    createCommandContext: createCommandContextForArgs,
    getAIConfig,
    currentSessionId,
    currentSession,
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
            streamParts={currentSession?.messages.find((m) => m.status === 'active')?.content || []}
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
