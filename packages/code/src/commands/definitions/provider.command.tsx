/**
 * Provider Command
 * Configure and switch AI providers using component-based UI
 */

import { ProviderManagement } from '../../screens/chat/components/ProviderManagementV2.js';
import { getActionCompletions, getProviderCompletions } from '../../completions/provider.js';
import type { Command } from '../types.js';

export const providerCommand: Command = {
  id: 'provider',
  label: '/provider',
  description: 'Manage AI providers',
  args: [
    {
      name: 'action',
      description: 'Action to perform (use/configure)',
      required: false,
      loadOptions: async () => {
        return getActionCompletions();
      },
    },
    {
      name: 'provider-id',
      description: 'Provider to use or configure',
      required: false,
      loadOptions: async () => {
        return getProviderCompletions();
      },
    },
    {
      name: 'subaction',
      description: 'Configuration action (set/get/show)',
      required: false,
      loadOptions: async () => {
        const { getSubactionCompletions } = await import('../../completions/provider.js');
        return getSubactionCompletions();
      },
    },
    {
      name: 'key',
      description: 'Configuration key',
      required: false,
      loadOptions: async (context) => {
        const providerId = context.args[1];
        if (!providerId) return [];
        const { getProviderKeyCompletions } = await import('../../completions/provider.js');
        return getProviderKeyCompletions(providerId);
      },
    },
    {
      name: 'value',
      description: 'Configuration value (for set)',
      required: false,
    },
  ],

  execute: async (context) => {
    const action = context.args[0] as 'use' | 'configure' | undefined;
    const providerId = context.args[1];
    const subaction = context.args[2] as 'set' | 'get' | 'show' | undefined;
    const key = context.args[3];
    const value = context.args[4];

    // Validate action
    if (action && action !== 'use' && action !== 'configure') {
      await context.sendMessage(
        `Unknown action: ${action}\n\n` +
          'Usage:\n' +
          '  /provider - Select action (use/configure)\n' +
          '  /provider use - Select provider to use\n' +
          '  /provider configure - Configure a provider\n' +
          '  /provider configure <provider> set <key> <value> - Set config value\n' +
          '  /provider configure <provider> get <key> - Get config value\n' +
          '  /provider configure <provider> show - Show all config'
      );
      return;
    }

    // Get store
    const { useAppStore } = await import('@sylphx/code-client');
    const { getTRPCClient } = await import('@sylphx/code-client');
    const store = useAppStore.getState();
    const aiConfig = store.aiConfig;

    // Handle command-line configuration (set/get/show)
    if (action === 'configure' && providerId && subaction) {
      const trpc = getTRPCClient();

      if (subaction === 'show') {
        // Show all configuration for provider
        const providerConfig = aiConfig?.providers?.[providerId] || {};
        const configLines = Object.entries(providerConfig).map(([k, v]) => {
          // Mask sensitive values
          if (k.toLowerCase().includes('key') || k.toLowerCase().includes('token')) {
            const strVal = String(v);
            const masked = strVal.length > 7 ? strVal.substring(0, 7) + '***' : '***';
            return `  ${k}: ${masked}`;
          }
          return `  ${k}: ${v}`;
        });

        if (configLines.length === 0) {
          return `Provider "${providerId}" is not configured yet.`;
        }

        return `Configuration for "${providerId}":\n${configLines.join('\n')}`;
      }

      if (subaction === 'get') {
        if (!key) {
          return 'Error: Missing key. Usage: /provider configure <provider> get <key>';
        }

        const providerConfig = aiConfig?.providers?.[providerId] || {};
        const val = providerConfig[key];

        if (val === undefined) {
          return `Key "${key}" not found in provider "${providerId}" configuration.`;
        }

        // Mask sensitive values
        if (key.toLowerCase().includes('key') || key.toLowerCase().includes('token')) {
          const strVal = String(val);
          const masked = strVal.length > 7 ? strVal.substring(0, 7) + '***' : '***';
          return `${key}: ${masked}`;
        }

        return `${key}: ${val}`;
      }

      if (subaction === 'set') {
        if (!key || value === undefined) {
          return 'Error: Missing key or value. Usage: /provider configure <provider> set <key> <value>';
        }

        // Get current config
        const currentProviderConfig = aiConfig?.providers?.[providerId] || {};

        // Update config
        const updatedProviderConfig = {
          ...currentProviderConfig,
          [key]: value,
        };

        // Update store
        store.updateProvider(providerId as any, updatedProviderConfig);
        const updatedConfig = {
          ...aiConfig!,
          providers: {
            ...aiConfig!.providers,
            [providerId]: updatedProviderConfig,
          },
        } as any;
        store.setAIConfig(updatedConfig);

        // Save to server
        await context.saveConfig(updatedConfig);

        context.addLog(`[provider] Set ${key} for ${providerId}`);
        return `Set ${key} for provider "${providerId}"`;
      }
    }

    // If both action and providerId are provided (without subaction), handle directly
    if (action && providerId && !subaction) {
      if (action === 'use') {
        // Direct provider switch
        store.updateProvider(providerId as any, {});
        const updatedConfig = {
          ...aiConfig,
          defaultProvider: providerId,
        } as any;
        store.setAIConfig(updatedConfig);

        // Save to server
        await context.saveConfig(updatedConfig);

        const providerConfig = aiConfig?.providers?.[providerId] || {};
        const providerDefaultModel = providerConfig.defaultModel as string;
        context.addLog(`[provider] Switched to provider: ${providerId} (model: ${providerDefaultModel || 'default'}) and saved config`);
        return `Switched to provider: ${providerId}`;
      } else if (action === 'configure') {
        // For configure with direct provider, still show UI to enter credentials
        // Fall through to UI below
      }
    }

    // Show UI for interactive selection
    context.setInputComponent(
      <ProviderManagement
        initialAction={action}
        initialProviderId={providerId}
        aiConfig={aiConfig}
        onComplete={() => {
          context.setInputComponent(null);
          context.addLog('[provider] Provider management closed');
        }}
        onSelectProvider={async (providerId) => {
          // Get fresh store reference
          const { useAppStore } = await import('@sylphx/code-client');
          const freshStore = useAppStore.getState();
          const freshAiConfig = freshStore.aiConfig;

          // Update store state
          freshStore.updateProvider(providerId as any, {});
          const updatedConfig = {
            ...freshAiConfig,
            defaultProvider: providerId,
            // ❌ Don't set top-level defaultModel
            // Model should come from provider's default-model
          } as any;
          freshStore.setAIConfig(updatedConfig);

          // CRITICAL: Save to server!
          await context.saveConfig(updatedConfig);

          const providerConfig = freshAiConfig?.providers?.[providerId] || {};
          const providerDefaultModel = providerConfig.defaultModel as string;
          context.addLog(`[provider] Switched to provider: ${providerId} (model: ${providerDefaultModel || 'default'}) and saved config`);
        }}
        onConfigureProvider={async (providerId, config) => {
          // Get fresh store reference
          const { useAppStore } = await import('@sylphx/code-client');
          const freshStore = useAppStore.getState();

          // Update store state
          freshStore.updateProvider(providerId as any, config);

          // Build updated config
          const currentConfig = freshStore.aiConfig;
          const updatedConfig = {
            ...currentConfig!,
            providers: {
              ...currentConfig!.providers,
              [providerId]: config,
            },
          } as any;
          freshStore.setAIConfig(updatedConfig);

          // CRITICAL: Save to server!
          await context.saveConfig(updatedConfig);
          context.addLog(`[provider] Configured provider: ${providerId} and saved config`);
        }}
      />,
      'Provider Management'
    );

    context.addLog(`[provider] Provider management opened with action: ${action || 'select'}`);
  },
};

export default providerCommand;
