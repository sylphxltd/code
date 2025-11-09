/**
 * Logs Command
 * View debug logs
 */

import type { Command } from '../types.js';

export const logsCommand: Command = {
  id: 'logs',
  label: '/logs',
  description: 'View debug logs',
  execute: async (context) => {
    const { navigateTo } = await import('@sylphx/code-client');
    navigateTo('logs');
    return 'Opening debug logs...';
  },
};

export default logsCommand;
