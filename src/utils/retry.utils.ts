/**
 * Retrying and polling.
 *
 * The HTTP client already retries transport failures. This module covers the
 * other kind of waiting, the one that actually causes flaky API suites:
 * *eventual consistency*. A POST returns 201, and the resource is not in the
 * list endpoint yet because a queue has not drained. Sleeping for two seconds
 * hides it; polling for a condition with a deadline states it.
 *
 * The rule this module encodes: never sleep for a fixed duration when you can
 * poll for the thing you are actually waiting for.
 */
import { PollTimeoutError } from '../core/errors';
import { TIMEOUTS } from '../config/timeouts';
import { logger } from './logger';

const log = logger.child('retry');

export interface PollOptions {
  /** Total time to keep trying. */
  readonly timeout?: number;
  /** Gap between attempts. */
  readonly interval?: number;
  /** Text used in the timeout message: "waiting for <description>". */
  readonly description?: string;
  /** Multiplier applied to the interval after each attempt. 1 keeps it fixed. */
  readonly backoff?: number;
  /** Errors thrown by the probe are swallowed while polling when true. */
  readonly ignoreErrors?: boolean;
}

/**
 * Polls until a probe returns a truthy value, then returns it.
 *
 * The probe's own return value comes back, so the wait and the read are one
 * step: `const order = await waitFor(() => api.findOrder(id))`.
 */
export async function waitFor<T>(
  probe: () => Promise<T | undefined | null | false>,
  options: PollOptions = {},
): Promise<T> {
  const timeout = options.timeout ?? TIMEOUTS.POLL_TIMEOUT;
  const description = options.description ?? 'a condition';
  let interval = options.interval ?? TIMEOUTS.POLL_INTERVAL;
  const deadline = Date.now() + timeout;

  let attempts = 0;
  let last: unknown;

  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const value = await probe();
      if (value) return value;
      last = value;
    } catch (error) {
      if (!options.ignoreErrors) throw error;
      last = error instanceof Error ? error.message : String(error);
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(interval, remaining));
    if (options.backoff && options.backoff > 1) {
      interval = Math.min(interval * options.backoff, TIMEOUTS.RETRY_MAX_DELAY);
    }
  }

  throw new PollTimeoutError(description, timeout, attempts, last);
}

/** Polls until a predicate over a repeatedly-read value holds. */
export async function waitUntil<T>(
  read: () => Promise<T>,
  predicate: (value: T) => boolean,
  options: PollOptions = {},
): Promise<T> {
  return waitFor(async () => {
    const value = await read();
    return predicate(value) ? value : undefined;
  }, options);
}

/** Polls until a resource stops existing — the counterpart to `waitFor`. */
export async function waitUntilGone(
  exists: () => Promise<boolean>,
  options: PollOptions = {},
): Promise<void> {
  await waitFor(async () => !(await exists()), {
    description: 'the resource to disappear',
    ...options,
  });
}

export interface RetryOptions {
  /** Total attempts, including the first. */
  readonly attempts?: number;
  /** First delay; doubled each time up to the configured ceiling. */
  readonly delay?: number;
  /** Decides whether a given failure is worth retrying. */
  readonly retryIf?: (error: unknown, attempt: number) => boolean;
  /** Name used in the log line for each retry. */
  readonly description?: string;
}

/**
 * Retries an operation with exponential backoff and jitter.
 *
 * Use for genuinely transient work — a flaky third-party sandbox, a service
 * that returns 503 while a deployment finishes. Never wrap an assertion in
 * this: retrying until a test passes is how a real defect gets shipped.
 */
export async function retry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const description = options.description ?? 'operation';
  let delay = options.delay ?? TIMEOUTS.RETRY_BASE_DELAY;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (options.retryIf && !options.retryIf(error, attempt)) throw error;
      if (attempt === attempts) break;
      log.warn(`${description} failed; retrying`, {
        attempt,
        of: attempts,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(delay + Math.floor(Math.random() * TIMEOUTS.RETRY_BASE_DELAY));
      delay = Math.min(delay * 2, TIMEOUTS.RETRY_MAX_DELAY);
    }
  }
  throw lastError;
}

/**
 * Runs an operation with a hard deadline.
 *
 * The underlying work is not cancelled — nothing in JavaScript can force that
 * — but the caller stops waiting, which is what keeps one hung request from
 * consuming a whole test's budget.
 */
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeout: number,
  description = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new PollTimeoutError(description, timeout, 1));
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A plain delay.
 *
 * Exported because a few situations genuinely need one — respecting a
 * documented rate-limit window, or letting a clock tick past a whole second
 * before asserting on a timestamp. If you are reaching for it to make a test
 * pass, reach for `waitFor` instead.
 */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Runs tasks with a concurrency ceiling.
 *
 * Seeding a hundred records with `Promise.all` will trip the API's rate limit
 * and produce a wall of 429s; this keeps the fan-out deliberate.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index] as T, index);
    }
  });

  await Promise.all(runners);
  return results;
}
