/**
 * OAuth 2.0 token acquisition.
 *
 * Three grants are supported because these are the three an API suite actually
 * needs: client credentials for machine-to-machine calls, password grant for
 * acting as a specific user, and refresh for extending a session without
 * re-authenticating. Authorisation-code flows require a browser and belong in
 * the UI suite, which can hand the resulting token here.
 *
 * Tokens are cached in the shared `TokenStore`, keyed by grant and subject, so
 * a suite authenticates once per role rather than once per test.
 */
import type { APIRequestContext } from '@playwright/test';
import type { HeaderMap } from '../types';
import type { AuthProvider } from '../core/http.client';
import { AuthenticationError } from '../core/errors';
import { config } from '../config/env.config';
import { TokenStore, tokenStore } from './token.store';
import type { CachedToken } from './token.store';
import { logger } from '../utils/logger';

/** The subset of an OAuth token response the framework relies on. */
interface TokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface OAuth2Options {
  /** Absolute token endpoint. Defaults to `OAUTH_TOKEN_URL`. */
  readonly tokenUrl?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly scope?: string;
  /** Extra parameters some providers require, e.g. `audience` or `resource`. */
  readonly extra?: Record<string, string>;
  /**
   * Whether client credentials go in an `Authorization: Basic` header or in
   * the form body. Providers differ, and sending the wrong one gives an
   * `invalid_client` error that reads like a wrong secret.
   */
  readonly clientAuth?: 'basic' | 'body';
  /** Store to cache into. Defaults to the process-wide one. */
  readonly store?: TokenStore;
}

const log = logger.child('auth:oauth2');

export class OAuth2Auth implements AuthProvider {
  readonly name: string;
  private readonly request: APIRequestContext;
  private readonly options: OAuth2Options;
  private readonly grant: 'client_credentials' | 'password';
  private readonly username: string | undefined;
  private readonly password: string | undefined;
  private readonly store: TokenStore;

  private constructor(input: {
    request: APIRequestContext;
    options: OAuth2Options;
    grant: 'client_credentials' | 'password';
    username?: string;
    password?: string;
  }) {
    this.request = input.request;
    this.options = input.options;
    this.grant = input.grant;
    this.username = input.username;
    this.password = input.password;
    this.store = input.options.store ?? tokenStore;
    this.name = `oauth2:${input.grant}${input.username ? `:${input.username}` : ''}`;
  }

  /** Machine-to-machine: the suite itself is the client. */
  static clientCredentials(request: APIRequestContext, options: OAuth2Options = {}): OAuth2Auth {
    return new OAuth2Auth({ request, options, grant: 'client_credentials' });
  }

  /** Resource-owner password grant: act as a named user. */
  static password(
    request: APIRequestContext,
    username: string,
    password: string,
    options: OAuth2Options = {},
  ): OAuth2Auth {
    return new OAuth2Auth({ request, options, grant: 'password', username, password });
  }

  async headers(): Promise<HeaderMap> {
    const token = await this.token();
    return { authorization: `${token.type} ${token.value}` };
  }

  /** Forces the next request to fetch a new token. */
  invalidate(): void {
    this.store.invalidate(this.cacheKey());
  }

  /** The cached or freshly issued token, including its expiry. */
  async token(): Promise<CachedToken> {
    return this.store.getOrCreate(this.cacheKey(), () => this.fetchToken());
  }

  /** Exchanges a refresh token for a new access token. */
  async refresh(refreshToken: string): Promise<CachedToken> {
    const body: Record<string, string> = {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      ...(this.options.extra ?? {}),
    };
    const token = await this.post(body);
    this.store.set(this.cacheKey(), token);
    return token;
  }

  private cacheKey(): string {
    return `${this.tokenUrl()}|${this.grant}|${this.username ?? this.clientId()}|${this.scope() ?? ''}`;
  }

  private async fetchToken(): Promise<CachedToken> {
    const body: Record<string, string> = { grant_type: this.grant, ...(this.options.extra ?? {}) };
    const scope = this.scope();
    if (scope) body.scope = scope;
    if (this.grant === 'password') {
      body.username = this.username ?? '';
      body.password = this.password ?? '';
    }
    log.debug('requesting token', { grant: this.grant, url: this.tokenUrl() });
    return this.post(body);
  }

  private async post(body: Record<string, string>): Promise<CachedToken> {
    const headers: HeaderMap = { 'content-type': 'application/x-www-form-urlencoded' };
    const clientId = this.clientId();
    const clientSecret = this.options.clientSecret ?? config.oauth.clientSecret ?? '';

    if ((this.options.clientAuth ?? 'basic') === 'basic') {
      headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
    } else {
      body.client_id = clientId;
      body.client_secret = clientSecret;
    }

    let response;
    try {
      response = await this.request.fetch(this.tokenUrl(), {
        method: 'POST',
        headers,
        form: body,
        failOnStatusCode: false,
        timeout: config.timeout,
      });
    } catch (error) {
      throw new AuthenticationError(this.name, `the token endpoint was unreachable`, {
        cause: error,
      });
    }

    const text = await response.text();
    let payload: TokenResponse;
    try {
      payload = JSON.parse(text) as TokenResponse;
    } catch (error) {
      throw new AuthenticationError(
        this.name,
        `the token endpoint returned ${response.status()} with a non-JSON body: ${text.slice(0, 400)}`,
        { cause: error },
      );
    }

    if (!response.ok() || !payload.access_token) {
      throw new AuthenticationError(
        this.name,
        `${response.status()} ${payload.error ?? ''} ${payload.error_description ?? text.slice(0, 300)}`.trim(),
      );
    }

    const token: CachedToken = {
      value: payload.access_token,
      type: payload.token_type ?? 'Bearer',
      expiresAt: TokenStore.expiryFromSeconds(payload.expires_in),
      refreshToken: payload.refresh_token,
    };
    log.info('token issued', {
      grant: this.grant,
      expiresInSeconds: Math.round((token.expiresAt - Date.now()) / 1000),
    });
    return token;
  }

  private tokenUrl(): string {
    const url = this.options.tokenUrl ?? config.oauth.tokenUrl;
    if (!url) {
      throw new AuthenticationError(this.name, 'no token URL. Set OAUTH_TOKEN_URL in .env.');
    }
    return url;
  }

  private clientId(): string {
    const id = this.options.clientId ?? config.oauth.clientId;
    if (!id) throw new AuthenticationError(this.name, 'no client id. Set OAUTH_CLIENT_ID in .env.');
    return id;
  }

  private scope(): string | undefined {
    return this.options.scope ?? config.oauth.scope;
  }
}
