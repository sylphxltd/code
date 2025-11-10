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
    const { useCurrentSession, getTRPCClient, setCurrentSessionId } = await import('@sylphx/code-client');
    const { currentSession } = useCurrentSession();

    if (!currentSession) {
      return 'No active session to compact.';
    }

    if (currentSession.messages.length === 0) {
      return 'Current session has no messages to compact.';
    }

    await context.sendMessage('🔄 Compacting session (server-side AI summarization)...');

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

      // Switch to new session
      await setCurrentSessionId(result.newSessionId!);

      // Trigger AI response to process the summary
      await context.triggerAIResponse('Please continue from where we left off.');

      return `✓ Compacted session "${sessionTitle}" (${messageCount} messages)\n✓ Created new session with detailed summary\n✓ Switched to new session\n✓ AI is processing the summary and will continue working...`;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      context.addLog(`[Compact] Error: ${errorMsg}`);
      return `Failed to compact session: ${errorMsg}`;
    }
  },
};

export default compactCommand;
