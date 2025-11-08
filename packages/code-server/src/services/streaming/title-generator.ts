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
  // START TIMING FROM FUNCTION ENTRY
  const startTime = Date.now();
  console.log(`[TitleGen] 0ms - Function called, starting title generation`);

  try {
    const importStart = Date.now();
    const { createAIStream, cleanAITitle, getProvider } = await import('@sylphx/code-core');
    console.log(`[TitleGen] ${Date.now() - startTime}ms - Dynamic import completed (took ${Date.now() - importStart}ms)`);

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

    console.log(`[TitleGen] ${Date.now() - startTime}ms - Provider config validated`);

    const clientStart = Date.now();
    const model = providerInstance.createClient(providerConfig, modelName);
    console.log(`[TitleGen] ${Date.now() - startTime}ms - Client created (took ${Date.now() - clientStart}ms)`);

    // Create AI stream for title generation (no tools needed - faster and cheaper)
    const streamStart = Date.now();
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
    console.log(`[TitleGen] ${Date.now() - startTime}ms - AI stream created (took ${Date.now() - streamStart}ms)`);

    let fullTitle = '';

    // Emit start event
    if (callbacks) {
      callbacks.onStart();
    } else {
      console.log(`[TitleGen] ${Date.now() - startTime}ms - Publishing START`);
      const startEvent = { type: 'session-title-updated-start' as const, sessionId: session.id };
      // Fire-and-forget publish (non-blocking, same as message streaming)
      appContext.eventStream.publish(`session:${session.id}`, startEvent).catch(err => {
        console.error('[TitleGen] Failed to publish START event:', err);
      });
    }

    // Stream title chunks
    console.log(`[TitleGen] ${Date.now() - startTime}ms - Starting to iterate stream (waiting for first chunk...)`);
    try {
      for await (const chunk of titleStream) {
        if (chunk.type === 'text-delta' && chunk.textDelta) {
          fullTitle += chunk.textDelta;

          // Emit delta
          if (callbacks) {
            callbacks.onDelta(chunk.textDelta);
          } else {
            console.log(`[TitleGen] ${Date.now() - startTime}ms - DELTA: "${chunk.textDelta}" (total: "${fullTitle}")`);
            const deltaEvent = {
              type: 'session-title-updated-delta' as const,
              sessionId: session.id,
              text: chunk.textDelta,
            };
            // Fire-and-forget publish (non-blocking, same as message streaming)
            appContext.eventStream.publish(`session:${session.id}`, deltaEvent).catch(err => {
              console.error('[TitleGen] Failed to publish DELTA event:', err);
            });
          }
        }
      }
      console.log(`[TitleGen] ${Date.now() - startTime}ms - Stream completed, fullTitle: "${fullTitle}"`);
    } catch (streamError) {
      // Catch NoOutputGeneratedError and other stream errors
      console.error('[Title Generation] Stream error:', streamError);
      // If stream failed, use a default title based on first message
      if (fullTitle.length === 0) {
        fullTitle = userMessage.slice(0, 50);
      }
    }

    // Clean up and update database (only if we got some title)
    if (fullTitle.length > 0) {
      const cleaned = cleanAITitle(fullTitle, 50);

      try {
        await sessionRepository.updateSession(session.id, { title: cleaned });

        // Emit end event
        if (callbacks) {
          callbacks.onEnd(cleaned);
        } else {
          console.log(`[TitleGen] ${Date.now() - startTime}ms - Publishing END: "${cleaned}"`);
          const endEvent = {
            type: 'session-title-updated-end' as const,
            sessionId: session.id,
            title: cleaned,
          };
          // Fire-and-forget publish (non-blocking, same as message streaming)
          appContext.eventStream.publish(`session:${session.id}`, endEvent).catch(err => {
            console.error('[TitleGen] Failed to publish END event:', err);
          });
        }
        return cleaned;
      } catch (dbError) {
        console.error('[Title Generation] Failed to save title:', dbError);
        return cleaned; // Return title even if DB save failed
      }
    }

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
