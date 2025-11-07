/**
 * Parse User Input
 * Converts user input string with @file references into ordered content parts
 */

import type { FileAttachment } from '@sylphx/code-core';

/**
 * Content part from parsing user input
 */
export type ParsedContentPart =
  | { type: 'text'; content: string }
  | {
      type: 'file';
      path: string;
      relativePath: string;
      size?: number;
      mimeType?: string;
    };

/**
 * Result of parsing user input
 */
export interface ParsedUserInput {
  parts: ParsedContentPart[];
}

/**
 * Parse user input into ordered content parts
 *
 * Converts:
 * - "I share @file.pdf to you" + attachments=[{relativePath: "file.pdf", ...}]
 * Into:
 * - [{type: 'text', content: 'I share '}, {type: 'file', ...}, {type: 'text', content: ' to you'}]
 *
 * Benefits:
 * - Preserves order of text and files
 * - Semantic correctness
 * - Backend just needs to transform, not parse
 *
 * @param input - User input string with @file references
 * @param pendingAttachments - Files that user selected via autocomplete
 * @returns Ordered content parts
 */
export function parseUserInput(
  input: string,
  pendingAttachments: FileAttachment[]
): ParsedUserInput {
  const parts: ParsedContentPart[] = [];

  // Validate input
  if (typeof input !== 'string') {
    console.error('[parseUserInput] Invalid input type:', typeof input);
    return { parts: [] };
  }

  if (!Array.isArray(pendingAttachments)) {
    console.error('[parseUserInput] Invalid attachments type:', typeof pendingAttachments);
    return { parts: [{ type: 'text', content: input }] };
  }

  // Create map for fast lookup
  const attachmentMap = new Map(
    pendingAttachments.map((a) => [a.relativePath, a])
  );

  // Match @filename pattern (any non-whitespace after @)
  const regex = /@([^\s]+)/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(input)) !== null) {
    const matchStart = match.index;

    // Add text before @file (if any)
    if (matchStart > lastIndex) {
      const text = input.slice(lastIndex, matchStart);
      if (text) {
        parts.push({ type: 'text', content: text });
      }
    }

    // Check if this @filename has a matching attachment
    const fileName = match[1];
    const attachment = attachmentMap.get(fileName);

    if (attachment) {
      // Valid @file reference - add as file part
      parts.push({
        type: 'file',
        path: attachment.path,
        relativePath: attachment.relativePath,
        size: attachment.size,
        mimeType: attachment.mimeType,
      });
    } else {
      // Invalid reference (no matching attachment) - keep as text
      parts.push({ type: 'text', content: match[0] });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last match (if any)
  if (lastIndex < input.length) {
    const text = input.slice(lastIndex);
    if (text) {
      parts.push({ type: 'text', content: text });
    }
  }

  // Handle empty input or input with no text after removing @file refs
  if (parts.length === 0 && input.length > 0) {
    // Input was only whitespace or invalid @refs
    parts.push({ type: 'text', content: input });
  }

  // Handle completely empty input - return at least one empty text part
  // This prevents validation errors downstream
  if (parts.length === 0) {
    console.error('[parseUserInput] Input resulted in empty parts array, adding empty text part');
    parts.push({ type: 'text', content: '' });
  }

  return { parts };
}
