/** Configuration, the request engine, and the shared type vocabulary. */
export default {
  /* ---------------------------------------------------------------- */
  /* src/config                                                        */
  /* ---------------------------------------------------------------- */

  'src/config/env.config.ts': {
    group: 'config',
    purpose:
      'The only file in the framework that reads `process.env`. It loads the env files, validates everything against a Zod schema, and exports a frozen `config` object plus `getUser(role)`.',
    blocks: [
      { type: 'h3', text: 'What it does, in order' },
      {
        type: 'ol',
        items: [
          'Loads `.env`, then `.env.<TEST_ENV>` on top of it. Neither overrides a variable already exported in the shell — that is how CI injects secrets without touching a file.',
          'Validates every variable against the schema, coercing types and applying defaults.',
          'Throws once, listing every problem by name, if anything is wrong.',
          'Resolves the named environment and freezes the result.',
        ],
      },
      { type: 'h3', text: 'Coercion helpers' },
      {
        type: 'p',
        text: 'Environment variables are always strings, and an unset one is an empty string rather than `undefined`. Three `z.preprocess` helpers absorb that so the schema can describe intent rather than string handling.',
      },
      {
        type: 'code',
        caption: 'booleanish — a blank value falls back rather than becoming false',
        text: `function booleanish(fallback: boolean): z.ZodType<boolean, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    const raw = asString(value);
    if (raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }, z.boolean());
}`,
      },
      {
        type: 'p',
        text: '`integerish` and `optionalString` follow the same pattern. The alternative — `.optional().default()` — does not type correctly in Zod 3 for a value arriving as `unknown`.',
      },
      { type: 'h3', text: 'Credentials' },
      {
        type: 'code',
        caption: 'getUser fails with the fix, not with a 401',
        text: `export function getUser(role: UserRole): UserCredentials {
  const entry = users[role];
  if (!entry.username || !entry.password) {
    throw new Error(
      \`No credentials for role "\${role}". Set \${role.toUpperCase()}_USERNAME and \` +
        \`\${role.toUpperCase()}_PASSWORD in .env (or as CI secrets).\`,
    );
  }
  return { role, username: entry.username, password: entry.password };
}`,
      },
      {
        type: 'p',
        text: 'Throwing here rather than returning empty strings turns a configuration mistake into a readable message instead of an unexplained 401 twenty tests later. `hasUser(role)` is the non-throwing form, for tests that should skip rather than fail.',
      },
      { type: 'h3', text: 'apiUrl' },
      {
        type: 'p',
        text: "Applies the environment's version prefix to a relative path, passes absolute URLs through untouched, and does not double-apply a prefix that is already present.",
      },
    ],
    changeWhen: [
      'You add an environment variable.',
      'A default is wrong for most people.',
      'A new credential role is needed.',
    ],
    changeHow: [
      {
        text: 'Add the field to the schema with the right helper.',
        code: `TENANT_ID: optionalString(),\nMAX_UPLOAD_MB: integerish(25),`,
      },
      {
        text: 'Expose it on `config` under a name that reads well at the call site.',
        code: `tenantId: raw.TENANT_ID,\nmaxUploadMb: raw.MAX_UPLOAD_MB,`,
      },
      {
        text: 'Document it in `.env.example` — a variable that exists only here is a variable nobody discovers.',
      },
      {
        text: 'For a new role, extend `UserRole` and the `users` map. The compiler finds every place that has to change.',
      },
    ],
    why: 'One reader for the environment is what makes secret handling auditable: reviewing this one file tells you everything the suite can read. It also means an invalid configuration fails once, loudly, at start-up rather than as a confusing `undefined` inside a request.',
    gotchas: [
      "`config` is frozen. A test cannot mutate the run's settings and leave a later test pointing somewhere else.",
      "Zod is pinned to v3 deliberately; v4's CommonJS build fails under Playwright's transform.",
      'A variable added to `.env.example` but not to the schema is silently ignored.',
    ],
    related: ['src/config/environments.ts', '.env.example', 'src/fixtures/api.fixture.ts'],
  },

  'src/config/environments.ts': {
    group: 'config',
    purpose:
      'The table of named targets — `demo`, `local`, `mock`, `dev`, `staging`, `production` — holding URLs, path prefixes, TLS behaviour, latency budgets and the read-only flag, plus the public APIs the demonstration suite reaches alongside them.',
    blocks: [
      {
        type: 'rule',
        text: 'Only non-secret values belong here. Anything that would be dangerous in a pull request — keys, passwords, tokens — is read from the process environment instead. This file is committed and reviewed like any other.',
      },
      { type: 'h3', text: 'Fields' },
      {
        type: 'table',
        head: ['Field', 'Effect'],
        rows: [
          ['`apiBaseUrl`', 'Root of the REST API, without a trailing slash'],
          [
            '`graphqlUrl`, `wsUrl`',
            'Endpoints for the non-REST protocols, when the target has them',
          ],
          ['`apiPrefix`', 'Version prefix applied to relative paths — `/v1`, or empty'],
          ['`verifyTls`', 'Only ever false for local stubs'],
          ['`latencyBudgetMs`', 'What `expectWithinLatencyBudget()` compares against'],
          ['`readOnly`', '**The client refuses to send any mutating verb.** Set on `production`.'],
        ],
      },
      {
        type: 'code',
        caption: 'The type is enforced at compile time',
        text: `export const ENVIRONMENTS = {
  staging: { /* … */ },
} as const satisfies Record<string, EnvironmentDefinition>;

export type EnvironmentName = keyof typeof ENVIRONMENTS;`,
      },
      {
        type: 'p',
        text: '`satisfies` checks each entry against the interface while keeping the literal types, so `EnvironmentName` is the union of the actual keys — and the Zod enum in `env.config.ts` is built from the same list. Adding an environment makes it a valid `TEST_ENV` automatically.',
      },
    ],
    changeWhen: [
      'A new deployment needs testing.',
      'A URL, prefix or budget changes.',
      'An environment should become read-only.',
    ],
    changeHow: [
      {
        text: 'Add the entry. A missing field is a compile error, not a run-time surprise.',
        code: `sandbox: {\n  name: 'sandbox',\n  apiBaseUrl: 'https://api.sandbox.example.com',\n  apiPrefix: '/v2',\n  verifyTls: true,\n  latencyBudgetMs: 4000,\n  readOnly: false,\n},`,
      },
      { text: 'Point at it.', code: `TEST_ENV=sandbox npx playwright test` },
    ],
    why: "Environment definitions are configuration, not secrets. Keeping them in code means they are type-checked, reviewable, and discoverable — none of which is true of a URL living in somebody's shell profile.",
    gotchas: [
      '`readOnly` is a real guard, not documentation. The client throws before sending a POST, PUT, PATCH or DELETE.',
      'A trailing slash on `apiBaseUrl` produces double slashes in URLs. `config.baseUrl` strips them, but keep the table clean.',
    ],
    related: ['src/config/env.config.ts', 'src/core/http.client.ts'],
  },

  'src/config/timeouts.ts': {
    group: 'config',
    purpose:
      'Named time budgets. Tests and helpers refer to these constants instead of writing raw numbers, so a slow environment is retuned in one place and every wait in the suite carries an explanation of what it is waiting for.',
    blocks: [
      {
        type: 'table',
        head: ['Constant', 'Value', 'For'],
        rows: [
          ['`INSTANT`', '1s', 'A health check or a cached read. Anything slower is a red flag.'],
          ['`SHORT`', '5s', 'A normal single-resource read'],
          ['`MEDIUM`', '15s', 'A write, or a read that fans out to other services'],
          ['`LONG`', '30s', 'Report generation, bulk import, anything queued'],
          ['`EXTRA_LONG`', '120s', 'A large upload or download'],
          [
            '`TEST` / `HOOK` / `EXPECT`',
            '60s / 90s / 10s',
            'Whole-test, hook and assertion budgets',
          ],
          ['`POLL_TIMEOUT` / `POLL_INTERVAL`', '30s / 500ms', 'How `waitFor` behaves'],
          ['`RETRY_BASE_DELAY` / `RETRY_MAX_DELAY`', '300ms / 5s', 'Exponential backoff bounds'],
          [
            '`STREAM_IDLE` / `SOCKET_MESSAGE`',
            '15s / 10s',
            'How long a stream or socket waits for the next message',
          ],
        ],
      },
      {
        type: 'p',
        text: 'The names are the documentation. `TIMEOUTS.MEDIUM` says "this is a write"; `15000` says nothing.',
      },
    ],
    changeWhen: ['An environment is systematically slower.', 'A new category of wait appears.'],
    changeHow: [
      {
        text: 'Adjust the named budget rather than a call site, so every wait of that kind moves together.',
      },
      {
        text: 'Add a constant for a genuinely new category, with a comment saying what it is waiting for.',
        code: `/** How long a webhook receiver waits for a callback to arrive. */\nWEBHOOK_DELIVERY: 45_000,`,
      },
    ],
    why: 'A raw number at a call site is a decision nobody can review. A named budget is a decision with a reason attached, and it can be changed once for the whole suite.',
    gotchas: [
      'Raising a timeout to make a flaky test pass converts a fast failure into a slow one. Find out what is slow first — the latency report is attached to every test.',
    ],
    related: ['playwright.config.ts', 'src/utils/retry.utils.ts', 'src/core/http.client.ts'],
  },

  'src/config/index.ts': {
    group: 'config',
    purpose: 'Barrel for the configuration layer, so everything else imports from one place.',
    changeWhen: ['You add an export to the config layer.'],
    changeHow: [
      {
        text: 'Re-export it, using `export type` for types so the emitted JavaScript stays clean.',
      },
    ],
    why: 'A single import path means moving a file inside `src/config/` never breaks a caller.',
    related: ['src/config/env.config.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* src/core                                                          */
  /* ---------------------------------------------------------------- */

  'src/core/http.client.ts': {
    group: 'core',
    purpose:
      'The HTTP engine. Everything that must happen on every request lives here exactly once: URL resolution, credential injection, the read-only guard, retry with backoff, timing capture, logging, reporter steps and body capture.',
    blocks: [
      {
        type: 'p',
        text: "It wraps Playwright's `APIRequestContext` rather than `fetch`, so requests share the run's proxy and TLS configuration, appear in traces, and are recorded in the HTML report alongside everything else the test did.",
      },
      { type: 'h3', text: 'The retry structure' },
      {
        type: 'p',
        text: 'This is the single most important detail in the file. **Only the transport call is inside the try block.** Everything that happens once a response has arrived — recording it, enforcing the expected status, notifying the contract guard — sits outside it.',
      },
      {
        type: 'code',
        caption: 'The shape that makes verdicts un-retryable',
        text: `let snapshot: ResponseSnapshot;
try {
  const raw = await this.transport(spec, headers);
  snapshot = { /* status, headers, body, timing */ };
} catch (error) {
  if (attempt >= maxAttempts) break;
  await this.backoff(attempt, {}, spec);
  continue;
}

if (this.shouldRetry(spec, snapshot.status) && attempt < maxAttempts) {
  await this.backoff(attempt, snapshot.headers, spec);
  continue;
}

const response = new ApiResponse<T>(snapshot);
this.record(response);                    // observers — never retried
this.enforceExpectedStatus(spec, response);
return response;`,
      },
      {
        type: 'note',
        text: 'Without that structure, a contract violation thrown by an observer would be caught by the retry handler and tried three times — three identical failures, and a report that suggests a transient problem where there is a real one.',
      },
      { type: 'h3', text: 'What gets retried' },
      {
        type: 'table',
        head: ['Condition', 'Retried?'],
        rows: [
          ['DNS, TLS, connection reset, timeout', 'Yes — a transport fault'],
          [
            '408, 425, 429, 500, 502, 503, 504 on GET/HEAD/OPTIONS/PUT/DELETE',
            'Yes — transient, and the verb is idempotent',
          ],
          [
            'The same statuses on POST/PATCH **with** an `Idempotency-Key`',
            'Yes — the server promised to de-duplicate',
          ],
          [
            'The same statuses on POST/PATCH **without** one',
            'No — a retry could create two resources',
          ],
          ['Any 4xx that is not 408 or 425', 'No — that is an answer'],
          ['A failing contract check', 'No — structurally impossible, see above'],
        ],
      },
      { type: 'h3', text: 'Backoff' },
      {
        type: 'p',
        text: 'Exponential, capped at `RETRY_MAX_DELAY`, with jitter so parallel workers do not re-collide on the same rate limit — but a server-supplied `Retry-After` always wins, because the server knows better than the heuristic.',
      },
      { type: 'h3', text: 'Derived clients' },
      {
        type: 'p',
        text: '`withAuth`, `withHeaders` and `withBaseUrl` return copies. A copy **inherits the observers**, so a test that switches auth mid-way does not silently stop recording or validating.',
      },
      { type: 'h3', text: 'The read-only guard' },
      {
        type: 'code',
        caption: 'Checked before anything is sent',
        text: `private guardReadOnly(spec: RequestSpec): void {
  if (!config.readOnly) return;
  if (!MUTATING_METHODS.includes(spec.method)) return;
  throw new ReadOnlyEnvironmentError(spec.method, spec.url, config.env);
}`,
      },
      {
        type: 'p',
        text: 'A production smoke suite that accidentally POSTs is the kind of mistake that only happens once. The framework is the right place to make sure it happens zero times.',
      },
    ],
    changeWhen: [
      'A policy should apply to every request — a header, a correlation id, a circuit breaker.',
      'The retry rules need to change.',
      'A new body encoding is added.',
      'You need a new observer hook.',
    ],
    changeHow: [
      {
        text: 'For a per-request policy, edit `resolveHeaders` or `transport`. Both run for every request, which is the point of having them.',
      },
      {
        text: 'For retry behaviour, edit `RETRYABLE_STATUSES` or `shouldRetry`. Keep the idempotency reasoning intact.',
        code: `const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 522]);`,
      },
      {
        text: 'For a body encoding, add a case to the switch in `transport` — the compiler will already be pointing at it.',
      },
      {
        text: 'For a new hook, follow `onResponse`: push to a list, return an unsubscribe, and copy the list in `derive()`.',
      },
    ],
    why: 'One engine means a policy is written once and cannot be forgotten. Spread across service objects, "always send a correlation id" becomes "send it wherever somebody remembered".',
    gotchas: [
      "`failOnStatusCode: false` is always set. The framework never throws on status by itself — `expectStatus` and the test's assertions decide what is acceptable.",
      'Multipart deliberately deletes any `content-type`: the boundary is generated by the transport and a hand-written header will not match it.',
      'A header set explicitly on a request always wins over the auth provider, so a test can override credentials without swapping clients.',
      '`test.step` only works inside a running test; `inTest()` detects that so the client also works from a hook or a script.',
    ],
    related: [
      'src/core/request.builder.ts',
      'src/core/api.response.ts',
      'src/core/errors.ts',
      'src/auth/index.ts',
    ],
  },

  'src/core/request.builder.ts': {
    group: 'core',
    purpose:
      'The fluent builder. It lets a call name only the dimensions it cares about, in any order, and lets a new dimension be added without touching a single existing test.',
    blocks: [
      { type: 'h3', text: 'Why a builder' },
      {
        type: 'p',
        text: 'A request has more than a dozen independent dimensions. As one options object, every call site has to be read in full to find the two fields that matter, and a thirteenth dimension is a breaking change for everybody.',
      },
      { type: 'h3', text: 'Thenable' },
      {
        type: 'code',
        caption: 'Nothing is sent until the builder is awaited',
        text: `await http.get('/users');                             // sends
await http.get('/users').query({ page: 2 }).send();   // also sends
const spec = http.get('/users').build();              // sends nothing`,
      },
      { type: 'h3', text: 'The surface' },
      {
        type: 'table',
        head: ['Area', 'Methods'],
        rows: [
          ['URL', '`param`, `params`, `query`, `queryParam`, `arrays`'],
          [
            'Headers',
            '`header`, `headers`, `withoutHeader`, `accept`, `contentType`, `bearer`, `basic`, `idempotencyKey`, `traceId`',
          ],
          [
            'Body',
            '`json`, `form`, `multipart`, `file`, `fileFromBuffer`, `field`, `text`, `binary`',
          ],
          [
            'Policy',
            '`timeout`, `retries`, `expectStatus`, `anonymous`, `noRedirect`, `as`, `meta`',
          ],
          ['Terminal', '`build`, `send`, `then`'],
        ],
      },
      { type: 'h3', text: 'Details that prevent real bugs' },
      {
        type: 'ul',
        items: [
          '**An unfilled placeholder throws**, naming the parameter, rather than sending a request to a literal `/users/{id}`.',
          '**`arrays(format)`** chooses between `?tag=a&tag=b`, `?tag=a,b` and `?tag[]=a`. Servers disagree, and getting it wrong produces a silently empty filter rather than an error.',
          '**`idempotencyKey()` generates one when none is given**, which is what makes retrying a POST safe — and what `shouldRetry` looks for.',
          '**`assertBodyUnset`** throws if two body kinds are set, instead of silently sending one of them.',
          '**`anonymous()`** suppresses credential injection, so the 401 path can be tested without building a second client.',
        ],
      },
    ],
    changeWhen: [
      'A request needs a dimension that does not exist.',
      'A new body encoding is added.',
      'Query encoding needs another format.',
    ],
    changeHow: [
      {
        text: 'Add a private field, a chainable method returning `this`, and the field in `build()`.',
        code: `private tenantId: string | undefined;\n\ntenant(id: string): this {\n  this.tenantId = id;\n  return this;\n}`,
      },
      {
        text: 'Add it to `RequestSpec` in `src/types/index.ts` so the client can act on it. The compiler will point at every place that must keep up.',
      },
    ],
    why: "Optionality is the whole design. A test that cares about nothing but the path writes `http.get('/users')`; a test that cares about eight things writes eight calls. Neither pays for the other.",
    gotchas: [
      'A builder is single-use — it carries mutable state. Reusing one after `send()` re-sends the same request.',
      '`expectStatus` controls whether the *client* raises. Assertions in the test are still where the status should be checked.',
      '`RequestSender` is declared here rather than imported, to avoid an import cycle with the client.',
    ],
    related: ['src/core/http.client.ts', 'src/types/index.ts'],
  },

  'src/core/api.response.ts': {
    group: 'core',
    purpose:
      'The response wrapper — the highest-leverage class in the framework, since every assertion a test makes goes through it.',
    blocks: [
      { type: 'h3', text: 'Two decisions shape it' },
      {
        type: 'p',
        text: '**The body is a snapshot.** It is captured into a buffer before this object exists, so it can be read as text, JSON, NDJSON, XML or bytes, in any order, as many times as a test likes, after the connection has closed. That is what makes every method synchronous and chainable.',
      },
      {
        type: 'p',
        text: '**Assertions live here rather than in free functions**, so a failing check can include the request, the status, the timing and a body excerpt. An assertion that only says "expected 200, got 500" costs somebody twenty minutes; one that shows the error payload costs nothing.',
      },
      { type: 'h3', text: 'Readers' },
      {
        type: 'table',
        head: ['Method', 'Returns'],
        rows: [
          ['`text()` / `buffer()`', 'The body as a string or bytes'],
          [
            '`json<T>()`',
            'Parsed JSON. Throws with a body excerpt when it is not JSON — an HTML error page where JSON was expected is a common and otherwise baffling failure.',
          ],
          ['`jsonOrNull<T>()` / `isJson()`', 'The non-throwing forms'],
          ['`ndjson<T>()`', 'One parsed value per line, with the line number in any error'],
          ['`xml()` / `fault()`', 'Parsed XML, and a SOAP fault when the body carries one'],
          [
            '`parse(schema)`',
            'Validated **and typed**. The method to reach for when the test needs the payload.',
          ],
        ],
      },
      {
        type: 'p',
        text: 'Parsing is memoised: a test that reads `.json()` in five assertions pays for one parse.',
      },
      { type: 'h3', text: 'Navigation' },
      {
        type: 'code',
        caption: 'Paths, not chains of optional access',
        text: `response.path('data.items[0].id');   // one value
response.paths('..email');           // every match, at any depth
response.has('meta.cursor');         // presence
response.fields();                   // every leaf path — useful for shape drift`,
      },
      { type: 'h3', text: 'Assertions' },
      {
        type: 'p',
        text: 'Fifteen, all chainable, all funnelling through one private `assert`. That is why every failure in the suite has the same anatomy.',
      },
      {
        type: 'code',
        caption: 'The failure message every assertion produces',
        text: `Expected status to be 201.
  Request : POST https://api.staging.example.com/v1/users
  Status  : 422 Unprocessable Entity
  Timing  : 143ms
  Actual  : 422`,
      },
      { type: 'h3', text: 'Soft mode' },
      {
        type: 'code',
        caption: 'Report every violation, not just the first',
        text: `response.soft()
  .expectStatus(200)
  .expectHeader('etag')
  .expectPath('data.id')
  .expectWithinLatencyBudget();`,
      },
      {
        type: 'p',
        text: '`soft()` returns a new wrapper over the same snapshot whose assertions use `expect.soft`. For checking many properties of one payload, that turns four runs into one.',
      },
    ],
    changeWhen: [
      'A recurring assertion deserves a name.',
      'A new payload format needs a reader.',
      'Failure messages should carry more context.',
    ],
    changeHow: [
      {
        text: 'Add an assertion by delegating to `assert` — you get the standard message anatomy for free.',
        code: `expectCursor(): this {\n  this.assert(this.has('nextCursor'), 'a pagination cursor', this.jsonOrNull());\n  return this;\n}`,
      },
      {
        text: 'Add a reader as a plain method over `this.snapshot.body`. It can be synchronous, because the body is already in memory.',
      },
      {
        text: 'To change every failure message, edit the private `assert`. One edit, whole suite.',
      },
    ],
    why: 'This class is where a test spends most of its time, so its ergonomics set the ergonomics of every test in the repository. Time spent here is repaid at every call site.',
    gotchas: [
      '`json()` throws on a non-JSON body — deliberate, and the message shows the content type and an excerpt.',
      '`parse()` narrows the type; `json<T>()` only asserts one. Prefer `parse` when the shape matters.',
      '`expectSecurityHeaders()` checks a defensible baseline, not a policy. Adjust `REQUIRED_SECURITY_HEADERS` to your own.',
      'A response is immutable. `soft()` returns a new wrapper rather than changing this one.',
    ],
    related: [
      'src/core/http.client.ts',
      'src/utils/jsonpath.utils.ts',
      'src/fixtures/custom-matchers.ts',
    ],
  },

  'src/core/base.service.ts': {
    group: 'core',
    purpose:
      'The base class for service objects: path joining, request helpers scoped to `basePath`, reporter steps, and access to the cleanup registry.',
    blocks: [
      {
        type: 'p',
        text: 'A service object is to an API suite what a page object is to a UI suite. When `/v1/users` becomes `/v1/accounts`, exactly one file changes — not every test that happened to mention users.',
      },
      {
        type: 'code',
        caption: 'What a subclass provides',
        text: `export class OrderService extends BaseService {
  protected readonly basePath = '/orders';

  async create(overrides: Partial<Order> = {}): Promise<Order> {
    return this.step('create an order', async () => {
      const response = await this.post().json(buildOrder(overrides)).expectStatus(201).send();
      const order = response.parse(OrderSchema, 'order');
      return this.track(order, \`order \${order.id}\`, () => this.remove(order.id));
    });
  }
}`,
      },
      { type: 'h3', text: 'What the base provides' },
      {
        type: 'table',
        head: ['Member', 'Does'],
        rows: [
          [
            '`get`, `post`, `put`, `patch`, `del`',
            'A builder for a path relative to `basePath`, pre-labelled for the report',
          ],
          ['`path(sub)`', 'Joins `basePath` and a sub-path, tolerating a leading slash on either'],
          [
            '`step(title, body)`',
            'Wraps a multi-request operation in one reporter step, so the report reads as intent rather than as four anonymous calls',
          ],
          [
            '`track(value, description, remove)`',
            'Registers a deletion and passes the value through, so creation and cleanup are one expression',
          ],
          ['`send(builder)`', 'The escape hatch for a call that needs the response itself'],
        ],
      },
      {
        type: 'rule',
        text: 'A service method returns a domain value and never asserts. Assertions belong in tests, so a negative-path test can reuse the service instead of fighting it. Where a test needs the response — a `Location` header, a status — expose a `raw*` method rather than forcing the test to bypass the service.',
      },
    ],
    changeWhen: [
      'Every service needs a capability — a shared header, a common retry policy, a standard pagination reader.',
    ],
    changeHow: [
      {
        text: 'Add a protected method here rather than repeating it in each service.',
        code: `protected async page<T>(sub: string, schema: z.ZodTypeAny): Promise<T[]> {\n  return followOffset(async (offset, limit) => {\n    const response = await this.get(sub).query({ offset, limit }).send();\n    return response.parse(schema).items as T[];\n  });\n}`,
      },
    ],
    why: 'Anything every service needs belongs here; anything one service needs belongs in that service. Keeping the base small is what stops it becoming a dumping ground that every service drags around.',
    gotchas: [
      '`del` rather than `delete` — `delete` is a reserved word and cannot be a method name in this position.',
      '`step()` falls back to calling the body directly when not inside a test, so services work from setup scripts too.',
      "Each service gets its own registry unless one is passed in. The fixture passes the shared one, so a test's cleanup runs together.",
    ],
    related: [
      'src/services/template.service.ts',
      'src/utils/cleanup.registry.ts',
      'src/core/request.builder.ts',
    ],
  },

  'src/core/errors.ts': {
    group: 'core',
    purpose:
      'The error hierarchy. Every failure the framework raises itself is one of these, so a test can distinguish "the API said no" from "the framework is misconfigured" from "the payload does not match its contract" — three problems with three different owners.',
    blocks: [
      {
        type: 'table',
        head: ['Error', 'Means', 'Owner'],
        rows: [
          [
            '`ConfigurationError`',
            'The environment or a call is wrong. Raised before any request.',
            'Whoever set the configuration',
          ],
          [
            '`HttpError`',
            'A response arrived that `expectStatus` did not accept.',
            'Usually the API',
          ],
          ['`RequestTimeoutError`', 'No response within the timeout.', 'The API, or the network'],
          ['`TransportError`', 'DNS, TLS, reset — no response at all.', 'Infrastructure'],
          [
            '`SchemaValidationError`',
            'A payload does not match its schema.',
            'The API, or the schema',
          ],
          [
            '`ContractViolationError`',
            'A response disagrees with the OpenAPI document.',
            'The API, or the document',
          ],
          [
            '`AuthenticationError`',
            'A token could not be obtained or refreshed.',
            'Configuration, or the identity provider',
          ],
          ['`PollTimeoutError`', 'A `waitFor` gave up.', 'The API, or the expectation'],
          [
            '`ReadOnlyEnvironmentError`',
            'A write was attempted on a read-only environment.',
            'The test',
          ],
          ['`LatencyBudgetError`', 'A response was slower than its budget.', 'The API'],
        ],
      },
      {
        type: 'p',
        text: 'Every message is written to be actionable on its own, because in CI the message is often all anyone sees.',
      },
      {
        type: 'code',
        caption: 'A message that names its own fix',
        text: `Refusing to send POST https://api.example.com/v1/users: the "production"
environment is marked read-only in src/config/environments.ts. Point TEST_ENV
at a writable environment, or mark the test @read-only.`,
      },
      {
        type: 'p',
        text: 'Two helpers live here because every error message needs them: `truncate` keeps a large body from filling a terminal, and `safeJson` stringifies anything without throwing on cycles or BigInt.',
      },
    ],
    changeWhen: [
      'A new failure mode deserves its own type.',
      'A message could be more actionable.',
    ],
    changeHow: [
      {
        text: 'Extend `FrameworkError` so `instanceof FrameworkError` keeps working.',
        code: `export class RateLimitError extends FrameworkError {\n  constructor(readonly retryAfterMs: number, url: string) {\n    super(\`Rate limited on \${url}; the server asked for \${retryAfterMs}ms. Lower \` +\n      \`WORKERS, or seed with mapWithConcurrency.\`);\n  }\n}`,
      },
      {
        text: 'Write the message as advice, not as a description. "Set X in .env" beats "X is undefined".',
      },
    ],
    why: 'A typed hierarchy lets calling code react differently to different failures, and the shared base means a broad catch still works. The message quality is the real product: it is what somebody reads at 3am.',
    gotchas: [
      '`Error.captureStackTrace(this, new.target)` keeps the stack pointing at the caller rather than at the constructor.',
      'Pass `{ cause: error }` when wrapping, or the original stack is lost — the `preserve-caught-error` lint rule enforces it.',
    ],
    related: ['src/core/http.client.ts', 'src/core/api.response.ts'],
  },

  'src/core/index.ts': {
    group: 'core',
    purpose: 'Barrel for the core layer.',
    changeWhen: ['You add an export to `src/core/`.'],
    changeHow: [{ text: 'Re-export it, with `export type` for types.' }],
    why: 'One import path means the internal file layout can change without breaking callers.',
    related: ['src/core/http.client.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* src/types                                                         */
  /* ---------------------------------------------------------------- */

  'src/types/index.ts': {
    group: 'types',
    purpose:
      'The shared vocabulary. The builder, the client, the response, the auth providers and the reporters all describe a request the same way, so changing the shape of a request is one edit here plus the compiler listing everything that must keep up.',
    blocks: [
      {
        type: 'table',
        head: ['Type', 'Role'],
        rows: [
          [
            '`HttpMethod`, `MUTATING_METHODS`',
            'The verbs, and which of them the read-only guard blocks',
          ],
          [
            '`JsonValue`, `JsonObject`, `JsonArray`',
            'A precise recursive JSON type — better than `any` for parsed payloads',
          ],
          ['`QueryValue`, `QueryParams`', 'Query values, including arrays'],
          ['`HeaderMap`', 'Headers, compared case-insensitively throughout'],
          ['`PathParams`', 'Values substituted into `/users/{id}`'],
          ['`MultipartPart`', 'One part of a multipart upload: inline value, file path, or buffer'],
          [
            '`BodyKind`',
            '**A discriminated union.** Adding a member makes the compiler list every switch that must handle it.',
          ],
          [
            '`RequestSpec`',
            'A fully resolved request — the boundary between the builder and the client',
          ],
          [
            '`RequestTiming`, `ExchangeRecord`',
            'What the recorder, the latency collector and the reporters consume',
          ],
          [
            '`ValidationResult`',
            'One shape for every validator, so assertions do not care which kind of schema ran',
          ],
          ['`Page<T>`', 'A normalised page of results, whatever convention the API uses'],
          [
            '`Awaitable<T>`, `PartialBy`, `UnknownRecord`',
            'Small utilities used across the framework',
          ],
        ],
      },
      {
        type: 'p',
        text: '`UnknownRecord` deserves a mention: it is `Record<string, unknown>`, and it is what makes "no `any`" practical. A parsed payload is genuinely unknown, and saying so forces the narrowing that catches real bugs.',
      },
    ],
    changeWhen: [
      'A request or response gains a dimension.',
      'A shape is being described in two places.',
    ],
    changeHow: [
      {
        text: 'Add the field to `RequestSpec`, then follow the compiler. It will name the builder, the client and the log renderer.',
      },
      {
        text: 'Add a member to `BodyKind` and the exhaustive switches become errors until they handle it — that is the point of the union.',
      },
    ],
    why: 'Types are the cheapest coordination mechanism available. A shared vocabulary means a change is checked rather than searched for, and nothing is missed because nothing *can* be missed.',
    gotchas: [
      'Most fields are `readonly`. A `RequestSpec` is meant to be built once and then treated as a fact.',
      '`HeaderMap` keys are lower-cased by convention, not by the type. Everything that produces one lower-cases it; anything new must too.',
    ],
    related: ['src/core/request.builder.ts', 'src/core/http.client.ts'],
  },
};
