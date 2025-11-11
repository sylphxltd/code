# System Message Architecture Analysis

## Current Problem

### Issue
- System messages are checked **only once** before streaming starts
- If a user sends "understand this project" → 100+ tool calls
- During those 100 steps, context or resources can become critical
- But LLM won't know until the **next user message**

### Current Flow
```
User Message
  ↓
checkAllTriggers() ← Only checks here
  ↓
Create Assistant Message (step-0)
  ↓
createAIStream() → processStream() → 100+ tool calls
  ↓
Complete step-0
  ↓
Next User Message ← Too late!
```

## Current Architecture

### Single-Step Per Message
- Each assistant message has only **one step** (step-0)
- All streaming (text + 100 tool calls) happens in that single step
- No opportunity to inject system messages mid-stream

### Two Types of Messages
1. **Session Message** (UI layer) - displayed to user, flexible format
2. **Model Message** (AI SDK) - sent to LLM, fixed format (role/content)

## Solution Options

### Option A: Multi-Step Architecture (Recommended)

Transform to true multi-step design (aligned with AI SDK):

```typescript
// Streaming loop with multiple steps
let stepIndex = 0;
let shouldContinue = true;

while (shouldContinue && stepIndex < MAX_STEPS) {
  // 1. Create new step
  const stepId = `${messageId}-step-${stepIndex}`;
  await createMessageStep(db, messageId, stepIndex);

  // 2. Build messages (include all previous steps + system messages)
  const messages = await buildModelMessages(session.messages);

  // 3. Stream this step
  const stream = createAIStream({ model, messages, system });
  const result = await processStream(stream);

  // 4. Save step results
  await updateStepParts(stepId, result.messageParts);
  await completeMessageStep(stepId, {
    status: 'completed',
    usage: result.usage,
    finishReason: result.finishReason
  });

  // 5. Check if should continue
  shouldContinue = result.finishReason === 'tool-calls' && hasMoreWork(result);

  // 6. ⭐ CHECK TRIGGERS BETWEEN STEPS
  if (shouldContinue) {
    // Reload session with updated context
    const updatedSession = await sessionRepository.getSessionById(sessionId);

    // Calculate context usage (accumulate tokens from all messages)
    const contextTokens = calculateContextTokens(updatedSession);

    // Check all triggers
    const triggerResults = await checkAllTriggers(
      updatedSession,
      messageRepository,
      sessionRepository,
      contextTokens
    );

    // Insert system messages if any triggers fired
    for (const triggerResult of triggerResults) {
      await insertSystemMessage(messageRepository, sessionId, triggerResult.message);

      // Emit event for UI
      observer.next({
        type: 'system-message-created',
        messageId: systemMessageId,
        content: triggerResult.message
      });
    }

    // Reload session again to include system messages in next step
    session = await sessionRepository.getSessionById(sessionId);
  }

  stepIndex++;
}
```

#### Pros
- ✅ True multi-step architecture (matches AI SDK design)
- ✅ Can check triggers **between steps**
- ✅ LLM sees system messages in **subsequent steps**
- ✅ Naturally solves long-running task problems
- ✅ Enables advanced agent behaviors (planning, reflection)

#### Cons
- ❌ Requires refactoring streaming.service.ts
- ❌ Need to handle multi-step UI display
- ❌ Increased complexity

#### When to Create New Step
```typescript
function shouldContinueToNextStep(result: StreamResult): boolean {
  // Continue if:
  // 1. Finish reason is tool-calls (LLM wants to continue)
  // 2. Has tool calls that modified state
  // 3. Not just read-only operations

  if (result.finishReason !== 'tool-calls') {
    return false;
  }

  // Check if tools did meaningful work
  const toolParts = result.messageParts.filter(p => p.type === 'tool');
  const hasWrites = toolParts.some(t =>
    ['Write', 'Edit', 'Bash'].includes(t.name)
  );

  return hasWrites;
}
```

### Option B: Mid-Stream Hints (Quick Fix)

Keep current single-step, but add "system hints" during streaming:

```typescript
// Inside processStream()
let toolCallCount = 0;
const CHECK_INTERVAL = 10; // Check every 10 tool calls

for await (const chunk of stream) {
  // ... process chunks

  if (chunk.type === 'tool-call') {
    toolCallCount++;

    // Periodic check during long streams
    if (toolCallCount % CHECK_INTERVAL === 0) {
      // Quick trigger check (simplified, no DB writes)
      const warnings = await quickTriggerCheck(contextTokens, resourceUsage);

      if (warnings.length > 0) {
        // Add system-hint parts (visible to user, NOT to LLM)
        for (const warning of warnings) {
          messageParts.push({
            type: 'system-hint',  // New type
            content: warning.message,
            status: 'completed'
          });

          // Emit event for UI
          observer.next({
            type: 'system-hint',
            content: warning.message
          });
        }
      }
    }
  }
}
```

#### Pros
- ✅ Minimal changes to existing code
- ✅ Can implement immediately
- ✅ User sees warnings in real-time

#### Cons
- ❌ LLM **doesn't see** these hints (stream already in progress)
- ❌ Only for user visibility, doesn't affect LLM behavior
- ❌ Can't inject into model messages
- ❌ Not a real solution, just UX improvement

### Option C: Hybrid Approach

Use both message-level and step-level system messages:

#### Message-Level (existing)
- **When**: Session start, after compact, between user messages
- **Format**: `role='system'` message in database
- **Use cases**:
  - Session start todos
  - Compact summary
  - Initial warnings

#### Step-Level (new - with Option A)
- **When**: Between steps during long streaming
- **Format**: System message inserted before next step
- **Use cases**:
  - Mid-execution context warnings
  - Resource alerts during long tasks
  - Dynamic guidance

```typescript
// Message-level: No step, standalone system message
{
  id: 'msg-system-123',
  role: 'system',
  content: [{ type: 'text', content: 'Session started...', status: 'completed' }],
  timestamp: 12345,
  steps: [],  // No steps for session-level messages
}

// Step-level: Part of assistant message flow
{
  id: 'msg-assistant-456',
  role: 'assistant',
  steps: [
    { stepIndex: 0, parts: [{ type: 'text', content: 'Let me analyze...' }] },
    // System message inserted here as separate message
    { stepIndex: 1, parts: [{ type: 'text', content: 'Continuing...' }] }
  ]
}
```

## ✅ IMPLEMENTED: Hybrid Approach (Option C)

### Current Implementation

**Hybrid Architecture** - Both message-level and step-level system messages:

#### Message-Level System Messages
- **Format**: `role = 'system'` standalone message in database
- **Use cases**:
  - Session start (todos, reminders)
  - After compact (summary context)
  - Between user messages
- **Timing**: Checked **before** streaming starts

#### Step-Level System Messages
- **Format**: Injected into model messages during `onPrepareMessages` hook
- **Use cases**:
  - Context warnings during long operations
  - Resource alerts mid-execution
  - Dynamic guidance between AI steps
- **Timing**: Checked **between** AI SDK steps (step 1, 2, 3...)

### Implementation Details

```typescript
// streaming.service.ts
const stream = createAIStream({
  model,
  messages,
  system: systemPrompt,
  // ⭐ NEW Hook
  onPrepareMessages: async (messages, stepNumber) => {
    if (stepNumber === 0) return messages; // Skip initial step

    // 1. Reload session (includes tool results from previous step)
    const session = await sessionRepository.getSessionById(sessionId);

    // 2. Calculate context tokens
    const contextTokens = calculateContextTokens(session);

    // 3. Check all triggers
    const triggerResults = await checkAllTriggers(session, ...);

    // 4. Insert system messages if triggers fired
    if (triggerResults.length > 0) {
      for (const trigger of triggerResults) {
        await insertSystemMessage(messageRepository, sessionId, trigger.message);
      }

      // 5. Rebuild model messages (includes new system messages)
      const refreshedSession = await sessionRepository.getSessionById(sessionId);
      return await buildModelMessages(refreshedSession.messages);
    }

    return messages;
  }
});
```

### Benefits

- ✅ **LLM Awareness**: LLM sees and responds to system messages
- ✅ **Real-time**: Warnings appear during long operations (100+ steps)
- ✅ **Flexible**: Supports both session-level and runtime scenarios
- ✅ **Efficient**: Only checks when needed (between steps with tool calls)

### Flow Diagram

```
User Message "understand this project"
  ↓
checkAllTriggers() ← Message-level check
  ↓ (Insert session-start system message if needed)
Create Assistant Message
  ↓
Stream Step 0
  ├─ Tool: Read file A
  ├─ Tool: Read file B
  ├─ Tool: Read file C
  └─ finishReason: 'tool-calls'
  ↓
onPrepareMessages(step 1) ← Step-level check
  ↓ (Memory usage 85%)
Insert system message: "⚠️ Memory Warning"
  ↓
Stream Step 1 (LLM sees memory warning)
  ├─ Text: "I notice memory is high, I'll be careful..."
  ├─ Tool: Process data (smaller chunks)
  └─ finishReason: 'tool-calls'
  ↓
onPrepareMessages(step 2) ← Check again
  ↓ (Context usage 82%)
Insert system message: "⚠️ Context Warning"
  ↓
Stream Step 2 (LLM sees context warning)
  ├─ Text: "Context is filling up, I'll summarize findings..."
  └─ finishReason: 'stop'
  ↓
Complete
```

## Implementation Priority

1. **Immediate** (this week): Option B
   - Add system-hint message part type
   - Periodic trigger checks in processStream()
   - UI display for hints

2. **Short-term** (next sprint): Option A foundation
   - Multi-step loop structure
   - Step boundary trigger checks
   - Basic multi-step UI

3. **Long-term** (next month): Option C polish
   - Optimize trigger logic
   - Advanced step continuati
on rules
   - Performance tuning

## Open Questions

1. **Step Continuation Rules**: When to create new step vs complete?
   - After every tool-calls finish reason?
   - Only after "meaningful" tool calls (writes)?
   - Configurable threshold?

2. **UI Display**: How to show multi-step messages?
   - Collapse all steps into one visual message?
   - Show step boundaries explicitly?
   - Group by reasoning phases?

3. **Context Calculation**: When to calculate tokens?
   - After every step? (expensive)
   - Only when close to limit? (sampling)
   - Cache and invalidate? (complex)

4. **Max Steps**: What's the safety limit?
   - 10 steps? 20 steps?
   - Configurable per agent?
   - Dynamic based on complexity?
