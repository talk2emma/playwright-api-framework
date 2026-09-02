/**
 * Server-Sent Events.
 *
 * Playwright's `APIRequestContext` buffers the whole response before returning
 * it, which is exactly wrong for a stream that stays open indefinitely — the
 * request would simply never resolve. So this client uses Node's global
 * `fetch`, which exposes the body as a readable stream. That is a deliberate,
 * documented exception to "everything goes through the HTTP client"; the two
 * places in this framework that stream (`sse.client.ts` and its NDJSON reader)
 * are the only ones.
 *
 * The parser implements the `text/event-stream` framing rules: fields are
 * `field: value`, an event is terminated by a blank line, `data` accumulates
 * across repeated lines, and a leading colon marks a comment used as a
 * keep-alive.
 */
import { PollTimeoutError } from '../core/errors';
import { TIMEOUTS } from '../config/timeouts';
import type { HeaderMap } from '../types';
import { logger } from '../utils/logger';

/** One parsed event from the stream. */
interface ServerSentEvent {
  /** Event name. Defaults to `message` when the server sends no `event:` field. */
  readonly event: string;
  /** The joined `data:` lines. */
  readonly data: string;
  readonly id?: string;
  /** Reconnection hint in milliseconds, when the server sent `retry:`. */
  readonly retry?: number;
  /** Epoch milliseconds when the event was received. */
  readonly receivedAt: number;
}

export interface SseOptions {
  readonly headers?: HeaderMap;
  /** How long to wait for the *next* event before giving up. */
  readonly idleTimeout?: number;
  /** Last event id to resume from, sent as `Last-Event-ID`. */
  readonly lastEventId?: string;
}

const log = logger.child('sse');

export class SseClient {
  private controller: AbortController | undefined;
  private readonly received: ServerSentEvent[] = [];
  private readonly waiters: {
    predicate: (event: ServerSentEvent) => boolean;
    resolve: (event: ServerSentEvent) => void;
  }[] = [];
  private closed = false;
  private failure: Error | undefined;

  constructor(
    private readonly url: string,
    private readonly options: SseOptions = {},
  ) {}

  /** Every event received so far. */
  get events(): readonly ServerSentEvent[] {
    return this.received;
  }

  /** Opens the stream. Resolves as soon as the response headers arrive. */
  async connect(): Promise<void> {
    this.controller = new AbortController();
    const headers: Record<string, string> = {
      accept: 'text/event-stream',
      'cache-control': 'no-cache',
      ...(this.options.headers ?? {}),
    };
    if (this.options.lastEventId) headers['last-event-id'] = this.options.lastEventId;

    const response = await fetch(this.url, { headers, signal: this.controller.signal });
    if (!response.ok || !response.body) {
      throw new Error(`SSE connection to ${this.url} failed with ${response.status}.`);
    }
    log.info('stream open', { url: this.url });
    /* Reading runs in the background; the caller interacts through waitFor. */
    void this.read(response.body).catch((error: unknown) => {
      if (this.closed) return;
      this.failure = error instanceof Error ? error : new Error(String(error));
    });
  }

  /** Waits for the next event matching a predicate. */
  async waitFor(
    predicate: (event: ServerSentEvent) => boolean,
    description = 'a matching event',
    timeout = this.options.idleTimeout ?? TIMEOUTS.STREAM_IDLE,
  ): Promise<ServerSentEvent> {
    const already = this.received.find(predicate);
    if (already) return already;
    if (this.failure) throw this.failure;

    return new Promise<ServerSentEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === wrapped);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new PollTimeoutError(description, timeout, this.received.length, this.received.at(-1)),
        );
      }, timeout);

      const wrapped = (event: ServerSentEvent): void => {
        clearTimeout(timer);
        resolve(event);
      };
      this.waiters.push({ predicate, resolve: wrapped });
    });
  }

  /** Waits for an event by name. */
  async waitForEvent(name: string, timeout?: number): Promise<ServerSentEvent> {
    return this.waitFor((event) => event.event === name, `an event named "${name}"`, timeout);
  }

  /** Collects `count` events, then resolves. */
  async collect(count: number, timeout?: number): Promise<ServerSentEvent[]> {
    while (this.received.length < count) {
      const target = this.received.length + 1;
      await this.waitFor(
        () => this.received.length >= target,
        `event ${target} of ${count}`,
        timeout,
      );
    }
    return this.received.slice(0, count);
  }

  /** Parses an event's `data` as JSON. */
  static json<T>(event: ServerSentEvent): T {
    return JSON.parse(event.data) as T;
  }

  /** Closes the stream. Always call this — an open stream keeps a test alive. */
  close(): void {
    this.closed = true;
    this.controller?.abort();
    log.debug('stream closed', { url: this.url, events: this.received.length });
  }

  private async read(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /* Events are separated by a blank line; \r\n is tolerated because some
       * servers and proxies rewrite line endings. */
      /* Events are separated by a blank line. The separator's own length has
       * to be measured rather than assumed, because it is two characters with
       * Unix line endings and four with Windows ones. */
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        const frame = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const event = parseFrame(frame);
        if (event) this.emit(event);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
  }

  private emit(event: ServerSentEvent): void {
    this.received.push(event);
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter?.predicate(event)) {
        this.waiters.splice(index, 1);
        waiter.resolve(event);
      }
    }
  }
}

/** Parses one `field: value` frame into an event, or `null` for a comment. */
function parseFrame(frame: string): ServerSentEvent | null {
  const dataLines: string[] = [];
  let event = 'message';
  let id: string | undefined;
  let retry: number | undefined;

  for (const line of frame.split(/\r?\n/)) {
    /* A line starting with a colon is a comment — servers send these as
     * keep-alives, and treating one as an event would confuse every waiter. */
    if (line.startsWith(':') || line.trim() === '') continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');

    if (field === 'data') dataLines.push(value);
    else if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'retry') retry = Number(value);
  }

  if (!dataLines.length && id === undefined) return null;
  const parsed: { event: string; data: string; receivedAt: number; id?: string; retry?: number } = {
    event,
    data: dataLines.join('\n'),
    receivedAt: Date.now(),
  };
  if (id !== undefined) parsed.id = id;
  if (retry !== undefined) parsed.retry = retry;
  return parsed;
}
