/**
 * Named time budgets.
 *
 * Tests and helpers refer to these constants instead of writing raw numbers,
 * so a slow environment is retuned in one place and every magic number in the
 * suite carries an explanation of what it is waiting for.
 */
export const TIMEOUTS = {
  /** A health check or cached read. Anything slower is a red flag. */
  INSTANT: 1_000,
  /** A normal single-resource read. */
  SHORT: 5_000,
  /** A write, or a read that fans out to other services. */
  MEDIUM: 15_000,
  /** Report generation, bulk import, anything queued. */
  LONG: 30_000,
  /** File upload or download of a large payload. */
  EXTRA_LONG: 120_000,

  /** Whole-test budget applied by `playwright.config.ts`. */
  TEST: 60_000,
  /** Budget for `beforeAll` / `afterAll` blocks, which do seeding. */
  HOOK: 90_000,
  /** Budget for a single `expect(...)` with web-first retry semantics. */
  EXPECT: 10_000,

  /** How long `waitFor` helpers keep polling before giving up. */
  POLL_TIMEOUT: 30_000,
  /** Gap between polls when waiting for eventual consistency. */
  POLL_INTERVAL: 500,

  /** First delay in the exponential backoff used by the retry helper. */
  RETRY_BASE_DELAY: 300,
  /** Ceiling for backoff, so a long retry chain cannot stall a run. */
  RETRY_MAX_DELAY: 5_000,

  /** How long a streaming reader waits for the next SSE or NDJSON event. */
  STREAM_IDLE: 15_000,
  /** How long a WebSocket wait-for-message call blocks. */
  SOCKET_MESSAGE: 10_000,
} as const;
