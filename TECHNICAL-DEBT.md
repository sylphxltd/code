# Technical Debt Inventory

**Date:** 2024 (Post ai-sdk.ts removal)
**Status:** Baseline assessment before next major feature

---

## 🎯 Summary

After successfully removing `ai-sdk.ts` wrapper and improving type safety in `streaming.service.ts`, we have:

- ✅ **streaming.service.ts**: Zero `as any` - Full type safety with AI SDK v5
- ⚠️ **Production code**: 28 remaining `as any` casts (excluding tests)
- 📝 **TODOs**: 15+ documented action items
- ⚠️ **Build warnings**: 3 TypeScript warnings in production code

---

## 📊 Type Safety Issues

### High Priority: Context Initialization (`code-server/src/context.ts`)

**Pattern**: `null as any` for circular dependency resolution

```typescript
let eventStream: AppEventStream = null as any;
let ruleManagerService: RuleManagerService = null as any;
let agentManagerService: AgentManagerService = null as any;
```

**Impact**:
- Masks potential null pointer errors at runtime
- Loses TypeScript safety benefits in initialization phase

**Solution Options**:
1. Use explicit `undefined` with proper null checks
2. Refactor to eliminate circular dependencies
3. Use lazy initialization pattern with getters

---

### Medium Priority: Utility Type Coercion

#### process-manager.ts
```typescript
process.removeListener(signal as any, handler);
(manager as any)._cleanup = cleanup;
```
**Issue**: Node.js signal types and private field access
**Fix**: Use proper Node.js types, avoid private field mutation

#### prompts.ts
```typescript
(stdin as any).removeListener("data", _onData);
```
**Issue**: Missing type definitions for stdin.removeListener
**Fix**: Import proper types from @types/node or declare module augmentation

#### session-manager.ts
```typescript
const rawSession = JSON.parse(content) as any;
```
**Issue**: Unsafe JSON parsing without validation
**Fix**: Use zod schema validation after parse

---

### Low Priority: Generic Utilities

#### functional/object.ts
```typescript
result[key] = deepMerge(targetValue, sourceValue as any);
return obj.map(clone) as any;
```
**Issue**: Generic function type inference limitations
**Status**: May be acceptable for utility functions, but worth review

---

## 📝 Documented TODOs

### 1. **Duration Tracking** (streaming.service.ts)
```typescript
// Line 442, 954: duration: 0, // TODO: track duration
```
**Current**: Hardcoded 0 for tool call duration
**Action**: Implement proper timing for tool execution
**Priority**: Medium - Would improve observability

---

### 2. **Credential Encryption** (Multiple files)
```typescript
// credential.types.ts:39
/** API key or secret (currently plaintext, TODO: add encryption) */

// credential-manager.ts:12
* TODO: Add encryption layer for production use.

// credential-registry.ts:8
* TODO: Add encryption layer (AES-256-GCM) for production use.
```
**Status**: Documented security concern
**Priority**: High for production deployment
**Action Required**: Implement AES-256-GCM encryption before production

---

### 3. **FTS5 Search** (file-repository.ts:156)
```typescript
// TODO: Implement FTS5 search when virtual table is created
```
**Status**: Feature not yet implemented
**Priority**: Low - works without FTS5, but would improve search performance

---

### 4. **Progress Streaming** (session.router.ts:286, 292)
```typescript
// Compact session with progress tracking (TODO: stream progress via subscription)
// TODO: Emit progress events for real-time updates
```
**Status**: Compaction works, but no real-time progress updates
**Priority**: Low - UX improvement, not critical functionality

---

### 5. **API Inventory Auto-generation** (utils/api-inventory.ts:27)
```typescript
* TODO: Auto-generate from tRPC router introspection
```
**Status**: Manual maintenance required
**Priority**: Low - automation would reduce maintenance burden

---

## ⚠️ Build Warnings

### 1. Missing Return Type (streaming.service.ts:176)
```
TS9007: Function requires an explicit return type
export function streamAIResponse(opts: StreamAIResponseOptions)
```
**Fix**: Add explicit return type annotation

---

### 2. Missing Type Annotation (trpc/routers/index.ts:18)
```
TS9010: Variable requires an explicit type annotation
export const appRouter = router({
```
**Fix**: Add explicit type `AppRouter` from tRPC

---

### 3. Optional Parameter Issue (app-event-stream.service.ts:35)
```
TS9025: Parameter can implicitly be `undefined`
private persistence?: EventPersistence,
```
**Fix**: Change to `persistence: EventPersistence | undefined`

---

## 🎯 Prioritized Action Plan

### Phase 1: Quick Wins (1-2 hours)
1. ✅ Fix build warnings (3 issues)
2. Fix duration tracking TODOs in streaming.service.ts
3. Add return type annotations to exported functions

### Phase 2: Type Safety (2-4 hours)
1. Refactor context.ts initialization pattern
2. Fix utility type coercion issues (process-manager, prompts, session-manager)
3. Add zod validation to JSON.parse calls

### Phase 3: Security (Before Production)
1. Implement credential encryption (AES-256-GCM)
2. Review all credential handling code
3. Add security audit documentation

### Phase 4: Enhancements (Future)
1. Implement FTS5 search in file repository
2. Add progress streaming to compact operation
3. Auto-generate API inventory from tRPC

---

## 📈 Metrics

### Current State
- **Type Safety Score**: ~85% (28 `as any` in 38 files)
- **Build Warnings**: 3
- **Documented TODOs**: 15+
- **Test Coverage**: Not measured (needs separate audit)

### Target State (Before Next Major Feature)
- **Type Safety Score**: ~95% (< 5 `as any`, only in justified cases)
- **Build Warnings**: 0
- **Documented TODOs**: 0 critical, < 5 enhancement
- **Test Coverage**: > 70% for critical paths

---

## 🔄 Process Notes

### When to Accept `as any`
1. **Node.js API limitations**: When @types/node is insufficient
2. **Third-party library gaps**: When external libraries lack proper types
3. **Generic utilities**: When type inference is truly impossible
4. **Test fixtures**: When mocking requires type override

### When to Reject `as any`
1. **Business logic**: Never in domain code
2. **Data validation**: Use zod/io-ts instead
3. **Circular deps**: Refactor architecture instead
4. **Lazy typing**: Always investigate proper solution first

---

## Next Steps

Start with **Phase 1: Quick Wins** to fix build warnings and simple TODOs before tackling larger refactoring work.
