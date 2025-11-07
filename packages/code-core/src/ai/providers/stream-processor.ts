/**
 * Stream Processor
 * Handles streaming response processing with XML parsing
 */

import type { LanguageModelV2FinishReason, LanguageModelV2StreamPart } from '@ai-sdk/provider';
import type { ToolDefinition } from './text-based-tools.js';
import { StreamingXMLParser } from './streaming-xml-parser.js';
import { extractUsage, handleResultError } from './usage-handler.js';

export interface StreamProcessorOptions {
  queryResult: AsyncIterable<any>;
  tools: Record<string, ToolDefinition> | undefined;
  totalMessageCount: number;
  messageFingerprints: string[];
  shouldForceNewSession: boolean;
}

/**
 * Process streaming query result and emit LanguageModelV2StreamPart events
 */
export async function* processStream(
  options: StreamProcessorOptions
): AsyncGenerator<LanguageModelV2StreamPart> {
  const { queryResult, tools, totalMessageCount, messageFingerprints, shouldForceNewSession } =
    options;

  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: LanguageModelV2FinishReason = 'stop';
  let hasStartedText = false;
  let hasEmittedTextEnd = false;
  let sessionId: string | undefined;
  // Track thinking block indices for streaming
  const thinkingBlockIndices = new Set<number>();
  // XML parser for streaming tool call detection
  const xmlParser = tools && Object.keys(tools).length > 0 ? new StreamingXMLParser() : null;

  for await (const event of queryResult) {
    // Extract session ID from any event (all events have session_id)
    if ('session_id' in event && typeof event.session_id === 'string') {
      sessionId = event.session_id;
    }

    // Handle streaming events from Anthropic SDK
    if (event.type === 'stream_event') {
      const streamEvent = event.event;

      // Handle content block start (thinking or text)
      if (streamEvent.type === 'content_block_start') {
        if (streamEvent.content_block.type === 'thinking') {
          // Start of thinking block - emit reasoning-start
          thinkingBlockIndices.add(streamEvent.index);
          yield {
            type: 'reasoning-start',
            id: `reasoning-${streamEvent.index}`,
          };
        }
      }
      // Handle content block deltas
      else if (streamEvent.type === 'content_block_delta') {
        if (streamEvent.delta.type === 'thinking_delta') {
          // Thinking delta - emit reasoning-delta
          yield {
            type: 'reasoning-delta',
            id: `reasoning-${streamEvent.index}`,
            delta: streamEvent.delta.thinking,
          };
        } else if (streamEvent.delta.type === 'text_delta') {
          // Text delta - parse through XML parser if tools available
          if (xmlParser) {
            // All text should be wrapped in <text> tags per system prompt
            for (const xmlEvent of xmlParser.processChunk(streamEvent.delta.text)) {
              if (xmlEvent.type === 'text-start') {
                if (!hasStartedText) {
                  yield {
                    type: 'text-start',
                    id: 'text-0',
                  };
                  hasStartedText = true;
                }
              } else if (xmlEvent.type === 'text-delta') {
                yield {
                  type: 'text-delta',
                  id: 'text-0',
                  delta: xmlEvent.delta,
                };
              } else if (xmlEvent.type === 'tool-input-start') {
                yield {
                  type: 'tool-input-start',
                  id: xmlEvent.toolCallId,
                  toolName: xmlEvent.toolName,
                };
              } else if (xmlEvent.type === 'tool-input-delta') {
                yield {
                  type: 'tool-input-delta',
                  id: xmlEvent.toolCallId,
                  delta: xmlEvent.delta,
                };
              } else if (xmlEvent.type === 'tool-input-end') {
                yield {
                  type: 'tool-input-end',
                  id: xmlEvent.toolCallId,
                };
              } else if (xmlEvent.type === 'tool-call-complete') {
                yield {
                  type: 'tool-call',
                  toolCallId: xmlEvent.toolCallId,
                  toolName: xmlEvent.toolName,
                  input: JSON.stringify(xmlEvent.arguments),
                };
                finishReason = 'tool-calls';
              }
            }
          } else {
            // No tools - emit text directly
            if (!hasStartedText) {
              yield {
                type: 'text-start',
                id: 'text-0',
              };
              hasStartedText = true;
            }
            yield {
              type: 'text-delta',
              id: 'text-0',
              delta: streamEvent.delta.text,
            };
          }
        }
      }
      // Handle content block stop
      else if (streamEvent.type === 'content_block_stop') {
        if (thinkingBlockIndices.has(streamEvent.index)) {
          // End of thinking block - emit reasoning-end
          yield {
            type: 'reasoning-end',
            id: `reasoning-${streamEvent.index}`,
          };
          thinkingBlockIndices.delete(streamEvent.index);
        } else if (hasStartedText) {
          // End of text block - flush XML parser if tools are available
          if (xmlParser) {
            for (const xmlEvent of xmlParser.flush()) {
              if (xmlEvent.type === 'text-delta') {
                yield {
                  type: 'text-delta',
                  id: 'text-0',
                  delta: xmlEvent.delta,
                };
              } else if (xmlEvent.type === 'text-end') {
                yield {
                  type: 'text-end',
                  id: 'text-0',
                };
                hasEmittedTextEnd = true;
              } else if (xmlEvent.type === 'tool-input-delta') {
                yield {
                  type: 'tool-input-delta',
                  id: xmlEvent.toolCallId,
                  delta: xmlEvent.delta,
                };
              } else if (xmlEvent.type === 'tool-input-end') {
                yield {
                  type: 'tool-input-end',
                  id: xmlEvent.toolCallId,
                };
              } else if (xmlEvent.type === 'tool-call-complete') {
                yield {
                  type: 'tool-call',
                  toolCallId: xmlEvent.toolCallId,
                  toolName: xmlEvent.toolName,
                  input: JSON.stringify(xmlEvent.arguments),
                };
                finishReason = 'tool-calls';
              }
            }
          }

          // Emit text-end if flush didn't emit it
          if (!hasEmittedTextEnd) {
            yield {
              type: 'text-end',
              id: 'text-0',
            };
            hasEmittedTextEnd = true;
          }
        }
      }
    } else if (event.type === 'assistant') {
      // Extract content from assistant message
      // Note: With includePartialMessages: true, content has already been streamed
      // via stream_event. We only need to handle final metadata here.

      // Check stop reason
      if (event.message.stop_reason === 'end_turn') {
        // Keep tool-calls finish reason if we detected tool calls
        if (finishReason !== 'tool-calls') {
          finishReason = 'stop';
        }
      } else if (event.message.stop_reason === 'max_tokens') {
        finishReason = 'length';
      }
    } else if (event.type === 'result') {
      // Check for errors
      handleResultError(event);

      // Extract usage
      const usage = extractUsage(event);
      inputTokens = usage.inputTokens;
      outputTokens = usage.outputTokens;
    }
  }

  // Emit text-end if we started text but haven't emitted text-end yet
  if (hasStartedText && !hasEmittedTextEnd) {
    yield {
      type: 'text-end',
      id: 'text-0',
    };
  }

  // Emit finish
  yield {
    type: 'finish',
    finishReason,
    usage: {
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      totalTokens: inputTokens + outputTokens,
    },
    providerMetadata: sessionId
      ? {
          'claude-code': {
            sessionId,
            messageCount: totalMessageCount,
            messageFingerprints: messageFingerprints,
            forcedNewSession: shouldForceNewSession,
          },
        }
      : {},
  };
}
