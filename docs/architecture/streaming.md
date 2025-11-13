# Event Streaming Architecture

Code's event streaming system enables real-time synchronization across multiple clients through a server-side event bus. This architecture supports AI streaming, tool execution feedback, and multi-client coordination.

## Overview

Event streaming separates client and server responsibilities:

**Core Principles:**
- ✅ Server: All business logic (AI streaming trigger, compact, etc.)
- ✅ Client: Pure UI, passively receives events and displays
- ✅ Multi-client sync: Event stream ensures all clients synchronized
- ✅ Selective delivery: Channel-based routing, subscribe on-demand

## Use Cases

### UC1: Normal Streaming (User sends message)

User initiates conversation → Direct subscription + event stream:

**Flow:**
```
1. User types "hi" in TUI
   ↓
2. Client: caller.message.streamResponse.subscribe({
     sessionId: 'session-abc',
     content: [{ type: 'text', content: 'hi' }]
   })
   ↓
3. Server: streamAIResponse() returns Observable
   ↓
4. Server emits events:
   - assistant-message-created
   - text-start
   - text-delta (multiple times)
   - tool-call (if any)
   - tool-result
   - text-end
   - complete
   ↓
5. Events delivered via TWO paths:

   Path A (Direct Subscription - Primary):
   streamResponse.subscribe()
     → onData callback
     → handleStreamEvent()
     → Update UI ✅

   Path B (Event Stream - Backup/Multi-client):
   Server publishes to session:session-abc
     → useEventStream receives
     → callbacks.onTextDelta()
     → Check streamingMessageIdRef
     → Skip (already handled by Path A) ✅
```

**State Tracking:**
- `streamingMessageIdRef.current = messageId` (when assistant-message-created)
- `streamingMessageIdRef.current = null` (when complete/error/abort)

**Result:**
- ✅ Client sees real-time AI response
- ✅ No duplicate display (deduplication mechanism)

### UC2: Compact with Auto-Response

Server-initiated streaming after compact:

**Flow:**
```
1. User executes /compact in TUI
   ↓
2. Client: caller.session.compact.mutate({
     sessionId: 'session-abc'
   })
   ↓
3. Server business logic:
   a) Read all messages from session-abc
   b) Call AI to generate summary
   c) Create new session-xyz
   d) Add system message (summary) to session-xyz
   e) Publish 'session-created' event to 'session-events' channel
   f) Auto-trigger AI streaming:
      streamAIResponse({
        sessionId: 'session-xyz',
        userMessageContent: null  // Use existing system message
      })
   ↓
4. Server streaming events (Event Stream path ONLY):
   Server.streamAIResponse Observable
     → subscribe internally
     → publish to session:session-xyz
     → Event Stream
     ↓
5. Client receives:
   useEventStream (subscribed to session:session-xyz)
     → callbacks.onAssistantMessageCreated()
     → Check streamingMessageIdRef.current
     → null (no direct subscription) ✅
     → handleStreamEvent() processes
     → Update UI ✅
```

**Key Difference:**
- **UC1**: Has direct subscription (Path A) → streamingMessageIdRef set → Path B skipped
- **UC2**: No direct subscription (Path B only) → streamingMessageIdRef is null → Path B processes

**Server-side Auto-trigger Location:**
- `packages/code-server/src/trpc/routers/session.router.ts` (compact mutation)
- Starts background streaming before returning
- Does not await, returns immediately to client

**Client-side Behavior:**
- Mutation returns → switch to new session
- useEventStream auto-resubscribes to session:session-xyz
- Receives and displays streaming events

**Result:**
- ✅ Server auto-triggers AI (business logic)
- ✅ Client passively receives and displays (pure UI)
- ✅ Multi-client synchronized (GUI also sees it)

### UC3: Multi-Client Sync

TUI sends message, GUI sees it real-time:

**Flow:**
```
1. User A types "hello" in TUI
   ↓
2. TUI Client:
   caller.message.streamResponse.subscribe({ content: 'hello' })
   ↓
3. Server streaming:
   streamAIResponse()
     → emit events
     → TUI onData (Path A) ✅
     → publish to session:session-abc (Path B)
     ↓
4. GUI Client (same session):
   useEventStream subscribed to session:session-abc
     → receives Path B events
     → callbacks.onTextDelta()
     → Check streamingMessageIdRef.current
     → null (GUI didn't initiate streaming) ✅
     → handleStreamEvent() processes
     → GUI displays ✅
```

**Result:**
- ✅ TUI sees own streaming (Path A)
- ✅ GUI sees TUI's streaming real-time (Path B)
- ✅ No duplication (deduplication)

### UC4: Resumable Streaming

Switch to session with ongoing streaming:

**Scenario:** TUI switches to GUI's active streaming session

**Initial State:**
```
GUI in session-abc sends "hi"
  → Server streaming (in progress...)
  → GUI sees streaming ✅
```

**TUI Switch Action:**
```
1. User switches from session-xyz to session-abc in TUI
   ↓
2. Client behavior:
   useEventStream useEffect triggers
     → unsubscribe session:session-xyz
     → subscribe session:session-abc with replayLast: 0
   ↓
3. Server Event Stream:
   session:session-abc channel has active streaming
     → ReplaySubject holds recent events (in-memory buffer)
     → New subscriber (TUI) receives buffered events
     → Continues receiving new events
   ↓
4. TUI Client:
   useEventStream callbacks
     → onTextDelta()
     → Check streamingMessageIdRef.current
     → null (TUI didn't initiate) ✅
     → handleStreamEvent()
     → Display ongoing streaming ✅
```

**ReplaySubject Configuration:**
- Buffer size: 100 events
- Buffer time: 5 minutes
- Location: `packages/code-server/src/services/app-event-stream.service.ts`

**replayLast Parameter:**
- `replayLast: 0` - Only receive new events (Chat.tsx uses this)
- `replayLast: N` - Replay last N events + new events

**Result:**
- ✅ TUI immediately sees ongoing streaming
- ✅ Real-time sync of subsequent events
- ✅ Won't miss any streaming content

### UC5: Selective Event Delivery

TUI in session-A, GUI in session-B:

#### 5.1 Session-specific events (don't cross sessions)

**Flow:**
```
Session A streaming (text-delta, tool-call, reasoning-delta):
  → Server publishes to session:session-A
  ↓
TUI (subscribed to session:session-A):
  → Receives events ✅
  → Displays
  ↓
GUI (subscribed to session:session-B):
  → Doesn't receive session-A events ✅
  → Not disturbed
```

**Channel Isolation:**
- Each session has independent channel: `session:${sessionId}`
- Client only subscribes to current session's channel
- Automatically filters other session events

#### 5.2 Global events (cross-session)

**Flow:**
```
Session A title updates:
  → Server publishes to session-events (global channel)
  ↓
TUI (subscribed to session-events):
  → Receives session-title-updated event ✅
  → Updates sidebar title
  ↓
GUI (subscribed to session-events):
  → Receives same event ✅
  → Updates sidebar title
```

**Global Channel:**
- `session-events`: session-created, session-deleted, session-title-updated
- All clients subscribe (sidebar sync)
- Dashboard.tsx uses `events.subscribeToAllSessions.subscribe()`

**Result:**
- ✅ Session-specific events don't disturb other sessions
- ✅ Global events reach all clients
- ✅ Efficient (no unnecessary events sent)

## Architecture Components

### 1. Event Stream Service

**Location:** `packages/code-server/src/services/app-event-stream.service.ts`

**Features:**
- Channel-based routing (`session:${id}`, `session-events`, `config:*`, `app:*`)
- ReplaySubject for in-memory buffering
- Cursor-based replay from database
- Auto-cleanup of old events

**Channel Types:**
```typescript
'session:${sessionId}'  // Session-specific streaming events
'session-events'        // Global session lifecycle events
'config:ai'            // Config changes
'app:*'                // App-level events
```

**Buffer Configuration:**
```typescript
bufferSize: 100                  // Keep last 100 events in memory
bufferTime: 5 * 60 * 1000        // 5 minutes
cleanupInterval: 60 * 1000       // Cleanup every 60 seconds
```

**Implementation:**
```typescript
class EventStreamService {
  private channels = new Map<string, ReplaySubject<StreamEvent>>()

  publish(channel: string, event: StreamEvent): void {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new ReplaySubject(100, 300000))
    }
    this.channels.get(channel)!.next(event)
  }

  subscribe(channel: string, replayLast = 0): Observable<StreamEvent> {
    if (!this.channels.has(channel)) {
      this.channels.set(channel, new ReplaySubject(100, 300000))
    }
    return this.channels.get(channel)!.asObservable()
  }

  cleanup(): void {
    // Remove inactive channels
    const now = Date.now()
    for (const [channel, subject] of this.channels) {
      if (now - subject.lastActivity > this.bufferTime) {
        subject.complete()
        this.channels.delete(channel)
      }
    }
  }
}
```

### 2. Client Event Stream Hook

**Location:** `packages/code-client/src/hooks/useEventStream.ts`

**Features:**
- Auto-subscribe to current session
- Auto-resubscribe on session change
- Replay support (replayLast parameter)
- Callback-based event handling

**Usage:**
```typescript
useEventStream({
  replayLast: 0,  // No replay
  callbacks: {
    onTextDelta: (text) => {
      if (streamingMessageIdRef.current) return  // Skip if direct sub
      handleStreamEvent({ type: 'text-delta', text })
    },
    onToolCall: (id, name, args) => {
      handleStreamEvent({ type: 'tool-call', id, name, args })
    },
    onComplete: (usage, reason) => {
      handleStreamEvent({ type: 'complete', usage, reason })
    },
  }
})
```

**Lifecycle:**
```typescript
useEffect(() => {
  // Cleanup previous subscription
  if (subscriptionRef.current) {
    subscriptionRef.current.unsubscribe()
  }

  // Subscribe to current session
  const subscription = client.events.subscribeToSession.subscribe(
    { sessionId: currentSessionId, replayLast }
  )

  // Process events
  subscription.onData((event) => {
    // Route to appropriate callback
    if (event.type === 'text-delta') {
      callbacks.onTextDelta?.(event.text)
    } else if (event.type === 'tool-call') {
      callbacks.onToolCall?.(event.toolCallId, event.toolName, event.args)
    }
    // ...
  })

  subscriptionRef.current = subscription

  // Cleanup on unmount or session change
  return () => subscription.unsubscribe()
}, [currentSessionId, replayLast])
```

### 3. Deduplication Mechanism

**Location:** `packages/code/src/screens/Chat.tsx`

**Problem:**
- Normal streaming has two paths (Direct + Event Stream)
- Without deduplication → duplicate display

**Solution:**
```typescript
const eventStreamCallbacks = useMemo(() => ({
  onTextDelta: (text: string) => {
    // Check if we have active direct subscription
    if (streamingMessageIdRef.current) {
      return  // Skip - already handled by direct path
    }
    // No direct subscription - handle via event stream
    handleStreamEvent({ type: 'text-delta', text }, ...)
  },

  onToolCall: (toolCallId, toolName, args) => {
    if (streamingMessageIdRef.current) return
    handleStreamEvent({ type: 'tool-call', toolCallId, toolName, args })
  },

  onComplete: (usage, finishReason) => {
    if (streamingMessageIdRef.current) return
    handleStreamEvent({ type: 'complete', usage, finishReason })
  }
}), [])
```

**State Tracking:**
```typescript
// Set when assistant-message-created (direct subscription active)
streamingMessageIdRef.current = messageId

// Clear when streaming completes
streamingMessageIdRef.current = null
```

**Decision Logic:**
```
if (streamingMessageIdRef.current !== null) {
  // Case 1: Normal streaming (UC1)
  // - Direct subscription active
  // - Skip event stream events (avoid duplicate)
} else {
  // Case 2: Compact auto-trigger (UC2) or Multi-client (UC3)
  // - No direct subscription
  // - Process event stream events
}
```

### 4. Server-side Streaming

**Location:** `packages/code-server/src/services/streaming.service.ts`

**Interface:**
```typescript
interface StreamAIResponseOptions {
  sessionId: string | null
  userMessageContent?: ParsedContentPart[] | null
  // If provided: add new user message
  // If null/undefined: use existing messages (compact use case)
}

function streamAIResponse(opts): Observable<StreamEvent>
```

**Dual Emit:**
```typescript
// In message.router.ts streamResponse subscription
streamAIResponse(opts).subscribe({
  next: (event) => {
    // 1. Emit to direct subscriber (Path A)
    emit.next(event)

    // 2. Publish to event stream (Path B)
    ctx.appContext.eventStream.publish(`session:${sessionId}`, event)
  }
})
```

### 5. Compact Flow

**Client Entry:**
```typescript
// packages/code/src/commands/definitions/compact.command.ts
const result = await client.session.compact.mutate({
  sessionId: currentSession.id
})

// Switch to new session
setCurrentSession(newSession)
addMessages(newSession.messages)

// Server auto-triggers streaming (no client action needed)
```

**Server Mutation:**
```typescript
// packages/code-server/src/trpc/routers/session.router.ts
compact: moderateProcedure
  .mutation(async ({ ctx, input }) => {
    // 1. Generate summary
    const result = await compactSession(...)

    // 2. Publish global events
    await ctx.appContext.eventStream.publish('session-events', {
      type: 'session-created',
      sessionId: result.newSessionId,
    })

    // 3. Auto-trigger AI streaming (background, non-blocking)
    streamAIResponse({
      sessionId: result.newSessionId,
      userMessageContent: null  // Use existing system message
    }).subscribe({
      next: (event) => {
        // Publish to event stream only (no direct subscriber)
        ctx.appContext.eventStream.publish(
          `session:${result.newSessionId}`,
          event
        )
      }
    })

    // 4. Return immediately (don't await streaming)
    return { success: true, newSessionId: result.newSessionId }
  })
```

## Event Types

### Session Events (channel: `session-events`)

```typescript
'session-created'          // { sessionId, provider, model }
'session-deleted'          // { sessionId }
'session-title-updated'    // { sessionId, title }
'session-model-updated'    // { sessionId, model }
'session-provider-updated' // { sessionId, provider, model }
'session-compacted'        // { oldSessionId, newSessionId, summary }
```

### Streaming Events (channel: `session:${sessionId}`)

```typescript
// Message lifecycle
'user-message-created'      // { messageId, content }
'assistant-message-created' // { messageId }

// Text streaming
'text-start'
'text-delta'                // { text }
'text-end'

// Reasoning streaming
'reasoning-start'
'reasoning-delta'           // { text }
'reasoning-end'             // { duration }

// Tool execution
'tool-call'                 // { toolCallId, toolName, args }
'tool-result'               // { toolCallId, toolName, result, duration }
'tool-error'                // { toolCallId, toolName, error, duration }

// File streaming
'file'                      // { mediaType, base64 }

// User interaction
'ask-question'              // { questionId, questions }

// Completion
'complete'                  // { usage, finishReason }
'error'                     // { error }
'abort'
```

## Key Design Decisions

### Why Event Stream?

**Cannot use Direct Subscription only:**
- ❌ Mutations don't have subscription channels (compact auto-trigger)
- ❌ Cannot implement multi-client sync
- ❌ Cannot resume streaming when switching sessions
- ❌ Switching sessions can't see ongoing streaming

**Event Stream solves:**
- ✅ Mutations can publish events
- ✅ Multiple clients subscribe to same channel
- ✅ ReplaySubject provides buffer and replay
- ✅ Channel-based routing for selective delivery

### Why Deduplication?

**Without deduplication:**
```
Normal streaming:
  Direct subscription → handleStreamEvent() ← Display once
  Event stream → handleStreamEvent() ← Display again
  Result: Duplicate display ❌
```

**With deduplication:**
```
Normal streaming:
  Direct subscription → handleStreamEvent() ← Display ✅
  Event stream → skip (has streamingMessageIdRef) ← Skip ✅
  Result: Display once ✅

Compact auto-trigger:
  Event stream → handle (no streamingMessageIdRef) ← Display ✅
  Result: Correct display ✅
```

### Why Server-side Auto-trigger?

**Client-side trigger problems:**
- ❌ Violates "Client is pure UI" principle
- ❌ Business logic in client
- ❌ Multi-client not synchronized (only initiating client triggers)

**Server-side trigger benefits:**
- ✅ Business logic on server
- ✅ All clients automatically synchronized (via event stream)
- ✅ Client passively receives, pure UI

### Why userMessageContent uses null?

**Design:**
```typescript
userMessageContent?: ParsedContentPart[] | null

// Use existing messages (compact)
userMessageContent: null

// Add new message (normal)
userMessageContent: [{ type: 'text', content: 'hi' }]
```

**Rejected alternatives:**
```typescript
// ❌ Confusing: empty array + boolean flag
content: []
skipUserMessage: true

// ❌ Magic: relies on empty array meaning
content: []  // What does this mean?
```

**Chosen solution:**
- ✅ Single parameter, clear intent
- ✅ null explicitly means "don't add new message"
- ✅ Type-safe

## Performance Considerations

### Event Stream Buffer

**Memory Usage:**
- Per-channel: 100 events × ~1KB = ~100KB
- 10 active sessions: ~1MB
- Acceptable for most use cases

**Cleanup:**
- Auto-cleanup every 60 seconds
- Remove events older than 5 minutes
- Configurable in app-event-stream.service.ts

### Event Delivery

**Latency:**
- In-memory publish/subscribe: < 1ms
- Database persistence: async, non-blocking
- Network transmission (TUI → GUI): < 10ms (local)

**Throughput:**
- RxJS ReplaySubject: > 10,000 events/sec
- Database writes: > 1,000 events/sec
- Bottleneck: AI streaming speed (limited by LLM)

## Troubleshooting

### Issue: Compact has no AI response

**Symptoms:**
- Compact completes
- Switches to new session
- Sees summary message
- AI doesn't respond (stuck on "Thinking...")

**Possible Causes:**

1. **Event stream callbacks disabled**
2. **streamingMessageIdRef logic error**
3. **Server doesn't auto-trigger**
4. **Event stream channel incorrect**

**Solutions:** Check deduplication logic, verify server auto-trigger, confirm channel names

### Issue: Duplicate content display

**Symptoms:**
- Normal streaming shows duplicate text
- Each text-delta displays twice

**Cause:**
- Deduplication not working
- Both paths processing events

**Solution:** Add `streamingMessageIdRef.current` check in callbacks

### Issue: Can't see ongoing streaming when switching sessions

**Symptoms:**
- GUI streaming
- TUI switches to same session
- TUI doesn't see streaming

**Possible Causes:**
- useEventStream not resubscribing
- ReplaySubject buffer too small
- Event stream not publishing

## Related Documentation

- [tRPC Communication](/architecture/trpc) - tRPC implementation details
- [Architecture Overview](/architecture/) - Overall system design
- [API Reference](/api/) - Complete API documentation

## Resources

- [RxJS ReplaySubject](https://rxjs.dev/api/index/class/ReplaySubject)
- [Server-Sent Events (SSE)](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)
