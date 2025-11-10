/**
 * Event Context Builder
 * Centralizes the creation of stream event handler context
 */

import type React from 'react';
import type { AIConfig, TokenUsage } from '@sylphx/code-core';
import { getCurrentSessionId } from '@sylphx/code-client';

/**
 * Parameters for building event context
 */
export interface EventContextParams {
  updateSessionTitle: (sessionId: string, title: string) => void;
  setIsStreaming: (value: boolean) => void;
  setIsTitleStreaming: (value: boolean) => void;
  setStreamingTitle: React.Dispatch<React.SetStateAction<string>>;
  streamingMessageIdRef: React.MutableRefObject<string | null>;
  usageRef: React.MutableRefObject<TokenUsage | null>;
  finishReasonRef: React.MutableRefObject<string | null>;
  lastErrorRef: React.MutableRefObject<string | null>;
  addLog: (message: string) => void;
  aiConfig: AIConfig | null;
  notificationSettings: { notifyOnCompletion: boolean; notifyOnError: boolean };
}

/**
 * Build event handler context
 * Reusable across all event stream callbacks
 */
export function buildEventContext(params: EventContextParams) {
  return {
    currentSessionId: getCurrentSessionId(),
    updateSessionTitle: params.updateSessionTitle,
    setIsStreaming: params.setIsStreaming,
    setIsTitleStreaming: params.setIsTitleStreaming,
    setStreamingTitle: params.setStreamingTitle,
    streamingMessageIdRef: params.streamingMessageIdRef,
    usageRef: params.usageRef,
    finishReasonRef: params.finishReasonRef,
    lastErrorRef: params.lastErrorRef,
    addLog: params.addLog,
    aiConfig: params.aiConfig,
    userMessage: '',
    notificationSettings: params.notificationSettings,
  };
}
