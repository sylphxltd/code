/**
 * Pending Command Hook
 * Handles pending command selection (e.g., model selection, provider selection)
 *
 * Single Responsibility: Pending command option selection
 */

import { useInput } from 'ink';
import type React from 'react';
import type { Command, CommandContext, WaitForInputOptions } from '../../types/command-types.js';

export interface UsePendingCommandOptions {
  pendingInput: WaitForInputOptions | null;
  pendingCommand: { command: Command; currentInput: string } | null;
  cachedOptions: Map<string, Array<{ id: string; name: string }>>;
  selectedCommandIndex: number;
  currentSessionId: string | null;
  setSelectedCommandIndex: React.Dispatch<React.SetStateAction<number>>;
  setPendingCommand: (value: { command: Command; currentInput: string } | null) => void;
  createCommandContext: (args: string[]) => CommandContext;
  addMessage: (params: any) => Promise<string>;
}

/**
 * Handles pending command selection
 * Used for commands that require option selection (e.g., /model, /provider)
 * - Up/Down arrows → navigate options
 * - Enter → select option and execute command
 * - ESC → cancel command
 */
export function usePendingCommand(options: UsePendingCommandOptions) {
  const {
    pendingInput,
    pendingCommand,
    cachedOptions,
    selectedCommandIndex,
    currentSessionId,
    setSelectedCommandIndex,
    setPendingCommand,
    createCommandContext,
    addMessage,
  } = options;

  useInput(
    async (char, key) => {
      // Only handle when pendingCommand is active (and no pendingInput)
      if (!pendingCommand || pendingInput) {
        return false;
      }

      // Get options for the pending command's first arg
      const firstArg = pendingCommand.command.args?.[0];
      const cacheKey = firstArg ? `${pendingCommand.command.id}:${firstArg.name}` : '';
      const options = cacheKey ? (cachedOptions.get(cacheKey) || []) : [];
      const maxIndex = options.length - 1;

      // Arrow down - next option
      if (key.downArrow) {
        setSelectedCommandIndex((prev) => (prev < maxIndex ? prev + 1 : prev));
        return true; // Consumed
      }

      // Arrow up - previous option
      if (key.upArrow) {
        setSelectedCommandIndex((prev) => (prev > 0 ? prev - 1 : 0));
        return true; // Consumed
      }

      // Enter - select option
      if (key.return) {
        const selectedOption = options[selectedCommandIndex];
        if (selectedOption) {
          const response = await pendingCommand.command.execute(createCommandContext([selectedOption.id]));
          if (currentSessionId && response) {
            addMessage({
              sessionId: currentSessionId,
              role: 'assistant',
              content: response,
            });
          }
          setPendingCommand(null);
          setSelectedCommandIndex(0);
        }
        return true; // Consumed
      }

      // Escape - cancel
      if (key.escape) {
        if (currentSessionId) {
          addMessage({
            sessionId: currentSessionId,
            role: 'assistant',
            content: 'Command cancelled',
          });
        }
        setPendingCommand(null);
        setSelectedCommandIndex(0);
        return true; // Consumed
      }

      return false; // Not our concern
    },
    { isActive: true }
  );
}
