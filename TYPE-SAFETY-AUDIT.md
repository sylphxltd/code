# Type Safety Audit & Refactoring Plan

**Date**: 2024
**Scope**: Complete codebase type safety cleanup based on 14 Strong Typing Principles

---

## 📊 Current State

### Statistics
- **Total TypeScript Files**: 302
- **`as any` / `as unknown`**: 34 occurrences
- **Unvalidated `JSON.parse()`**: 33 occurrences
- **Boolean flags** (should be discriminated unions): ~15 locations
- **Type Safety Score**: ~85% → Target: 95%+

---

## 🎯 Refactoring Principles (14-Point Checklist)

| # | Principle | Current Issues | Target |
|---|-----------|---------------|--------|
| 1 | **Type Inference** | Some explicit types | Maximize inference |
| 2 | **Use Library Types** | ✅ Already good | Maintain |
| 3 | **Illegal States** | Boolean flags exist | Use discriminated unions |
| 4 | **Discriminated Unions** | `success: boolean` patterns | Convert all |
| 5 | **Type Guards** | Some `as any` casts | Replace with guards |
| 6 | **Const Assertions** | Some missing | Add where needed |
| 7 | **Branded Types** | IDs are plain strings | Add branded types |
| 8 | **Narrow at Boundaries** | 33 unvalidated JSON.parse | Add zod validation |
| 9 | **Generic Constraints** | Some unconstrained | Add constraints |
| 10 | **Exhaustive Checking** | Missing in switches | Add never checks |
| 11 | **Template Literals** | Not used | Add for string validation |
| 12 | **Validate any/unknown** | 34 unsafe casts | Validate all |
| 13 | **Co-locate Types** | ✅ Already good | Maintain |
| 14 | **satisfies** | Not used much | Use more |

---

## 🔥 High Priority Issues (Phase 1)

### 1. Unvalidated `JSON.parse()` - 33 locations ⚠️

**Risk**: Runtime errors, type unsafety at system boundaries

**Locations**:
- `packages/code-core/src/utils/session-manager.ts:77` - Session data
- `packages/code-core/src/database/*` - Database responses
- Multiple config files

**Fix**: Add Zod schemas for all JSON.parse calls

```typescript
// Before
const data = JSON.parse(content) as any;

// After
import { z } from 'zod';

const SessionSchema = z.object({
  id: z.string(),
  provider: z.enum(['anthropic', 'openai', 'google']),
  model: z.string(),
});

const data = SessionSchema.parse(JSON.parse(content));
```

---

### 2. Boolean Flags → Discriminated Unions - ~15 locations ⚠️

**Problem**: Can represent illegal states

**Key Examples**:

#### A. SessionResult (session-manager.ts)
```typescript
// ❌ Current - Can have illegal states
export interface SessionResult {
  sessionId: string;
  isNewSession: boolean;  // sessionId exists but isNewSession=true?
}

// ✅ Fixed - Type-safe
export type SessionResult =
  | { type: 'existing'; sessionId: string }
  | { type: 'new'; sessionId: string; provider: ProviderId; model: string };
```

#### B. Tool Result Types
```typescript
// ❌ Current
interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

// ✅ Fixed
type ToolResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
```

**Files to update**:
- `packages/code-server/src/services/streaming/session-manager.ts`
- `packages/code-core/src/types/tool.types.ts`
- `packages/code-core/src/types/credential.types.ts`
- Database result types

---

### 3. Remove `as any` Casts - 34 locations ⚠️

**Current `as any` locations** (non-test):
```
packages/code-core/src/utils/functional/object.ts:139 - deepMerge
packages/code-core/src/utils/functional/object.ts:253 - clone
packages/code-core/src/ai/storage-factory.ts:86 - storageType
packages/code-core/src/ai/target-manager.ts:91 - target fallback
packages/code-core/src/utils/target-config.ts:184 - serverConfig
packages/code-core/src/utils/target-config.ts:186 - serverConfig.url
packages/code-core/src/utils/session-manager.ts:77 - JSON.parse
packages/code-core/src/utils/memory-tui.ts:157 - null placeholder
packages/code-core/src/ai/config-system.ts:232 - unknown source type
packages/code-core/src/ai/config-system.ts:344 - object traversal
```

**Fix Strategy**:
1. Add proper type guards
2. Use discriminated unions
3. Add zod validation at boundaries

---

## 🟡 Medium Priority (Phase 2)

### 4. Add Branded Types for IDs

**Problem**: `sessionId`, `userId`, `providerId` all just strings - easy to mix up

```typescript
// Add branded types
type SessionId = string & { readonly __brand: 'SessionId' };
type UserId = string & { readonly __brand: 'UserId' };
type MessageId = string & { readonly __brand: 'MessageId' };

// Helper functions
function createSessionId(id: string): SessionId {
  return id as SessionId;
}

function isSessionId(id: string): id is SessionId {
  // validation logic
  return id.startsWith('session_');
}
```

**Files to update**:
- `packages/code-core/src/types/*`
- All repository interfaces

---

### 5. Add Exhaustive Checking

**Problem**: Switch statements missing default cases

```typescript
// Add to all switch statements
default:
  const _exhaustive: never = type;
  throw new Error(`Unhandled type: ${_exhaustive}`);
```

**Locations**:
- `packages/code-core/src/ai/storage-factory.ts` - createStorage
- Message type handlers
- Event type handlers

---

### 6. Storage-Factory Type Safety

**Current Issue**:
```typescript
// packages/code-core/src/ai/storage-factory.ts:86
const config: StorageConfig = { type: storageType as any };
```

**Fix**:
```typescript
// Define proper discriminated union
type StorageConfig =
  | { type: 'memory' }
  | { type: 'cache'; defaultTTL?: number; maxCacheSize?: number }
  | { type: 'vector'; vectorDimensions?: number; connectionString?: string };

// Add type guard
function isValidStorageType(type: string): type is StorageConfig['type'] {
  return ['memory', 'cache', 'vector'].includes(type);
}

// Use it
const storageType = process.env.STORAGE_TYPE || 'memory';
if (!isValidStorageType(storageType)) {
  throw new Error(`Invalid storage type: ${storageType}`);
}
const config: StorageConfig = { type: storageType };
```

---

## 🟢 Low Priority (Phase 3)

### 7. Generic Utility Type Safety

**Files**:
- `packages/code-core/src/utils/functional/object.ts`
  - `deepMerge` - Add proper recursive type
  - `clone` - Add constraint

```typescript
// Before
function clone(obj: any): any {
  return obj.map(clone) as any;
}

// After
function clone<T extends object | unknown[]>(obj: T): T {
  if (Array.isArray(obj)) {
    return obj.map(clone) as T;
  }
  // ... proper implementation
}
```

---

### 8. Add Template Literal Types

**Use cases**:
- Validate model IDs: `${ProviderId}/${string}`
- Validate event types: `${string}:${string}`

```typescript
type ModelId = `${ProviderId}/${string}`;
type EventType = `${string}:${string}`;  // e.g., "session:created"
```

---

### 9. Increase `satisfies` Usage

**Pattern**: Use `satisfies` instead of type annotations

```typescript
// Before
const config: Config = { ... };

// After - keeps literal types
const config = { ... } satisfies Config;
```

---

## 📋 Implementation Plan

### Phase 1: Critical Safety Issues (Week 1)
- [ ] **Day 1-2**: Add Zod schemas for all JSON.parse (33 locations)
- [ ] **Day 3-4**: Convert boolean flags to discriminated unions (15 locations)
- [ ] **Day 5**: Remove high-impact `as any` casts (storage-factory, session-manager)

**Estimated Impact**: Type Safety 85% → 90%

---

### Phase 2: Type System Improvements (Week 2)
- [ ] **Day 1-2**: Add branded types for IDs
- [ ] **Day 3**: Add exhaustive checking to switches
- [ ] **Day 4-5**: Add type guards for remaining `as any`

**Estimated Impact**: Type Safety 90% → 94%

---

### Phase 3: Polish & Optimization (Week 3)
- [ ] **Day 1-2**: Improve generic utility types
- [ ] **Day 3**: Add template literal types
- [ ] **Day 4**: Increase `satisfies` usage
- [ ] **Day 5**: Final audit & documentation

**Estimated Impact**: Type Safety 94% → 95%+

---

## 🎯 Success Metrics

| Metric | Before | Phase 1 | Phase 2 | Phase 3 | Target |
|--------|--------|---------|---------|---------|--------|
| `as any` count | 34 | 20 | 10 | 5 | < 5 |
| Unvalidated JSON.parse | 33 | 0 | 0 | 0 | 0 |
| Boolean flags | 15 | 5 | 0 | 0 | 0 |
| Type Safety Score | 85% | 90% | 94% | 95% | 95%+ |
| Build warnings | 1 | 1 | 0 | 0 | 0 |

---

## 📝 Next Steps

1. **Review this plan** - Confirm priorities
2. **Start Phase 1** - JSON.parse validation (highest risk)
3. **Create PRs** - One PR per major change
4. **Update TECHNICAL-DEBT.md** - Track progress

---

## 🔗 References

- [Effective TypeScript](https://effectivetypescript.com/)
- [Parse, Don't Validate](https://lexi-lambda.github.io/blog/2019/11/05/parse-don-t-validate/)
- [Making Illegal States Unrepresentable](https://blog.janestreet.com/effective-ml-revisited/)
- [Zod Documentation](https://zod.dev/)
