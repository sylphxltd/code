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
          console.log('[sessions] onSelect called with sessionId:', sessionId);

          // IMPORTANT: Clear inputComponent FIRST, before setCurrentSession
          // setCurrentSession triggers Chat re-render, which can interfere with state updates
          console.log('[sessions] Clearing inputComponent before session switch');
          context.setInputComponent(null);

          // Get fresh store reference
          const { useAppStore } = await import('@sylphx/code-client');
          const freshStore = useAppStore.getState();

          console.log('[sessions] About to call setCurrentSession');
          // Switch to selected session
          await freshStore.setCurrentSession(sessionId);
          console.log('[sessions] setCurrentSession completed');

          const selectedSession = sortedSessions.find((s) => s.id === sessionId);
          const displayName = selectedSession
            ? formatSessionDisplay(selectedSession.title, selectedSession.created)
            : 'Unknown session';

          context.addLog(`[sessions] Switched to session: ${displayName}`);
        }}
        onCancel={() => {
          console.log('[sessions] onCancel called');
          context.setInputComponent(null);
          context.addLog('[sessions] Session selection cancelled');
        }}
      />,
      'Session Selection'
    );

    context.addLog('[sessions] Session selection opened');
  },
};

export default sessionsCommand;
