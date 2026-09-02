/**
 * Named target environments.
 *
 * Only non-secret values belong here: hostnames, paths and behavioural flags.
 * Anything that would be dangerous in a pull request — keys, passwords, tokens
 * — is read from the process environment instead. See `env.config.ts`.
 */

/** A deployment the suite can be pointed at. */
export interface EnvironmentDefinition {
  /** Human-readable name used in logs and reports. */
  readonly name: string;
  /** Root of the REST API, without a trailing slash. */
  readonly apiBaseUrl: string;
  /** Absolute GraphQL endpoint, when the target exposes one. */
  readonly graphqlUrl?: string;
  /** Absolute WebSocket endpoint, when the target exposes one. */
  readonly wsUrl?: string;
  /** Version prefix applied to relative paths, e.g. `/v1`. */
  readonly apiPrefix: string;
  /** Whether TLS certificates are verified. Only ever false for local stubs. */
  readonly verifyTls: boolean;
  /** Requests slower than this are treated as a performance regression. */
  readonly latencyBudgetMs: number;
  /** Set for environments where destructive verbs must never be issued. */
  readonly readOnly: boolean;
}

export const ENVIRONMENTS = {
  /**
   * The default target: a real, publicly reachable REST API that supports a
   * genuine create-read-update-delete lifecycle with no authentication.
   *
   * It is the default so that a fresh clone can run `npm test` and get a
   * meaningful result before anyone has configured a single credential. A
   * framework that cannot demonstrate itself is a framework nobody trusts.
   *
   * Objects created through it persist and are retrievable by id, but are not
   * returned by the list endpoint — which is what makes it safe to run in
   * parallel against a dataset shared with the rest of the internet.
   */
  demo: {
    name: 'demo',
    apiBaseUrl: 'https://api.restful-api.dev',
    /* No version prefix: paths are served straight off the root. */
    apiPrefix: '',
    verifyTls: true,
    /* Generous, because this is a free shared instance behind Cloudflare and
     * the suite should not fail because somebody else is using it. */
    latencyBudgetMs: 5000,
    readOnly: false,
  },
  local: {
    name: 'local',
    apiBaseUrl: 'http://localhost:3000',
    graphqlUrl: 'http://localhost:3000/graphql',
    wsUrl: 'ws://localhost:3000/ws',
    apiPrefix: '/api/v1',
    verifyTls: false,
    latencyBudgetMs: 5000,
    readOnly: false,
  },
  mock: {
    name: 'mock',
    apiBaseUrl: 'http://127.0.0.1:4010',
    apiPrefix: '',
    verifyTls: false,
    latencyBudgetMs: 1000,
    readOnly: false,
  },
  dev: {
    name: 'dev',
    apiBaseUrl: 'https://api.dev.example.com',
    graphqlUrl: 'https://api.dev.example.com/graphql',
    wsUrl: 'wss://api.dev.example.com/ws',
    apiPrefix: '/v1',
    verifyTls: true,
    latencyBudgetMs: 3000,
    readOnly: false,
  },
  staging: {
    name: 'staging',
    apiBaseUrl: 'https://api.staging.example.com',
    graphqlUrl: 'https://api.staging.example.com/graphql',
    wsUrl: 'wss://api.staging.example.com/ws',
    apiPrefix: '/v1',
    verifyTls: true,
    latencyBudgetMs: 2000,
    readOnly: false,
  },
  production: {
    name: 'production',
    apiBaseUrl: 'https://api.example.com',
    graphqlUrl: 'https://api.example.com/graphql',
    wsUrl: 'wss://api.example.com/ws',
    apiPrefix: '/v1',
    verifyTls: true,
    latencyBudgetMs: 1500,
    /* Production runs read-only smoke checks; writes are blocked in the client. */
    readOnly: true,
  },
} as const satisfies Record<string, EnvironmentDefinition>;

export type EnvironmentName = keyof typeof ENVIRONMENTS;

/**
 * Additional public APIs the demonstration suite reaches directly.
 *
 * These are *not* environments, because `TEST_ENV` selects exactly one target
 * and these are used alongside it. A spec reaches them with
 * `http.withBaseUrl(PUBLIC_APIS.jsonPlaceholder)`, which produces a derived
 * client that keeps the run's observers — latency, recording, contract guard —
 * attached.
 *
 * Each one is here because it demonstrates something the primary target
 * cannot, and for no other reason.
 */
export const PUBLIC_APIS = {
  /**
   * A read-only fake REST API with a large, completely stable dataset and
   * genuine RFC 8288 `Link` header pagination — which is exactly what the
   * pagination walkers need to be exercised against.
   *
   * Its writes are simulated: a POST answers 201 with a plausible body, but
   * nothing is stored. That makes it excellent for read and pagination tests
   * and useless for a lifecycle test, which is why the CRUD suite runs against
   * `demo` instead.
   */
  jsonPlaceholder: 'https://jsonplaceholder.typicode.com',

  /**
   * An HTTP request-and-response inspection service. It echoes back exactly
   * what it received and can be asked for any status code on demand, which
   * makes it the only honest way to prove — against a real server — that the
   * client sends the headers, bodies and credentials it claims to.
   */
  httpBin: 'https://httpbin.org',
} as const;

export const ENVIRONMENT_NAMES = Object.keys(ENVIRONMENTS) as EnvironmentName[];
