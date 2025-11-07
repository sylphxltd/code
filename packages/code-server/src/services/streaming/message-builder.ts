/**
 * Message Builder
 * Converts database messages to AI SDK format
 */

import type { Message } from '@sylphx/code-core';
import type { ModelMessage, UserContent, AssistantContent } from 'ai';
import type { ToolCallPart, ToolResultPart } from '@ai-sdk/provider';
import { buildSystemStatusFromMetadata, buildTodoContext } from '@sylphx/code-core';

/**
 * Convert session messages to AI SDK ModelMessage format
 */
export async function buildModelMessages(messages: Message[]): Promise<ModelMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      if (msg.role === 'user') {
        return buildUserMessage(msg);
      } else {
        return buildAssistantMessage(msg);
      }
    })
  );
}

/**
 * Build user message with system status, todo context, and attachments
 */
async function buildUserMessage(msg: Message): Promise<ModelMessage> {
  const contentParts: UserContent = [];

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

  // Add message content (aggregate from all steps)
  if (msg.steps && msg.steps.length > 0) {
    // Step-based structure: aggregate content from all steps
    for (const step of msg.steps) {
      step.parts.forEach((part) => {
        if (part.type === 'text' && part.content) {
          contentParts.push({ type: 'text', text: part.content });
        }
      });
    }
  } else if (msg.content) {
    // LEGACY: Direct content array (for backward compatibility)
    msg.content.forEach((part) => {
      if (part.type === 'text' && part.content) {
        contentParts.push({ type: 'text', text: part.content });
      }
    });
  }

  // Add file attachments
  if (msg.attachments && msg.attachments.length > 0) {
    for (const attachment of msg.attachments) {
      const fs = await import('node:fs/promises');
      try {
        const content = await fs.readFile(attachment.path, 'utf-8');
        contentParts.push({
          type: 'file',
          data: content,
          mimeType: 'text/plain',
        });
      } catch (error) {
        console.error(`Failed to read attachment: ${attachment.path}`, error);
      }
    }
  }

  return { role: msg.role as 'user', content: contentParts };
}

/**
 * Build assistant message from steps or legacy content
 */
function buildAssistantMessage(msg: Message): ModelMessage {
  let contentParts: AssistantContent = [];

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
            // Convert file part to image part for LLM context
            // LLM should know it generated this image
            if (part.mediaType.startsWith('image/')) {
              return [
                {
                  type: 'image' as const,
                  image: `data:${part.mediaType};base64,${part.base64}`,
                },
              ];
            }
            // Non-image files: just note it was generated
            return [{ type: 'text' as const, text: `[Generated file: ${part.mediaType}]` }];

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
          // Convert file part to image part for LLM context
          if (part.mediaType.startsWith('image/')) {
            return [
              {
                type: 'image' as const,
                image: `data:${part.mediaType};base64,${part.base64}`,
              },
            ];
          }
          return [{ type: 'text' as const, text: `[Generated file: ${part.mediaType}]` }];

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
