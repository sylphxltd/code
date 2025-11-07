/**
 * Keyboard Navigation Hook (Composition)
 * Composes focused keyboard handling hooks for different modes
 *
 * This hook now delegates to specialized hooks instead of handling everything:
 * - useAbortHandler: ESC to abort streaming
 * - useKeyboardShortcuts: Double-ESC to clear
 * - useFileNavigation: @-mention file autocomplete
 * - useCommandNavigation: Slash command autocomplete
 * - useSelectionMode: Selection questions with filter/multi-select
 * - usePendingCommand: Pending command option selection
 */

import type { Command, CommandContext, WaitForInputOptions } from '../types/command-types.js';
import { useAbortHandler } from './keyboard/useAbortHandler.js';
import { useKeyboardShortcuts } from './keyboard/useKeyboardShortcuts.js';
import { useFileNavigation } from './keyboard/useFileNavigation.js';
import { useCommandNavigation } from './keyboard/useCommandNavigation.js';
import { useSelectionMode } from './keyboard/useSelectionMode.js';
import { usePendingCommand } from './keyboard/usePendingCommand.js';

export interface KeyboardNavigationProps {
  // State
  input: string;
  cursor: number;
  isStreaming: boolean;
  pendingInput: WaitForInputOptions | null;
  pendingCommand: { command: Command; currentInput: string } | null;
  filteredFileInfo: {
    hasAt: boolean;
    files: Array<{ path: string; relativePath: string; size: number }>;
    query: string;
    atIndex: number;
  };
  filteredCommands: Command[];
  multiSelectionPage: number;
  multiSelectionAnswers: Record<string, string | string[]>;
  multiSelectChoices: Set<string>;
  selectionFilter: string;
  isFilterMode: boolean;
  freeTextInput: string;
  isFreeTextMode: boolean;
  selectedCommandIndex: number;
  selectedFileIndex: number;
  skipNextSubmit: React.MutableRefObject<boolean>;
  lastEscapeTime: React.MutableRefObject<number>;
  inputResolver: React.MutableRefObject<((value: string | Record<string, string | string[]>) => void) | null>;
  commandSessionRef: React.MutableRefObject<string | null>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  cachedOptions: Map<string, Array<{ id: string; name: string }>>;

  // State setters
  setInput: (value: string) => void;
  setCursor: (value: number) => void;
  setShowEscHint: (value: boolean) => void;
  setMultiSelectionPage: (value: number | ((prev: number) => number)) => void;
  setSelectedCommandIndex: (value: number | ((prev: number) => number)) => void;
  setMultiSelectionAnswers: (value: Record<string, string | string[]> | ((prev: Record<string, string | string[]>) => Record<string, string | string[]>)) => void;
  setMultiSelectChoices: (value: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  setSelectionFilter: (value: string | ((prev: string) => string)) => void;
  setIsFilterMode: (value: boolean) => void;
  setFreeTextInput: (value: string | ((prev: string) => string)) => void;
  setIsFreeTextMode: (value: boolean) => void;
  setSelectedFileIndex: (value: number | ((prev: number) => number)) => void;
  setPendingInput: (value: WaitForInputOptions | null) => void;
  setPendingCommand: (value: { command: Command; currentInput: string } | null) => void;

  // Functions
  addLog: (message: string) => void;
  addMessage: (params: {
    sessionId: string | null;
    role: 'user' | 'assistant';
    content: string;
    attachments?: any[];
    usage?: any;
    finishReason?: string;
    metadata?: any;
    todoSnapshot?: any[];
    status?: 'active' | 'completed' | 'error' | 'abort';
    provider?: string;
    model?: string;
  }) => Promise<string>;
  addAttachment: (attachment: { path: string; relativePath: string; size?: number }) => void;
  setAttachmentTokenCount: (path: string, count: number) => void;
  createCommandContext: (args: string[]) => CommandContext;
  getAIConfig: () => { defaultProvider?: string; defaultModel?: string } | null;

  // Config
  currentSessionId: string | null;
  currentSession: any;
}

/**
 * Composes all keyboard navigation hooks for the chat interface
 * Each hook handles a specific mode and returns boolean to indicate if it consumed the event
 */
export function useKeyboardNavigation(props: KeyboardNavigationProps) {
  const {
    input,
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
    createCommandContext,
    getAIConfig,
    currentSessionId,
    currentSession,
  } = props;

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
    createCommandContext,
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
    createCommandContext,
  });
}
