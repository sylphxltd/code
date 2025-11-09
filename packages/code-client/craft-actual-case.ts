/**
 * Actual failing case: AIConfigStore setAIConfig
 */

import { zen, get, set as zenSet } from '@sylphx/zen';
import { craft } from '@sylphx/craft';

console.log('=== ACTUAL FAILING CASE ===\n');

type AIConfig = {
  providers?: Record<string, any>;
  defaultProvider?: string;
  defaultEnabledRuleIds?: string[];
  defaultAgentId?: string;
};

type AIConfigState = {
  aiConfig: AIConfig | null;
  setAIConfig: (config: AIConfig) => void;
  updateProvider: (provider: string, data: any) => void;
  removeProvider: (provider: string) => void;
};

try {
  // Create zen store
  let store: any;

  const setState = (action: any) => {
    console.log('\n=== setState called ===');
    const current = get(store);
    console.log('Current state:', JSON.stringify(current, (key, value) =>
      typeof value === 'function' ? '[Function]' : value
    , 2));

    if (typeof action === 'function') {
      console.log('Calling craft...');
      try {
        const next = craft(current, action);
        console.log('✅ craft succeeded');
        console.log('Next state:', JSON.stringify(next, (key, value) =>
          typeof value === 'function' ? '[Function]' : value
        , 2));
        zenSet(store, next);
      } catch (error: any) {
        console.log('❌ craft FAILED');
        console.log('Error:', error.message);
        console.log('Stack:', error.stack);
        throw error;
      }
    } else {
      zenSet(store, { ...current, ...action });
    }
  };

  const getState = () => get(store);

  // Create initial state (exact same as ai-config-store.ts)
  const initialState: AIConfigState = {
    aiConfig: null,  // THIS IS THE KEY - initial value is null

    setAIConfig: (config) => {
      console.log('\n=== setAIConfig called ===');
      console.log('Config argument:', JSON.stringify(config, null, 2));

      setState((state) => {
        console.log('Inside setState callback');
        console.log('state.aiConfig before:', state.aiConfig);
        state.aiConfig = config;
        console.log('state.aiConfig after:', state.aiConfig);
      });
    },

    updateProvider: (provider, data) =>
      setState((state) => {
        if (!state.aiConfig) {
          state.aiConfig = { providers: {} };
        }
        if (!state.aiConfig.providers) {
          state.aiConfig.providers = {};
        }
        state.aiConfig.providers[provider] = {
          ...state.aiConfig.providers[provider],
          ...data,
        };
      }),

    removeProvider: (provider) =>
      setState((state) => {
        if (state.aiConfig?.providers) {
          delete state.aiConfig.providers[provider];
        }
        if (state.aiConfig?.defaultProvider === provider) {
          state.aiConfig.defaultProvider = undefined;
        }
      }),
  };

  console.log('Initial state created');
  console.log('aiConfig:', initialState.aiConfig);
  console.log('Methods:', Object.keys(initialState).filter(k => typeof initialState[k as keyof AIConfigState] === 'function'));

  // Create store
  store = zen(initialState);
  console.log('Store created');

  // Now call setAIConfig (this is what happens in useAIConfig.ts line 24)
  const state = get(store);
  console.log('\nCalling setAIConfig({ providers: {} })...');
  state.setAIConfig({ providers: {} });

  console.log('\n✅ SUCCESS - No error occurred');

} catch (error: any) {
  console.log('\n❌ FAILED');
  console.log('Error:', error.message);
  console.log('\nFull stack trace:');
  console.log(error.stack);
}

console.log('\n=== END TEST ===');
