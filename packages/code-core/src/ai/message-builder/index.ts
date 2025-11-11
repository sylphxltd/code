/**
 * Message Builder
 * Converts database messages to AI SDK format
 */

import type { Message, MessageStep, ModelCapabilities } from '@sylphx/code-core';
import type { ModelMessage, UserContent, AssistantContent } from 'ai';
import type { ToolCallPart, ToolResultPart } from '@ai-sdk/provider';
import { buildSystemStatusFromMetadata, buildTodoContext } from '@sylphx/code-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import type { FileRepository } from '@sylphx/code-core';

/**
 * Convert session messages to AI SDK ModelMessage format
 * Transforms frozen database content to AI SDK format (no file reading)
 *
 * Step-level system messages: Each step can have a systemMessage field
 * that is inserted as a 'user' role message BEFORE the step's content
 *
 * @param fileRepo Optional FileRepository for loading file-ref content
 *   If not provided, file-ref parts will be skipped (for backward compatibility)
 */
export async function buildModelMessages(
  messages: Message[],
  modelCapabilities?: ModelCapabilities,
  fileRepo?: FileRepository
): Promise<ModelMessage[]> {
  const results: ModelMessage[] = [];

  for (const msg of messages) {
    // Role mapping: session 'system' → model 'user' (for attention decay)
    if (msg.role === 'user' || msg.role === 'system') {
      results.push(await buildUserMessage(msg, modelCapabilities, fileRepo));
    } else {
      // Assistant messages: may have multiple steps, each with optional systemMessage
      await buildAssistantMessageWithSteps(msg, modelCapabilities, fileRepo, results);
    }
  }

  return results;
}

/**
 * Build user message with system status, todo context, and frozen content
 *
 * IMPORTANT: No file reading from disk - all file content is frozen in database
 * - Legacy: base64 in step_parts JSON
 * - New: BLOB in file_contents table (referenced by file-ref)
 */
async function buildUserMessage(
  msg: Message,
  modelCapabilities?: ModelCapabilities,
  fileRepo?: FileRepository
): Promise<ModelMessage> {
  const contentParts: UserContent = [];

  // Check model capabilities
  const supportsFileInput = modelCapabilities?.has('file-input') || false;
  const supportsImageInput = modelCapabilities?.has('image-input') || false;

  // REMOVED: System status metadata injection
  // Rationale: System status is now provided via dynamic system messages
  // - Resource warnings (CPU/Memory > 80%) triggered when needed
  // - Avoids polluting every message with redundant status info
  // - System messages use <system_message> tags for LLM recognition
  //
  // See: system-messages/index.ts for new approach

  // REMOVED: Todo context from snapshot
  // Rationale: todoSnapshot no longer stored in database (performance optimization)
  // - Todos managed at session level (session.todos)
  // - Session start todo hints provided via system messages
  // - See: TODOSNAPSHOT-REALITY.md for details

  // Transform frozen content (NO file reading from disk!)
  // Content order is preserved: [text, file, text] stays as [text, file, text]
  if (msg.steps && msg.steps.length > 0) {
    // Step-based structure: aggregate content from all steps
    for (const step of msg.steps) {
      for (const part of step.parts) {
        if (part.type === 'text') {
          contentParts.push({ type: 'text', text: part.content });
        } else if (part.type === 'file-ref') {
          // NEW: File content in file_contents table
          if (!fileRepo) {
            console.warn('[buildUserMessage] file-ref found but no fileRepo provided, skipping');
            continue;
          }

          const fileContent = await fileRepo.getFileContent(part.fileContentId);
          if (!fileContent) {
            console.error(`[buildUserMessage] File not found: ${part.fileContentId}`);
            contentParts.push({ type: 'text', text: `[Error: File not found: ${part.relativePath}]` });
            continue;
          }

          const buffer = fileContent.content;
          const isImage = part.mediaType.startsWith('image/');
          const canSendAsFile = supportsFileInput || (isImage && supportsImageInput);

          if (canSendAsFile) {
            contentParts.push({
              type: 'file' as const,
              data: buffer,
              mediaType: part.mediaType,
              filename: part.relativePath,
            });
          } else {
            // Convert to XML text
            if (part.mediaType.startsWith('text/') || part.mediaType === 'application/json') {
              const text = buffer.toString('utf-8');
              contentParts.push({
                type: 'text',
                text: `<file path="${part.relativePath}">\n${text}\n</file>`,
              });
            } else {
              contentParts.push({
                type: 'text',
                text: `<file path="${part.relativePath}" type="${part.mediaType}" size="${part.size}">\n[Binary file content not shown]\n</file>`,
              });
            }
          }
        } else if (part.type === 'file') {
          // LEGACY: File content frozen as base64 in step_parts
          const buffer = Buffer.from(part.base64, 'base64');
          const isImage = part.mediaType.startsWith('image/');
          const canSendAsFile = supportsFileInput || (isImage && supportsImageInput);

          if (canSendAsFile) {
            contentParts.push({
              type: 'file' as const,
              data: buffer,
              mediaType: part.mediaType,
              filename: part.relativePath,
            });
          } else {
            if (part.mediaType.startsWith('text/') || part.mediaType === 'application/json') {
              const text = buffer.toString('utf-8');
              contentParts.push({
                type: 'text',
                text: `<file path="${part.relativePath}">\n${text}\n</file>`,
              });
            } else {
              contentParts.push({
                type: 'text',
                text: `<file path="${part.relativePath}" type="${part.mediaType}" size="${part.size}">\n[Binary file content not shown]\n</file>`,
              });
            }
          }
        } else if (part.type === 'error') {
          contentParts.push({ type: 'text', text: `[Error: ${part.error}]` });
        }
      }
    }
  }

  // IMPORTANT: Always return 'user' role for model messages
  // Session 'system' and 'user' both map to model 'user' (for attention decay)
  return { role: 'user', content: contentParts };
}

/**
 * Build assistant message with steps (handles step-level system messages)
 * Each step can have systemMessages array that is inserted BEFORE the step content
 *
 * IMPORTANT: Separates tool-calls and tool-results into different messages
 * - assistant message: contains tool-call parts only
 * - tool message: contains tool-result parts (if any)
 */
async function buildAssistantMessageWithSteps(
  msg: Message,
  modelCapabilities?: ModelCapabilities,
  fileRepo?: FileRepository,
  results: ModelMessage[]
): Promise<void> {
  if (msg.steps && msg.steps.length > 0) {
    // Step-based structure: process each step with its optional systemMessages
    for (const step of msg.steps) {
      // If step has systemMessages, insert them as 'user' role messages BEFORE step content
      if (step.systemMessages && step.systemMessages.length > 0) {
        // Combine all system messages with headers
        const combinedContent = step.systemMessages
          .map(sm => {
            // Add type header for context
            return `<system_message type="${sm.type}">\n${sm.content}\n</system_message>`;
          })
          .join('\n\n');

        results.push({
          role: 'user',
          content: [{ type: 'text', text: combinedContent }],
        });
      }

      // Build assistant message for this step (separates tool-calls and tool-results)
      await buildAssistantMessage(msg, modelCapabilities, fileRepo, [step], results);
    }
  } else {
    // Legacy: no steps, build as single message
    await buildAssistantMessage(msg, modelCapabilities, fileRepo, undefined, results);
  }
}

/**
 * Build assistant message from steps or legacy content
 *
 * IMPORTANT: Separates tool-calls and tool-results into different messages
 * - assistant message: contains text, reasoning, tool-call parts
 * - tool message: contains tool-result parts (created separately if needed)
 *
 * @param stepsOverride Optional: only build from these steps (for step-by-step processing)
 * @param results Array to append messages to
 */
async function buildAssistantMessage(
  msg: Message,
  modelCapabilities?: ModelCapabilities,
  fileRepo?: FileRepository,
  stepsOverride?: MessageStep[],
  results?: ModelMessage[]
): Promise<void> {
  const assistantContent: AssistantContent = [];
  const toolResults: ToolResultPart[] = [];

  // Check if model supports image input
  const supportsImageInput = modelCapabilities?.has('image-input') ?? false;

  // Use provided steps or all steps
  const steps = stepsOverride || msg.steps || [];

  if (steps.length > 0) {
    // Step-based structure: aggregate content from steps
    for (const step of steps) {
      for (const part of step.parts) {
        switch (part.type) {
          case 'text':
            assistantContent.push({ type: 'text', text: part.content });
            break;

          case 'reasoning':
            assistantContent.push({ type: 'reasoning', text: part.content });
            break;

          case 'tool':
            // Tool-call goes in assistant message
            assistantContent.push({
              type: 'tool-call',
              toolCallId: part.toolId,
              toolName: part.name,
              args: part.args || {},
            } as ToolCallPart);

            // Tool-result goes in separate tool message (if present)
            if (part.result !== undefined) {
              toolResults.push({
                type: 'tool-result',
                toolCallId: part.toolId,
                toolName: part.name,
                result: part.result,
              } as ToolResultPart);
            }
            break;

          case 'file':
            // Handle file parts - use AI SDK's FilePart type
            if (part.mediaType.startsWith('image/')) {
              if (supportsImageInput) {
                assistantContent.push({
                  type: 'file',
                  data: part.base64,
                  mediaType: part.mediaType,
                });
              } else {
                // Save to temp and provide path
                try {
                  const ext = part.mediaType.split('/')[1] || 'png';
                  const filename = `sylphx-${randomBytes(8).toString('hex')}.${ext}`;
                  const filepath = join(tmpdir(), filename);
                  const buffer = Buffer.from(part.base64, 'base64');
                  writeFileSync(filepath, buffer);
                  assistantContent.push({
                    type: 'text',
                    text: `[I generated an image and saved it to: ${filepath}]`,
                  });
                } catch (err) {
                  assistantContent.push({
                    type: 'text',
                    text: `[I generated an image but failed to save it]`,
                  });
                }
              }
            } else {
              assistantContent.push({
                type: 'file',
                data: part.base64,
                mediaType: part.mediaType,
              });
            }
            break;

          case 'error':
            assistantContent.push({ type: 'text', text: `[Error: ${part.error}]` });
            break;

          case 'system-message':
            // Skip - already handled at step level
            break;
        }
      }
    }
  } else if (msg.content) {
    // LEGACY: Direct content array (for backward compatibility)
    for (const part of msg.content) {
      switch (part.type) {
        case 'text':
          assistantContent.push({ type: 'text', text: part.content });
          break;

        case 'reasoning':
          assistantContent.push({ type: 'reasoning', text: part.content });
          break;

        case 'tool':
          assistantContent.push({
            type: 'tool-call',
            toolCallId: part.toolId,
            toolName: part.name,
            args: part.args || {},
          } as ToolCallPart);

          if (part.result !== undefined) {
            toolResults.push({
              type: 'tool-result',
              toolCallId: part.toolId,
              toolName: part.name,
              result: part.result,
            } as ToolResultPart);
          }
          break;

        case 'file':
          if (part.mediaType.startsWith('image/')) {
            if (supportsImageInput) {
              assistantContent.push({
                type: 'file',
                data: part.base64,
                mediaType: part.mediaType,
              });
            } else {
              try {
                const ext = part.mediaType.split('/')[1] || 'png';
                const filename = `sylphx-${randomBytes(8).toString('hex')}.${ext}`;
                const filepath = join(tmpdir(), filename);
                const buffer = Buffer.from(part.base64, 'base64');
                writeFileSync(filepath, buffer);
                assistantContent.push({
                  type: 'text',
                  text: `[I generated an image and saved it to: ${filepath}]`,
                });
              } catch (err) {
                assistantContent.push({
                  type: 'text',
                  text: `[I generated an image but failed to save it]`,
                });
              }
            }
          } else {
            assistantContent.push({
              type: 'file',
              data: part.base64,
              mediaType: part.mediaType,
            });
          }
          break;

        case 'error':
          assistantContent.push({ type: 'text', text: `[Error: ${part.error}]` });
          break;

        case 'system-message':
          // Skip - already handled at step level
          break;
      }
    }
  }

  // Add status annotation
  if (msg.status === 'abort') {
    assistantContent.push({
      type: 'text',
      text: '[This response was aborted by the user]',
    });
  } else if (msg.status === 'error') {
    assistantContent.push({
      type: 'text',
      text: '[This response ended with an error]',
    });
  }

  // Push assistant message (only if not empty)
  if (results) {
    if (assistantContent.length > 0) {
      results.push({ role: 'assistant', content: assistantContent });
    }

    // Push tool message if there are tool results
    if (toolResults.length > 0) {
      results.push({ role: 'tool', content: toolResults });
    }
  }
}
