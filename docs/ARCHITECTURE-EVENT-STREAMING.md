# Event Streaming Architecture

## Overview

前後端分離架構，Server 處理所有業務邏輯，Client 是純 UI。多端實時同步（TUI + GUI）通過 event stream 實現。

**核心原則：**
- ✅ Server: 所有業務邻輯（AI streaming trigger, compact, etc.）
- ✅ Client: 純 UI，被動接收 events 並顯示
- ✅ Multi-client sync: Event stream 保證所有 clients 同步
- ✅ Selective delivery: Channel-based routing，按需訂閱

---

## Use Cases

### UC1: Normal Streaming（用戶發送消息）

**Flow:**
```
1. User 在 TUI 輸入 "hi" 並發送
   ↓
2. Client 調用: caller.message.streamResponse.subscribe({
     sessionId: 'session-abc',
     content: [{ type: 'text', content: 'hi' }]
   })
   ↓
3. Server: streamAIResponse() 返回 Observable
   ↓
4. Server emit events:
   - assistant-message-created
   - text-start
   - text-delta (多次)
   - tool-call (如果有)
   - tool-result
   - text-end
   - complete
   ↓
5. Events 通過兩條路徑送達 Client:

   Path A (Direct Subscription - 主要路徑):
   streamResponse.subscribe()
     → onData callback
     → handleStreamEvent()
     → 更新 UI ✅

   Path B (Event Stream - 備用路徑):
   Server publish to session:session-abc
     → useEventStream receives
     → callbacks.onTextDelta()
     → Check streamingMessageIdRef
     → Skip (已經由 Path A 處理) ✅
```

**狀態追蹤：**
- `streamingMessageIdRef.current = messageId` (當 assistant-message-created)
- `streamingMessageIdRef.current = null` (當 complete/error/abort)

**結果：**
- ✅ Client 實時看到 AI 回應
- ✅ 沒有重複顯示（deduplication 機制）

---

### UC2: Compact with Auto-Response（壓縮並自動觸發 AI）

**Flow:**
```
1. User 在 TUI 執行 /compact
   ↓
2. Client 調用 mutation: caller.session.compact.mutate({
     sessionId: 'session-abc'
   })
   ↓
3. Server 業務邏輯:
   a) 讀取 session-abc 的所有 messages
   b) 調用 AI 生成 summary
   c) 創建新 session-xyz
   d) 添加 system message (summary) 到 session-xyz
   e) Publish 'session-created' event to 'session-events' channel
   f) 自動觸發 AI streaming:
      streamAIResponse({
        sessionId: 'session-xyz',
        userMessageContent: null  // 使用現有 system message
      })
   ↓
4. Server streaming events (只有 Event Stream 路徑):
   Server.streamAIResponse Observable
     → subscribe 內部
     → publish to session:session-xyz
     → Event Stream
     ↓
5. Client 接收:
   useEventStream (訂閱 session:session-xyz)
     → callbacks.onAssistantMessageCreated()
     → Check streamingMessageIdRef.current
     → null (沒有 direct subscription) ✅
     → handleStreamEvent() 處理
     → 更新 UI ✅
```

**關鍵差異：**
- **UC1**: 有 direct subscription (Path A) → streamingMessageIdRef 有值 → Path B skip
- **UC2**: 沒有 direct subscription (只有 Path B) → streamingMessageIdRef 是 null → Path B 處理

**Server-side Auto-trigger 位置：**
- `packages/code-server/src/trpc/routers/session.router.ts` (compact mutation)
- 在返回結果前啟動 background streaming
- 不 await，立即返回給 client

**Client-side 行為：**
- Mutation 返回後切換到新 session
- useEventStream 自動 resubscribe 到 session:session-xyz
- 接收並顯示 streaming events

**結果：**
- ✅ Server 自動觸發 AI（業務邏輯）
- ✅ Client 被動接收並顯示（純 UI）
- ✅ 多端同步（GUI 也能看到）

---

### UC3: Multi-Client Sync（多端同步）

**Scenario: TUI 發送消息，GUI 實時看到**

**Flow:**
```
1. User A 在 TUI 輸入 "hello"
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
4. GUI Client (在同一個 session):
   useEventStream 訂閱 session:session-abc
     → 接收 Path B events
     → callbacks.onTextDelta()
     → Check streamingMessageIdRef.current
     → null (GUI 沒有發起 streaming) ✅
     → handleStreamEvent() 處理
     → GUI 顯示 ✅
```

**結果：**
- ✅ TUI 看到自己的 streaming (Path A)
- ✅ GUI 實時看到 TUI 的 streaming (Path B)
- ✅ 沒有重複（deduplication）

---

### UC4: Resumable Streaming（跨 Client 恢復進行中的 Streaming）

**Scenario: TUI 切換到 GUI 正在 streaming 的 session**

**Initial State:**
```
GUI 在 session-abc 發送 "hi"
  → Server streaming (進行中...)
  → GUI 看到 streaming ✅
```

**TUI 切換動作：**
```
1. User 在 TUI 從 session-xyz 切換到 session-abc
   ↓
2. Client 行為:
   useEventStream useEffect 觸發
     → unsubscribe session:session-xyz
     → subscribe session:session-abc with replayLast: 0
   ↓
3. Server Event Stream:
   session:session-abc channel 有 active streaming
     → ReplaySubject 保留最近的 events (in-memory buffer)
     → 新 subscriber (TUI) 收到 buffer 中的 events
     → 繼續收到新的 events
   ↓
4. TUI Client:
   useEventStream callbacks
     → onTextDelta()
     → Check streamingMessageIdRef.current
     → null (TUI 沒有發起) ✅
     → handleStreamEvent()
     → 顯示進行中的 streaming ✅
```

**ReplaySubject 配置：**
- Buffer size: 100 events
- Buffer time: 5 minutes
- 位置: `packages/code-server/src/services/app-event-stream.service.ts`

**replayLast 參數：**
- `replayLast: 0` - 只接收新 events（Chat.tsx 使用）
- `replayLast: N` - Replay 最近 N 個 events + 新 events

**結果：**
- ✅ TUI 立即看到進行中的 streaming
- ✅ 實時同步後續的 events
- ✅ 不會錯過任何 streaming content

---

### UC5: Selective Event Delivery（選擇性事件傳遞）

**Scenario: TUI 在 session-A，GUI 在 session-B**

#### 5.1 Session-specific events (不跨 session)

**Flow:**
```
Session A streaming (text-delta, tool-call, reasoning-delta):
  → Server publish to session:session-A
  ↓
TUI (訂閱 session:session-A):
  → 收到 events ✅
  → 顯示
  ↓
GUI (訂閱 session:session-B):
  → 不收到 session-A events ✅
  → 不干擾
```

**Channel Isolation:**
- 每個 session 有獨立 channel: `session:${sessionId}`
- Client 只訂閱當前 session 的 channel
- 自動過濾其他 session 的 events

#### 5.2 Global events (跨 session)

**Flow:**
```
Session A title 更新:
  → Server publish to session-events (global channel)
  ↓
TUI (訂閱 session-events):
  → 收到 session-title-updated event ✅
  → 更新 sidebar title
  ↓
GUI (訂閱 session-events):
  → 收到同樣的 event ✅
  → 更新 sidebar title
```

**Global Channel:**
- `session-events`: session-created, session-deleted, session-title-updated
- 所有 clients 都訂閱（sidebar sync）
- Dashboard.tsx 使用 `events.subscribeToAllSessions.subscribe()`

**結果：**
- ✅ Session-specific events 不會干擾其他 session
- ✅ Global events 所有 clients 都收到
- ✅ 高效（不傳送不必要的 events）

---

## Architecture Components

### 1. Event Stream Service

**Location:** `packages/code-server/src/services/app-event-stream.service.ts`

**Features:**
- Channel-based routing (session:${id}, session-events, config:*, app:*)
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
bufferSize: 100        // Keep last 100 events in memory
bufferTime: 5 * 60 * 1000  // 5 minutes
cleanupInterval: 60 * 1000  // Cleanup every 60 seconds
```

---

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
    onTextDelta: (text) => { ... },
    onToolCall: (id, name, args) => { ... },
    onComplete: (usage, reason) => { ... },
  }
})
```

**Lifecycle:**
```typescript
useEffect(() => {
  // Cleanup previous subscription
  if (subscriptionRef.current) {
    subscriptionRef.current.unsubscribe();
  }

  // Subscribe to current session
  const subscription = client.events.subscribeToSession.subscribe(
    { sessionId: currentSessionId, replayLast }
  );

  // Cleanup on unmount or session change
  return () => subscription.unsubscribe();
}, [currentSessionId, replayLast]);
```

---

### 3. Deduplication Mechanism

**Location:** `packages/code/src/screens/Chat.tsx`

**Problem:**
- Normal streaming 有兩條路徑（Direct + Event Stream）
- 沒有去重會導致重複顯示

**Solution:**
```typescript
const eventStreamCallbacks = useMemo(() => ({
  onTextDelta: (text: string) => {
    // Check if we have active direct subscription
    if (streamingMessageIdRef.current) {
      return; // Skip - already handled by direct path
    }
    // No direct subscription - handle via event stream
    handleStreamEvent({ type: 'text-delta', text }, ...);
  },
  // ... other callbacks
}), []);
```

**State Tracking:**
```typescript
// Set when assistant-message-created (direct subscription active)
streamingMessageIdRef.current = messageId;

// Clear when streaming completes
streamingMessageIdRef.current = null;
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

---

### 4. Server-side Streaming

**Location:** `packages/code-server/src/services/streaming.service.ts`

**Interface:**
```typescript
interface StreamAIResponseOptions {
  sessionId: string | null;
  userMessageContent?: ParsedContentPart[] | null;
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
    emit.next(event);

    // 2. Publish to event stream (Path B)
    ctx.appContext.eventStream.publish(`session:${sessionId}`, event);
  }
});
```

---

### 5. Compact Flow

**Client Entry:**
```typescript
// packages/code/src/commands/definitions/compact.command.ts
const result = await client.session.compact.mutate({
  sessionId: currentSession.id
});

// Switch to new session
setCurrentSession(newSession);
addMessages(newSession.messages);

// Server auto-triggers streaming (no client action needed)
```

**Server Mutation:**
```typescript
// packages/code-server/src/trpc/routers/session.router.ts
compact: moderateProcedure
  .mutation(async ({ ctx, input }) => {
    // 1. Generate summary
    const result = await compactSession(...);

    // 2. Publish global events
    await ctx.appContext.eventStream.publish('session-events', {
      type: 'session-created',
      sessionId: result.newSessionId,
    });

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
        );
      }
    });

    // 4. Return immediately (don't await streaming)
    return { success: true, newSessionId: result.newSessionId };
  })
```

---

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

---

## Key Design Decisions

### 1. 為什麼需要 Event Stream？

**不能只用 Direct Subscription 的原因：**
- ❌ Mutation 沒有 subscription channel (compact auto-trigger)
- ❌ 無法實現 multi-client sync
- ❌ 無法實現 resumable streaming
- ❌ 切換 session 無法看到進行中的 streaming

**Event Stream 解決：**
- ✅ Mutation 可以 publish events
- ✅ 多個 clients 可以 subscribe 同一個 channel
- ✅ ReplaySubject 提供 buffer 和 replay
- ✅ Channel-based routing 實現 selective delivery

### 2. 為什麼需要 Deduplication？

**沒有去重的問題：**
```
Normal streaming:
  Direct subscription → handleStreamEvent() ← 顯示一次
  Event stream → handleStreamEvent() ← 又顯示一次
  結果：重複顯示 ❌
```

**去重後：**
```
Normal streaming:
  Direct subscription → handleStreamEvent() ← 顯示 ✅
  Event stream → skip (has streamingMessageIdRef) ← 不處理 ✅
  結果：只顯示一次 ✅

Compact auto-trigger:
  Event stream → handle (no streamingMessageIdRef) ← 顯示 ✅
  結果：正確顯示 ✅
```

### 3. 為什麼 Server-side Auto-trigger？

**Client-side trigger 的問題：**
- ❌ 違反「Client 是純 UI」原則
- ❌ Business logic 在 client
- ❌ Multi-client 不同步（只有發起的 client trigger）

**Server-side trigger：**
- ✅ Business logic 在 server
- ✅ 所有 clients 自動同步（via event stream）
- ✅ Client 被動接收，純 UI

### 4. 為什麼 userMessageContent 用 null？

**設計：**
```typescript
userMessageContent?: ParsedContentPart[] | null

// 使用現有 messages (compact)
userMessageContent: null

// 添加新 message (normal)
userMessageContent: [{ type: 'text', content: 'hi' }]
```

**替代方案（被拒絕）：**
```typescript
// ❌ Confusing: empty array + boolean flag
content: []
skipUserMessage: true

// ❌ Magic: relies on empty array meaning
content: []  // What does this mean?
```

**Chosen solution：**
- ✅ 單一參數，意圖清晰
- ✅ null 明確表示「不添加新 message」
- ✅ Type-safe

---

## Testing Scenarios

### Scenario 1: Normal Streaming
```
1. 打開 TUI
2. 發送 "hi"
3. 驗證：
   - ✅ 看到 streaming (text-delta)
   - ✅ 看到 tool calls
   - ✅ 看到最終結果
   - ✅ 沒有重複內容
```

### Scenario 2: Compact Auto-Response
```
1. 打開 TUI
2. 發送幾條消息建立 conversation
3. 執行 /compact
4. 驗證：
   - ✅ 看到 "Compacting..." 指示器
   - ✅ Compact 完成後自動切換到新 session
   - ✅ 看到 summary system message
   - ✅ AI 自動開始回應 (streaming)
   - ✅ 看到 AI 的回應內容
```

### Scenario 3: Multi-Client Sync
```
1. 打開 TUI 和 GUI (兩個 terminals)
2. TUI: 發送 "hello"
3. GUI: 切換到同一個 session
4. 驗證：
   - ✅ TUI 看到自己的 streaming
   - ✅ GUI 實時看到 TUI 的 streaming
   - ✅ 兩邊內容一致
```

### Scenario 4: Resumable Streaming
```
1. 打開 GUI: 發送長的請求 (如 "write a long story")
2. GUI 開始 streaming (進行中)
3. 打開 TUI: 切換到同一個 session
4. 驗證：
   - ✅ TUI 立即看到進行中的 streaming
   - ✅ TUI 實時同步後續內容
   - ✅ 最終兩邊內容一致
```

### Scenario 5: Session Isolation
```
1. 打開 TUI: Session A，發送消息
2. 打開 GUI: Session B
3. 驗證：
   - ✅ GUI 不會看到 Session A 的 streaming
   - ✅ GUI 的 sidebar 會更新 Session A 的 title
```

---

## Troubleshooting

### Issue: Compact 後沒有 AI 回應

**Symptoms:**
- Compact 完成
- 切換到新 session
- 看到 summary message
- AI 沒有回應（一直 "Thinking..."）

**Possible Causes:**

1. **Event stream callbacks 被禁用**
   ```typescript
   // Check Chat.tsx
   onTextDelta: (text) => {
     return; // ❌ DISABLED
   }
   ```
   **Solution:** 啟用 callbacks with deduplication

2. **streamingMessageIdRef 邏輯錯誤**
   ```typescript
   // Should be:
   if (streamingMessageIdRef.current) return; // Skip

   // Not:
   if (!streamingMessageIdRef.current) return; // ❌ Wrong
   ```

3. **Server 沒有 auto-trigger**
   ```typescript
   // Check session.router.ts compact mutation
   // Should have:
   streamAIResponse({ ... }).subscribe({ ... })
   ```

4. **Event stream channel 錯誤**
   ```typescript
   // Should publish to:
   `session:${newSessionId}`

   // Not:
   `session:${oldSessionId}` // ❌ Wrong session
   ```

### Issue: 重複顯示內容

**Symptoms:**
- Normal streaming 時看到重複的 text
- 每個 text-delta 顯示兩次

**Cause:**
- Deduplication 沒有工作
- 兩條路徑都在處理 events

**Solution:**
```typescript
// Chat.tsx eventStreamCallbacks
onTextDelta: (text) => {
  if (streamingMessageIdRef.current) {
    return; // ✅ Add this check
  }
  handleStreamEvent({ type: 'text-delta', text }, ...);
}
```

### Issue: 切換 session 看不到進行中的 streaming

**Symptoms:**
- GUI 正在 streaming
- TUI 切換到同一個 session
- TUI 沒有看到 streaming

**Possible Causes:**

1. **useEventStream 沒有 resubscribe**
   - Check useEffect dependencies
   - Should include currentSessionId

2. **ReplaySubject buffer 太小**
   - Default: 100 events, 5 minutes
   - 如果 streaming 太長可能超出 buffer

3. **Event stream 沒有 publish**
   - Check message.router.ts
   - Should publish to event stream after emit

---

## Performance Considerations

### Event Stream Buffer

**Memory Usage:**
- Per-channel: 100 events × ~1KB = ~100KB
- 10 active sessions: ~1MB
- Acceptable for most use cases

**Cleanup:**
- Auto-cleanup every 60 seconds
- Remove events older than 5 minutes
- Can be configured in app-event-stream.service.ts

### Event Delivery

**Latency:**
- In-memory publish/subscribe: < 1ms
- Database persistence: async, non-blocking
- Network transmission (TUI → GUI): < 10ms (local)

**Throughput:**
- RxJS ReplaySubject: > 10,000 events/sec
- Database write: > 1,000 events/sec
- Bottleneck: AI streaming speed (limited by LLM)

---

## Future Improvements

### 1. Event Compression
- Compress text-delta events
- Batch multiple small deltas
- Reduce network bandwidth

### 2. Selective Subscription
- Subscribe to specific event types only
- Example: Only subscribe to text-delta, skip tool events
- Reduce unnecessary processing

### 3. Event Persistence Strategy
- Currently: Persist all events
- Future: Persist only important events (message-created, complete)
- Reduce database writes

### 4. Cursor-based Pagination
- Currently: ReplaySubject keeps all events in memory
- Future: Use cursor-based pagination for very long sessions
- Fetch events on-demand

---

## References

### Code Locations

**Event Stream:**
- Server: `packages/code-server/src/services/app-event-stream.service.ts`
- Router: `packages/code-server/src/trpc/routers/events.router.ts`
- Client Hook: `packages/code-client/src/hooks/useEventStream.ts`

**Streaming:**
- Service: `packages/code-server/src/services/streaming.service.ts`
- Router: `packages/code-server/src/trpc/routers/message.router.ts`
- Client Adapter: `packages/code/src/screens/chat/streaming/subscriptionAdapter.ts`
- Event Handlers: `packages/code/src/screens/chat/streaming/streamEventHandlers.ts`

**Deduplication:**
- Implementation: `packages/code/src/screens/Chat.tsx` (eventStreamCallbacks)

**Compact:**
- Command: `packages/code/src/commands/definitions/compact.command.ts`
- Server: `packages/code-server/src/trpc/routers/session.router.ts`
- Core Logic: `packages/code-core/src/ai/compact-service.ts`

### Related Documents
- Architecture Decision Records (ADR)
- API Documentation
- Testing Guide
