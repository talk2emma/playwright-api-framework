/**
 * A dependency-free structured logger.
 *
 * Deliberately hand-written rather than pulled from npm: the popular logging
 * libraries bring transports, colour packages and native bindings the suite
 * does not need, and at least one of them fails to load on current Node. This
 * is 80 lines, has no dependencies, and writes the two formats that matter —
 * readable lines locally, single-line JSON in CI for log aggregation.
 */
import { config } from '../config/env.config';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

/* ANSI colours, built from the escape character so no literal escape byte
 * appears in the source (which upsets some editors and diff tools). */
const ESC = String.fromCharCode(27);
const COLOR: Record<LogLevel | 'dim' | 'reset', string> = {
  error: `${ESC}[31m`,
  warn: `${ESC}[33m`,
  info: `${ESC}[36m`,
  debug: `${ESC}[90m`,
  dim: `${ESC}[2m`,
  reset: `${ESC}[0m`,
};

/** Extra key/value pairs attached to a log line. */
type LogContext = Record<string, unknown>;

interface LoggerOptions {
  /** Prefix identifying the subsystem, e.g. `http` or `auth:oauth2`. */
  readonly scope?: string;
  /** Overrides the level from `LOG_LEVEL` — used to silence a noisy helper. */
  readonly level?: LogLevel;
  /** Forces JSON output. Defaults to on in CI, off locally. */
  readonly json?: boolean;
}

export class Logger {
  private readonly scope: string;
  private readonly level: LogLevel;
  private readonly json: boolean;

  constructor(options: LoggerOptions = {}) {
    this.scope = options.scope ?? 'api';
    this.level = options.level ?? config.logLevel;
    this.json = options.json ?? config.isCI;
  }

  /** A logger for a sub-component, inheriting level and format. */
  child(scope: string): Logger {
    return new Logger({ scope: `${this.scope}:${scope}`, level: this.level, json: this.json });
  }

  error(message: string, context?: LogContext): void {
    this.write('error', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.write('warn', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.write('info', message, context);
  }

  debug(message: string, context?: LogContext): void {
    this.write('debug', message, context);
  }

  /** True when a level would be emitted — guard expensive context building. */
  enabled(level: LogLevel): boolean {
    return ORDER[level] <= ORDER[this.level];
  }

  private write(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.enabled(level)) return;
    const time = new Date().toISOString();

    if (this.json) {
      const line = JSON.stringify({ time, level, scope: this.scope, message, ...context });
      emit(level, line);
      return;
    }

    const head = `${COLOR[level]}${level.toUpperCase().padEnd(5)}${COLOR.reset}`;
    const tail =
      context && Object.keys(context).length ? ` ${COLOR.dim}${format(context)}${COLOR.reset}` : '';
    emit(
      level,
      `${COLOR.dim}${time.slice(11, 23)}${COLOR.reset} ${head} ${COLOR.dim}[${this.scope}]${COLOR.reset} ${message}${tail}`,
    );
  }
}

function format(context: LogContext): string {
  return Object.entries(context)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
}

/* Everything goes to stderr so that a test's own stdout — used by reporters and
 * by `--reporter=json` — is never polluted by log lines. */
function emit(level: LogLevel, line: string): void {
  if (level === 'error') console.error(line);
  else console.warn(line);
}

/** The shared logger. Call `.child()` rather than constructing new roots. */
export const logger = new Logger();
