/**
 * Command Autocomplete Handlers Hook
 * Provides handlers for command autocomplete navigation and selection
 */

import type { FilteredCommand } from '@sylphx/code-client';
import type React from 'react';
import { useCallback } from 'react';
import type { CommandContext } from '../commands/commandContext.js';

export interface UseCommandAutocompleteHandlersOptions {
  filteredCommands: FilteredCommand[];
  selectedCommandIndex: number;
  pendingInput: boolean | null;
  skipNextSubmit: React.MutableRefObject<boolean>;
  currentSessionId: string | null;
  commandSessionRef: React.MutableRefObject<string | null>;
  setInput: (value: string) => void;
  setCursor: (value: number) => void;
  setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
  addLog: (message: string) => void;
  addMessage: (params: any) => Promise<string>;
  getAIConfig: () => any;
  createCommandContext: (args: string[]) => CommandContext;
}

export function useCommandAutocompleteHandlers(options: UseCommandAutocompleteHandlersOptions) {
  const {
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
    createCommandContext,
  } = options;

  // Tab: autocomplete the selected command
  const handleTab = useCallback(() => {
    if (filteredCommands.length === 0 || pendingInput) return;

    const selected = filteredCommands[selectedCommandIndex];
    if (selected) {
      const hasArgs = selected.args && selected.args.length > 0;
      const completedText = hasArgs ? `${selected.label} ` : selected.label;

      addLog(`[useInput] Tab autocomplete fill: ${completedText}`);
      setInput(completedText);
      setCursor(completedText.length);
      setSelectedCommandIndex(0);
    }
  }, [filteredCommands, selectedCommandIndex, pendingInput, addLog, setInput, setCursor, setSelectedCommandIndex]);

  // Enter: execute the selected command
  const handleEnter = useCallback(async () => {
    if (filteredCommands.length === 0 || pendingInput) {
      return;
    }

    const selected = filteredCommands[selectedCommandIndex];
    if (!selected) {
      return;
    }

    try {
      skipNextSubmit.current = true;

      // Clear input immediately before execution
      setInput('');
      setSelectedCommandIndex(0);

      // Execute command directly
      addLog(`[useInput] Enter autocomplete execute: ${selected.label}`);

      // Add user message to conversation (lazy create session if needed)
      const aiConfig = getAIConfig();
      const provider = aiConfig?.defaultProvider || 'openrouter';
      const model = aiConfig?.defaultModel || 'anthropic/claude-3.5-sonnet';

      const sessionIdToUse = commandSessionRef.current || currentSessionId;

      const resultSessionId = await addMessage({
        sessionId: sessionIdToUse,
        role: 'user',
        content: selected.label,
        provider,
        model,
      });

      if (!commandSessionRef.current) {
        commandSessionRef.current = resultSessionId;
      }

      // Execute command - it will use waitForInput if needed
      const response = await selected.execute(createCommandContext([]));

      // Add final response if any
      if (response) {
        await addMessage({
          sessionId: commandSessionRef.current,
          role: 'assistant',
          content: response,
          provider,
          model,
        });
      }
    } catch (error) {
      console.error('[handleCommandAutocompleteEnter] ERROR:', error);
      addLog(`[ERROR] Command execution failed: ${error instanceof Error ? error.message : String(error)}`);
      // Don't rethrow - let the UI continue
    }
  }, [filteredCommands, selectedCommandIndex, pendingInput, skipNextSubmit, setInput, setSelectedCommandIndex, addLog, getAIConfig, currentSessionId, commandSessionRef, addMessage, createCommandContext]);

  // Up arrow: move selection up
  const handleUpArrow = useCallback(() => {
    if (filteredCommands.length === 0 || pendingInput) return;

    // Move selection up (wrap to bottom if at top)
    setSelectedCommandIndex((prev) => {
      const newIndex = prev > 0 ? prev - 1 : filteredCommands.length - 1;
      addLog(`[commandAutocomplete] Up arrow: ${prev} -> ${newIndex}`);
      return newIndex;
    });
  }, [filteredCommands.length, pendingInput, setSelectedCommandIndex, addLog]);

  // Down arrow: move selection down
  const handleDownArrow = useCallback(() => {
    if (filteredCommands.length === 0 || pendingInput) return;

    // Move selection down (wrap to top if at bottom)
    setSelectedCommandIndex((prev) => {
      const newIndex = prev < filteredCommands.length - 1 ? prev + 1 : 0;
      addLog(`[commandAutocomplete] Down arrow: ${prev} -> ${newIndex}`);
      return newIndex;
    });
  }, [filteredCommands.length, pendingInput, setSelectedCommandIndex, addLog]);

  return {
    handleTab,
    handleEnter,
    handleUpArrow,
    handleDownArrow,
  };
}
