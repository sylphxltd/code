/**
 * Retry Utility
 * Unified retry logic with exponential backoff
 *
 * Replaces duplicate retry implementations across the codebase:
 * - session-repository.ts (retryOnBusy)
 * - openrouter-provider.ts (network retry)
 * - Other database/network operations
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: 100) */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Maximum delay cap in milliseconds (default: 10000 = 10s) */
  maxDelayMs?: number;
  /** Predicate to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelayMs: 100,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
  shouldRetry: () => true,
  onRetry: () => {},
};

/**
 * Execute an operation with retry logic and exponential backoff
 *
 * @example
 * ```typescript
 * // Database operation with SQLITE_BUSY retry
 * const session = await retry(
 *   () => db.select().from(sessions).where(eq(sessions.id, id)),
 *   { shouldRetry: isSQLiteBusyError }
 * );
 *
 * // Network operation with default retry
 * const data = await retry(
 *   () => fetch('https://api.example.com/data'),
 *   { maxRetries: 2, initialDelayMs: 50 }
 * );
 * ```
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // Check if we should retry this error
      if (!opts.shouldRetry(error, attempt)) {
        throw error;
      }

      // Check if we've exhausted retries
      if (attempt >= opts.maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.backoffMultiplier, attempt),
        opts.maxDelayMs
      );

      // Invoke retry callback
      opts.onRetry(error, attempt + 1, delay);

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  // All retries exhausted
  throw lastError;
}

/**
 * Predicate: Check if error is SQLITE_BUSY
 */
export function isSQLiteBusyError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message);
    return message.includes('SQLITE_BUSY');
  }
  if (error && typeof error === 'object' && 'code' in error) {
    return error.code === 'SQLITE_BUSY';
  }
  return false;
}

/**
 * Predicate: Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String(error.message).toLowerCase();
    return (
      message.includes('fetch') ||
      message.includes('network') ||
      message.includes('timeout') ||
      message.includes('econnrefused') ||
      message.includes('enotfound')
    );
  }
  return false;
}

/**
 * Predicate: Retry all errors (default behavior)
 */
export function retryAllErrors(): boolean {
  return true;
}

/**
 * Convenience function: Retry database operations with SQLITE_BUSY handling
 */
export async function retryDatabase<T>(
  operation: () => Promise<T>,
  maxRetries = 5
): Promise<T> {
  return retry(operation, {
    maxRetries,
    initialDelayMs: 50,
    shouldRetry: isSQLiteBusyError,
  });
}

/**
 * Convenience function: Retry network operations
 */
export async function retryNetwork<T>(
  operation: () => Promise<T>,
  maxRetries = 2
): Promise<T> {
  return retry(operation, {
    maxRetries,
    initialDelayMs: 100,
    shouldRetry: isNetworkError,
  });
}
