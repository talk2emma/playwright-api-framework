/**
 * The response wrapper.
 *
 * This is the single highest-leverage class in the framework: every assertion
 * a test makes about an API goes through it. Two decisions shape it.
 *
 * First, the body is captured into a Buffer before this object exists, so the
 * response is a *snapshot*. It can be read as text, JSON, NDJSON, XML or bytes
 * as many times as you like, in any order, after the connection has closed —
 * which is what makes every method below synchronous and chainable.
 *
 * Second, assertions live here rather than in free functions, so a failing
 * check can put the request, the status, the timing and a body excerpt into
 * the message. An API assertion that only says `expected 200, got 500` costs
 * somebody twenty minutes; one that shows the error payload costs nothing.
 */
import { expect } from '@playwright/test';
import type { TestInfo } from '@playwright/test';
import type { z } from 'zod';
import type {
  ExchangeRecord,
  HeaderMap,
  RequestSpec,
  RequestTiming,
  UnknownRecord,
} from '../types';
import { SchemaValidationError, safeJson, truncate } from './errors';
import { readAll, readPath, hasPath, leafPaths } from '../utils/jsonpath.utils';
import {
  getHeader,
  isJsonContentType,
  nextLink,
  parseContentType,
  parseRateLimit,
  parseSetCookie,
  redactHeaders,
} from '../utils/header.utils';
import type { ParsedCookie, RateLimitInfo } from '../utils/header.utils';
import { looksLikeXml, parseXml, soapFault } from '../utils/xml.utils';
import type { SoapFault } from '../utils/xml.utils';
import { config } from '../config/env.config';

/** Everything captured from the wire. Immutable once the response is built. */
export interface ResponseSnapshot {
  readonly status: number;
  readonly statusText: string;
  readonly headers: HeaderMap;
  readonly body: Buffer;
  readonly url: string;
  readonly request: RequestSpec;
  readonly timing: RequestTiming;
}

/**
 * A completed HTTP exchange.
 *
 * The type parameter is the expected JSON shape. It is a convenience for
 * autocomplete, not a guarantee — use `parse(schema)` when you need the shape
 * actually checked at runtime.
 */
export class ApiResponse<T = unknown> {
  private readonly snapshot: ResponseSnapshot;
  private readonly softMode: boolean;
  /* Parsing is memoised: a test that reads `.json()` in five assertions should
   * not pay for five parses of the same buffer. */
  private parsedJson: { ok: true; value: unknown } | { ok: false; error: Error } | undefined;

  constructor(snapshot: ResponseSnapshot, softMode = false) {
    this.snapshot = snapshot;
    this.softMode = softMode;
  }

  /* ---------------------------------------------------------------- */
  /* Basic accessors                                                   */
  /* ---------------------------------------------------------------- */

  get status(): number {
    return this.snapshot.status;
  }

  get statusText(): string {
    return this.snapshot.statusText;
  }

  /** True for 2xx. Mirrors `Response.ok` in the Fetch API. */
  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  get url(): string {
    return this.snapshot.url;
  }

  /** All response headers, keys already lower-cased. */
  get headers(): HeaderMap {
    return this.snapshot.headers;
  }

  /** The request that produced this response — useful in failure messages. */
  get request(): RequestSpec {
    return this.snapshot.request;
  }

  get timing(): RequestTiming {
    return this.snapshot.timing;
  }

  /** Round-trip duration in milliseconds. */
  get durationMs(): number {
    return this.snapshot.timing.durationMs;
  }

  /** Payload size in bytes, as received. */
  get size(): number {
    return this.snapshot.body.byteLength;
  }

  /** Case-insensitive header lookup. */
  header(name: string): string | undefined {
    return getHeader(this.headers, name);
  }

  contentType(): string {
    return parseContentType(this.header('content-type')).mediaType;
  }

  /** Parsed `Set-Cookie` entries, with their attributes. */
  cookies(): ParsedCookie[] {
    return parseSetCookie(this.header('set-cookie'));
  }

  cookie(name: string): ParsedCookie | undefined {
    return this.cookies().find((entry) => entry.name === name);
  }

  /** Rate-limit counters, normalised across the common header spellings. */
  rateLimit(): RateLimitInfo {
    return parseRateLimit(this.headers);
  }

  /** The `next` URL from an RFC 8288 `Link` header, when present. */
  nextPageUrl(): string | undefined {
    return nextLink(this.header('link'));
  }

  /* ---------------------------------------------------------------- */
  /* Body readers                                                      */
  /* ---------------------------------------------------------------- */

  /** Raw bytes. Use for binary downloads, checksums and content-length checks. */
  buffer(): Buffer {
    return this.snapshot.body;
  }

  text(): string {
    return this.snapshot.body.toString('utf8');
  }

  /**
   * The body as JSON. Throws with a body excerpt when parsing fails — an HTML
   * error page returned where JSON was expected is a common and otherwise very
   * confusing failure.
   */
  json<J = T>(): J {
    const parsed = this.parse_();
    if (!parsed.ok) throw parsed.error;
    return parsed.value as J;
  }

  /** The body as JSON, or `undefined` when it is empty or not JSON at all. */
  jsonOrNull<J = T>(): J | undefined {
    const parsed = this.parse_();
    return parsed.ok ? (parsed.value as J) : undefined;
  }

  /** True when the body parses as JSON. */
  isJson(): boolean {
    return this.parse_().ok;
  }

  /** Newline-delimited JSON, one parsed value per non-empty line. */
  ndjson<J = T>(): J[] {
    return this.text()
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        try {
          return JSON.parse(line) as J;
        } catch (error) {
          throw new SyntaxError(
            `NDJSON line ${index + 1} is not valid JSON: ${line.slice(0, 200)}`,
            {
              cause: error,
            },
          );
        }
      });
  }

  /** The body parsed as XML, with namespace prefixes stripped. */
  xml(): UnknownRecord {
    return parseXml(this.text());
  }

  /** A SOAP fault when the body carries one — SOAP reports errors in the body. */
  fault(): SoapFault | undefined {
    return looksLikeXml(this.text()) ? soapFault(this.text()) : undefined;
  }

  /* ---------------------------------------------------------------- */
  /* Navigation                                                        */
  /* ---------------------------------------------------------------- */

  /** A single value by path, e.g. `data.items[0].id` or `..email`. */
  path<V = unknown>(jsonPath: string): V | undefined {
    return readPath(this.jsonOrNull(), jsonPath) as V | undefined;
  }

  /** Every value a path matches — wildcards and recursive descent return many. */
  paths<V = unknown>(jsonPath: string): V[] {
    return readAll(this.jsonOrNull(), jsonPath) as V[];
  }

  /** True when a path resolves to something. */
  has(jsonPath: string): boolean {
    return hasPath(this.jsonOrNull(), jsonPath);
  }

  /** Every leaf path in the payload — useful for detecting shape drift. */
  fields(): string[] {
    return leafPaths(this.jsonOrNull());
  }

  /**
   * Validates and returns the body with the schema's output type.
   *
   * This is the method to reach for when a test needs the payload, because it
   * makes the shape a checked fact rather than an assumption: everything after
   * it is fully typed and cannot silently be `undefined`.
   */
  parse<S extends z.ZodTypeAny>(schema: S, schemaName = 'response'): z.infer<S> {
    const result = schema.safeParse(this.jsonOrNull());
    if (!result.success) {
      throw new SchemaValidationError(
        schemaName,
        result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
        this.jsonOrNull(),
      );
    }
    return result.data as z.infer<S>;
  }

  /* ---------------------------------------------------------------- */
  /* Assertions                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Switches to soft assertions: every following check is recorded and the
   * test continues, so one run reports all the contract violations in a
   * payload rather than only the first.
   */
  soft(): ApiResponse<T> {
    return new ApiResponse<T>(this.snapshot, true);
  }

  /** Asserts the exact status, or one of several acceptable ones. */
  expectStatus(...codes: number[]): this {
    this.assert(codes.includes(this.status), `status to be ${codes.join(' or ')}`, this.status);
    return this;
  }

  /** Asserts any 2xx. */
  expectOk(): this {
    this.assert(this.ok, 'a 2xx status', this.status);
    return this;
  }

  /** Asserts a client error — the whole 4xx band, when the exact code varies. */
  expectClientError(): this {
    this.assert(this.status >= 400 && this.status < 500, 'a 4xx status', this.status);
    return this;
  }

  expectServerError(): this {
    this.assert(this.status >= 500, 'a 5xx status', this.status);
    return this;
  }

  /** Asserts a header exists, and optionally matches a value or pattern. */
  expectHeader(name: string, expected?: string | RegExp): this {
    const actual = this.header(name);
    if (expected === undefined) {
      this.assert(actual !== undefined, `header "${name}" to be present`, actual);
      return this;
    }
    const matches =
      typeof expected === 'string'
        ? actual === expected
        : actual !== undefined && expected.test(actual);
    this.assert(matches, `header "${name}" to be ${String(expected)}`, actual);
    return this;
  }

  /** Asserts the media type, ignoring `charset` and other parameters. */
  expectContentType(expected: string): this {
    this.assert(
      this.contentType() === expected.toLowerCase(),
      `content type ${expected}`,
      this.contentType(),
    );
    return this;
  }

  /** Asserts the body is JSON — catches HTML error pages early. */
  expectJson(): this {
    this.assert(
      isJsonContentType(this.header('content-type')) && this.isJson(),
      'a JSON body',
      truncate(this.text(), 200),
    );
    return this;
  }

  /** Asserts a value at a path. Accepts a literal, a RegExp or a predicate. */
  expectPath(jsonPath: string, expected: unknown): this {
    const actual = this.path(jsonPath);
    let matches: boolean;
    if (typeof expected === 'function') matches = (expected as (value: unknown) => boolean)(actual);
    else if (expected instanceof RegExp)
      matches = typeof actual === 'string' && expected.test(actual);
    else matches = safeJson(actual) === safeJson(expected);
    this.assert(matches, `${jsonPath} to be ${describe(expected)}`, actual);
    return this;
  }

  /** Asserts a path resolves to something. */
  expectPathExists(jsonPath: string): this {
    this.assert(this.has(jsonPath), `${jsonPath} to be present`, undefined);
    return this;
  }

  /** Asserts the payload contains at least these fields, ignoring extras. */
  expectSubset(expected: UnknownRecord): this {
    const actual = this.jsonOrNull();
    const missing: string[] = [];
    for (const [key, value] of Object.entries(expected)) {
      const found = readPath(actual, key);
      if (safeJson(found) !== safeJson(value))
        missing.push(`${key} (expected ${describe(value)}, got ${describe(found)})`);
    }
    this.assert(
      missing.length === 0,
      `payload to contain ${describe(expected)}`,
      missing.join('; '),
    );
    return this;
  }

  /** Validates against a Zod schema and reports every violation at once. */
  expectSchema<S extends z.ZodTypeAny>(schema: S, schemaName = 'response'): this {
    const result = schema.safeParse(this.jsonOrNull());
    const violations = result.success
      ? []
      : result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    this.assert(result.success, `payload to match schema "${schemaName}"`, violations.join('\n'));
    return this;
  }

  /** Asserts the response arrived inside an explicit budget. */
  expectFasterThan(milliseconds: number): this {
    this.assert(
      this.durationMs <= milliseconds,
      `a response within ${milliseconds}ms`,
      `${this.durationMs}ms`,
    );
    return this;
  }

  /** Asserts the response met the environment's configured latency budget. */
  expectWithinLatencyBudget(): this {
    return this.expectFasterThan(config.latencyBudgetMs);
  }

  /** Asserts an empty body — the correct shape for 204 and most DELETEs. */
  expectEmptyBody(): this {
    this.assert(this.size === 0, 'an empty body', `${this.size} bytes`);
    return this;
  }

  /** Asserts the security headers a public API is expected to send. */
  expectSecurityHeaders(): this {
    for (const [name, pattern] of Object.entries(REQUIRED_SECURITY_HEADERS)) {
      const value = this.header(name);
      this.assert(
        value !== undefined && pattern.test(value),
        `security header "${name}" (${String(pattern)})`,
        value,
      );
    }
    return this;
  }

  /* ---------------------------------------------------------------- */
  /* Reporting                                                         */
  /* ---------------------------------------------------------------- */

  /** A loggable record of the exchange, with credentials redacted. */
  toRecord(): ExchangeRecord {
    return {
      method: this.request.method,
      url: this.url,
      status: this.status,
      requestHeaders: redactHeaders(this.request.headers),
      responseHeaders: redactHeaders(this.headers),
      requestBody: describeRequestBody(this.request),
      responseBody: config.logBodies ? truncate(this.text(), 4000) : undefined,
      timing: this.timing,
      label: this.request.label,
    };
  }

  /**
   * Attaches the full exchange to the HTML report.
   *
   * Worth doing for any request whose failure would need investigation: the
   * attachment survives in CI long after the process is gone.
   */
  async attachTo(testInfo: TestInfo, name = this.request.label): Promise<void> {
    await testInfo.attach(`${name} — ${this.request.method} ${this.status}`, {
      body: safeJson(this.toRecord()),
      contentType: 'application/json',
    });
  }

  /** One-line summary used in step titles and logs. */
  describe(): string {
    return `${this.request.method} ${this.url} → ${this.status} (${this.durationMs}ms, ${this.size}B)`;
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private parse_(): { ok: true; value: unknown } | { ok: false; error: Error } {
    if (this.parsedJson) return this.parsedJson;
    const text = this.text();
    if (text.trim() === '') {
      this.parsedJson = { ok: false, error: new SyntaxError('The response body is empty.') };
      return this.parsedJson;
    }
    try {
      this.parsedJson = { ok: true, value: JSON.parse(text) };
    } catch (error) {
      this.parsedJson = {
        ok: false,
        error: new SyntaxError(
          `${this.request.method} ${this.url} returned ${this.status} with a body that is not ` +
            `JSON (content-type: ${this.header('content-type') ?? 'none'}).\n${truncate(text, 600)}`,
          { cause: error },
        ),
      };
    }
    return this.parsedJson;
  }

  /**
   * One assertion funnel, so every failure message has the same anatomy:
   * what was expected, what arrived, and which request produced it.
   */
  private assert(passed: boolean, expectation: string, actual: unknown): void {
    const message =
      `Expected ${expectation}.\n` +
      `  Request : ${this.request.method} ${this.url}\n` +
      `  Status  : ${this.status} ${this.statusText}\n` +
      `  Timing  : ${this.durationMs}ms\n` +
      `  Actual  : ${describe(actual)}`;
    if (this.softMode) expect.soft(passed, message).toBe(true);
    else expect(passed, message).toBe(true);
  }
}

/** Baseline security headers asserted by `expectSecurityHeaders()`. */
const REQUIRED_SECURITY_HEADERS: Record<string, RegExp> = {
  'x-content-type-options': /^nosniff$/i,
  'strict-transport-security': /max-age=\d+/i,
  'x-frame-options': /^(DENY|SAMEORIGIN)$/i,
  'cache-control': /.+/,
};

function describe(value: unknown): string {
  if (value === undefined) return '(absent)';
  if (value instanceof RegExp) return value.toString();
  if (typeof value === 'function') return 'a value satisfying the predicate';
  if (typeof value === 'string') return value.length > 300 ? truncate(value, 300) : value;
  return truncate(safeJson(value), 600);
}

/** Renders the outgoing body for logs without ever loading a whole upload. */
function describeRequestBody(request: RequestSpec): string | undefined {
  switch (request.bodyKind) {
    case 'json':
      return config.logBodies ? truncate(safeJson(request.json), 4000) : '[json body]';
    case 'form':
      return config.logBodies ? truncate(safeJson(request.form), 2000) : '[form body]';
    case 'text':
      return config.logBodies ? truncate(request.text ?? '', 2000) : '[text body]';
    case 'multipart':
      return `[multipart: ${(request.multipart ?? []).map((part) => part.name).join(', ')}]`;
    case 'binary':
      return `[binary: ${request.binary?.byteLength ?? 0} bytes]`;
    case 'none':
      return undefined;
  }
}
