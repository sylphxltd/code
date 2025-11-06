/**
 * MessageList Component
 *
 * Simple nested rendering - each message renders its own header + parts
 */

import type { SessionMessage } from '@sylphx/code-core';
import { formatTokenCount } from '@sylphx/code-core';
import { Box, Text } from 'ink';
import React from 'react';
import { MessagePart } from './MessagePart.js';

interface MessageListProps {
  messages: SessionMessage[];
  attachmentTokens: Map<string, number>;
}

export function MessageList({ messages, attachmentTokens }: MessageListProps) {
  return (
    <>
      {messages.map((msg) => (
        <Box key={msg.id} flexDirection="column">
          {/* Message Header */}
          <Box paddingTop={1} paddingX={1}>
            {msg.role === 'user' ? (
              <Text color="#00D9FF">▌ YOU</Text>
            ) : (
              <Text color="#00FF88">▌ SYLPHX</Text>
            )}
          </Box>

          {/* Message Content (Step-based or fallback to content array) */}
          {msg.steps && msg.steps.length > 0 ? (
            // Step-based structure (new architecture)
            msg.steps.flatMap((step) =>
              step.parts.map((part, partIdx) => (
                <MessagePart key={`${msg.id}-step-${step.stepIndex}-part-${partIdx}`} part={part} />
              ))
            )
          ) : msg.content && msg.content.length > 0 ? (
            // Legacy content array (fallback for streaming or old messages)
            msg.content.map((part, partIdx) => (
              <MessagePart key={`${msg.id}-part-${partIdx}`} part={part} />
            ))
          ) : msg.status === 'active' ? (
            // Active message with no content yet
            <Box paddingX={1} marginLeft={2}>
              <Text dimColor>...</Text>
            </Box>
          ) : null}

          {/* Attachments (for user messages) */}
          {msg.role === 'user' &&
            msg.attachments &&
            msg.attachments.length > 0 &&
            msg.attachments.map((att) => (
              <Box key={`att-${att.path}`} marginLeft={2}>
                <Text dimColor>Attached(</Text>
                <Text color="#00D9FF">{att.relativePath}</Text>
                <Text dimColor>)</Text>
                {attachmentTokens.has(att.path) && (
                  <>
                    <Text dimColor> </Text>
                    <Text dimColor>{formatTokenCount(attachmentTokens.get(att.path)!)} Tokens</Text>
                  </>
                )}
              </Box>
            ))}

          {/* Footer (for assistant messages) */}
          {msg.role === 'assistant' &&
            msg.status !== 'active' &&
            (msg.status === 'abort' || msg.status === 'error' || msg.usage) && (
              <Box flexDirection="column">
                {msg.status === 'abort' && (
                  <Box marginLeft={2} marginBottom={1}>
                    <Text color="#FFD700">[Aborted]</Text>
                  </Box>
                )}
                {msg.status === 'error' && (
                  <Box marginLeft={2} marginBottom={1}>
                    <Text color="#FF3366">[Error]</Text>
                  </Box>
                )}
                {msg.usage && (
                  <Box marginLeft={2}>
                    <Text dimColor>
                      {msg.usage.promptTokens.toLocaleString()} →{' '}
                      {msg.usage.completionTokens.toLocaleString()}
                    </Text>
                  </Box>
                )}
              </Box>
            )}
        </Box>
      ))}
    </>
  );
}
