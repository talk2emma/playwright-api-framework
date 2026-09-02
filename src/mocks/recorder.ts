/**
 * Recording exchanges, and replaying them as stubs.
 *
 * Two uses. As evidence: a recorded run is the artefact you attach to a bug
 * report, showing exactly what was sent and what came back. And as a fixture
 * source: record against a real environment once, then replay against the mock
 * server, so a suite can run in a pipeline that has no network access to the
 * target at all.
 *
 * Recordings are redacted on the way out. A recording that contains a live
 * bearer token is a credential leak sitting in the repository, and the only
 * reliable defence is to make redaction the default rather than a step
 * somebody has to remember.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ExchangeRecord, HeaderMap, HttpMethod } from '../types';
import { redactHeaders } from '../utils/header.utils';
import { logger } from '../utils/logger';
import type { Stub } from './mock.server';
import { stubFromRecording } from './mock.server';

const log = logger.child('recorder');

/** One exchange as stored on disk. */
export interface RecordedExchange {
  readonly method: HttpMethod;
  readonly path: string;
  readonly query: string;
  readonly status: number;
  readonly requestHeaders: HeaderMap;
  readonly responseHeaders: HeaderMap;
  readonly requestBody?: string;
  readonly responseBody: string;
  readonly durationMs: number;
  readonly recordedAt: string;
}

/** A whole recorded session. */
export interface Recording {
  readonly environment: string;
  readonly recordedAt: string;
  readonly exchanges: RecordedExchange[];
}

export class ExchangeRecorder {
  private readonly exchanges: RecordedExchange[] = [];

  constructor(private readonly environment: string) {}

  /** Records one exchange. Bind before passing to `client.onExchange`. */
  readonly record = (exchange: ExchangeRecord): void => {
    const url = safeUrl(exchange.url);
    this.exchanges.push({
      method: exchange.method,
      path: url.pathname,
      query: url.search,
      status: exchange.status,
      requestHeaders: redactHeaders(exchange.requestHeaders),
      responseHeaders: redactHeaders(exchange.responseHeaders),
      requestBody: exchange.requestBody,
      responseBody: exchange.responseBody ?? '',
      durationMs: exchange.timing.durationMs,
      recordedAt: new Date(exchange.timing.startedAt).toISOString(),
    });
  };

  get size(): number {
    return this.exchanges.length;
  }

  /** Writes the recording to disk. */
  save(filePath: string): void {
    const recording: Recording = {
      environment: this.environment,
      recordedAt: new Date().toISOString(),
      exchanges: this.exchanges,
    };
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(recording, null, 2));
    log.info('recording saved', { file: filePath, exchanges: this.exchanges.length });
  }

  /** Loads a recording written earlier. */
  static load(filePath: string): Recording {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Recording;
  }

  /**
   * Turns a recording into stubs for the mock server.
   *
   * Only successful exchanges are replayed by default: a recording made while
   * the target was briefly broken would otherwise bake that breakage into
   * every future offline run.
   */
  static toStubs(recording: Recording, options: { includeErrors?: boolean } = {}): Stub[] {
    return recording.exchanges
      .filter((exchange) => options.includeErrors === true || exchange.status < 400)
      .map((exchange) =>
        stubFromRecording({
          method: exchange.method,
          path: exchange.path,
          status: exchange.status,
          body: exchange.responseBody,
          headers: {
            'content-type': exchange.responseHeaders['content-type'] ?? 'application/json',
          },
        }),
      );
  }
}

function safeUrl(url: string): URL {
  try {
    return new URL(url);
  } catch {
    return new URL(url, 'http://localhost');
  }
}
