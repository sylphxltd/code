/**
 * Compact Command
 * Server-side session compaction with AI summarization
 * ARCHITECTURE: All logic on server, multi-client sync via tRPC events
 * UI FLOW: Uses normal message flow with status indicator (doesn't block input)
 */

import type { Command } from '../types.js';

export const compactCommand: Command = {
  id: 'compact',
  label: '/compact',
  description: 'Summarize current session and create a new session with the summary',
  execute: async (context) => {
    const { getTRPCClient, setCompacting, setCompactAbortController } = await import('@sylphx/code-client');
    const { $currentSession } = await import('@sylphx/code-client');
    const { get } = await import('@sylphx/zen');

    const currentSession = get($currentSession);

    if (!currentSession) {
      return 'No active session to compact.';
    }

    if (currentSession.messages.length === 0) {
      return 'Current session has no messages to compact.';
    }

    // Set compacting status (shows indicator in UI)
    setCompacting(true);

    // Create abort controller for ESC cancellation
    const abortController = new AbortController();
    setCompactAbortController(abortController);

    try {
      // Call server-side compact mutation
      const client = getTRPCClient();

      // Check if already aborted before starting
      if (abortController.signal.aborted) {
        setCompacting(false);
        return '⚠️ Compaction cancelled.';
      }

      const result = await client.session.compact.mutate({
        sessionId: currentSession.id,
      });

      // Clear compacting status
      setCompacting(false);

      if (!result.success) {
        return `❌ Failed to compact session: ${result.error}`;
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

        // Load messages from new session into UI (includes the summary system message)
        if (newSession.messages && newSession.messages.length > 0) {
          addMessages(newSession.messages);
        }

        // Send success message as assistant message BEFORE triggering AI
        context.sendMessage(`✓ Compacted session "${sessionTitle}" (${messageCount} messages)\n✓ Created new session with AI-generated summary\n✓ Switched to new session`);

        // Auto-trigger AI response to acknowledge the compacted session
        // The triggerAIResponse will send a 'Hi' user message and start streaming
        context.addLog('[Compact] Triggering AI response in new session...');

        try {
          await context.triggerAIResponse('Hi');
        } catch (err) {
          context.addLog(`[Compact] Failed to trigger AI response: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      // Don't return anything - we've already sent the success message
      return;
    } catch (error) {
      // Clear compacting status on error
      setCompacting(false);

      // Check if it was aborted
      if (error instanceof Error && error.name === 'AbortError') {
        return '⚠️ Compaction cancelled.';
      }

      const errorMsg = error instanceof Error ? error.message : String(error);
      context.addLog(`[Compact] Error: ${errorMsg}`);
      return `❌ Failed to compact session: ${errorMsg}`;
    }
  },
};

export default compactCommand;
