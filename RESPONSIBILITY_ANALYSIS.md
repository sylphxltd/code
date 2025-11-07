# Project Responsibility Analysis
## 整個項目責任問題分析

Generated: 2025-11-07

---

## 🔴 Critical Issues (需要立即處理)

### 1. **useKeyboardNavigation Hook** (841 lines)
**Location:** `packages/code-client/src/hooks/useKeyboardNavigation.ts`

**問題:**
- **78個參數** - 這是嚴重的parameter explosion
- 處理太多不同的責任:
  - File autocomplete navigation
  - Command autocomplete navigation
  - Multi-selection mode
  - Filter mode
  - Free text mode
  - Command execution
  - Message submission
  - Abort handling
  - ESC key handling
  - Tab key handling
  - Arrow key navigation

**影響:**
- 極難測試 - 需要78個mock objects
- 極難維護 - 任何改動都可能影響多個功能
- 極難理解 - 新開發者需要很長時間理解
- 違反Single Responsibility Principle

**建議重構:**
```typescript
// 分拆成多個專注的hooks:
useFileNavigation()      // File autocomplete only
useCommandNavigation()   // Command autocomplete only
useSelectionMode()       // Multi-selection handling
useFilterMode()          // Filter mode handling
useAbortHandler()        // Abort control
useKeyboardShortcuts()   // General keyboard shortcuts
```

**優先級:** ⭐⭐⭐⭐⭐ (最高)
**難度:** High
**影響範圍:** Chat.tsx, InputSection

---

### 2. **AppStore (Zustand)** (632 lines, 35 properties)
**Location:** `packages/code-client/src/stores/app-store.ts`

**問題:**
- **God Object** - 管理太多不同的domain:
  1. Navigation state (currentScreen)
  2. AI Configuration (aiConfig, providers)
  3. Model Selection (selectedProvider, selectedModel)
  4. Session Management (currentSession, CRUD operations)
  5. Message Management (addMessage)
  6. UI State (isLoading, error)
  7. Agent State (selectedAgentId)
  8. Rule State (enabledRuleIds)
  9. Debug Logs (debugLogs)
  10. Notification Settings
  11. Todo Management

**影響:**
- 任何一個domain的改動都會影響整個store
- 難以做selective re-rendering optimization
- 測試困難 - 需要整個store的context
- 違反Single Responsibility Principle

**建議重構:**
```typescript
// 分拆成多個focused stores:
useNavigationStore()      // Navigation only
useAIConfigStore()        // AI config & providers
useSessionStore()         // Session CRUD & current session
useMessageStore()         // Message operations
useUIStore()             // Loading, error states
useSettingsStore()       // Agent, rules, notifications
useDebugStore()          // Debug logs only
```

**優先級:** ⭐⭐⭐⭐ (高)
**難度:** High (需要重寫很多components)
**影響範圍:** Almost all components

---

## 🟡 Moderate Issues (應該處理)

### 3. **claude-code-language-model.ts** (901 lines)
**Location:** `packages/code-core/src/ai/providers/claude-code-language-model.ts`

**問題:**
- 單一文件處理太多責任:
  - Session management & tracking
  - Message fingerprinting
  - Message deduplication
  - Rewind/edit detection
  - Stream handling
  - Tool execution via MCP
  - Response formatting
  - Error handling

**建議重構:**
```typescript
// 分拆成多個專注的modules:
SessionManager          // Session tracking & reuse
MessageFingerprinter    // Fingerprint generation & comparison
MessageDeduplicator     // Skip already-sent messages
StreamHandler          // Stream processing
ToolExecutor           // MCP tool delegation
```

**優先級:** ⭐⭐⭐ (中)
**難度:** Medium
**影響範圍:** AI provider system only

---

### 4. **streaming.service.ts** (722 lines)
**Location:** `packages/code-server/src/services/streaming.service.ts`

**問題:**
- 處理多個複雜流程:
  - Title generation
  - Message streaming
  - Step management
  - Error handling
  - Database persistence
  - Event emission

**目前狀態:** 已經有event handler pattern, 但主函數仍然太長

**建議進一步重構:**
```typescript
// 提取更多職責:
TitleGenerator          // Title generation logic
StepManager            // Step creation & tracking
StreamOrchestrator     // Coordinate all streaming concerns
EventEmitter          // Event broadcasting (已有基礎)
```

**優先級:** ⭐⭐⭐ (中)
**難度:** Medium
**影響範圍:** tRPC streaming system

---

### 5. **Chat.tsx** (648 lines after refactoring)
**Location:** `packages/code/src/screens/Chat.tsx`

**問題:**
- 雖然已經減少了146行, 但仍然:
  - 有太多useState declarations
  - 組合太多custom hooks (15+)
  - 太多useEffect logic
  - Event handler delegation複雜

**建議進一步重構:**
```typescript
// 考慮Component Composition pattern:
<ChatContainer>
  <ChatHeader />
  <ChatMessageList />
  <ChatInputArea />
  <ChatSidebar />
</ChatContainer>

// 每個sub-component有自己的local state
// 只通過props和context共享必要的state
```

**優先級:** ⭐⭐ (中低)
**難度:** Medium (需要重新設計component hierarchy)
**影響範圍:** Chat screen only

---

## 🟢 Minor Issues (可以考慮)

### 6. **session-repository.ts** (686 lines after split)
**Location:** `packages/code-core/src/database/session-repository.ts`

**問題:**
- 雖然已經分拆了Message和Todo repositories
- 但仍有36個methods在SessionRepository
- 可能有進一步分拆的空間

**建議:**
```typescript
// 考慮進一步分拆query methods:
SessionQueryRepository   // getById, getRecent, search
SessionMutationRepository // create, update, delete
SessionAggregationRepository // count, statistics
```

**優先級:** ⭐ (低)
**難度:** Low-Medium
**影響範圍:** Database layer only

---

### 7. **Dashboard.tsx** (559 lines)
**Location:** `packages/code/src/screens/Dashboard.tsx`

**問題:**
- 類似Chat.tsx的問題
- 管理多個concerns:
  - Session list rendering
  - Search functionality
  - Sort functionality
  - Pagination
  - Session deletion

**建議:**
```typescript
// Component extraction:
<DashboardContainer>
  <SessionSearchBar />
  <SessionSortControls />
  <SessionList />
  <SessionPagination />
</DashboardContainer>
```

**優先級:** ⭐ (低)
**難度:** Low
**影響範圍:** Dashboard screen only

---

## 📊 Summary Statistics

### God Objects Detected
1. **useKeyboardNavigation** - 841 lines, 78 parameters ⚠️⚠️⚠️
2. **AppStore** - 632 lines, 35 properties, 11 domains ⚠️⚠️
3. **claude-code-language-model** - 901 lines, 8 responsibilities ⚠️

### Complexity Metrics
```
Total files analyzed: 30
Files > 500 lines: 12 (40%)
Files > 700 lines: 4 (13%)
Average file size: ~450 lines
```

### Refactoring Priority

**Phase 1 (Critical - Do First):**
1. Split `useKeyboardNavigation` → 6 focused hooks
2. Split `AppStore` → 7 focused stores

**Phase 2 (Important - Do Soon):**
3. Refactor `claude-code-language-model` → 5 modules
4. Further refactor `streaming.service` → 4 modules
5. Further refactor `Chat.tsx` → component composition

**Phase 3 (Nice to Have - Do Later):**
6. Consider splitting `SessionRepository` further
7. Refactor `Dashboard.tsx` component composition

---

## 🎯 Recommended Action Plan

### Week 1: useKeyboardNavigation
- **Goal:** Split into 6 focused hooks
- **Impact:** Massive improvement in testability and maintainability
- **Risk:** Medium (need careful testing of keyboard interactions)

### Week 2: AppStore
- **Goal:** Split into 7 domain stores
- **Impact:** Better re-render optimization, clearer separation
- **Risk:** High (affects almost all components)
- **Strategy:** Incremental migration, keep both old and new for transition

### Week 3-4: Remaining items
- **Goal:** Address claude-code-language-model and streaming.service
- **Impact:** Better code organization in core systems
- **Risk:** Low-Medium (well-isolated systems)

---

## 💡 Design Patterns to Apply

### 1. Hook Composition Pattern
```typescript
// Instead of one massive hook:
useKeyboardNavigation(78 params) // ❌

// Use hook composition:
const fileNav = useFileNavigation(focused params)
const cmdNav = useCommandNavigation(focused params)
const selection = useSelectionMode(focused params)
// Each hook is independently testable ✅
```

### 2. Store Slicing Pattern (Zustand)
```typescript
// Instead of one god store:
useAppStore() // 35 properties ❌

// Use sliced stores:
const navigation = useNavigationStore()
const aiConfig = useAIConfigStore()
const session = useSessionStore()
// Each store is independently updatable ✅
```

### 3. Module Extraction Pattern
```typescript
// Instead of one massive file:
claude-code-language-model.ts // 901 lines ❌

// Extract cohesive modules:
import { SessionManager } from './session-manager'
import { MessageFingerprinter } from './fingerprinter'
import { StreamHandler } from './stream-handler'
// Each module has single responsibility ✅
```

---

## ✅ What's Already Good

### Recently Completed Refactorings
1. ✅ SessionRepository split (MessageRepository, TodoRepository)
2. ✅ SubscriptionAdapter event handler pattern
3. ✅ Chat.tsx hook extraction (reduced from 794 to 648 lines)
4. ✅ Structured logging system
5. ✅ Error handling improvements
6. ✅ Constants extraction

These show good progress on code quality!

---

## 🚨 Anti-Patterns to Avoid

### Current Issues
1. **Parameter Explosion** - useKeyboardNavigation(78 params)
2. **God Objects** - AppStore managing 11 domains
3. **Feature Envy** - Components reaching into store for too many things
4. **Long Method** - Several 100+ line functions

### Prevention Strategy
- **Rule of 7**: No more than 7 parameters, 7 properties, 7 methods
- **Single Responsibility**: Each module does ONE thing well
- **Tell, Don't Ask**: Components should tell stores what to do, not ask for state to compute
- **Composition Over Inheritance**: Use hook composition, not massive hooks

---

Generated by responsibility analysis tool
Last updated: 2025-11-07
