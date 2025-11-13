# Development Guide

Learn how to contribute to Code, set up your development environment, and understand the codebase.

## Getting Started

### Prerequisites

- **Bun** >= 1.3.1
- **Node.js** >= 18
- **Git**
- Modern code editor (VSCode recommended)

### Setup Development Environment

1. **Fork and Clone:**
```bash
git clone https://github.com/YOUR_USERNAME/code.git
cd code
```

2. **Install Dependencies:**
```bash
bun install
```

3. **Build Packages:**
```bash
bun run build
```

4. **Run Tests:**
```bash
bun test
```

5. **Start Development:**
```bash
# Terminal UI (hot reload)
bun dev:code

# Web UI (hot reload)
bun dev:web

# Server (daemon mode)
PORT=3000 bun --cwd packages/code-server start
```

## Project Structure

```
code/
├── packages/
│   ├── code-core/       # Headless SDK (350+ files)
│   │   ├── ai/          # AI providers, streaming, agents
│   │   ├── database/    # libSQL + Drizzle ORM
│   │   ├── tools/       # Built-in tools
│   │   └── config/      # Configuration system
│   ├── code-server/     # tRPC v11 server
│   │   ├── trpc/        # Routers, procedures
│   │   ├── services/    # Business logic
│   │   └── context.ts   # AppContext
│   ├── code-client/     # Pure UI client
│   │   ├── stores/      # Zustand stores
│   │   ├── lib/         # Event bus
│   │   └── hooks/       # React hooks
│   ├── code/            # Terminal UI (Ink)
│   │   ├── screens/     # Chat, Settings, Dashboard
│   │   ├── commands/    # Slash commands
│   │   └── components/  # UI components
│   └── code-web/        # Web UI (Next.js)
│       ├── app/         # Next.js app router
│       └── components/  # React components
├── docs/                # VitePress documentation
├── .changeset/          # Changesets for versioning
└── turbo.json          # Turborepo configuration
```

## Development Workflow

### Making Changes

1. **Create a feature branch:**
```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes:**
- Follow existing code style
- Add tests for new features
- Update documentation

3. **Run tests:**
```bash
bun test
```

4. **Type check:**
```bash
bun type-check
```

5. **Format code:**
```bash
bun format
```

6. **Create changeset:**
```bash
bunx changeset
```

Follow prompts to describe your changes.

7. **Commit changes:**
```bash
git add .
git commit -m "feat: add your feature"
```

**Commit Convention:**
- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation
- `style:` Code style (formatting)
- `refactor:` Code refactoring
- `test:` Tests
- `chore:` Build, dependencies

8. **Push and create PR:**
```bash
git push origin feature/your-feature-name
```

Then create a Pull Request on GitHub.

## Testing

### Running Tests

```bash
# All tests
bun test

# Specific package
bun test --filter "@sylphx/code-client"

# Watch mode
bun test:watch

# Coverage
bun test:coverage
```

### Writing Tests

**Unit Test Example:**
```typescript
// packages/code-client/src/lib/event-bus.test.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from './event-bus'

describe('EventBus', () => {
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it('should emit and receive events', () => {
    const handler = vi.fn()
    eventBus.on('test', handler)
    eventBus.emit('test', { data: 'value' })

    expect(handler).toHaveBeenCalledWith({ data: 'value' })
  })

  it('should unsubscribe from events', () => {
    const handler = vi.fn()
    const unsubscribe = eventBus.on('test', handler)

    unsubscribe()
    eventBus.emit('test', { data: 'value' })

    expect(handler).not.toHaveBeenCalled()
  })
})
```

**Integration Test Example:**
```typescript
// packages/code-server/src/trpc/routers/session.test.ts
import { describe, it, expect } from 'vitest'
import { createTestServer } from '../testing'

describe('Session Router', () => {
  it('creates and retrieves session', async () => {
    const { client } = createTestServer()

    const created = await client.session.create.mutate({
      provider: 'openrouter',
      model: 'claude-3.5-sonnet'
    })

    expect(created.id).toBeDefined()

    const retrieved = await client.session.get.query({
      sessionId: created.id
    })

    expect(retrieved?.id).toBe(created.id)
  })
})
```

### Test Coverage Goals

- **Core packages**: > 80% coverage
- **Critical paths**: 100% coverage
- **Event bus**: 100% coverage (currently: 33 tests)

## Debugging

### Debug Logging

Use the `debug` package for logging:

```typescript
import createDebug from 'debug'

const debug = createDebug('sylphx:feature:operation')

debug('Starting operation with params:', params)
```

**Enable logs:**
```bash
# All logs
DEBUG=sylphx:* bun dev:code

# Specific namespace
DEBUG=sylphx:stream:* bun dev:code

# Multiple namespaces
DEBUG=sylphx:stream:*,sylphx:tool:* bun dev:code
```

### VSCode Debugging

Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug TUI",
      "type": "node",
      "request": "launch",
      "runtimeExecutable": "bun",
      "runtimeArgs": ["--cwd", "packages/code", "start"],
      "env": {
        "DEBUG": "sylphx:*"
      },
      "sourceMaps": true
    }
  ]
}
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Avoid `any`, use `unknown` instead
- Prefer interfaces for objects
- Use discriminated unions for variants

**Good:**
```typescript
interface User {
  id: string
  name: string
}

type Result<T> =
  | { success: true; data: T }
  | { success: false; error: string }
```

**Bad:**
```typescript
type User = {  // Prefer interface
  id: any     // Avoid any
  name: string
}
```

### Formatting

Code uses Biome for formatting:

```bash
# Format all files
bun format

# Check formatting
bun format:check
```

**Rules:**
- 2 spaces indentation
- Single quotes
- Semicolons
- Trailing commas

### Naming Conventions

- **Files**: kebab-case (`event-bus.ts`, `session-router.ts`)
- **Components**: PascalCase (`ChatScreen.tsx`, `MessageList.tsx`)
- **Functions**: camelCase (`createSession`, `handleEvent`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_TIMEOUT`)
- **Types/Interfaces**: PascalCase (`Session`, `StreamEvent`)

## Architecture Guidelines

### Pure UI Client Principle

**Client should:**
- ✅ Handle UI state only
- ✅ Use optimistic updates
- ✅ Listen to events
- ✅ Render UI

**Client should NOT:**
- ❌ Contain business logic
- ❌ Make decisions
- ❌ Persist data
- ❌ Directly call AI APIs

### Event-Driven Communication

Use event bus for store coordination:

```typescript
// ✅ Good - Event-driven
sessionStore.createSession(...)
eventBus.emit('session:created', { sessionId })

settingsStore.on('session:created', ({ sessionId }) => {
  updateCurrentSession(sessionId)
})

// ❌ Bad - Direct coupling
sessionStore.createSession(...)
settingsStore.setCurrentSession(sessionId)  // Circular dependency
```

### Server-Side Business Logic

Keep all decisions on server:

```typescript
// ✅ Good - Server decides
compact: procedure.mutation(async ({ ctx }) => {
  const summary = await generateSummary(...)
  const newSession = await createSession(...)
  streamAIResponse({ sessionId: newSession.id })  // Auto-trigger
  return newSession
})

// ❌ Bad - Client decides
const result = await client.session.compact.mutate(...)
client.message.streamResponse.subscribe(...)  // Client triggers
```

## Adding Features

### Adding a New AI Tool

1. **Create tool definition:**
```typescript
// packages/code-core/src/tools/my-tool.ts
import type { Tool } from '../types'

export const myTool: Tool = {
  name: 'my_tool',
  description: 'Does something useful',
  parameters: {
    type: 'object',
    properties: {
      param: { type: 'string', description: 'A parameter' }
    },
    required: ['param']
  },
  execute: async ({ param }) => {
    // Implementation
    return { result: 'success' }
  }
}
```

2. **Register tool:**
```typescript
// packages/code-core/src/tools/index.ts
export * from './my-tool'
```

3. **Add tests:**
```typescript
// packages/code-core/src/tools/my-tool.test.ts
import { describe, it, expect } from 'vitest'
import { myTool } from './my-tool'

describe('myTool', () => {
  it('executes successfully', async () => {
    const result = await myTool.execute({ param: 'value' })
    expect(result.result).toBe('success')
  })
})
```

### Adding a New tRPC Procedure

1. **Define procedure:**
```typescript
// packages/code-server/src/trpc/routers/my-router.ts
import { router, publicProcedure } from '../trpc'
import { z } from 'zod'

export const myRouter = router({
  myProcedure: publicProcedure
    .input(z.object({ param: z.string() }))
    .query(async ({ ctx, input }) => {
      return { result: 'success' }
    })
})
```

2. **Add to root router:**
```typescript
// packages/code-server/src/trpc/router.ts
import { myRouter } from './routers/my-router'

export const appRouter = router({
  // ... existing routers
  my: myRouter
})
```

3. **Use in client:**
```typescript
const result = await client.my.myProcedure.query({ param: 'value' })
```

### Adding a New UI Component

1. **Create component:**
```typescript
// packages/code/src/components/MyComponent.tsx
import React from 'react'
import { Box, Text } from 'ink'

interface MyComponentProps {
  message: string
}

export const MyComponent: React.FC<MyComponentProps> = ({ message }) => {
  return (
    <Box>
      <Text>{message}</Text>
    </Box>
  )
}
```

2. **Add tests:**
```typescript
// packages/code/src/components/MyComponent.test.tsx
import { render } from 'ink-testing-library'
import { MyComponent } from './MyComponent'

it('renders message', () => {
  const { lastFrame } = render(<MyComponent message="Hello" />)
  expect(lastFrame()).toContain('Hello')
})
```

## Performance Optimization

### Build Performance

Code uses Bun for fast builds:

```bash
# Clean build
bun clean
bun run build

# Development builds (watch mode)
bun --cwd packages/code-core dev
```

**Build times:**
- code-core: ~75ms
- code-server: ~23ms
- code: ~39ms

### Runtime Performance

**Measure performance:**
```typescript
const start = performance.now()
// ... operation
const duration = performance.now() - start
debug('Operation took %dms', duration)
```

**Profile with Node:**
```bash
node --prof --cwd packages/code start
node --prof-process isolate-*.log > profile.txt
```

## Documentation

### Updating Docs

1. **Edit VitePress docs:**
```bash
cd docs
# Edit .md files
```

2. **Preview locally:**
```bash
bun --cwd docs dev
```

3. **Build docs:**
```bash
bun --cwd docs build
```

### Writing Good Documentation

- Use clear, concise language
- Include code examples
- Add diagrams for complex concepts
- Link to related documentation
- Keep it up-to-date

## Release Process

### Creating a Release

1. **Create changesets for all changes:**
```bash
bunx changeset
```

2. **Version packages:**
```bash
bunx changeset version
```

3. **Update CHANGELOG.md** (automatic)

4. **Build all packages:**
```bash
bun run build
```

5. **Run all tests:**
```bash
bun test
```

6. **Publish:**
```bash
bunx changeset publish
```

7. **Push tags:**
```bash
git push --follow-tags
```

## Getting Help

### Resources

- 📖 [Architecture Documentation](/architecture/)
- 🐛 [Issue Tracker](https://github.com/SylphxAI/code/issues)
- 💬 [Discussions](https://github.com/SylphxAI/code/discussions)
- 📧 [Email](mailto:hi@sylphx.com)

### Ask Questions

- Check existing issues and discussions
- Search documentation
- Ask in GitHub Discussions
- Contact maintainers

## Code of Conduct

We are committed to providing a welcoming and inspiring community for all.

**Expected Behavior:**
- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for the community

**Unacceptable Behavior:**
- Harassment or discrimination
- Trolling or insulting comments
- Personal or political attacks
- Any conduct inappropriate in a professional setting

## License

Code is MIT licensed. See [LICENSE](https://github.com/SylphxAI/code/blob/main/LICENSE).

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to Code! 🎉
