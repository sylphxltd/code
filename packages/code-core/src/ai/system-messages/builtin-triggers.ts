/**
 * Built-in System Message Triggers
 * Pre-configured triggers for common scenarios
 */

import { SystemMessages } from './index.js';
import { triggerRegistry, getSessionFlags, isFlagSet } from './registry.js';
import type { TriggerHook } from './registry.js';

/**
 * Context Warning Thresholds
 */
const CONTEXT_WARNING_80 = 0.8;
const CONTEXT_WARNING_90 = 0.9;

/**
 * Resource Warning Threshold
 */
const RESOURCE_WARNING_THRESHOLD = 0.8;

/**
 * CPU Resource Trigger
 * Fires when CPU crosses 80% threshold (both directions)
 */
const cpuResourceTrigger: TriggerHook = async (context) => {
  const { session } = context;
  const flags = getSessionFlags(session);

  // Get current CPU usage
  const { getSystemStatus } = await import('../ai-sdk.js');
  const status = getSystemStatus();
  const cpuMatch = status.cpu.match(/^([\d.]+)%/);
  const cpuUsage = cpuMatch ? parseFloat(cpuMatch[1]) / 100 : 0;

  const isWarningActive = isFlagSet(session, 'cpuWarning');

  // State transition: Normal → Warning
  if (cpuUsage >= RESOURCE_WARNING_THRESHOLD && !isWarningActive) {
    return {
      messageType: 'resource-warning-cpu',
      message: SystemMessages.resourceWarningCPU(status.cpu),
      flagUpdates: { cpuWarning: true },
    };
  }

  // State transition: Warning → Normal
  if (cpuUsage < RESOURCE_WARNING_THRESHOLD && isWarningActive) {
    return {
      messageType: 'resource-recovered-cpu',
      message: `<system_message type="resource-recovered-cpu">
✅ System Resource Recovered - CPU

CPU usage has returned to normal levels: ${status.cpu}

You can now safely:
- Use parallel operations if needed
- Run computationally intensive tasks
- Process large batches

The system resource constraints have been resolved.
</system_message>`,
      flagUpdates: { cpuWarning: false },
    };
  }

  return null;
};

/**
 * Memory Resource Trigger
 * Fires when Memory crosses 80% threshold (both directions)
 */
const memoryResourceTrigger: TriggerHook = async (context) => {
  const { session } = context;
  const flags = getSessionFlags(session);

  // Get current Memory usage
  const { getSystemStatus } = await import('../ai-sdk.js');
  const status = getSystemStatus();
  const memMatch = status.memory.match(/([\d.]+)GB\/([\d.]+)GB/);
  const memUsage = memMatch ? parseFloat(memMatch[1]) / parseFloat(memMatch[2]) : 0;

  const isWarningActive = isFlagSet(session, 'memoryWarning');

  console.log(`💾 [memoryTrigger] Session ${session.id.substring(0, 8)}...`, {
    memUsage: Math.round(memUsage * 100) + '%',
    threshold: Math.round(RESOURCE_WARNING_THRESHOLD * 100) + '%',
    isWarningActive,
    flags,
  });

  // State transition: Normal → Warning
  if (memUsage >= RESOURCE_WARNING_THRESHOLD && !isWarningActive) {
    console.log(`💾 [memoryTrigger] Triggering warning (Normal → Warning)`);
    return {
      messageType: 'resource-warning-memory',
      message: SystemMessages.resourceWarningMemory(status.memory),
      flagUpdates: { memoryWarning: true },
    };
  }

  // State transition: Warning → Normal
  if (memUsage < RESOURCE_WARNING_THRESHOLD && isWarningActive) {
    console.log(`💾 [memoryTrigger] Triggering recovery (Warning → Normal)`);
    return {
      messageType: 'resource-recovered-memory',
      message: `<system_message type="resource-recovered-memory">
✅ System Resource Recovered - Memory

Memory usage has returned to normal levels: ${status.memory}

You can now safely:
- Load larger files if needed
- Use in-memory processing
- Work with larger data structures

The memory constraints have been resolved.
</system_message>`,
      flagUpdates: { memoryWarning: false },
    };
  }

  console.log(`💾 [memoryTrigger] No state transition needed`);
  return null;
};

/**
 * Context 80% Warning Trigger
 * Fires once when context usage exceeds 80%
 */
const context80Trigger: TriggerHook = async (context) => {
  const { session, contextTokens } = context;

  if (!contextTokens) {
    return null;
  }

  const usage = contextTokens.current / contextTokens.max;
  const isWarningShown = isFlagSet(session, 'contextWarning80');

  // Only fire once when crossing threshold
  if (usage >= CONTEXT_WARNING_80 && !isWarningShown) {
    return {
      messageType: 'context-warning-80',
      message: SystemMessages.contextWarning80(),
      flagUpdates: { contextWarning80: true },
    };
  }

  return null;
};

/**
 * Context 90% Critical Trigger
 * Fires once when context usage exceeds 90%
 */
const context90Trigger: TriggerHook = async (context) => {
  const { session, contextTokens } = context;

  if (!contextTokens) {
    return null;
  }

  const usage = contextTokens.current / contextTokens.max;
  const isWarningShown = isFlagSet(session, 'contextWarning90');

  // Only fire once when crossing threshold
  if (usage >= CONTEXT_WARNING_90 && !isWarningShown) {
    return {
      messageType: 'context-warning-90',
      message: SystemMessages.contextWarning90(),
      flagUpdates: { contextWarning90: true },
    };
  }

  return null;
};

/**
 * Session Start Todo Trigger
 * Fires on first user message to show todo hints
 */
const sessionStartTodoTrigger: TriggerHook = async (context) => {
  const { session } = context;

  // Only check on first user message
  const userMessageCount = session.messages.filter(m => m.role === 'user').length;
  if (userMessageCount !== 0) {
    return null;
  }

  // Check if already shown
  const isShown = isFlagSet(session, 'sessionStartTodoShown');
  if (isShown) {
    return null;
  }

  // Show todos or reminder
  const message = session.todos && session.todos.length > 0
    ? SystemMessages.sessionStartWithTodos(session.todos)
    : SystemMessages.sessionStartNoTodos();

  return {
    messageType: 'session-start-todos',
    message,
    flagUpdates: { sessionStartTodoShown: true },
  };
};

/**
 * Random Test Trigger - For UI testing only
 * Randomly triggers to show system messages in UI
 *
 * 50% chance to trigger on each step
 */
const randomTestTrigger: TriggerHook = async (context) => {
  // 50% chance to trigger
  if (Math.random() > 0.5) {
    return null;
  }

  // Randomly choose message type
  const random = Math.random();

  if (random < 0.33) {
    return {
      messageType: 'test-context-warning',
      message: `<system_message type="test-context-warning">
🧪 UI Test: Context Warning

This is a random test message to verify UI display.
Simulated context: ${Math.floor(Math.random() * 30 + 50)}%
</system_message>`,
      flagUpdates: {},
    };
  } else if (random < 0.66) {
    return {
      messageType: 'test-memory-warning',
      message: `<system_message type="test-memory-warning">
🧪 UI Test: Memory Warning

This is a random test message to verify UI display.
Simulated memory: ${(Math.random() * 4 + 10).toFixed(1)}GB / 16.0GB
</system_message>`,
      flagUpdates: {},
    };
  } else {
    return {
      messageType: 'test-multiple-warnings',
      message: `<system_message type="test-multiple-warnings">
🧪 UI Test: Multiple Warnings

This tests how UI handles multiple warnings:
- Context: ${Math.floor(Math.random() * 20 + 60)}%
- Memory: ${(Math.random() * 3 + 11).toFixed(1)}GB / 16.0GB
</system_message>`,
      flagUpdates: {},
    };
  }
};

/**
 * Register all built-in triggers
 */
export function registerBuiltinTriggers(): void {
  // Priority order (lower = higher priority)

  // Random test trigger (only in TEST_MODE)
  if (process.env.TEST_MODE) {
    triggerRegistry.register({
      id: 'random-test-trigger',
      name: 'Random Test System Message',
      description: 'Random trigger for UI testing (50% chance)',
      priority: -1, // Highest priority
      enabled: true,
      hook: randomTestTrigger,
    });
  }

  triggerRegistry.register({
    id: 'context-90-critical',
    name: 'Context 90% Critical',
    description: 'Warns when context usage exceeds 90%',
    priority: 0, // Highest priority
    enabled: true,
    hook: context90Trigger,
  });

  triggerRegistry.register({
    id: 'context-80-warning',
    name: 'Context 80% Warning',
    description: 'Warns when context usage exceeds 80%',
    priority: 1,
    enabled: true,
    hook: context80Trigger,
  });

  triggerRegistry.register({
    id: 'session-start-todos',
    name: 'Session Start Todo Hints',
    description: 'Shows todo hints on session start',
    priority: 2,
    enabled: true,
    hook: sessionStartTodoTrigger,
  });

  triggerRegistry.register({
    id: 'cpu-resource',
    name: 'CPU Resource Monitor',
    description: 'Monitors CPU usage and warns at 80%',
    priority: 3,
    enabled: true,
    hook: cpuResourceTrigger,
  });

  triggerRegistry.register({
    id: 'memory-resource',
    name: 'Memory Resource Monitor',
    description: 'Monitors memory usage and warns at 80%',
    priority: 4,
    enabled: true,
    hook: memoryResourceTrigger,
  });
}
