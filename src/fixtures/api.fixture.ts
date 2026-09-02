/**
 * The fixtures every test imports.
 *
 * A test should open with the things it needs and nothing else:
 *
 *   test('a user can be created', async ({ api }) => { … });
 *
 * Everything behind that — building an authenticated client, seeding
 * deterministic data, collecting latency, recording exchanges, deleting what
 * the test created — is set up and torn down here. Playwright only constructs
 * a fixture a test actually names, so a test that never mentions `socket`
 * never opens a WebSocket, and this file can grow without slowing anything
 * down.
 *
 * Scope matters. Worker-scoped fixtures are built once per worker process and
 * shared by every test in it; test-scoped fixtures are rebuilt per test. Put
 * expensive, shareable, immutable things in worker scope (a token store, a
 * mock server) and anything a test can mutate in test scope (the cleanup
 * registry, the recorder) — sharing mutable state between tests is how a suite
 * becomes order-dependent.
 */
import { test as base, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Faker } from '@faker-js/faker';
import fs from 'node:fs';
import { HttpClient } from '../core/http.client';
import type { AuthProvider } from '../core/http.client';
import { CleanupRegistry } from '../utils/cleanup.registry';
import { LatencyCollector } from '../utils/performance.utils';
import { ExchangeRecorder } from '../mocks/recorder';
import { MockServer } from '../mocks/mock.server';
import { GraphQlClient } from '../protocols/graphql.client';
import { SseClient } from '../protocols/sse.client';
import type { SseOptions } from '../protocols/sse.client';
import { WebSocketClient } from '../protocols/websocket.client';
import type { WebSocketOptions } from '../protocols/websocket.client';
import { OpenApiContract } from '../contracts/openapi';
import { findSchema } from '../contracts/schema.registry';
import { TokenStore } from '../auth/token.store';
import { BasicAuth, BearerAuth, NoAuth, ApiKeyAuth } from '../auth/static.auth';
import { OAuth2Auth } from '../auth/oauth2.auth';
import { UserService } from '../services/template.service';
import { ObjectService } from '../services/object.service';
import { PostService } from '../services/post.service';
import { seededFaker } from '../utils/data.utils';
import { config, getUser, hasUser } from '../config/env.config';
import { PUBLIC_APIS } from '../config/environments';
import type { UserRole } from '../config/env.config';
import { fromRoot } from '../utils/file.utils';
import { logger } from '../utils/logger';
import type { Logger } from '../utils/logger';

/** Every service object, reachable from one place. */
export interface ServiceRegistry {
  /**
   * The live CRUD resource on the `demo` environment. The lifecycle suite
   * runs against this one because its writes genuinely persist.
   */
  readonly objects: ObjectService;
  /**
   * A read-only dataset on a different host, reached through a derived
   * client. Used for pagination, which the CRUD target cannot demonstrate.
   */
  readonly posts: PostService;
  /** The template service, against a hypothetical API. Copy it, do not call it. */
  readonly users: UserService;
}

/** Fixtures rebuilt for every test. */
export interface ApiFixtures {
  /** Deterministic data generator, seeded from the test's own title. */
  data: Faker;
  /** Scoped logger, prefixed with the test's name. */
  log: Logger;
  /** Deletions to run when the test ends. */
  cleanup: CleanupRegistry;
  /** The default credential source for this run. */
  auth: AuthProvider;
  /** The authenticated HTTP client. */
  http: HttpClient;
  /** An unauthenticated client, for testing the 401 path. */
  anonymousHttp: HttpClient;
  /** A client authenticated as a specific role. */
  httpAs: (role: UserRole) => HttpClient;
  /** Service objects bound to the authenticated client. */
  api: ServiceRegistry;
  /** GraphQL client, built on demand. */
  graphql: GraphQlClient;
  /** Latency samples for every request this test made. */
  latency: LatencyCollector;
  /** Records every exchange; attached to the report when the test fails. */
  recorder: ExchangeRecorder;
  /** Opens an SSE stream that is closed automatically at the end of the test. */
  sse: (url: string, options?: SseOptions) => Promise<SseClient>;
  /** Opens a WebSocket that is closed automatically at the end of the test. */
  socket: (url?: string, options?: WebSocketOptions) => Promise<WebSocketClient>;
  /**
   * Automatic contract validation. Declared as a fixture so Playwright sets it
   * up for every test; the value itself is never read, which is why it is
   * typed `undefined` rather than carrying a payload.
   */
  contractGuard: undefined;
}

/** Fixtures built once per worker process. */
export interface WorkerFixtures {
  /** Token cache shared by every test in this worker. */
  tokens: TokenStore;
  /** A request context that outlives individual tests, for worker-level setup. */
  workerRequest: APIRequestContext;
  /** The stub server. Started only if a test asks for it. */
  mockServer: MockServer;
  /** The published OpenAPI document, when the project ships one. */
  contract: OpenApiContract | undefined;
}

/** Where the OpenAPI document is looked for. */
const OPENAPI_PATH = fromRoot('src', 'data', 'openapi.json');

export const test = base.extend<ApiFixtures, WorkerFixtures>({
  /* ---------------------------------------------------------------- */
  /* Worker scope                                                      */
  /* ---------------------------------------------------------------- */

  tokens: [
    async ({}, use): Promise<void> => {
      await use(new TokenStore());
    },
    { scope: 'worker' },
  ],

  workerRequest: [
    async ({}, use): Promise<void> => {
      const context = await playwrightRequest.newContext({
        baseURL: config.baseUrl,
        ignoreHTTPSErrors: !config.verifyTls,
        timeout: config.timeout,
      });
      await use(context);
      await context.dispose();
    },
    { scope: 'worker' },
  ],

  mockServer: [
    async ({}, use): Promise<void> => {
      const server = new MockServer();
      /* Port 0 lets the OS pick, so parallel workers never collide. */
      await server.start(0);
      await use(server);
      await server.stop();
    },
    { scope: 'worker' },
  ],

  contract: [
    async ({}, use): Promise<void> => {
      const loaded = fs.existsSync(OPENAPI_PATH)
        ? OpenApiContract.fromFile(OPENAPI_PATH)
        : undefined;
      await use(loaded);
    },
    { scope: 'worker' },
  ],

  /* ---------------------------------------------------------------- */
  /* Test scope                                                        */
  /* ---------------------------------------------------------------- */

  data: async ({}, use, testInfo) => {
    /* Seeded from the full title path, so the same test always gets the same
     * data across runs and machines, while two tests never collide. */
    await use(seededFaker(testInfo.titlePath.join(' > ')));
  },

  log: async ({}, use, testInfo) => {
    await use(logger.child(testInfo.title.slice(0, 40)));
  },

  cleanup: async ({}, use) => {
    const registry = new CleanupRegistry();
    await use(registry);
    /* Runs even when the test failed — especially then, since a failed test is
     * the one most likely to have created something and not removed it. */
    await registry.drain();
  },

  auth: async ({ request, tokens }, use) => {
    await use(defaultAuthProvider(request, tokens));
  },

  http: async ({ request, auth, latency, recorder }, use) => {
    const client = new HttpClient({ request, auth });
    client.onExchange(latency.record);
    client.onExchange(recorder.record);
    await use(client);
  },

  anonymousHttp: async ({ request, latency }, use) => {
    const client = new HttpClient({ request, auth: new NoAuth() });
    client.onExchange(latency.record);
    await use(client);
  },

  httpAs: async ({ request, tokens, latency }, use) => {
    const built = new Map<UserRole, HttpClient>();
    await use((role: UserRole): HttpClient => {
      const existing = built.get(role);
      if (existing) return existing;
      const credentials = getUser(role);
      const provider = /* OAuth when configured, Basic otherwise. */ config.oauth.tokenUrl
        ? OAuth2Auth.password(request, credentials.username, credentials.password, {
            store: tokens,
          })
        : new BasicAuth(credentials.username, credentials.password);
      const client = new HttpClient({ request, auth: provider });
      client.onExchange(latency.record);
      built.set(role, client);
      return client;
    });
  },

  api: async ({ http, cleanup, log }, use) => {
    /*
     * Every service shares one cleanup registry, so a test's teardown runs as
     * a single ordered sequence rather than as several independent ones.
     *
     * `posts` is given a *derived* client pointed at a different host.
     * Deriving rather than constructing a new client is what keeps the run's
     * observers — latency, recording, the contract guard — attached to it.
     */
    await use({
      objects: new ObjectService(http, { cleanup, logger: log.child('objects') }),
      posts: new PostService(http.withBaseUrl(PUBLIC_APIS.jsonPlaceholder), {
        cleanup,
        logger: log.child('posts'),
      }),
      users: new UserService(http, { cleanup, logger: log.child('users') }),
    });
  },

  graphql: async ({ http }, use) => {
    await use(new GraphQlClient(http));
  },

  latency: async ({}, use, testInfo) => {
    const collector = new LatencyCollector();
    await use(collector);

    const report = collector.report();
    if (report.length) {
      await testInfo.attach('latency.json', {
        body: JSON.stringify(report, null, 2),
        contentType: 'application/json',
      });
    }
  },

  recorder: async ({}, use, testInfo) => {
    const recorder = new ExchangeRecorder(config.env);
    await use(recorder);

    /* Attached only on failure. A passing test's recording is noise; a failing
     * test's recording is often the whole investigation. */
    if (testInfo.status !== testInfo.expectedStatus && recorder.size > 0) {
      await testInfo.attach('exchanges.json', {
        body: JSON.stringify({ exchanges: recorder.size }, null, 2),
        contentType: 'application/json',
      });
      recorder.save(
        fromRoot(
          'reports',
          'recordings',
          `${testInfo.titlePath.join('-').replace(/[^\w.-]+/g, '_')}.json`,
        ),
      );
    }
  },

  sse: async ({}, use) => {
    const open: SseClient[] = [];
    await use(async (url: string, options?: SseOptions) => {
      const client = new SseClient(url, options ?? {});
      await client.connect();
      open.push(client);
      return client;
    });
    /* An SSE stream that stays open keeps the Node event loop alive and the
     * worker never exits — closing here is not optional. */
    for (const client of open) client.close();
  },

  socket: async ({}, use) => {
    const open: WebSocketClient[] = [];
    await use(async (url?: string, options?: WebSocketOptions) => {
      const client = new WebSocketClient(url ?? config.wsUrl ?? '', options ?? {});
      await client.connect();
      open.push(client);
      return client;
    });
    for (const client of open) await client.close();
  },

  /**
   * Validates every response against its registered schema.
   *
   * Automatic because contract drift is found by the tests nobody thought to
   * write. `auto: true` means it applies without a test naming it, and
   * `STRICT_CONTRACTS` decides whether it actually runs — off locally so a
   * work-in-progress schema does not block a developer, on in CI.
   */
  contractGuard: [
    async ({ http, log }, use): Promise<void> => {
      if (config.strictContracts) {
        http.onResponse((response) => {
          const registered = findSchema(response.request.method, response.url, response.status);
          if (!registered) return;
          const result = registered.schema.safeParse(response.jsonOrNull());
          if (!result.success) {
            log.error('contract violation', {
              schema: registered.name,
              url: response.url,
              issues: result.error.issues.map(
                (issue) => `${issue.path.join('.')}: ${issue.message}`,
              ),
            });
            throw new Error(
              `Response for ${response.request.method} ${response.url} violates the registered ` +
                `schema "${registered.name}":\n` +
                result.error.issues
                  .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
                  .join('\n'),
            );
          }
        });
      }
      await use(undefined);
    },
    { auto: true },
  ],
});

/**
 * Picks the credential scheme from what the environment provides.
 *
 * Order matters: OAuth if a token endpoint is configured, then an API key,
 * then basic credentials, then nothing. Choosing here rather than in each test
 * means moving an environment from API keys to OAuth is a `.env` change.
 */
export function defaultAuthProvider(request: APIRequestContext, tokens: TokenStore): AuthProvider {
  if (config.oauth.tokenUrl && config.oauth.clientId) {
    return OAuth2Auth.clientCredentials(request, { store: tokens });
  }
  if (config.apiKey) return new ApiKeyAuth(config.apiKey);
  if (hasUser('standard')) {
    const credentials = getUser('standard');
    return new BasicAuth(credentials.username, credentials.password);
  }
  return new NoAuth();
}

/** Re-exported so a test can build a bearer client from a captured token. */
export { BearerAuth };
