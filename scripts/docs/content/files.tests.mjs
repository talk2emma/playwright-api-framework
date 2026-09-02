/** The specs themselves: what each one proves, and against which real API. */
export default {
  'tests/api/objects.crud.spec.ts': {
    group: 'tests',
    purpose:
      'The headline suite: a full create-read-update-delete lifecycle against **https://api.restful-api.dev**, a live public API that genuinely persists writes. No stubs, no credentials.',
    blocks: [
      { type: 'h3', text: 'Why this file is small' },
      {
        type: 'p',
        text: 'The API allows **50 anonymous requests per 24 hours**, then answers `405` with an explanatory body until the window resets. That single fact shapes the whole file: one full lifecycle plus four focused checks, about sixteen requests, and it **skips rather than fails** when the quota is gone.',
      },
      {
        type: 'rule',
        text: "A red build caused by somebody else having used the day's quota teaches nobody anything. The exhaustive coverage lives in `tests/contract/objects.stubbed.spec.ts`, which runs the same service against an executable model of the same contract — unlimited, offline, every run.",
      },
      { type: 'h3', text: 'The division of labour' },
      {
        type: 'table',
        head: ['Suite', 'Proves', 'How often'],
        rows: [
          ['This file', 'The API really behaves as we believe', 'A few times a day, within quota'],
          [
            '`objects.stubbed.spec.ts`',
            'Our client handles that behaviour correctly',
            'Every single run',
          ],
        ],
      },
      {
        type: 'p',
        text: 'If the two disagree, either the API changed or we misread it — and either way that is exactly what a suite is for.',
      },
      { type: 'h3', text: 'The quota probe' },
      {
        type: 'code',
        caption: 'One probe per worker, not one per test',
        text: `let quotaProbe: Promise<boolean> | undefined;

test.beforeEach(async ({ api }) => {
  quotaProbe ??= api.objects.quotaAvailable();

  test.skip(
    !(await quotaProbe),
    'The restful-api.dev anonymous quota (50 requests / 24h) is exhausted. ' +
      'The same lifecycle is covered offline by tests/contract/objects.stubbed.spec.ts.',
  );
});`,
      },
      {
        type: 'p',
        text: 'The probe costs a request, so the **promise** is memoised at module scope rather than the result. Caching the promise means concurrent tests in the same worker share one in-flight request instead of racing to make several.',
      },
      { type: 'h3', text: 'The five tests' },
      {
        type: 'table',
        head: ['Test', 'What it proves'],
        rows: [
          [
            'the full lifecycle `@smoke`',
            'Create → read → replace → patch → delete, in order, on one object. The only test whose steps depend on each other, and the only one that proves the operations compose.',
          ],
          [
            'CREATE answers 200',
            'The real status is 200, not the 201 a REST purist expects — and the response carries `createdAt`.',
          ],
          [
            'LIST filters by repeated ids',
            'The `?id=1&id=2` encoding really filters. Encoded as `?id=1,2,3` the API ignores it and returns everything — a request that succeeds and filters nothing.',
          ],
          [
            'DELETE is not repeatable',
            '200 with a message body, then 404. Which is why `remove()` tolerates 404 during cleanup.',
          ],
          [
            'a read matches its schema',
            'Reads carry no timestamps at all, asserted through `fields()`.',
          ],
        ],
      },
      { type: 'h3', text: 'Why the read after every write' },
      {
        type: 'p',
        text: 'Each mutation is followed by a read. Without it, a create test passes just as happily against an API that accepts the request and discards it — and a PATCH test never notices that the API silently cleared the fields it was not sent.',
      },
      { type: 'h3', text: 'What makes it safe to run in parallel' },
      {
        type: 'ul',
        items: [
          'Every object is created by the test that uses it. Nothing depends on data somebody else left behind.',
          'Names come from `uniqueId`, so two workers cannot collide.',
          '`create` registers its own deletion, so the framework tidies up even when a test fails.',
          'The API never returns created objects from its list endpoint, so a test cannot be disturbed by what the rest of the internet is creating right now.',
        ],
      },
    ],
    changeWhen: [
      'The API changes — this suite is what tells you.',
      'You point the framework at your own API: replace the service and the schemas, and this structure carries over unchanged.',
      'The quota changes, or you sign up for an account with a larger one.',
    ],
    changeHow: [
      {
        text: 'To run everything that spends no quota:',
        code: `npx playwright test --grep-invert @live`,
      },
      {
        text: 'To spend quota deliberately, on just the lifecycle:',
        code: `npx playwright test --grep "@objects.*@smoke"`,
      },
      {
        text: 'When adapting to your own API, keep the shape: one composing lifecycle test, several focused ones. The lifecycle tells you *that* something broke; the focused tests tell you *what*.',
      },
    ],
    why: 'A CRUD suite is the first thing anyone writes against a new API and the thing most often written badly — a create that never reads back, a PATCH that never checks what survived, a delete that never confirms. This file is the reference for doing it properly against something real.',
    gotchas: [
      'The quota is shared with everyone using the public API, so it can be gone before your first run of the day. That is what the skip is for.',
      '`test.skip` inside `beforeEach` skips the individual test, not the file — which is what allows the probe to be awaited first.',
      'The focused CREATE test creates outside the service, so it removes the object by hand. That is precisely the chore `create()` exists to remove.',
    ],
    related: [
      'src/services/object.service.ts',
      'tests/contract/objects.stubbed.spec.ts',
      'src/mocks/objects.stub.ts',
    ],
  },

  'tests/contract/objects.stubbed.spec.ts': {
    group: 'tests',
    purpose:
      'The same `ObjectService`, the same lifecycle, run against an in-memory model of the same contract. Unlimited, offline, deterministic — and able to produce failure modes no real API will give you on demand.',
    blocks: [
      { type: 'h3', text: 'What it proves, and what it cannot' },
      {
        type: 'p',
        text: 'It proves the **client half** of the contract: that the service builds the right requests, sends the right bodies, and correctly interprets every response including the quirks. It cannot prove the API still behaves that way — only the live suite can do that. Together they cover both halves.',
      },
      { type: 'h3', text: 'Twelve tests, in four groups' },
      {
        type: 'table',
        head: ['Group', 'Covers'],
        rows: [
          [
            'Lifecycle',
            'Create → read → replace → patch → delete, with the PUT/PATCH distinction asserted explicitly.',
          ],
          [
            'Request shape',
            'What actually went on the wire: content type, idempotency key, body, and the repeated-id query encoding.',
          ],
          [
            'Failure modes',
            "404 and its error shape, a repeated delete, a malformed body, and the API's complete absence of validation.",
          ],
          [
            'Client resilience',
            'Retry on a transient failure, **no** retry on a verdict, and a timeout — none of which a real API will produce to order.',
          ],
        ],
      },
      {
        type: 'code',
        caption: 'The resilience test that a stub makes possible',
        text: `mockServer.flaky('/objects/*', 2, { id: '1', name: 'recovered', data: null });

const response = await http.withBaseUrl(mockServer.url).get('/objects/1').retries(3).send();

response.expectOk().expectPath('name', 'recovered');
expect(response.timing.attempts).toBe(3);`,
      },
      {
        type: 'p',
        text: 'The endpoint really does recover, so a client that gives up too early fails and one that retries forever never finishes. A mock that always succeeds would prove neither.',
      },
      {
        type: 'code',
        caption: 'And its opposite — the assertion that verdicts are never retried',
        text: `mockServer.fail('/objects/*', 404, { error: 'Object with id=x was not found.' });

const response = await http.withBaseUrl(mockServer.url).get('/objects/x').retries(3).send();

expect(response).toHaveStatus(404);
expect(response.timing.attempts).toBe(1);`,
      },
      {
        type: 'note',
        text: 'That second assertion guards the structural decision in `http.client.ts`: only the transport call sits inside the retry `try`. A 404 is an answer, not a fault, and retrying it would be three identical failures and a slower suite.',
      },
      { type: 'h3', text: 'Test isolation' },
      {
        type: 'p',
        text: "The stub server is worker-scoped, so `beforeEach` calls `mockServer.reset()` and re-registers the contract. Without that, one test's writes would be visible to the next and the suite would become order-dependent — the failure mode that makes a suite pass locally at one worker and fail in CI at eight.",
      },
    ],
    changeWhen: [
      'The live API changes and the model must follow.',
      'A new failure mode is worth covering.',
      'The service gains a method.',
    ],
    changeHow: [
      {
        text: 'Change the model in `src/mocks/objects.stub.ts`, then run the live suite within quota to confirm the two still agree.',
      },
      {
        text: "Add a failure-mode test using the stub server's own helpers — `fail`, `slow`, `flaky` — rather than a new stub definition.",
      },
    ],
    why: "Running the same service object against both a real API and a model of it is what makes the model trustworthy. A stub nobody checks against reality is a fixture that encodes somebody's assumptions and then defends them forever.",
    gotchas: [
      'The stub server collapses repeated query parameters, so the model parses `request.url` directly to see the repeated `id` form.',
      'Every test builds its service with `http.withBaseUrl(...)` — a *derived* client, which keeps latency collection, recording and the contract guard attached. A freshly constructed `HttpClient` would silently lose all three.',
    ],
    related: [
      'src/mocks/objects.stub.ts',
      'tests/api/objects.crud.spec.ts',
      'src/core/http.client.ts',
    ],
  },

  'tests/contract/objects.openapi.spec.ts': {
    group: 'tests',
    purpose:
      'Validates every response in a lifecycle against the OpenAPI document in `src/data/openapi.json`, proves the check has teeth, and reports the contract-coverage gap.',
    blocks: [
      { type: 'h3', text: 'What this adds over the Zod schemas' },
      {
        type: 'p',
        text: 'The stubbed suite validates against schemas the team wrote — what the test author *believed*. An OpenAPI document says what the API *promises*, and checking against it catches the one thing hand-written schemas never do: the API and its published contract have drifted, and every consumer who trusted the document is broken.',
      },
      {
        type: 'warn',
        text: "restful-api.dev publishes no OpenAPI document, so the one in `src/data/` was written by hand from observed behaviour. Against a team's **published** document this suite detects drift between the API and its contract — the highest-value contract test there is. Against a document you wrote yourself it detects drift between the API and *your understanding of it*, which is what a consumer-driven contract test does and is still worth having. Know which you have.",
      },
      { type: 'h3', text: 'The test that matters most' },
      {
        type: 'code',
        caption: 'Proving the check can fail',
        text: `mockServer.stub({
  method: 'GET',
  path: '/objects/*',
  /* \`id\` must be a string and is required; here it is a number. */
  respond: { status: 200, json: { id: 42, name: 'wrong types' } },
});

const result = documented(contract).validate('GET', '…/objects/1', 200, response.jsonOrNull());

expect(result.valid).toBe(false);
expect(result.errors.join(' ')).toContain('id');`,
      },
      {
        type: 'p',
        text: 'A conformance suite that has never failed is a conformance suite nobody should trust. This is the test that shows the machinery actually rejects something.',
      },
      { type: 'h3', text: 'Coverage' },
      {
        type: 'code',
        caption: 'Which documented operations did the run never touch?',
        text: `const gaps = documented(contract).uncovered(exercised);
expect(gaps.map((o) => o.operationId)).toEqual(
  expect.arrayContaining(['replaceObject', 'updateObject', 'deleteObject']),
);`,
      },
      {
        type: 'p',
        text: 'That number is worth tracking over time. An endpoint nobody tests is an endpoint nobody notices breaking.',
      },
      { type: 'h3', text: 'The narrowing helper' },
      {
        type: 'code',
        caption: 'Why not just use `contract!`',
        text: `function documented(contract: OpenApiContract | undefined): OpenApiContract {
  if (!contract) throw new Error('No OpenAPI document loaded from src/data/openapi.json.');
  return contract;
}`,
      },
      {
        type: 'p',
        text: 'The fixture is optional because a project may ship no document, and `beforeEach` skips the suite when it is absent — but the compiler cannot see that a skip happened. Making the requirement explicit means a missing document fails with a sentence rather than a null-property error.',
      },
    ],
    changeWhen: [
      'Your API publishes an OpenAPI document — replace `src/data/openapi.json` with it.',
      'The document gains an operation.',
    ],
    changeHow: [
      {
        text: 'Bundle the specification first; external `$ref`s are deliberately not resolved.',
        code: `npx @redocly/cli bundle openapi.yaml -o src/data/openapi.json`,
      },
      {
        text: 'Nothing else needs wiring — the `contract` fixture picks the file up automatically.',
      },
      {
        text: 'Update the operation count in the first test; it is asserted so that a truncated document cannot make every other check pass by matching nothing.',
      },
    ],
    why: 'Contract conformance is the one check that catches a breaking change *before* a consumer does. Making it cheap — drop a document in `src/data/` — is what makes it get used.',
    gotchas: [
      'All but one test runs against the stub, so the suite stays offline. The single `@live` test is the only one that spends quota, and it skips when the quota is gone.',
      'The document models `CreatedObject` and `Object` separately, because `createdAt` appears only on create. A single schema would fail on every read.',
    ],
    related: ['src/data/openapi.json', 'src/contracts/openapi.ts', 'src/fixtures/api.fixture.ts'],
  },

  'tests/api/posts.pagination.spec.ts': {
    group: 'tests',
    purpose:
      'Reads and pagination against **https://jsonplaceholder.typicode.com** — the API chosen because it has genuine RFC 8288 `Link` header pagination, a completely stable 100-record dataset, and no quota.',
    blocks: [
      { type: 'h3', text: 'Why a second API' },
      {
        type: 'p',
        text: 'The CRUD target proves writes persist but has no pagination at all and a tight quota. This one has the opposite properties, so between them both halves get real coverage.',
      },
      { type: 'h3', text: 'The assertion worth copying' },
      {
        type: 'code',
        caption: 'A pagination walk must produce the dataset exactly once',
        text: `const everything = await api.posts.walkAllPages(10);

expect(everything).toHaveLength(PostService.TOTAL_POSTS);

const defects = findPaginationDefects([everything], (post) => String(post.id));
expect(defects.duplicates, 'no post may appear on two pages').toEqual([]);
expect(defects.uniqueItems).toBe(PostService.TOTAL_POSTS);`,
      },
      {
        type: 'p',
        text: 'The two defects pagination tests exist to catch are an item that appears on two pages and one that appears on none. Both happen when the underlying data shifts mid-walk, and neither is visible from a single page — which is why a test that only reads page one passes while page two is broken.',
      },
      { type: 'h3', text: 'What else it covers' },
      {
        type: 'ul',
        items: [
          'The `Link` header advertises `first`, `next` and `last`, and `response.nextPageUrl()` agrees with `parseLinkHeader`.',
          '`X-Total-Count` matches the length of the walk.',
          'Page size is honoured, the final page is short, and it carries no `next` — which is how offset-style walkers know to stop.',
          'Every item in a page validates against the schema, reported in one assertion rather than stopping at the first bad item.',
          'Reads declare a `Cache-Control` header — an omission only an API test ever notices.',
        ],
      },
      {
        type: 'note',
        text: "This API *simulates* writes: a POST answers 201 with a plausible body and stores nothing. That is why the service's method is called `simulateCreate`, and why the lifecycle suite runs elsewhere. A method named `create` that does not create is a trap for the next person.",
      },
    ],
    changeWhen: ['Your API paginates differently — swap the walker.', 'The dataset size changes.'],
    changeHow: [
      {
        text: 'For cursor pagination use `followCursor`; for offset/limit use `followOffset`. All three walkers take the same shape of callback.',
      },
      {
        text: 'Assert the total from a constant, as `PostService.TOTAL_POSTS` does, so a change is one edit.',
      },
    ],
    why: 'Pagination is where "the endpoint works" and "the endpoint works at scale" diverge, and it is almost never covered because walking pages by hand in a test is tedious. Making it one line removes the excuse.',
    gotchas: [
      'The dataset is stable, which is what allows exact counts. Against changing data, assert invariants — no duplicates, no gaps — rather than totals.',
      'The walkers have a hard page ceiling, so a server that always advertises a next page produces a clear failure rather than a hang.',
    ],
    related: [
      'src/services/post.service.ts',
      'src/utils/pagination.utils.ts',
      'src/utils/header.utils.ts',
    ],
  },

  'tests/api/client.behaviour.spec.ts': {
    group: 'tests',
    purpose:
      'Tests the framework itself against **https://httpbin.org**, a request-inspection service that echoes back exactly what it received. Fifteen tests proving the client puts on the wire what it claims to.',
    blocks: [
      { type: 'h3', text: 'Why an echo server rather than a stub' },
      {
        type: 'rule',
        text: 'A stub is written by the same person who wrote the client, so the two can share a misunderstanding and still agree. An echo server is neutral: it reports what genuinely arrived over a real connection, through a real TLS handshake, with real header normalisation applied.',
      },
      {
        type: 'p',
        text: "This is not hypothetical. The `.text()` body encoding bug that this suite now guards against was invisible to the stub — the stub received exactly what the transport chose to send, so it agreed with the client's mistake. Only a neutral echo could show that a body meant to be malformed was arriving as valid JSON.",
      },
      {
        type: 'code',
        caption: 'The regression test for that bug',
        text: `const raw = '{ deliberately not json';

const response = await http
  .withBaseUrl(PUBLIC_APIS.httpBin)
  .post('/post')
  .text(raw, 'application/json')
  .send();

expect(response.path<string>('data'), 'the body must arrive byte-for-byte').toBe(raw);
expect(response.path('json')).toBeNull();   // httpbin could not parse it either`,
      },
      { type: 'h3', text: 'What the fifteen tests cover' },
      {
        type: 'table',
        head: ['Area', 'Proven'],
        rows: [
          [
            'Bodies',
            'JSON, url-encoded forms, multipart with fields and files, raw text sent verbatim, binary',
          ],
          [
            'Query',
            'Repeated parameters, comma-joined arrays, and `undefined` values dropped rather than sent as the string "undefined"',
          ],
          [
            'Encoding',
            'Unicode, emoji, combining marks, right-to-left text and newlines survive a round trip intact',
          ],
          [
            'Credentials',
            'Basic, bearer, and `anonymous()` proving no `Authorization` header is sent at all',
          ],
          ['Status', 'An unusual status (418) is reported rather than swallowed'],
          [
            'Redirects',
            'Followed by default; `noRedirect()` returns the 3xx so its `Location` can be asserted',
          ],
          [
            'Headers',
            'Client defaults and per-request headers both arrive, with the request winning',
          ],
          [
            'Responses',
            'gzip decoded transparently, binary available as bytes with an intact length',
          ],
        ],
      },
      {
        type: 'p',
        text: "Several of these assert things the framework's own documentation claims. A claim in a comment is a hope; a claim with a test against a neutral server is a fact.",
      },
    ],
    changeWhen: [
      'You add a body encoding, a query format or a credential scheme.',
      'A framework claim is worth pinning down.',
    ],
    changeHow: [
      {
        text: 'Add a test that sends the thing and asserts on what httpbin echoed back. `/post` and `/get` echo the whole request; `/headers` echoes just the headers.',
      },
      { text: 'For a new status behaviour, `/status/{code}` answers with any code on demand.' },
    ],
    why: "Every other suite tests an API *through* the framework. This one tests the framework, which is the only way to be sure a failure elsewhere is the API's fault and not the tooling's.",
    gotchas: [
      'httpbin capitalises header names in its echo (`headers.Content-Type`), which is why the paths read that way.',
      'It is a shared public service and occasionally slow; the assertions are about content, not timing.',
    ],
    related: ['src/core/request.builder.ts', 'src/core/http.client.ts', 'src/auth/static.auth.ts'],
  },

  'tests/performance/posts.latency.spec.ts': {
    group: 'tests',
    purpose:
      "Latency budgets and percentiles, measured against a real endpoint under the `performance` project's single worker.",
    blocks: [
      { type: 'h3', text: 'Why the project settings matter' },
      {
        type: 'ul',
        items: [
          '**One worker**, because a p95 measured while eight workers hammer the same endpoint describes the load the suite is generating, not the endpoint.',
          '**No retries**, because a retried timing measurement is not a measurement.',
        ],
      },
      {
        type: 'code',
        caption: 'Warm-up runs are discarded',
        text: `const summary = await sample(() => api.posts.find(1), { runs: 20, warmup: 3 });

expect(summary.p95).toBeLessThan(5_000);
expect(summary.p99).toBeLessThan(Math.max(summary.p50 * 20, 8_000));`,
      },
      {
        type: 'p',
        text: 'The first call to a cold endpoint measures TLS setup and JIT rather than the endpoint, and including it drags every percentile upward for no reason. The p99-versus-p50 check is the tail test: a p99 many times the median means an unstable endpoint even when the average looks fine, and the tail is what users actually feel.',
      },
      {
        type: 'p',
        text: 'The whole distribution is printed on every run, so a failure shows the shape rather than only the number that broke — a p95 with no p50 beside it is hard to act on.',
      },
      { type: 'h3', text: 'A pure unit check, deliberately' },
      {
        type: 'p',
        text: 'One test exercises `percentile` and `summarize` on a fixed array. It costs nothing, and it means a failing budget elsewhere can never be blamed on the arithmetic.',
      },
      {
        type: 'warn',
        text: 'This is correctness-adjacent performance signal, free because the requests are being made anyway. It is **not** a load test — nothing here generates concurrency. Treating it as one would be worse than having no load test, because it would feel like coverage.',
      },
    ],
    changeWhen: ['A budget is systematically wrong.', 'A route needs its own percentile check.'],
    changeHow: [
      {
        text: 'Set the environment-wide default in `latencyBudgetMs` or `LATENCY_BUDGET_MS`, and use `expectWithinLatencyBudget()` rather than a literal.',
      },
      {
        text: 'For a specific route, use `sample()` with enough runs that the percentile means something — twenty is a reasonable floor.',
      },
    ],
    why: 'An API suite is the cheapest place a team ever gets performance signal, because the timings are already there. What is usually missing is the discipline to look at a distribution rather than a single number.',
    gotchas: [
      'Percentiles are nearest-rank, so a reported p95 is always a value that was actually observed — which is what makes it defensible in a conversation with the team that owns the service.',
      'The latency fixture attaches a per-route report to every test in every project, not just this one.',
    ],
    related: ['src/utils/performance.utils.ts', 'playwright.config.ts', 'src/config/timeouts.ts'],
  },

  'tests/security/response.hygiene.spec.ts': {
    group: 'tests',
    purpose:
      'Response hygiene, injection transport, CORS and authorisation, against real services. Six tests that cost almost nothing because the requests are being made anyway.',
    blocks: [
      { type: 'h3', text: 'Three kinds of assertion, and why the difference is stated per test' },
      {
        type: 'p',
        text: 'The public services used here are demonstration APIs and do not meet a production security baseline. Pretending otherwise would produce failing tests that people learn to ignore — and an ignored security test is worse than none. So each test does one of three things, and says which:',
      },
      {
        type: 'table',
        head: ['Kind', 'Used for', 'Example'],
        rows: [
          [
            '**Assert**',
            'What must be true of any correct API',
            'No stack trace, connection string or credential in an error body',
          ],
          [
            '**Report**',
            'A baseline these demo services legitimately do not meet',
            'Missing `Strict-Transport-Security`, printed rather than failed',
          ],
          [
            '**Assert the detector fires**',
            'Where a real service genuinely exhibits the problem',
            "httpbin's CORS origin reflection",
          ],
        ],
      },
      { type: 'h3', text: 'A real finding, from a real service' },
      {
        type: 'code',
        caption: 'httpbin really does reflect any origin AND allow credentials',
        text: `expect(response.header('access-control-allow-origin')).toBe('https://evil.example.com');
expect(response.header('access-control-allow-credentials')).toBe('true');

const rules = findings.map((finding) => finding.rule);
expect(rules).toContain('cors-origin-reflection');`,
      },
      {
        type: 'p',
        text: 'On a production API that combination is serious: any site a victim visits could read authenticated responses. httpbin does it deliberately, because being callable from anywhere is the point of an echo service. So rather than pretending the finding is absent, the test asserts the auditor **correctly detects it against a real server** — a true positive is better evidence that a detector works than a clean run against a fixture. Against your own API, invert the assertion.',
      },
      { type: 'h3', text: 'The injection test is about transport, not vulnerability' },
      {
        type: 'p',
        text: 'httpbin is an echo service; nobody is claiming it is vulnerable. The point is that the *framework* carries hostile input unchanged, so when the same pattern is pointed at a real API the payload that arrives is the payload that was written. A framework that escaped or mangled these would make every injection test meaningless.',
      },
      {
        type: 'note',
        text: 'An earlier version of that test searched the whole response body for `49` — the result of `{{7*7}}` had the template been evaluated. It failed intermittently, because httpbin echoes numeric headers such as `Content-Length` and the substring appeared for unrelated reasons. Asserting on the specific field instead is both stricter and stable. It is a good example of why a flaky test deserves a diagnosis rather than a retry.',
      },
      { type: 'h3', text: 'The authorisation matrix' },
      {
        type: 'code',
        caption: 'Generated, not hand-written',
        text: `const matrix = buildAccessMatrix(
  ['valid', 'invalid'],
  [{ method: 'GET', path: '/basic-auth/framework/secret', allowed: ['valid'] }],
  { deniedStatus: 401 },
);

for (const cell of matrix) {
  const response = await http.withBaseUrl(PUBLIC_APIS.httpBin)
    .get('/basic-auth/framework/secret')
    .basic('framework', passwordFor[cell.role] ?? '')
    .expectStatus(200, 401)
    .send();

  expect(judgeAccess(cell, response.status)).toBeUndefined();
}`,
      },
      {
        type: 'p',
        text: 'Authorisation defects are defects of *omission* — the endpoint nobody remembered to protect. Writing the cases somebody thought of catches exactly the cases somebody thought of; generating the grid is the only way to catch the class. The credential is looked up from a table rather than chosen in an `if`, so the loop body is a straight line through every cell.',
      },
      { type: 'h3', text: 'Redaction' },
      {
        type: 'p',
        text: 'One test sends a recognisable token and asserts it does not survive into `toRecord()` — which is what the logger, the reporters and the exchange recorder all consume. If a credential got through, every recording committed to a repository would contain a live token.',
      },
    ],
    changeWhen: [
      'A disclosure pattern is missing.',
      'You point this at your own API — then invert the "report" assertions.',
    ],
    changeHow: [
      {
        text: 'Against your own API, change the reporting assertions to failures.',
        code: `expect(findings, formatFindings(findings)).toEqual([]);`,
      },
      {
        text: 'Add a leak pattern in `src/utils/security.utils.ts`, not here, so every suite gets it.',
      },
    ],
    why: 'These checks catch a class of defect that functional tests never look at, and they are nearly free. Reporting rather than throwing is what lets one test cover a whole surface without becoming noise.',
    gotchas: [
      '**Never point the `security` project at production.** The payloads are deliberately hostile.',
      'The header baseline is opinionated. Loosen it deliberately rather than deleting the test.',
    ],
    related: ['src/utils/security.utils.ts', 'src/utils/data.utils.ts', 'playwright.config.ts'],
  },
};
