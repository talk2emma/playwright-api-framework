/**
 * Cookie-session authentication.
 *
 * Plenty of APIs still authenticate with a session cookie set by a login
 * endpoint. Two things make that awkward in a test suite: the login call is
 * expensive, and the cookie belongs to a browser context rather than to a
 * header. This provider solves both by logging in once, saving the storage
 * state to `storage/`, and replaying the cookie on later runs — the same
 * pattern the UI suite uses, so a hybrid test can share one session.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { APIRequestContext } from '@playwright/test';
import type { HeaderMap } from '../types';
import type { AuthProvider } from '../core/http.client';
import { AuthenticationError } from '../core/errors';
import { config } from '../config/env.config';
import { parseSetCookie } from '../utils/header.utils';
import { logger } from '../utils/logger';

const log = logger.child('auth:session');

export interface SessionAuthOptions {
  /** Login endpoint, relative or absolute. */
  readonly loginPath?: string;
  /** Body sent to the login endpoint. */
  readonly credentials: Record<string, string>;
  /** Names of the cookies that constitute the session. */
  readonly cookieNames?: string[];
  /** Where to cache the session. Git-ignored; it holds live credentials. */
  readonly storagePath?: string;
  /** Additional header taken from the login response, e.g. a CSRF token. */
  readonly captureHeader?: { from: string; sendAs: string };
}

export class SessionAuth implements AuthProvider {
  readonly name = 'session';
  private cookieHeader: string | undefined;
  private extraHeader: HeaderMap = {};

  constructor(
    private readonly request: APIRequestContext,
    private readonly options: SessionAuthOptions,
  ) {
    const cached = this.storageFile();
    if (cached && fs.existsSync(cached)) this.loadFromDisk(cached);
  }

  async headers(): Promise<HeaderMap> {
    if (!this.cookieHeader) await this.login();
    return this.cookieHeader ? { cookie: this.cookieHeader, ...this.extraHeader } : {};
  }

  /** Drops the cached session, so the next request logs in again. */
  invalidate(): void {
    this.cookieHeader = undefined;
    this.extraHeader = {};
    const file = this.storageFile();
    if (file && fs.existsSync(file)) fs.rmSync(file);
  }

  /** Performs the login call and captures the session cookie. */
  async login(): Promise<void> {
    const url = this.options.loginPath ?? '/auth/login';
    const absolute = /^https?:\/\//i.test(url) ? url : `${config.baseUrl}${config.apiPrefix}${url}`;

    const response = await this.request.fetch(absolute, {
      method: 'POST',
      data: this.options.credentials,
      failOnStatusCode: false,
      timeout: config.timeout,
    });

    if (!response.ok()) {
      throw new AuthenticationError(
        this.name,
        `login at ${absolute} returned ${response.status()}: ${(await response.text()).slice(0, 300)}`,
      );
    }

    const cookies = parseSetCookie(response.headers()['set-cookie']);
    const wanted = this.options.cookieNames;
    const selected = wanted ? cookies.filter((cookie) => wanted.includes(cookie.name)) : cookies;

    if (!selected.length) {
      throw new AuthenticationError(
        this.name,
        `login succeeded but set no ${wanted ? wanted.join('/') : ''} cookie. ` +
          `Received: ${cookies.map((c) => c.name).join(', ') || '(none)'}`,
      );
    }

    this.cookieHeader = selected.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

    const capture = this.options.captureHeader;
    if (capture) {
      const value = response.headers()[capture.from.toLowerCase()];
      if (value) this.extraHeader = { [capture.sendAs.toLowerCase()]: value };
    }

    log.info('session established', { cookies: selected.map((c) => c.name).join(', ') });
    this.persist();
  }

  private storageFile(): string | undefined {
    return (
      this.options.storagePath ?? path.join(process.cwd(), 'storage', `session-${config.env}.json`)
    );
  }

  private loadFromDisk(file: string): void {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        cookie?: string;
        extra?: HeaderMap;
      };
      this.cookieHeader = saved.cookie;
      this.extraHeader = saved.extra ?? {};
      log.debug('reused saved session', { file });
    } catch (error) {
      log.warn('ignoring unreadable session file', { file, error: String(error) });
    }
  }

  private persist(): void {
    const file = this.storageFile();
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(
        file,
        JSON.stringify({ cookie: this.cookieHeader, extra: this.extraHeader }, null, 2),
        { mode: 0o600 },
      );
    } catch (error) {
      log.warn('could not save session', { file, error: String(error) });
    }
  }
}
