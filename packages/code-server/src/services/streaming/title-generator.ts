/**
 * Title Generator
 * Handles parallel title generation with real-time streaming
 */

import type { SessionRepository, AIConfig, Session } from '@sylphx/code-core';
import type { AppContext } from '../../context.js';

/**
 * Title streaming callbacks for real-time updates
 */
export interface TitleStreamCallbacks {
  onStart: () => void;
  onDelta: (text: string) => void;
  onEnd: (title: string) => void;
}

/**
 * Generate session title with real-time streaming updates
 * Returns a promise that resolves when title generation is complete
 */
export async function generateSessionTitle(
  appContext: AppContext,
  sessionRepository: SessionRepository,
  aiConfig: AIConfig,
  session: Session,
  userMessage: string,
  callbacks?: TitleStreamCallbacks
): Promise<string | null> {
  try {
    const { createAIStream, cleanAITitle, getProvider } = await import('@sylphx/code-core');

    const provider = session.provider;
    const modelName = session.model;
    const providerConfig = aiConfig?.providers?.[provider];

    if (!providerConfig) {
      return null;
    }

    const providerInstance = getProvider(provider);
    if (!providerInstance.isConfigured(providerConfig)) {
      return null;
    }

    const model = providerInstance.createClient(providerConfig, modelName);

    // Create AI stream for title generation (no tools needed - faster and cheaper)
    const titleStream = createAIStream({
      model,
      messages: [
        {
          role: 'user',
          content: `You need to generate a SHORT, DESCRIPTIVE title (maximum 50 characters) for a chat conversation.

User's first message: "${userMessage}"

Requirements:
- Summarize the TOPIC or INTENT, don't just copy the message
- Be concise and descriptive
- Maximum 50 characters
- Output ONLY the title, nothing else

Examples:
- Message: "How do I implement authentication?" → Title: "Authentication Implementation"
- Message: "你好，请帮我修复这个 bug" → Title: "Bug 修复请求"
- Message: "Can you help me with React hooks?" → Title: "React Hooks Help"

Now generate the title:`,
        },
      ],
      enableTools: false, // Title generation doesn't need tools
    });

    let fullTitle = '';

    // Emit start event
    // If callbacks provided (TUI), emit via callback (message router will publish to eventStream)
    // If no callbacks (direct eventStream consumer), publish to eventStream
    if (callbacks) {
      console.log('[Title] Emitting START via callback');
      callbacks.onStart();
    } else {
      console.log('[Title] Publishing START to eventStream');
      const startEvent = { type: 'session-title-updated-start' as const, sessionId: session.id };
      await appContext.eventStream.publish(`session:${session.id}`, startEvent);
    }

    // Stream title chunks (wrap in try-catch to catch flush/finalize errors)
    console.log('[Title] Starting to consume titleStream...');
    try {
      let chunkCount = 0;
      for await (const chunk of titleStream) {
        chunkCount++;
        console.log('[Title] Received chunk #', chunkCount, ':', JSON.stringify(chunk));

        if (chunk.type === 'text-delta' && chunk.textDelta) {
          fullTitle += chunk.textDelta;

          // Emit delta
          if (callbacks) {
            console.log('[Title] Emitting DELTA via callback:', chunk.textDelta);
            callbacks.onDelta(chunk.textDelta);
          } else {
            console.log('[Title] Publishing DELTA to eventStream:', chunk.textDelta);
            const deltaEvent = {
              type: 'session-title-updated-delta' as const,
              sessionId: session.id,
              text: chunk.textDelta,
            };
            await appContext.eventStream.publish(`session:${session.id}`, deltaEvent);
          }
        }
      }
      console.log('[Title] titleStream completed, total chunks:', chunkCount, 'fullTitle:', fullTitle);
    } catch (streamError) {
      // Catch NoOutputGeneratedError and other stream errors
      console.error('[Title Generation] Stream error:', streamError);
      console.error('[Title Generation] Error stack:', streamError instanceof Error ? streamError.stack : 'N/A');
      // If stream failed, use a default title based on first message
      if (fullTitle.length === 0) {
        console.log('[Title] Using fallback title from user message');
        fullTitle = userMessage.slice(0, 50);
      }
    }

    console.log('[Title] After stream loop, fullTitle length:', fullTitle.length);

    // Clean up and update database (only if we got some title)
    if (fullTitle.length > 0) {
      console.log('[Title] Cleaning title:', fullTitle);
      const cleaned = cleanAITitle(fullTitle, 50);
      console.log('[Title] Cleaned title:', cleaned);

      try {
        console.log('[Title] Saving title to database...');
        await sessionRepository.updateSession(session.id, { title: cleaned });
        console.log('[Title] Title saved to database');

        // Emit end event
        if (callbacks) {
          console.log('[Title] Emitting END via callback:', cleaned);
          callbacks.onEnd(cleaned);
        } else {
          console.log('[Title] Publishing END to eventStream:', cleaned);
          const endEvent = {
            type: 'session-title-updated-end' as const,
            sessionId: session.id,
            title: cleaned,
          };
          await appContext.eventStream.publish(`session:${session.id}`, endEvent);
        }
        console.log('[Title] Title generation complete:', cleaned);
        return cleaned;
      } catch (dbError) {
        console.error('[Title Generation] Failed to save title:', dbError);
        return cleaned; // Return title even if DB save failed
      }
    }

    console.log('[Title] No title generated (fullTitle was empty)');
    return null;
  } catch (error) {
    console.error('[Title Generation] Error:', error);
    return null;
  }
}

/**
 * Check if session needs title generation
 */
export function needsTitleGeneration(
  session: Session,
  isNewSession: boolean,
  isFirstMessage: boolean
): boolean {
  const needsTitle = isNewSession || !session.title || session.title === 'New Chat';
  return needsTitle && isFirstMessage;
}
