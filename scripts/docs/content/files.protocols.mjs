/** Non-REST protocol clients, service objects, fixtures and lifecycle hooks. */
export default {
  /* ---------------------------------------------------------------- */
  /* src/protocols                                                     */
  /* ---------------------------------------------------------------- */

  'src/protocols/graphql.client.ts': {
    group: 'protocols',
    purpose:
      "GraphQL client: queries, mutations, batching, introspection, and a response wrapper whose assertions understand GraphQL's failure model.",
    blocks: [
      {
        type: 'rule',
        text: 'GraphQL answers `200 OK` and puts the failure in an `errors` array in the body. A test that only checks the status will pass while the query returned nothing at all. `expectNoErrors()` exists to make that impossible to forget.',
      },
      {
        type: 'code',
        caption: 'The shape of a GraphQL test',
        text: `const result = await graphql.query<{ viewer: { id: string } }>(
  \`query Viewer { viewer { id name } }\`,
);

result.expectNoErrors().expectData();
expect(result.path('viewer.name')).toBe('Ada');`,
      },
      {
        type: 'code',
        caption: 'And the negative path',
        text: `const denied = await graphql.mutate(\`mutation Delete { deleteAccount { ok } }\`);
denied.expectError(/not permitted/).expectErrorCode('FORBIDDEN');`,
      },
      { type: 'h3', text: 'Partial success' },
      {
        type: 'p',
        text: 'In GraphQL, `data` and `errors` can both be present — a field resolver failed while the rest succeeded. The wrapper exposes both rather than choosing for you, because which one matters depends on the test.',
      },
      { type: 'h3', text: 'Batching and introspection' },
      {
        type: 'p',
        text: '`batch()` sends several operations in one HTTP request, which is how a GraphQL API is usually rate-limited and load-tested — and some servers behave differently under it. `introspect()` fetches the schema, for detecting drift between deployments.',
      },
    ],
    changeWhen: [
      'The API uses persisted queries or another transport convention.',
      'Errors carry extensions worth asserting on directly.',
      'Subscriptions are needed.',
    ],
    changeHow: [
      {
        text: 'For persisted queries, send the hash instead of the document in `execute`.',
        code: `.json({ extensions: { persistedQuery: { version: 1, sha256Hash: hash } }, variables })`,
      },
      {
        text: 'For subscriptions, use `WebSocketClient` with the `graphql-transport-ws` sub-protocol; the framing is a socket concern, not a GraphQL one.',
        code: `await socket(config.wsUrl, { protocols: ['graphql-transport-ws'] });`,
      },
    ],
    why: 'GraphQL is REST-shaped on the wire and completely different in its error model. Giving it its own client is what stops REST-shaped assertions from silently passing on a failed query.',
    gotchas: [
      'The operation name is extracted from the document for logs and step titles; an anonymous operation shows as `anonymous`.',
      '`batch()` returns one wrapper per operation, in order — a server that reorders them would break that assumption, and none do.',
      'A GraphQL endpoint that returns non-JSON produces an empty envelope rather than throwing; check `result.http.status` when nothing makes sense.',
    ],
    related: ['src/core/http.client.ts', 'src/protocols/websocket.client.ts'],
  },

  'src/protocols/sse.client.ts': {
    group: 'protocols',
    purpose:
      'Server-Sent Events and NDJSON streaming. Implements the `text/event-stream` framing rules and exposes a wait-for-event API.',
    blocks: [
      {
        type: 'note',
        text: "This is the one place the framework does not use Playwright's request context. `APIRequestContext` buffers the whole response before returning it, which is exactly wrong for a stream that stays open — the request would simply never resolve. Node's global `fetch` exposes the body as a readable stream, so these two clients use it. That is a deliberate, documented exception.",
      },
      { type: 'h3', text: 'The framing rules it implements' },
      {
        type: 'ul',
        items: [
          'Fields are `field: value`; an event is terminated by a blank line.',
          'Repeated `data:` lines accumulate, joined by newlines.',
          'A line starting with `:` is a comment — servers send these as keep-alives, and treating one as an event would confuse every waiter.',
          '`\\r\\n` is tolerated, because proxies rewrite line endings.',
        ],
      },
      {
        type: 'code',
        caption: 'Using it',
        text: `const stream = await sse(\`\${config.baseUrl}/v1/events\`);

const started = await stream.waitForEvent('job.started');
const finished = await stream.waitForEvent('job.finished');

expect(SseClient.json<{ id: string }>(finished).id).toBe(jobId);`,
      },
      {
        type: 'p',
        text: 'Events received before a wait begins are searched first, so a test that sends a request and then starts listening does not miss the event that arrived in between.',
      },
      { type: 'h3', text: 'NDJSON' },
      {
        type: 'p',
        text: '`readNdjsonStream` covers the other streaming convention — log tails, bulk exports, token streams — with a signature that mirrors the SSE client so switching between them costs nothing.',
      },
    ],
    changeWhen: [
      'The server uses non-standard framing.',
      'Reconnection with `Last-Event-ID` needs to be automatic.',
    ],
    changeHow: [
      { text: 'Framing lives entirely in `parseFrame`; nothing else needs to change.' },
      {
        text: 'For reconnection, catch the read loop ending and re-connect with the last id — the option already exists.',
        code: `new SseClient(url, { lastEventId: stream.events.at(-1)?.id });`,
      },
    ],
    why: 'A stream test that misses an event is a flaky test, and the miss is almost always a race between connecting and listening. Buffering from the moment the stream opens removes the race entirely.',
    gotchas: [
      '**Always close the stream.** An open stream keeps the Node event loop alive and the worker never exits. The `sse` fixture closes everything on teardown, which is why it exists.',
      'If events never arrive, a proxy is probably buffering. Confirm with `curl -N`; the framework cannot fix a proxy.',
      'The idle timeout is per-event, not per-stream: a stream that sends one event a minute is fine.',
    ],
    related: ['src/fixtures/api.fixture.ts', 'src/config/timeouts.ts'],
  },

  'src/protocols/websocket.client.ts': {
    group: 'protocols',
    purpose:
      "WebSocket client built on Node's global `WebSocket`, with every received frame buffered from the moment it connects.",
    blocks: [
      {
        type: 'rule',
        text: 'The buffering is the design point. A test that sends a request and *then* starts listening will otherwise miss a reply that arrived first — the single most common source of flaky WebSocket tests. `waitFor` searches the buffer before it waits, so ordering does not matter.',
      },
      {
        type: 'code',
        caption: 'Request and correlated reply, in one call',
        text: `const socket = await openSocket();
const reply = await socket.request<{ id: number; status: string }>(
  { type: 'subscribe', id: 7 },
  (message) => message.id === 7,
);
expect(reply.status).toBe('ok');`,
      },
      {
        type: 'table',
        head: ['Method', 'Does'],
        rows: [
          [
            '`connect(timeout)`',
            'Opens and resolves on handshake; sends `onOpenSend` if configured',
          ],
          ['`send(payload)`', 'Objects are JSON-encoded, strings go as-is'],
          ['`waitFor(predicate)`', 'Searches the buffer, then waits'],
          ['`waitForJson(matches)`', 'The same, parsing each frame, returning it parsed'],
          ['`request(payload, matches)`', 'Send and await the correlated reply'],
          [
            '`close(code, reason)`',
            'Closes, with a 2s escape hatch for a server that ignores the frame',
          ],
        ],
      },
      {
        type: 'p',
        text: 'No dependency: `WebSocket` has been global in Node since 22, which is what `.nvmrc` pins. A library here would be a second implementation to keep current.',
      },
    ],
    changeWhen: [
      'A sub-protocol needs negotiating.',
      'Reconnection should be automatic.',
      'Binary frames are needed.',
    ],
    changeHow: [
      {
        text: 'Sub-protocols are an option.',
        code: `new WebSocketClient(url, { protocols: ['graphql-transport-ws'], onOpenSend: { type: 'connection_init' } });`,
      },
      {
        text: 'For binary, widen `SocketMessage.data` and stop coercing with `String(event.data)` in the message listener.',
      },
    ],
    why: 'Socket tests fail for two reasons: a missed message and a leaked connection. The buffer fixes the first; the `socket` fixture closing everything on teardown fixes the second.',
    gotchas: [
      'Node 22 or newer is required for the global `WebSocket`. Older Node fails at run time, not at install.',
      '`close()` resolves after two seconds even if the server never acknowledges, so a misbehaving server cannot hang the run.',
      '`closure` records the close code and reason — useful when a server closes for a policy reason rather than replying.',
    ],
    related: ['src/fixtures/api.fixture.ts', '.nvmrc', 'src/config/timeouts.ts'],
  },

  'src/protocols/index.ts': {
    group: 'protocols',
    purpose: 'Barrel for the non-REST protocol clients.',
    changeWhen: ['You add a protocol client.'],
    changeHow: [
      {
        text: 'Re-export it, and add a fixture in `api.fixture.ts` if it needs lifecycle management — anything holding a connection does.',
      },
    ],
    why: 'Anything that keeps a connection open needs a fixture to close it. The barrel is the reminder that the two go together.',
    related: ['src/fixtures/api.fixture.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* src/services                                                      */
  /* ---------------------------------------------------------------- */

  'src/services/object.service.ts': {
    group: 'services',
    purpose:
      "The service object for **https://api.restful-api.dev/objects** — the live CRUD resource the lifecycle suite runs against. It is the framework's worked example against a real API.",
    blocks: [
      { type: 'h3', text: 'What the real API actually does' },
      {
        type: 'p',
        text: 'Everything in this file was established by **calling the API**, not by reading its documentation, because the two disagree in several places. Each quirk is encoded in a schema and asserted by a test, so if the API changes the suite says so.',
      },
      {
        type: 'table',
        head: ['Operation', 'Reality', 'What a naive schema would get wrong'],
        rows: [
          [
            '`POST /objects`',
            '**200**, not 201, with `{ id, name, createdAt, data }`',
            'Expecting 201 — the client would raise on every create',
          ],
          [
            '`GET /objects/{id}`',
            '`{ id, name, data }` — **no timestamps at all**',
            'A single Object schema requiring `createdAt` fails on every read',
          ],
          [
            '`GET /objects`',
            'Only the 13 seeded objects; created ones are never listed',
            'Asserting a created object appears in the list',
          ],
          [
            '`GET /objects?id=1&id=2`',
            'Repeated parameters filter; a comma-joined list is **ignored**',
            'A filter that silently returns everything',
          ],
          [
            '`PUT` / `PATCH`',
            '200 with `updatedAt` and no `createdAt`',
            'Reusing the create schema',
          ],
          [
            '`DELETE`',
            '**200 with a message body**, not 204; a second delete is 404',
            'Expecting 204 and an empty body',
          ],
          [
            'Errors',
            '`{ error: string }` — **not** RFC 9457 problem details',
            'Asserting the standard shape',
          ],
          ['Malformed JSON', '400 `{ error: "Invalid request body" }`', ''],
          [
            'Validation',
            '**None.** An empty body is accepted and stored with `name: null`',
            'Assuming `name` is always a string',
          ],
        ],
      },
      { type: 'h3', text: 'Why three schemas, not one' },
      {
        type: 'code',
        caption: 'The timestamps are what force the split',
        text: `const objectBase = z.object({ id: z.string().min(1), name: z.string().nullable(), data: ObjectDataSchema.optional() }).passthrough();

export const ApiObjectSchema = objectBase;                                     // reads
export const CreatedObjectSchema = objectBase.extend({ createdAt: z.number() }); // POST only
export const UpdatedObjectSchema = objectBase.extend({ updatedAt: z.number() }); // PUT/PATCH only`,
      },
      {
        type: 'p',
        text: '`.passthrough()` matters as much as the split. A strict schema turns "the API added a field" — which breaks nobody — into a suite-wide failure, and teams respond to that by deleting the schema check entirely.',
      },
      { type: 'h3', text: 'The quota guard' },
      {
        type: 'code',
        caption: 'A refusal is not a failure',
        text: `static isQuotaExhausted(response: ApiResponse<unknown>): boolean {
  return response.status === 405 && /daily request limit/i.test(response.text());
}`,
      },
      {
        type: 'p',
        text: "The API allows 50 anonymous requests per 24 hours. A test that fails because somebody else used the day's quota tells nobody anything, so the live suite detects the refusal and skips with a reason.",
      },
      { type: 'h3', text: 'Two design points worth copying' },
      {
        type: 'code',
        caption: 'Creation and cleanup are one expression',
        text: `const created = response.parse(CreatedObjectSchema, 'object-created');
return this.track(created, \`object \${created.id}\`, () => this.remove(created.id));`,
      },
      {
        type: 'code',
        caption: 'And delete tolerates "already gone"',
        text: `await this.del('/{id}').param('id', id).expectStatus(200, 404).send();
this.cleanup.forget(\`object \${id}\`);`,
      },
      {
        type: 'p',
        text: 'Cleanup runs after tests that may have deleted the object themselves. If a second delete failed, every such test would go red in teardown for no reason.',
      },
    ],
    changeWhen: [
      'The API changes — the schemas and the table above are where that is recorded.',
      'You point the framework at your own API: this is the file to copy.',
      'A new operation is needed.',
    ],
    changeHow: [
      {
        text: 'Change a schema and the registration together; they sit side by side for that reason.',
      },
      {
        text: 'When adapting to your own API, keep the shape: schema first, type inferred, registration, then intention-revealing methods that never assert.',
      },
      {
        text: 'Run the live suite within quota after any change, so the stub and the API are checked against each other.',
      },
    ],
    why: 'This file is where all knowledge of one real API lives. When the endpoint moves or its payload changes, exactly one file changes — not every test that happened to mention objects.',
    gotchas: [
      "`.arrays('repeat')` on the list call is load-bearing. The comma form produces a request the API answers 200 to and filters nothing.",
      'The idempotency key on create is what makes the client willing to retry a POST at all.',
      'Schemas register on import, so a service nobody imports registers nothing.',
    ],
    related: [
      'tests/api/objects.crud.spec.ts',
      'src/mocks/objects.stub.ts',
      'src/contracts/schema.registry.ts',
    ],
  },

  'src/services/post.service.ts': {
    group: 'services',
    purpose:
      'The service object for **https://jsonplaceholder.typicode.com/posts** — reads and real `Link` header pagination over a stable 100-record dataset.',
    blocks: [
      {
        type: 'p',
        text: 'It exists to exercise the two things the CRUD target cannot demonstrate: genuine RFC 8288 pagination, and a dataset large and stable enough that exact counts can be asserted without flakiness.',
      },
      { type: 'h3', text: 'Reached through a derived client' },
      {
        type: 'code',
        caption: 'A different host, in the fixture',
        text: `posts: new PostService(http.withBaseUrl(PUBLIC_APIS.jsonPlaceholder), {
  cleanup,
  logger: log.child('posts'),
}),`,
      },
      {
        type: 'p',
        text: "`withBaseUrl` derives rather than constructs, which keeps the run's observers — latency collection, exchange recording, the contract guard — attached. A freshly built `HttpClient` would silently lose all three.",
      },
      { type: 'h3', text: 'The pagination walk' },
      {
        type: 'code',
        caption: 'The server hands back the next URL; the walker just follows it',
        text: `return followLinkHeader<Post>(
  first,
  (url) => this.http.get(url).expectStatus(200).as('next page').send(),
  (response) => response.parse(PostListSchema, 'post-list'),
);`,
      },
      {
        type: 'p',
        text: 'This is the one pagination style where the client needs no knowledge of the API\'s own parameter names. `followLinkHeader` stops when no `rel="next"` arrives and has a hard page ceiling, so a server that always advertises another page produces a clear failure rather than a hang.',
      },
      {
        type: 'note',
        text: 'The write method is called **`simulateCreate`**, not `create`. This API answers 201 with an echoed body and persists nothing; a method named `create` that does not create is a trap for the next person.',
      },
    ],
    changeWhen: ['Your API paginates differently.', 'The dataset size changes.'],
    changeHow: [
      {
        text: 'Swap the walker: `followCursor` for opaque cursors, `followOffset` for offset/limit. All three take the same shape of callback.',
      },
      { text: 'Keep the total in a constant like `TOTAL_POSTS` so a change is one edit.' },
    ],
    why: 'One API rarely demonstrates everything. Having a second service on a second host, reached through a derived client, is also the pattern any real project needs the moment it talks to more than one service.',
    gotchas: [
      'The `Link` URLs are absolute and come from the server, so they pass through `resolveUrl` untouched — which is what makes the walker host-agnostic.',
    ],
    related: [
      'tests/api/posts.pagination.spec.ts',
      'src/utils/pagination.utils.ts',
      'src/config/environments.ts',
    ],
  },

  'src/services/template.service.ts': {
    group: 'services',
    purpose:
      'A worked example of a service object — copy it to start a new one. Deliberately complete rather than minimal, because every question that comes up when writing the *second* service object is answered in it.',
    blocks: [
      { type: 'h3', text: 'What it demonstrates' },
      {
        type: 'table',
        head: ['Pattern', 'Where'],
        rows: [
          ['Schema first, type inferred from it', '`UserSchema` / `type User = z.infer<…>`'],
          ['Registering schemas for the contract guard', '`registerSchemas([...])`'],
          ['Creation that registers its own cleanup', '`create()`'],
          [
            'A read that returns `undefined` for 404',
            '`find()` — with `require()` as the throwing form',
          ],
          ['A list that follows pagination to the end', '`list()`'],
          ['A delete that tolerates "already gone"', '`remove()` — accepts 204, 200 **and** 404'],
          ['An escape hatch for tests that need the response', '`rawCreate()`'],
        ],
      },
      {
        type: 'code',
        caption: 'Schema first — so the runtime check and the compile-time type cannot disagree',
        text: `export const UserSchema = z.object({
  id: identifier,
  email: z.string().email(),
  role: z.enum(['admin', 'standard', 'readonly']),
  createdAt: isoDateTime,
});

export type User = z.infer<typeof UserSchema>;`,
      },
      {
        type: 'code',
        caption: 'Creation and cleanup in one expression',
        text: `const user = response.parse(UserSchema, 'user');
return this.track(user, \`user \${String(user.id)}\`, () => this.remove(user.id));`,
      },
      {
        type: 'note',
        text: '`remove()` accepts 404 because cleanup runs after tests that may already have deleted the resource themselves. "Already gone" has to count as success, or every such test fails in teardown.',
      },
    ],
    changeWhen: [
      'You are writing a new service — copy this.',
      'A pattern here proves wrong and should be corrected everywhere.',
    ],
    changeHow: [
      { text: 'Copy, rename, change `basePath`, and replace the schema with the real resource.' },
      { text: 'Export from `src/services/index.ts` and add to the `api` fixture.' },
      { text: 'Register the schemas so the contract guard can find them.' },
    ],
    why: "The second service object is where a codebase's conventions are actually set. Making the first one exemplary — with its reasoning in comments — is cheaper than reviewing the next ten.",
    gotchas: [
      '`remove()` calls `cleanup.forget()` so a resource deleted by the test is not deleted again in teardown.',
      'Schemas register on import. A service nobody imports registers nothing.',
      'Service methods never assert. If you find yourself wanting one to, the assertion belongs in the test.',
    ],
    related: [
      'src/core/base.service.ts',
      'src/contracts/schema.registry.ts',
      'src/utils/cleanup.registry.ts',
    ],
  },

  'src/services/index.ts': {
    group: 'services',
    purpose:
      'The service registry: every service is exported here and constructed by the `api` fixture, so a test reaches them all through one object.',
    changeWhen: ['You add a service.'],
    changeHow: [
      { text: 'Export the class, its schema and its types.' },
      {
        text: 'Add it to the `api` fixture — two lines, and it is available to every test.',
        code: `await use({\n  users: new UserService(http, { cleanup, logger: log.child('users') }),\n  orders: new OrderService(http, { cleanup, logger: log.child('orders') }),\n});`,
      },
    ],
    why: "Passing the shared `cleanup` registry to every service is what makes a test's teardown run as one ordered sequence rather than as several independent ones.",
    gotchas: [
      'Forgetting to pass `cleanup` gives the service its own registry, which nothing drains — a silent leak.',
    ],
    related: ['src/fixtures/api.fixture.ts', 'src/services/template.service.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* src/fixtures                                                      */
  /* ---------------------------------------------------------------- */

  'src/fixtures/api.fixture.ts': {
    group: 'fixtures',
    purpose:
      'The fixtures every test imports. A test opens with the things it needs and nothing else; everything behind that — building an authenticated client, seeding deterministic data, collecting latency, recording exchanges, deleting what the test created — is set up and torn down here.',
    blocks: [
      { type: 'h3', text: 'Worker-scoped' },
      {
        type: 'table',
        head: ['Fixture', 'Is'],
        rows: [
          ['`tokens`', 'The token cache shared by every test in the worker'],
          [
            '`workerRequest`',
            'A request context outliving individual tests, for worker-level setup',
          ],
          [
            '`mockServer`',
            'The stub server. Started on port 0 so parallel workers never collide — and only started if a test asks for it.',
          ],
          ['`contract`', 'The OpenAPI document, if `src/data/openapi.json` exists'],
        ],
      },
      { type: 'h3', text: 'Test-scoped' },
      {
        type: 'table',
        head: ['Fixture', 'Is'],
        rows: [
          ['`data`', "Faker, seeded from the test's own title path"],
          ['`log`', "A logger prefixed with the test's name"],
          ['`cleanup`', 'The registry, drained after the test — including when it failed'],
          ['`auth`', 'The credential source chosen from what the environment supplies'],
          ['`http`', 'The authenticated client, with latency and recording attached'],
          ['`anonymousHttp`', 'An unauthenticated client, for the 401 path'],
          ['`httpAs(role)`', 'A client authenticated as a named role, memoised per role'],
          ['`api`', 'Every service object, sharing one cleanup registry'],
          ['`graphql`', 'The GraphQL client'],
          ['`latency`', 'Per-route timings, attached to the test as `latency.json`'],
          [
            '`recorder`',
            'Every exchange; saved to `reports/recordings/` **only when the test fails**',
          ],
          ['`sse` / `socket`', 'Factories that open a stream or socket and close it on teardown'],
          [
            '`contractGuard`',
            'Automatic schema validation. `auto: true`, so it applies without being named.',
          ],
        ],
      },
      { type: 'h3', text: 'Deterministic data' },
      {
        type: 'code',
        caption: 'Seeded from the test itself',
        text: `data: async ({}, use, testInfo) => {
  await use(seededFaker(testInfo.titlePath.join(' > ')));
},`,
      },
      {
        type: 'p',
        text: 'The same test always gets the same data across runs and machines, while two different tests never collide. Random enough to catch a uniqueness bug, reproducible enough to debug one.',
      },
      { type: 'h3', text: 'The contract guard' },
      {
        type: 'code',
        caption: 'auto: true — because contract drift is found by the tests nobody wrote',
        text: `contractGuard: [
  async ({ http, log }, use): Promise<void> => {
    if (config.strictContracts) {
      http.onResponse((response) => { /* validate against the registered schema */ });
    }
    await use(undefined);
  },
  { auto: true },
],`,
      },
      { type: 'h3', text: 'Choosing credentials' },
      {
        type: 'p',
        text: '`defaultAuthProvider` picks in order: OAuth2 if a token endpoint is configured, then an API key, then Basic credentials, then nothing. That ordering is what makes moving an environment from API keys to OAuth a `.env` change.',
      },
    ],
    changeWhen: [
      'Tests repeatedly build the same thing themselves.',
      'You add a service, or a client that holds a connection.',
      'Something must happen for every test.',
    ],
    changeHow: [
      {
        text: 'Declare the type in `ApiFixtures` or `WorkerFixtures`, then implement it. `use` is the boundary between setup and teardown.',
        code: `tenant: async ({ http }, use) => {\n  const created = await http.post('/tenants').json({ name: uniqueId('t') }).send();\n  await use(created.path<string>('id'));\n  await http.delete(\`/tenants/\${created.path<string>('id')}\`).send();\n},`,
      },
      { text: 'Choose scope on one question: can a test change it? If yes, test scope.' },
      {
        text: 'Use `auto: true` only for something that must apply universally — it costs every test, named or not.',
      },
    ],
    why: 'A fixture is set up and torn down by the framework, so it runs on failure too. Anything a test would otherwise have to remember to clean up belongs here, because "remember to" is not a mechanism.',
    gotchas: [
      'A fixture cycle deadlocks with an unhelpful error. Split the shared part into a third fixture rather than trying to break the cycle in place.',
      'Playwright reads the parameter destructuring to resolve dependencies, so a fixture with none must be written `async ({}, use)` — which is why `no-empty-pattern` is disabled for this folder.',
      'Worker-scoped mutable state makes failures depend on worker count. Both of the worker fixtures here are effectively immutable.',
      "The recorder attaches only on failure; a passing test's recording is noise.",
    ],
    related: [
      'src/fixtures/index.ts',
      'src/services/index.ts',
      'src/auth/index.ts',
      'src/mocks/mock.server.ts',
    ],
  },

  'src/fixtures/custom-matchers.ts': {
    group: 'fixtures',
    purpose:
      'Nine custom `expect` matchers for API responses, registered through `expect.extend` — which returns a *typed* `expect`, so no separate type declaration is needed.',
    blocks: [
      {
        type: 'table',
        head: ['Matcher', 'Asserts'],
        rows: [
          ['`toHaveStatus(code | codes)`', 'An exact status, or one of several'],
          ['`toBeSuccessful()`', 'Any 2xx'],
          [
            '`toHaveHeader(name, value?)`',
            'A header exists, optionally matching a string or pattern',
          ],
          ['`toMatchSchema(schema, name?)`', 'A Zod schema, reporting every violation'],
          ['`toMatchJsonSchema(schema)`', 'A JSON Schema document'],
          ['`toSatisfyContract(contract)`', 'The published OpenAPI document'],
          ['`toHaveJsonPath(path, value?)`', 'A value at a JSON path'],
          ['`toRespondWithin(ms)`', 'A latency bound'],
          [
            '`toMatchPayload(expected, options?)`',
            'Structural equality, failing with a **diff** rather than two pretty-printed objects',
          ],
        ],
      },
      { type: 'h3', text: 'Why both these and the response methods' },
      {
        type: 'p',
        text: 'The response wrapper already carries assertions. These exist for the cases where `expect(...)` reads better — negated assertions, `expect.soft`, and anything that is not a response, such as `toMatchPayload`.',
      },
      {
        type: 'p',
        text: "Every matcher's failure message appends the same `context(response)` block — the request, the status, the timing and a body excerpt — so a matcher failure and a response-method failure carry the same information.",
      },
      {
        type: 'code',
        caption: 'The typing detail that matters',
        text: `// expect.extend returns a NEW expect carrying the matchers' types, which is why
// the result is captured rather than discarded. Mutating the global expect would
// register them at run time and leave TypeScript unaware of them.
export const expect = baseExpect.extend({ /* … */ });`,
      },
    ],
    changeWhen: [
      'An assertion should be negatable or soft.',
      'An assertion applies to something that is not a response.',
    ],
    changeHow: [
      {
        text: 'Add a method to the object, returning `MatcherResult`. The type flows to every call site automatically.',
        code: `toHaveCursor(response: ApiResponse, expected?: string): MatcherResult {\n  const cursor = response.path<string>('nextCursor');\n  const pass = expected === undefined ? cursor !== undefined : cursor === expected;\n  return { pass, message: () => \`…\${context(response)}\` };\n}`,
      },
      {
        text: 'Write the message for both directions — a negated matcher shows the `pass: true` branch.',
      },
    ],
    why: 'A matcher\'s message is read at the worst possible moment. Including the request that produced the response turns "expected 200, got 500" into something somebody can act on without re-running anything.',
    gotchas: [
      'Import `expect` from `@fixtures`, never from `@playwright/test` — the Playwright one has none of these.',
      'The `message` closure is lazy, so the body excerpt is only rendered when the assertion actually fails.',
    ],
    related: ['src/core/api.response.ts', 'src/fixtures/index.ts', 'src/utils/diff.utils.ts'],
  },

  'src/fixtures/index.ts': {
    group: 'fixtures',
    purpose:
      "The single import for every test. `import { test, expect } from '@fixtures'` — and nothing else.",
    blocks: [
      {
        type: 'rule',
        text: 'Importing `test` or `expect` from `@playwright/test` gives you a `test` with no cleanup registry, no contract guard and none of the custom matchers — and nothing will tell you. This is the single most expensive mistake available in the repository.',
      },
      {
        type: 'code',
        caption: 'What every spec starts with',
        text: `import { test, expect } from '../../src/fixtures';`,
      },
    ],
    changeWhen: ['You add a fixture or a matcher that tests need.'],
    changeHow: [{ text: 'Re-export it. If it is a type, use `export type`.' }],
    why: 'One import path makes the rule enforceable — a lint rule can ban the Playwright import outright, which is much easier than reviewing for it.',
    gotchas: [
      'Adding an ESLint `no-restricted-imports` rule for `@playwright/test` inside `tests/**` is worth doing the first time somebody gets this wrong.',
    ],
    related: ['src/fixtures/api.fixture.ts', 'src/fixtures/custom-matchers.ts', 'tests/README.md'],
  },

  /* ---------------------------------------------------------------- */
  /* src/hooks                                                         */
  /* ---------------------------------------------------------------- */

  'src/hooks/global.setup.ts': {
    group: 'hooks',
    purpose:
      'Runs once before any test. Its job is to fail fast and loudly when the run cannot possibly succeed.',
    blocks: [
      {
        type: 'p',
        text: 'A suite that starts against an unreachable environment produces hundreds of confusing connection errors. This turns that into one sentence naming the URL it could not reach.',
      },
      {
        type: 'code',
        caption: 'The reachability check is deliberately tolerant',
        text: `const response = await context.get(config.baseUrl, { failOnStatusCode: false });
log.info('target reachable', { url: config.baseUrl, status: response.status() });`,
      },
      {
        type: 'p',
        text: 'A 401 or a 404 still proves the host is up and reachable, which is the only thing this check is for. **Only a transport failure stops the run** — anything stricter would fail on APIs with no root route.',
      },
      {
        type: 'p',
        text: 'It also creates the output directories up front, so a reporter writing its first file never races another worker, and writes `reports/run-context.json` with the environment, the start time and the CI commit and branch.',
      },
      {
        type: 'rule',
        text: 'Anything whose failure would make *every* test fail belongs here, and nothing else does. Per-test setup belongs in a fixture, which knows what that test needs and runs on failure too.',
      },
    ],
    changeWhen: [
      'A precondition should stop the whole run.',
      'The run context should record something more.',
    ],
    changeHow: [
      {
        text: 'Add a check that throws with an actionable message.',
        code: `if (config.strictContracts && !fs.existsSync(OPENAPI_PATH)) {\n  throw new Error('STRICT_CONTRACTS is on but src/data/openapi.json is missing.');\n}`,
      },
      {
        text: 'Resist adding data seeding here. Seeding that all tests share is shared mutable state, which is the thing fixtures exist to avoid.',
      },
    ],
    why: 'The difference between "one clear message" and "four hundred connection errors" is entirely about where the check lives. Failing before the first test is worth more than any diagnostic afterwards.',
    gotchas: [
      'It runs once per **run**, not per worker, so nothing here can be worker-specific.',
      'Anything thrown here aborts the run before a single test appears in the report.',
      'The request context must be disposed, or the process may not exit.',
    ],
    related: ['src/hooks/global.teardown.ts', 'src/config/env.config.ts', 'playwright.config.ts'],
  },

  'src/hooks/global.teardown.ts': {
    group: 'hooks',
    purpose:
      'Runs once after every test. Clears the token cache and finalises the run context with a duration.',
    blocks: [
      {
        type: 'p',
        text: 'Kept deliberately small. Per-test cleanup belongs in the `cleanup` fixture, which runs even when a test fails and knows what *that* test created; global teardown runs once and knows nothing, so anything it deletes it deletes blindly.',
      },
      {
        type: 'p',
        text: 'Clearing the token store is a security measure: it stops a live access token lingering in a cache file on a shared build agent.',
      },
    ],
    changeWhen: [
      'A shared resource needs closing.',
      'The run summary should record something more.',
    ],
    changeHow: [
      { text: 'Close what global setup opened. Keep the symmetry visible.' },
      {
        text: "Never delete data here based on a naming convention — one wrong pattern deletes somebody else's fixtures, and there is no test to blame it on.",
      },
    ],
    why: 'Teardown that runs once cannot know what any individual test created. Cleanup belongs where the knowledge is, which is the fixture.',
    gotchas: [
      'It does not run if global setup threw — anything that must always run has to handle that.',
      'Playwright does not fail a run because teardown threw, so an error here is easy to miss. Log rather than throw.',
    ],
    related: [
      'src/hooks/global.setup.ts',
      'src/utils/cleanup.registry.ts',
      'src/auth/token.store.ts',
    ],
  },

  'src/hooks/auth.setup.ts': {
    group: 'hooks',
    purpose:
      "Captures an authenticated session before the suite runs. **The only file in the framework that knows anything about a specific API's login endpoint** — so when the login contract changes, exactly one file changes.",
    blocks: [
      {
        type: 'p',
        text: "It runs as a Playwright *project* rather than inside `globalSetup`, which buys three things: it appears in the report as a real step, it retries like any other test, and every other project can declare `dependencies: ['setup']` so nothing starts until credentials exist.",
      },
      {
        type: 'code',
        caption: 'The part you adapt is fenced',
        text: `/* ---- Adapt from here down to the API under test. ------------------ */
const response = await request.post(\`\${config.baseUrl}\${config.apiPrefix}/auth/login\`, {
  data: { username: credentials.username, password: credentials.password },
  failOnStatusCode: false,
});
/* ---- Adapt to here. ----------------------------------------------- */`,
      },
      {
        type: 'p',
        text: "It skips rather than fails when no credentials are configured, so a fork's pull request or an offline contract run is not blocked by a missing secret.",
      },
      {
        type: 'note',
        text: 'Only useful for APIs that authenticate by session or long-lived token. When the API uses OAuth client credentials, delete this file and the `setup` project — the token fixture covers that case with no setup step.',
      },
    ],
    changeWhen: [
      'The login endpoint, its payload or its response shape changes.',
      'More than one role needs a captured session.',
    ],
    changeHow: [
      {
        text: 'Change what is inside the fence. Everything outside it — the skip, the file write, the permissions — stays.',
      },
      {
        text: 'For several roles, loop and write each under its own key.',
        code: `for (const role of ['admin', 'standard'] as const) {\n  if (!hasUser(role)) continue;\n  tokens[role] = await login(getUser(role));\n}`,
      },
    ],
    why: 'Every framework ends up with one file that knows the application. Making that explicit — one file, fenced, documented — is what stops application knowledge leaking into ten others.',
    gotchas: [
      'The written file is a live credential: mode `0600`, under git-ignored `storage/`.',
      'Delete `storage/*.json` after a password change, or the old session keeps being replayed.',
      'The assertion message names this file, so somebody hitting a login failure is told where to look.',
    ],
    related: [
      'src/auth/token.store.ts',
      'src/config/env.config.ts',
      'playwright.config.ts',
      '.gitignore',
    ],
  },
};
