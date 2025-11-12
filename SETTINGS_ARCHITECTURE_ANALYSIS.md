# Settings Architecture Analysis

## Current Architecture

### Two-Tier Settings System

| Setting | Global Default | Session-Specific | Command Behavior |
|---------|---------------|------------------|------------------|
| **Agent** | `defaultAgentId` | `agentId` | `/agent` → global only |
| **Rules** | `defaultEnabledRuleIds` | `enabledRuleIds` | `/rules` → session (if exists) or global |
| **Model** | `providers[x].defaultModel` | `modelId` | `/model` → global + session (if exists) |
| **Provider** | `defaultProvider` | `modelId` (includes provider) | `/provider` → global only |

### Session Creation (Lazy)
- Session created on first message
- Reads all global defaults:
  - `defaultProvider` + `defaultModel` → `modelId`
  - `defaultAgentId` → `agentId`
  - `defaultEnabledRuleIds` → `enabledRuleIds`

---

## 🐛 Identified Problems

### Problem 1: **Inconsistent Command Behavior**

#### `/agent` vs `/model` Inconsistency

**Current Behavior:**
- `/agent` → ONLY updates global `defaultAgentId`
- `/model` → Updates BOTH global `defaultModel` AND current session's `modelId`

**Why This is a Problem:**
```
User has active session (已經係度傾緊)
→ /agent writer  (切換到 writer agent)
→ 用戶期望：立即切換到 writer
→ 實際行為：當前 session 仍然用舊 agent，只有下次創建新 session 才用 writer

但同樣情況：
→ /model gpt-4  (切換到 gpt-4)
→ 實際行為：當前 session 立即切換到 gpt-4 ✅
```

**Root Cause:**
- No `updateSessionAgent()` function exists
- `/agent` command only calls `setSelectedAgent()` which saves to global config
- `/model` command calls both `setAIConfig()` AND `updateSessionModel()`

#### Code Evidence:
```typescript
// agent.command.tsx
await setSelectedAgent(agentId);  // Only global ❌

// model.command.tsx
setAIConfig(newConfig);  // Global
await updateSessionModel(currentSessionId, modelId);  // + Session ✅
```

---

### Problem 2: **Unclear Scope of `/rules` Command**

#### Context-Dependent Behavior

**Current Behavior:**
```typescript
// embedded-context.ts setEnabledRules()
const currentSessionId = getCurrentSessionId();
await setEnabledRuleIds(ruleIds, currentSessionId);

// Server decides:
if (sessionId) {
  // Save to session database
} else {
  // Save to global config
}
```

**The Confusion:**

| Scenario | What Happens | User Expectation |
|----------|-------------|------------------|
| No session yet | → Global default | ✅ Correct (預設值) |
| Has session | → Only current session | ❌ 可能以為改了 default |
| Has session, user thinks "I want all future sessions to use these rules" | → Only current session | ❌ Global 不變 |

**Example Flow:**
```
1. User: /rules (no session)
   → Select "core"
   → Saves to global ✅

2. User: (send message, creates session)
   → Session gets "core" from global ✅

3. User: /rules (has session)
   → Select "core" + "style-guide"
   → Saves to SESSION only
   → Global still has ["core"]

4. User: (restart app)
   → New session created
   → Reads global: ["core"]  ← "style-guide" 唔見左！
```

---

### Problem 3: **No UI Indication of Save Scope**

#### User Has No Visual Feedback

**Current UI:**
```
▌ Select all rules you want to enable:

  ▶ [ ] Core Rules - Essential system prompt rules
    [ ] Style Guide - Code style preferences
    [ ] Documentation - Documentation standards

↑↓: Navigate · Space: Toggle · Enter: Confirm · /: Filter
```

**What's Missing:**
- No indication if this will save to:
  - Global defaults (all future sessions)
  - Current session only
  - Both

**User Can't Tell:**
```
❓ 我依家改既 rules 係咪會保存係 config.json？
❓ 定係只係改左當前既 session？
❓ 下次開 app 會唔會記得我既選擇？
```

---

### Problem 4: **No Way to Update Global Defaults with Active Session**

#### Once Session Exists, Can't Change Defaults

**Scenario:**
```
User: (has active session)
User: "I want to change my DEFAULT rules for all future sessions"
User: /rules
→ This ONLY changes current session
→ NO WAY to update global defaults while session exists
```

**Workaround:**
```
1. Exit app
2. Start app (no session)
3. /rules (saves to global)
4. Exit app
5. Start app again
```

This is terrible UX! 😱

---

### Problem 5: **Model ID Migration Incomplete**

#### Legacy Fields Still Exist

**Current Session Schema:**
```typescript
interface Session {
  // NEW (normalized)
  modelId: string;  // e.g., "openrouter/anthropic/claude-sonnet-3.5"

  // LEGACY (deprecated but still used)
  provider?: ProviderId;
  model?: string;
}
```

**Problems:**
- Some code uses `provider + model`
- Some code uses `modelId`
- Inconsistent throughout codebase
- Migration not complete

---

### Problem 6: **Agent Can't Be Changed Mid-Session**

#### No `updateSessionAgent()` Function

**What Exists:**
- ✅ `updateSessionModel(sessionId, model)`
- ✅ `updateSessionProvider(sessionId, provider, model)`
- ✅ `updateSessionTitle(sessionId, title)`
- ❌ `updateSessionAgent(sessionId, agentId)` ← MISSING

**Impact:**
- User can switch models mid-conversation
- But CANNOT switch agents mid-conversation
- Inconsistent capabilities

---

### Problem 7: **Lazy Session but Eager Settings**

#### Temporal Coupling Issue

**The Flow:**
```
1. Start app (no session)
2. User sets preferences:
   /agent writer
   /rules core,style-guide
   /model gpt-4
3. User sends first message
   → Session created with all these settings ✅

BUT if user:
1. Start app (no session)
2. User: /agent writer
3. User: (send message, session created with writer)
4. User: /rules core,style-guide
   → Saves to SESSION, not global
   → Next app restart: rules lost! ❌
```

**The Problem:**
Settings have different meanings BEFORE vs AFTER first message, but UI doesn't communicate this!

---

---

## ✅ IMPLEMENTATION COMPLETE

### Unified Architecture Implemented

All settings commands now follow the unified architecture:

**Principle**: "每次設計都會一次過影響晒 session and global"

**Behavior**:
1. ALWAYS update global config (to predict future defaults)
2. IF current session exists, also update session
3. Old sessions are NEVER affected

### What Was Fixed

| Command | Status | Changes Made |
|---------|--------|--------------|
| `/agent` | ✅ Complete | Added `updateSessionAgent()` function, updated command to call both `setSelectedAgent()` and `updateSessionAgent()` |
| `/rules` | ✅ Complete | Created `setGlobalEnabledRules()` function, updated `setEnabledRules()` to call both global and session updates |
| `/model` | ✅ Already Good | Already was updating both global and session correctly |
| `/provider` | ✅ Complete | Updated both direct and UI callbacks to call `updateSessionProvider()` when session exists |

### Implementation Details

**Server-Side (code-server)**:
- Added `updateAgent` mutation to `session.router.ts`
- Updated `event-bus.service.ts` to include "agentId" in session-updated events
- Session creation now reads all global defaults: `defaultAgentId`, `defaultEnabledRuleIds`

**Client-Side (code-client)**:
- Added `updateSessionAgent()` function to session signals
- Created `setGlobalEnabledRules()` function to settings signals
- Deprecated ambiguous `setEnabledRuleIds()` function

**TUI Commands (code)**:
- Updated `/agent` command to update both global and session
- Updated `/rules` and `toggleRule()` in embedded-context to update both
- Updated `/provider` command to update both global and session

### Remaining Issues (Low Priority)

1. **Model ID Migration Incomplete** - Legacy `provider` + `model` fields still exist
2. **UI Indicators** - No visual indication of what scope settings are saved to
3. **Deprecated Function** - `setEnabledRuleIds()` still exists but should be removed

---

## 🎯 Proposed Solutions (ARCHIVED - For Reference Only)

### Solution 1: Make All Commands Consistent

#### Option A: All Commands Update Both Global + Session (if exists)

```typescript
// Unified behavior for /agent, /model, /rules, /provider

async function updateSetting(type, value) {
  const currentSessionId = getCurrentSessionId();

  // Always update global default
  await updateGlobalDefault(type, value);

  // Also update current session if exists
  if (currentSessionId) {
    await updateSessionSetting(currentSessionId, type, value);
  }
}
```

**Pros:**
- ✅ Consistent behavior
- ✅ User expectations met: "I change setting, it applies now AND in future"
- ✅ No confusion about scope

**Cons:**
- ❌ Can't change ONLY current session
- ❌ Can't experiment with settings for one conversation

#### Option B: Add Scope Parameter

```typescript
// Add scope to all commands
/agent writer --scope=session   // Only current
/agent writer --scope=global    // Only default
/agent writer --scope=both      // Both (default)
/agent writer                   // Same as --scope=both
```

**Pros:**
- ✅ Maximum flexibility
- ✅ Clear intent
- ✅ Can do both use cases

**Cons:**
- ❌ More complex CLI
- ❌ Users need to learn flags
- ❌ Verbose

#### Option C: Separate Commands for Defaults

```typescript
// Current session
/agent writer
/model gpt-4
/rules core,style

// Global defaults (new commands)
/default agent writer
/default model gpt-4
/default rules core,style
```

**Pros:**
- ✅ Clear separation
- ✅ Discoverable
- ✅ No flags needed

**Cons:**
- ❌ More commands to learn
- ❌ Duplicated logic

#### Option D: Interactive Prompt (RECOMMENDED)

```typescript
// When session exists, ask user
User: /rules
UI:
┌─────────────────────────────────────────┐
│ Where should these rules be saved?      │
├─────────────────────────────────────────┤
│ ▶ Current session only                  │
│   Global defaults (all future sessions) │
│   Both                                   │
└─────────────────────────────────────────┘
```

**Pros:**
- ✅ Clear, discoverable
- ✅ No new commands or flags
- ✅ User always knows what's happening
- ✅ Flexible

**Cons:**
- ❌ One extra step
- ❌ Can't use in scripts (but can add --scope flag for that)

---

### Solution 2: Add Visual Indicators in UI

```diff
// Before
▌ Select all rules you want to enable:

// After (no session)
▌ Select default rules (global config):

// After (with session)
▌ Select rules for current session:
  💡 Tip: These rules will only apply to this conversation.
      To change defaults, use /default rules
```

---

### Solution 3: Implement Missing Functions

```typescript
// Add to code-client/src/signals/domain/session/index.ts
export const updateSessionAgent = async (sessionId: string, agentId: string) => {
  const client = getTRPCClient();
  await client.session.updateAgent.mutate({ sessionId, agentId });
};

// Add to code-server/src/trpc/routers/session.router.ts
updateAgent: strictProcedure
  .input(z.object({
    sessionId: z.string(),
    agentId: z.string(),
  }))
  .mutation(async ({ ctx, input }) => {
    await ctx.sessionRepository.updateSession(input.sessionId, {
      agentId: input.agentId,
    });
  }),
```

Then update `/agent` command:
```typescript
await setSelectedAgent(agentId);  // Global

const currentSessionId = getCurrentSessionId();
if (currentSessionId) {
  await updateSessionAgent(currentSessionId, agentId);  // + Session
}
```

---

### Solution 4: Complete Model ID Migration

**Phase 1: Ensure all code uses `modelId`**
- Remove all references to legacy `provider` + `model` fields
- Use only `modelId` which encodes both

**Phase 2: Database migration**
- Migrate existing sessions: `provider + model → modelId`
- Drop legacy columns

---

## 🏆 Recommended Approach

### Immediate (High Priority)

1. **Add `updateSessionAgent()` function** → Make `/agent` consistent with `/model`
2. **Add UI indicators** → Show "Global defaults" vs "Current session"
3. **Add scope prompt** → When session exists, ask where to save

### Short Term (Medium Priority)

4. **Standardize all commands** → `/agent`, `/model`, `/rules` all behave identically
5. **Add `/default` command** → Explicit way to change global defaults

### Long Term (Low Priority)

6. **Complete modelId migration** → Remove legacy provider/model fields
7. **Add session templates** → "Save current session settings as template"

---

## 🤔 Questions for User

1. **Consistency vs Flexibility**: 當 session 存在時，改設定應該：
   - A) 兩個都改（global + session）← 簡單直接
   - B) 詢問用戶要改邊個 ← 靈活但多一步
   - C) 只改當前 session，加 `/default` 命令改 global ← 明確分離

2. **Agent switching**: 你期望 `/agent writer` 係：
   - A) 立即切換當前對話的 agent ← 即時生效
   - B) 只影響下一個 session ← 當前設計
   - C) 問我要唔要 apply 到當前 session ← 最靈活

3. **Rules persistence**: 最重要既係：
   - A) Rules 永久保存（重啟後都有）← 重視持久化
   - B) 可以只改當前 session 試新 rules ← 重視實驗
   - C) 兩個都想 ← 需要更複雜的 UI

4. **Settings discoverability**: 你覺得：
   - A) 簡單最重要，少 commands 少參數
   - B) 明確最重要，寧願多啲 commands 但清晰
   - C) 靈活最重要，用 flags/options 控制行為

邊個最符合你既期望？
