/**
 * Base class for service objects.
 *
 * A service object is to an API suite what a page object is to a UI suite: the
 * one place that knows an endpoint's path, its payload shape and its quirks.
 * When the team renames `/v1/users` to `/v1/accounts`, exactly one file
 * changes — not every test that happened to mention users.
 *
 * Subclasses declare a `basePath` and expose intention-revealing methods
 * (`createUser`, `archiveOrder`) that return domain objects, not raw responses.
 * Anything that needs the response itself — status assertions, header checks —
 * uses the `raw*` helpers, which return the response wrapper untouched.
 */
import { test } from '@playwright/test';
import type { HttpMethod } from '../types';
import type { ApiResponse } from './api.response';
import type { HttpClient } from './http.client';
import type { RequestBuilder } from './request.builder';
import { CleanupRegistry } from '../utils/cleanup.registry';
import { logger } from '../utils/logger';
import type { Logger } from '../utils/logger';

interface ServiceOptions {
  /** Shared registry so every service in a test cleans up together. */
  readonly cleanup?: CleanupRegistry;
  /** Scoped logger. Defaults to one named after the service. */
  readonly logger?: Logger;
}

export abstract class BaseService {
  protected readonly http: HttpClient;
  protected readonly cleanup: CleanupRegistry;
  protected readonly log: Logger;

  /** Path prefix every request in this service is relative to, e.g. `/users`. */
  protected abstract readonly basePath: string;

  /** Name used in step titles and logs. Defaults to the class name. */
  protected get serviceName(): string {
    return this.constructor.name;
  }

  constructor(http: HttpClient, options: ServiceOptions = {}) {
    this.http = http;
    this.cleanup = options.cleanup ?? new CleanupRegistry();
    this.log = options.logger ?? logger.child(this.serviceName.toLowerCase());
  }

  /* ---------------------------------------------------------------- */
  /* Request helpers                                                   */
  /* ---------------------------------------------------------------- */

  /** A builder for a path relative to `basePath`. */
  protected request<T = unknown>(method: HttpMethod, subPath = ''): RequestBuilder<T> {
    return this.http
      .request<T>(method, this.path(subPath))
      .as(`${this.serviceName} ${method} ${subPath || '/'}`);
  }

  protected get<T = unknown>(subPath = ''): RequestBuilder<T> {
    return this.request<T>('GET', subPath);
  }

  protected post<T = unknown>(subPath = ''): RequestBuilder<T> {
    return this.request<T>('POST', subPath);
  }

  protected put<T = unknown>(subPath = ''): RequestBuilder<T> {
    return this.request<T>('PUT', subPath);
  }

  protected patch<T = unknown>(subPath = ''): RequestBuilder<T> {
    return this.request<T>('PATCH', subPath);
  }

  protected del<T = unknown>(subPath = ''): RequestBuilder<T> {
    return this.request<T>('DELETE', subPath);
  }

  /** Joins `basePath` with a sub-path, tolerating a leading slash either side. */
  protected path(subPath: string): string {
    if (!subPath) return this.basePath;
    const base = this.basePath.replace(/\/+$/, '');
    const suffix = subPath.startsWith('/') ? subPath : `/${subPath}`;
    return `${base}${suffix}`;
  }

  /* ---------------------------------------------------------------- */
  /* Reporting and lifecycle                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Wraps a multi-request operation in one reporter step, so the report shows
   * "create a paid order" rather than four anonymous HTTP calls.
   */
  protected async step<T>(title: string, body: () => Promise<T>): Promise<T> {
    try {
      test.info();
    } catch {
      return body();
    }
    return test.step(`${this.serviceName}: ${title}`, body);
  }

  /**
   * Registers a deletion for something this service just created.
   *
   * Call it in the same statement that creates the resource. A creation that
   * is not tracked in its own method is a leak waiting to be discovered by
   * somebody else, months later.
   */
  protected track<T>(
    created: T,
    description: string,
    remove: () => Promise<void>,
    priority = 0,
  ): T {
    return this.cleanup.track(created, description, remove, priority);
  }

  /** Escape hatch for a call that needs the response, not a domain object. */
  protected async send<T>(builder: RequestBuilder<T>): Promise<ApiResponse<T>> {
    return builder.send();
  }
}
