/**
 * Main App Component
 * Root React + Ink component with screen routing
 */

import { useKeyboard, useSessionPersistence, useAIConfig,
         useCurrentScreen, useIsLoading, useUIError, setError } from '@sylphx/code-client';
// import { initializePersistence } from '@sylphx/code-client/signals';
import { Box, Text } from 'ink';
import React, { useEffect, useState } from 'react';
import Chat from './screens/Chat.js';
import CommandPalette from './screens/CommandPalette.js';
import Dashboard from './screens/Dashboard.js';
import Logs from './screens/Logs.js';
import ModelSelection from './screens/ModelSelection.js';
import ProviderManagement from './screens/ProviderManagement.js';

function AppContent() {
  const currentScreen = useCurrentScreen();
  const isLoading = useIsLoading();
  const error = useUIError();
  const [commandPaletteCommand, setCommandPaletteCommand] = useState<string | null>(null);

  // Load AI config on mount
  const { loadConfig } = useAIConfig();

  // Load sessions from database (auto-migrates from files if needed)
  useSessionPersistence();

  // Note: useKeyboard is disabled - shortcuts are handled in each screen to avoid conflicts with TextInput
  // useKeyboard();

  // Handle command palette commands
  const handleCommand = (command: string) => {
    setCommandPaletteCommand(command);
  };

  // Load AI config (via tRPC)
  useEffect(() => {
    // TODO: Initialize zen signal persistence when module resolution is fixed
    // initializePersistence();

    // Load AI config
    loadConfig().catch((err) => {
      console.error('Failed to load config:', err);
    });
  }, [loadConfig]);

  // Clear error after 5 seconds
  useEffect(() => {
    if (error) {
      const timeout = setTimeout(() => {
        setError(null);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [error, setError]);

  // Full-screen screens - no app layout padding
  // These screens manage their own layout to handle Static/Dynamic boundary correctly
  if (currentScreen === 'dashboard') {
    return <Dashboard />;
  }

  if (currentScreen === 'chat') {
    return <Chat commandFromPalette={commandPaletteCommand} />;
  }

  // Other screens use app layout with padding
  return (
    <Box flexDirection="column" width="100%" height="100%" paddingX={1}>
      {/* Header */}
      <Box paddingY={1}>
        <Text bold color="#00D9FF">
          SYLPHX FLOW
        </Text>
        <Text dimColor> │ </Text>
        <Text dimColor>AI Development Assistant</Text>
      </Box>

      {/* Error Display */}
      {error && (
        <Box paddingY={1}>
          <Text color="#FF3366">▌</Text>
          <Text color="#FF3366" bold>
            {' '}
            ERROR{' '}
          </Text>
          <Text color="gray">{error}</Text>
        </Box>
      )}

      {/* Loading Indicator */}
      {isLoading && (
        <Box paddingY={1}>
          <Text color="#FFD700">▌</Text>
          <Text color="#FFD700" bold>
            {' '}
            LOADING
          </Text>
          <Text color="gray">...</Text>
        </Box>
      )}

      {/* Screen Router */}
      <Box flexDirection="column" flexGrow={1} minHeight={0}>
        {currentScreen === 'provider-management' && <ProviderManagement />}
        {currentScreen === 'model-selection' && <ModelSelection />}
        {currentScreen === 'command-palette' && <CommandPalette onCommand={handleCommand} />}
        {currentScreen === 'logs' && <Logs />}
      </Box>
    </Box>
  );
}

export default function App() {
  return <AppContent />;
}
