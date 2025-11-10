/**
 * StatusIndicator Component
 * Displays streaming and compacting status with spinner and contextual text
 */

import { Box, Text } from 'ink';
import type { MessagePart } from '@sylphx/code-core';
import { useIsCompacting } from '@sylphx/code-client';
import Spinner from '../../../components/Spinner.js';

interface StatusIndicatorProps {
  isStreaming: boolean;
  streamParts: MessagePart[];
}

export function StatusIndicator({ isStreaming, streamParts }: StatusIndicatorProps) {
  const isCompacting = useIsCompacting();

  // Compacting takes priority over streaming
  if (isCompacting) {
    return (
      <Box paddingY={1}>
        <Spinner color="#FFD700" />
        <Text color="#FFD700"> Compacting session...</Text>
        <Text dimColor> (ESC to cancel)</Text>
      </Box>
    );
  }

  if (!isStreaming) {
    return (
      <Box paddingY={1}>
        <Text> </Text>
      </Box>
    );
  }

  // Determine status text based on streaming state
  const getStatusText = () => {
    if (streamParts.length === 0) {
      return 'Thinking...';
    } else if (streamParts.some((p) => p.type === 'tool' && p.status === 'active')) {
      return 'Working...';
    } else if (streamParts.some((p) => p.type === 'reasoning')) {
      return 'Thinking...';
    } else {
      return 'Typing...';
    }
  };

  return (
    <Box paddingY={1}>
      <Spinner color="#FFD700" />
      <Text color="#FFD700"> {getStatusText()}</Text>
      <Text dimColor> (ESC to cancel)</Text>
    </Box>
  );
}
