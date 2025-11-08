# Entity Normalization Plan

## 系統中所有Entity清單

### ✅ 已正規化 (Normalized)

#### 1. **Model & Provider** (剛完成)
```typescript
Model {
  id: string;              // 'claude-sonnet-4', 'gpt-4o'
  name: string;
  providerId: string;      // → Provider.id
  inputCapabilities: {...};
  outputCapabilities: {...};
  reasoning: 'yes' | 'no' | 'auto';
  maxContext: number;
  pricing: ModelPricing;
}

Provider {
  id: string;              // 'anthropic', 'openai', 'openrouter'
  name: string;
  modelIds: string[];      // → Model.id[]
  apiKeyRequired: boolean;
}
```

#### 2. **Agent**
```typescript
Agent {
  id: string;              // 'coder', 'planner'
  metadata: {
    name: string;
    description: string;
    rules?: string[];      // → Rule.id[]
  };
  systemPrompt: string;
  isBuiltin: boolean;
  filePath?: string;
}
```
**狀態**: ✅ 結構良好，但 `rules` 只是 string[] 沒有完整 entity 關聯

#### 3. **Rule**
```typescript
Rule {
  id: string;              // 'coding/typescript'
  metadata: {
    name: string;
    description: string;
    enabled?: boolean;
  };
  content: string;
  isBuiltin: boolean;
  filePath?: string;
}
```
**狀態**: ✅ 結構良好

---

### ❌ 需要正規化 (Needs Normalization)

#### 4. **Tool** ⚠️ 缺乏entity定義
**當前問題**:
- 沒有 Tool entity 定義
- 只有函數導出 (filesystemTools, shellTools, etc.)
- 沒有統一的元數據結構
- 無法查詢工具capabilities

**建議結構**:
```typescript
Tool {
  id: string;              // 'read', 'write', 'bash', 'grep'
  name: string;            // 'Read File', 'Write File'
  category: ToolCategory;  // 'filesystem' | 'shell' | 'search' | 'interaction'
  description: string;

  // Input/Output schema
  inputSchema: z.ZodSchema;
  outputSchema: z.ZodSchema;

  // Capabilities
  requiresConfirmation?: boolean;
  isDangerous?: boolean;
  isAsync: boolean;

  // Model support
  supportedBy: string[];   // → Model.id[] 哪些模型支持這個工具
}

ToolCategory {
  id: string;              // 'filesystem', 'shell', 'search'
  name: string;
  description: string;
  toolIds: string[];       // → Tool.id[]
}
```

#### 5. **MCP Server** ⚠️ 缺乏registry
**當前問題**:
- MCPServerConfig 只是配置格式
- 沒有 MCP Server entity
- 沒有統一的 tool discovery

**建議結構**:
```typescript
MCPServer {
  id: string;              // 'filesystem', 'git', 'docker'
  name: string;
  description: string;

  // Configuration
  config: MCPServerConfig; // stdio or http
  status: 'active' | 'inactive' | 'error';

  // Capabilities
  providedTools: MCPTool[];
  providedResources: MCPResource[];
  providedPrompts: MCPPrompt[];

  // Metadata
  version: string;
  vendor: string;
}

MCPTool {
  id: string;              // server_id:tool_name
  serverId: string;        // → MCPServer.id
  name: string;
  description: string;
  inputSchema: JSONSchema;
}
```

#### 6. **Session** ⚠️ 部分正規化
**當前問題**:
- ✅ 剛添加 `modelId`
- ❌ `agentId` 只是 string，沒有關聯到 Agent entity
- ❌ `enabledRuleIds` 只是 string[]，沒有 Rule entity 關聯
- ❌ 沒有 toolIds/mcpServerIds 配置

**建議結構**:
```typescript
Session {
  id: string;
  title?: string;

  // AI Configuration (normalized)
  modelId: string;         // → Model.id
  agentId: string;         // → Agent.id
  enabledRuleIds: string[]; // → Rule.id[]

  // Tool Configuration (new)
  enabledToolIds?: string[];     // → Tool.id[] 只啟用特定工具
  enabledMCPServerIds?: string[]; // → MCPServer.id[]

  // Content
  messages: SessionMessage[];
  todos: Todo[];

  // Metadata
  created: number;
  updated: number;
}
```

#### 7. **ProviderConfig** ⚠️ 不夠正規化
**當前問題**:
- API keys 散落在不同配置層級
- 沒有統一的 credential 管理
- 沒有 encryption/security 層

**建議結構**:
```typescript
ProviderCredential {
  id: string;              // auto-generated
  providerId: string;      // → Provider.id

  // Security
  apiKey: string;          // Encrypted
  encryptionMethod: 'aes-256-gcm';
  createdAt: number;
  expiresAt?: number;

  // Scope
  scope: 'global' | 'project';
  projectPath?: string;

  // Metadata
  label?: string;          // User-friendly name
  isDefault?: boolean;
}

ProviderConfig {
  providerId: string;      // → Provider.id
  credentialId?: string;   // → ProviderCredential.id
  defaultModelId?: string; // → Model.id

  // Provider-specific settings
  baseURL?: string;
  timeout?: number;
  maxRetries?: number;

  // Usage limits
  dailyLimit?: number;
  monthlyLimit?: number;
}
```

---

### 🔄 需要改進 (Needs Improvement)

#### 8. **MessagePart** - 已有但可優化
**當前結構**:
```typescript
type MessagePart =
  | { type: 'text'; content: string; status: ... }
  | { type: 'reasoning'; content: string; status: ...; duration?: ... }
  | { type: 'tool'; toolId: string; name: string; ... }
  | { type: 'file'; relativePath: string; ... }
  | { type: 'error'; error: string; ... }
```

**建議改進**:
- `tool` part 的 `toolId` 應該關聯到 Tool.id
- `tool` part 的 `name` 冗餘 (應該從 Tool entity 查詢)
- 添加 `mcpTool` type 用於 MCP tools

```typescript
type MessagePart =
  | TextPart
  | ReasoningPart
  | ToolPart {
      type: 'tool';
      toolId: string;      // → Tool.id (normalized)
      // name 從 Tool entity 查詢，不存儲
      args?: unknown;
      result?: unknown;
      status: ...;
    }
  | MCPToolPart {
      type: 'mcpTool';
      serverId: string;    // → MCPServer.id
      toolName: string;
      args?: unknown;
      result?: unknown;
      status: ...;
    }
  | FilePart
  | ErrorPart
```

#### 9. **Todo** - 結構良好但缺乏關聯
```typescript
Todo {
  id: number;              // Session-scoped
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm: string;

  // 缺失的關聯:
  createdByToolId?: string;  // → Tool.id 哪個工具創建的
  relatedFileIds?: string[]; // → 關聯的文件
  assignedToStepId?: string; // → MessageStep.id
}
```

---

## 正規化優先級

### Phase 1: 核心Entity ✅ **已完成**
- [x] Model
- [x] Provider
- [x] Tool ⭐
- [x] MCP Server

### Phase 2: 配置層 ✅ **已完成**
- [x] ProviderCredential & ProviderConfig
- [x] AIConfig (添加 defaultModelId, defaultToolIds, defaultMcpServerIds, credentialId)

### Phase 3: 內容層 ✅ **已完成**
- [x] Session (添加 enabledToolIds, enabledMcpServerIds)
- [x] MessagePart (添加 mcpServerId)
- [x] Todo (添加 createdByToolId, createdByStepId, relatedFiles, metadata)

### Phase 4: 數據層 ✅ **已完成**
- [x] Database schema (生成 migration 0003_black_maginty.sql)
- [x] Tool Registry
- [x] MCP Server Registry
- [x] Credential Registry & Manager

### Phase 5: 遷移與測試 🔄 **進行中**
- [ ] Entity migration utilities
- [ ] Update client code
- [ ] End-to-end testing

---

## 關鍵設計原則

1. **唯一ID**: 每個entity有全局唯一ID
2. **關係正規化**: 使用ID引用，不嵌套對象
3. **完整元數據**: 包括 capabilities, pricing, limits
4. **向後兼容**: 保留舊字段用於遷移
5. **類型安全**: 使用 TypeScript discriminated unions
6. **查詢效率**: 提供 registry 和 helper 函數

---

## 下一步行動

你想先從哪個entity開始正規化？我建議順序：

1. **Tool** - 最混亂，影響最大
2. **MCP Server** - 新功能，趁早正規化
3. **ProviderConfig** - 安全性重要
4. **Session** - 整合所有正規化entity
