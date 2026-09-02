/**
 * The credential schemes that need no network call: none, basic, bearer and
 * API key. They are grouped in one file because each is a handful of lines and
 * splitting them would cost more in imports than it saves in navigation.
 */
import type { HeaderMap } from '../types';
import type { AuthProvider } from '../core/http.client';
import { config } from '../config/env.config';
import { ConfigurationError } from '../core/errors';

/** Sends no credentials. Use to assert the 401 path explicitly. */
export class NoAuth implements AuthProvider {
  readonly name = 'none';

  headers(): Promise<HeaderMap> {
    return Promise.resolve({});
  }
}

/** HTTP Basic — `Authorization: Basic base64(user:pass)`. */
export class BasicAuth implements AuthProvider {
  readonly name = 'basic';

  constructor(
    private readonly username: string,
    private readonly password: string,
  ) {}

  headers(): Promise<HeaderMap> {
    const encoded = Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64');
    return Promise.resolve({ authorization: `Basic ${encoded}` });
  }
}

interface ApiKeyOptions {
  /** Where the key goes. Header is the default and the safer choice. */
  readonly in?: 'header' | 'query';
  /** Header or query parameter name. */
  readonly name?: string;
  /** Prefix such as `ApiKey ` prepended to the value. */
  readonly prefix?: string;
}

/**
 * API-key authentication.
 *
 * Query-string keys are supported because some APIs require them, but they end
 * up in server access logs and browser history — the header form is preferred
 * wherever the API allows it.
 */
export class ApiKeyAuth implements AuthProvider {
  readonly name = 'api-key';
  private readonly location: 'header' | 'query';
  private readonly parameter: string;
  private readonly prefix: string;

  constructor(
    private readonly key: string = config.apiKey ?? '',
    options: ApiKeyOptions = {},
  ) {
    if (!key && !config.apiKey) {
      throw new ConfigurationError('No API key. Set API_KEY in .env, or pass one to ApiKeyAuth.');
    }
    this.location = options.in ?? 'header';
    this.parameter = options.name ?? 'x-api-key';
    this.prefix = options.prefix ?? '';
  }

  headers(): Promise<HeaderMap> {
    if (this.location === 'query') return Promise.resolve({});
    return Promise.resolve({ [this.parameter.toLowerCase()]: `${this.prefix}${this.key}` });
  }

  /** Query parameters to merge, for the `in: 'query'` form. */
  queryParams(): Record<string, string> {
    return this.location === 'query' ? { [this.parameter]: this.key } : {};
  }
}
