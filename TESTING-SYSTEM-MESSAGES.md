# Testing System Messages

This guide shows how to test the system message functionality.

## Method 1: TEST_MODE Environment Variable (Easiest)

Lowers all thresholds to 10-20% so warnings trigger easily.

```bash
# Start app in test mode
TEST_MODE=1 npm start

# Or for specific package
cd packages/code
TEST_MODE=1 npm start
```

**What happens:**
- Context warning triggers at 10% instead of 80%
- Resource warnings trigger at 10% instead of 80%
- Test trigger is enabled (see Method 2)

**To test:**
1. Start app with `TEST_MODE=1`
2. Send a message: "understand this project"
3. After a few tool calls, context will reach 10%
4. You should see system messages appear between steps

---

## Method 2: Manual Test Trigger (TEST_MODE only)

Manually trigger a test system message.

**Setup:**
```bash
# 1. Start app in TEST_MODE
TEST_MODE=1 npm start

# 2. Start a new session
# 3. Set the test flag manually
```

**Trigger test message:**

You need to set `session.flags.testSystemMessage = true`, then send a message with multiple tool calls.

**Using SQLite directly:**
```bash
# Find your session ID
sqlite3 ~/.sylphx-code/code.db "SELECT id, title FROM sessions ORDER BY updated DESC LIMIT 5;"

# Set the test flag
sqlite3 ~/.sylphx-code/code.db "UPDATE sessions SET flags = json_set(COALESCE(flags, '{}'), '$.testSystemMessage', 1) WHERE id = 'YOUR_SESSION_ID';"

# Verify
sqlite3 ~/.sylphx-code/code.db "SELECT id, flags FROM sessions WHERE id = 'YOUR_SESSION_ID';"
```

**Then:**
1. Send a message that triggers multiple tool calls
2. Test message will appear on step 1
3. Check the UI and database to verify

---

## Method 3: Inspect Existing Sessions (If you have long sessions)

If you have sessions with high context usage:

```bash
# Check session context
sqlite3 ~/.sylphx-code/code.db "
  SELECT
    s.id,
    s.title,
    COUNT(m.id) as message_count,
    SUM(COALESCE(json_extract(m.usage, '$.totalTokens'), 0)) as total_tokens,
    s.flags
  FROM sessions s
  LEFT JOIN messages m ON m.session_id = s.id
  GROUP BY s.id
  ORDER BY total_tokens DESC
  LIMIT 10;
"

# Check if any steps have system messages
sqlite3 ~/.sylphx-code/code.db "
  SELECT
    ms.id,
    ms.message_id,
    ms.step_index,
    ms.system_messages
  FROM message_steps ms
  WHERE ms.system_messages IS NOT NULL;
"
```

---

## Method 4: Force Context Warning with Small Model

Use a model with very small context window:

```bash
# Use a model with 8k context (if available)
# Then load many files until you hit 80%

# Example:
TEST_MODE=1 npm start

# In chat:
"read all files in src/ recursively"
```

---

## Method 5: Create Test Scenario Script

Create a script that simulates high usage:

```typescript
// test-system-messages.ts
import { SessionRepository } from '@sylphx/code-core';

async function testSystemMessages() {
  const repo = new SessionRepository(db);
  const sessionId = 'test-session';

  // Create session
  await repo.createSession({ id: sessionId, /* ... */ });

  // Simulate high context by creating many messages
  for (let i = 0; i < 100; i++) {
    await repo.addMessage(sessionId, 'user', `Message ${i}`, /* ... */);
    await repo.addMessage(sessionId, 'assistant', `Response ${i}`, /* ... */);
  }

  // Now send a real message - should trigger context warning
  console.log('Session ready. Send a message to trigger warnings.');
}
```

---

## Verification Steps

After triggering system messages, verify:

### 1. Database Check
```bash
# Check if step has system messages
sqlite3 ~/.sylphx-code/code.db "
  SELECT
    ms.id,
    ms.step_index,
    ms.system_messages
  FROM message_steps ms
  WHERE ms.system_messages IS NOT NULL
  ORDER BY ms.id DESC
  LIMIT 5;
"
```

**Expected output:**
```json
[
  {
    "type": "context-warning-80",
    "content": "⚠️ Context Warning...",
    "timestamp": 1699999999999
  }
]
```

### 2. Console Check

Look for these logs:

```
🔄 [onPrepareMessages] Step 1: Checking triggers
[TriggerRegistry] Trigger fired: context-80-warning
🔄 [onPrepareMessages] 1 trigger(s) fired
🔄 [onPrepareMessages] Created step-1 with 1 system messages
🔄 [onPrepareMessages] Injecting 1 system messages into model messages
```

### 3. UI Check

In the UI, you should see between steps:
```
Write(...)
  ⚠️ Context 80%
Read(...)
```

Or whatever UI display you implemented.

### 4. LLM Response Check

The LLM should acknowledge the warning in its response:
```
"I notice the context is getting high. Let me summarize..."
```

---

## Quick Test Commands

```bash
# 1. Start in test mode
TEST_MODE=1 npm start

# 2. Send message with many tool calls
# In chat: "analyze the entire codebase and list all files"

# 3. Check database
sqlite3 ~/.sylphx-code/code.db "
  SELECT
    ms.step_index,
    ms.system_messages
  FROM message_steps ms
  JOIN messages m ON m.id = ms.message_id
  WHERE m.role = 'assistant'
    AND ms.system_messages IS NOT NULL
  ORDER BY m.timestamp DESC
  LIMIT 1;
"

# 4. Check session flags (should see contextWarning80: true)
sqlite3 ~/.sylphx-code/code.db "
  SELECT id, flags
  FROM sessions
  ORDER BY updated DESC
  LIMIT 1;
"
```

---

## Expected Results

When system messages trigger correctly:

1. **Database**: `message_steps.system_messages` contains JSON array
2. **Logs**: See "Trigger fired" and "Created step with system messages"
3. **UI**: Displays warning between steps
4. **LLM**: Responds to the warning appropriately
5. **Flags**: Session flags updated (e.g., `contextWarning80: true`)

---

## Troubleshooting

**No triggers firing:**
- Check `TEST_MODE=1` is set
- Verify triggers are registered (check logs on startup)
- Ensure session has enough context/tool calls to reach threshold

**Triggers fire but no step created:**
- Check `onPrepareMessages` is called (logs show "Step X: Checking triggers")
- Verify `createMessageStep` is called successfully

**Step created but no UI display:**
- Check `step-created` event is emitted
- Verify UI subscribes to this event
- Check browser console for errors

**Database has messages but LLM doesn't respond:**
- Check `buildModelMessages` converts systemMessages to user role
- Verify model messages include the system message content
- Check LLM actually receives the messages (log before API call)

---

## Cleanup After Testing

```bash
# Remove TEST_MODE
unset TEST_MODE

# Or restart without TEST_MODE
npm start

# Reset test session flags
sqlite3 ~/.sylphx-code/code.db "
  UPDATE sessions
  SET flags = json_remove(flags, '$.testSystemMessage', '$.contextWarning80', '$.contextWarning90')
  WHERE json_extract(flags, '$.testSystemMessage') = 1;
"
```
