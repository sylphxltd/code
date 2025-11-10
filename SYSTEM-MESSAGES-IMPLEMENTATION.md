# System Messages Implementation

## 概述

實現了智能的系統提示機制，將所有系統級別的 LLM 提示統一到 system role messages，用 `<system_message>` 標籤包裝。

## 架構

### 核心設計

**System Role Message**:
- 儲存為 `role: 'system'` 在資料庫
- 轉換為 `user` role 給 LLM（防止 attention decay）
- 用 `<system_message type="...">` 包裝
- 由各種觸發條件動態插入

### 替代方案

**舊架構（已移除）**:
```typescript
// ❌ REMOVED: 每個 message 都注入 metadata
if (msg.metadata) {
  // CPU: 45%, Memory: 2GB/8GB
  contentParts.push({ type: 'text', text: systemStatusString });
}

// ❌ 問題：
// 1. 所有 messages 都有冗餘的系統狀態
// 2. 不夠智能（不管是否需要都顯示）
// 3. 沒有結構化標記（LLM 難以識別）
```

**新架構（當前）**:
```typescript
// ✅ 只在需要時插入系統消息
if (cpuUsage > 0.8) {
  insertSystemMessage(sessionId, SystemMessages.resourceWarningCPU(status.cpu));
}

// ✅ 優點：
// 1. 按需提示（只在觸發條件時）
// 2. 結構化 <system_message> 標籤
// 3. 可儲存可追蹤（歷史記錄完整）
```

---

## 實現的系統消息類型

### 1. Context Usage Warnings

#### 80% Warning (一次性)
```typescript
SystemMessages.contextWarning80()
```

**觸發條件**: `currentTokens / maxTokens > 0.8`

**消息內容**:
```xml
<system_message type="context-warning">
⚠️ Context Usage Warning

Current context usage: >80% (less than 20% remaining)

The conversation context is approaching the limit. Please be aware that:
- Complex responses may be truncated
- Consider wrapping up current tasks
- Prepare for potential context summarization

When context reaches 90%, the conversation will be automatically summarized and moved to a new session.
</system_message>
```

#### 90% Critical (一次性)
```typescript
SystemMessages.contextWarning90()
```

**觸發條件**: `currentTokens / maxTokens > 0.9`

**消息內容**:
```xml
<system_message type="context-critical">
🚨 Context Usage Critical

Current context usage: >90% (less than 10% remaining)

The conversation will be summarized and moved to a new session soon. Please:
1. Complete current in-progress tasks
2. Provide clear status updates
3. Document any important context that should be carried over
4. Prepare for context handoff

The summary will preserve:
- Current todos and their status
- Key decisions and outcomes
- Important context for continuation
</system_message>
```

### 2. Session Start Todo Hints

#### With Existing Todos
```typescript
SystemMessages.sessionStartWithTodos(todos)
```

**觸發條件**:
- 首個 user message
- `session.todos.length > 0`

**消息內容**:
```xml
<system_message type="session-start-todos">
📋 Session Started - Active Tasks

You have 3 active todo(s):

1. [in_progress] Implement feature X
2. [pending] Write tests
3. [pending] Update documentation

Please continue working on these tasks. Use the TodoWrite tool to update task status as you make progress.
</system_message>
```

#### Without Todos (Reminder)
```typescript
SystemMessages.sessionStartNoTodos()
```

**觸發條件**:
- 首個 user message
- `session.todos.length === 0`

**消息內容**:
```xml
<system_message type="session-start-reminder">
📋 Session Started

No active todos found.

Remember: For multi-step tasks or complex requests, always use the TodoWrite tool to:
- Track progress across multiple steps
- Ensure nothing is forgotten
- Provide clear status updates to the user

Example usage:
```typescript
TodoWrite({
  todos: [
    { content: "Analyze requirements", status: "completed", activeForm: "Analyzing requirements" },
    { content: "Implement feature", status: "in_progress", activeForm: "Implementing feature" },
    { content: "Write tests", status: "pending", activeForm: "Writing tests" }
  ]
})
```
</system_message>
```

### 3. System Resource Warnings

#### CPU Warning
```typescript
SystemMessages.resourceWarningCPU(usage)
```

**觸發條件**:
- CPU usage > 80%
- 沒有在最近 5 個 messages 中發出過

**消息內容**:
```xml
<system_message type="resource-warning-cpu">
⚠️ System Resource Warning - CPU

Current CPU usage: 85.3% (8 cores)

CPU resources are constrained. Please:
- Avoid spawning multiple parallel processes
- Consider breaking large operations into smaller chunks
- Be mindful of computationally intensive operations
- Monitor for performance degradation

This is a temporary condition and should resolve as background tasks complete.
</system_message>
```

#### Memory Warning
```typescript
SystemMessages.resourceWarningMemory(usage)
```

**觸發條件**:
- Memory usage > 80%
- 沒有在最近 5 個 messages 中發出過

**消息內容**:
```xml
<system_message type="resource-warning-memory">
⚠️ System Resource Warning - Memory

Current memory usage: 12.8GB/16.0GB

Memory resources are constrained. Please:
- Avoid loading large files into memory
- Use streaming approaches where possible
- Clean up temporary data when done
- Be cautious with in-memory data structures

This is a temporary condition and should resolve as tasks complete.
</system_message>
```

---

## 觸發邏輯

### 檢測流程

**位置**: `streaming.service.ts` line 281-301

```typescript
// 4.5. Check system message triggers
const { checkAllTriggers, insertSystemMessage } = await import('@sylphx/code-core');
const systemMessageContent = await checkAllTriggers(
  updatedSession,
  messageRepository,
  undefined // TODO: Add context token tracking
);

if (systemMessageContent) {
  await insertSystemMessage(messageRepository, sessionId, systemMessageContent);

  // Reload session to include system message
  updatedSession = await sessionRepository.getSessionById(sessionId);
}
```

### 優先級順序

1. **Context critical (90%)** - 最高優先級
2. **Context warning (80%)**
3. **Session start todos**
4. **Resource warnings (CPU, Memory)**

**邏輯**: 每次只插入一個系統消息（優先級最高的）

### 去重策略

- **Context warnings**: 檢查是否已存在 `type="context-warning"` 或 `type="context-critical"`
- **Session start todos**: 只在首個 user message 檢查
- **Resource warnings**: 檢查最近 5 個 messages 是否已警告

---

## 文件結構

```
packages/code-core/src/ai/system-messages/
├── index.ts         # SystemMessages builders
└── triggers.ts      # Trigger detection logic
```

### index.ts

**Exports**:
- `SystemMessages` - Message builders
- `createSystemMessage()` - Generic wrapper (deprecated)
- `parseSystemMessageType()` - Extract type from content
- `isSystemMessage()` - Check if content is system message

### triggers.ts

**Exports**:
- `checkAllTriggers()` - Main entry point
- `checkContextUsage()` - Context warnings
- `checkSessionStartTodos()` - Todo hints
- `checkSystemResources()` - Resource warnings
- `insertSystemMessage()` - Insert message into DB

---

## 移除的舊實現

### 1. Metadata CPU/Memory Injection

**檔案**: `message-builder/index.ts` line 60-67

**移除原因**:
- 每個 message 都注入冗餘資訊
- 不智能（不管是否需要都顯示）
- 現在改為動態資源警告

### 2. TodoSnapshot

**檔案**:
- `message-builder/index.ts` line 71-74
- `streaming.service.ts` line 252, 256, 408

**移除原因**:
- 資料庫已刪除 `todoSnapshot` 欄位（performance optimization）
- 詳見 `TODOSNAPSHOT-REALITY.md`

---

## 未來擴展

### ✅ Context Token Tracking (已實現)

**實現位置**: `streaming.service.ts` line 281-312

**實現邏輯**:
```typescript
// 1. Calculate total tokens from all messages
let totalTokens = 0;
for (const message of updatedSession.messages) {
  if (message.usage) {
    totalTokens += message.usage.totalTokens;
  }
}

// 2. Get model context length from provider
const modelDetails = await providerInstance.getModelDetails(modelName, providerConfig);
const maxContextLength = modelDetails?.contextLength;

// 3. Pass to checkAllTriggers
if (maxContextLength && totalTokens > 0) {
  contextTokens = {
    current: totalTokens,
    max: maxContextLength,
  };
}

const systemMessageContent = await checkAllTriggers(
  updatedSession,
  messageRepository,
  contextTokens // ✅ Implemented
);
```

**數據來源**:
- **Total Tokens**: Sum of `message.usage.totalTokens` (同 TUI StatusBar 的計算方式)
- **Max Context**: `providerInstance.getModelDetails()` → `contextLength`

**日誌輸出**:
```
[streamAIResponse] Context usage: 15234/128000 (12%)
```

### 可能的新系統消息

1. **Rate Limit Warnings**: API rate limit 即將達到
2. **Cost Warnings**: Token usage 成本超過閾值
3. **Session Timeout**: 長時間無活動警告
4. **Tool Availability**: 某些 tools 暫時不可用

---

## 測試

### Manual Testing

1. **Session Start (No Todos)**:
   ```bash
   # 啟動新 session
   # 發送第一個消息
   # 應該看到 "Session Started - No active todos" 系統消息
   ```

2. **Session Start (With Todos)**:
   ```bash
   # 創建 session with todos
   # 發送第一個消息
   # 應該看到 "Session Started - Active Tasks" + todo list
   ```

3. **Resource Warning (Manual Trigger)**:
   ```typescript
   // 暫時修改 threshold 為 0.1 測試
   const RESOURCE_WARNING_THRESHOLD = 0.1;
   ```

---

## 總結

### ✅ 完成的功能

1. System message architecture 和 helpers ✅
2. Context usage monitoring (80%, 90%) ✅
3. Session start todo hints ✅
4. System resource warnings (CPU, Memory > 80%) ✅
5. 移除舊的 metadata injection ✅
6. 集成到 streaming service ✅

### ⚠️ 待實現

1. ~~Context token tracking~~ ✅ **已完成**
2. 更多系統消息類型（rate limits, costs, etc.）
3. 完整的 E2E 測試
4. 測試 context warnings 在真實場景中的觸發

### 📊 影響

**性能提升**:
- 減少冗餘的 metadata injection
- 只在需要時插入系統消息

**LLM 體驗提升**:
- 結構化的 `<system_message>` 標籤
- 更智能的提示（按需觸發）
- 更好的上下文管理建議

**可維護性提升**:
- 集中式的系統消息管理
- 清晰的觸發邏輯
- 易於擴展新的消息類型
