# TodoSnapshot 現實分析

## TL;DR

**用戶的觀察是正確的**: TodoSnapshot **不存在** 於資料庫中。

雖然 TypeScript 類型定義了 `todoSnapshot?: Todo[]`，但實際上：
- ❌ **不儲存** 到資料庫
- ✅ **有發送** 在 runtime events 中
- ❌ **不注入** 到 LLM context
- ⚠️ **類型定義與實現不一致**

---

## 完整追踪

### 1. TypeScript 類型定義（說有）

**檔案**: `/Users/kyle/code/packages/code-core/src/types/session.types.ts`

```typescript
export interface MessageStep {
  id: string;
  stepIndex: number;
  parts: MessagePart[];

  // Per-step context (captured at step start time)
  metadata?: MessageMetadata;  // ✅ 實際有儲存
  todoSnapshot?: Todo[];       // ❌ 實際沒有儲存！

  // ...
}
```

**註釋說** (line 90-94):
```typescript
// Why steps have metadata + todoSnapshot:
// 1. Step = request at specific time → captures system status at that moment
// 2. Todos change between steps → each step sees different todo state
// 3. Multi-step execution → step 0 has different context than step 1
// 4. LLM needs context for EACH step, not just message start
```

這些註釋描述的是 **理想設計**，但 **不是實際實現**！

---

### 2. 資料庫 Schema（說沒有）

**檔案**: `/Users/kyle/code/packages/code-core/src/database/schema.ts`

**Lines 238-255**:
```typescript
/**
 * @deprecated Step todo snapshots table - REMOVED
 *
 * Todo snapshots are NO LONGER stored per-step.
 * Only send todos on first user message after /compact command.
 *
 * Rationale:
 * - User reported 100+ steps per message being common
 * - Storing todos on every step is excessive and wasteful
 * - Todos are only needed when starting new context after /compact
 */
```

**資料庫的真相**:
- `messageSteps` 表 **沒有** `todoSnapshot` 欄位
- `stepTodoSnapshots` 表已經 **刪除**
- Schema 明確標記為 `@deprecated` 和 `REMOVED`

---

### 3. Runtime 流程（接受但忽略）

#### 3.1. Streaming Service 傳遞 todoSnapshot

**檔案**: `/Users/kyle/code/packages/code-server/src/services/streaming.service.ts`

**Line 256** (addMessage 呼叫):
```typescript
userMessageId = await messageRepository.addMessage({
  sessionId,
  role: 'user',
  content: frozenContent,
  metadata: {
    cpu: systemStatus.cpu,
    memory: systemStatus.memory,
  },
  todoSnapshot: session.todos, // ← 傳遞 session.todos
});
```

**Line 381, 408** (event 發送):
```typescript
// 9.2. Capture metadata and todoSnapshot for step-0
const currentSystemStatus = getSystemStatus();
const currentTodos = updatedSession.todos || []; // ← 從 session.todos 取得

// 9.4. Emit step-start event
observer.next({
  type: 'step-start',
  stepId,
  stepIndex: 0,
  metadata: stepMetadata,
  todoSnapshot: currentTodos, // ← 發送在 event 中
});
```

#### 3.2. Repository 接受但不儲存

**檔案**: `/Users/kyle/code/packages/code-core/src/database/message-repository.ts`

**Line 60, 70** (參數定義):
```typescript
async addMessage(options: {
  sessionId: string;
  role: 'user' | 'assistant';
  content: MessagePart[];
  usage?: TokenUsage;
  finishReason?: string;
  metadata?: MessageMetadata;
  todoSnapshot?: TodoType[]; // ← 接受參數
  status?: 'active' | 'completed' | 'error' | 'abort';
}): Promise<string>
```

**Line 88-175** (實際 INSERT 語句):
```typescript
await this.db.transaction(async (tx) => {
  // 1. Insert message container
  await tx.insert(messages).values({
    id: messageId,
    sessionId,
    role,
    timestamp: now,
    ordering,
    finishReason: finishReason || null,
    status: status || 'completed',
  }); // ← 沒有 todoSnapshot

  // 2. Insert step-0 with content
  await tx.insert(messageSteps).values({
    id: stepId,
    messageId,
    stepIndex: 0,
    status: status || 'completed',
    metadata: metadata ? JSON.stringify(metadata) : null, // ← metadata 有儲存
    startTime: now,
    endTime: status === 'completed' ? now : null,
    provider: null,
    model: null,
    duration: null,
    finishReason: finishReason || null,
  }); // ← 沒有 todoSnapshot

  // 3-5. Insert parts, usage, etc.
  // ... 完全沒有使用 todoSnapshot 參數
});
```

**結論**: `todoSnapshot` 參數被接受但 **從未寫入資料庫**！

#### 3.3. createMessageStep 明確忽略

**檔案**: `/Users/kyle/code/packages/code-core/src/database/step-repository-helpers.ts`

**Line 29-39**:
```typescript
/**
 * Create a new step in a message
 *
 * @param todoSnapshot DEPRECATED - No longer stored per-step
 *   Todos are only sent on first user message after /compact
 *   This parameter is kept for backward compatibility but ignored
 */
export async function createMessageStep(
  db: LibSQLDatabase,
  messageId: string,
  stepIndex: number,
  metadata?: MessageMetadata,
  _todoSnapshot?: TodoType[] // ← 注意下劃線前綴！參數被明確標記為忽略
): Promise<string>
```

**Line 63-64**:
```typescript
// REMOVED: stepTodoSnapshots - no longer stored per-step
// Todos are only sent on first user message after /compact
```

#### 3.4. Loading 時不會載入

**檔案**: `/Users/kyle/code/packages/code-core/src/database/step-repository-helpers.ts`

**Line 214-215** (loadMessageSteps):
```typescript
// REMOVED: todoSnapshot - no longer stored per-step
// Todos are only sent on first user message after /compact
```

**結果**: 從資料庫載入的 MessageStep 物件 **沒有** `todoSnapshot` 欄位。

---

### 4. LLM Context Building（檢查但永遠找不到）

**檔案**: `/Users/kyle/code/packages/code-core/src/ai/message-builder/index.ts`

**Line 71-74** (buildUserMessage):
```typescript
// Inject todo context from snapshot
if (msg.todoSnapshot && msg.todoSnapshot.length > 0) {
  const todoContext = buildTodoContext(msg.todoSnapshot);
  contentParts.push({ type: 'text', text: todoContext });
}
```

**問題**:
- 這段程式碼 **永遠不會執行**
- 因為 `msg.todoSnapshot` 從資料庫載入時 **永遠是 undefined**
- Todos **不會** 被注入到 LLM context

---

## 矛盾總結

| 層級 | 說法 | 實際 | 結果 |
|------|------|------|------|
| **TypeScript Types** | todoSnapshot 存在且儲存 | ❌ | 類型與實現不符 |
| **Database Schema** | todoSnapshot REMOVED | ✅ | 沒有資料庫欄位 |
| **Runtime Functions** | 接受 todoSnapshot 參數 | ❌ 不儲存 | 只是向後相容 |
| **Events** | 發送 todoSnapshot | ✅ | 即時顯示用 |
| **Loading** | 應該載入 todoSnapshot | ❌ | 永遠是 undefined |
| **LLM Context** | 應該注入 todos | ❌ | 永遠不執行 |

---

## 設計意圖 vs 實際實現

### 原始設計意圖（從註釋推斷）

```
每個 step 儲存 todoSnapshot:
- Step 0 (t=0): todos=[task1, task2]
- Step 1 (t=5s): todos=[task1, task2, task3] // 新增了 task3
- LLM 在每個 step 都看到當時的 todo 狀態
```

### 實際決策（從 schema comment）

```
不再儲存 todoSnapshot:
- 用戶報告每個 message 有 100+ steps
- 每個 step 都儲存 todos 太浪費
- Todos 只在 /compact 後的第一個 user message 需要
```

### 但實現不完整！

**應該做的**:
1. 在 `/compact` 後的第一個 user message 傳送 todos
2. 其他 messages 不傳送 todos
3. 更新 TypeScript 類型移除 `todoSnapshot`（或標記為 deprecated）
4. 移除 buildUserMessage 中無用的檢查

**實際做的**:
1. ✅ 移除資料庫儲存
2. ✅ 函數參數標記為 ignored
3. ❌ 類型定義仍然有 `todoSnapshot`
4. ❌ buildUserMessage 仍然檢查（但永遠找不到）
5. ⚠️ Events 仍然發送（但不確定用途）
6. ❌ 沒有實現「/compact 後第一個 message 傳送 todos」的邏輯

---

## 實際資料流

### 正確的資料來源

```typescript
// Runtime 狀態
session.todos: Todo[] ← 從 sessions 表的 todos 欄位
                       (JSON string in database)
                       ↓
// Streaming 時
currentTodos = session.todos
                       ↓
// 發送到 events（即時顯示）
observer.next({
  type: 'step-start',
  todoSnapshot: currentTodos // ✅ Event 有
})
                       ↓
// 嘗試儲存到資料庫
addMessage({ todoSnapshot: currentTodos })
createMessageStep(..., _todoSnapshot)
                       ↓
                    ❌ 被忽略，不儲存
                       ↓
// 從資料庫載入
loadMessageSteps(messageId)
                       ↓
msg.todoSnapshot = undefined // ❌ 沒有這個欄位
                       ↓
// Building LLM context
if (msg.todoSnapshot && ...) // ❌ 永遠是 false
  → Todos 不注入 LLM context
```

---

## 需要修復的地方

### 1. 類型定義一致性 ⚠️ **Critical**

**問題**: TypeScript 類型說有，但資料庫沒有

**選項 A**: 移除類型（推薦）
```typescript
export interface MessageStep {
  id: string;
  stepIndex: number;
  parts: MessagePart[];
  metadata?: MessageMetadata;  // ✅ Keep (actually stored)
  // todoSnapshot?: Todo[];    // ❌ Remove (not stored)
  // ...
}
```

**選項 B**: 標記為 deprecated
```typescript
export interface MessageStep {
  id: string;
  stepIndex: number;
  parts: MessagePart[];
  metadata?: MessageMetadata;
  /**
   * @deprecated No longer stored per-step
   * Todos are now managed at session level only
   */
  todoSnapshot?: Todo[];
  // ...
}
```

### 2. 移除無用程式碼 🟡 **Medium**

**檔案**: `message-builder/index.ts` line 71-74

```typescript
// ❌ Remove this - never executes
if (msg.todoSnapshot && msg.todoSnapshot.length > 0) {
  const todoContext = buildTodoContext(msg.todoSnapshot);
  contentParts.push({ type: 'text', text: todoContext });
}
```

### 3. Event 發送決策 🟢 **Low**

**問題**: Events 還在發送 todoSnapshot，但不知道用途

**選項 A**: 保留（如果前端需要即時顯示 todos）
```typescript
// Keep for real-time todo display in UI
observer.next({
  type: 'step-start',
  todoSnapshot: currentTodos
});
```

**選項 B**: 移除（如果沒人用）
```typescript
// Todos managed separately via session.todos
observer.next({
  type: 'step-start',
  // No todoSnapshot
});
```

### 4. 實現「Compact 後傳送 todos」邏輯 🔵 **Future**

**Schema comment 說明**: "Todos are only needed when starting new context after /compact"

**目前狀況**: 這個邏輯 **沒有實現**

**應該實現**:
```typescript
// After /compact, on first user message:
if (isFirstMessageAfterCompact) {
  // Inject todos into user message content
  const todoContext = buildTodoContext(session.todos);
  userMessageContent.push({
    type: 'text',
    content: `<current-todos>\n${todoContext}\n</current-todos>`
  });
}
```

---

## 推薦修復順序

### Phase 1: 立即修復（文檔一致性）✅
1. ✅ 創建此文檔說明現狀
2. 標記 TypeScript 類型為 `@deprecated`
3. 更新相關註釋說明 todoSnapshot 不再儲存

### Phase 2: 清理程式碼 🟡
1. 移除 buildUserMessage 中的無用檢查
2. 決定 events 是否需要 todoSnapshot
3. 移除 addMessage/createMessageStep 中的 todoSnapshot 參數（breaking change）

### Phase 3: 實現正確邏輯 🔵
1. 實現「Compact 後第一個 message 注入 todos」
2. 更新 UC 文檔說明新的 todo 處理策略

---

## 總結

**用戶的問題 "Todo Snapshots ✅ 有嗎？你結構我看不到" 是完全正確的！**

TodoSnapshot:
- ❌ **不在** 資料庫 schema 中
- ❌ **不會** 儲存到資料庫
- ❌ **不會** 從資料庫載入
- ❌ **不會** 注入到 LLM context
- ✅ **有在** TypeScript 類型定義中（但不應該）
- ✅ **有在** runtime events 中發送（不確定用途）
- ⚠️ **類型定義與實現完全不一致**

這是一個 **半完成的重構** - 資料庫層已經移除，但類型和部分程式碼還沒清理。
