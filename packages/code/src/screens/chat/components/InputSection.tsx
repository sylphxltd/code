/**
 * InputSection Component
 * Handles all input modes: selection, pending command, and normal input
 */

import type { FileAttachment } from '@sylphx/code-core';
import { formatTokenCount } from '@sylphx/code-core';
import { Box, Text } from 'ink';
import type { Command, WaitForInputOptions } from '../../../commands/types.js';
import { CommandAutocomplete } from '../../../components/CommandAutocomplete.js';
import { FileAutocomplete } from '../../../components/FileAutocomplete.js';
import { PendingCommandSelection } from '../../../components/PendingCommandSelection.js';
import { SelectionUI } from '../../../components/SelectionUI.js';
import TextInputWithHint from '../../../components/TextInputWithHint.js';
import type { FilteredCommand, FilteredFileInfo } from '../autocomplete/types.js';
import type { SettingsMode } from '../types/settings-mode.js';
import { ProviderSettings } from './ProviderSettings.js';

interface InputSectionProps {
  // Input state
  input: string;
  setInput: (value: string) => void;
  cursor: number;
  setCursor: (pos: number) => void;
  onSubmit: (value: string) => void | Promise<void>;

  // Autocomplete callbacks
  onCommandAutocompleteTab?: () => void;
  onCommandAutocompleteEnter?: () => void;
  onCommandAutocompleteUpArrow?: () => void;
  onCommandAutocompleteDownArrow?: () => void;
  onFileAutocompleteTab?: () => void;
  onFileAutocompleteEnter?: () => void;
  onFileAutocompleteUpArrow?: () => void;
  onFileAutocompleteDownArrow?: () => void;

  // Selection mode
  pendingInput: WaitForInputOptions | null;
  multiSelectionPage: number;
  multiSelectionAnswers: Record<string, string | string[]>;
  multiSelectChoices: Set<string>;
  selectionFilter: string;
  setSelectionFilter: (value: string) => void;
  isFilterMode: boolean;
  freeTextInput: string;
  isFreeTextMode: boolean;
  selectedCommandIndex: number;
  setSelectedCommandIndex: (idx: number) => void;
  askQueueLength: number;

  // Pending command mode
  pendingCommand: { command: Command; currentInput: string } | null;
  setPendingCommand: (cmd: { command: Command; currentInput: string } | null) => void;
  currentlyLoading: string | null;
  loadError: string | null;
  cachedOptions: Map<string, Array<{ id: string; name: string; label: string; value?: string }>>;
  currentSessionId: string | null;
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
    provider?: any;
    model?: string;
  }) => Promise<string>;
  createCommandContext: (args: string[]) => any;
  getAIConfig: () => { defaultProvider?: string; defaultModel?: string } | null;

  // Attachments
  pendingAttachments: FileAttachment[];
  attachmentTokens: Map<string, number>;

  // Autocomplete
  filteredFileInfo: FilteredFileInfo;
  filteredCommands: FilteredCommand[];
  selectedFileIndex: number;
  filesLoading: boolean;
  hintText: string;
  validTags: Set<string>;

  // ESC hint
  showEscHint: boolean;

  // Custom input component (replaces input area)
  inputComponent: React.ReactNode | null;
  inputComponentTitle: string | null;

  // Abort streaming
  isStreaming: boolean;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
}

export function InputSection({
  input,
  setInput,
  cursor,
  setCursor,
  onSubmit,
  onCommandAutocompleteTab,
  onCommandAutocompleteEnter,
  onCommandAutocompleteUpArrow,
  onCommandAutocompleteDownArrow,
  onFileAutocompleteTab,
  onFileAutocompleteEnter,
  onFileAutocompleteUpArrow,
  onFileAutocompleteDownArrow,
  pendingInput,
  multiSelectionPage,
  multiSelectionAnswers,
  multiSelectChoices,
  selectionFilter,
  isFilterMode,
  freeTextInput,
  isFreeTextMode,
  selectedCommandIndex,
  setSelectedCommandIndex,
  askQueueLength,
  pendingCommand,
  setPendingCommand,
  currentlyLoading,
  loadError,
  cachedOptions,
  currentSessionId,
  addMessage,
  createCommandContext,
  getAIConfig,
  pendingAttachments,
  attachmentTokens,
  filteredFileInfo,
  filteredCommands,
  selectedFileIndex,
  filesLoading,
  hintText,
  validTags,
  showEscHint,
  inputComponent,
  inputComponentTitle,
  isStreaming,
  abortControllerRef,
}: InputSectionProps) {
  // Determine header title based on context
  const getHeaderTitle = (): string => {
    // Custom component with title
    if (inputComponent && inputComponentTitle) {
      return inputComponentTitle;
    }
    // Selection mode - use current question as title
    if (pendingInput?.type === 'selection' && pendingInput.questions[multiSelectionPage]) {
      return pendingInput.questions[multiSelectionPage].question;
    }
    // Text input mode with prompt - use prompt as title
    if (pendingInput?.type === 'text' && pendingInput.prompt) {
      return pendingInput.prompt;
    }
    // Default
    return 'YOU';
  };

  const headerTitle = getHeaderTitle();

  return (
    <Box flexDirection="column" flexShrink={0}>
      {/* Dynamic Header */}
      <Box>
        <Text color="#00D9FF">▌ {headerTitle}</Text>
      </Box>

      {/* Custom Input Component */}
      {inputComponent ? (
        inputComponent
      ) : (
        <>

          {/* PendingInput Mode - when command calls waitForInput */}
          {pendingInput && pendingInput.type === 'selection' ? (
        <SelectionUI
          pendingInput={pendingInput}
          multiSelectionPage={multiSelectionPage}
          multiSelectionAnswers={multiSelectionAnswers}
          multiSelectChoices={multiSelectChoices}
          selectionFilter={selectionFilter}
          isFilterMode={isFilterMode}
          freeTextInput={freeTextInput}
          isFreeTextMode={isFreeTextMode}
          selectedCommandIndex={selectedCommandIndex}
          askQueueLength={askQueueLength}
        />
      ) : /* Selection Mode - when a command is pending and needs args */
      pendingCommand ? (
        <PendingCommandSelection
          pendingCommand={pendingCommand}
          currentlyLoading={currentlyLoading}
          loadError={loadError}
          cachedOptions={cachedOptions}
          selectedCommandIndex={selectedCommandIndex}
          onSelect={async (option) => {
            const response = await pendingCommand.command.execute(
              createCommandContext([option.value || option.label])
            );
            if (currentSessionId && response) {
              const aiConfig = getAIConfig();
              await addMessage({
                sessionId: currentSessionId,
                role: 'assistant',
                content: response,
                provider: aiConfig?.defaultProvider,
                model: aiConfig?.defaultModel,
              });
            }
            setPendingCommand(null);
            setSelectedCommandIndex(0);
          }}
        />
      ) : (
        <>
          {/* Show pending attachments */}
          {pendingAttachments.length > 0 ? (
            <Box flexDirection="column" marginBottom={1}>
              <Box marginBottom={1}>
                <Text dimColor>Attachments ({pendingAttachments.length}):</Text>
              </Box>
              {pendingAttachments.map((att) => (
                <Box key={`pending-att-${att.path}`} marginLeft={2}>
                  <Text color="#00D9FF">{att.relativePath}</Text>
                  <Text dimColor> (</Text>
                  {att.size ? (
                    <>
                      <Text dimColor>{(att.size / 1024).toFixed(1)}KB</Text>
                      {attachmentTokens.has(att.path) && <Text dimColor>, </Text>}
                    </>
                  ) : null}
                  {attachmentTokens.has(att.path) ? (
                    <Text dimColor>{formatTokenCount(attachmentTokens.get(att.path)!)} Tokens</Text>
                  ) : null}
                  <Text dimColor>)</Text>
                </Box>
              ))}
            </Box>
          ) : null}

          {/* Show prompt for text input mode */}
          {pendingInput?.type === 'text' && pendingInput.prompt && (
            <Box marginBottom={1}>
              <Text dimColor>{pendingInput.prompt}</Text>
            </Box>
          )}

          {/* Text Input with inline hint */}
          <Box marginLeft={2}>
            <TextInputWithHint
              key="main-input"
              value={input}
              onChange={setInput}
              cursor={cursor}
              onCursorChange={setCursor}
              onSubmit={onSubmit}
              placeholder={
                pendingInput?.type === 'text'
                  ? pendingInput.placeholder || 'Type your response...'
                  : 'Type your message, / for commands, @ for files...'
              }
              showCursor
              hint={hintText}
              validTags={validTags}
              disableUpDownArrows={
                // Disable up/down arrows when autocomplete is active
                filteredFileInfo.hasAt || (input.startsWith('/') && filteredCommands.length > 0)
              }
              onTab={
                // When file autocomplete is active, handle Tab
                filteredFileInfo.hasAt
                  ? onFileAutocompleteTab
                  : // When command autocomplete is active, handle Tab via callback
                  input.startsWith('/') && filteredCommands.length > 0
                  ? onCommandAutocompleteTab
                  : undefined
              }
              onEnter={
                // When file autocomplete is active, handle Enter
                filteredFileInfo.hasAt
                  ? onFileAutocompleteEnter
                  : // When command autocomplete is active, handle Enter via callback
                  input.startsWith('/') && filteredCommands.length > 0
                  ? onCommandAutocompleteEnter
                  : undefined
              }
              onUpArrow={
                // When file autocomplete is active, handle Up Arrow
                filteredFileInfo.hasAt
                  ? onFileAutocompleteUpArrow
                  : // When command autocomplete is active, handle Up Arrow via callback
                  input.startsWith('/') && filteredCommands.length > 0
                  ? onCommandAutocompleteUpArrow
                  : undefined
              }
              onDownArrow={
                // When file autocomplete is active, handle Down Arrow
                filteredFileInfo.hasAt
                  ? onFileAutocompleteDownArrow
                  : // When command autocomplete is active, handle Down Arrow via callback
                  input.startsWith('/') && filteredCommands.length > 0
                  ? onCommandAutocompleteDownArrow
                  : undefined
              }
              onEscape={
                // ESC to abort streaming
                isStreaming && abortControllerRef.current
                  ? () => abortControllerRef.current?.abort()
                  : undefined
              }
            />
          </Box>

          {/* ESC hint - shows after first ESC press */}
          {showEscHint && (
            <Box marginTop={1}>
              <Text color="yellow">Press ESC again to clear input</Text>
            </Box>
          )}

          {/* File Autocomplete - Shows below input when typing @ */}
          {filteredFileInfo.hasAt ? (
            <FileAutocomplete
              files={filteredFileInfo.files}
              selectedFileIndex={selectedFileIndex}
              filesLoading={filesLoading}
            />
          ) : null}

          {/* Command Autocomplete - Shows below input when typing / */}
          {input.startsWith('/') && !filteredFileInfo.hasAt && filteredCommands.length > 0 ? (
            <CommandAutocomplete
              commands={filteredCommands}
              selectedCommandIndex={selectedCommandIndex}
              currentlyLoading={currentlyLoading}
              loadError={loadError}
            />
          ) : null}
        </>
      )}
      </>
      )}
    </Box>
  );
}
