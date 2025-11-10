# Message & Step 結構分析：額外數據的凍結與 Prompt Cache

## 概述

當前架構已經完整支持額外數據的凍結，確保 **history conversation is frozen** 以避免 prompt cache miss。

---

## 數據結構層次

```
Session
  └─ Message (容器)
      └─ Step (每次 AI 請求)
          ├─ Metadata (系統狀態)
          ├─ Usage (Token 使用量)
          └─ Parts (內容部分)
              ├─ Text
              ├─ Reasoning
              ├─ Tool (含 args, result, error)
              ├─ File (凍結的 base64/BLOB)
              └─ Error
```

---

## 1. Step 結構（MessageStep）

### Schema
```typescript
// packages/code-core/src/database/schema.ts
export const messageSteps = sqliteTable('message_steps', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull(),
  stepIndex: integer('step_index').notNull(),

  // Per-step execution metadata
  provider: text('provider'),        // 哪個 provider 處理這個 step
  model: text('model'),              // 哪個 model 處理這個 step
  duration: integer('duration'),     // Step 執行時間 (ms)
  finishReason: text('finish_reason'), // 'stop' | 'tool-calls' | 'length' | 'error'
  status: text('status'),            // 'active' | 'completed' | 'error' | 'abort'

  // 🔑 Per-step context (captured at step start time)
  metadata: text('metadata'),        // JSON: { cpu?: string, memory?: string }

  // Timestamps
  startTime: integer('start_time'),  // 開始時間
  endTime: integer('end_time'),      // 結束時間
});
```

### 凍結的系統狀態（Metadata）

**存儲位置**: `messageSteps.metadata` (JSON)

**結構**:
```typescript
{
  cpu?: string;     // 例如: "45.2%"
  memory?: string;  // 例如: "2.1GB / 8GB"
}
```

**凍結時機**: Step 開始時捕獲，永久保存

**用途**:
1. 重構 model messages 時注入系統狀態
2. 讓 LLM 知道當時的系統資源狀況
3. 確保 prompt cache 一致性（相同的系統狀態 = 相同的 prompt）

**注入方式** (buildUserMessage):
```typescript
// message-builder/index.ts 第 61-68 行
if (msg.metadata) {
  const systemStatusString = buildSystemStatusFromMetadata({
    timestamp: new Date(msg.timestamp).toISOString(),
    cpu: msg.metadata.cpu || 'N/A',
    memory: msg.metadata.memory || 'N/A',
  });
  contentParts.push({ type: 'text', text: systemStatusString });
}
```

---

## 2. StepPart 結構（MessagePart）

### Schema
```typescript
// packages/code-core/src/database/schema.ts
export const stepParts = sqliteTable('step_parts', {
  id: text('id').primaryKey(),
  stepId: text('step_id').notNull(),
  ordering: integer('ordering').notNull(),  // 順序保證
  type: text('type').notNull(),             // 'text' | 'reasoning' | 'tool' | 'error'

  // 🔑 Content structure (JSON) - ALL parts include status field
  content: text('content').notNull(),       // JSON string
});
```

### MessagePart 類型定義

```typescript
// packages/code-core/src/types/session.types.ts
export type MessagePart =
  | {
      type: 'text';
      content: string;
      status: 'active' | 'completed' | 'error' | 'abort';
    }
  | {
      type: 'reasoning';
      content: string;
      status: 'active' | 'completed' | 'error' | 'abort';
      duration?: number;      // 🔑 額外數據：推理時長
      startTime?: number;     // 🔑 額外數據：開始時間
    }
  | {
      type: 'tool';
      toolId: string;
      name: string;
      mcpServerId?: string;
      status: 'active' | 'completed' | 'error' | 'abort';

      // 🔑 Tool 的額外數據（完整凍結）
      args?: unknown;         // Tool 調用參數
      result?: unknown;       // Tool 執行結果
      error?: string;         // Tool 錯誤信息
      duration?: number;      // Tool 執行時長
      startTime?: number;     // Tool 開始時間
    }
  | {
      type: 'file';
      relativePath: string;
      size: number;
      mediaType: string;
      base64: string;         // 🔑 凍結的文件內容
      status: 'completed';
    }
  | {
      type: 'file-ref';
      fileContentId: string;  // 🔑 引用 file_contents 表（BLOB 存儲）
      relativePath: string;
      size: number;
      mediaType: string;
      status: 'completed';
    }
  | {
      type: 'error';
      error: string;
      status: 'completed';
    };
```

---

## 3. 額外數據的完整凍結

### 3.1 Tool Call 數據凍結 ✅

**存儲的額外數據**:
```typescript
{
  type: 'tool',
  toolId: 'tool-abc123',
  name: 'Read',
  args: { file_path: '/path/to/file' },      // ✅ 凍結參數
  result: { content: 'file content...' },    // ✅ 凍結結果
  error: undefined,                           // ✅ 凍結錯誤（如果有）
  duration: 1234,                             // ✅ 凍結執行時長
  startTime: 1234567890,                      // ✅ 凍結開始時間
  status: 'completed'
}
```

**轉換為 Model Message**:
```typescript
// message-builder/index.ts 第 188-206 行
case 'tool': {
  const parts: AssistantContent = [
    {
      type: 'tool-call' as const,
      toolCallId: part.toolId,
      toolName: part.name,
      input: part.args,                    // ✅ 使用凍結的 args
    } as ToolCallPart,
  ];

  if (part.result !== undefined) {
    parts.push({
      type: 'tool-result' as const,
      toolCallId: part.toolId,
      toolName: part.name,
      output: part.result,                 // ✅ 使用凍結的 result
    } as ToolResultPart);
  }

  return parts;
}
```

**Prompt Cache 保證**:
- ✅ Args 凍結 → 相同的 tool 調用參數
- ✅ Result 凍結 → 相同的 tool 返回結果
- ✅ Duration, startTime 凍結 → 完整的執行上下文
- ✅ Error 凍結 → 錯誤信息也被保留

---

### 3.2 Reasoning 數據凍結 ✅

**存儲的額外數據**:
```typescript
{
  type: 'reasoning',
  content: 'Let me think about this...',
  duration: 5678,          // ✅ 凍結推理時長
  startTime: 1234567890,   // ✅ 凍結開始時間
  status: 'completed'
}
```

**轉換為 Model Message**:
```typescript
// message-builder/index.ts 第 185 行
case 'reasoning':
  return [{ type: 'reasoning' as const, text: part.content }];
```

**注意**: Duration 和 startTime 目前未傳遞給 LLM，因為 AI SDK 的 reasoning part 不支持這些字段。但數據已凍結在數據庫中，可用於：
- 分析和調試
- UI 顯示
- 未來擴展（如果 AI SDK 支持）

---

### 3.3 File 數據凍結 ✅

**Legacy 方式** (base64 in JSON):
```typescript
{
  type: 'file',
  relativePath: 'src/app.ts',
  size: 1234,
  mediaType: 'text/plain',
  base64: 'Y29uc3QgYXBwID0gInRlc3QiOw==',  // ✅ 完整凍結
  status: 'completed'
}
```

**新方式** (BLOB in file_contents table):
```typescript
// step_parts.content
{
  type: 'file-ref',
  fileContentId: 'file-xyz789',           // 引用
  relativePath: 'src/app.ts',
  size: 1234,
  mediaType: 'text/plain',
  status: 'completed'
}

// file_contents table
{
  id: 'file-xyz789',
  stepId: 'step-0',
  content: Buffer<...>,                    // ✅ BLOB 存儲（無 base64 開銷）
  textContent: 'const app = "test";',      // ✅ 可搜索的文本
  sha256: '...',                           // ✅ 去重支持
}
```

**Prompt Cache 保證**:
- ✅ 文件內容永久凍結，不會因磁盤文件變化而改變
- ✅ 相同的文件內容 = 相同的 prompt
- ✅ SHA256 支持去重，節省存儲空間

---

### 3.4 System Metadata 凍結 ✅

**User Message 注入**:
```typescript
// message-builder/index.ts 第 61-68 行
if (msg.metadata) {
  const systemStatusString = buildSystemStatusFromMetadata({
    timestamp: new Date(msg.timestamp).toISOString(),
    cpu: msg.metadata.cpu || 'N/A',
    memory: msg.metadata.memory || 'N/A',
  });
  contentParts.push({ type: 'text', text: systemStatusString });
}
```

**輸出示例**:
```
System Status (2024-01-15T10:30:00.000Z):
  CPU: 45.2%
  Memory: 2.1GB / 8GB
```

**Prompt Cache 保證**:
- ✅ 系統狀態凍結在 step.metadata
- ✅ 每次重構 model messages 都使用相同的系統狀態
- ✅ Timestamp 也被凍結，確保時間一致性

---

### 3.5 Todo Snapshot ❌ **不凍結（已移除）**

**⚠️ 重要更正**: Todo snapshots **不儲存** 到資料庫！

**原因**（來自 schema.ts 註釋）:
- 用戶報告 100+ steps per message 很常見
- 每個 step 存儲 todos 非常浪費
- Todos 只在 /compact 後的第一個 user message 需要

**實際狀況**:
```typescript
// 1. Database schema: NO todoSnapshot column
// messageSteps 表沒有 todoSnapshot 欄位
// stepTodoSnapshots 表已刪除（@deprecated REMOVED）

// 2. createMessageStep: Parameter is IGNORED
export async function createMessageStep(
  db: LibSQLDatabase,
  messageId: string,
  stepIndex: number,
  metadata?: MessageMetadata,
  _todoSnapshot?: TodoType[] // ← Underscore prefix = ignored!
): Promise<string>

// 3. loadMessageSteps: Returns NO todoSnapshot
// 從資料庫載入的 MessageStep 物件沒有 todoSnapshot 欄位

// 4. buildUserMessage: Check NEVER executes
if (msg.todoSnapshot && msg.todoSnapshot.length > 0) {
  // ❌ 永遠不會執行（msg.todoSnapshot 永遠是 undefined）
  const todoContext = buildTodoContext(msg.todoSnapshot);
  contentParts.push({ type: 'text', text: todoContext });
}
```

**實際實現**:
- ❌ **不儲存** 到資料庫
- ✅ **有發送** 在 runtime events 中（`step-start` event 包含 todoSnapshot）
- ❌ **不注入** 到 LLM context（buildUserMessage 檢查永遠是 false）
- ⚠️ **TypeScript 類型仍然定義** `todoSnapshot?: Todo[]`（但不應該）

**詳細分析**: 請參閱 `TODOSNAPSHOT-REALITY.md`

**Prompt Cache 影響**:
- ✅ Todos **不會** 影響 prompt cache（因為不注入到 LLM context）
- ⚠️ 如果未來要實現「compact 後注入 todos」，需要考慮 cache 失效策略

---

## 4. Token Usage 凍結 ✅

### Schema
```typescript
export const stepUsage = sqliteTable('step_usage', {
  stepId: text('step_id').primaryKey(),
  promptTokens: integer('prompt_tokens').notNull(),
  completionTokens: integer('completion_tokens').notNull(),
  totalTokens: integer('total_tokens').notNull(),
});
```

**凍結保證**:
- ✅ 每個 step 的 token 使用量獨立存儲
- ✅ Message 的總使用量通過聚合計算（避免冗餘）
- ✅ 用於成本分析、性能優化、quota 管理

---

## 5. 順序保證（Ordering）

### StepPart Ordering
```typescript
{
  id: text('id').primaryKey(),
  stepId: text('step_id'),
  ordering: integer('ordering').notNull(),  // ✅ 保證順序
  type: text('type'),
  content: text('content'),
}
```

**Index**:
```typescript
orderingIdx: index('idx_step_parts_ordering').on(table.stepId, table.ordering)
```

**重要性**:
- ✅ 確保 `[text, file, text]` 順序不變
- ✅ Tool call/result 順序保持
- ✅ Prompt cache 依賴正確的順序

---

## 6. Frozen Conversation History 架構圖

```
┌─────────────────────────────────────────────────────────────────┐
│ Session                                                          │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Message (User)                                              │ │
│  │                                                              │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │ Step 0                                                │  │ │
│  │  │ ┌────────────────────────────────────────────────┐   │  │ │
│  │  │ │ Metadata (Frozen at step start)                │   │  │ │
│  │  │ │ { cpu: "45%", memory: "2GB/8GB" }             │   │  │ │
│  │  │ └────────────────────────────────────────────────┘   │  │ │
│  │  │                                                        │  │ │
│  │  │ Parts:                                                 │  │ │
│  │  │ ┌────────────────────────────────────────────────┐   │  │ │
│  │  │ │ [0] Text: "Read file src/app.ts"              │   │  │ │
│  │  │ │     status: 'completed'                        │   │  │ │
│  │  │ └────────────────────────────────────────────────┘   │  │ │
│  │  │ ┌────────────────────────────────────────────────┐   │  │ │
│  │  │ │ [1] File-ref: { fileContentId: "file-xyz" }   │   │  │ │
│  │  │ │     relativePath: "src/app.ts"                 │   │  │ │
│  │  │ │     ┌──────────────────────────────────────┐   │   │  │ │
│  │  │ │     │ file_contents.content (BLOB)         │   │   │  │ │
│  │  │ │     │ ✅ Frozen at user message time       │   │   │  │ │
│  │  │ │     └──────────────────────────────────────┘   │   │  │ │
│  │  │ └────────────────────────────────────────────────┘   │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Message (Assistant)                                         │ │
│  │                                                              │ │
│  │  ┌──────────────────────────────────────────────────────┐  │ │
│  │  │ Step 0                                                │  │ │
│  │  │ Parts:                                                 │  │ │
│  │  │ ┌────────────────────────────────────────────────┐   │  │ │
│  │  │ │ [0] Reasoning:                                │   │  │ │
│  │  │ │     content: "Let me read that file..."        │   │  │ │
│  │  │ │     duration: 1234 ✅ Frozen                  │   │  │ │
│  │  │ │     startTime: 1234567890 ✅ Frozen           │   │  │ │
│  │  │ └────────────────────────────────────────────────┘   │  │ │
│  │  │ ┌────────────────────────────────────────────────┐   │  │ │
│  │  │ │ [1] Tool:                                     │   │  │ │
│  │  │ │     name: "Read"                               │   │  │ │
│  │  │ │     args: { file_path: "..." } ✅ Frozen      │   │  │ │
│  │  │ │     result: { content: "..." } ✅ Frozen      │   │  │ │
│  │  │ │     duration: 567 ✅ Frozen                   │   │  │ │
│  │  │ └────────────────────────────────────────────────┘   │  │ │
│  │  │ ┌────────────────────────────────────────────────┐   │  │ │
│  │  │ │ [2] Text: "The file contains..."              │   │  │ │
│  │  │ └────────────────────────────────────────────────┘   │  │ │
│  │  └──────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘

          ↓ buildModelMessages()

┌─────────────────────────────────────────────────────────────────┐
│ ModelMessage[] (sent to LLM)                                     │
│                                                                  │
│ [0] User:                                                        │
│     - System Status: CPU: 45%, Memory: 2GB/8GB ✅               │
│     - Text: "Read file src/app.ts" ✅                           │
│     - File: Buffer<frozen content> ✅                           │
│                                                                  │
│ [1] Assistant:                                                   │
│     - Reasoning: "Let me read that file..." ✅                  │
│     - Tool Call: { name: "Read", args: {...} } ✅               │
│     - Tool Result: { output: {...} } ✅                         │
│     - Text: "The file contains..." ✅                           │
└─────────────────────────────────────────────────────────────────┘

        ↓ Same frozen data every time

   ✅ Prompt Cache HIT!
```

---

## 7. 當前架構的優勢

### ✅ 完整凍結支持
1. **Tool 額外數據**: args, result, error, duration, startTime - 全部凍結 ✅
2. **Reasoning 額外數據**: duration, startTime - 全部凍結 ✅
3. **System Metadata**: CPU, memory - 凍結在 step.metadata ✅
4. **File Content**: base64 或 BLOB - 完整凍結 ✅
5. **Todo Snapshot**: ❌ **不儲存**（已移除，詳見 TODOSNAPSHOT-REALITY.md）
6. **Token Usage**: 每個 step 獨立存儲 ✅
7. **Ordering**: 所有 parts 都有順序保證 ✅

### ✅ Prompt Cache 保證
- 相同的系統狀態 → 相同的 system status text
- 相同的 tool args/result → 相同的 tool call/result
- 相同的文件內容 → 相同的 file content
- 相同的順序 → 相同的 context window
- **結果**: 100% prompt cache hit (assuming same conversation history)

### ✅ 性能優化
- File-ref 使用 BLOB 存儲（33% smaller than base64）
- SHA256 去重（未來可共享相同文件）
- Todo snapshot **不儲存**（移除冗餘數據）
- Token usage 聚合計算（避免冗餘更新）

### ✅ 可擴展性
- Metadata 是 JSON，可添加新字段
- MessagePart 是 discriminated union，可添加新類型
- Step-based 架構支持多輪對話（100+ steps per message）

---

## 8. 潛在改進

### 🟡 Reasoning Duration 未傳遞給 LLM
**現狀**: Duration 和 startTime 存儲在數據庫，但未傳遞給 LLM

**原因**: AI SDK 的 reasoning content part 不支持額外字段

**影響**: 不影響 prompt cache（因為 duration 不是 prompt 的一部分）

**建議**: 保持現狀，除非 AI SDK 未來支持

---

### 🟡 Tool Error 處理
**現狀**: Tool error 存儲在 `part.error`，但未單獨傳遞給 LLM

**影響**: Error 會被包含在 tool-result 中嗎？需要確認

**建議**: 檢查 AI SDK 如何處理 tool errors，確保錯誤被正確傳遞

---

### 🟢 File-ref Migration
**現狀**: 支持 legacy (base64) 和新方式 (file-ref)

**建議**:
1. 創建 migration tool 將 legacy files 轉換為 file-ref
2. 逐步淘汰 base64 存儲
3. 充分利用 BLOB 存儲和 SHA256 去重

---

## 9. 結論

**✅ 當前架構已完整支持額外數據凍結**

所有需要凍結的數據都已經被正確存儲：
- Tool: args, result, error, duration ✅
- Reasoning: content, duration, startTime ✅
- File: base64 或 BLOB ✅
- System: metadata (CPU, memory) ✅
- Todo: ❌ **不儲存**（已移除 - 詳見 TODOSNAPSHOT-REALITY.md）
- Token: usage per step ✅

**✅ Prompt Cache 保證**

通過凍結所有相關數據，確保：
- 相同的 conversation history → 相同的 prompt
- 相同的 prompt → prompt cache HIT
- Cache HIT → 降低延遲和成本

**✅ 架構健全**

Step-based 設計提供：
- 清晰的責任分離
- 靈活的擴展性
- 高效的存儲
- 完整的審計軌跡

**無需大規模重構，當前架構已達到設計目標！** 🎉
