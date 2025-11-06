# Sylphx Code

AI-powered code assistant with Terminal UI and Web interfaces.

## Features

- 🖥️ **Terminal UI (TUI)** - Beautiful interactive terminal interface
- 🌐 **Web UI** - Modern web-based interface
- 🔄 **Real-time Streaming** - Live AI responses with tRPC subscriptions
- 🎯 **Multi-provider Support** - OpenRouter, OpenAI, Anthropic, Google
- 📦 **Session Management** - Persistent conversation history
- 🛠️ **Tool Execution** - Built-in code tools and MCP integration

## Architecture

This is a monorepo containing:

- **code-core** - Core library (database, AI providers, tools)
- **code-server** - tRPC server with streaming support
- **code-client** - Shared client library (React hooks, state management)
- **code** - Terminal UI (Ink-based TUI)
- **code-web** - Web UI (Next.js)

## Quick Start

```bash
# Install dependencies
bun install

# Run TUI
bun dev:code

# Run Web UI
bun dev:web

# Run tests
bun test
```

## Development

### Debug Logging

Uses industry-standard `debug` package:

```bash
# Enable all debug logs
DEBUG=sylphx:* bun dev:code

# Enable specific namespaces
DEBUG=sylphx:subscription:* bun dev:code
DEBUG=sylphx:search:* bun dev:code
DEBUG=sylphx:trpc:* bun dev:code
```

See [DEBUG.md](./DEBUG.md) for complete guide.

### Testing

```bash
# Run all tests
bun test

# Run specific tests
bun test:streaming
bun test:adapter

# Watch mode
bun test:watch

# Coverage
bun test:coverage
```

See [TESTING.md](./TESTING.md) for testing guide.

## Architecture Details

### Streaming Architecture

- **tRPC v11** subscriptions with observables
- **In-process link** for TUI (zero overhead)
- **HTTP subscriptions** for Web UI
- **Real-time events** with type safety

### State Management

- **Zustand** for client state
- **Immer** for immutable updates
- **tRPC context** for server state
- **React hooks** for UI integration

### Database

- **libSQL** (embedded SQLite)
- **Drizzle ORM** for type-safe queries
- **Auto-migration** system
- **Session persistence**

## Documentation

- [DEBUG.md](./DEBUG.md) - Debug logging guide
- [TESTING.md](./TESTING.md) - Testing strategies
- [OPTIMIZATION_REPORT.md](./OPTIMIZATION_REPORT.md) - Performance optimization report

## License

MIT
