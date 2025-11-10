/**
 * Streaming State Hook
 * Manages streaming flags and refs
 */

import { useRef, useState } from 'react';
import type { MessagePart as StreamPart } from '@sylphx/code-core';

export interface StreamingState {
  isStreaming: boolean;
  setIsStreaming: (streaming: boolean) => void;
  isTitleStreaming: boolean;
  setIsTitleStreaming: (streaming: boolean) => void;
  streamingTitle: string;
  setStreamingTitle: (title: string | ((prev: string) => string)) => void;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  streamingMessageIdRef: React.MutableRefObject<string | null>;
  dbWriteTimerRef: React.MutableRefObject<NodeJS.Timeout | null>;
  pendingDbContentRef: React.MutableRefObject<StreamPart[] | null>;
}

export function useStreamingState(): StreamingState {
  const [isStreaming, setIsStreaming] = useState(false);
  const [isTitleStreaming, setIsTitleStreaming] = useState(false);
  const [streamingTitle, setStreamingTitle] = useState('');

  // Refs for streaming management
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);

  // Database persistence refs
  const dbWriteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDbContentRef = useRef<StreamPart[] | null>(null);

  return {
    isStreaming,
    setIsStreaming,
    isTitleStreaming,
    setIsTitleStreaming,
    streamingTitle,
    setStreamingTitle,
    abortControllerRef,
    streamingMessageIdRef,
    dbWriteTimerRef,
    pendingDbContentRef,
  };
}
