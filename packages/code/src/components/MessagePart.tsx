/**
 * MessagePart Component
 * Unified rendering for both streaming and completed message parts
 *
 * PERFORMANCE: Memoized to prevent re-rendering unchanged message parts
 */

import { useElapsedTime } from '@sylphx/code-client';
import type { MessagePart as MessagePartType } from '@sylphx/code-core';
import { Box, Text, useStdout } from 'ink';
import Picture, { useTerminalCapabilities } from 'ink-picture';
import React, { useMemo } from 'react';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
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
  // Get terminal dimensions for responsive image sizing
  const { stdout } = useStdout();
  const terminalWidth = stdout?.columns || 80;

  // Get terminal capabilities for image rendering
  const capabilities = useTerminalCapabilities();

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
      // Save base64 to temp file (ink-picture doesn't support data URLs)
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

      if (!tempPath) {
        return (
          <Box flexDirection="column" marginLeft={2} marginBottom={1}>
            <Text dimColor>Image ({part.mediaType}):</Text>
            <Text color="red">Failed to load image</Text>
          </Box>
        );
      }

      // Calculate responsive image width
      // Use 90% of terminal width (leave margin for UI)
      const imageWidth = Math.min(Math.floor(terminalWidth * 0.9), 160);

      // Detect graphics protocol capability (check actual field names from API)
      const hasGraphicsProtocol =
        capabilities?.supportsKittyGraphics ||
        capabilities?.supportsITerm2Graphics ||
        capabilities?.supportsSixelGraphics;

      // Determine best protocol and dimensions
      let protocol: 'auto' | 'halfBlock' | 'braille' | 'kitty' | 'iterm2' | 'sixel' = 'auto';
      let imageHeight: number | undefined;

      if (hasGraphicsProtocol) {
        // High-res protocols: let them preserve aspect ratio
        imageHeight = undefined;
      } else {
        // ASCII fallback: try braille protocol (higher resolution than halfBlock)
        protocol = 'braille';
        // Braille uses 2x4 dot blocks, so can achieve higher resolution
        // Calculate height for visible image
        imageHeight = Math.floor((imageWidth * 9) / 16);
      }

      console.log('[MessagePart] Image capabilities:', {
        terminalWidth,
        imageWidth,
        imageHeight,
        protocol,
        capabilities,
        hasGraphicsProtocol,
      });

      return (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          <Text dimColor>
            Image ({part.mediaType}) - Protocol:{' '}
            {capabilities?.supportsKittyGraphics
              ? 'Kitty'
              : capabilities?.supportsITerm2Graphics
                ? 'iTerm2'
                : capabilities?.supportsSixelGraphics
                  ? 'Sixel'
                  : `${protocol} (ASCII)`}
          </Text>
          <Text color="yellow" dimColor>
            ⚠️ For better image quality, use iTerm2, WezTerm, or Kitty terminal
          </Text>
          <Picture
            src={tempPath}
            alt="Generated image"
            width={imageWidth}
            height={imageHeight}
            protocol={protocol}
          />
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

  return null;
});
