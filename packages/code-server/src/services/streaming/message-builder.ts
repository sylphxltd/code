/**
 * Message Builder
 * Converts database messages to AI SDK format
 */

import type { Message, ModelCapabilities } from '@sylphx/code-core';
import type { ModelMessage, UserContent, AssistantContent } from 'ai';
import type { ToolCallPart, ToolResultPart } from '@ai-sdk/provider';
import { buildSystemStatusFromMetadata, buildTodoContext } from '@sylphx/code-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * Convert session messages to AI SDK ModelMessage format
 * Transforms frozen database content to AI SDK format (no file reading)
 */
export function buildModelMessages(
  messages: Message[],
  modelCapabilities?: ModelCapabilities
): ModelMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'user') {
      return buildUserMessage(msg, modelCapabilities);
    } else {
      return buildAssistantMessage(msg, modelCapabilities);
    }
  });
}

/**
 * Build user message with system status, todo context, and frozen content
 *
 * IMPORTANT: No file reading - all file content is frozen as base64 in database
 * This ensures immutable history and preserves order with text content
 */
function buildUserMessage(msg: Message, modelCapabilities?: ModelCapabilities): ModelMessage {
  const contentParts: UserContent = [];

  // Check model capabilities
  const supportsFileInput = modelCapabilities?.has('file-input') || false;
  const supportsImageInput = modelCapabilities?.has('image-input') || false;

  // Inject system status from metadata
  if (msg.metadata) {
    const systemStatusString = buildSystemStatusFromMetadata({
      timestamp: new Date(msg.timestamp).toISOString(),
      cpu: msg.metadata.cpu || 'N/A',
      memory: msg.metadata.memory || 'N/A',
    });
    contentParts.push({ type: 'text', text: systemStatusString });
  }

  // Inject todo context from snapshot
  if (msg.todoSnapshot && msg.todoSnapshot.length > 0) {
    const todoContext = buildTodoContext(msg.todoSnapshot);
    contentParts.push({ type: 'text', text: todoContext });
  }

  // Transform frozen content (NO file reading!)
  // Content order is preserved: [text, file, text] stays as [text, file, text]
  if (msg.steps && msg.steps.length > 0) {
    // Step-based structure: aggregate content from all steps
    for (const step of msg.steps) {
      for (const part of step.parts) {
        if (part.type === 'text') {
          contentParts.push({ type: 'text', text: part.content });
        } else if (part.type === 'file') {
          // File content is frozen in database as base64
          const buffer = Buffer.from(part.base64, 'base64');
          const isImage = part.mediaType.startsWith('image/');

          // Determine if we can send as FilePart
          const canSendAsFile = supportsFileInput || (isImage && supportsImageInput);

          if (canSendAsFile) {
            // Model supports this file type - send as FilePart
            contentParts.push({
              type: 'file',
              data: buffer,
              mediaType: part.mediaType,
              filename: part.relativePath,
            });
          } else {
            // Model doesn't support this file type - convert to XML text
            if (part.mediaType.startsWith('text/') || part.mediaType === 'application/json') {
              // Text file - include content
              const text = buffer.toString('utf-8');
              contentParts.push({
                type: 'text',
                text: `<file path="${part.relativePath}">\n${text}\n</file>`,
              });
            } else {
              // Binary file - just mention it
              contentParts.push({
                type: 'text',
                text: `<file path="${part.relativePath}" type="${part.mediaType}" size="${part.size}" encoding="base64">\n[Binary file content not shown]\n</file>`,
              });
            }
          }
        } else if (part.type === 'error') {
          // Error reading file - show error message
          contentParts.push({ type: 'text', text: `[Error: ${part.error}]` });
        }
      }
    }
  }

  return { role: msg.role as 'user', content: contentParts };
}

/**
 * Build assistant message from steps or legacy content
 */
function buildAssistantMessage(msg: Message, modelCapabilities?: ModelCapabilities): ModelMessage {
  let contentParts: AssistantContent = [];

  // Check if model supports image input
  const supportsImageInput = modelCapabilities?.has('image-input') ?? false;

  if (msg.steps && msg.steps.length > 0) {
    // Step-based structure: aggregate content from all steps
    contentParts = msg.steps.flatMap((step) =>
      step.parts.flatMap((part) => {
        switch (part.type) {
          case 'text':
            return [{ type: 'text' as const, text: part.content }];

          case 'reasoning':
            return [{ type: 'reasoning' as const, text: part.content }];

          case 'tool': {
            const parts: AssistantContent = [
              {
                type: 'tool-call' as const,
                toolCallId: part.toolId,
                toolName: part.name,
                input: part.args,
              } as ToolCallPart,
            ];

            if (part.result !== undefined) {
              parts.push({
                type: 'tool-result' as const,
                toolCallId: part.toolId,
                toolName: part.name,
                output: part.result,
              } as ToolResultPart);
            }

            return parts;
          }

          case 'file':
            // Handle file parts - use AI SDK's FilePart type
            // Check if model supports this file type
            if (part.mediaType.startsWith('image/')) {
              // Image files
              if (supportsImageInput) {
                // Model supports image-input: send as file part with base64 data
                return [
                  {
                    type: 'file' as const,
                    data: part.base64, // AI SDK accepts base64 string directly
                    mediaType: part.mediaType,
                  },
                ];
              } else {
                // Model doesn't support image-input: save to temp and provide path
                try {
                  const ext = part.mediaType.split('/')[1] || 'png';
                  const filename = `sylphx-${randomBytes(8).toString('hex')}.${ext}`;
                  const filepath = join(tmpdir(), filename);
                  const buffer = Buffer.from(part.base64, 'base64');
                  writeFileSync(filepath, buffer);
                  return [
                    {
                      type: 'text' as const,
                      text: `[I generated an image and saved it to: ${filepath}]`,
                    },
                  ];
                } catch (err) {
                  return [{ type: 'text' as const, text: `[I generated an image but failed to save it]` }];
                }
              }
            } else {
              // Non-image files: send as file part
              return [
                {
                  type: 'file' as const,
                  data: part.base64,
                  mediaType: part.mediaType,
                },
              ];
            }

          case 'error':
            return [{ type: 'text' as const, text: `[Error: ${part.error}]` }];

          default:
            return [];
        }
      })
    );
  } else if (msg.content) {
    // LEGACY: Direct content array (for backward compatibility)
    contentParts = msg.content.flatMap((part) => {
      switch (part.type) {
        case 'text':
          return [{ type: 'text' as const, text: part.content }];

        case 'reasoning':
          return [{ type: 'reasoning' as const, text: part.content }];

        case 'tool': {
          const parts: AssistantContent = [
            {
              type: 'tool-call' as const,
              toolCallId: part.toolId,
              toolName: part.name,
              input: part.args,
            } as ToolCallPart,
          ];

          if (part.result !== undefined) {
            parts.push({
              type: 'tool-result' as const,
              toolCallId: part.toolId,
              toolName: part.name,
              output: part.result,
            } as ToolResultPart);
          }

          return parts;
        }

        case 'file':
          // Handle file parts - use AI SDK's FilePart type
          if (part.mediaType.startsWith('image/')) {
            // Image files
            if (supportsImageInput) {
              // Model supports image-input: send as file part with base64 data
              return [
                {
                  type: 'file' as const,
                  data: part.base64,
                  mediaType: part.mediaType,
                },
              ];
            } else {
              // Model doesn't support image-input: save to temp and provide path
              try {
                const ext = part.mediaType.split('/')[1] || 'png';
                const filename = `sylphx-${randomBytes(8).toString('hex')}.${ext}`;
                const filepath = join(tmpdir(), filename);
                const buffer = Buffer.from(part.base64, 'base64');
                writeFileSync(filepath, buffer);
                return [
                  {
                    type: 'text' as const,
                    text: `[I generated an image and saved it to: ${filepath}]`,
                  },
                ];
              } catch (err) {
                return [{ type: 'text' as const, text: `[I generated an image but failed to save it]` }];
              }
            }
          } else {
            // Non-image files: send as file part
            return [
              {
                type: 'file' as const,
                data: part.base64,
                mediaType: part.mediaType,
              },
            ];
          }

        case 'error':
          return [{ type: 'text' as const, text: `[Error: ${part.error}]` }];

        default:
          return [];
      }
    });
  }

  // Add status annotation
  if (msg.status === 'abort') {
    contentParts.push({
      type: 'text',
      text: '[This response was aborted by the user]',
    });
  } else if (msg.status === 'error') {
    contentParts.push({
      type: 'text',
      text: '[This response ended with an error]',
    });
  }

  return { role: msg.role as 'assistant', content: contentParts };
}
