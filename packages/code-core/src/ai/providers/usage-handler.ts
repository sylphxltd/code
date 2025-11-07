/**
 * Usage Handler
 * Handles token usage extraction and error handling
 */

/**
 * Extract usage tokens from result event
 */
export function extractUsage(event: unknown): { inputTokens: number; outputTokens: number } {
  if (
    !event ||
    typeof event !== 'object' ||
    !('usage' in event) ||
    !event.usage ||
    typeof event.usage !== 'object'
  ) {
    return { inputTokens: 0, outputTokens: 0 };
  }

  const usage = event.usage as Record<string, unknown>;
  const inputTokens =
    (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0) +
    (typeof usage.cache_creation_input_tokens === 'number'
      ? usage.cache_creation_input_tokens
      : 0) +
    (typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0);
  const outputTokens = typeof usage.output_tokens === 'number' ? usage.output_tokens : 0;

  return { inputTokens, outputTokens };
}

/**
 * Check and handle result errors
 */
export function handleResultError(event: unknown): void {
  if (!event || typeof event !== 'object' || !('subtype' in event)) {
    return;
  }

  if (event.subtype === 'error_max_turns') {
    throw new Error('Claude Code reached maximum turns limit');
  } else if (event.subtype === 'error_during_execution') {
    throw new Error('Error occurred during Claude Code execution');
  }
}
