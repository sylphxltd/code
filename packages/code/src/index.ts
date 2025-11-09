#!/usr/bin/env bun

/**
 * Sylphx Code - Unified CLI Tool
 *
 * Architecture:
 * - Embedded CodeServer (in-process tRPC by default)
 * - Optional HTTP server for Web GUI (--web flag)
 * - Optional remote connection (--server-url flag)
 *
 * Modes:
 * - TUI (default): code
 * - Headless: code "prompt"
 * - TUI + Web: code --web
 * - Standalone server: code --server
 * - Remote TUI: code --server-url http://host:port
 */

// Install global unhandled rejection handler to prevent crashes
// This is a safety net for errors that escape all other error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Promise Rejection:');
  console.error('Reason:', reason);

  // Log error cause if available (for wrapped errors)
  if (reason && typeof reason === 'object' && 'cause' in reason && reason.cause) {
    console.error('Underlying cause:', reason.cause);
  }

  // Log but don't exit - let the app continue running
  // Most unhandled rejections are from stream cleanup and can be safely ignored
  if (reason && typeof reason === 'object' && 'name' in reason) {
    const errorName = (reason as any).name;
    if (errorName === 'NoOutputGeneratedError' || errorName === 'AI_NoOutputGeneratedError') {
      console.error('[CRITICAL] NoOutputGeneratedError caught at process level - this indicates a stream error that was not properly caught');
      // Don't exit - this is recoverable
      return;
    }
  }

  // For other errors, log but still don't exit
  console.error('[CRITICAL] Non-stream error - logging but continuing');
});

// Install uncaught exception handler
process.on('uncaughtException', (error) => {
  console.error('[CRITICAL] Uncaught Exception:');
  console.error(error);

  // For uncaught exceptions, we should exit as the process state may be corrupted
  console.error('[CRITICAL] Process will exit due to uncaught exception');
  process.exit(1);
});

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { Command } from 'commander';
import { CodeServer, type AppRouter } from '@sylphx/code-server';
import {
  TRPCProvider,
  createInProcessClient,
  createHTTPClient as createHTTPClientFromLib,
  type TypedTRPCClient,
} from '@sylphx/code-client';
import { checkServer } from './trpc-client.js';

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const VERSION = packageJson.version;

/**
 * Global embedded server instance
 * Used for in-process mode
 */
let embeddedServer: CodeServer | null = null;

/**
 * Initialize embedded server for in-process use
 */
async function initEmbeddedServer(options: { quiet?: boolean } = {}): Promise<CodeServer> {
  if (embeddedServer) {
    return embeddedServer;
  }

  if (!options.quiet) {
    console.error(chalk.dim('Initializing embedded server...'));
  }

  embeddedServer = new CodeServer();
  await embeddedServer.initialize();

  // Register embedded server for context access (TUI only)
  const { setEmbeddedServer } = await import('./embedded-context.js');
  setEmbeddedServer(embeddedServer);

  if (!options.quiet) {
    console.error(chalk.green('✓ Server ready'));
  }

  return embeddedServer;
}

/**
 * Main CLI entry point
 */
async function main() {
  const program = new Command();

  program
    .name('sylphx-code')
    .description('Sylphx Code - AI development assistant')
    .version(VERSION, '-V, --version', 'Show version number')
    .helpOption('-h, --help', 'Display help for command')
    .argument('[prompt]', 'Prompt to send to AI (headless mode)')
    .option('-p, --print', 'Print mode (headless)')
    .option('-c, --continue', 'Continue last session')
    .option('--web', 'Launch Web GUI (starts HTTP server)')
    .option('--server', 'Start standalone HTTP server only')
    .option('--server-url <url>', 'Connect to remote server (HTTP tRPC)')
    .option('-q, --quiet', 'Quiet mode')
    .option('-v, --verbose', 'Verbose mode')
    .action(async (prompt, options) => {
      // Standalone server mode
      if (options.server) {
        console.log(chalk.cyan('Starting standalone HTTP server...'));
        console.log(chalk.dim('Use Ctrl+C to stop'));

        const server = new CodeServer({ port: 3000 });
        await server.initialize();
        await server.startHTTP();

        // Keep process alive
        await new Promise(() => {});
        return;
      }

      // Setup tRPC client
      let client: TypedTRPCClient;

      if (options.serverUrl) {
        // Remote mode: Connect to existing HTTP server
        if (!options.quiet) {
          console.error(chalk.dim(`Connecting to remote server: ${options.serverUrl}`));
        }

        // Check if server is available
        const available = await checkServer(options.serverUrl);
        if (!available) {
          console.error(chalk.red(`✗ Server not available at ${options.serverUrl}`));
          console.error(chalk.yellow('\nOptions:'));
          console.error(chalk.dim('  1. Check server URL'));
          console.error(chalk.dim('  2. Start server: code --server'));
          process.exit(1);
        }

        client = createHTTPClientFromLib(options.serverUrl);
      } else {
        // In-process mode (default): Embed server
        // Headless mode should be quiet by default (unless --verbose)
        const isHeadless = Boolean(prompt || options.print);
        const shouldBeQuiet = isHeadless ? !options.verbose : options.quiet;

        const server = await initEmbeddedServer({ quiet: shouldBeQuiet });

        // Create in-process tRPC client (zero overhead)
        client = createInProcessClient({
          router: server.getRouter(),
          createContext: server.getContext(),
        });

        // If --web flag, start HTTP server
        if (options.web) {
          if (!options.quiet) {
            console.error(chalk.dim('Starting HTTP server for Web GUI...'));
          }
          await server.startHTTP(3000);

          // Open browser
          const { launchWeb } = await import('./web-launcher.js');
          await launchWeb();
        }
      }

      // Headless mode: if prompt provided OR --print flag
      if (prompt || options.print) {
        if (!prompt) {
          console.error(chalk.red('Error: No prompt provided'));
          console.error(chalk.dim('Usage: sylphx-code "your prompt here"'));
          console.error(chalk.dim('   or: sylphx-code -c "your prompt"'));
          process.exit(1);
        }

        // Initialize global client for headless mode (needed for getTRPCClient())
        const { _initGlobalClient } = await import('@sylphx/code-client');
        _initGlobalClient(client);

        const { runHeadless } = await import('./headless.js');
        await runHeadless(prompt, options);
        return;
      }

      // TUI mode (default)
      const React = await import('react');
      const { render } = await import('ink');
      const { default: App } = await import('./App.js');

      // TODO: Initialize zen signals before React app (module resolution issue)
      // const { initializeSignals } = await import('./signal-init.js');
      // initializeSignals();

      // Wrap App with TRPCProvider
      render(
        React.createElement(
          TRPCProvider,
          { client },
          React.createElement(App)
        )
      );
    });

  try {
    await program.parseAsync(process.argv);
    } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
