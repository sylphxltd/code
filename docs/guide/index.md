# Getting Started

Welcome to Code, an AI code assistant built for speed. This guide will help you get up and running quickly.

## What is Code?

Code is an AI assistant designed for zero-overhead performance. Built on in-process tRPC communication with event-driven architecture for real-time multi-client synchronization.

### Key Benefits

- **30x Faster**: Direct function calls eliminate HTTP overhead (~0.1ms vs ~3ms)
- **Real-time Streaming**: Watch AI responses and tool executions stream live
- **Multi-Client Sync**: TUI and Web interfaces stay perfectly synchronized
- **Pure UI Architecture**: Zero business logic in client, all decisions on server
- **10+ Built-in Tools**: File ops, search, shell commands, and more

## Prerequisites

Before you begin, ensure you have the following installed:

- **Bun** >= 1.3.1 ([Install Guide](https://bun.sh))
- **Node.js** >= 18 (for compatibility)
- **Git** (for cloning the repository)

### Verify Installation

```bash
# Check Bun version
bun --version

# Check Node.js version
node --version
```

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/SylphxAI/code.git
cd code
```

### 2. Install Dependencies

```bash
bun install
```

This will install all dependencies for the monorepo, including:
- `@sylphx/code-core` - Headless SDK
- `@sylphx/code-server` - tRPC server
- `@sylphx/code-client` - Pure UI client
- `@sylphx/code` - Terminal UI
- `@sylphx/code-web` - Web UI

### 3. Build Core Packages

```bash
bun run build
```

This builds all packages in the correct order:
- `code-core` (~75ms)
- `code-server` (~23ms)
- `code-client` (~39ms)

### 4. Run the Terminal UI

```bash
# Development mode (with hot reload)
bun dev:code
```

Or in production mode:

```bash
bun build:code
bun --cwd packages/code start
```

### 5. Run the Web UI (Optional)

In a separate terminal:

```bash
# Development mode
bun dev:web
```

Or in production mode:

```bash
bun build:web
bun --cwd packages/code-web preview
```

## First Steps

Once Code is running, you can:

1. **Send a message**: Type your question or command and press Enter
2. **Use slash commands**: Type `/` to see available commands
3. **Navigate sessions**: Use keyboard shortcuts to switch between sessions
4. **Watch tools execute**: See real-time feedback as AI tools run

## Next Steps

- [Installation Guide](/guide/installation) - Detailed installation instructions
- [Usage Guide](/guide/usage) - Learn how to use Code effectively
- [Configuration](/guide/configuration) - Configure AI providers and settings
- [Architecture](/architecture/) - Understand how Code works under the hood

## Common Issues

### Bun not found

If you see "command not found: bun", install Bun:

```bash
curl -fsSL https://bun.sh/install | bash
```

### Build errors

If you encounter build errors, try cleaning and rebuilding:

```bash
bun clean
bun install
bun run build
```

### Port already in use

If the default port is in use, specify a different port:

```bash
PORT=3001 bun dev:code
```

## Getting Help

- 📖 [Read the full documentation](/)
- 🐛 [Report bugs](https://github.com/SylphxAI/code/issues)
- 💬 [Ask questions](https://github.com/SylphxAI/code/discussions)
- 📧 [Email support](mailto:hi@sylphx.com)
