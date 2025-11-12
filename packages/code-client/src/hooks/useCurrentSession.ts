/**
 * useCurrentSession Hook
 * Fetches current session data from server using tRPC
 *
 * Pure Data Fetching Hook:
 * - Fetches session from server when currentSessionId changes
 * - Respects streaming state (won't overwrite optimistic data during streaming)
 * - Emits events for cross-store communication (no direct store imports)
 * - Simple, focused responsibility: fetch data and emit events
 */

import { useEffect, useState, useRef } from "react";
import type { Session } from "@sylphx/code-core";
import { getTRPCClient } from "../trpc-provider.js";
import {
	useCurrentSessionId,
	useCurrentSession as useOptimisticSession,
	useIsStreaming,
	setCurrentSession,
	$isStreaming,
	$currentSession,
} from "../signals/domain/session/index.js";
import { eventBus } from "../lib/event-bus.js";
import { get } from "@sylphx/zen";

export function useCurrentSession() {
	const currentSessionId = useCurrentSessionId();
	const optimisticSession = useOptimisticSession();
	const isStreaming = useIsStreaming();

	const [serverSession, setServerSession] = useState<Session | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<Error | null>(null);

	// Track previous session ID to detect temp-session → real session transition
	const prevSessionIdRef = useRef<string | null>(null);

	// Fetch session data from server when currentSessionId changes
	useEffect(() => {
		console.log("[useCurrentSession] Effect triggered, currentSessionId:", currentSessionId, "prev:", prevSessionIdRef.current);

		const prevSessionId = prevSessionIdRef.current;
		prevSessionIdRef.current = currentSessionId;

		if (!currentSessionId) {
			setServerSession(null);
			setIsLoading(false);
			setError(null);
			return;
		}

		// Skip server fetch if we have optimistic data for a temp session
		if (currentSessionId === "temp-session") {
			setIsLoading(false);
			return;
		}

		// RACE CONDITION FIX: If we just transitioned from temp-session,
		// don't fetch from server immediately (would overwrite optimistic messages)
		// The session-created event handler will set up the session with preserved messages.
		// Let the streaming flow complete first, then session will be synced via events.
		if (prevSessionId === "temp-session" && currentSessionId !== "temp-session") {
			console.log("[useCurrentSession] Just transitioned from temp-session, skipping immediate fetch");
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		setError(null);

		console.log("[useCurrentSession] Fetching session from server:", currentSessionId);
		const client = getTRPCClient();
		client.session.getById
			.query({ sessionId: currentSessionId })
			.then((session) => {
				console.log("[useCurrentSession] Got session from server, messages count:", session?.messages?.length);
				setServerSession(session);
				setIsLoading(false);

				// Only update store and emit events if not streaming
				// During streaming, optimistic data is authoritative
				if (!get($isStreaming)) {
					console.log("[useCurrentSession] Not streaming, updating store...");
					// IMPORTANT: Merge with existing optimistic messages (don't overwrite)
					// System messages may have been added by events after this query started
					const currentOptimistic = get($currentSession);
					console.log("[useCurrentSession] Current optimistic session:", currentOptimistic?.id, "messages:", currentOptimistic?.messages?.length);

					// Always merge if we have optimistic data (even if session IDs don't match)
					// This handles the case where temp-session → real session transition
					if (
						currentOptimistic &&
						currentOptimistic.messages &&
						currentOptimistic.messages.length > 0
					) {
						// Merge: keep messages that exist in optimistic but not in server response
						// Include: system/assistant messages + temp user messages (id starts with "temp-")
						// Exclude: real user messages (handled by user-message-created event)
						const serverMessageIds = new Set(session.messages.map((m) => m.id));
						const optimisticOnlyMessages = currentOptimistic.messages.filter(
							(m) => !serverMessageIds.has(m.id) && (m.role !== "user" || m.id.startsWith("temp-")),
						);

						if (optimisticOnlyMessages.length > 0) {
							console.log("[useCurrentSession] Merging optimistic messages, server:", session.messages.length, "optimistic:", optimisticOnlyMessages.length);
							setCurrentSession({
								...session,
								messages: [...session.messages, ...optimisticOnlyMessages],
							});
						} else {
							// No extra messages to merge
							console.log("[useCurrentSession] No optimistic messages to merge, using server data directly");
							setCurrentSession(session);
						}
					} else {
						// No optimistic data to merge
						console.log("[useCurrentSession] No optimistic data, using server data directly");
						setCurrentSession(session);
					}

					// Emit event for other stores to react (e.g., settings store updates rules)
					eventBus.emit("session:loaded", {
						sessionId: session.id,
						enabledRuleIds: session.enabledRuleIds || [],
					});
				}
			})
			.catch((err) => {
				setError(err as Error);
				setIsLoading(false);
			});
	}, [currentSessionId]);

	// Return optimistic data if available (instant UI), otherwise server data
	const currentSession = optimisticSession || serverSession;

	return {
		currentSession,
		currentSessionId,
		isStreaming,
		isLoading,
		error,
	};
}
