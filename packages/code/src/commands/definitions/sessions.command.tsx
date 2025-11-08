/**
 * Sessions Command
 * Switch between chat sessions using component-based UI
 */

import { SessionSelection } from '../../screens/chat/components/SessionSelection.js';
import type { Command } from '../types.js';

export const sessionsCommand: Command = {
  id: 'sessions',
  label: '/sessions',
  description: 'View and switch between chat sessions',
  execute: async (context) => {
    const { formatSessionDisplay } = await import('@sylphx/code-core');
    const { getRecentSessions, useAppStore } = await import('@sylphx/code-client');

    // Get sessions
    const sessions = await getRecentSessions(100);

    if (sessions.length === 0) {
      return 'No sessions available. Start chatting to create a session.';
    }

    const store = useAppStore.getState();
    const currentSessionId = store.currentSessionId;

    // Sort sessions by updated time (most recent first), then by created time
    const sortedSessions = [...sessions].sort((a, b) => {
      // First compare by updated time (descending)
      const updateDiff = b.updated - a.updated;
      if (updateDiff !== 0) return updateDiff;

      // If updated is same, compare by created time (descending)
      return b.created - a.created;
    });

    // Prepare session data for selection component
    const sessionData = sortedSessions.map((session) => {
      const isCurrent = session.id === currentSessionId;
      const displayText = formatSessionDisplay(session.title, session.created);

      return {
        id: session.id,
        title: session.title,
        created: session.created,
        updated: session.updated,
        displayText,
        isCurrent,
      };
    });

    // Use SessionSelection component
    context.setInputComponent(
      <SessionSelection
        sessions={sessionData}
        onSelect={async (sessionId) => {
          try {
            // Clear inputComponent before switching sessions
            context.setInputComponent(null);

            // Switch to selected session
            const { useSessionStore } = await import('@sylphx/code-client');
            const sessionStore = useSessionStore.getState();
            await sessionStore.setCurrentSession(sessionId);

            const selectedSession = sortedSessions.find((s) => s.id === sessionId);
            const displayName = selectedSession
              ? formatSessionDisplay(selectedSession.title, selectedSession.created)
              : 'Unknown session';

            context.addLog(`Switched to session: ${displayName}`);
          } catch (error) {
            context.addLog(`Error switching session: ${error instanceof Error ? error.message : String(error)}`);
            context.setInputComponent(null);
          }
        }}
        onCancel={() => {
          context.setInputComponent(null);
        }}
      />,
      'Session Selection'
    );
  },
};

export default sessionsCommand;
