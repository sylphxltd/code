/**
 * Retry Utility
 * Unified retry logic with exponential backoff
 *
 * Replaces duplicate retry implementations across the codebase:
 * - session-repository.ts (retryOnBusy)
 * - openrouter-provider.ts (network retry)
 * - Other database/network operations
 */

import { RETRY } from '../constants/index.js';

export interface RetryOptions {
  /** Maximum number of retry attempts (default: from RETRY.DEFAULT_MAX_RETRIES) */
  maxRetries?: number;
  /** Initial delay in milliseconds (default: from RETRY.INITIAL_DELAY_MS) */
  initialDelayMs?: number;
  /** Multiplier for exponential backoff (default: from RETRY.BACKOFF_MULTIPLIER) */
  backoffMultiplier?: number;
  /** Maximum delay cap in milliseconds (default: from RETRY.MAX_DELAY_MS) */
  maxDelayMs?: number;
  /** Predicate to determine if error should be retried */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Callback invoked on each retry attempt */
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: RETRY.DEFAULT_MAX_RETRIES,
  initialDelayMs: RETRY.INITIAL_DELAY_MS,
  backoffMultiplier: RETRY.BACKOFF_MULTIPLIER,
  maxDelayMs: RETRY.MAX_DELAY_MS,
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
 * Checks error message, code, and nested cause for SQLITE_BUSY errors
 */
export function isSQLiteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  // Check error message
  if ('message' in error) {
    const message = String(error.message);
    if (message.includes('SQLITE_BUSY') || message.includes('database is locked')) {
      return true;
    }
  }

  // Check error code
  if ('code' in error && error.code === 'SQLITE_BUSY') {
    return true;
  }

  // Check nested cause (DrizzleQueryError -> LibsqlError)
  if ('cause' in error && error.cause && typeof error.cause === 'object') {
    if ('code' in error.cause && error.cause.code === 'SQLITE_BUSY') {
      return true;
    }
    // Recursively check nested causes
    if (isSQLiteBusyError(error.cause)) {
      return true;
    }
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
  maxRetries = RETRY.DATABASE_MAX_RETRIES
): Promise<T> {
  return retry(operation, {
    maxRetries,
    initialDelayMs: RETRY.DATABASE_INITIAL_DELAY_MS,
    shouldRetry: isSQLiteBusyError,
  });
}

/**
 * Convenience function: Retry network operations
 */
export async function retryNetwork<T>(
  operation: () => Promise<T>,
  maxRetries = RETRY.NETWORK_MAX_RETRIES
): Promise<T> {
  return retry(operation, {
    maxRetries,
    initialDelayMs: RETRY.INITIAL_DELAY_MS,
    shouldRetry: isNetworkError,
  });
}
