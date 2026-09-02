/**
 * The framework's error hierarchy.
 *
 * Every failure the framework raises itself is one of these, so a test can
 * distinguish "the API said no" from "the framework is misconfigured" from
 * "the payload does not match its contract" — three problems with three very
 * different owners. Each message is written to be actionable on its own,
 * because in CI the message is often all anyone sees.
 */
import type { ExchangeRecord, HttpMethod } from '../types';

/** Base class, so `catch (e) { if (e instanceof FrameworkError) ... }` works. */
export class FrameworkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    /* Keeps the stack pointing at the caller rather than at this constructor. */
    Error.captureStackTrace(this, new.target);
  }
}

/** The environment or `.env` file is wrong. Raised before any request is sent. */
export class ConfigurationError extends FrameworkError {}

/** A response arrived, but not one the caller was willing to accept. */
export class HttpError extends FrameworkError {
  readonly status: number;
  readonly method: HttpMethod;
  readonly url: string;
  readonly body: string;
  readonly expected: number[];

  constructor(input: {
    status: number;
    method: HttpMethod;
    url: string;
    body: string;
    expected: number[];
  }) {
    super(
      `${input.method} ${input.url} responded ${input.status}, expected ` +
        `${input.expected.join(' or ')}.\n${truncate(input.body, 800)}`,
    );
    this.status = input.status;
    this.method = input.method;
    this.url = input.url;
    this.body = input.body;
    this.expected = input.expected;
  }
}

/** The request never completed within its timeout. */
export class RequestTimeoutError extends FrameworkError {
  constructor(
    readonly method: HttpMethod,
    readonly url: string,
    readonly timeoutMs: number,
    options?: { cause?: unknown },
  ) {
    super(`${method} ${url} did not respond within ${timeoutMs}ms.`, options);
  }
}

/** The transport failed: DNS, TLS, connection reset, unreachable host. */
export class TransportError extends FrameworkError {
  constructor(
    readonly method: HttpMethod,
    readonly url: string,
    detail: string,
    options?: { cause?: unknown },
  ) {
    super(`${method} ${url} failed before a response was received: ${detail}`, options);
  }
}

/** A payload did not match the schema it was validated against. */
export class SchemaValidationError extends FrameworkError {
  constructor(
    readonly schemaName: string,
    readonly violations: string[],
    readonly payload?: unknown,
  ) {
    super(
      `Payload does not match schema "${schemaName}":\n` +
        violations.map((v) => `  - ${v}`).join('\n') +
        (payload === undefined ? '' : `\n\nReceived:\n${truncate(safeJson(payload), 1200)}`),
    );
  }
}

/** The response disagreed with the OpenAPI document for that operation. */
export class ContractViolationError extends FrameworkError {
  constructor(
    readonly operation: string,
    readonly violations: string[],
  ) {
    super(
      `Response for ${operation} violates the API contract:\n` +
        violations.map((v) => `  - ${v}`).join('\n'),
    );
  }
}

/** A token could not be obtained or refreshed. */
export class AuthenticationError extends FrameworkError {
  constructor(provider: string, detail: string, options?: { cause?: unknown }) {
    super(
      `Authentication provider "${provider}" could not produce credentials: ${detail}`,
      options,
    );
  }
}

/** A `waitFor`-style helper gave up before its condition became true. */
export class PollTimeoutError extends FrameworkError {
  constructor(
    description: string,
    readonly timeoutMs: number,
    readonly attempts: number,
    readonly lastValue?: unknown,
  ) {
    super(
      `Timed out after ${timeoutMs}ms (${attempts} attempts) waiting for ${description}.` +
        (lastValue === undefined ? '' : `\nLast value: ${truncate(safeJson(lastValue), 600)}`),
    );
  }
}

/** A mutating verb was attempted against an environment marked read-only. */
export class ReadOnlyEnvironmentError extends FrameworkError {
  constructor(method: HttpMethod, url: string, environment: string) {
    super(
      `Refusing to send ${method} ${url}: the "${environment}" environment is marked ` +
        `read-only in src/config/environments.ts. Point TEST_ENV at a writable ` +
        `environment, or mark the test @read-only.`,
    );
  }
}

/** A response was slower than the configured latency budget. */
export class LatencyBudgetError extends FrameworkError {
  constructor(record: ExchangeRecord, budgetMs: number) {
    super(
      `${record.method} ${record.url} took ${record.timing.durationMs}ms, over the ` +
        `${budgetMs}ms budget. Raise LATENCY_BUDGET_MS, or the environment's ` +
        `latencyBudgetMs, if this is expected.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Keeps error messages readable when a server returns a very large body. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
}

/** `JSON.stringify` that never throws on cycles or BigInt. */
export function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === 'bigint') return item.toString();
        if (typeof item === 'object' && item !== null) {
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return item;
      },
      2,
    );
  } catch {
    return String(value);
  }
}
