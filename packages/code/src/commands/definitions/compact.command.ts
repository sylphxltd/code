/**
 * Compact Command
 * Server-side session compaction with AI summarization
 * ARCHITECTURE: All logic on server, multi-client sync via tRPC events
 */

import type { Command } from '../types.js';

export const compactCommand: Command = {
  id: 'compact',
  label: '/compact',
  description: 'Summarize current session and create a new session with the summary',
  execute: async (context) => {
    const { getTRPCClient, setCurrentSessionId } = await import('@sylphx/code-client');
    const { $currentSession } = await import('@sylphx/code-client');
    const { get } = await import('@sylphx/zen');

    const currentSession = get($currentSession);

    if (!currentSession) {
      return 'No active session to compact.';
    }

    if (currentSession.messages.length === 0) {
      return 'Current session has no messages to compact.';
    }

    const statusMessage = await context.sendMessage('🔄 Compacting session...\n⏳ This may take a moment while AI generates a comprehensive summary.');

    try {
      // Call server-side compact mutation
      const client = getTRPCClient();
      const result = await client.session.compact.mutate({
        sessionId: currentSession.id,
      });

      if (!result.success) {
        return `Failed to compact session: ${result.error}`;
      }

      const messageCount = result.messageCount || currentSession.messages.length;
      const sessionTitle = result.oldSessionTitle || currentSession.title || 'Untitled session';

      // Clear current messages and switch to new session
      const { clearMessages, setCurrentSession, addMessages } = await import('@sylphx/code-client');
      clearMessages();

      // Fetch new session from server
      const newSession = await client.session.getById.query({ sessionId: result.newSessionId! });
      if (newSession) {
        setCurrentSession(newSession);
        // Load messages from new session into UI
        if (newSession.messages && newSession.messages.length > 0) {
          addMessages(newSession.messages);
        }
      }

      return `✓ Compacted session "${sessionTitle}" (${messageCount} messages)\n✓ Created new session with detailed summary\n✓ Switched to new session\n\nThe conversation summary is now loaded. You can continue working or send a message to trigger AI response.`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      context.addLog(`[Compact] Error: ${errorMsg}`);
      return `Failed to compact session: ${errorMsg}`;
    }
  },
};

export default compactCommand;
