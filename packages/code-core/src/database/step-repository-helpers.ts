/**
 * Step Repository Helpers
 * Helper functions for step-based CRUD operations
 *
 * TEMPORARY: These helpers will be integrated into SessionRepository
 * For now, they exist as standalone functions to avoid breaking existing code
 */

import { eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { messageSteps, stepParts, stepUsage, type NewMessageStep } from "./schema.js";
import type {
	MessageStep,
	MessagePart,
	TokenUsage,
	MessageMetadata,
	SystemMessage,
} from "../types/session.types.js";
import type { Todo as TodoType } from "../types/todo.types.js";
import { retryDatabase } from "../utils/retry.js";

/**
 * Zod schemas for validating JSON data from database
 */
const MessagePartSchema: z.ZodType<MessagePart> = z.any(); // ASSUMPTION: MessagePart already validated when inserted
const SystemMessageSchema: z.ZodType<SystemMessage> = z.any(); // ASSUMPTION: SystemMessage already validated when inserted
const MessageMetadataSchema = z.object({
	cpu: z.string().optional(),
	memory: z.string().optional(),
}).passthrough(); // Allow additional fields for future extensions

/**
 * Create a new step in a message
 *
 * @param systemMessages Optional system messages to insert BEFORE this step (for LLM context)
 * @param todoSnapshot DEPRECATED - No longer stored per-step
 *   Todos are only sent on first user message after /compact
 *   This parameter is kept for backward compatibility but ignored
 */
export async function createMessageStep(
	db: LibSQLDatabase,
	messageId: string,
	stepIndex: number,
	metadata?: MessageMetadata,
	_todoSnapshot?: TodoType[],
	systemMessages?: SystemMessage[],
): Promise<string> {
	const stepId = `${messageId}-step-${stepIndex}`;
	const now = Date.now();

	await retryDatabase(() =>
		db.transaction(async (tx) => {
			// Insert step
			const newStep: NewMessageStep = {
				id: stepId,
				messageId,
				stepIndex,
				systemMessages:
					systemMessages && systemMessages.length > 0 ? JSON.stringify(systemMessages) : null,
				status: "active",
				metadata: metadata ? JSON.stringify(metadata) : null,
				startTime: now,
				endTime: null,
				provider: null,
				model: null,
				duration: null,
				finishReason: null,
			};

			await tx.insert(messageSteps).values(newStep);

			// REMOVED: stepTodoSnapshots - no longer stored per-step
			// Todos are only sent on first user message after /compact
		}),
	);

	return stepId;
}

/**
 * Update step parts (used during streaming)
 */
export async function updateStepParts(
	db: LibSQLDatabase,
	stepId: string,
	parts: MessagePart[],
): Promise<void> {
	await retryDatabase(() =>
		db.transaction(async (tx) => {
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
		}),
	);
}

/**
 * Complete a step with final metadata
 */
export async function completeMessageStep(
	db: LibSQLDatabase,
	stepId: string,
	options: {
		status: "completed" | "error" | "abort";
		finishReason?: string;
		usage?: TokenUsage;
		provider?: string;
		model?: string;
	},
): Promise<void> {
	const endTime = Date.now();

	await retryDatabase(() =>
		db.transaction(async (tx) => {
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
					// Ensure all token fields have valid numbers (default to 0 if null/undefined)
					promptTokens: options.usage.promptTokens ?? 0,
					completionTokens: options.usage.completionTokens ?? 0,
					totalTokens: options.usage.totalTokens ?? 0,
				});
			}
		}),
	);
}

/**
 * Load steps for a message
 */
export async function loadMessageSteps(
	db: LibSQLDatabase,
	messageId: string,
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
	const [allParts, allUsage] = await Promise.all([
		db
			.select()
			.from(stepParts)
			.where(inArray(stepParts.stepId, stepIds))
			.orderBy(stepParts.ordering),
		db.select().from(stepUsage).where(inArray(stepUsage.stepId, stepIds)),
	]);

	// Group by step ID
	const partsByStep = new Map<string, typeof allParts>();
	const usageByStep = new Map<string, (typeof allUsage)[0]>();

	for (const part of allParts) {
		if (!partsByStep.has(part.stepId)) {
			partsByStep.set(part.stepId, []);
		}
		partsByStep.get(part.stepId)!.push(part);
	}

	for (const usage of allUsage) {
		usageByStep.set(usage.stepId, usage);
	}

	// Assemble steps
	return stepRecords.map((step) => {
		const parts = partsByStep.get(step.id) || [];
		const usage = usageByStep.get(step.id);

		const messageStep: MessageStep = {
			id: step.id,
			stepIndex: step.stepIndex,
			parts: parts.map((p) => {
			const parsed = MessagePartSchema.safeParse(JSON.parse(p.content));
			return parsed.success ? parsed.data as MessagePart : JSON.parse(p.content) as MessagePart;
		}),
			status: (step.status as "active" | "completed" | "error" | "abort") || "completed",
		};

		if (step.systemMessages) {
			try {
				const parsedSys = z.array(SystemMessageSchema).safeParse(JSON.parse(step.systemMessages));
			if (parsedSys.success) {
				messageStep.systemMessages = parsedSys.data as SystemMessage[];
			} else {
				console.error("[loadMessageSteps] Failed to validate systemMessages:", parsedSys.error);
			}
			} catch (error) {
				console.error("[loadMessageSteps] Failed to parse systemMessages:", error);
			}
		}

		if (step.metadata) {
			const parsedMeta = MessageMetadataSchema.safeParse(JSON.parse(step.metadata));
		if (parsedMeta.success) {
			messageStep.metadata = parsedMeta.data;
		} else {
			// Skip corrupted metadata - use empty object as fallback
			messageStep.metadata = {};
		}
		}

		// REMOVED: todoSnapshot - no longer stored per-step
		// Todos are only sent on first user message after /compact

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
			messageStep.finishReason = step.finishReason as "stop" | "tool-calls" | "length" | "error";
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
