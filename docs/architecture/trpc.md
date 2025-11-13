# tRPC Communication

Code uses tRPC v11 for end-to-end type-safe communication between client and server. The architecture supports both in-process and HTTP/SSE transports.

## Overview

tRPC provides zero-overhead type safety without code generation. Changes to the server API are immediately reflected in the client at compile time.

**Key Benefits:**
- Full TypeScript type safety
- No code generation needed
- Automatic API documentation
- Multiple transport options
- Subscription support

## Architecture

### Type Flow

```typescript
// Server defines procedures
const appRouter = router({
  message: router({
    streamResponse: publicProcedure
      .input(z.object({ sessionId: z.string(), content: z.array(...) }))
      .subscription(({ input }) => {
        return observable<StreamEvent>((emit) => {
          // Stream AI responses
        })
      })
  })
})

// Client gets automatic types
type AppRouter = typeof appRouter

// Usage is fully typed
const client = createClient<AppRouter>(...)
const subscription = client.message.streamResponse.subscribe({
  sessionId: 'abc',  // ✅ Type-safe
  content: [...]     // ✅ Type-safe
})
```

### Transport Options

Code supports two transport mechanisms:

#### 1. In-Process Link (Primary)

Direct function calls within the same process:

```typescript
import { createInProcessLink } from '@sylphx/code-client'

const client = createTRPCProxyClient<AppRouter>({
  links: [
    createInProcessLink({
      router: appRouter,
      createContext: () => ({ appContext })
    })
  ]
})
```

**Characteristics:**
- Zero serialization overhead
- Direct memory access
- ~0.1ms function call overhead
- 30x faster than HTTP
- Same-process only

**Use Cases:**
- Terminal UI (TUI)
- Local development
- Embedded scenarios

#### 2. HTTP/SSE Link (Daemon Mode)

HTTP requests + Server-Sent Events for subscriptions:

```typescript
import { httpBatchLink, splitLink } from '@trpc/client'

const client = createTRPCProxyClient<AppRouter>({
  links: [
    splitLink({
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({ url: 'http://localhost:3000' }),
      false: httpBatchLink({ url: 'http://localhost:3000' })
    })
  ]
})
```

**Characteristics:**
- Network-based communication
- Batched HTTP requests
- SSE for real-time subscriptions
- ~1-3ms latency (localhost)
- Multi-process/remote support

**Use Cases:**
- Web UI
- Remote clients
- Daemon server
- Multi-user scenarios

## Router Structure

### Root Router

```typescript
// packages/code-server/src/trpc/router.ts
export const appRouter = router({
  session: sessionRouter,
  message: messageRouter,
  config: configRouter,
  events: eventsRouter
})

export type AppRouter = typeof appRouter
```

### Session Router

```typescript
const sessionRouter = router({
  // Query procedures
  list: publicProcedure
    .query(async ({ ctx }) => {
      return await ctx.appContext.core.sessions.list()
    }),

  get: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ ctx, input }) => {
      return await ctx.appContext.core.sessions.get(input.sessionId)
    }),

  // Mutation procedures
  create: publicProcedure
    .input(z.object({ provider: z.string(), model: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const session = await ctx.appContext.core.sessions.create(input)
      // Emit event
      ctx.appContext.eventStream.publish('session-events', {
        type: 'session-created',
        sessionId: session.id
      })
      return session
    }),

  delete: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.appContext.core.sessions.delete(input.sessionId)
      ctx.appContext.eventStream.publish('session-events', {
        type: 'session-deleted',
        sessionId: input.sessionId
      })
    }),

  compact: moderateProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Generate summary and create new session
      const result = await compactSession(ctx, input.sessionId)

      // Emit session-created event
      ctx.appContext.eventStream.publish('session-events', {
        type: 'session-created',
        sessionId: result.newSessionId
      })

      // Auto-trigger AI streaming (server-side)
      streamAIResponse({
        sessionId: result.newSessionId,
        userMessageContent: null  // Use existing messages
      }).subscribe({
        next: (event) => {
          ctx.appContext.eventStream.publish(
            `session:${result.newSessionId}`,
            event
          )
        }
      })

      return result
    })
})
```

### Message Router

```typescript
const messageRouter = router({
  // Subscription procedures
  streamResponse: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      content: z.array(ParsedContentPartSchema)
    }))
    .subscription(({ ctx, input }) => {
      return observable<StreamEvent>((emit) => {
        // Stream AI responses
        const subscription = streamAIResponse({
          sessionId: input.sessionId,
          userMessageContent: input.content
        }).subscribe({
          next: (event) => {
            // Path A: Direct subscription
            emit.next(event)

            // Path B: Event stream (multi-client sync)
            ctx.appContext.eventStream.publish(
              `session:${input.sessionId}`,
              event
            )
          },
          error: (err) => emit.error(err),
          complete: () => emit.complete()
        })

        // Cleanup on unsubscribe
        return () => subscription.unsubscribe()
      })
    })
})
```

### Events Router

```typescript
const eventsRouter = router({
  // Subscribe to session-specific events
  subscribeToSession: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      replayLast: z.number().optional()
    }))
    .subscription(({ ctx, input }) => {
      return observable<StreamEvent>((emit) => {
        const subscription = ctx.appContext.eventStream
          .subscribe(`session:${input.sessionId}`, input.replayLast)
          .subscribe({
            next: (event) => emit.next(event),
            error: (err) => emit.error(err)
          })

        return () => subscription.unsubscribe()
      })
    }),

  // Subscribe to all session lifecycle events
  subscribeToAllSessions: publicProcedure
    .subscription(({ ctx }) => {
      return observable<SessionEvent>((emit) => {
        const subscription = ctx.appContext.eventStream
          .subscribe('session-events')
          .subscribe({
            next: (event) => emit.next(event),
            error: (err) => emit.error(err)
          })

        return () => subscription.unsubscribe()
      })
    })
})
```

## Procedure Types

### Query

Read-only operations that fetch data:

```typescript
const getSession = publicProcedure
  .input(z.object({ sessionId: z.string() }))
  .query(async ({ ctx, input }) => {
    return await ctx.appContext.core.sessions.get(input.sessionId)
  })
```

**Characteristics:**
- GET requests (HTTP transport)
- Cacheable
- Idempotent
- No side effects

### Mutation

Operations that modify data:

```typescript
const createSession = publicProcedure
  .input(z.object({ provider: z.string(), model: z.string() }))
  .mutation(async ({ ctx, input }) => {
    return await ctx.appContext.core.sessions.create(input)
  })
```

**Characteristics:**
- POST requests (HTTP transport)
- Not cacheable
- Can have side effects
- State modifications

### Subscription

Long-lived connections for real-time updates:

```typescript
const streamResponse = publicProcedure
  .input(z.object({ sessionId: z.string() }))
  .subscription(({ ctx, input }) => {
    return observable<StreamEvent>((emit) => {
      // Stream events over time
      const subscription = source.subscribe(emit)
      return () => subscription.unsubscribe()
    })
  })
```

**Characteristics:**
- SSE (Server-Sent Events) in HTTP transport
- Observable-based in in-process
- Real-time updates
- Bidirectional communication

## Context

### AppContext

Every procedure receives a context object:

```typescript
interface Context {
  appContext: AppContext
}

interface AppContext {
  core: CodeCore              // Headless SDK
  eventStream: EventStream    // Event streaming service
  sessions: Map<string, Session>
}
```

### Creating Context

**In-Process:**
```typescript
createContext: () => ({
  appContext: getAppContext()
})
```

**HTTP:**
```typescript
createContext: (opts: CreateHTTPContextOptions) => ({
  appContext: getAppContext(),
  req: opts.req,
  res: opts.res
})
```

## Input Validation

All inputs are validated with Zod schemas:

```typescript
const streamResponseInput = z.object({
  sessionId: z.string(),
  content: z.array(
    z.discriminatedUnion('type', [
      z.object({ type: z.literal('text'), content: z.string() }),
      z.object({ type: z.literal('image'), data: z.string() })
    ])
  )
})

const procedure = publicProcedure
  .input(streamResponseInput)
  .subscription(({ input }) => {
    // input is fully typed and validated
    input.sessionId  // string ✅
    input.content    // ContentPart[] ✅
  })
```

**Benefits:**
- Runtime validation
- Compile-time types
- Automatic error handling
- Clear error messages

## Error Handling

### TRPCError

```typescript
import { TRPCError } from '@trpc/server'

const getSession = publicProcedure
  .input(z.object({ sessionId: z.string() }))
  .query(async ({ ctx, input }) => {
    const session = await ctx.appContext.core.sessions.get(input.sessionId)

    if (!session) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: `Session ${input.sessionId} not found`
      })
    }

    return session
  })
```

**Error Codes:**
- `BAD_REQUEST` - Invalid input
- `UNAUTHORIZED` - Auth required
- `FORBIDDEN` - No permission
- `NOT_FOUND` - Resource not found
- `INTERNAL_SERVER_ERROR` - Server error
- `TIMEOUT` - Request timeout

### Client Error Handling

```typescript
try {
  const session = await client.session.get.query({ sessionId: 'abc' })
} catch (error) {
  if (error instanceof TRPCClientError) {
    console.error('tRPC Error:', error.message)
    console.error('Code:', error.data?.code)
    console.error('Cause:', error.cause)
  }
}
```

## Middleware

### Rate Limiting

```typescript
const rateLimitMiddleware = t.middleware(async ({ ctx, next, path }) => {
  const key = `${ctx.userId}:${path}`
  const allowed = await checkRateLimit(key)

  if (!allowed) {
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded'
    })
  }

  return next()
})

const moderateProcedure = publicProcedure.use(rateLimitMiddleware)
```

### Logging

```typescript
const loggingMiddleware = t.middleware(async ({ ctx, next, path, type }) => {
  const start = Date.now()
  const result = await next()
  const duration = Date.now() - start

  console.log(`${type} ${path} - ${duration}ms`)

  return result
})
```

### Authentication

```typescript
const authMiddleware = t.middleware(async ({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  }
  return next({ ctx: { ...ctx, user: ctx.user } })
})

const protectedProcedure = publicProcedure.use(authMiddleware)
```

## Client Usage

### Creating Client

```typescript
import { createClient } from '@sylphx/code-client'

const client = createClient({
  transport: 'in-process',  // or 'http'
  serverUrl: 'http://localhost:3000'  // for HTTP transport
})
```

### Query

```typescript
// Fetch data
const sessions = await client.session.list.query()
const session = await client.session.get.query({ sessionId: 'abc' })
```

### Mutation

```typescript
// Modify data
const newSession = await client.session.create.mutate({
  provider: 'openrouter',
  model: 'anthropic/claude-3.5-sonnet'
})

await client.session.delete.mutate({ sessionId: 'abc' })
```

### Subscription

```typescript
// Real-time updates
const subscription = client.message.streamResponse.subscribe(
  { sessionId: 'abc', content: [{ type: 'text', content: 'Hello' }] },
  {
    onData: (event) => {
      if (event.type === 'text-delta') {
        console.log('Token:', event.text)
      }
    },
    onError: (error) => {
      console.error('Stream error:', error)
    },
    onComplete: () => {
      console.log('Stream complete')
    }
  }
)

// Cleanup
subscription.unsubscribe()
```

## Performance Optimization

### Batching (HTTP Transport)

Multiple queries batched into single HTTP request:

```typescript
const [sessions, config, stats] = await Promise.all([
  client.session.list.query(),
  client.config.get.query(),
  client.stats.get.query()
])

// Sent as single HTTP request ✅
// Not 3 separate requests ❌
```

### Deduplication

Duplicate requests are automatically deduplicated:

```typescript
// Only makes one actual request
const [result1, result2] = await Promise.all([
  client.session.get.query({ sessionId: 'abc' }),
  client.session.get.query({ sessionId: 'abc' })
])
```

### Subscription Management

```typescript
// Reuse subscriptions
const subscriptionCache = new Map()

function getSubscription(sessionId: string) {
  if (!subscriptionCache.has(sessionId)) {
    const sub = client.events.subscribeToSession.subscribe({ sessionId })
    subscriptionCache.set(sessionId, sub)
  }
  return subscriptionCache.get(sessionId)
}

// Cleanup on unmount
useEffect(() => {
  const sub = getSubscription(sessionId)
  return () => {
    sub.unsubscribe()
    subscriptionCache.delete(sessionId)
  }
}, [sessionId])
```

## Testing

### Mock Client

```typescript
import { createMockClient } from '@sylphx/code-client/testing'

const mockClient = createMockClient<AppRouter>({
  session: {
    list: () => Promise.resolve([]),
    get: ({ sessionId }) => Promise.resolve({ id: sessionId }),
    create: (input) => Promise.resolve({ id: 'new', ...input })
  }
})
```

### Integration Tests

```typescript
import { createTestServer } from '@sylphx/code-server/testing'

describe('tRPC Router', () => {
  let server: ReturnType<typeof createTestServer>
  let client: TRPCClient<AppRouter>

  beforeEach(() => {
    server = createTestServer()
    client = server.getClient()
  })

  afterEach(() => {
    server.close()
  })

  it('creates session', async () => {
    const session = await client.session.create.mutate({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet'
    })

    expect(session.id).toBeDefined()
    expect(session.provider).toBe('openrouter')
  })
})
```

## Best Practices

### Type Safety

✅ **Do:**
```typescript
// Let TypeScript infer types
const session = await client.session.get.query({ sessionId: 'abc' })
// session is fully typed ✅
```

❌ **Don't:**
```typescript
// Avoid explicit type casts
const session = (await client.session.get.query({ sessionId: 'abc' })) as Session
```

### Error Handling

✅ **Do:**
```typescript
try {
  await client.session.delete.mutate({ sessionId })
} catch (error) {
  if (error instanceof TRPCClientError) {
    if (error.data?.code === 'NOT_FOUND') {
      // Handle not found
    }
  }
}
```

❌ **Don't:**
```typescript
// Don't ignore errors
client.session.delete.mutate({ sessionId })  // ❌
```

### Subscription Cleanup

✅ **Do:**
```typescript
useEffect(() => {
  const sub = client.events.subscribeToSession.subscribe(...)
  return () => sub.unsubscribe()  // ✅ Cleanup
}, [sessionId])
```

❌ **Don't:**
```typescript
// Don't forget to unsubscribe
useEffect(() => {
  client.events.subscribeToSession.subscribe(...)
  // ❌ Memory leak
}, [sessionId])
```

## Related Documentation

- [Event Streaming](/architecture/streaming) - Event system details
- [Architecture Overview](/architecture/) - Overall system design
- [API Reference](/api/) - Complete API docs

## Resources

- [tRPC Documentation](https://trpc.io)
- [Zod Documentation](https://zod.dev)
- [RxJS Documentation](https://rxjs.dev)
