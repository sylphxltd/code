/**
 * Message History Navigation Hook
 * Provides keyboard navigation through message history (like bash history with up/down arrows)
 */

import { useInput } from 'ink';
import { useCallback } from 'react';
import type { FilteredFile } from '@sylphx/code-client';
import type { FilteredCommand } from '@sylphx/code-client';

export interface UseMessageHistoryNavigationOptions {
  isStreaming: boolean;
  input: string;
  messageHistory: string[];
  historyIndex: number;
  tempInput: string;
  inputComponent: React.ReactNode | null;
  pendingInput: boolean | null;
  pendingCommand: string | null;
  filteredCommands: FilteredCommand[];
  filteredFileInfo: FilteredFile | null;
  setInput: (value: string) => void;
  setCursor: (value: number) => void;
  setHistoryIndex: React.Dispatch<React.SetStateAction<number>>;
  setTempInput: (value: string) => void;
}

export function useMessageHistoryNavigation(options: UseMessageHistoryNavigationOptions) {
  const {
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
  } = options;

  // Navigate up through history
  const navigateUp = useCallback(() => {
    if (messageHistory.length === 0) return;

    if (historyIndex === -1) {
      setTempInput(input);
      const newIndex = messageHistory.length - 1;
      setHistoryIndex(newIndex);
      setInput(messageHistory[newIndex]);
      setCursor(0);
    } else if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setInput(messageHistory[newIndex]);
      setCursor(0);
    }
  }, [messageHistory, historyIndex, input, setTempInput, setHistoryIndex, setInput, setCursor]);

  // Navigate down through history
  const navigateDown = useCallback(() => {
    if (historyIndex === -1) return;

    if (historyIndex === messageHistory.length - 1) {
      setHistoryIndex(-1);
      setInput(tempInput);
      setCursor(0);
    } else {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setInput(messageHistory[newIndex]);
      setCursor(0);
    }
  }, [historyIndex, messageHistory, tempInput, setHistoryIndex, setInput, setCursor]);

  // Exit history browsing mode
  const exitHistoryMode = useCallback(() => {
    if (historyIndex !== -1) {
      setHistoryIndex(-1);
      setTempInput('');
    }
  }, [historyIndex, setHistoryIndex, setTempInput]);

  // Message history navigation (like bash)
  // IMPORTANT: Only handle up/down arrows here, let ControlledTextInput handle Enter
  useInput(
    (char, key) => {
      // inputComponent has its own keyboard handling (e.g. ProviderManagement)
      // Don't interfere with it
      if (inputComponent) {
        return;
      }

      const isNormalMode = !pendingInput && !pendingCommand;
      if (!isNormalMode) {
        return;
      }

      // Don't handle arrow keys when autocomplete is active
      // Let CommandAutocomplete or PendingCommandSelection handle navigation
      const hasAutocomplete =
        filteredCommands.length > 0 || (filteredFileInfo && filteredFileInfo.files.length > 0);

      // If autocomplete is active, don't handle ANY keys (let useKeyboardNavigation handle)
      if (hasAutocomplete && (key.upArrow || key.downArrow || key.tab || key.return)) {
        console.log(
          '[Chat.useInput] Early return: autocomplete active, key:',
          Object.keys(key).filter((k) => key[k as keyof typeof key])
        );
        return; // Let useKeyboardNavigation handle all navigation when autocomplete is active
      }

      // Up arrow - navigate to previous message in history
      if (key.upArrow) {
        // Skip if autocomplete is showing - let autocomplete handle navigation
        if (hasAutocomplete) return;
        navigateUp();
        return;
      }

      // Down arrow - navigate to next message in history
      if (key.downArrow) {
        // Skip if autocomplete is showing - let autocomplete handle navigation
        if (hasAutocomplete) return;
        navigateDown();
        return;
      }

      // Exit history browsing mode on ANY other key (including Enter, typing, etc.)
      // Don't consume the event - let ControlledTextInput handle it
      exitHistoryMode();
    },
    { isActive: !isStreaming }
  );

  return {
    navigateUp,
    navigateDown,
    exitHistoryMode,
  };
}
