/**
 * Custom `expect` matchers for API responses.
 *
 * The response wrapper already carries assertion methods. These matchers exist
 * for the cases where `expect(...)` reads better — particularly negated
 * assertions, `expect.soft`, and anywhere a reviewer expects to see the
 * familiar `expect(actual).toX(expected)` shape.
 *
 * Every matcher returns a message that includes the request that produced the
 * response, because an API failure without its request is a puzzle.
 */
import { expect as baseExpect } from '@playwright/test';
import type { z } from 'zod';
import type { ApiResponse } from '../core/api.response';
import { validateJsonSchema } from '../contracts/json-schema';
import type { OpenApiContract } from '../contracts/openapi';
import { safeJson, truncate } from '../core/errors';
import { diff, formatDiff } from '../utils/diff.utils';
import type { DiffOptions } from '../utils/diff.utils';

/**
 * What every matcher returns: whether it passed, and a message built lazily so
 * the (potentially large) body excerpt is only rendered when it is needed.
 */
interface MatcherResult {
  pass: boolean;
  message: () => string;
}

/** Context line shared by every matcher's failure message. */
function context(response: ApiResponse): string {
  return (
    `\n  Request : ${response.request.method} ${response.url}` +
    `\n  Status  : ${response.status} ${response.statusText}` +
    `\n  Timing  : ${response.durationMs}ms` +
    `\n  Body    : ${truncate(response.text(), 800)}`
  );
}

/**
 * `expect.extend` returns a *new* `expect` carrying the matchers' types, which
 * is why the result is captured rather than discarded. Mutating the global
 * `expect` would register the matchers at runtime but leave TypeScript unaware
 * of them, and every call site would fail to compile.
 */
export const expect = baseExpect.extend({
  /** `expect(response).toHaveStatus(201)` */
  toHaveStatus(response: ApiResponse, expected: number | number[]): MatcherResult {
    const codes = Array.isArray(expected) ? expected : [expected];
    const pass = codes.includes(response.status);
    return {
      pass,
      message: () =>
        pass
          ? `Expected status not to be ${codes.join(' or ')}.${context(response)}`
          : `Expected status ${codes.join(' or ')}, received ${response.status}.${context(response)}`,
    };
  },

  /** `expect(response).toBeSuccessful()` — any 2xx. */
  toBeSuccessful(response: ApiResponse): MatcherResult {
    return {
      pass: response.ok,
      message: () =>
        response.ok
          ? `Expected a non-2xx status, received ${response.status}.${context(response)}`
          : `Expected a 2xx status, received ${response.status}.${context(response)}`,
    };
  },

  /** `expect(response).toHaveHeader('etag', /".+"/)` */
  toHaveHeader(response: ApiResponse, name: string, expected?: string | RegExp): MatcherResult {
    const actual = response.header(name);
    const pass =
      actual !== undefined &&
      (expected === undefined ||
        (typeof expected === 'string' ? actual === expected : expected.test(actual)));
    return {
      pass,
      message: () =>
        pass
          ? `Expected no header "${name}"${expected ? ` matching ${String(expected)}` : ''}.`
          : `Expected header "${name}"${expected ? ` to match ${String(expected)}` : ' to be present'}, ` +
            `received ${actual ?? '(absent)'}.${context(response)}`,
    };
  },

  /** `expect(response).toMatchSchema(UserSchema)` — Zod. */
  toMatchSchema(response: ApiResponse, schema: z.ZodTypeAny, name = 'schema'): MatcherResult {
    const result = schema.safeParse(response.jsonOrNull());
    const violations = result.success
      ? []
      : result.error.issues.map(
          (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
        );
    return {
      pass: result.success,
      message: () =>
        result.success
          ? `Expected the payload not to match "${name}".`
          : `Payload does not match "${name}":\n${violations.join('\n')}${context(response)}`,
    };
  },

  /** `expect(response).toMatchJsonSchema(schemaDocument)` — JSON Schema. */
  toMatchJsonSchema(response: ApiResponse, schema: object): MatcherResult {
    const result = validateJsonSchema(schema, response.jsonOrNull());
    return {
      pass: result.valid,
      message: () =>
        result.valid
          ? `Expected the payload not to satisfy the JSON Schema.`
          : `Payload violates the JSON Schema:\n${result.errors.map((e) => `  - ${e}`).join('\n')}${context(response)}`,
    };
  },

  /** `expect(response).toSatisfyContract(spec)` — the OpenAPI document. */
  toSatisfyContract(response: ApiResponse, contract: OpenApiContract): MatcherResult {
    const result = contract.validate(
      response.request.method,
      response.url,
      response.status,
      response.jsonOrNull(),
    );
    return {
      pass: result.valid,
      message: () =>
        result.valid
          ? `Expected the response to violate the published contract.`
          : `Response violates the published contract:\n${result.errors.map((e) => `  - ${e}`).join('\n')}${context(response)}`,
    };
  },

  /** `expect(response).toHaveJsonPath('data.id', 42)` */
  toHaveJsonPath(response: ApiResponse, jsonPath: string, expected?: unknown): MatcherResult {
    const actual = response.path(jsonPath);
    const pass =
      expected === undefined ? actual !== undefined : safeJson(actual) === safeJson(expected);
    return {
      pass,
      message: () =>
        pass
          ? `Expected "${jsonPath}" not to be ${safeJson(expected)}.`
          : `Expected "${jsonPath}" to be ${expected === undefined ? 'present' : safeJson(expected)}, ` +
            `received ${safeJson(actual)}.${context(response)}`,
    };
  },

  /** `expect(response).toRespondWithin(500)` */
  toRespondWithin(response: ApiResponse, milliseconds: number): MatcherResult {
    const pass = response.durationMs <= milliseconds;
    return {
      pass,
      message: () =>
        pass
          ? `Expected the response to take longer than ${milliseconds}ms.`
          : `Expected a response within ${milliseconds}ms, took ${response.durationMs}ms.${context(response)}`,
    };
  },

  /**
   * `expect(payload).toMatchPayload(baseline, { ignore: VOLATILE_FIELDS })`
   *
   * A structural comparison whose failure message is a diff rather than two
   * pretty-printed objects, because finding one changed field inside a large
   * response by eye is genuinely difficult.
   */
  toMatchPayload(actual: unknown, expected: unknown, options: DiffOptions = {}): MatcherResult {
    const differences = diff(expected, actual, options);
    return {
      pass: differences.length === 0,
      message: () =>
        differences.length === 0
          ? `Expected the payloads to differ.`
          : `Payloads differ:\n${formatDiff(differences)}`,
    };
  },
});
