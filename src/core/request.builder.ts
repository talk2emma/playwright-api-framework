/**
 * The fluent request builder.
 *
 * A request has a dozen independent dimensions — path parameters, query,
 * headers, body encoding, timeout, retries, acceptable statuses, whether auth
 * applies. Passing all of that as one options object produces call sites that
 * are impossible to read and impossible to extend without breaking callers.
 * A builder lets a test name only the dimensions it cares about, in any order,
 * and lets a new dimension be added without touching a single existing test.
 *
 * The builder is *thenable*, so `await api.get('/users')` works directly while
 * `await api.get('/users').query({ page: 2 }).expectStatus(200)` also works.
 * Nothing is sent until the builder is awaited or `send()` is called.
 */
import type {
  BodyKind,
  HeaderMap,
  HttpMethod,
  MultipartPart,
  PathParams,
  QueryParams,
  QueryValue,
  RequestSpec,
} from '../types';
import type { ApiResponse } from './api.response';
import { ConfigurationError } from './errors';

/** Implemented by the HTTP client. Declared here to avoid an import cycle. */
export interface RequestSender {
  dispatch<T>(spec: RequestSpec): Promise<ApiResponse<T>>;
  /** Turns a relative path into an absolute URL for the current environment. */
  resolveUrl(path: string): string;
  /** Defaults the builder starts from: base headers, timeout, retry count. */
  defaults(): { headers: HeaderMap; timeout: number; retries: number };
}

/** How array query values are encoded. */
export type ArrayFormat = 'repeat' | 'comma' | 'brackets';

export class RequestBuilder<T = unknown> implements PromiseLike<ApiResponse<T>> {
  private pathParams: PathParams = {};
  private queryParams: QueryParams = {};
  private headerMap: HeaderMap;
  private arrayFormat: ArrayFormat = 'repeat';

  private bodyKind: BodyKind = 'none';
  private jsonBody: unknown;
  private formBody: Record<string, string | number | boolean> | undefined;
  private multipartParts: MultipartPart[] = [];
  private textBody: string | undefined;
  private binaryBody: Buffer | undefined;

  private timeoutMs: number;
  private retryCount: number;
  private acceptedStatuses: number[] | undefined;
  private isAnonymous = false;
  private redirects = true;
  private labelText: string;
  private metadata: Record<string, string | number | boolean> = {};

  constructor(
    private readonly sender: RequestSender,
    private readonly method: HttpMethod,
    private readonly path: string,
  ) {
    const defaults = sender.defaults();
    this.headerMap = { ...defaults.headers };
    this.timeoutMs = defaults.timeout;
    this.retryCount = defaults.retries;
    this.labelText = `${method} ${path}`;
  }

  /* ---------------------------------------------------------------- */
  /* URL shaping                                                       */
  /* ---------------------------------------------------------------- */

  /** Fills `{id}` or `:id` placeholders in the path. */
  params(values: PathParams): this {
    this.pathParams = { ...this.pathParams, ...values };
    return this;
  }

  /** Fills a single path placeholder. */
  param(name: string, value: string | number): this {
    this.pathParams[name] = value;
    return this;
  }

  /** Merges query-string values. `undefined` and `null` entries are dropped. */
  query(values: QueryParams): this {
    this.queryParams = { ...this.queryParams, ...values };
    return this;
  }

  queryParam(name: string, value: QueryValue): this {
    this.queryParams[name] = value;
    return this;
  }

  /**
   * How repeated query values are encoded. Servers disagree, and getting this
   * wrong produces a silently empty filter rather than an error.
   */
  arrays(format: ArrayFormat): this {
    this.arrayFormat = format;
    return this;
  }

  /* ---------------------------------------------------------------- */
  /* Headers                                                           */
  /* ---------------------------------------------------------------- */

  headers(values: HeaderMap): this {
    for (const [key, value] of Object.entries(values)) this.headerMap[key.toLowerCase()] = value;
    return this;
  }

  header(name: string, value: string): this {
    this.headerMap[name.toLowerCase()] = value;
    return this;
  }

  /** Removes a header the client set by default. */
  withoutHeader(name: string): this {
    const target = name.toLowerCase();
    this.headerMap = Object.fromEntries(
      Object.entries(this.headerMap).filter(([key]) => key !== target),
    );
    return this;
  }

  accept(mediaType: string): this {
    return this.header('accept', mediaType);
  }

  contentType(mediaType: string): this {
    return this.header('content-type', mediaType);
  }

  /** Sets `Authorization: Bearer …` for this request only. */
  bearer(token: string): this {
    return this.header('authorization', `Bearer ${token}`);
  }

  /** Sets HTTP Basic credentials for this request only. */
  basic(username: string, password: string): this {
    const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
    return this.header('authorization', `Basic ${encoded}`);
  }

  /**
   * Attaches an idempotency key. Generated when omitted, so a retried POST
   * cannot create two resources — the failure mode that makes teams give up on
   * retrying writes altogether.
   */
  idempotencyKey(key = crypto.randomUUID()): this {
    return this.header('idempotency-key', key);
  }

  /** Adds a correlation id so a failing test can be found in server logs. */
  traceId(id: string): this {
    return this.header('x-request-id', id);
  }

  /* ---------------------------------------------------------------- */
  /* Bodies                                                            */
  /* ---------------------------------------------------------------- */

  /** JSON body. Sets `Content-Type: application/json` unless already set. */
  json(body: unknown): this {
    this.assertBodyUnset('json');
    this.bodyKind = 'json';
    this.jsonBody = body;
    return this;
  }

  /** `application/x-www-form-urlencoded` body. */
  form(fields: Record<string, string | number | boolean>): this {
    this.assertBodyUnset('form');
    this.bodyKind = 'form';
    this.formBody = fields;
    return this;
  }

  /** `multipart/form-data` body, built part by part. */
  multipart(parts: MultipartPart[]): this {
    this.assertBodyUnset('multipart');
    this.bodyKind = 'multipart';
    this.multipartParts = [...parts];
    return this;
  }

  /** Adds one file part, creating a multipart body if there is not one yet. */
  file(name: string, filePath: string, mimeType?: string): this {
    if (this.bodyKind !== 'multipart') {
      this.assertBodyUnset('multipart');
      this.bodyKind = 'multipart';
    }
    this.multipartParts.push(mimeType ? { name, filePath, mimeType } : { name, filePath });
    return this;
  }

  /** Adds one in-memory file part — for generated or oversized payloads. */
  fileFromBuffer(
    name: string,
    buffer: Buffer,
    fileName: string,
    mimeType = 'application/octet-stream',
  ): this {
    if (this.bodyKind !== 'multipart') {
      this.assertBodyUnset('multipart');
      this.bodyKind = 'multipart';
    }
    this.multipartParts.push({ name, buffer, fileName, mimeType });
    return this;
  }

  /** Adds one plain field to a multipart body. */
  field(name: string, value: string): this {
    if (this.bodyKind !== 'multipart') {
      this.assertBodyUnset('multipart');
      this.bodyKind = 'multipart';
    }
    this.multipartParts.push({ name, value });
    return this;
  }

  /** Raw text body — XML, CSV, plain text, or a deliberately malformed payload. */
  text(body: string, mediaType = 'text/plain'): this {
    this.assertBodyUnset('text');
    this.bodyKind = 'text';
    this.textBody = body;
    this.headerMap['content-type'] ??= mediaType;
    return this;
  }

  /** Raw bytes — image uploads, protobuf, gzip payloads. */
  binary(body: Buffer, mediaType = 'application/octet-stream'): this {
    this.assertBodyUnset('binary');
    this.bodyKind = 'binary';
    this.binaryBody = body;
    this.headerMap['content-type'] ??= mediaType;
    return this;
  }

  /* ---------------------------------------------------------------- */
  /* Execution policy                                                  */
  /* ---------------------------------------------------------------- */

  timeout(milliseconds: number): this {
    this.timeoutMs = milliseconds;
    return this;
  }

  /** Overrides the retry count for this request. Zero disables retrying. */
  retries(count: number): this {
    this.retryCount = count;
    return this;
  }

  /**
   * Statuses the client accepts without raising. Assertions in the test are
   * still the place to *check* the status — this only decides whether the
   * client itself treats the response as a transport-level failure.
   */
  expectStatus(...codes: number[]): this {
    this.acceptedStatuses = codes;
    return this;
  }

  /** Sends no credentials, so the unauthenticated path can be tested. */
  anonymous(): this {
    this.isAnonymous = true;
    return this;
  }

  /** Returns the 3xx itself instead of following it — for redirect assertions. */
  noRedirect(): this {
    this.redirects = false;
    return this;
  }

  /** Names the request in step titles, logs and report attachments. */
  as(label: string): this {
    this.labelText = label;
    return this;
  }

  /** Attaches metadata carried into the exchange log. */
  meta(key: string, value: string | number | boolean): this {
    this.metadata[key] = value;
    return this;
  }

  /* ---------------------------------------------------------------- */
  /* Terminal operations                                               */
  /* ---------------------------------------------------------------- */

  /** Resolves everything into an immutable spec without sending it. */
  build(): RequestSpec {
    const spec: RequestSpec = {
      method: this.method,
      url: this.buildUrl(),
      headers: this.buildHeaders(),
      bodyKind: this.bodyKind,
      json: this.jsonBody,
      form: this.formBody,
      multipart: this.multipartParts.length ? this.multipartParts : undefined,
      text: this.textBody,
      binary: this.binaryBody,
      timeout: this.timeoutMs,
      retries: this.retryCount,
      expectStatus: this.acceptedStatuses,
      label: this.labelText,
      anonymous: this.isAnonymous,
      followRedirects: this.redirects,
      meta: this.metadata,
    };
    return spec;
  }

  /** Sends the request and resolves with the captured response. */
  async send(): Promise<ApiResponse<T>> {
    return this.sender.dispatch<T>(this.build());
  }

  /** Makes the builder awaitable, so `await api.get('/x')` sends the request. */
  then<TResult1 = ApiResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: ApiResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.send().then(onfulfilled, onrejected);
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private buildUrl(): string {
    let resolved = this.path;
    for (const [name, value] of Object.entries(this.pathParams)) {
      const encoded = encodeURIComponent(String(value));
      resolved = resolved.replace(`{${name}}`, encoded).replace(`:${name}`, encoded);
    }
    const unresolved = /\{([^}]+)\}/.exec(resolved);
    if (unresolved) {
      throw new ConfigurationError(
        `Path "${this.path}" still contains the placeholder "{${unresolved[1] ?? ''}}". ` +
          `Supply it with .param('${unresolved[1] ?? ''}', …).`,
      );
    }

    const absolute = this.sender.resolveUrl(resolved);
    const search = this.buildQuery();
    if (!search) return absolute;
    return absolute.includes('?') ? `${absolute}&${search}` : `${absolute}?${search}`;
  }

  private buildQuery(): string {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(this.queryParams)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        if (this.arrayFormat === 'comma') {
          parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(','))}`);
        } else {
          const name = this.arrayFormat === 'brackets' ? `${key}[]` : key;
          for (const item of value)
            parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(item))}`);
        }
        continue;
      }
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
    return parts.join('&');
  }

  private buildHeaders(): HeaderMap {
    const headers = { ...this.headerMap };
    if (this.bodyKind === 'json') headers['content-type'] ??= 'application/json';
    if (this.bodyKind === 'form') headers['content-type'] ??= 'application/x-www-form-urlencoded';
    /* Multipart deliberately sets no content type: the boundary is generated
     * by the transport, and a hand-written header would not match it. */
    if (this.bodyKind === 'multipart') {
      const { 'content-type': _dropped, ...rest } = headers;
      return rest;
    }
    return headers;
  }

  private assertBodyUnset(next: BodyKind): void {
    if (this.bodyKind !== 'none' && this.bodyKind !== next) {
      throw new ConfigurationError(
        `Request already has a ${this.bodyKind} body; cannot also set a ${next} body. ` +
          `A request carries exactly one body.`,
      );
    }
  }
}
