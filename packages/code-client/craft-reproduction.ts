/**
 * Craft Integration Reproduction Case
 *
 * This reproduces the error when using craft with zustand-style state
 * (objects containing both data and methods)
 */

import { zen, get, set as zenSet } from '@sylphx/zen';
import { craft } from '@sylphx/craft';

console.log('=== CRAFT REPRODUCTION TEST ===\n');

// Test 1: craft with plain object (should work)
console.log('Test 1: craft with plain data object');
try {
  const plainData = { count: 0, user: { name: 'Alice', age: 30 } };
  const result = craft(plainData, (draft) => {
    draft.count++;
    draft.user.age++;
  });
  console.log('✅ SUCCESS - Plain data:', result);
} catch (error) {
  console.log('❌ FAILED - Plain data:', error);
}

console.log('\nTest 2: craft with object containing functions');
try {
  const stateWithMethods = {
    // Data
    count: 0,
    user: { name: 'Alice', age: 30 },

    // Methods
    increment: function() { console.log('increment called'); },
    setName: function(name: string) { console.log('setName called'); },
  };

  console.log('State before craft:', JSON.stringify(stateWithMethods, null, 2));

  const result = craft(stateWithMethods, (draft) => {
    console.log('Inside craft updater, draft:', draft);
    draft.count++;
    draft.user.age++;
  });

  console.log('✅ SUCCESS - State with methods:', result);
} catch (error: any) {
  console.log('❌ FAILED - State with methods');
  console.log('Error message:', error.message);
  console.log('Error stack:', error.stack);
}

console.log('\nTest 3: craft with null values');
try {
  const stateWithNull = {
    value: null,
    user: { name: 'Alice', profile: null },
    items: [1, 2, 3],
  };

  console.log('State before craft:', JSON.stringify(stateWithNull, null, 2));

  const result = craft(stateWithNull, (draft) => {
    draft.value = 'test';
    if (draft.user.profile === null) {
      draft.user.profile = { age: 30 };
    }
  });

  console.log('✅ SUCCESS - State with null:', result);
} catch (error: any) {
  console.log('❌ FAILED - State with null');
  console.log('Error message:', error.message);
  console.log('Error stack:', error.stack);
}

console.log('\nTest 4: Zustand-style store with craft');
try {
  // Simulate zustand store structure
  type CountState = {
    count: number;
    user: { name: string; age: number };
    increment: () => void;
    setUserName: (name: string) => void;
  };

  // This is what creator function returns
  const createInitialState = (setState: any): CountState => ({
    count: 0,
    user: { name: 'Alice', age: 30 },
    increment: () => setState((state: CountState) => { state.count++; }),
    setUserName: (name: string) => setState((state: CountState) => { state.user.name = name; }),
  });

  const store = zen({} as CountState);

  const setState = (action: any) => {
    const current = get(store);
    console.log('Current state type:', typeof current);
    console.log('Current state keys:', Object.keys(current));
    console.log('Current state:', JSON.stringify(current, null, 2));

    if (typeof action === 'function') {
      console.log('Calling craft with current state...');
      const next = craft(current, action);
      console.log('✅ craft succeeded, setting next state');
      zenSet(store, next);
    }
  };

  // Initialize
  const initialState = createInitialState(setState);
  console.log('Initial state created:', Object.keys(initialState));
  zenSet(store, initialState);

  // Try to update
  console.log('\nCalling increment (which calls setState)...');
  const state = get(store);
  state.increment();

  console.log('✅ SUCCESS - Full zustand pattern');
} catch (error: any) {
  console.log('❌ FAILED - Full zustand pattern');
  console.log('Error message:', error.message);
  console.log('Error stack:', error.stack);
}

console.log('\n=== END REPRODUCTION TEST ===');
