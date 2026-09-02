/**
 * The HTTP engine.
 *
 * Everything that must happen on *every* request lives here, exactly once:
 * URL resolution, credential injection, the read-only guard, retry with
 * backoff, timing capture, logging, report steps and body capture. A test — or
 * a service object — describes what it wants; this decides how it happens.
 *
 * It wraps Playwright's `APIRequestContext` rather than `fetch` so that
 * requests share the run's proxy, TLS and cookie configuration, appear in
 * Playwright traces, and are recorded in the HTML report alongside everything
 * else the test did.
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import type { ExchangeRecord, HeaderMap, HttpMethod, MultipartPart, RequestSpec } from '../types';
import { MUTATING_METHODS } from '../types';
import { ApiResponse } from './api.response';
import type { ResponseSnapshot } from './api.response';
import { HttpError, ReadOnlyEnvironmentError, RequestTimeoutError, TransportError } from './errors';
import { RequestBuilder } from './request.builder';
import type { RequestSender } from './request.builder';
import { config, apiUrl } from '../config/env.config';
import { TIMEOUTS } from '../config/timeouts';
import { logger } from '../utils/logger';
import type { Logger } from '../utils/logger';
import { parseRetryAfter, redactHeaders } from '../utils/header.utils';

/** Supplies credentials for outgoing requests. Implemented by `src/auth`. */
export interface AuthProvider {
  /** Name used in logs and error messages. */
  readonly name: string;
  /** Headers to merge into the request. Called per request, so tokens refresh. */
  headers(): Promise<HeaderMap>;
  /** Drops any cached token, forcing the next call to re-authenticate. */
  invalidate?(): void;
}

/** Notified after every exchange — used by the recorder and the reporters. */
type ExchangeListener = (record: ExchangeRecord) => void;

/**
 * Notified with the full response, body included.
 *
 * Separate from `ExchangeListener` because the exchange record redacts and
 * truncates for logging, while a contract check needs the payload intact.
 */
type ResponseListener = (response: ApiResponse) => void;

interface HttpClientOptions {
  /** Playwright request context. Comes from the `request` fixture. */
  readonly request: APIRequestContext;
  /** Overrides the base URL from configuration. */
  readonly baseUrl?: string;
  /** Headers merged into every request. */
  readonly headers?: HeaderMap;
  /** Credential source. Omit for an unauthenticated client. */
  readonly auth?: AuthProvider;
  /** Per-request timeout. Defaults to `API_TIMEOUT`. */
  readonly timeout?: number;
  /** Retry attempts for retryable failures. Defaults to `RETRY_COUNT`. */
  readonly retries?: number;
  /** Scoped logger. Defaults to the shared one. */
  readonly logger?: Logger;
}

/** Statuses worth retrying: transient by definition, never a test's verdict. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Verbs that can be repeated safely without an idempotency key. */
const IDEMPOTENT_METHODS = new Set<HttpMethod>(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

export class HttpClient implements RequestSender {
  private readonly context: APIRequestContext;
  private readonly baseUrl: string;
  private readonly baseHeaders: HeaderMap;
  private readonly authProvider: AuthProvider | undefined;
  private readonly timeoutMs: number;
  private readonly retryCount: number;
  private readonly log: Logger;
  private readonly listeners: ExchangeListener[] = [];
  private readonly responseListeners: ResponseListener[] = [];

  constructor(options: HttpClientOptions) {
    this.context = options.request;
    this.baseUrl = (options.baseUrl ?? config.baseUrl).replace(/\/+$/, '');
    this.baseHeaders = {
      accept: 'application/json',
      'user-agent': `playwright-api-framework/1.0 (+${config.env})`,
      ...lowercaseKeys(options.headers ?? {}),
    };
    this.authProvider = options.auth;
    this.timeoutMs = options.timeout ?? config.timeout;
    this.retryCount = options.retries ?? config.retryCount;
    this.log = options.logger ?? logger.child('http');
  }

  /* ---------------------------------------------------------------- */
  /* Verbs                                                             */
  /* ---------------------------------------------------------------- */

  get<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'GET', path);
  }

  post<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'POST', path);
  }

  put<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'PUT', path);
  }

  patch<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'PATCH', path);
  }

  delete<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'DELETE', path);
  }

  head<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'HEAD', path);
  }

  options<T = unknown>(path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, 'OPTIONS', path);
  }

  /** Any verb, for tests that iterate over methods (CORS, 405 checks). */
  request<T = unknown>(method: HttpMethod, path: string): RequestBuilder<T> {
    return new RequestBuilder<T>(this, method, path);
  }

  /* ---------------------------------------------------------------- */
  /* Derived clients                                                   */
  /* ---------------------------------------------------------------- */

  /** A copy of this client that authenticates differently. */
  withAuth(auth: AuthProvider | undefined): HttpClient {
    return this.derive(auth ? { auth } : {});
  }

  /** A copy with extra default headers — tenant ids, feature flags, locales. */
  withHeaders(headers: HeaderMap): HttpClient {
    return this.derive({ headers: { ...this.baseHeaders, ...lowercaseKeys(headers) } });
  }

  /** A copy pointed at a different host — a second service, or a mock server. */
  withBaseUrl(baseUrl: string): HttpClient {
    return this.derive({ baseUrl });
  }

  /** Subscribes to every exchange this client completes. */
  onExchange(listener: ExchangeListener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  /**
   * Subscribes to every response with its body intact.
   *
   * This is what automatic contract validation hooks into: it needs the real
   * payload, which the redacted exchange record deliberately does not carry.
   */
  onResponse(listener: ResponseListener): () => void {
    this.responseListeners.push(listener);
    return () => {
      const index = this.responseListeners.indexOf(listener);
      if (index >= 0) this.responseListeners.splice(index, 1);
    };
  }

  /* ---------------------------------------------------------------- */
  /* RequestSender                                                     */
  /* ---------------------------------------------------------------- */

  resolveUrl(pathname: string): string {
    if (/^https?:\/\//i.test(pathname)) return pathname;
    if (this.baseUrl !== config.baseUrl) {
      const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
      return `${this.baseUrl}${suffix}`;
    }
    return apiUrl(pathname);
  }

  defaults(): { headers: HeaderMap; timeout: number; retries: number } {
    return { headers: { ...this.baseHeaders }, timeout: this.timeoutMs, retries: this.retryCount };
  }

  /**
   * Sends one request, applying every cross-cutting policy.
   *
   * Wrapped in a reporter step so the HTML report reads as a narrative of what
   * the test did, with the status and duration on the step title.
   */
  async dispatch<T>(spec: RequestSpec): Promise<ApiResponse<T>> {
    this.guardReadOnly(spec);
    const send = async (): Promise<ApiResponse<T>> => this.execute<T>(spec);
    if (!inTest()) return send();
    return test.step(`${spec.method} ${stripBase(spec.url, this.baseUrl)}`, send);
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private derive(overrides: Partial<HttpClientOptions>): HttpClient {
    const derived = new HttpClient({
      request: this.context,
      baseUrl: this.baseUrl,
      headers: this.baseHeaders,
      auth: this.authProvider,
      timeout: this.timeoutMs,
      retries: this.retryCount,
      logger: this.log,
      ...overrides,
    });
    /* Observers follow the client they were attached to. Without this, a test
     * that calls `.withAuth()` would silently stop recording and stop
     * validating contracts, which is the sort of gap nobody notices. */
    for (const listener of this.listeners) derived.onExchange(listener);
    for (const listener of this.responseListeners) derived.onResponse(listener);
    return derived;
  }

  /**
   * Blocks writes against an environment marked read-only.
   *
   * A production smoke suite that accidentally POSTs is the kind of mistake
   * that only happens once, and the framework is the right place to make sure
   * it happens zero times.
   */
  private guardReadOnly(spec: RequestSpec): void {
    if (!config.readOnly) return;
    if (!MUTATING_METHODS.includes(spec.method)) return;
    throw new ReadOnlyEnvironmentError(spec.method, spec.url, config.env);
  }

  private async execute<T>(spec: RequestSpec): Promise<ApiResponse<T>> {
    const headers = await this.resolveHeaders(spec);
    const maxAttempts = spec.retries + 1;
    let attempt = 0;
    let lastError: unknown;

    while (attempt < maxAttempts) {
      attempt += 1;
      const startedAt = Date.now();

      /*
       * Only the transport itself is inside the try. Everything that happens
       * to a response once it has arrived — recording it, enforcing the
       * expected status, notifying the contract guard — is a verdict, not a
       * transient fault, and must never be retried. Keeping that code outside
       * the catch is what guarantees it: a schema violation retried three
       * times is three identical failures and a confusing report.
       */
      let snapshot: ResponseSnapshot;
      try {
        const raw = await this.transport(spec, headers);
        const durationMs = Date.now() - startedAt;
        const body = await raw.body();
        snapshot = {
          status: raw.status(),
          statusText: raw.statusText(),
          headers: lowercaseKeys(raw.headers()),
          body,
          url: raw.url(),
          request: { ...spec, headers },
          timing: { startedAt, durationMs, attempts: attempt },
        };
        await raw.dispose();
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) break;
        this.log.warn('retrying after transport failure', {
          attempt,
          of: maxAttempts,
          url: spec.url,
          reason: describeError(error),
        });
        await this.backoff(attempt, {}, spec);
        continue;
      }

      if (this.shouldRetry(spec, snapshot.status) && attempt < maxAttempts) {
        await this.backoff(attempt, snapshot.headers, spec);
        continue;
      }

      const response = new ApiResponse<T>(snapshot);
      this.record(response);
      this.enforceExpectedStatus(spec, response);
      return response;
    }

    throw this.toTransportError(spec, lastError);
  }

  /** Merges default, auth and per-request headers in that precedence order. */
  private async resolveHeaders(spec: RequestSpec): Promise<HeaderMap> {
    if (spec.anonymous || !this.authProvider) return spec.headers;
    /* A header set explicitly on the request always wins over the provider, so
     * a test can override credentials without swapping the whole client. */
    const injected = await this.authProvider.headers();
    return { ...lowercaseKeys(injected), ...spec.headers };
  }

  private async transport(spec: RequestSpec, headers: HeaderMap): Promise<APIResponse> {
    const options: Parameters<APIRequestContext['fetch']>[1] = {
      method: spec.method,
      headers,
      timeout: spec.timeout,
      /* The framework never throws on status by itself; `expectStatus` and the
       * test's own assertions decide what an acceptable status is. */
      failOnStatusCode: false,
      maxRedirects: spec.followRedirects ? 20 : 0,
      ignoreHTTPSErrors: !config.verifyTls,
    };

    switch (spec.bodyKind) {
      case 'json':
        options.data = spec.json as object;
        break;
      case 'form':
        options.form = spec.form ?? {};
        break;
      case 'multipart':
        options.multipart = buildMultipart(spec.multipart ?? []);
        break;
      case 'text':
        /*
         * Sent as a Buffer, not as a string.
         *
         * Playwright re-serialises a *string* `data` when the content type is
         * JSON — so `.text('{ not json', 'application/json')` would arrive at
         * the server as the valid JSON string `"{ not json"`, and a test
         * trying to prove the API rejects malformed input would silently prove
         * the opposite. A Buffer is written verbatim, which is what a raw text
         * body is supposed to mean.
         */
        options.data = Buffer.from(spec.text ?? '', 'utf8');
        break;
      case 'binary':
        options.data = spec.binary ?? Buffer.alloc(0);
        break;
      case 'none':
        break;
    }

    return this.context.fetch(spec.url, options);
  }

  private shouldRetry(spec: RequestSpec, status: number): boolean {
    if (!RETRYABLE_STATUSES.has(status)) return false;
    /* Retrying a non-idempotent write is only safe when the server can
     * de-duplicate it, which is exactly what an idempotency key promises. */
    return IDEMPOTENT_METHODS.has(spec.method) || 'idempotency-key' in spec.headers;
  }

  /** Exponential backoff, but honours `Retry-After` when the server sent one. */
  private async backoff(attempt: number, headers: HeaderMap, spec: RequestSpec): Promise<void> {
    const serverHint = parseRetryAfter(headers['retry-after']);
    const exponential = Math.min(
      TIMEOUTS.RETRY_BASE_DELAY * 2 ** (attempt - 1),
      TIMEOUTS.RETRY_MAX_DELAY,
    );
    /* Jitter keeps parallel workers from re-colliding on the same rate limit. */
    const jitter = Math.floor(Math.random() * TIMEOUTS.RETRY_BASE_DELAY);
    const delay = serverHint ?? exponential + jitter;
    this.log.debug('backing off', { url: spec.url, attempt, delayMs: delay });
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  private enforceExpectedStatus(spec: RequestSpec, response: ApiResponse): void {
    if (!spec.expectStatus?.length) return;
    if (spec.expectStatus.includes(response.status)) return;
    throw new HttpError({
      status: response.status,
      method: spec.method,
      url: response.url,
      body: response.text(),
      expected: spec.expectStatus,
    });
  }

  private record(response: ApiResponse): void {
    const record = response.toRecord();
    this.log.info(response.describe(), {
      label: record.label,
      attempts: record.timing.attempts,
      ...(config.logBodies ? { headers: redactHeaders(record.responseHeaders) } : {}),
    });
    for (const listener of this.listeners) listener(record);
    for (const listener of this.responseListeners) listener(response);
  }

  private toTransportError(spec: RequestSpec, error: unknown): Error {
    const detail = describeError(error);
    if (/timeout|timed out/i.test(detail)) {
      return new RequestTimeoutError(spec.method, spec.url, spec.timeout, { cause: error });
    }
    return new TransportError(spec.method, spec.url, detail, { cause: error });
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Converts framework parts into the shape Playwright's `multipart` expects. */
function buildMultipart(
  parts: MultipartPart[],
): Record<string, string | { name: string; mimeType: string; buffer: Buffer }> {
  const out: Record<string, string | { name: string; mimeType: string; buffer: Buffer }> = {};
  for (const part of parts) {
    if (part.value !== undefined) {
      out[part.name] = part.value;
      continue;
    }
    const buffer =
      part.buffer ?? (part.filePath ? fs.readFileSync(part.filePath) : Buffer.alloc(0));
    const fileName = part.fileName ?? (part.filePath ? path.basename(part.filePath) : part.name);
    out[part.name] = {
      name: fileName,
      mimeType: part.mimeType ?? guessMimeType(fileName),
      buffer,
    };
  }
  return out;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function guessMimeType(fileName: string): string {
  return MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()] ?? 'application/octet-stream';
}

function lowercaseKeys(headers: Record<string, string>): HeaderMap {
  const out: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}

function stripBase(url: string, baseUrl: string): string {
  return url.startsWith(baseUrl) ? url.slice(baseUrl.length) || '/' : url;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** True when called inside a running Playwright test, so steps are available. */
function inTest(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}
