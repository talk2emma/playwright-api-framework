/**
 * A programmable stub server.
 *
 * Three things are impossible to test against a real dependency: the failure
 * you cannot trigger on demand (a 503 from a payment provider), the response
 * you cannot produce (a malformed payload from a partner), and the timing you
 * cannot control (a gateway timeout). A stub you control makes all three
 * routine, and lets the contract tests run with no network at all.
 *
 * Built on Node's `http` module rather than a framework: the whole surface is
 * "match a request, return a response", and every dependency added to a test
 * framework is one more thing that can break a release.
 */
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { HeaderMap, HttpMethod, UnknownRecord } from '../types';
import { config } from '../config/env.config';
import { logger } from '../utils/logger';

const log = logger.child('mock');

/** What a stub sends back. */
export interface StubResponse {
  readonly status?: number;
  readonly headers?: HeaderMap;
  /** JSON body. Serialised automatically. */
  readonly json?: unknown;
  /** Raw body, when the test needs malformed or non-JSON output. */
  readonly body?: string | Buffer;
  /** Milliseconds to wait before replying — for timeout and latency tests. */
  readonly delayMs?: number;
}

/** One registered stub. */
export interface Stub {
  readonly method: HttpMethod | 'ANY';
  /** Path or pattern. A single star matches one segment, a double star the rest. */
  readonly path: string;
  /** A fixed response, or one computed from the request. */
  readonly respond:
    StubResponse | ((request: RecordedRequest) => StubResponse | Promise<StubResponse>);
  /** Serve this stub at most this many times, then fall through. */
  readonly times?: number;
  /** Free-text name used in logs and in the "unmatched request" message. */
  readonly name?: string;
}

/** A request the server received, kept so tests can assert on it. */
export interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly path: string;
  readonly query: Record<string, string>;
  readonly headers: HeaderMap;
  readonly body: string;
  /** The body parsed as JSON, when it is JSON. */
  readonly json?: unknown;
  readonly receivedAt: number;
}

export class MockServer {
  private server: http.Server | undefined;
  private readonly stubs: { stub: Stub; served: number }[] = [];
  private readonly received: RecordedRequest[] = [];
  private port = 0;

  /** Every request the server received, in order. */
  get requests(): readonly RecordedRequest[] {
    return this.received;
  }

  /** Base URL to point a client at, once started. */
  get url(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Starts listening. Port 0 asks the OS for a free port, avoiding clashes. */
  async start(port = config.mockServerPort): Promise<string> {
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });

    const server = this.server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });

    this.port = (server.address() as AddressInfo).port;
    log.info('mock server listening', { url: this.url });
    return this.url;
  }

  /** Stops listening and releases the port. */
  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) =>
      this.server?.close(() => {
        resolve();
      }),
    );
    this.server = undefined;
    log.debug('mock server stopped');
  }

  /* ---------------------------------------------------------------- */
  /* Registering stubs                                                 */
  /* ---------------------------------------------------------------- */

  /** Registers a stub. Later registrations win, so a test can override setup. */
  stub(stub: Stub): this {
    this.stubs.unshift({ stub, served: 0 });
    return this;
  }

  /** Shorthand for a JSON response to a GET. */
  get(path: string, json: unknown, status = 200): this {
    return this.stub({ method: 'GET', path, respond: { json, status } });
  }

  /** Shorthand for a JSON response to a POST. */
  post(path: string, json: unknown, status = 201): this {
    return this.stub({ method: 'POST', path, respond: { json, status } });
  }

  /** Replies with an error status — the case a real dependency will not give you. */
  fail(path: string, status = 500, json: unknown = { error: 'stubbed failure' }): this {
    return this.stub({ method: 'ANY', path, respond: { status, json } });
  }

  /** Replies after a delay, to exercise client timeouts. */
  slow(path: string, delayMs: number, json: unknown = {}): this {
    return this.stub({ method: 'ANY', path, respond: { json, delayMs } });
  }

  /**
   * Fails a given number of times, then succeeds.
   *
   * This is how retry behaviour is tested honestly: the endpoint really does
   * recover, so a client that gives up too early fails and one that retries
   * forever never finishes.
   */
  flaky(path: string, failures: number, success: unknown, status = 503): this {
    let seen = 0;
    return this.stub({
      method: 'ANY',
      path,
      respond: () => {
        seen += 1;
        return seen <= failures
          ? { status, json: { error: 'temporarily unavailable' } }
          : { json: success };
      },
    });
  }

  /** Forgets every stub and every recorded request. */
  reset(): void {
    this.stubs.length = 0;
    this.received.length = 0;
  }

  /* ---------------------------------------------------------------- */
  /* Assertions                                                        */
  /* ---------------------------------------------------------------- */

  /** Requests matching a method and path, for asserting what the client sent. */
  requestsFor(method: string, path: string): RecordedRequest[] {
    return this.received.filter(
      (request) => request.method === method.toUpperCase() && matchPath(path, request.path),
    );
  }

  /** How many times a path was called — the assertion for caching and retries. */
  callCount(path: string): number {
    return this.received.filter((request) => matchPath(path, request.path)).length;
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const recorded = await record(request);
    this.received.push(recorded);

    const entry = this.stubs.find(
      (candidate) =>
        (candidate.stub.method === 'ANY' || candidate.stub.method === recorded.method) &&
        matchPath(candidate.stub.path, recorded.path) &&
        (candidate.stub.times === undefined || candidate.served < candidate.stub.times),
    );

    if (!entry) {
      /* An unmatched request is almost always a test-authoring mistake, so the
       * body says exactly what arrived and what was registered. */
      const available = this.stubs.map(
        (candidate) => `${candidate.stub.method} ${candidate.stub.path}`,
      );
      response.writeHead(501, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: 'No stub matched this request',
          request: `${recorded.method} ${recorded.path}`,
          registered: available,
        }),
      );
      log.warn('unmatched request', { method: recorded.method, path: recorded.path });
      return;
    }

    entry.served += 1;
    const result =
      typeof entry.stub.respond === 'function'
        ? await entry.stub.respond(recorded)
        : entry.stub.respond;
    if (result.delayMs) await new Promise((resolve) => setTimeout(resolve, result.delayMs));

    const body = result.body ?? (result.json === undefined ? '' : JSON.stringify(result.json));
    const headers: HeaderMap = {
      'content-type': result.json !== undefined ? 'application/json' : 'text/plain',
      ...(result.headers ?? {}),
    };
    response.writeHead(result.status ?? 200, headers);
    response.end(body);
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

async function record(request: IncomingMessage): Promise<RecordedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString('utf8');
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');

  let json: unknown;
  try {
    json = body ? JSON.parse(body) : undefined;
  } catch {
    json = undefined;
  }

  const headers: HeaderMap = {};
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers[key.toLowerCase()] = value;
    else if (Array.isArray(value)) headers[key.toLowerCase()] = value.join('\n');
  }

  return {
    method: (request.method ?? 'GET').toUpperCase(),
    url: request.url ?? '/',
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    body,
    json,
    receivedAt: Date.now(),
  };
}

/**
 * Glob matching for stub paths.
 *
 * A single star matches one path segment; a double star matches everything
 * remaining, including slashes. Everything else is escaped, so a path
 * containing a dot or a bracket cannot accidentally act as a pattern.
 */
export function matchPath(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true;
  /* Split on the wildcards so each piece is classified exactly once; everything
   * that is not a wildcard is escaped, so a path containing a dot or a bracket
   * cannot accidentally behave as a pattern. */
  const source = pattern
    .split(/(\*\*|\*)/)
    .map((part) => {
      if (part === '**') return '.*';
      if (part === '*') return '[^/]+';
      return part.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`).test(pathname);
}

/** A stub built from a recorded exchange — see `recorder.ts`. */
export function stubFromRecording(entry: {
  method: HttpMethod;
  path: string;
  status: number;
  body: string;
  headers?: HeaderMap;
}): Stub {
  const response: StubResponse = {
    status: entry.status,
    body: entry.body,
    headers: entry.headers ?? {},
  };
  return { method: entry.method, path: entry.path, respond: response, name: 'recorded' };
}

/** The parsed JSON body of a recorded request, typed by the caller. */
export function bodyOf(request: RecordedRequest): UnknownRecord {
  return (request.json ?? {}) as UnknownRecord;
}
