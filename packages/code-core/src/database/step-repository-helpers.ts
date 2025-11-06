/**
 * Step Repository Helpers
 * Helper functions for step-based CRUD operations
 *
 * TEMPORARY: These helpers will be integrated into SessionRepository
 * For now, they exist as standalone functions to avoid breaking existing code
 */

import { eq, inArray } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import { randomUUID } from 'node:crypto';
import {
  messageSteps,
  stepParts,
  stepUsage,
  stepTodoSnapshots,
  type NewMessageStep,
} from './schema.js';
import type {
  MessageStep,
  MessagePart,
  TokenUsage,
  MessageMetadata,
} from '../types/session.types.js';
import type { Todo as TodoType } from '../types/todo.types.js';

/**
 * Create a new step in a message
 */
export async function createMessageStep(
  db: LibSQLDatabase,
  messageId: string,
  stepIndex: number,
  metadata?: MessageMetadata,
  todoSnapshot?: TodoType[]
): Promise<string> {
  const stepId = `${messageId}-step-${stepIndex}`;
  const now = Date.now();

  await db.transaction(async (tx) => {
    // Insert step
    const newStep: NewMessageStep = {
      id: stepId,
      messageId,
      stepIndex,
      status: 'active',
      metadata: metadata ? JSON.stringify(metadata) : null,
      startTime: now,
      endTime: null,
      provider: null,
      model: null,
      duration: null,
      finishReason: null,
    };

    await tx.insert(messageSteps).values(newStep);

    // Insert todo snapshot if provided
    if (todoSnapshot && todoSnapshot.length > 0) {
      for (const todo of todoSnapshot) {
        await tx.insert(stepTodoSnapshots).values({
          id: randomUUID(),
          stepId,
          todoId: todo.id,
          content: todo.content,
          activeForm: todo.activeForm,
          status: todo.status,
          ordering: todo.ordering,
        });
      }
    }
  });

  return stepId;
}

/**
 * Update step parts (used during streaming)
 */
export async function updateStepParts(
  db: LibSQLDatabase,
  stepId: string,
  parts: MessagePart[]
): Promise<void> {
  await db.transaction(async (tx) => {
    // Delete existing parts
    await tx.delete(stepParts).where(eq(stepParts.stepId, stepId));

    // Insert new parts
    for (let i = 0; i < parts.length; i++) {
      await tx.insert(stepParts).values({
        id: randomUUID(),
        stepId,
        ordering: i,
        type: parts[i].type,
        content: JSON.stringify(parts[i]),
      });
    }
  });
}

/**
 * Complete a step with final metadata
 */
export async function completeMessageStep(
  db: LibSQLDatabase,
  stepId: string,
  options: {
    status: 'completed' | 'error' | 'abort';
    finishReason?: string;
    usage?: TokenUsage;
    provider?: string;
    model?: string;
  }
): Promise<void> {
  const endTime = Date.now();

  await db.transaction(async (tx) => {
    // Get start time to calculate duration
    const [step] = await tx
      .select()
      .from(messageSteps)
      .where(eq(messageSteps.id, stepId))
      .limit(1);

    const duration = step?.startTime ? endTime - step.startTime : null;

    // Update step
    await tx
      .update(messageSteps)
      .set({
        status: options.status,
        finishReason: options.finishReason || null,
        provider: options.provider || null,
        model: options.model || null,
        duration,
        endTime,
      })
      .where(eq(messageSteps.id, stepId));

    // Insert usage if provided
    if (options.usage) {
      await tx.insert(stepUsage).values({
        stepId,
        promptTokens: options.usage.promptTokens,
        completionTokens: options.usage.completionTokens,
        totalTokens: options.usage.totalTokens,
      });
    }
  });
}

/**
 * Load steps for a message
 */
export async function loadMessageSteps(
  db: LibSQLDatabase,
  messageId: string
): Promise<MessageStep[]> {
  // Get all steps for message
  const stepRecords = await db
    .select()
    .from(messageSteps)
    .where(eq(messageSteps.messageId, messageId))
    .orderBy(messageSteps.stepIndex);

  if (stepRecords.length === 0) {
    return [];
  }

  // Batch fetch all related data
  const stepIds = stepRecords.map((s) => s.id);
  const [allParts, allUsage, allSnapshots] = await Promise.all([
    db
      .select()
      .from(stepParts)
      .where(inArray(stepParts.stepId, stepIds))
      .orderBy(stepParts.ordering),
    db
      .select()
      .from(stepUsage)
      .where(inArray(stepUsage.stepId, stepIds)),
    db
      .select()
      .from(stepTodoSnapshots)
      .where(inArray(stepTodoSnapshots.stepId, stepIds))
      .orderBy(stepTodoSnapshots.ordering),
  ]);

  // Group by step ID
  const partsByStep = new Map<string, typeof allParts>();
  const usageByStep = new Map<string, (typeof allUsage)[0]>();
  const snapshotsByStep = new Map<string, typeof allSnapshots>();

  for (const part of allParts) {
    if (!partsByStep.has(part.stepId)) {
      partsByStep.set(part.stepId, []);
    }
    partsByStep.get(part.stepId)!.push(part);
  }

  for (const usage of allUsage) {
    usageByStep.set(usage.stepId, usage);
  }

  for (const snapshot of allSnapshots) {
    if (!snapshotsByStep.has(snapshot.stepId)) {
      snapshotsByStep.set(snapshot.stepId, []);
    }
    snapshotsByStep.get(snapshot.stepId)!.push(snapshot);
  }

  // Assemble steps
  return stepRecords.map((step) => {
    const parts = partsByStep.get(step.id) || [];
    const usage = usageByStep.get(step.id);
    const todoSnap = snapshotsByStep.get(step.id) || [];

    const messageStep: MessageStep = {
      id: step.id,
      stepIndex: step.stepIndex,
      parts: parts.map((p) => JSON.parse(p.content) as MessagePart),
      status: (step.status as 'active' | 'completed' | 'error' | 'abort') || 'completed',
    };

    if (step.metadata) {
      messageStep.metadata = JSON.parse(step.metadata) as MessageMetadata;
    }

    if (todoSnap.length > 0) {
      messageStep.todoSnapshot = todoSnap.map((t) => ({
        id: t.todoId,
        content: t.content,
        activeForm: t.activeForm,
        status: t.status as 'pending' | 'in_progress' | 'completed',
        ordering: t.ordering,
      }));
    }

    if (usage) {
      messageStep.usage = {
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        totalTokens: usage.totalTokens,
      };
    }

    if (step.provider) {
      messageStep.provider = step.provider;
    }

    if (step.model) {
      messageStep.model = step.model;
    }

    if (step.duration) {
      messageStep.duration = step.duration;
    }

    if (step.finishReason) {
      messageStep.finishReason = step.finishReason as 'stop' | 'tool-calls' | 'length' | 'error';
    }

    if (step.startTime) {
      messageStep.startTime = step.startTime;
    }

    if (step.endTime) {
      messageStep.endTime = step.endTime;
    }

    return messageStep;
  });
}
