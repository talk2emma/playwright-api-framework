/**
 * WebSocket client.
 *
 * Built on Node's global `WebSocket` (stable since Node 22), so there is no
 * dependency to keep up to date and no second implementation to reason about.
 *
 * The design point that matters: every message the socket receives is buffered
 * from the moment it connects. A test that sends a request and then starts
 * listening will otherwise miss a reply that arrived first — the single most
 * common source of flaky WebSocket tests. `waitFor` searches the buffer before
 * it waits, so ordering does not matter.
 */
import { PollTimeoutError } from '../core/errors';
import { TIMEOUTS } from '../config/timeouts';
import { config } from '../config/env.config';
import { logger } from '../utils/logger';

/** A received frame with the moment it arrived. */
interface SocketMessage {
  readonly data: string;
  readonly receivedAt: number;
}

export interface WebSocketOptions {
  /** Sub-protocols offered during the handshake. */
  readonly protocols?: string[];
  /** How long `waitFor` blocks by default. */
  readonly messageTimeout?: number;
  /** Sent as the first frame after the socket opens — a subscribe or auth frame. */
  readonly onOpenSend?: unknown;
}

const log = logger.child('ws');

export class WebSocketClient {
  private socket: WebSocket | undefined;
  private readonly buffer: SocketMessage[] = [];
  private readonly waiters: {
    predicate: (message: SocketMessage) => boolean;
    resolve: (message: SocketMessage) => void;
  }[] = [];
  private closeInfo: { code: number; reason: string } | undefined;

  constructor(
    private readonly url: string = config.wsUrl ?? '',
    private readonly options: WebSocketOptions = {},
  ) {
    if (!this.url) {
      throw new Error(
        'No WebSocket URL. Set WS_URL in .env, or add wsUrl to the environment in ' +
          'src/config/environments.ts.',
      );
    }
  }

  /** Every message received so far, oldest first. */
  get messages(): readonly SocketMessage[] {
    return this.buffer;
  }

  /** How the socket closed, once it has. */
  get closure(): { code: number; reason: string } | undefined {
    return this.closeInfo;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /** Opens the socket and resolves once the handshake completes. */
  async connect(timeout = TIMEOUTS.SOCKET_MESSAGE): Promise<void> {
    const socket = this.options.protocols
      ? new WebSocket(this.url, this.options.protocols)
      : new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('message', (event: MessageEvent) => {
      const message: SocketMessage = { data: String(event.data), receivedAt: Date.now() };
      this.buffer.push(message);
      this.settle(message);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.closeInfo = { code: event.code, reason: event.reason };
      log.debug('socket closed', { code: event.code, reason: event.reason });
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new PollTimeoutError(`the WebSocket handshake with ${this.url}`, timeout, 1));
      }, timeout);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          log.info('socket open', { url: this.url });
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new Error(`WebSocket connection to ${this.url} failed.`));
        },
        { once: true },
      );
    });

    if (this.options.onOpenSend !== undefined) this.send(this.options.onOpenSend);
  }

  /** Sends a frame. Objects are JSON-encoded; strings go as-is. */
  send(payload: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      throw new Error(`Cannot send on a socket that is not open (${this.url}).`);
    }
    this.socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }

  /**
   * Waits for a message matching a predicate, searching already-received
   * messages first so a reply that arrived early is not missed.
   */
  async waitFor(
    predicate: (message: SocketMessage) => boolean,
    description = 'a matching message',
    timeout = this.options.messageTimeout ?? TIMEOUTS.SOCKET_MESSAGE,
  ): Promise<SocketMessage> {
    const already = this.buffer.find(predicate);
    if (already) return already;

    return new Promise<SocketMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.waiters.findIndex((waiter) => waiter.resolve === wrapped);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(
          new PollTimeoutError(description, timeout, this.buffer.length, this.buffer.at(-1)?.data),
        );
      }, timeout);

      const wrapped = (message: SocketMessage): void => {
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push({ predicate, resolve: wrapped });
    });
  }

  /** Waits for a JSON message whose fields match, and returns it parsed. */
  async waitForJson<T = unknown>(
    matches: (value: T) => boolean,
    description = 'a matching JSON message',
    timeout?: number,
  ): Promise<T> {
    const message = await this.waitFor(
      (received) => {
        try {
          return matches(JSON.parse(received.data) as T);
        } catch {
          return false;
        }
      },
      description,
      timeout,
    );
    return JSON.parse(message.data) as T;
  }

  /** Sends a frame and waits for the correlated reply. */
  async request<T = unknown>(
    payload: unknown,
    matches: (value: T) => boolean,
    timeout?: number,
  ): Promise<T> {
    this.send(payload);
    return this.waitForJson<T>(matches, 'the correlated reply', timeout);
  }

  /** Closes the socket. Safe to call more than once. */
  async close(code = 1000, reason = 'test complete'): Promise<void> {
    if (!this.socket || this.socket.readyState === WebSocket.CLOSED) return;
    const socket = this.socket;
    await new Promise<void>((resolve) => {
      socket.addEventListener(
        'close',
        () => {
          resolve();
        },
        { once: true },
      );
      socket.close(code, reason);
      /* Never let a server that ignores the close frame hang the run. */
      setTimeout(resolve, 2_000);
    });
  }

  private settle(message: SocketMessage): void {
    for (let index = this.waiters.length - 1; index >= 0; index -= 1) {
      const waiter = this.waiters[index];
      if (waiter?.predicate(message)) {
        this.waiters.splice(index, 1);
        waiter.resolve(message);
      }
    }
  }
}
