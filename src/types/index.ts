/**
 * Shared vocabulary for the whole framework.
 *
 * These types exist so that the request builder, the HTTP client, the response
 * wrapper, the auth providers and the reporters all describe a request the
 * same way. Changing the shape of a request is therefore a single edit here
 * plus the compiler telling you every place that has to keep up.
 */

/** Every verb the client can issue. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/** Verbs that must not run against a read-only environment. */
export const MUTATING_METHODS: readonly HttpMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/* ------------------------------------------------------------------ */
/* JSON                                                                */
/* ------------------------------------------------------------------ */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

/* ------------------------------------------------------------------ */
/* Request pieces                                                      */
/* ------------------------------------------------------------------ */

/** A single query-string value. Arrays are repeated as `?tag=a&tag=b`. */
export type QueryValue = string | number | boolean | null | undefined | (string | number)[];

export type QueryParams = Record<string, QueryValue>;

/** Header names are compared case-insensitively throughout the framework. */
export type HeaderMap = Record<string, string>;

/** Values substituted into a templated path such as `/users/{id}`. */
export type PathParams = Record<string, string | number>;

/** One part of a `multipart/form-data` upload. */
export interface MultipartPart {
  /** Field name in the form. */
  readonly name: string;
  /** Inline value, for a plain text field. */
  readonly value?: string;
  /** Path on disk; read at send time so large files are not held in memory twice. */
  readonly filePath?: string;
  /** In-memory file content, when the payload is generated rather than read. */
  readonly buffer?: Buffer;
  /** File name reported to the server. Defaults to the basename of `filePath`. */
  readonly fileName?: string;
  /** MIME type reported to the server. Guessed from the extension when omitted. */
  readonly mimeType?: string;
}

/** How the request body is encoded on the wire. */
export type BodyKind = 'none' | 'json' | 'form' | 'multipart' | 'text' | 'binary';

/** A fully resolved request, ready to be sent. Produced by the request builder. */
export interface RequestSpec {
  readonly method: HttpMethod;
  /** Absolute URL, already resolved from path, path params and query. */
  readonly url: string;
  readonly headers: HeaderMap;
  readonly bodyKind: BodyKind;
  readonly json?: unknown;
  readonly form?: Record<string, string | number | boolean>;
  readonly multipart?: MultipartPart[];
  readonly text?: string;
  readonly binary?: Buffer;
  /** Milliseconds before the request is aborted. */
  readonly timeout: number;
  /** How many times a retryable failure is retried. */
  readonly retries: number;
  /** Status codes accepted without triggering the client's failure path. */
  readonly expectStatus?: number[];
  /** Label used in traces, logs and the step title. */
  readonly label: string;
  /** Skips auth injection for this one call — used to test the 401 path. */
  readonly anonymous: boolean;
  /** Follows 3xx responses when true; when false the redirect itself is asserted. */
  readonly followRedirects: boolean;
  /** Arbitrary metadata carried into the request log. */
  readonly meta: Record<string, string | number | boolean>;
}

/* ------------------------------------------------------------------ */
/* Observability                                                       */
/* ------------------------------------------------------------------ */

/** Wall-clock timings captured for every request. */
export interface RequestTiming {
  /** Epoch milliseconds when the request was issued. */
  readonly startedAt: number;
  /** Total round trip in milliseconds, including retries of this attempt only. */
  readonly durationMs: number;
  /** Which attempt produced the recorded response, 1-based. */
  readonly attempts: number;
}

/** One completed exchange, as written to the run log and the HTML report. */
export interface ExchangeRecord {
  readonly method: HttpMethod;
  readonly url: string;
  readonly status: number;
  readonly requestHeaders: HeaderMap;
  readonly responseHeaders: HeaderMap;
  readonly requestBody?: string;
  readonly responseBody?: string;
  readonly timing: RequestTiming;
  readonly label: string;
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

/** Outcome of a schema or contract check. */
export interface ValidationResult {
  readonly valid: boolean;
  /** One human-readable line per violation, empty when `valid`. */
  readonly errors: string[];
  /** The parsed and, where the validator narrows types, coerced value. */
  readonly value?: unknown;
}

/** A page of results plus whatever the API uses to reach the next one. */
export interface Page<T> {
  readonly items: T[];
  readonly nextCursor?: string;
  readonly nextUrl?: string;
  readonly total?: number;
  readonly pageNumber?: number;
}

/** Anything with a `.then` — used where a helper accepts sync or async work. */
export type Awaitable<T> = T | Promise<T>;

/** Makes selected keys optional; used for factory overrides. */
export type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

/** A plain object with unknown values — safer than `any` for parsed payloads. */
export type UnknownRecord = Record<string, unknown>;
