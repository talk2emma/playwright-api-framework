/**
 * GraphQL client.
 *
 * GraphQL needs its own client because its failure model is different from
 * REST's in a way that quietly breaks REST-shaped assertions: a GraphQL server
 * answers `200 OK` and puts the failure in an `errors` array in the body. A
 * test that only checks the status will pass while the query returned nothing
 * at all. `expectNoErrors()` exists to make that impossible to forget.
 *
 * Partial success is also normal in GraphQL — `data` and `errors` can both be
 * present — so the response wrapper exposes both rather than choosing for you.
 */
import type { HeaderMap, UnknownRecord } from '../types';
import type { ApiResponse } from '../core/api.response';
import type { HttpClient } from '../core/http.client';
import { readPath } from '../utils/jsonpath.utils';
import { safeJson } from '../core/errors';
import { config } from '../config/env.config';
import { expect } from '@playwright/test';

/** One error entry from a GraphQL response. */
interface GraphQlError {
  readonly message: string;
  readonly path?: (string | number)[];
  readonly locations?: { line: number; column: number }[];
  readonly extensions?: UnknownRecord;
}

interface GraphQlBody<T> {
  data?: T | null;
  errors?: GraphQlError[];
  extensions?: UnknownRecord;
}

/** A GraphQL exchange: the HTTP response plus the parsed GraphQL envelope. */
class GraphQlResponse<T = unknown> {
  constructor(
    /** The underlying HTTP response — status, headers and timing live here. */
    readonly http: ApiResponse,
    private readonly body: GraphQlBody<T>,
    private readonly operation: string,
  ) {}

  /** The `data` payload. May be `null` when the whole query failed. */
  get data(): T | null | undefined {
    return this.body.data;
  }

  /** Errors reported by the server. Empty on full success. */
  get errors(): GraphQlError[] {
    return this.body.errors ?? [];
  }

  get extensions(): UnknownRecord | undefined {
    return this.body.extensions;
  }

  /** True when the server reported no errors at all. */
  get succeeded(): boolean {
    return this.errors.length === 0;
  }

  /** A value inside `data` by dotted path — `viewer.orders[0].id`. */
  path<V = unknown>(jsonPath: string): V | undefined {
    return readPath(this.body.data, jsonPath) as V | undefined;
  }

  /** Asserts the transport succeeded *and* the envelope carries no errors. */
  expectNoErrors(): this {
    expect(
      this.errors.length,
      `GraphQL operation "${this.operation}" returned ${this.errors.length} error(s):\n` +
        this.errors
          .map((error) => `  - ${error.message} @ ${error.path?.join('.') ?? '(root)'}`)
          .join('\n'),
    ).toBe(0);
    return this;
  }

  /** Asserts a specific error occurred — the negative-path counterpart. */
  expectError(match: string | RegExp): this {
    const matched = this.errors.some((error) =>
      typeof match === 'string' ? error.message.includes(match) : match.test(error.message),
    );
    expect(
      matched,
      `Expected a GraphQL error matching ${String(match)}, got: ${safeJson(this.errors)}`,
    ).toBe(true);
    return this;
  }

  /** Asserts an error carries a particular `extensions.code`, e.g. `FORBIDDEN`. */
  expectErrorCode(code: string): this {
    const codes = this.errors.map((error) =>
      typeof error.extensions?.code === 'string' ? error.extensions.code : '',
    );
    expect(codes, `Expected a GraphQL error with code "${code}"`).toContain(code);
    return this;
  }

  /** Asserts `data` is present and non-null. */
  expectData(): this {
    expect(this.body.data, `GraphQL operation "${this.operation}" returned no data`).not.toBeNull();
    return this;
  }
}

interface GraphQlOptions {
  /** Absolute endpoint. Defaults to `GRAPHQL_URL` or the environment's value. */
  readonly endpoint?: string;
  /** Headers merged into every operation. */
  readonly headers?: HeaderMap;
}

export class GraphQlClient {
  private readonly endpoint: string;
  private readonly headers: HeaderMap;

  constructor(
    private readonly http: HttpClient,
    options: GraphQlOptions = {},
  ) {
    const endpoint = options.endpoint ?? config.graphqlUrl;
    if (!endpoint) {
      throw new Error(
        'No GraphQL endpoint. Set GRAPHQL_URL in .env, or add graphqlUrl to the ' +
          'environment in src/config/environments.ts.',
      );
    }
    this.endpoint = endpoint;
    this.headers = options.headers ?? {};
  }

  /** Executes a query. */
  async query<T = unknown>(
    document: string,
    variables: UnknownRecord = {},
    operationName?: string,
  ): Promise<GraphQlResponse<T>> {
    return this.execute<T>(document, variables, operationName);
  }

  /**
   * Executes a mutation.
   *
   * Identical to `query` on the wire; kept separate so the test reads as what
   * it intends and so a read-only environment guard can tell them apart.
   */
  async mutate<T = unknown>(
    document: string,
    variables: UnknownRecord = {},
    operationName?: string,
  ): Promise<GraphQlResponse<T>> {
    return this.execute<T>(document, variables, operationName);
  }

  /**
   * Sends several operations in one HTTP request.
   *
   * Batching is how a GraphQL API is usually rate-limited and load-tested, and
   * some servers behave differently under it — worth being able to exercise.
   */
  async batch(
    operations: { document: string; variables?: UnknownRecord; operationName?: string }[],
  ): Promise<GraphQlResponse[]> {
    const response = await this.http
      .post(this.endpoint)
      .headers(this.headers)
      .json(
        operations.map((operation) => ({
          query: operation.document,
          variables: operation.variables ?? {},
          operationName: operation.operationName ?? operationNameOf(operation.document),
        })),
      )
      .as(`GraphQL batch (${operations.length})`)
      .send();

    const bodies = response.jsonOrNull<GraphQlBody<unknown>[]>() ?? [];
    return bodies.map(
      (body, index) =>
        new GraphQlResponse(response, body, operations[index]?.operationName ?? `#${index + 1}`),
    );
  }

  /** Fetches the schema via introspection — used for schema-drift checks. */
  async introspect(): Promise<UnknownRecord | null | undefined> {
    const result = await this.query<UnknownRecord>(INTROSPECTION_QUERY, {}, 'IntrospectionQuery');
    return result.data;
  }

  private async execute<T>(
    document: string,
    variables: UnknownRecord,
    operationName?: string,
  ): Promise<GraphQlResponse<T>> {
    const name = operationName ?? operationNameOf(document);
    const response = await this.http
      .post(this.endpoint)
      .headers(this.headers)
      .json({ query: document, variables, operationName: name })
      .as(`GraphQL ${name}`)
      .send();

    const body = response.jsonOrNull<GraphQlBody<T>>() ?? {};
    return new GraphQlResponse<T>(response, body, name);
  }
}

/** Reads the operation name out of the document, for logs and step titles. */
function operationNameOf(document: string): string {
  return /(?:query|mutation|subscription)\s+(\w+)/.exec(document)?.[1] ?? 'anonymous';
}

/** Minimal introspection: enough to diff a schema between deployments. */
const INTROSPECTION_QUERY = `query IntrospectionQuery {
  __schema {
    queryType { name }
    mutationType { name }
    types {
      kind
      name
      fields { name type { kind name ofType { kind name } } }
    }
  }
}`;
