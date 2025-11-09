/**
 * New Command
 * Create a new chat session
 */

import type { Command } from '../types.js';

export const newCommand: Command = {
  id: 'new',
  label: '/new',
  description: 'Create a new chat session',
  execute: async (context) => {
    // Get selected provider/model from zen signals
    const { useSelectedProvider, useSelectedModel, createSession, setCurrentSessionId } = await import('@sylphx/code-client');
    const selectedProvider = useSelectedProvider();
    const selectedModel = useSelectedModel();

    if (!selectedProvider || !selectedModel) {
      return 'No AI provider configured. Use /provider to configure a provider first.';
    }

    // Create new session with current provider and model
    const newSessionId = await createSession(selectedProvider, selectedModel);
    await setCurrentSessionId(newSessionId);

    return `Created new chat session with ${selectedProvider} (${selectedModel})`;
  },
};

export default newCommand;
