# Craft Issue Report

## Summary

Initially encountered "null is not an object" error when using `@sylphx/craft` in zustand-to-zen migration. However, isolated tests **cannot reproduce** the error. Craft works correctly with:
- ✅ Objects containing functions
- ✅ Null values in state
- ✅ Zustand-style state structure (data + methods)

## Environment

```json
{
  "@sylphx/zen": "1.2.1",
  "@sylphx/zen-react": "1.0.2",
  "@sylphx/zen-craft": "2.0.0",
  "@sylphx/craft": "1.3.0",
  "bun": "1.3.1",
  "react": "19.2.0"
}
```

## Original Error (Production)

```
Failed to load config: TypeError: null is not an object (evaluating 'e[oe]')
    at B (/Users/kyle/code/node_modules/.bun/@sylphx+craft@1.3.0/node_modules/@sylphx/craft/dist/index.js:1:9886)
    at A (/Users/kyle/code/node_modules/.bun/@sylphx+craft@1.3.0/node_modules/@sylphx/craft/dist/index.js:1:7008)
    at setState (/Users/kyle/code/packages/code-client/src/lib/create-store.ts:62:25)
    at setAIConfig (/Users/kyle/code/packages/code-client/src/hooks/useAIConfig.ts:18:5)
```

## Use Case

### Goal
Create zustand-compatible API wrapper for zen to enable zero-breaking-change migration.

### State Structure
Zustand pattern: Store contains both data fields AND methods

```typescript
const useStore = createStore((set, get) => ({
  // Data fields
  count: 0,
  user: { name: 'Alice', age: 30 },
  config: null, // Can be null initially

  // Methods (reference set/get in closure)
  increment: () => set(state => { state.count++; }),
  setUser: (user) => set(state => { state.user = user; }),
  setConfig: (config) => set(state => { state.config = config; }),
}));
```

### Expected Behavior
`craft` should produce new immutable state while preserving function references:

```typescript
const setState = (action) => {
  const current = get(store);  // { count: 0, increment: [Function], ... }
  const next = craft(current, action);  // Should work
  zenSet(store, next);
};
```

## Test Results

### Test 1: Plain Data ✅
```typescript
const data = { count: 0, user: { name: 'Alice' } };
const next = craft(data, draft => { draft.count++; });
// ✅ Works
```

### Test 2: Object with Functions ✅
```typescript
const state = {
  count: 0,
  increment: () => {},
};
const next = craft(state, draft => { draft.count++; });
// ✅ Works - functions preserved
```

### Test 3: Null Values ✅
```typescript
const state = {
  config: null,
  user: { profile: null },
};
const next = craft(state, draft => {
  draft.config = { providers: {} };
  draft.user.profile = { age: 30 };
});
// ✅ Works
```

### Test 4: Exact Production Pattern ✅
```typescript
type State = {
  aiConfig: AIConfig | null;
  setAIConfig: (config: AIConfig) => void;
};

const initialState = {
  aiConfig: null,
  setAIConfig: (config) => setState(state => { state.aiConfig = config; }),
};

const setState = (action) => {
  const current = get(store);
  const next = craft(current, action);
  zenSet(store, next);
};

store = zen(initialState);
store.setAIConfig({ providers: {} });
// ✅ Works - no error
```

## Current Workaround

Since isolated tests pass, switched to manual immutable update pattern:

```typescript
const setState = (action) => {
  const current = get(store);

  // Separate data from methods
  const data = {}, methods = {};
  for (const [key, value] of Object.entries(current)) {
    (typeof value === 'function' ? methods : data)[key] = value;
  }

  // Clone data, preserve methods
  const draftData = structuredClone(data);
  const draft = { ...draftData, ...methods };

  // Apply mutation
  action(draft);

  // Set next state
  zenSet(store, draft);
};
```

**Trade-off**: Loses craft performance benefits

## Questions for Team

1. **Can craft handle objects with function properties?**
   - Tests show: YES
   - But why did production fail?

2. **Is there a specific edge case that causes the error?**
   - Specific object shape?
   - Specific mutation pattern?
   - React context?

3. **Should we use craft for this pattern?**
   - If yes: What's the recommended usage?
   - If no: What's the recommended alternative?

4. **Why can't I reproduce the error in isolation?**
   - Different execution context?
   - React-specific issue?
   - Timing/async issue?

## Reproduction Files

See attached:
- `craft-reproduction.ts` - Basic tests (all pass)
- `craft-actual-case.ts` - Exact production pattern (passes)
- `create-store.ts` - Full zustand wrapper implementation
- `ai-config-store.ts` - Actual failing store

## Next Steps

Would appreciate team guidance on:
1. Whether craft is appropriate for this use case
2. If there's a better pattern for zustand-zen migration
3. How to properly integrate craft with zen atoms containing mixed data/functions

## Contact

Kyle (sylphxltd)
- Using zen in production migration from zustand
- Happy to provide more debug info or test cases as needed
