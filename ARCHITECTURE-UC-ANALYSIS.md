# Use Case 架構分析

## 當前架構總覽

**Mutation + Subscription 模式** (去中心化)
- Mutation: `message.triggerStream()` - 觸發 streaming
- Subscription: `message.subscribe({ sessionId })` - 訂閱特定 session 的events

**Event Channels:**
1. `session:{sessionId}` - Session-specific events (text-delta, tool-call, etc.)
2. `session-events` - Global events (session-created, title-updated for sidebar)

---

## UC1: Normal Streaming ✅

### 用戶期望
```
User 輸入 "hi"
→ Client 調用 subscription: caller.message.streamResponse.subscribe()
→ Server emit events
→ Client 顯示
```

### 當前實現
```typescript
// Client: subscriptionAdapter.ts
1. await caller.message.triggerStream.mutate({
     sessionId,
     content: [{ type: 'text', content: 'hi' }]
   })
   // Returns: { success: true, sessionId }

2. // useEventStream (Chat.tsx) 自動訂閱
   client.message.subscribe.subscribe({
     sessionId,
     replayLast: 50
   }, {
     onData: (event) => { /* handle events */ }
   })

3. // Server publishes to session:{sessionId}
   eventStream.publish(`session:${sessionId}`, event)
```

### 架構對應
- ✅ 功能正常（用戶確認 TUI 沒問題）
- ⚠️ 與描述不符：現在是 **mutation + subscription**，不是單一 subscribe
- 原因：分離 trigger 和 receive 提供更好的控制和錯誤處理

---

## UC2: Compact with Auto-Response ❌

### 用戶期望
```
User 執行 /compact
→ Server 創建新 session + 自動觸發 AI streaming
→ Client 接收 streaming events
→ Client 顯示 AI response
```

### 當前實現
```typescript
// Server: session.router.ts compact mutation
1. compactSession() // Creates new session with summary
   → Returns newSessionId

2. streamAIResponse({ sessionId: newSessionId, ... }).subscribe({
     next: (event) => {
       eventStream.publish(`session:${newSessionId}`, event) // 發布到新 session channel
     }
   })
   // ⚠️ 在背景執行，不等待

3. return { newSessionId } // 立即返回

// Client: 收到 newSessionId
4. setCurrentSessionId(newSessionId)
5. useEventStream 重新訂閱 session:${newSessionId}
   // ⚠️ 可能已經錯過早期事件！
```

### 問題分析

**Race Condition Timeline:**
```
t=0ms:  Server starts streaming, publishes event 1-5
t=50ms: Server publishes event 6-10
t=100ms: Client receives mutation response with newSessionId
t=120ms: Client subscribes to session:newSessionId
t=120ms: ReplaySubject replays last 10 events (events 1-10) ✅

BUT if streaming is fast:
t=0ms:  Server publishes events 1-15 (rapid fire)
t=50ms: ReplaySubject buffer (size 10) only keeps events 6-15
t=100ms: Client subscribes
t=100ms: Replays events 6-15 only
        ❌ Events 1-5 LOST!
```

### 解決方案

#### Option 1: 增加 Buffer Size（簡單）
```typescript
// app-event-stream.service.ts
const bufferSize = 50; // 從 10 增加到 50
```
- ✅ 簡單，不需要改架構
- ❌ 只是延後問題（如果 streaming 超過 50 events 仍會丟失）

#### Option 2: 等待 Client 訂閱（推薦）
```typescript
// session.router.ts compact mutation
1. Start streaming
2. Wait for first event (session-created or assistant-message-created)
3. Return newSessionId
4. Client subscribes with replayLast
5. Receives all events (from persistence + buffer)
```

#### Option 3: Polling Pattern
```typescript
// Client polls for new session until ready
1. Call compact.mutate() → Get newSessionId
2. Subscribe to session:newSessionId with replayLast=100
3. Persistence ensures all events are replayed
```

### 當前狀態
- ❌ 不工作（用戶確認）
- 原因：ReplaySubject buffer (10) + fast streaming = lost events
- 建議：**增加 buffer 到 50** + 確保 persistence 保存所有事件

---

## UC3: Multi-Client Sync ✅

### 用戶期望
```
User A (TUI) 發送消息
→ Server streaming
→ User B (GUI) 實時看到
```

### 當前實現
```typescript
// User A (TUI)
1. triggerStream.mutate() → Starts streaming
2. Server publishes to session:${sessionId}

// User B (GUI) - 已經訂閱同一 session
3. message.subscribe({ sessionId }) receives events
4. Updates UI in real-time
```

### 架構對應
- ✅ 通過 event stream 實現
- ✅ 所有訂閱同一 session 的 client 都能看到
- EventStream 使用 RxJS Subject，多播到所有訂閱者

---

## UC4: Resumable Streaming ✅

### 用戶期望
```
GUI 在 session A streaming
→ TUI 切換到 session A
→ TUI 看到正在進行的 streaming
```

### 當前實現
```typescript
// TUI switches to session A
1. setCurrentSessionId(sessionA)

2. useEventStream effect triggers:
   if (subscriptionRef.current) {
     subscriptionRef.current.unsubscribe() // Cleanup old session
   }

   client.message.subscribe.subscribe({
     sessionId: sessionA,
     replayLast: 50 // ✅ Replay last 50 events
   })

3. Receives:
   - DB replay (last 50 from persistence)
   - Buffer replay (last 10 from ReplaySubject)
   - Live events (ongoing streaming)
```

### 架構對應
- ✅ `replayLast: 50` 確保可以看到歷史事件
- ✅ Persistence layer 保存所有事件到 database
- ✅ 自動處理 session 切換（useEffect cleanup + resubscribe）

---

## UC5: Selective Event Delivery ✅

### 用戶期望
```
TUI 在 session A, GUI 在 session B

Session A streaming (text-delta, tool-call):
→ TUI 收到 ✅
→ GUI 不收到 ✅

Session A title 更新:
→ TUI 收到 ✅ (實時顯示)
→ GUI 收到 ✅ (sidebar 更新)
```

### 當前實現

#### Event Publishing Strategy
```typescript
// event-publisher.ts
export async function publishTitleUpdate(eventStream, sessionId, title) {
  await Promise.all([
    // 1. Session-specific channel (只有該 session 的人收到)
    eventStream.publish(`session:${sessionId}`, {
      type: 'session-title-updated-end',
      sessionId,
      title,
    }),

    // 2. Global channel (所有人收到，用於 sidebar sync)
    eventStream.publish('session-events', {
      type: 'session-title-updated',
      sessionId,
      title,
    }),
  ]);
}
```

#### Client Subscriptions
```typescript
// TUI in session A
1. message.subscribe({ sessionId: 'A' })
   → Receives: text-delta, tool-call, title-updated-end ✅

2. events.subscribeToAllSessions()
   → Receives: session-created, session-title-updated (all sessions) ✅

// GUI in session B
1. message.subscribe({ sessionId: 'B' })
   → Does NOT receive session A events ✅

2. events.subscribeToAllSessions()
   → Receives: session-title-updated for session A ✅
   → Updates sidebar
```

### 架構對應
- ✅ Session-specific events → `session:{sessionId}` channel
- ✅ Global events → `session-events` channel
- ✅ Client 選擇性訂閱需要的 channels
- ✅ 實現了 selective delivery

---

## 架構決策回顧

### ✅ Per-Channel Subscription (去中心化)

**選擇**: `message.subscribe({ sessionId })` - 每個 session 獨立訂閱

**優點**:
- ✅ 強類型：`SessionEvent` 而不是 `any`
- ✅ IDE 自動補全
- ✅ 天然的 selective delivery
- ✅ 不需要 client-side filtering

**vs Centralized**:
```typescript
// ❌ Centralized (rejected)
events.subscribe({ channel: "session:123" })
→ Returns: StoredEvent (需要 unwrap payload)
→ Type: any (需要 client-side type narrowing)
→ Filtering: Client 需要自己過濾
```

### ✅ Mutation + Subscription Pattern

**選擇**: 分離 trigger 和 receive

**優點**:
- ✅ 更好的錯誤處理（mutation 可以返回錯誤）
- ✅ 支持 lazy session creation（mutation 返回 sessionId）
- ✅ 支持 server-side auto-trigger（compact）
- ✅ 清晰的責任分離

**Trade-offs**:
- ⚠️ 需要兩步操作（trigger + subscribe）
- ⚠️ 可能有 race condition（UC2）

---

## 修復建議

### 🔴 Critical: UC2 Compact Auto-Response

**問題**: ReplaySubject buffer 太小，快速 streaming 會丟失事件

**解決方案** (按優先級):

1. **立即**: 增加 buffer size
   ```typescript
   // app-event-stream.service.ts
   const bufferSize = 50; // 從 10 → 50
   ```

2. **本週**: 確保 persistence 保存所有事件
   ```typescript
   // Verify event-persistence.service.ts saves all events
   // Client uses replayLast=100 for compact
   ```

3. **未來**: Compact mutation 等待 client 訂閱
   ```typescript
   // session.router.ts
   // Wait for client acknowledgment before returning
   ```

### 🟡 Enhancement: UC1 描述更新

**問題**: 文檔描述單一 `streamResponse.subscribe()`，但實現是 mutation + subscription

**解決方案**:
- 更新 UC1 描述反映當前架構
- 或添加注釋說明為什麼改成 mutation + subscription

---

## 總結

| UC | 狀態 | 備註 |
|----|------|------|
| UC1: Normal Streaming | ✅ | 功能正常，但描述需更新 |
| UC2: Compact Auto-Response | ❌ | Race condition, 需要增加 buffer |
| UC3: Multi-Client Sync | ✅ | Event stream 正確實現 |
| UC4: Resumable Streaming | ✅ | Replay 機制工作正常 |
| UC5: Selective Delivery | ✅ | Dual-channel 策略正確 |

**架構決策**: 全部正確 ✅
- Per-channel subscription (去中心化)
- Mutation + subscription pattern
- Dual-channel event publishing

**需要修復**: 只有 UC2 ❌
