/**
 * MessagePart Component
 * Unified rendering for both streaming and completed message parts
 *
 * PERFORMANCE: Memoized to prevent re-rendering unchanged message parts
 */

import { useElapsedTime } from '@sylphx/code-client';
import type { MessagePart as MessagePartType } from '@sylphx/code-core';
import { Box, Text } from 'ink';
import React, { useMemo, useEffect } from 'react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { exec } from 'node:child_process';
import MarkdownText from './MarkdownText.js';
import Spinner from './Spinner.js';
import { ToolDisplay } from './ToolDisplay.js';

interface MessagePartProps {
  part: MessagePartType | StreamingPart;
}

// Extended type for streaming parts - UNIFIED with status field
type StreamingPart =
  | { type: 'text'; content: string; status: 'active' | 'completed' | 'error' | 'abort' }
  | {
      type: 'reasoning';
      content: string;
      status: 'active' | 'completed' | 'error' | 'abort';
      duration?: number;
      startTime?: number;
    }
  | {
      type: 'tool';
      toolId: string;
      name: string;
      status: 'active' | 'completed' | 'error' | 'abort';
      duration?: number;
      args?: unknown;
      result?: unknown;
      error?: string;
      startTime?: number;
    }
  | { type: 'file'; mediaType: string; base64: string; status: 'completed' }
  | { type: 'error'; error: string; status: 'completed' };

export const MessagePart = React.memo(function MessagePart({ part }: MessagePartProps) {
  if (part.type === 'text') {
    return (
      <Box flexDirection="column" marginLeft={2} marginBottom={1}>
        <MarkdownText>{part.content}</MarkdownText>
      </Box>
    );
  }

  if (part.type === 'reasoning') {
    // Use unified status field
    const status = 'status' in part ? part.status : 'completed';
    const isActive = status === 'active';

    // Calculate real-time elapsed time for active reasoning
    const { display: durationDisplay } = useElapsedTime({
      startTime: part.startTime,
      duration: part.duration,
      isRunning: isActive,
    });

    if (isActive) {
      // Still streaming - show spinner with real-time duration
      return (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Box>
            <Spinner color="#FFD700" />
            <Text dimColor> Thinking... {durationDisplay}</Text>
          </Box>
        </Box>
      );
    } else {
      // Show completed reasoning with duration
      const seconds = part.duration ? Math.round(part.duration / 1000) : 0;
      return (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Box>
            <Text dimColor>Thought {seconds}s</Text>
          </Box>
        </Box>
      );
    }
  }

  if (part.type === 'error') {
    return (
      <Box marginLeft={2} marginBottom={1}>
        <Text color="red">{part.error}</Text>
      </Box>
    );
  }

  // File part (image or other files)
  if (part.type === 'file') {
    const isImage = part.mediaType.startsWith('image/');

    if (isImage) {
      // Save base64 to temp file and open in system viewer
      const tempPath = useMemo(() => {
        try {
          const ext = part.mediaType.split('/')[1] || 'png';
          const filename = `sylphx-${randomBytes(8).toString('hex')}.${ext}`;
          const filepath = join(tmpdir(), filename);
          const buffer = Buffer.from(part.base64, 'base64');
          writeFileSync(filepath, buffer);
          return filepath;
        } catch (err) {
          console.error('[MessagePart] Failed to save image:', err);
          return null;
        }
      }, [part.base64, part.mediaType]);

      // Auto-open image in system viewer once
      useEffect(() => {
        if (tempPath) {
          // Use macOS 'open' command (or 'xdg-open' on Linux)
          const openCommand = process.platform === 'darwin' ? 'open' : 'xdg-open';
          exec(`${openCommand} "${tempPath}"`, (error) => {
            if (error) {
              console.error('[MessagePart] Failed to open image:', error);
            }
          });
        }
      }, [tempPath]);

      if (!tempPath) {
        return (
          <Box flexDirection="column" marginLeft={2} marginBottom={1}>
            <Text dimColor>Image ({part.mediaType}):</Text>
            <Text color="red">Failed to save image</Text>
          </Box>
        );
      }

      const fileSize = Math.round((part.base64.length * 3) / 4 / 1024); // Convert base64 to KB

      return (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Text dimColor>
            Image ({part.mediaType}) - {fileSize}KB
          </Text>
          <Text color="green">✓ Opened in system viewer</Text>
          <Text dimColor>Saved to: {tempPath}</Text>
        </Box>
      );
    } else {
      // Render non-image file info
      return (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Text dimColor>File: {part.mediaType}</Text>
          <Text dimColor>Size: {Math.round(part.base64.length * 0.75)} bytes</Text>
        </Box>
      );
    }
  }

  // Tool part
  if (part.type === 'tool') {
    // Map MessagePart status to ToolDisplay status
    const toolStatus: 'running' | 'completed' | 'failed' =
      part.status === 'active'
        ? 'running'
        : part.status === 'error' || part.status === 'abort'
          ? 'failed'
          : 'completed';

    // Build props conditionally to satisfy exactOptionalPropertyTypes
    const toolProps: {
      name: string;
      status: 'running' | 'completed' | 'failed';
      duration?: number;
      startTime?: number;
      args?: unknown;
      result?: unknown;
      error?: string;
    } = { name: part.name, status: toolStatus };

    // Pass duration for completed/failed tools
    if (part.duration !== undefined) toolProps.duration = part.duration;
    // Pass startTime for running tools (ToolDisplay will calculate elapsed time)
    if (part.startTime !== undefined) toolProps.startTime = part.startTime;
    if (part.args !== undefined) toolProps.args = part.args;
    if (part.result !== undefined) toolProps.result = part.result;
    if (part.error !== undefined) toolProps.error = part.error;

    return (
      <Box marginLeft={2} marginBottom={1}>
        <ToolDisplay {...toolProps} />
      </Box>
    );
  }

  // System message part
  if (part.type === 'system-message') {
    // Parse the XML content to extract the message text
    // Format: <system_message type="...">content</system_message>
    const content = part.content
      .replace(/<system_message[^>]*>/, '')
      .replace(/<\/system_message>/, '')
      .trim();

    return (
      <Box flexDirection="column" marginLeft={2} marginBottom={1} borderStyle="round" borderColor="yellow" paddingX={1}>
        <Text color="yellow" bold>⚠️  System Message</Text>
        <Text dimColor>{content}</Text>
      </Box>
    );
  }

  return null;
});
