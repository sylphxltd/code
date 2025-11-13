# System Requirements & User Stories

**Document Type**: Specification (WHAT, not HOW)
**Last Updated**: 2025-01-XX
**Status**: Living Document - Complete Version

---

## 🎯 Overview

This document defines the **complete requirements and user stories** for the entire system. It focuses on WHAT the system should do, not HOW it should be implemented.

**Key Principles**:
- Architecture-agnostic (implementation can evolve)
- User-centric (based on real use cases)
- Testable (clear acceptance criteria)
- Living document (updates as requirements evolve)

**Coverage**: This document covers ~90 user stories across all major features discovered in the codebase.

---

# Part 1: Real-Time Streaming & Event System

## 📋 Problem Statement

Users interact with the system through multiple clients (TUI, Web GUI) and need:
1. **Real-time streaming responses** from AI
2. **Multi-client synchronization** (same session across devices)
3. **Resumable streaming** (join ongoing streaming)
4. **Selective event delivery** (right events to right clients)

---

## 🎯 Core Requirements

### R1.1: Real-Time Streaming
**Requirement**: Users MUST see AI responses stream in real-time, not wait for complete response.

**Acceptance Criteria**:
- User sends message
- AI response appears word-by-word (streaming)
- Tool calls appear as they execute
- User can see progress in real-time

**Why**: Better UX, feels responsive

---

### R1.2: Multi-Client Support
**Requirement**: Multiple clients MUST be able to interact with same session simultaneously.

**Acceptance Criteria**:
- User opens session in TUI and GUI
- Message sent from TUI appears in GUI immediately
- AI response streams to both clients in real-time
- Both clients stay synchronized

**Why**: Common workflow (desktop + mobile, multiple tabs)

---

### R1.3: Event-Driven Architecture
**Requirement**: System MUST use events for real-time updates, not polling.

**Acceptance Criteria**:
- State changes publish events
- Clients subscribe to relevant events
- Events delivered within 500ms
- No client-side polling

**Why**: Efficient, scalable, real-time

---

## 👤 User Stories - Streaming

### UC1: Normal Streaming (用戶發送消息)

**As a** user
**I want to** send a message and see AI response stream in real-time
**So that** I get immediate feedback and can monitor progress

**Flow**:
```
User 輸入 "hi"
  → Client 調用 subscription: caller.message.streamResponse.subscribe()
  → Server: streamAIResponse() 返回 Observable
  → Server emit events (text-delta, tool-call, tool-result, etc.)
  → Client onData callback 接收 events
  → Client 顯示 streaming response
```

**Acceptance Criteria**:
- Text appears word-by-word as AI generates it
- Tool calls appear when they execute
- Tool results appear when they complete
- User can see "thinking" state (reasoning, if supported)
- Final message saved to session after completion

**Current Status**: ✅ Working

**Priority**: P0 (Critical)

---

### UC2: Command with Auto-Response (Compact with Streaming)

**As a** user
**I want to** execute commands that trigger AI responses
**So that** the system can automate workflows

**Example**: `/compact` command

**Flow**:
```
User 執行 /compact
  → Client 調用 mutation: caller.session.compact.mutate()
  → Server: 生成 summary，創建新 session with system message
  → Server: 自動觸發 AI streaming (業務邏輯內部)
  → Server streaming AI response via event stream
  → Client 接收 streaming events (必須透過 event subscription)
  → Client 顯示 AI response
```

**Acceptance Criteria**:
- Command executes successfully
- AI response streams in real-time
- User sees streaming events (not just final result)
- New session created with correct state
- Client receives events without explicit subscription call

**Current Status**: ❌ Not working (client doesn't receive streaming events)

**Priority**: P0 (Critical)

**Technical Challenge**: How does client receive streaming events when mutation (not subscription) initiated the stream?

---

### UC3: Multi-Client Real-Time Sync

**As a** user with multiple clients open
**I want to** see actions in one client reflected immediately in other clients
**So that** I can work seamlessly across devices

**Scenario**:
```
User A (TUI) 發送消息
  → Server streaming
  → User A (TUI) 看到 streaming ✅
  → User B (GUI, same session) 實時看到 streaming ✅
  → Both clients synchronized
```

**Acceptance Criteria**:
- Message sent in one client appears in all clients
- AI response streams to all clients simultaneously
- Tool calls/results appear in all clients
- No client falls behind or misses events
- Works across device types (TUI ↔ GUI)

**Current Status**: ✅ Working (via event stream)

**Priority**: P0 (Critical)

---

### UC4: Resumable Streaming (跨 Client 同步進行中的 Streaming)

**As a** user
**I want to** join an ongoing streaming session from a different client
**So that** I can monitor progress from any device

**Scenario**:
```
GUI 在 session A 發送 "hi"
  → Server streaming AI response
  → GUI 看到 streaming ✅

TUI 從 session B 切換到 session A (mid-stream)
  → TUI 應該看到正在進行的 streaming ✅
  → TUI 實時同步 remaining text-delta, tool-call, etc.
  → TUI joins stream mid-flight (不會錯過後續 events)
```

**Acceptance Criteria**:
- User switches to session with active streaming
- Client receives remaining streaming events
- Client displays correct state (current text + new deltas)
- No missed events
- Seamless join experience

**Current Status**: ✅ Working (client subscribes to session channel)

**Priority**: P1 (High)

---

### UC5: Selective Event Delivery (事件選擇性送達)

**As the** system
**I want to** send events only to relevant clients
**So that** clients don't receive unnecessary data

**Scenario 1 - Session-Specific Events**:
```
TUI 在 session A
GUI 在 session B

Session A streaming (text-delta, tool-call):
  → TUI 收到 ✅ (subscribed to session:A)
  → GUI 不收到 ✅ (subscribed to session:B, not session:A)
```

**Scenario 2 - Global Events**:
```
Session A title 更新 (AI generated title):
  → TUI 收到 ✅ (in session A, needs to update header)
  → GUI 收到 ✅ (needs to update sidebar session list)
  → Both clients update their UI appropriately
```

**Acceptance Criteria**:
- Session-specific events only go to clients in that session
- Global events go to all relevant clients
- Clients can subscribe to multiple event channels
- Event routing is efficient (no broadcast overhead)

**Event Channel Types**:
- `session:{sessionId}` - Session-specific events (streaming, messages, etc.)
- `session-events` - Global session events (created, deleted, title-updated)
- `global` - System-wide events (if needed)

**Current Status**: ✅ Working (event stream with channels)

**Priority**: P1 (High)

---

## 🧪 Testing Acceptance Criteria - Streaming

### Test Case S1: Normal Streaming
**Steps**:
1. User sends message "hi"
2. Observe streaming in client

**Expected**:
- Text appears progressively
- Tool calls appear when executed
- Tool results appear when completed
- Final message saved correctly

**Priority**: P0

---

### Test Case S2: Multi-Client Streaming
**Steps**:
1. Open session in 2 clients
2. Send message in Client 1
3. Observe both clients

**Expected**:
- Both clients show streaming simultaneously
- Both clients show identical content
- No desync or missing events

**Priority**: P0

---

### Test Case S3: Resumable Streaming
**Steps**:
1. Start streaming in Client 1
2. Open session in Client 2 mid-stream
3. Observe Client 2

**Expected**:
- Client 2 shows current state
- Client 2 receives remaining events
- No errors or crashes

**Priority**: P1

---

### Test Case S4: Command Auto-Response
**Steps**:
1. Execute `/compact` command
2. Observe streaming response

**Expected**:
- Command executes successfully
- AI response streams in real-time
- Client shows streaming events
- New session created correctly

**Priority**: P0

---

### Test Case S5: Selective Delivery
**Steps**:
1. Open Client 1 in session A
2. Open Client 2 in session B
3. Send message in session A
4. Update title in session A

**Expected**:
- Streaming events: Only Client 1 receives
- Title update: Both clients receive
- Client 2 doesn't get session A streaming

**Priority**: P1

---

# Part 2: Session Management

## 📋 Problem Statement

Users need to manage multiple chat sessions, each with different configurations and conversation history. Sessions should support:
1. **Creation** with specific settings
2. **Switching** between sessions
3. **Deletion** to clean up old sessions
4. **Compaction** to reduce token usage
5. **Auto-titling** for easy identification
6. **Multi-client sync** for session lists

---

## 👤 User Stories - Session Management

### UC15: Create New Session

**As a** user
**I want to** create a new chat session
**So that** I can start a fresh conversation with specific settings

**Acceptance Criteria**:
- Can create via `/new` command or UI action
- Can specify provider, model, agent, rules at creation
- Global defaults applied if not specified
- Session auto-created on first message (lazy sessions)
- New session event broadcasts to all clients

**Priority**: P0 (Critical)

---

### UC16: List and Switch Sessions

**As a** user
**I want to** view and switch between my chat sessions
**So that** I can continue previous conversations

**Acceptance Criteria**:
- `/sessions` command shows session list
- Sessions sorted by last updated (most recent first)
- Can search sessions by title (fuzzy search)
- Cursor-based pagination for 100+ sessions
- Shows session title, creation date, message count
- Arrow keys to navigate, Enter to select

**Priority**: P0 (Critical)

---

### UC17: Delete Session

**As a** user
**I want to** delete old sessions
**So that** I can clean up my workspace

**Acceptance Criteria**:
- Deletes session and all associated data (cascade)
- Emits session-deleted event for multi-client sync
- Cannot undo (permanent deletion)
- Confirmation prompt to prevent accidents

**Priority**: P1 (High)

---

### UC18: Compact Session (Summarize & Continue)

**As a** user
**I want to** compact a long session
**So that** I can reduce token usage while preserving context

**Acceptance Criteria**:
- `/compact` command triggers compaction
- AI generates summary of conversation
- Creates new session with summary as system message
- Auto-triggers AI response in new session (streaming)
- Old session preserved (not deleted)
- Multi-client event sync for compact operation

**Priority**: P1 (High)

---

### UC19: Session Title Auto-Generation

**As a** user
**I want** sessions to get descriptive titles automatically
**So that** I can identify conversations easily

**Acceptance Criteria**:
- Title generated after first user message + AI response
- Streaming title updates (delta events)
- Shows in session list immediately
- Can manually update title later (future feature)
- Multi-client sync: All clients see title updates

**Priority**: P1 (High)

---

### UC20: Session Model Availability Check

**As a** user
**I want to** know if a session's model is unavailable
**So that** I can switch to a compatible model

**Acceptance Criteria**:
- TTL cache (1 hour) prevents excessive API calls
- Shows model status: available | unavailable | unknown
- Warns user before resuming unavailable model session
- Suggests switching to available model

**Priority**: P2 (Medium)

---

### UC21: Session List Multi-Client Sync

**As a** user with multiple clients
**I want** my session list to stay synchronized
**So that** I see the same sessions everywhere

**Acceptance Criteria**:
- Session created/deleted events to all clients
- Session title updates propagate
- Session list auto-refreshes
- No manual reload needed

**Priority**: P1 (High)

---

# Part 3: Message Operations

## 📋 Problem Statement

Users interact with AI through messages, which can contain:
1. **Text content** from user or AI
2. **File attachments** (code, images, documents)
3. **Tool calls** and results
4. **Reasoning** (extended thinking)
5. **Errors** from tool execution

Messages should support:
- Real-time streaming
- File attachments with frozen storage
- Abort mid-stream
- History preservation
- Multi-step interactions

---

## 👤 User Stories - Message Operations

### UC22: Send User Message with Text

**As a** user
**I want to** send text messages to the AI
**So that** I can communicate my requests

**Acceptance Criteria**:
- Type message in input field
- Press Enter to send
- Message saved immediately
- Streaming response begins
- Message appears in chat history

**Priority**: P0 (Critical)

**Note**: Covered by UC1 (Normal Streaming)

---

### UC23: Attach Files to Messages

**As a** user
**I want to** attach files to my messages
**So that** the AI can read and analyze them

**Acceptance Criteria**:
- Type `@` to trigger file autocomplete
- Fuzzy search file paths
- Arrow keys to navigate, Enter to select
- Multiple files attachable
- Shows token count per file
- Files frozen as immutable content (prompt cache friendly)

**Priority**: P0 (Critical)

---

### UC24: File Autocomplete

**As a** user
**I want** fast file search when attaching files
**So that** I can quickly find relevant files

**Acceptance Criteria**:
- Type `@` + partial path triggers autocomplete
- Fuzzy matching (e.g., "sct" matches "src/components/Chat.tsx")
- Real-time filtering as user types
- Shows relative paths
- Arrow keys navigate, Enter selects, Esc cancels

**Priority**: P1 (High)

---

### UC25: Frozen File Storage

**As a** user
**I want** attached files to be preserved exactly as they were
**So that** message history shows accurate context

**Acceptance Criteria**:
- Files stored as BLOB (not base64) - 33% smaller
- Immutable storage (prompt cache friendly)
- Text files indexed for FTS5 search (future)
- SHA256 deduplication possible
- Rewind/checkpoint support (restore files)

**Priority**: P1 (High)

---

### UC26: Image File Display

**As a** user
**I want** attached images to display inline
**So that** I can see visual context

**Acceptance Criteria**:
- Images render in terminal (iTerm2 protocol)
- Images render in web GUI
- Base64 encoding for transmission
- Supports common formats (PNG, JPG, GIF)

**Priority**: P2 (Medium)

---

### UC27: Abort Streaming Response

**As a** user
**I want to** abort long-running AI responses
**So that** I can stop unwanted or incorrect generation

**Acceptance Criteria**:
- Keyboard shortcut (Ctrl+C / Esc) aborts stream
- Server-side abort via AbortController
- Pending tool executions cancelled
- Active message parts marked as 'abort' status
- Event published to all clients
- Can send new message after abort

**Priority**: P0 (Critical)

---

### UC28: View Message History

**As a** user
**I want to** scroll through past messages in current session
**So that** I can review conversation context

**Acceptance Criteria**:
- All messages displayed in chronological order
- Scroll with arrow keys or mouse
- User messages aligned left
- AI messages aligned right (or visually distinct)
- Supports large history (100+ messages)

**Priority**: P1 (High)

---

### UC29: Message Step Architecture

**As a** user
**I want** the AI to use tools iteratively
**So that** complex tasks can be completed in one response

**Acceptance Criteria**:
- User message = 1 step
- Assistant message = 1+ steps (tool execution loops)
- Each step has own metadata (system status snapshot)
- Step usage tracked separately
- Streaming shows all steps in real-time
- Tool results feed into next step

**Priority**: P1 (High)

---

### UC30: Message Parts (Text, Reasoning, Tools, Errors)

**As a** user
**I want to** see different types of content in AI responses
**So that** I understand what the AI is doing

**Acceptance Criteria**:
- Text parts: Normal AI response text
- Reasoning parts: Extended thinking (if model supports)
- Tool parts: Tool calls with input/output
- Error parts: Tool execution errors
- All parts have unified status field
- Visual distinction between part types

**Priority**: P1 (High)

---

# Part 4: Agent & Rules Management

## 📋 Problem Statement

Users need different AI behaviors for different tasks. The system provides:
1. **Built-in agents** with specialized prompts (coder, planner, etc.)
2. **Custom agents** defined in project files
3. **System prompt rules** that can be enabled/disabled
4. **Custom rules** for project-specific guidelines

---

## 👤 User Stories - Agent & Rules

### UC31: Switch Agent

**As a** user
**I want to** switch between different AI agents
**So that** I can use specialized system prompts for different tasks

**Acceptance Criteria**:
- `/agent` command shows agent selection UI
- `/agent <name>` switches directly
- Updates global default and current session
- Token count updates to reflect new system prompt
- Built-in agents: coder, planner, etc.
- Visual feedback on current agent

**Priority**: P0 (Critical)

---

### UC32: Custom Agents

**As a** user
**I want to** create custom agents
**So that** I can define specialized system prompts

**Acceptance Criteria**:
- Place .md files in `.sylphx-code/.agents/`
- Frontmatter metadata: name, description
- Markdown body = system prompt
- Auto-loaded on startup
- Mixed with built-in agents in `/agent` UI
- Hot reload when files change (optional)

**Priority**: P1 (High)

---

### UC33: Enable/Disable Rules

**As a** user
**I want to** enable/disable system prompt rules
**So that** I can customize AI behavior

**Acceptance Criteria**:
- `/rules` shows multi-select checkbox UI
- Pre-selects currently enabled rules
- Can toggle multiple rules at once
- Updates global default or session-specific
- Token count updates immediately
- Visual indication of enabled/disabled rules

**Priority**: P0 (Critical)

---

### UC34: Custom Rules

**As a** user
**I want to** create custom system prompt rules
**So that** I can enforce project-specific guidelines

**Acceptance Criteria**:
- Place .md files in `.sylphx-code/.rules/`
- Frontmatter metadata: name, description, enabled (default)
- Markdown body = rule content
- Auto-loaded on startup
- Mixed with built-in rules in `/rules` UI
- Hot reload when files change (optional)

**Priority**: P1 (High)

---

# Part 5: Provider & Model Configuration

## 📋 Problem Statement

Users need to connect to different AI providers (Anthropic, OpenAI, Google, etc.) and select appropriate models. The system supports:
1. **Multiple providers** with different capabilities
2. **Provider credentials** managed securely
3. **Model selection** from provider catalogs
4. **Zero-knowledge architecture** (client never sees API keys)

---

## 👤 User Stories - Provider & Model

### UC35: Configure Provider

**As a** user
**I want to** configure AI providers
**So that** I can use different AI services

**Acceptance Criteria**:
- `/provider configure <provider>` opens config UI
- Provider schema defines required fields
- API keys stored securely (removed from client config)
- Zero-knowledge: client never sees keys
- `/provider configure <provider> set <key> <value>` for CLI
- Supported providers: Anthropic, OpenAI, Google, OpenRouter, Kimi, ZAI, Claude Code

**Priority**: P0 (Critical)

---

### UC36: Switch Provider

**As a** user
**I want to** switch between configured providers
**So that** I can use different AI services

**Acceptance Criteria**:
- `/provider use` shows provider list
- `/provider use <provider>` switches directly
- Updates global default and current session
- Model list refreshed for new provider
- Validates provider configuration before switch

**Priority**: P0 (Critical)

---

### UC37: Switch Model

**As a** user
**I want to** switch AI models
**So that** I can use different capabilities/pricing

**Acceptance Criteria**:
- `/model` shows model list from current provider
- `/model <name>` switches directly
- Fetches models from provider API (TTL cached 1 hour)
- Token counts recalculated with new tokenizer
- Context limit updated in display
- Shows model capabilities (vision, tools, reasoning)

**Priority**: P0 (Critical)

---

### UC38: Provider Credential Management

**As a** user
**I want to** manage multiple API keys per provider
**So that** I can use different credentials for different projects

**Acceptance Criteria**:
- Global scope: `~/.sylphx-code/credentials.json`
- Project scope: `.sylphx-code/credentials.local.json` (gitignored)
- Set default credential per provider
- Label credentials for identification
- Track last used, expiration
- Secure storage (file permissions 600)

**Priority**: P1 (High)

---

### UC39: Zero-Knowledge Secret Management

**As a** user
**I want** my API keys to be secure
**So that** they cannot be stolen via XSS or client-side attacks

**Acceptance Criteria**:
- API keys removed before sending config to client
- Client cannot read keys (zero-knowledge)
- Server merges keys from disk during save
- Dedicated setProviderSecret endpoint for updates
- Keys never logged or exposed in errors

**Priority**: P0 (Critical)

---

### UC40: Model Availability Cache

**As a** user
**I want** fast model switching without API spam
**So that** the system feels responsive

**Acceptance Criteria**:
- TTL cache (1 hour) for model lists
- Fetches from provider API on cache miss
- Background refresh before expiration
- Error handling for provider API failures
- Shows "Loading..." during fetch

**Priority**: P2 (Medium)

---

# Part 6: Token Calculation System

## 📋 Problem Statement

Users need to see accurate token usage counts throughout their session, but token counts are NOT static:

1. **Agent changes mid-session** → System prompt changes → Base context changes
2. **Rules change mid-session** → System prompt changes → Base context changes
3. **Model changes mid-session** → Tokenizer changes → ALL historical counts change

**User Quote** (Original Requirements):
> "你唔可以咁樣，因為session 去到一半都可以轉agent, 轉system prompt 甚至轉tools"
>
> Translation: "You can't cache tokens, because mid-session you can change agent, system prompt, even tools"

> "甚至歷史用量都唔係固定，轉model就會轉tokenizer (auto tokenizer會根據model去推斷用咩tokenizer)"
>
> Translation: "Even historical usage is not fixed. Changing model changes tokenizer (auto tokenizer infers which tokenizer based on model)"

> "所以全部歷史都唔係固定"
>
> Translation: "So all history is not fixed"

---

## 🎯 Core Requirements

### R2.1: SSOT (Single Source of Truth)
**Requirement**: All token displays MUST show identical numbers for the same state.

**Acceptance Criteria**:
- StatusBar shows: "443 / 256k (0%)"
- `/context` command shows: "Total: 443 tokens"
- ✅ Numbers MUST match exactly

**Why**:
- User confusion if different parts of UI show different numbers
- Loss of trust in the system
- Debugging nightmares

---

### R2.2: Real-Time Updates
**Requirement**: Token counts MUST update immediately when session state changes.

**State Changes That Affect Tokens**:
- Message sent/received
- Agent switched
- Model switched
- Rules toggled on/off

**Acceptance Criteria**:
- User switches agent → StatusBar updates within 1 second
- User sends message → StatusBar shows optimistic update during streaming
- User toggles rule → StatusBar reflects new count immediately

**Why**:
- User needs to monitor context usage to avoid hitting limits
- Real-time feedback improves UX

---

### R2.3: Multi-Client Synchronization
**Requirement**: Multiple clients viewing the same session MUST see synchronized token counts.

**Scenario**:
- User has 2 browser tabs open
- User sends message in Tab 1
- Both Tab 1 and Tab 2 MUST show same token count

**Acceptance Criteria**:
- During streaming: Both tabs update in real-time
- After message: Both tabs show identical final count
- No polling required (event-driven)

**Why**:
- Common workflow: Multiple devices/tabs
- Prevents confusion about session state

---

### R2.4: Volatile State Handling
**Requirement**: System MUST handle the fact that token counts are volatile (not cacheable).

**Volatile Factors**:
1. **Agent Change**: Different agents have different system prompts
   - Coder agent: 250 tokens
   - Planner agent: 350 tokens
   - Same session, different base context

2. **Rules Change**: Toggling rules changes system prompt length
   - 5 rules enabled: 450 tokens
   - 3 rules enabled: 380 tokens
   - Same session, different base context

3. **Model Change**: Different tokenizers count differently
   - Claude tokenizer: "Hello world" = 3 tokens
   - GPT-4 tokenizer: "Hello world" = 2 tokens
   - Same text, different count

**Acceptance Criteria**:
- System MUST recalculate when any volatile factor changes
- Cached values MUST NOT cause stale data
- User MUST see accurate count for current state

**Why**:
- Incorrect counts can cause:
  - User hitting context limits unexpectedly
  - User avoiding limits unnecessarily
  - Loss of trust in the system

---

## 👤 User Stories - Token Calculation

### UC41: View Current Context Usage

**As a** user
**I want to** see how many tokens I'm currently using
**So that** I can monitor my usage and avoid hitting context limits

**Acceptance Criteria**:
- StatusBar displays: `[used] / [limit] ([percentage]%)`
- Example: "1,250 / 200,000 (1%)"
- Updates in real-time as I interact with the system
- Always accurate for current session state

**Priority**: P0 (Critical)

---

### UC42: See Token Breakdown

**As a** user
**I want to** see a detailed breakdown of where my tokens are used
**So that** I can understand what's consuming my context

**Acceptance Criteria**:
- `/context` command shows:
  ```
  System: 250 tokens
  Tools: 193 tokens
  Messages: 807 tokens
  ────────────────
  Total: 1,250 tokens
  ```
- Breakdown MUST match StatusBar total
- Updates when I run the command (not cached)

**Priority**: P0 (Critical)

---

### UC43: Switch Agent Mid-Session

**As a** user
**I want to** switch to a different agent mid-session
**So that** I can use different agent capabilities without starting over

**Scenario**:
1. User is using "coder" agent
2. StatusBar shows: "443 / 200k (0%)"
3. User types: `/agent planner`
4. StatusBar updates to: "560 / 200k (0%)" (planner has longer prompt)

**Acceptance Criteria**:
- Token count updates immediately after agent switch
- New count reflects new agent's system prompt
- Session history preserved
- No weird glitches or incorrect counts

**Priority**: P0 (Critical)

---

### UC44: Switch Model Mid-Session

**As a** user
**I want to** switch to a different model mid-session
**So that** I can try different models without losing my conversation

**Scenario**:
1. User is using Claude Sonnet
2. StatusBar shows: "1,250 / 200k (1%)"
3. User types: `/model gpt-4`
4. StatusBar recalculates: "1,180 / 128k (1%)" (different tokenizer + limit)

**Acceptance Criteria**:
- Token count recalculates with new model's tokenizer
- ALL historical messages recounted (not just new ones)
- Model's context limit updates in display
- User can switch back and forth without issues

**Priority**: P0 (Critical)

---

### UC45: Toggle Rules Mid-Session

**As a** user
**I want to** enable/disable rules mid-session
**So that** I can control which rules apply without restarting

**Scenario**:
1. User has 5 rules enabled
2. StatusBar shows: "850 / 200k (0%)"
3. User types: `/rules` and disables 2 rules
4. StatusBar updates: "720 / 200k (0%)" (less prompt text)

**Acceptance Criteria**:
- Token count updates after toggling rules
- System prompt recalculates with new rule set
- Can toggle rules multiple times
- Each toggle updates count immediately

**Priority**: P1 (High)

---

### UC46: Real-Time Streaming Token Updates

**As a** user
**I want to** see token count update while AI is responding
**So that** I can monitor usage in real-time

**Scenario**:
1. User sends message
2. AI starts responding
3. StatusBar updates continuously: 1,250 → 1,300 → 1,350 → ...
4. AI finishes
5. StatusBar shows final accurate count

**Acceptance Criteria**:
- Optimistic updates during streaming (fast, approximate)
- Checkpoint updates on step completion (accurate)
- Final update after response complete (accurate)
- No jarring jumps in count (smooth progression)

**Priority**: P1 (High)

**Performance Requirement**:
- User requirement: "反正有任何異動都要即刻通知client去實時更新"
  - Translation: "Any changes must immediately notify client for real-time updates"

---

### UC47: Multi-Tab Token Sync

**As a** user
**I want to** open the same session in multiple tabs
**So that** I can work across devices/windows

**Scenario**:
1. User opens session in Tab 1
2. User opens same session in Tab 2
3. User sends message in Tab 1
4. Both tabs show real-time streaming updates
5. Both tabs show identical final counts

**Acceptance Criteria**:
- Both tabs display identical token counts
- Updates propagate to all tabs in real-time
- No tab-specific cached values
- Works across devices (not just tabs)

**Priority**: P1 (High)

---

### UC48: Start Without Session (Lazy Session)

**As a** user
**I want to** see token usage before I send my first message
**So that** I know my base context size

**Scenario**:
1. User opens app (no session yet)
2. User selects provider and model
3. StatusBar shows: "443 / 200k (0%)" (base context only)
4. User hasn't sent any messages yet

**Acceptance Criteria**:
- StatusBar shows base context before session exists
- Count includes: system prompt + tools
- Updates if user changes agent/rules before first message
- Seamlessly transitions when session created

**Priority**: P2 (Medium)

---

### UC49: Context Warning System Messages

**As a** user
**I want** the AI to be notified when context is nearly full
**So that** it can suggest compacting or removing old messages

**Acceptance Criteria**:
- Triggers at 80%, 90% context usage
- System message injected before AI call
- Flag-based to avoid duplicate warnings
- Bidirectional (enter/exit states)
- AI can suggest compaction or summarization

**Priority**: P2 (Medium)

---

# Part 7: Slash Commands

## 📋 Problem Statement

Users need quick access to system functions through slash commands in the chat interface. Commands should be:
1. **Discoverable** (help system)
2. **Consistent** (similar syntax/behavior)
3. **Interactive** (TUI selection when applicable)
4. **Fast** (no unnecessary round-trips)

---

## 👤 User Stories - Slash Commands

### UC50: `/help` - Command Help

**As a** user
**I want to** view list of all commands with descriptions
**So that** I can discover available features

**Acceptance Criteria**:
- Lists all available commands
- Shows brief description for each
- Shows command syntax/arguments
- Can search/filter commands (optional)

**Priority**: P1 (High)

---

### UC51: `/provider` - Provider Management

**As a** user
**I want to** manage AI providers via command
**So that** I can configure and switch providers quickly

**Sub-commands**:
- `/provider` - Show current provider
- `/provider use` - Select provider from list
- `/provider use <name>` - Switch to specific provider
- `/provider configure <name>` - Configure provider settings

**Acceptance Criteria**:
- Interactive selection UI when no args
- Direct switch with provider name
- Configuration UI for API keys and settings
- Validation before switching

**Priority**: P0 (Critical)

---

### UC52: `/model` - Model Selection

**As a** user
**I want to** switch AI models via command
**So that** I can use different model capabilities

**Sub-commands**:
- `/model` - Show current model and select from list
- `/model <name>` - Switch to specific model

**Acceptance Criteria**:
- Fetches available models from current provider
- Shows model capabilities (vision, tools, etc.)
- Updates token calculations after switch
- TTL cache (1 hour) to avoid API spam

**Priority**: P0 (Critical)

---

### UC53: `/agent` - Agent Switching

**As a** user
**I want to** switch AI agents via command
**So that** I can use different system prompts

**Sub-commands**:
- `/agent` - Show current agent and select from list
- `/agent <name>` - Switch to specific agent

**Acceptance Criteria**:
- Shows built-in and custom agents
- Displays agent description
- Updates token calculations after switch
- Visual feedback on current agent

**Priority**: P0 (Critical)

---

### UC54: `/rules` - Rules Management

**As a** user
**I want to** manage system prompt rules via command
**So that** I can customize AI behavior

**Acceptance Criteria**:
- Shows multi-select checkbox UI
- Pre-selects currently enabled rules
- Can toggle multiple rules at once
- Updates token calculations after change
- Shows rule descriptions

**Priority**: P0 (Critical)

---

### UC55: `/context` - Token Usage Breakdown

**As a** user
**I want to** view detailed token usage
**So that** I understand context consumption

**Acceptance Criteria**:
- Shows breakdown: System, Tools, Messages
- Shows total and percentage
- Shows context limit
- Numbers match StatusBar display (SSOT)

**Priority**: P0 (Critical)

---

### UC56: `/sessions` - Session Switching

**As a** user
**I want to** switch between sessions via command
**So that** I can navigate my conversation history

**Acceptance Criteria**:
- Shows recent sessions (paginated)
- Displays title, date, message count
- Can search by title
- Arrow keys to navigate, Enter to select
- Loads selected session

**Priority**: P0 (Critical)

---

### UC57: `/new` - Create New Session

**As a** user
**I want to** create new session via command
**So that** I can start fresh conversation quickly

**Acceptance Criteria**:
- Creates new session with current settings
- Switches to new session immediately
- Broadcasts session-created event
- Optional: Prompt for session name

**Priority**: P1 (High)

---

### UC58: `/compact` - Session Compaction

**As a** user
**I want to** compact long sessions via command
**So that** I can reduce token usage

**Acceptance Criteria**:
- Generates conversation summary
- Creates new session with summary
- Auto-triggers AI response (streaming)
- Preserves old session
- Updates session list

**Priority**: P1 (High)

---

### UC59: `/settings` - Tool Display Settings

**As a** user
**I want to** configure tool display preferences
**So that** I can customize output verbosity

**Settings**:
- Show/hide tool inputs
- Show/hide tool outputs
- Collapse/expand tool details

**Acceptance Criteria**:
- Interactive settings UI
- Changes apply immediately
- Persistent (saved to config)
- Affects current and future sessions

**Priority**: P2 (Medium)

---

### UC60: `/notifications` - Notification Settings

**As a** user
**I want to** configure notification preferences
**So that** I can be alerted when AI completes responses

**Settings**:
- OS notifications (on/off)
- Terminal bell (on/off)
- Sound effects (on/off)

**Acceptance Criteria**:
- Interactive settings UI
- Platform-specific (macOS, Linux, Windows)
- Test notification button
- Persistent (saved to config)

**Priority**: P2 (Medium)

---

### UC61: `/bashes` - View Background Shells

**As a** user
**I want to** view and manage background bash shells
**So that** I can monitor long-running processes

**Acceptance Criteria**:
- Lists all active background shells
- Shows shell ID, command, status
- Can view output of running shells
- Can kill shells if needed
- Refreshes automatically

**Priority**: P2 (Medium)

---

### UC62: `/logs` - Debug Logs

**As a** user
**I want to** view application debug logs
**So that** I can troubleshoot issues

**Acceptance Criteria**:
- Shows recent log entries
- Can filter by level (debug, info, warn, error)
- Can search log content
- Can export logs to file

**Priority**: P3 (Low)

---

### UC63: `/survey` - Feedback Survey

**As a** user
**I want to** provide feedback about the application
**So that** I can contribute to improvements

**Acceptance Criteria**:
- Opens feedback form
- Collects structured feedback
- Submits to feedback endpoint
- Thank you message after submission

**Priority**: P3 (Low)

---

# Part 8: AI Tools (Tool Execution)

## 📋 Problem Statement

The AI needs to interact with the user's system to complete tasks. Tools should be:
1. **Safe** (proper sandboxing, timeouts)
2. **Fast** (minimal overhead)
3. **Reliable** (error handling, retries)
4. **Visible** (user sees what AI is doing)

---

## 👤 User Stories - AI Tools

### UC64: File Read Tool

**As the** AI
**I want to** read file contents
**So that** I can analyze code and provide context-aware responses

**Acceptance Criteria**:
- Reads files up to 10MB
- Supports offset/limit for large files
- Returns content with line numbers
- Handles binary files gracefully
- Shows "Reading..." indicator to user

**Priority**: P0 (Critical)

---

### UC65: File Write Tool

**As the** AI
**I want to** write files to disk
**So that** I can create new files or modify existing ones

**Acceptance Criteria**:
- Writes files with specified content
- Auto-creates parent directories
- Overwrites existing files (with warning)
- Handles file permissions properly
- Shows "Writing..." indicator to user

**Priority**: P0 (Critical)

---

### UC66: File Edit Tool

**As the** AI
**I want to** make line-based edits to files
**So that** I can modify specific sections without rewriting entire files

**Acceptance Criteria**:
- SEARCH/REPLACE block syntax
- Validates search string exists
- Applies replacement atomically
- Supports replace-all mode
- Shows diff to user before applying

**Priority**: P0 (Critical)

---

### UC67: Bash Command Execution

**As the** AI
**I want to** run shell commands
**So that** I can automate tasks and gather system information

**Acceptance Criteria**:
- Executes commands with timeout (2min default, 10min max)
- Supports background execution
- Proper quoting for paths with spaces
- Working directory preservation
- Shows command output to user in real-time

**Priority**: P0 (Critical)

---

### UC68: Background Shell Management

**As the** AI
**I want to** manage background shell processes
**So that** I can monitor long-running tasks

**Tools**:
- `BashOutput`: Read output from background shell
- `KillShell`: Terminate background shell

**Acceptance Criteria**:
- Background shells persist across messages
- Can read output incrementally
- Can filter output with regex
- Can kill shells cleanly
- User notified of background processes

**Priority**: P1 (High)

---

### UC69: File Pattern Matching (Glob)

**As the** AI
**I want to** find files by pattern
**So that** I can locate relevant files quickly

**Acceptance Criteria**:
- Supports glob patterns (e.g., `**/*.ts`)
- Returns sorted file paths
- Fast (doesn't read file contents)
- Respects .gitignore (optional)
- Shows "Searching..." indicator

**Priority**: P0 (Critical)

---

### UC70: Content Search (Grep)

**As the** AI
**I want to** search file contents by pattern
**So that** I can find specific code or text

**Acceptance Criteria**:
- Supports regex patterns
- Can filter by file type/glob
- Shows line numbers and context
- Fast (uses ripgrep under the hood)
- Supports multiline mode

**Priority**: P0 (Critical)

---

### UC71: Ask User Questions

**As the** AI
**I want to** ask the user questions
**So that** I can gather input for complex workflows

**Acceptance Criteria**:
- Single-select or multi-select questions
- Supports free-text input option
- Shows in inline selection UI
- Queue system for multiple questions
- Timeout if user doesn't respond

**Priority**: P1 (High)

---

### UC72: Todo Management

**As the** AI
**I want to** create and manage todos
**So that** I can track tasks in long conversations

**Acceptance Criteria**:
- Create todos with status (pending/in_progress/completed)
- Update todo status
- Delete todos
- Todos displayed in sidebar
- Persisted per session

**Priority**: P1 (High)

---

# Part 9: Keyboard Shortcuts

## 📋 Problem Statement

Users need efficient keyboard navigation for productivity. Shortcuts should be:
1. **Discoverable** (help documentation)
2. **Consistent** (Emacs-style conventions)
3. **Non-conflicting** (with system/terminal shortcuts)
4. **Cross-platform** (macOS, Linux, Windows)

---

## 👤 User Stories - Keyboard Shortcuts

### UC73: Text Editing Shortcuts

**As a** user
**I want** Emacs-style text editing shortcuts
**So that** I can edit input efficiently

**Shortcuts**:
- `Ctrl+A` / `Home`: Move to start of line
- `Ctrl+E` / `End`: Move to end of line
- `Ctrl+B` / `←`: Move left
- `Ctrl+F` / `→`: Move right
- `Meta+B` / `Ctrl+←`: Move word left
- `Meta+F` / `Ctrl+→`: Move word right
- `Ctrl+H` / `Backspace`: Delete char left
- `Ctrl+D` / `Delete`: Delete char right
- `Ctrl+W` / `Meta+Backspace`: Delete word left
- `Meta+D`: Delete word right
- `Ctrl+U`: Delete to start of line
- `Ctrl+K`: Delete to end of line
- `Ctrl+T`: Transpose characters
- `Ctrl+Y`: Yank (paste from kill buffer)

**Priority**: P1 (High)

---

### UC74: Multiline Input Shortcuts

**As a** user
**I want to** insert newlines in my input
**So that** I can write multiline messages

**Shortcuts**:
- `Ctrl+J`: Insert newline
- `Shift+Enter`: Insert newline
- `Meta+Enter`: Insert newline
- `Enter` (alone): Submit message

**Priority**: P0 (Critical)

---

### UC75: Navigation Shortcuts

**As a** user
**I want** keyboard navigation in lists and menus
**So that** I don't need to use mouse

**Shortcuts**:
- `↑` / `↓`: Navigate options
- `Enter`: Confirm selection
- `Esc`: Cancel / Exit
- `Tab`: Autocomplete / Next option
- `Space`: Toggle checkbox (multi-select)

**Priority**: P0 (Critical)

---

### UC76: Message History Navigation

**As a** user
**I want to** navigate through my previous messages
**So that** I can quickly resend or edit past input

**Shortcuts**:
- `↑`: Previous message (when at start of empty input)
- `↓`: Next message (when navigating history)

**Priority**: P2 (Medium)

---

### UC77: Streaming Control Shortcuts

**As a** user
**I want to** control AI streaming with keyboard
**So that** I can abort unwanted responses

**Shortcuts**:
- `Ctrl+C`: Abort streaming (when active)
- `Esc`: Abort streaming (when active)

**Priority**: P0 (Critical)

---

# Part 10: Multi-Client Advanced Scenarios

## 📋 Problem Statement

Multi-client support requires handling:
1. **Late joins** (event replay)
2. **Selective delivery** (right events to right clients)
3. **Event persistence** (replay after restart)
4. **Conflict resolution** (rare but possible)

---

## 👤 User Stories - Multi-Client Advanced

### UC78: Event Replay for Late Joiners

**As a** user
**I want** late-joining clients to receive recent events
**So that** they can catch up to current state

**Acceptance Criteria**:
- Replay last N events (configurable)
- Cursor-based pagination for history
- Filtered by channel subscription
- Efficient (no full event log scan)

**Priority**: P1 (High)

---

### UC79: Event Persistence

**As the** system
**I want to** persist events to database
**So that** they can be replayed after server restart

**Acceptance Criteria**:
- SQLite storage for events
- TTL-based cleanup (e.g., 24 hours)
- Efficient read by cursor
- Supports multiple channels

**Priority**: P1 (High)

---

### UC80: Session List Sync Edge Cases

**As a** user with multiple clients
**I want** session list to handle edge cases correctly
**So that** I don't see stale or duplicate data

**Edge Cases**:
- Session deleted in one client → removed from all clients
- Session title updated → propagates to all clients
- New session created → appears in all clients
- Network reconnect → resync without duplicates

**Priority**: P1 (High)

---

# Part 11: Configuration & Settings

## 📋 Problem Statement

Users need persistent configuration for:
1. **Global defaults** (provider, model, agent, rules)
2. **Tool display** preferences
3. **Notification** preferences
4. **Security** (credential management)

---

## 👤 User Stories - Configuration

### UC81: Global AI Configuration

**As a** user
**I want** global defaults for AI settings
**So that** new sessions use my preferences

**Configuration File**: `.sylphx-code/ai.json`

**Settings**:
- `defaultProvider`: Default AI provider
- `defaultModel`: Default model
- `defaultAgentId`: Default agent
- `defaultEnabledRuleIds`: Default rules
- Provider configs (without secrets)

**Acceptance Criteria**:
- Auto-created on first run
- JSON format (human-editable)
- Validated on load
- Reloaded on file change

**Priority**: P0 (Critical)

---

### UC82: Credential Storage

**As a** user
**I want** secure storage for API keys
**So that** my credentials are protected

**Storage Locations**:
- Global: `~/.sylphx-code/credentials.json`
- Project: `.sylphx-code/credentials.local.json` (gitignored)

**Acceptance Criteria**:
- File permissions 600 (read/write owner only)
- Multiple credentials per provider
- Label and expiration tracking
- Default credential selection

**Priority**: P0 (Critical)

---

### UC83: Tool Display Settings

**As a** user
**I want to** configure how tool results appear
**So that** I can control output verbosity

**Settings**:
- Show/hide tool inputs
- Show/hide tool outputs
- Collapse/expand by default

**Acceptance Criteria**:
- Stored in ai.json
- Applied to all sessions
- Can override per tool type

**Priority**: P2 (Medium)

---

### UC84: Notification Preferences

**As a** user
**I want to** control notification behavior
**So that** I'm not disturbed unnecessarily

**Settings**:
- Enable OS notifications
- Enable terminal bell
- Enable sound effects
- Notify on completion/error only

**Acceptance Criteria**:
- Platform-specific implementation
- Test notification available
- Respects system DND mode (optional)

**Priority**: P2 (Medium)

---

# Part 12: Admin & Debug Features

## 📋 Problem Statement

Administrators and developers need:
1. **System statistics** for monitoring
2. **Health checks** for uptime monitoring
3. **Debug logs** for troubleshooting
4. **Dangerous operations** (delete all, reset)

---

## 👤 User Stories - Admin & Debug

### UC85: Delete All Sessions

**As an** administrator
**I want to** delete all sessions at once
**So that** I can reset the system

**Acceptance Criteria**:
- Admin-only operation
- Confirmation required (dangerous)
- Cascades to all related data
- Broadcasts event to all clients

**Priority**: P3 (Low)

---

### UC86: System Statistics

**As an** administrator
**I want to** view system statistics
**So that** I can monitor usage

**Statistics**:
- Total sessions
- Total messages
- Active sessions
- Storage usage

**Acceptance Criteria**:
- Fast query (< 100ms)
- Real-time updates
- Export to JSON

**Priority**: P3 (Low)

---

### UC87: Health Check

**As a** monitoring system
**I want to** check application health
**So that** I can detect outages

**Health Metrics**:
- Server uptime
- Memory usage
- Database connectivity
- Event stream status

**Acceptance Criteria**:
- HTTP endpoint `/api/health`
- Returns 200 if healthy
- Returns 503 if degraded
- Includes metrics in response

**Priority**: P2 (Medium)

---

### UC88: API Inventory

**As a** security auditor
**I want to** view all API endpoints
**So that** I can assess attack surface

**Acceptance Criteria**:
- Lists all tRPC endpoints
- Shows procedure type (query/mutation/subscription)
- Shows input/output schemas
- OWASP API9 compliance (API Inventory)

**Priority**: P3 (Low)

---

### UC89: Debug Logs Viewer

**As a** developer
**I want to** view application logs
**So that** I can troubleshoot issues

**Acceptance Criteria**:
- Tail recent logs (last 100 lines)
- Filter by level (debug/info/warn/error)
- Search log content
- Auto-refresh option

**Priority**: P2 (Medium)

---

# Part 13: Advanced Features

## 📋 Problem Statement

Advanced users need:
1. **MCP server integration** for custom tools
2. **Rate limiting** to prevent abuse
3. **Context warnings** for token management
4. **Custom hooks** for extensibility

---

## 👤 User Stories - Advanced Features

### UC90: MCP Server Support

**As a** power user
**I want to** connect to MCP servers
**So that** I can extend the AI with custom tools

**Acceptance Criteria**:
- Configure MCP servers in config
- Tools from MCP servers available to AI
- Multiple MCP servers supported
- Server lifecycle management (start/stop)
- Error handling for server failures

**Priority**: P2 (Medium)

---

### UC91: Rate Limiting

**As the** system
**I want to** rate-limit API requests
**So that** I can prevent abuse and ensure fair usage

**Limits**:
- Strict: 10 req/min (create/delete operations)
- Moderate: 30 req/min (update operations)
- Streaming: 5 concurrent streams

**Acceptance Criteria**:
- Per-user limits (future: per-IP)
- 429 status code on limit exceeded
- Retry-After header
- Configurable limits

**Priority**: P1 (High)

---

### UC92: System Message Triggers

**As the** system
**I want to** inject system messages at appropriate times
**So that** the AI can respond to system events

**Triggers**:
- Context warning (80%, 90% usage)
- Resource warnings (memory, CPU)
- Error notifications

**Acceptance Criteria**:
- Hook-based trigger system
- Bidirectional (enter/exit states)
- Flag-based to avoid duplicates
- User-visible in message history

**Priority**: P2 (Medium)

---

# Testing & Quality

## 🧪 Overall Testing Strategy

### Test Coverage Requirements
- P0 features: 100% coverage (critical path)
- P1 features: 80% coverage (high priority)
- P2 features: 50% coverage (medium priority)
- P3 features: 20% coverage (low priority)

### Test Types
1. **Unit Tests**: Individual functions, pure logic
2. **Integration Tests**: tRPC endpoints, database operations
3. **E2E Tests**: Full user workflows
4. **Multi-Client Tests**: Event synchronization
5. **Performance Tests**: Token calculation speed, event latency

---

## ⚡ Performance Requirements

### PR-1: Token Calculation Speed
**Requirement**: Token calculations MUST complete fast enough for real-time UX.

**Targets**:
- StatusBar initial render: < 100ms
- StatusBar update after state change: < 100ms
- `/context` command response: < 200ms
- Streaming delta update: < 50ms

**Why**:
- Anything slower feels laggy
- User workflow interrupted

**User Feedback**:
> "base context 可以實時計，tokenizer其實好快，因為native code 黎，wasm黎"
>
> Translation: "base context can be calculated in real-time, tokenizer is actually fast, because it's native code, WASM"

---

### PR-2: Multi-Client Event Latency
**Requirement**: Events MUST propagate to all clients within acceptable time.

**Target**: < 500ms from event publish to client update

**Why**:
- Real-time collaboration feels broken if delayed
- 500ms is perceptible but acceptable

---

### PR-3: Streaming Response Latency
**Requirement**: Streaming text MUST appear with minimal delay.

**Target**: < 100ms from server receive to client display

**Why**:
- Real-time streaming feels broken if delayed
- User perception of system responsiveness

---

### PR-4: File Attachment Performance
**Requirement**: File attachments MUST not block UI.

**Targets**:
- Small files (<1MB): < 200ms to attach
- Medium files (1-5MB): < 1s to attach
- Large files (5-10MB): < 3s to attach

**Why**:
- File attachment is synchronous operation
- User waits for completion before sending

---

## 📊 Success Metrics

### User Experience Metrics
- **Consistency**: 100% SSOT compliance (StatusBar = /context)
- **Responsiveness**: 95% of operations < 100ms
- **Reliability**: 99.9% uptime
- **User Satisfaction**: No complaints about incorrect data

### Technical Metrics
- **Token Calculation**: p95 < 100ms
- **Event Latency**: p95 < 500ms
- **Multi-Client Sync**: 100% event delivery
- **API Response Time**: p95 < 200ms

---

## 🎓 Key Principles

### Principle 1: Volatility Over Caching
**User Quote**:
> "所有其他usages都係動態"
>
> Translation: "All other usages are dynamic"

**Meaning**: Token counts are fundamentally volatile, not cacheable.

---

### Principle 2: Real-Time Notifications
**User Quote**:
> "反正有任何異動都要即刻通知client去實時更新"
>
> Translation: "Any changes must immediately notify client for real-time updates"

**Meaning**: Event-driven architecture, not polling.

---

### Principle 3: Tokenizer Dependency
**User Quote**:
> "轉model就會轉tokenizer (auto tokenizer會根據model去推斷用咩tokenizer)"
>
> Translation: "Changing model changes tokenizer (auto tokenizer infers which tokenizer based on model)"

**Meaning**: Model = Tokenizer = Token counts are coupled.

---

### Principle 4: Zero-Knowledge Security
**Principle**: Client must NEVER have access to API keys.

**Rationale**: Prevents XSS attacks, credential theft, accidental exposure.

---

### Principle 5: Multi-Client First
**Principle**: All features must work correctly with multiple concurrent clients.

**Rationale**: Common workflow, prevents race conditions and stale data.

---

## 📝 Open Questions

### Q1: Intermediate Checkpoints
**Question**: How often should we recalculate tokens during long streaming responses?

**Options**:
- Every step completion ✅ (current)
- Every N seconds
- Only on final completion

**Trade-offs**: Accuracy vs performance

---

### Q2: Error Handling UX
**Question**: What should StatusBar show if token calculation fails?

**Options**:
- Show "Error" badge
- Show last known value with warning ✅
- Hide token display entirely

**User Impact**: Error UX

---

### Q3: Historical Sessions
**Question**: Should we support viewing old sessions with accurate token counts?

**Context**: Old sessions might have been created with different agent/rules/model

**Options**:
- Recalculate on demand (current state) ✅
- Store snapshot at creation time (historical state)
- Don't support historical accuracy

**Trade-offs**: Accuracy vs complexity

---

### Q4: MCP Server Discovery
**Question**: Should MCP servers be auto-discovered or manually configured?

**Options**:
- Auto-discover from standard locations
- Manual configuration only ✅ (current)
- Hybrid (discover + override)

**Trade-offs**: Convenience vs security

---

### Q5: Notification Sound Customization
**Question**: Should users be able to customize notification sounds?

**Options**:
- Built-in sounds only ✅ (current)
- User-provided sound files
- No sound (visual only)

**Trade-offs**: Flexibility vs complexity

---

## 🔗 Related Documents

- Implementation: (TBD - to be written after architecture solidifies)
- API Reference: (TBD)
- Testing Guide: (TBD)
- MCP Integration Guide: (TBD)
- Security Best Practices: (TBD)

---

## 📅 Feature Priority Summary

### P0 (Critical) - 42 features
Must work correctly for basic functionality:
- All streaming features (UC1-5)
- Session management core (UC15-16, UC21)
- Message operations core (UC22-23, UC27)
- Agent & rules management (UC31, UC33)
- Provider & model (UC35-37, UC39)
- Token calculation core (UC41-44)
- Key slash commands (UC51-56)
- File operations tools (UC64-67, UC69-70)
- Text editing (UC74-75, UC77)
- Global configuration (UC81-82)

### P1 (High) - 28 features
Important for good UX:
- Session title generation (UC19)
- Session list sync (UC21)
- File attachments (UC24-25)
- Message history (UC28-30)
- Custom agents/rules (UC32, UC34)
- Credential management (UC38)
- Token updates (UC45-47)
- Slash commands (UC50, UC57-58)
- Background shells (UC68)
- Ask tool (UC71)
- Todo management (UC72)
- Keyboard shortcuts (UC73)
- Event replay (UC78-80)
- Rate limiting (UC91)

### P2 (Medium) - 15 features
Nice to have:
- Model availability (UC20)
- Image display (UC26)
- Context warnings (UC49)
- Settings commands (UC59-60)
- Admin features (UC87, UC89-90, UC92)
- Message history nav (UC76)
- Tool display (UC83)
- Notifications (UC84)

### P3 (Low) - 7 features
Future enhancements:
- Survey (UC63)
- Logs command (UC62)
- Admin stats (UC85-86, UC88)

---

## 📊 Summary Statistics

**Total User Cases**: 92
- **Streaming**: 5 UC (UC1-5)
- **Session Management**: 7 UC (UC15-21)
- **Message Operations**: 9 UC (UC22-30)
- **Agent & Rules**: 4 UC (UC31-34)
- **Provider & Model**: 6 UC (UC35-40)
- **Token Calculation**: 9 UC (UC41-49)
- **Slash Commands**: 14 UC (UC50-63)
- **AI Tools**: 9 UC (UC64-72)
- **Keyboard Shortcuts**: 5 UC (UC73-77)
- **Multi-Client Advanced**: 3 UC (UC78-80)
- **Configuration**: 4 UC (UC81-84)
- **Admin & Debug**: 5 UC (UC85-89)
- **Advanced Features**: 3 UC (UC90-92)

**Total Requirements**: 7 (R1.1-1.3, R2.1-2.4)
**Total Performance Requirements**: 4 (PR-1 to PR-4)
**Total Test Cases**: 5 streaming tests + ongoing additions

---

## 📅 Revision History

- **v1.0** (2025-01-XX): Initial token calculation specification
- **v2.0** (2025-01-XX): Complete system coverage - 92 user stories across all features
