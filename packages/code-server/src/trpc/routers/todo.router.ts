/**
 * Todo Router
 * Efficient todo management per session
 * SECURITY: Protected mutations (OWASP API2) + Rate limiting (OWASP API4)
 */

import { z } from 'zod';
import { router, publicProcedure, moderateProcedure } from '../trpc.js';

const TodoSchema = z.object({
  id: z.number(),
  content: z.string(),
  activeForm: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed']),
  ordering: z.number(),
});

export const todoRouter = router({
  /**
   * Update todos for session
   * Atomically replaces all todos
   * SECURITY: Protected + moderate rate limiting (30 req/min)
   */
  update: moderateProcedure
    .input(
      z.object({
        sessionId: z.string(),
        todos: z.array(TodoSchema),
        nextTodoId: z.number(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.sessionRepository.updateTodos(input.sessionId, input.todos, input.nextTodoId);
      // Note: Todos are stored per-session, no real-time sync needed
    }),

  // Note: Todo updates are persisted in database and loaded with session
  // No event stream needed as todos are not shared across clients
});
