# Technical Debt Inventory

**Date:** 2024 (Post ai-sdk.ts removal)
**Status:** Baseline assessment before next major feature

---

## 🎯 Summary

After successfully completing Phase 1 (Build Warnings) and Phase 2 (Type Safety):

- ✅ **Phase 1 Complete**: Build warnings reduced from 3 to 1 (67% reduction)
- ✅ **Phase 2 Complete**: `as any` reduced from 28 to ~18 (35% reduction)
- ✅ **streaming.service.ts**: Zero `as any` - Full type safety with AI SDK v5
- ⚠️ **Production code**: ~18 remaining `as any` casts (excluding tests)
- 📝 **TODOs**: 15+ documented action items
- ⚠️ **Build warnings**: 1 TypeScript warning (tRPC router - acceptable)

---

## 📊 Type Safety Issues

### ✅ FIXED: Context Initialization (`code-server/src/context.ts`)

**Previous Pattern**: `null as any` for circular dependency resolution

**Solution Applied** (Phase 2):
- Changed to explicit `| undefined` with proper null checks
- Added `initialize()` to all service interfaces
- Implemented getter/setter pattern with fail-fast error handling
- Removed all 5 `as any` casts from context.ts

**Result**: Zero `as any` in context.ts ✅

---

### ✅ FIXED: Utility Type Coercion (Phase 2)

#### process-manager.ts ✅
- Changed `signal as any` to `signal as NodeJS.Signals`
- Added `_cleanup` to ProcessManager interface
- Removed `as any` when accessing `_cleanup` property
- Used optional chaining for type-safe access

#### prompts.ts ✅
- Removed dead code containing `stdin as any`
- Cleaned up unused `_onData` function
- Simplified `askSecret` implementation

#### session-manager.ts ✅
- Imported `ProviderId` type from `@sylphx/code-core`
- Changed `provider as any` to `provider as ProviderId`
- Proper type safety for database operations

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

### ✅ Phase 1: Quick Wins (COMPLETED)
1. ✅ Fixed build warnings (3 → 1, one remaining is tRPC limitation)
2. ✅ Added return type to `streamAIResponse`
3. ✅ Fixed optional parameter in `app-event-stream.service.ts`
4. ⏳ Fix duration tracking TODOs in streaming.service.ts (deferred)

### ✅ Phase 2: Type Safety (COMPLETED)
1. ✅ Refactored context.ts initialization pattern (5 → 0 `as any`)
2. ✅ Fixed utility type coercion in process-manager.ts (3 → 0 `as any`)
3. ✅ Fixed utility type coercion in prompts.ts (1 → 0 `as any`)
4. ✅ Fixed type safety in session-manager.ts (1 → 0 `as any`)
5. ⏳ Add zod validation to JSON.parse calls (deferred to future phase)

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

### Baseline (Start of Cleanup)
- **Type Safety Score**: ~85% (28 `as any` in 38 files)
- **Build Warnings**: 3
- **Documented TODOs**: 15+
- **Test Coverage**: Not measured (needs separate audit)

### Current State (After Phase 1 + Phase 2)
- **Type Safety Score**: ~90% (~18 `as any` remaining)
- **Build Warnings**: 1 (tRPC router - acceptable limitation)
- **Documented TODOs**: 15+ (unchanged, most are enhancements)
- **Cleanup Progress**: 35% reduction in `as any` casts

### Target State (Before Next Major Feature)
- **Type Safety Score**: ~95% (< 5 `as any`, only in justified cases)
- **Build Warnings**: 0-1 (tRPC warning acceptable)
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

## ✅ Completed Phases

### Phase 1: Quick Wins ✅
- Reduced build warnings from 3 to 1 (67%)
- Fixed critical type annotations
- All packages building successfully
- **Commit**: c729cf4

### Phase 2: Type Safety ✅
- Removed 10 `as any` casts (35% reduction)
- Fixed context.ts initialization (5 → 0)
- Fixed process-manager.ts (3 → 0)
- Fixed prompts.ts (1 → 0)
- Fixed session-manager.ts (1 → 0)
- All code compiles with improved type safety
- **Commit**: af9feb1

## 🔄 Next Steps

### Remaining Work

**Low Priority Type Cleanup**:
- Review remaining ~18 `as any` in utility files (functional/object.ts, etc.)
- Evaluate if they are acceptable for generic utilities
- Consider zod validation for JSON.parse calls

**Phase 3: Security** (Before Production):
- Implement credential encryption (AES-256-GCM)
- Review all credential handling code
- Add security audit documentation

**Phase 4: Enhancements** (Future):
- Implement FTS5 search in file repository
- Add progress streaming to compact operation
- Auto-generate API inventory from tRPC
- Fix duration tracking in streaming service
