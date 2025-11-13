# Architecture Overview

Code is built on a pure UI client + daemon server architecture with event-driven synchronization. This design enables zero-overhead communication, real-time streaming, and perfect multi-client synchronization.

## Core Principles

### 1. Pure UI Client + Daemon Server

**Client (Pure UI):**
- UI state only (currentSessionId, isStreaming)
- Optimistic updates for instant feedback
- Event-driven communication
- NO business logic, NO persistence

**Server (Source of Truth):**
- All business logic
- Can run independently as daemon
- Serves multiple clients simultaneously
- Emits synchronization events

### 2. Zero-Overhead Communication

Traditional approach:
```typescript
Client → HTTP (3ms) → JSON Serialization → Server → Logic
// Slow, network-bound, single-client
```

Code's approach:
```typescript
Client → Direct Function Call (0.1ms) → Server
// 30x faster, zero serialization, multi-client ready
```

**Performance Results:**

| Operation | HTTP (localhost) | In-Process | Improvement |
|-----------|------------------|------------|-------------|
| Simple query | ~3ms | ~0.1ms | **30x faster** |
| Streaming start | ~5ms | ~0.2ms | **25x faster** |
| Tool execution | ~4ms | ~0.15ms | **27x faster** |

### 3. Event-Driven Architecture

Zero circular dependencies through event bus:

```typescript
// Session store emits
eventBus.emit('session:created', { sessionId });

// Settings store listens
eventBus.on('session:created', ({ sessionId }) => {
  updateLocalState(sessionId);
});

// Perfect decoupling ✅
```

### 4. Multi-Client Synchronization

All clients synchronized via server events:

```
TUI Client 1 ←──┐
TUI Client 2 ←──┼── Server SSE Events
Web Client   ←──┘
```

## System Architecture

### Stack Overview

```
┌─────────────────────────────────────────────────────┐
│  🖥️  Terminal UI      🌐  Web UI                   │  React (Ink/Next.js)
├─────────────────────────────────────────────────────┤
│  @sylphx/code-client                                │  Pure UI Client
│  - Event-driven sync (33 tests ✅)                 │  - Zero business logic
│  - Zustand stores                                   │  - Optimistic updates
│  - tRPC in-process link                             │  - Multi-client ready
├─────────────────────────────────────────────────────┤
│  @sylphx/code-server                                │  Business Logic
│  - tRPC v11 server                                  │  - Daemon-ready
│  - Subscription streaming                           │  - Multi-session
│  - Server-side decisions                            │  - AppContext
├─────────────────────────────────────────────────────┤
│  @sylphx/code-core                                  │  Headless SDK
│  - AI providers                                     │  - 10+ tools
│  - Session persistence                              │  - Agent system
│  - Tool execution                                   │  - libSQL database
└─────────────────────────────────────────────────────┘
```

### Package Structure

```
packages/
├── code-core/       # Headless SDK (350+ files)
│   ├── ai/          # Providers, streaming, agents
│   ├── database/    # Session persistence (libSQL)
│   ├── tools/       # 10+ built-in tools
│   └── config/      # Multi-tier configuration
├── code-server/     # tRPC v11 server
│   ├── trpc/        # Router, procedures
│   ├── services/    # Streaming service
│   └── context.ts   # AppContext
├── code-client/     # Pure UI Client
│   ├── stores/      # Event-driven Zustand
│   ├── lib/         # Event bus (33 tests)
│   └── trpc-links/  # In-process & HTTP
├── code/            # Terminal UI (Ink)
│   ├── screens/     # Chat, settings, dashboard
│   └── commands/    # Slash commands
└── code-web/        # Web UI (React + Next.js)
```

## Key Components

### 1. tRPC Communication Layer

**In-Process Link:**
- Direct function calls between client and server
- Zero serialization overhead
- Full TypeScript type safety
- 30x faster than HTTP

**HTTP/SSE Link:**
- For remote daemon connections
- WebSocket-like real-time updates
- Same API as in-process

Learn more: [tRPC Communication](/architecture/trpc)

### 2. Event Streaming System

**Features:**
- Channel-based routing (`session:${id}`, `session-events`)
- ReplaySubject for in-memory buffering
- Cursor-based replay from database
- Auto-cleanup of old events

**Use Cases:**
- Real-time AI streaming
- Multi-client synchronization
- Tool execution feedback
- Session lifecycle events

Learn more: [Event Streaming](/architecture/streaming)

### 3. State Management

**Client State (Zustand):**
- UI-only state (currentSessionId, isStreaming)
- Event bus coordination
- Zero circular dependencies
- Optimistic updates

**Server State (AppContext):**
- Business logic
- Session management
- Tool execution
- AI streaming

**Database State (libSQL):**
- Session persistence
- Message history
- Configuration
- Event log

### 4. AI Integration

**Provider Abstraction:**
```typescript
interface AIProvider {
  streamResponse(params: StreamParams): Observable<StreamEvent>
}
```

**Supported Providers:**
- OpenRouter (200+ models)
- Anthropic Claude
- OpenAI GPT
- Google Gemini
- Custom providers

**Streaming Architecture:**
- Observable-based subscriptions
- AsyncIterator support
- Real-time event propagation
- Backpressure handling

### 5. Tool System

**Tool Interface:**
```typescript
interface Tool {
  name: string
  description: string
  parameters: JSONSchema
  execute(params: unknown): Promise<ToolResult>
}
```

**Built-in Tools:**
- File operations (read, write, edit)
- Search (glob, grep)
- Shell (bash, output, kill)
- User input (ask-user-selection)
- Project (todo, notification)

**Execution Flow:**
```
AI Request → Tool Call → Execute → Stream Result → AI Continue
```

## Communication Patterns

### Pattern 1: Normal Streaming

User sends message → Direct subscription → Real-time response:

```
User Input
  ↓
Client: streamResponse.subscribe()
  ↓
Server: streamAIResponse()
  ↓
Observable<StreamEvent>
  ↓
Client: Render real-time
```

**Dual Path:**
- Path A: Direct subscription (primary)
- Path B: Event stream (multi-client sync)
- Deduplication prevents double-rendering

### Pattern 2: Server-Initiated Streaming

Server triggers AI (e.g., after compact) → Event stream only:

```
User: /compact
  ↓
Client: compact.mutate()
  ↓
Server: Generate summary
  ↓
Server: Auto-trigger streamAIResponse()
  ↓
Event Stream Only (no direct subscription)
  ↓
Client: Receives via event stream
```

**Key Difference:**
- No direct subscription
- Event stream is the primary path
- All clients receive updates

### Pattern 3: Multi-Client Sync

Changes in one client appear in all others:

```
TUI: Send message
  ↓
Server: Process + Emit events
  ↓
┌────────┬────────┬────────┐
TUI      Web      TUI-2
(Direct) (Event)  (Event)
  ↓        ↓        ↓
All see the same content ✅
```

### Pattern 4: Resumable Streaming

Switch to a session with ongoing streaming:

```
Web: Streaming in progress...
  ↓
TUI: Switch to same session
  ↓
TUI: Subscribe with replayLast: 0
  ↓
Server: ReplaySubject buffers recent events
  ↓
TUI: Receives buffer + continues live
  ↓
TUI sees ongoing stream ✅
```

## Quality Metrics (v0.1.0)

### Architecture Score

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Separation of Concerns | 3/10 | 9/10 | +200% |
| Decoupling | 4/10 | 10/10 | +150% |
| Testability | 2/10 | 9/10 | +350% |
| Multi-Client Ready | 5/10 | 10/10 | +100% |

**Overall: 4.4/10 → 9.6/10 (+118%)**

### Test Coverage

- **Event Bus**: 13 tests ✅
- **Store Coordination**: 11 tests ✅
- **Multi-Client Sync**: 9 tests ✅
- **Total**: 33 comprehensive tests

### Build Performance

| Package | Lines of Code | Build Time |
|---------|---------------|------------|
| code-core | ~8,000 | **75ms** ⚡ |
| code-server | ~2,000 | **23ms** ⚡ |
| code (TUI) | ~6,000 | **39ms** ⚡ |

Uses **bunup** for blazing-fast builds.

## Design Decisions

### Why Event Stream?

**Cannot use Direct Subscription only:**
- ❌ Mutations don't have subscription channels
- ❌ Cannot implement multi-client sync
- ❌ Cannot resume streaming when switching sessions
- ❌ Cannot handle server-initiated actions

**Event Stream solves:**
- ✅ Mutations can publish events
- ✅ Multiple clients subscribe to same channel
- ✅ ReplaySubject provides buffering
- ✅ Channel-based routing for selective delivery

### Why Deduplication?

**Without deduplication:**
```
Normal streaming:
  Direct subscription → Display ❌
  Event stream → Display ❌
  Result: Double display
```

**With deduplication:**
```
Normal streaming:
  Direct subscription → Display ✅
  Event stream → Skip ✅
  Result: Single display

Server-initiated:
  Event stream → Display ✅
  Result: Correct display
```

### Why Server-Side Auto-trigger?

**Client-side trigger problems:**
- ❌ Violates "pure UI client" principle
- ❌ Business logic in client
- ❌ Multi-client not synchronized

**Server-side trigger benefits:**
- ✅ Business logic on server
- ✅ All clients automatically synced
- ✅ Client remains pure UI

### Why In-Process Communication?

**HTTP problems:**
- ❌ ~3ms network latency (even localhost)
- ❌ JSON serialization overhead
- ❌ Complex error handling
- ❌ Resource-intensive

**In-process benefits:**
- ✅ ~0.1ms direct calls (30x faster)
- ✅ Zero serialization
- ✅ TypeScript type safety
- ✅ Minimal resource usage

## Performance Characteristics

### Event Stream

**Memory Usage:**
- Per-channel: 100 events × ~1KB = ~100KB
- 10 active sessions: ~1MB
- Acceptable for most use cases

**Latency:**
- In-memory publish/subscribe: < 1ms
- Database persistence: async, non-blocking
- Network transmission: < 10ms (local)

**Throughput:**
- RxJS ReplaySubject: > 10,000 events/sec
- Database writes: > 1,000 events/sec
- Bottleneck: AI streaming (limited by LLM)

### tRPC Communication

**In-Process:**
- Function call overhead: ~0.1ms
- No serialization
- No network
- Direct memory access

**HTTP/SSE:**
- Initial connection: ~5ms
- Subsequent messages: ~1-2ms
- WebSocket-like performance
- Automatic reconnection

## Future Improvements

### Planned Features

**v0.2.0:**
- [ ] VSCode extension (headless SDK)
- [ ] Web UI collaboration
- [ ] Plugin marketplace
- [ ] More AI providers
- [ ] Advanced agent composition
- [ ] Cloud session sync

### Performance Optimizations

- Event compression for reduced bandwidth
- Selective subscription to event types
- Cursor-based pagination for long sessions
- Smart event persistence strategy

### Architecture Enhancements

- WebSocket transport option
- Distributed event streaming
- Plugin system for custom tools
- GraphQL alternative to tRPC

## Related Documentation

- [tRPC Communication](/architecture/trpc) - Detailed tRPC implementation
- [Event Streaming](/architecture/streaming) - Event system deep dive
- [API Reference](/api/) - Complete API documentation
- [Development Guide](/development/) - Contributing to Code

## Resources

- 📖 [Architecture Optimization Report](https://github.com/SylphxAI/code/blob/main/ARCHITECTURE_OPTIMIZATION.md)
- 🧪 [Testing Guide](https://github.com/SylphxAI/code/blob/main/TESTING.md)
- 🐛 [Debug Guide](https://github.com/SylphxAI/code/blob/main/DEBUG.md)
