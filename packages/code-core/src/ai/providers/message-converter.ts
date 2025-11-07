/**
 * Message Converter
 * Handles message conversion, fingerprinting, and inconsistency detection
 */

import type { LanguageModelV2CallOptions } from '@ai-sdk/provider';
import { formatToolResult } from './text-based-tools.js';

export interface MessageConversionResult {
  prompt: string;
  shouldForceNewSession: boolean;
  messageFingerprints: string[];
}

/**
 * Simple message fingerprint for detecting changes
 * Returns a hash of role + first 100 chars of text content
 */
export function getMessageFingerprint(message: any): string {
  const content = Array.isArray(message.content) ? message.content : [message.content];
  const textParts = content
    .filter((part: any) => typeof part === 'object' && part.type === 'text')
    .map((part: any) => part.text)
    .join('');
  // Simple fingerprint: role + first 100 chars
  const preview = textParts.slice(0, 100);
  return `${message.role}:${preview}`;
}

/**
 * Detect if message history has been rewound or modified
 * Returns true if inconsistency detected
 */
export function detectMessageInconsistency(
  messages: any[],
  lastProcessedCount: number,
  lastMessageFingerprints?: string[]
): boolean {
  // If no fingerprints provided, can't detect inconsistency
  if (!lastMessageFingerprints || lastMessageFingerprints.length === 0) {
    return false;
  }

  // Check if message count decreased (rewind)
  if (messages.length < lastProcessedCount) {
    return true;
  }

  // Check if fingerprints of previously sent messages match
  const checkCount = Math.min(lastProcessedCount, lastMessageFingerprints.length, messages.length);
  for (let i = 0; i < checkCount; i++) {
    const currentFingerprint = getMessageFingerprint(messages[i]);
    if (currentFingerprint !== lastMessageFingerprints[i]) {
      return true; // Message was modified
    }
  }

  return false;
}

/**
 * Convert Vercel AI SDK messages to a single string prompt
 * Handles tool results by converting them to XML format
 *
 * Session Resume Logic:
 * - When resuming a session (sessionId provided), only sends NEW messages
 * - Requires lastProcessedMessageCount in providerOptions to track what was sent
 * - Detects rewind/edit via message fingerprints
 * - If inconsistency detected, ignores resume and creates new session
 * - If lastProcessedMessageCount not provided when resuming, sends only the last user message + pending tool results
 */
export function convertMessagesToString(
  options: LanguageModelV2CallOptions,
  isResuming: boolean
): MessageConversionResult {
  const promptParts: string[] = [];
  const messages = options.prompt;

  // Extract provider options
  const providerOptions = options.providerOptions?.['claude-code'] as
    | Record<string, unknown>
    | undefined;
  const lastProcessedCount =
    providerOptions && 'lastProcessedMessageCount' in providerOptions &&
    typeof providerOptions.lastProcessedMessageCount === 'number'
      ? providerOptions.lastProcessedMessageCount
      : undefined;
  const lastMessageFingerprints =
    providerOptions && 'messageFingerprints' in providerOptions &&
    Array.isArray(providerOptions.messageFingerprints)
      ? (providerOptions.messageFingerprints as string[])
      : undefined;

  // Detect if messages were rewound or modified
  let shouldForceNewSession = false;
  if (isResuming && lastProcessedCount !== undefined) {
    const inconsistent = detectMessageInconsistency(
      messages,
      lastProcessedCount,
      lastMessageFingerprints
    );
    if (inconsistent) {
      // Message history changed - can't safely resume, force new session
      shouldForceNewSession = true;
      isResuming = false; // Treat as new session
    }
  }

  // Determine which messages to process
  let messagesToProcess = messages;
  if (isResuming) {
    if (lastProcessedCount !== undefined) {
      // Skip already processed messages
      messagesToProcess = messages.slice(lastProcessedCount);
    } else {
      // No tracking info - only send last user message and any tool results after it
      // This is safer than sending full history which would duplicate
      const lastUserIndex = messages.findLastIndex((m) => m.role === 'user');
      if (lastUserIndex !== -1) {
        messagesToProcess = messages.slice(lastUserIndex);
      }
    }
  }

  // Convert messages to prompt string
  for (const message of messagesToProcess) {
    if (message.role === 'user') {
      // Handle both array and non-array content
      const content = Array.isArray(message.content) ? message.content : [message.content];
      const textParts = content
        .filter((part) => typeof part === 'object' && part.type === 'text')
        .map((part) => part.text);

      if (textParts.length > 0) {
        promptParts.push(textParts.join('\n'));
      }
    } else if (message.role === 'assistant') {
      // Handle both array and non-array content
      const content = Array.isArray(message.content) ? message.content : [message.content];
      const textParts = content
        .filter((part) => typeof part === 'object' && part.type === 'text')
        .map((part) => part.text);

      if (textParts.length > 0) {
        // Prefix assistant messages for context
        promptParts.push(`Previous assistant response: ${textParts.join('\n')}`);
      }
    } else if (message.role === 'tool') {
      // Convert tool results to XML format for Claude
      const content = Array.isArray(message.content) ? message.content : [message.content];
      const toolResults: string[] = [];

      for (const part of content) {
        if (typeof part === 'object' && 'toolCallId' in part && 'output' in part) {
          // Check if it's an error
          const isError =
            part.output &&
            typeof part.output === 'object' &&
            'type' in part.output &&
            (part.output.type === 'error-text' || part.output.type === 'error-json');

          let resultValue: unknown;
          if (part.output && typeof part.output === 'object' && 'value' in part.output) {
            resultValue = part.output.value;
          } else {
            resultValue = part.output;
          }

          toolResults.push(formatToolResult(part.toolCallId, resultValue, isError));
        }
      }

      if (toolResults.length > 0) {
        promptParts.push(toolResults.join('\n\n'));
      }
    }
  }

  // Generate fingerprints for all messages (for next call's consistency check)
  const messageFingerprints = messages.map((msg) => getMessageFingerprint(msg));

  return {
    prompt: promptParts.join('\n\n'),
    shouldForceNewSession,
    messageFingerprints,
  };
}
