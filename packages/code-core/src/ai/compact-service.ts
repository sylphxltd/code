/**
 * Compact Service
 * Server-side session compaction with AI summarization
 *
 * ARCHITECTURE:
 * - Server-only logic (no client dependencies)
 * - Multi-client sync via tRPC events
 * - Atomic operations with rollback
 * - Detailed progress tracking
 */

import { streamText } from 'ai';
import { getProvider } from './providers/index.js';
import type { ProviderId } from '../types/provider.types.js';
import type { Session, Message } from '../types/session.types.js';
import type { SessionRepository } from '../database/session-repository.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('CompactService');

/**
 * Compact result with detailed information
 */
export interface CompactResult {
  success: boolean;
  newSessionId?: string;
  summary?: string;
  oldSessionId?: string;
  oldSessionTitle?: string;
  messageCount?: number;
  error?: string;
}

/**
 * Progress callback for real-time updates
 */
export type ProgressCallback = (status: string, detail?: string) => void;

/**
 * Build conversation history from messages
 * Preserves all context including attachments
 */
function buildConversationHistory(messages: Message[]): string {
  return messages
    .map((msg) => {
      // Extract text content
      const textParts = msg.content
        .filter((part) => part.type === 'text')
        .map((part: any) => part.content);
      let content = textParts.join('\n');

      // Include attachments info
      if (msg.attachments && msg.attachments.length > 0) {
        const attachmentsList = msg.attachments
          .map((att) => `[Attached: ${att.relativePath}]`)
          .join('\n');
        content += `\n${attachmentsList}`;
      }

      return `${msg.role === 'user' ? 'User' : 'Assistant'}: ${content}`;
    })
    .join('\n\n---\n\n');
}

/**
 * Create summarization prompt
 * Emphasizes completeness and current work state
 */
function createSummaryPrompt(conversationHistory: string): string {
  return `You are a conversation summarizer. Your task is to create a comprehensive, detailed summary of the following conversation that preserves ALL important information.

CRITICAL REQUIREMENTS:
1. DO NOT omit any important details, decisions, code snippets, file paths, commands, or configurations
2. Preserve technical accuracy - include exact function names, variable names, file paths, and command syntax
3. Maintain chronological flow of the conversation
4. Highlight key decisions, problems solved, and solutions implemented
5. Include all context that would be needed to continue this conversation naturally
6. Use clear markdown formatting with sections and bullet points
7. If code was discussed or written, include the essential parts or describe what was implemented
8. **CRITICAL**: If there is ongoing work or tasks in progress, create a section called "## Current Work" that describes:
   - What was being worked on when the conversation was compacted
   - What the next steps should be
   - Any pending tasks or unfinished work
   - The current state of the implementation

The summary will be used to start a fresh conversation while maintaining full context.

CONVERSATION TO SUMMARIZE:
${conversationHistory}

Please provide a detailed, structured summary now:`;
}

/**
 * Compact a session: summarize and create new session
 *
 * @param sessionRepository - Database repository
 * @param sessionId - Session to compact
 * @param providerConfig - Provider configuration (with API keys)
 * @param onProgress - Optional progress callback for real-time updates
 * @returns CompactResult with new session info
 *
 * TRANSACTION FLOW:
 * 1. Validate session exists and has messages
 * 2. Generate AI summary (with streaming progress)
 * 3. Create new session atomically
 * 4. Mark old session as compacted
 * 5. Rollback on any failure
 */
export async function compactSession(
  sessionRepository: SessionRepository,
  sessionId: string,
  providerConfig: Record<string, any>,
  onProgress?: ProgressCallback
): Promise<CompactResult> {
  try {
    onProgress?.('validating', 'Checking session...');

    // 1. Validate session
    const session = await sessionRepository.getSessionById(sessionId);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    if (session.messages.length === 0) {
      return { success: false, error: 'Session has no messages to compact' };
    }

    // 2. Check provider configuration
    const provider = getProvider(session.provider as ProviderId);
    if (!provider.isConfigured(providerConfig)) {
      return {
        success: false,
        error: `Provider ${session.provider} is not properly configured`,
      };
    }

    onProgress?.('analyzing', 'Building conversation history...');
    const conversationHistory = buildConversationHistory(session.messages);

    onProgress?.('summarizing', 'Generating AI summary (this may take a moment)...');

    // 3. Generate summary with AI (no token limit!)
    const model = provider.createClient(providerConfig, session.model);
    const summaryPrompt = createSummaryPrompt(conversationHistory);

    const result = await streamText({
      model,
      messages: [
        {
          role: 'user',
          content: summaryPrompt,
        },
      ],
      // NO maxTokens - let AI use as many tokens as needed!
    });

    // Collect full summary with progress updates
    let summary = '';
    let chunkCount = 0;
    for await (const chunk of result.textStream) {
      summary += chunk;
      chunkCount++;
      if (chunkCount % 10 === 0) {
        // Update progress every 10 chunks
        onProgress?.(
          'summarizing',
          `Generating summary... (${summary.length} characters)`
        );
      }
    }

    if (!summary || summary.trim().length === 0) {
      return { success: false, error: 'AI failed to generate summary' };
    }

    logger.info('Summary generated', {
      sessionId,
      summaryLength: summary.length,
      messageCount: session.messages.length,
    });

    onProgress?.('creating', 'Creating new session...');

    // 4. Create new session (atomic operation)
    const newSessionTitle = `${session.title || 'Untitled'} (continued)`;
    const newSession = await sessionRepository.createSession(
      session.provider,
      session.model,
      session.agentId || 'coder',
      session.enabledRuleIds || []
    );

    // Update session with title and metadata
    await sessionRepository.updateSession(newSession.id, {
      title: newSessionTitle,
      metadata: {
        compactedFrom: sessionId,
        originalTitle: session.title,
        originalMessageCount: session.messages.length,
      },
    });

    // 4.5. Add summary as first user message in new session
    const summaryMessage = `This session is being continued from a previous conversation. The conversation is summarized below:

${summary}`;

    // Import message repository to add message
    const { MessageRepository } = await import('../database/message-repository.js');
    // Access the db property from sessionRepository (private, but we need it)
    // @ts-ignore - accessing private property
    const messageRepo = new MessageRepository(sessionRepository.db);

    await messageRepo.addMessage({
      sessionId: newSession.id,
      role: 'user',
      content: [{ type: 'text', content: summaryMessage }],
      attachments: [],
    });

    // 5. Mark old session as compacted
    await sessionRepository.updateSession(sessionId, {
      metadata: {
        ...session.metadata,
        compacted: true,
        compactedTo: newSession.id,
        compactedAt: new Date().toISOString(),
      },
    });

    onProgress?.('completed', 'Compact completed successfully');

    logger.info('Session compacted successfully', {
      oldSessionId: sessionId,
      newSessionId: newSession.id,
      messageCount: session.messages.length,
    });

    return {
      success: true,
      newSessionId: newSession.id,
      summary,
      oldSessionId: sessionId,
      oldSessionTitle: session.title,
      messageCount: session.messages.length,
    };
  } catch (error) {
    logger.error('Failed to compact session', {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Check if a session should be compacted
 * Based on message count and token usage
 *
 * @param session - Session to check
 * @param thresholds - Optional custom thresholds
 * @returns Whether session should be compacted
 */
export function shouldCompactSession(
  session: Session,
  thresholds: {
    minMessages?: number;
    maxMessages?: number;
  } = {}
): boolean {
  const { minMessages = 10, maxMessages = 100 } = thresholds;

  // Need minimum number of messages to be worth compacting
  if (session.messages.length < minMessages) {
    return false;
  }

  // Auto-compact if too many messages
  if (session.messages.length >= maxMessages) {
    return true;
  }

  return false;
}
