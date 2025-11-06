/**
 * App Context - Effect-based Services Provider
 * Pure functional composition using Effect.ts
 *
 * Architecture:
 * - All services are Effect-based (Context + Layer)
 * - Type-safe dependency injection
 * - Explicit error handling
 * - Composable effects
 */

import { Effect, Context, Layer } from 'effect';
import type { Agent, Rule } from '@sylphx/code-core';
import {
  SessionRepository,
  initializeDatabase,
  loadAllAgents,
  loadAllRules,
  DEFAULT_AGENT_ID,
} from '@sylphx/code-core';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

// ============================================================================
// Configuration
// ============================================================================

export interface DatabaseConfig {
  url?: string;
  authToken?: string;
}

export interface AppConfig {
  database?: DatabaseConfig;
  cwd: string;
}

// ============================================================================
// Database Service (Effect)
// ============================================================================

export class DatabaseService extends Context.Tag('DatabaseService')<
  DatabaseService,
  {
    readonly getRepository: Effect.Effect<SessionRepository, never, never>;
    readonly getDB: Effect.Effect<DrizzleD1Database<any>, never, never>;
  }
>() {}

export const makeDatabaseService = (config: DatabaseConfig) =>
  Effect.gen(function* () {
    // Initialize database
    const db = yield* Effect.promise(() => initializeDatabase(() => {}));
    const repository = new SessionRepository(db);

    return DatabaseService.of({
      getRepository: Effect.succeed(repository),
      getDB: Effect.succeed(db),
    });
  });

export const DatabaseServiceLive = (config: DatabaseConfig) =>
  Layer.effect(DatabaseService, makeDatabaseService(config));

// ============================================================================
// Agent Manager Service (Effect)
// ============================================================================

const FALLBACK_AGENT: Agent = {
  id: DEFAULT_AGENT_ID,
  metadata: {
    name: 'Coder',
    description: 'Default coding assistant',
  },
  systemPrompt: 'You are a helpful coding assistant.',
  isBuiltin: true,
};

export class AgentManagerService extends Context.Tag('AgentManagerService')<
  AgentManagerService,
  {
    readonly getAll: Effect.Effect<Agent[], never, never>;
    readonly getById: (id: string) => Effect.Effect<Agent | null, never, never>;
    readonly reload: Effect.Effect<void, never, never>;
  }
>() {}

export const makeAgentManagerService = (cwd: string) =>
  Effect.gen(function* () {
    // Load agents
    const allAgents = yield* Effect.promise(() => loadAllAgents(cwd));
    const agentsMap = new Map(allAgents.map(a => [a.id, a]));

    return AgentManagerService.of({
      getAll: Effect.succeed(Array.from(agentsMap.values())),
      getById: (id: string) => Effect.succeed(agentsMap.get(id) || null),
      reload: Effect.promise(() => loadAllAgents(cwd)).pipe(
        Effect.map(agents => {
          agentsMap.clear();
          agents.forEach(a => agentsMap.set(a.id, a));
        })
      ),
    });
  });

export const AgentManagerServiceLive = (cwd: string) =>
  Layer.effect(AgentManagerService, makeAgentManagerService(cwd));

// ============================================================================
// Rule Manager Service (Effect)
// ============================================================================

export class RuleManagerService extends Context.Tag('RuleManagerService')<
  RuleManagerService,
  {
    readonly getAll: Effect.Effect<Rule[], never, never>;
    readonly getById: (id: string) => Effect.Effect<Rule | null, never, never>;
    readonly getEnabled: (enabledIds: string[]) => Effect.Effect<Rule[], never, never>;
    readonly reload: Effect.Effect<void, never, never>;
  }
>() {}

export const makeRuleManagerService = (cwd: string) =>
  Effect.gen(function* () {
    // Load rules
    const allRules = yield* Effect.promise(() => loadAllRules(cwd));
    const rulesMap = new Map(allRules.map(r => [r.id, r]));

    return RuleManagerService.of({
      getAll: Effect.succeed(Array.from(rulesMap.values())),
      getById: (id: string) => Effect.succeed(rulesMap.get(id) || null),
      getEnabled: (enabledIds: string[]) =>
        Effect.succeed(
          enabledIds
            .map(id => rulesMap.get(id))
            .filter((r): r is Rule => r !== undefined)
        ),
      reload: Effect.promise(() => loadAllRules(cwd)).pipe(
        Effect.map(rules => {
          rulesMap.clear();
          rules.forEach(r => rulesMap.set(r.id, r));
        })
      ),
    });
  });

export const RuleManagerServiceLive = (cwd: string) =>
  Layer.effect(RuleManagerService, makeRuleManagerService(cwd));

// ============================================================================
// App Context - Composition Root
// ============================================================================

export type AppContext = {
  database: DatabaseService;
  agentManager: AgentManagerService;
  ruleManager: RuleManagerService;
  config: AppConfig;
};

/**
 * Create app layer with all services
 */
export const makeAppLayer = (config: AppConfig) =>
  Layer.mergeAll(
    DatabaseServiceLive(config.database || {}),
    AgentManagerServiceLive(config.cwd),
    RuleManagerServiceLive(config.cwd)
  );

/**
 * Runtime type that includes all services
 */
export type AppRuntime = Context.Context<
  DatabaseService | AgentManagerService | RuleManagerService
>;

// ============================================================================
// Legacy Compatibility Bridge
// ============================================================================
// Temporary: Convert Effect services to plain objects for existing code

export interface LegacyDatabaseService {
  getRepository(): SessionRepository;
  getDB(): DrizzleD1Database<any>;
}

export interface LegacyAgentManagerService {
  getAll(): Agent[];
  getById(id: string): Agent | null;
  reload(): Promise<void>;
}

export interface LegacyRuleManagerService {
  getAll(): Rule[];
  getById(id: string): Rule | null;
  getEnabled(enabledIds: string[]): Rule[];
  reload(): Promise<void>;
}

export interface LegacyAppContext {
  database: LegacyDatabaseService;
  agentManager: LegacyAgentManagerService;
  ruleManager: LegacyRuleManagerService;
  config: AppConfig;
}

/**
 * Create legacy-compatible context from Effect runtime
 * TEMPORARY: For gradual migration
 */
export function createLegacyAppContext(
  runtime: AppRuntime,
  config: AppConfig
): LegacyAppContext {
  const database = Context.get(runtime, DatabaseService);
  const agentManager = Context.get(runtime, AgentManagerService);
  const ruleManager = Context.get(runtime, RuleManagerService);

  return {
    database: {
      getRepository: () => Effect.runSync(database.getRepository),
      getDB: () => Effect.runSync(database.getDB),
    },
    agentManager: {
      getAll: () => Effect.runSync(agentManager.getAll),
      getById: (id: string) => Effect.runSync(agentManager.getById(id)),
      reload: () => Effect.runPromise(agentManager.reload),
    },
    ruleManager: {
      getAll: () => Effect.runSync(ruleManager.getAll),
      getById: (id: string) => Effect.runSync(ruleManager.getById(id)),
      getEnabled: (enabledIds: string[]) => Effect.runSync(ruleManager.getEnabled(enabledIds)),
      reload: () => Effect.runPromise(ruleManager.reload),
    },
    config,
  };
}

/**
 * Initialize app context - returns legacy-compatible context
 */
export async function createAppContext(config: AppConfig): Promise<LegacyAppContext> {
  const layer = makeAppLayer(config);

  // Provide layer and run effect to build runtime
  const runtime = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Effect.scope;
        return yield* Layer.buildWithScope(layer, scope);
      })
    )
  );

  return createLegacyAppContext(runtime, config);
}

export async function initializeAppContext(ctx: LegacyAppContext): Promise<void> {
  // No-op: initialization happens in createAppContext via Layer
}

export async function closeAppContext(ctx: LegacyAppContext): Promise<void> {
  // Future: Add cleanup logic
}
