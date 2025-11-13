# API Reference

Complete API reference for Code's tRPC endpoints and SDK.

## Overview

Code exposes a fully type-safe API through tRPC. All endpoints have automatic TypeScript types without code generation.

**Base URL (HTTP mode):** `http://localhost:3000`

**Transport Options:**
- In-process: Direct function calls (TUI)
- HTTP/SSE: Network-based (Web UI, daemon)

## Client Creation

### In-Process Client

```typescript
import { createClient } from '@sylphx/code-client'

const client = createClient({
  transport: 'in-process',
  appContext: getAppContext()
})
```

### HTTP Client

```typescript
import { createClient } from '@sylphx/code-client'

const client = createClient({
  transport: 'http',
  serverUrl: 'http://localhost:3000'
})
```

## Session API

### `session.list`

List all sessions.

**Type:** Query

**Input:** None

**Output:**
```typescript
interface Session {
  id: string
  provider: string
  model: string
  title?: string
  createdAt: number
  updatedAt: number
}

type Output = Session[]
```

**Example:**
```typescript
const sessions = await client.session.list.query()
// [{ id: 'abc', provider: 'openrouter', model: 'claude-3.5-sonnet', ... }]
```

### `session.get`

Get a single session by ID.

**Type:** Query

**Input:**
```typescript
{ sessionId: string }
```

**Output:**
```typescript
interface SessionWithMessages extends Session {
  messages: Message[]
}

type Output = SessionWithMessages | null
```

**Example:**
```typescript
const session = await client.session.get.query({ sessionId: 'abc' })
// { id: 'abc', messages: [...], ... }
```

### `session.create`

Create a new session.

**Type:** Mutation

**Input:**
```typescript
{
  provider: string      // e.g., 'openrouter', 'anthropic'
  model: string        // e.g., 'claude-3.5-sonnet'
  title?: string       // Optional title
}
```

**Output:**
```typescript
type Output = Session
```

**Example:**
```typescript
const session = await client.session.create.mutate({
  provider: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet',
  title: 'My Chat'
})
// { id: 'new-id', provider: 'openrouter', ... }
```

**Events Emitted:**
- `session-created` on `session-events` channel

### `session.delete`

Delete a session.

**Type:** Mutation

**Input:**
```typescript
{ sessionId: string }
```

**Output:**
```typescript
{ success: boolean }
```

**Example:**
```typescript
await client.session.delete.mutate({ sessionId: 'abc' })
// { success: true }
```

**Events Emitted:**
- `session-deleted` on `session-events` channel

### `session.updateTitle`

Update session title.

**Type:** Mutation

**Input:**
```typescript
{
  sessionId: string
  title: string
}
```

**Output:**
```typescript
{ success: boolean }
```

**Example:**
```typescript
await client.session.updateTitle.mutate({
  sessionId: 'abc',
  title: 'New Title'
})
```

**Events Emitted:**
- `session-title-updated` on `session-events` channel

### `session.updateModel`

Update session AI model.

**Type:** Mutation

**Input:**
```typescript
{
  sessionId: string
  provider: string
  model: string
}
```

**Output:**
```typescript
{ success: boolean }
```

**Example:**
```typescript
await client.session.updateModel.mutate({
  sessionId: 'abc',
  provider: 'anthropic',
  model: 'claude-3-opus'
})
```

**Events Emitted:**
- `session-model-updated` on `session-events` channel

### `session.compact`

Compact session history with AI summary.

**Type:** Mutation

**Input:**
```typescript
{ sessionId: string }
```

**Output:**
```typescript
{
  success: boolean
  oldSessionId: string
  newSessionId: string
  summary: string
}
```

**Example:**
```typescript
const result = await client.session.compact.mutate({ sessionId: 'abc' })
// {
//   success: true,
//   oldSessionId: 'abc',
//   newSessionId: 'xyz',
//   summary: 'Summary of conversation...'
// }
```

**Events Emitted:**
- `session-created` on `session-events` channel
- AI streaming events on `session:${newSessionId}` channel (auto-triggered)

**Notes:**
- Server automatically triggers AI response after compact
- Client should switch to new session
- Original session is preserved (not deleted)

## Message API

### `message.streamResponse`

Stream AI response to user message.

**Type:** Subscription

**Input:**
```typescript
{
  sessionId: string
  content: ParsedContentPart[]
}

interface ParsedContentPart {
  type: 'text' | 'image'
  content?: string    // For text
  data?: string      // For image (base64)
}
```

**Output:** Observable stream of events

```typescript
type StreamEvent =
  | { type: 'user-message-created', messageId: string, content: ParsedContentPart[] }
  | { type: 'assistant-message-created', messageId: string }
  | { type: 'text-start' }
  | { type: 'text-delta', text: string }
  | { type: 'text-end' }
  | { type: 'reasoning-start' }
  | { type: 'reasoning-delta', text: string }
  | { type: 'reasoning-end', duration: number }
  | { type: 'tool-call', toolCallId: string, toolName: string, args: unknown }
  | { type: 'tool-result', toolCallId: string, toolName: string, result: unknown, duration: number }
  | { type: 'tool-error', toolCallId: string, toolName: string, error: string, duration: number }
  | { type: 'complete', usage: TokenUsage, finishReason: string }
  | { type: 'error', error: string }
  | { type: 'abort' }
```

**Example:**
```typescript
const subscription = client.message.streamResponse.subscribe(
  {
    sessionId: 'abc',
    content: [{ type: 'text', content: 'Hello!' }]
  },
  {
    onData: (event) => {
      if (event.type === 'text-delta') {
        console.log('Token:', event.text)
      } else if (event.type === 'complete') {
        console.log('Done! Usage:', event.usage)
      }
    },
    onError: (error) => console.error('Error:', error),
    onComplete: () => console.log('Stream complete')
  }
)

// Cleanup
subscription.unsubscribe()
```

**Events Emitted:**
- All streaming events on both:
  - Direct subscription (Path A)
  - `session:${sessionId}` channel (Path B, for multi-client sync)

## Events API

### `events.subscribeToSession`

Subscribe to session-specific events (streaming, tools, etc.).

**Type:** Subscription

**Input:**
```typescript
{
  sessionId: string
  replayLast?: number  // Number of events to replay (default: 0)
}
```

**Output:** Observable stream of `StreamEvent`

**Example:**
```typescript
const subscription = client.events.subscribeToSession.subscribe(
  { sessionId: 'abc', replayLast: 0 },
  {
    onData: (event) => {
      console.log('Session event:', event)
    }
  }
)

subscription.unsubscribe()
```

**Use Cases:**
- Multi-client synchronization
- Resuming ongoing streams
- Background event monitoring

### `events.subscribeToAllSessions`

Subscribe to global session lifecycle events.

**Type:** Subscription

**Input:** None

**Output:** Observable stream of session events

```typescript
type SessionEvent =
  | { type: 'session-created', sessionId: string, provider: string, model: string }
  | { type: 'session-deleted', sessionId: string }
  | { type: 'session-title-updated', sessionId: string, title: string }
  | { type: 'session-model-updated', sessionId: string, provider: string, model: string }
  | { type: 'session-compacted', oldSessionId: string, newSessionId: string, summary: string }
```

**Example:**
```typescript
const subscription = client.events.subscribeToAllSessions.subscribe(
  undefined,
  {
    onData: (event) => {
      if (event.type === 'session-created') {
        console.log('New session:', event.sessionId)
      }
    }
  }
)
```

**Use Cases:**
- Sidebar synchronization
- Dashboard updates
- Session list refresh

## Config API

### `config.get`

Get current configuration.

**Type:** Query

**Input:** None

**Output:**
```typescript
interface Config {
  ai: {
    provider: string
    model: string
    temperature: number
    maxTokens: number
  }
  // ... other config
}
```

**Example:**
```typescript
const config = await client.config.get.query()
// { ai: { provider: 'openrouter', model: '...', ... }, ... }
```

### `config.update`

Update configuration.

**Type:** Mutation

**Input:**
```typescript
Partial<Config>
```

**Output:**
```typescript
{ success: boolean }
```

**Example:**
```typescript
await client.config.update.mutate({
  ai: {
    model: 'claude-3-opus'
  }
})
```

## Stats API

### `stats.get`

Get usage statistics.

**Type:** Query

**Input:**
```typescript
{ sessionId?: string }  // Optional: stats for specific session
```

**Output:**
```typescript
interface Stats {
  totalSessions: number
  totalMessages: number
  totalTokens: number
  tokensIn: number
  tokensOut: number
  sessionStats?: {
    messageCount: number
    tokenCount: number
    createdAt: number
  }
}
```

**Example:**
```typescript
// Global stats
const stats = await client.stats.get.query()
// { totalSessions: 10, totalMessages: 100, ... }

// Session-specific stats
const sessionStats = await client.stats.get.query({ sessionId: 'abc' })
// { sessionStats: { messageCount: 20, tokenCount: 5000, ... } }
```

## Error Handling

### Error Types

All errors use tRPC error codes:

```typescript
type ErrorCode =
  | 'BAD_REQUEST'           // Invalid input
  | 'UNAUTHORIZED'          // Auth required
  | 'FORBIDDEN'             // No permission
  | 'NOT_FOUND'            // Resource not found
  | 'TIMEOUT'              // Request timeout
  | 'INTERNAL_SERVER_ERROR' // Server error
  | 'TOO_MANY_REQUESTS'    // Rate limited
```

### Error Handling Example

```typescript
import { TRPCClientError } from '@trpc/client'

try {
  const session = await client.session.get.query({ sessionId: 'invalid' })
} catch (error) {
  if (error instanceof TRPCClientError) {
    console.error('Error code:', error.data?.code)
    console.error('Message:', error.message)

    if (error.data?.code === 'NOT_FOUND') {
      // Handle not found
    } else if (error.data?.code === 'INTERNAL_SERVER_ERROR') {
      // Handle server error
    }
  }
}
```

## Type Definitions

### Message

```typescript
interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: ParsedContentPart[]
  createdAt: number
  usage?: TokenUsage
}
```

### TokenUsage

```typescript
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}
```

### ParsedContentPart

```typescript
type ParsedContentPart =
  | { type: 'text', content: string }
  | { type: 'image', data: string, mediaType: string }
  | { type: 'tool-use', toolCallId: string, toolName: string, args: unknown }
  | { type: 'tool-result', toolCallId: string, result: unknown }
```

## Rate Limiting

Some operations have rate limits:

- `message.streamResponse`: 10 requests per minute per session
- `session.compact`: 5 requests per hour per session

Rate limit errors return:
```typescript
{
  code: 'TOO_MANY_REQUESTS',
  message: 'Rate limit exceeded',
  retryAfter: 60  // seconds
}
```

## Best Practices

### Subscription Management

Always unsubscribe when done:

```typescript
useEffect(() => {
  const subscription = client.message.streamResponse.subscribe(...)
  return () => subscription.unsubscribe()
}, [sessionId])
```

### Error Handling

Handle all error cases:

```typescript
try {
  await client.session.delete.mutate({ sessionId })
} catch (error) {
  if (error instanceof TRPCClientError) {
    switch (error.data?.code) {
      case 'NOT_FOUND':
        showError('Session not found')
        break
      case 'FORBIDDEN':
        showError('Permission denied')
        break
      default:
        showError('An error occurred')
    }
  }
}
```

### Type Safety

Let TypeScript infer types:

```typescript
// ✅ Good - TypeScript infers Session type
const session = await client.session.get.query({ sessionId: 'abc' })

// ❌ Avoid - Unnecessary type cast
const session = await client.session.get.query({ sessionId: 'abc' }) as Session
```

## Related Documentation

- [Architecture Overview](/architecture/) - System design
- [tRPC Communication](/architecture/trpc) - tRPC details
- [Usage Guide](/guide/usage) - Practical examples

## Resources

- [tRPC Documentation](https://trpc.io)
- [Zod Documentation](https://zod.dev)
- [RxJS Documentation](https://rxjs.dev)
