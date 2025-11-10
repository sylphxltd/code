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
import MarkdownText from './MarkdownText.js';

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
            ) : msg.role === 'system' ? (
              <Text color="#FFD700">▌ SYSTEM</Text>
            ) : (
              <Text color="#00FF88">▌ SYLPHX</Text>
            )}
          </Box>

          {/* Message Content (Step-based or fallback to content array) */}
          {msg.role === 'user' || msg.role === 'system' ? (
            // User/System message: reconstruct original text with inline @file highlighting
            msg.steps && msg.steps.length > 0 ? (
              <Box marginLeft={2} paddingY={1} flexDirection="column">
                {(() => {
                  // Reconstruct original text from parts
                  const parts = msg.steps.flatMap(step => step.parts);
                  let fullText = '';
                  const fileMap = new Map<string, boolean>();

                  for (const part of parts) {
                    if (part.type === 'text') {
                      fullText += part.content;
                    } else if (part.type === 'file') {
                      fullText += `@${part.relativePath}`;
                      fileMap.set(part.relativePath, true);
                    } else if (part.type === 'error') {
                      fullText += `[Error: ${part.error}]`;
                    }
                  }

                  // Split by newlines to preserve line breaks
                  const lines = fullText.split('\n');

                  return lines.map((line, lineIdx) => {
                    // Parse each line to find @file references
                    const segments: Array<{ text: string; isFile: boolean }> = [];
                    const fileRegex = /@([^\s]+)/g;
                    let lastIndex = 0;
                    let match;

                    while ((match = fileRegex.exec(line)) !== null) {
                      const matchStart = match.index;
                      const fileName = match[1];

                      // Add text before @file
                      if (matchStart > lastIndex) {
                        segments.push({ text: line.slice(lastIndex, matchStart), isFile: false });
                      }

                      // Add @file reference (only highlight if it's an actual attached file)
                      segments.push({
                        text: `@${fileName}`,
                        isFile: fileMap.has(fileName)
                      });

                      lastIndex = match.index + match[0].length;
                    }

                    // Add remaining text
                    if (lastIndex < line.length) {
                      segments.push({ text: line.slice(lastIndex), isFile: false });
                    }

                    // Render line with highlighted segments
                    return (
                      <Box key={`line-${lineIdx}`} flexDirection="row" flexWrap="wrap">
                        {segments.map((seg, segIdx) =>
                          seg.isFile ? (
                            <Text key={`line-${lineIdx}-seg-${segIdx}`} backgroundColor="#1a472a" color="#00FF88">
                              {seg.text}
                            </Text>
                          ) : (
                            <MarkdownText key={`line-${lineIdx}-seg-${segIdx}`}>{seg.text}</MarkdownText>
                          )
                        )}
                      </Box>
                    );
                  });
                })()}
              </Box>
            ) : msg.content && msg.content.length > 0 ? (
              <Box marginLeft={2} paddingY={1} flexDirection="column">
                {(() => {
                  // Same logic for legacy content array
                  let fullText = '';
                  const fileMap = new Map<string, boolean>();

                  for (const part of msg.content) {
                    if (part.type === 'text') {
                      fullText += part.content;
                    } else if (part.type === 'file') {
                      fullText += `@${part.relativePath}`;
                      fileMap.set(part.relativePath, true);
                    } else if (part.type === 'error') {
                      fullText += `[Error: ${part.error}]`;
                    }
                  }

                  const lines = fullText.split('\n');

                  return lines.map((line, lineIdx) => {
                    const segments: Array<{ text: string; isFile: boolean }> = [];
                    const fileRegex = /@([^\s]+)/g;
                    let lastIndex = 0;
                    let match;

                    while ((match = fileRegex.exec(line)) !== null) {
                      const matchStart = match.index;
                      const fileName = match[1];

                      if (matchStart > lastIndex) {
                        segments.push({ text: line.slice(lastIndex, matchStart), isFile: false });
                      }

                      segments.push({
                        text: `@${fileName}`,
                        isFile: fileMap.has(fileName)
                      });

                      lastIndex = match.index + match[0].length;
                    }

                    if (lastIndex < line.length) {
                      segments.push({ text: line.slice(lastIndex), isFile: false });
                    }

                    return (
                      <Box key={`legacy-line-${lineIdx}`} flexDirection="row" flexWrap="wrap">
                        {segments.map((seg, segIdx) =>
                          seg.isFile ? (
                            <Text key={`legacy-line-${lineIdx}-seg-${segIdx}`} backgroundColor="#1a472a" color="#00FF88">
                              {seg.text}
                            </Text>
                          ) : (
                            <MarkdownText key={`legacy-line-${lineIdx}-seg-${segIdx}`}>{seg.text}</MarkdownText>
                          )
                        )}
                      </Box>
                    );
                  });
                })()}
              </Box>
            ) : null
          ) : (
            // Assistant message: render each part separately (tools, reasoning, files, etc.)
            msg.steps && msg.steps.length > 0 ? (
              (() => {
                // Flatten all parts with globally unique index
                let globalPartIndex = 0;
                return msg.steps.flatMap((step) =>
                  step.parts.map((part) => (
                    <MessagePart key={`${msg.id}-part-${globalPartIndex++}`} part={part} />
                  ))
                );
              })()
            ) : msg.content && msg.content.length > 0 ? (
              msg.content.map((part, partIdx) => (
                <MessagePart key={`${msg.id}-part-${partIdx}`} part={part} />
              ))
            ) : msg.status === 'active' ? (
              <Box paddingX={1} marginLeft={2}>
                <Text dimColor>...</Text>
              </Box>
            ) : null
          )}

          {/* Attachments (for user/system messages) - extracted from steps.parts or content */}
          {(msg.role === 'user' || msg.role === 'system') && (() => {
            // Extract file parts from steps or content
            const fileParts = msg.steps && msg.steps.length > 0
              ? msg.steps.flatMap(step => step.parts).filter(part => part.type === 'file')
              : msg.content ? msg.content.filter(part => part.type === 'file') : [];

            return fileParts.map((filePart, idx) => (
              <Box key={`${msg.id}-file-${idx}`} marginLeft={2} marginBottom={1}>
                <Text color="#00FF88">✓ </Text>
                <Text bold>Read {filePart.relativePath}</Text>
              </Box>
            ));
          })()}

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
