/** Stubbing, recording, reporting, static data and the tests folder. */
export default {
  /* ---------------------------------------------------------------- */
  /* src/mocks                                                         */
  /* ---------------------------------------------------------------- */

  'src/mocks/mock.server.ts': {
    group: 'mocks',
    purpose:
      'A programmable stub server: match a request, return a response — with delays, failures and controlled flakiness on demand.',
    blocks: [
      {
        type: 'p',
        text: 'Three things are impossible to test against a real dependency: the failure you cannot trigger on demand (a 503 from a payment provider), the response you cannot produce (a malformed payload from a partner), and the timing you cannot control (a gateway timeout). A stub you control makes all three routine, and lets the contract suite run with no network at all.',
      },
      {
        type: 'table',
        head: ['Method', 'Produces'],
        rows: [
          ['`get(path, json)` / `post(path, json)`', 'A fixed JSON response'],
          [
            '`fail(path, status)`',
            'An error status — the case a real dependency will not give you',
          ],
          ['`slow(path, delayMs)`', 'A delayed response, for exercising client timeouts'],
          [
            '`flaky(path, failures, success)`',
            '**Fails n times, then succeeds** — how retry behaviour is tested honestly',
          ],
          [
            '`stub({ method, path, respond, times })`',
            'The general form; `respond` can be a function of the request',
          ],
        ],
      },
      {
        type: 'code',
        caption: 'Why flaky() matters',
        text: `mockServer.flaky('/payments', 2, { status: 'settled' });

const response = await client.post('/payments').retries(3).send();
response.expectOk();
expect(response.timing.attempts).toBe(3);`,
      },
      {
        type: 'p',
        text: 'The endpoint really does recover, so a client that gives up too early fails and one that retries forever never finishes. A mocked-out client that always succeeds proves neither.',
      },
      { type: 'h3', text: 'Asserting on what the client sent' },
      {
        type: 'code',
        text: `const [request] = mockServer.requestsFor('POST', '/orders');
expect(request.headers['idempotency-key']).toBeDefined();
expect(bodyOf(request).currency).toBe('GBP');
expect(mockServer.callCount('/orders')).toBe(1);   // caching, or a stray retry`,
      },
      { type: 'h3', text: 'The unmatched-request response' },
      {
        type: 'p',
        text: 'An unmatched request returns **501 with a body listing what arrived and what was registered**. That is almost always a test-authoring mistake, and a silent 404 would make it a ten-minute puzzle.',
      },
      {
        type: 'p',
        text: 'Built on Node\'s `http` module rather than a framework: the whole surface is "match a request, return a response", and every dependency added to a test framework is one more thing that can break a release.',
      },
    ],
    changeWhen: [
      'Stubs need behaviour that is not expressible.',
      'Path matching needs another form.',
    ],
    changeHow: [
      {
        text: 'Most behaviour is already a function of the request — no code change needed.',
        code: `mockServer.stub({\n  method: 'GET',\n  path: '/orders/*',\n  respond: (request) => ({\n    status: request.query.tenant === 'known' ? 200 : 404,\n    json: { id: request.path.split('/').pop() },\n  }),\n});`,
      },
      {
        text: 'For streaming or another protocol, add a branch in `handle` rather than a second server.',
      },
    ],
    why: "The stub server is what makes the contract suite runnable on a fork's pull request, with no environment and no secrets. That property is worth more than any individual stub.",
    gotchas: [
      '`start(0)` asks the OS for a free port, which is what the fixture does — parallel workers would otherwise collide on a fixed port.',
      'Later registrations win, so a test can override what setup registered. `reset()` clears everything, and is worth calling at the top of a test that registers its own.',
      'Path globs escape everything that is not a wildcard, so a path containing a dot or a bracket cannot accidentally behave as a pattern.',
    ],
    related: ['src/mocks/recorder.ts', 'src/fixtures/api.fixture.ts', 'docker-compose.yml'],
  },

  'src/mocks/objects.stub.ts': {
    group: 'mocks',
    purpose:
      'An **executable model** of the `api.restful-api.dev/objects` contract: the whole CRUD resource, in memory, reproducing every observed quirk.',
    blocks: [
      { type: 'h3', text: 'Why it exists' },
      {
        type: 'p',
        text: "The live API is genuinely persistent, which is what makes it worth testing against — but it allows only 50 anonymous requests per 24 hours. A suite that burns the day's quota on its third run is a suite nobody can use.",
      },
      {
        type: 'ol',
        items: [
          "The same service object and the same lifecycle can be exercised **exhaustively, offline, with no quota** — in CI, on a fork's pull request, on a plane.",
          'The model is a **check on our understanding**. When the live suite runs within quota and agrees with it, the contract is right. When they disagree, either the API changed or we misread it.',
          'Failure modes the real API will not produce on demand — a 500, a timeout, a malformed body — become ordinary test setup.',
        ],
      },
      { type: 'h3', text: 'The quirks it reproduces deliberately' },
      {
        type: 'rule',
        text: 'A stub that behaves the way you *wish* the API behaved tests nothing. Every quirk below was observed against the live service and is reproduced exactly, including the wording of the error messages.',
      },
      {
        type: 'ul',
        items: [
          'POST answers **200**, not 201.',
          'POST carries `createdAt`; PUT and PATCH carry `updatedAt`; **GET carries neither**.',
          'DELETE answers **200 with a message body**; a second DELETE answers 404.',
          'Created objects are retrievable by id but **never** listed.',
          'Errors are `{ error: string }`, not problem details.',
          'A malformed body answers 400; an empty body is **accepted** and stored with `name: null`.',
        ],
      },
      { type: 'h3', text: 'Using it' },
      {
        type: 'code',
        caption: 'Register, then point a derived client at the stub',
        text: `test.beforeEach(({ mockServer }) => {
  mockServer.reset();
  stubObjectsApi(mockServer);
});

const objects = new ObjectService(http.withBaseUrl(mockServer.url), { cleanup });`,
      },
      {
        type: 'p',
        text: "The reset-and-re-register in `beforeEach` is what keeps the tests independent: the stub server is worker-scoped, so without it one test's writes would be visible to the next.",
      },
    ],
    changeWhen: ['The live API changes.', 'A behaviour is not modelled and a test needs it.'],
    changeHow: [
      {
        text: 'Change the handler, then **run the live suite within quota** to confirm the model and the API still agree. A model nobody checks against reality is a fixture that encodes an assumption and then defends it forever.',
      },
      {
        text: "For a one-off failure mode, prefer the stub server's own helpers — `fail`, `slow`, `flaky` — over adding a branch here.",
      },
    ],
    why: 'Running the same service object against both a real API and a model of it is what makes the model trustworthy, and what lets the exhaustive coverage run on every pull request rather than three times a day.',
    gotchas: [
      'The stub server collapses repeated query parameters, so the list handler parses `request.url` directly to see the repeated `id` form the live API requires.',
      'Ids are generated in the same hex shape the live API uses, so a test asserting the format passes against both.',
    ],
    related: [
      'tests/contract/objects.stubbed.spec.ts',
      'src/services/object.service.ts',
      'src/mocks/mock.server.ts',
    ],
  },

  'src/data/openapi.json': {
    group: 'data',
    purpose:
      'An OpenAPI 3.0.3 document describing the `/objects` resource. Loaded automatically by the `contract` fixture — dropping a file at this path is all the wiring required.',
    blocks: [
      {
        type: 'warn',
        text: "restful-api.dev publishes **no** OpenAPI document, so this one was written by hand from observed behaviour. Against a team's published document, conformance testing detects drift between the API and its contract — the highest-value contract test there is. Against a document you wrote yourself, it detects drift between the API and *your understanding of it*, which is what a consumer-driven contract test does and is still worth having. Replace this file with your API's real document.",
      },
      { type: 'h3', text: 'What it models' },
      {
        type: 'p',
        text: 'Six operations across two paths, with `CreatedObject` and `UpdatedObject` composed from a shared `Object` via `allOf` — because `createdAt` appears only on create and `updatedAt` only on updates, and a single schema requiring either would fail on every read.',
      },
      {
        type: 'p',
        text: 'The `Error` schema is documented as `{ error: string }` with a note that it is **not** RFC 9457 problem details. Recording a non-standard shape faithfully is more useful than documenting the shape you wish the API had.',
      },
    ],
    changeWhen: [
      'Your API publishes a document — replace this one.',
      'The API gains an operation.',
    ],
    changeHow: [
      {
        text: 'Bundle first; external `$ref`s are deliberately not resolved.',
        code: `npx @redocly/cli bundle openapi.yaml -o src/data/openapi.json`,
      },
      {
        text: 'Update the operation count asserted in `tests/contract/objects.openapi.spec.ts` — it is asserted so a truncated document cannot make every other check pass by matching nothing.',
      },
    ],
    why: 'A document at a known path, picked up automatically, is what makes conformance testing cheap enough to actually adopt.',
    gotchas: [
      "Only in-document `$ref`s are followed, by design — a second resolver behaving subtly differently from the team's own tooling would be worse than none.",
      'Deleting this file cleanly disables the OpenAPI suite, which skips rather than fails.',
    ],
    related: [
      'src/contracts/openapi.ts',
      'tests/contract/objects.openapi.spec.ts',
      'src/fixtures/api.fixture.ts',
    ],
  },

  'src/mocks/recorder.ts': {
    group: 'mocks',
    purpose:
      'Records exchanges and replays them as stubs. Evidence for a bug report, and a fixture source for running offline.',
    blocks: [
      {
        type: 'code',
        caption: 'Record, then replay with no network',
        text: `// Recording — the fixture attaches this on failure automatically.
client.onExchange(recorder.record);
recorder.save('src/data/recordings/orders.json');

// Replaying.
const recording = ExchangeRecorder.load('src/data/recordings/orders.json');
for (const stub of ExchangeRecorder.toStubs(recording)) mockServer.stub(stub);`,
      },
      {
        type: 'rule',
        text: 'Recordings are **redacted on the way out**. A recording containing a live bearer token is a credential sitting in the repository, and the only reliable defence is to make redaction the default rather than a step somebody has to remember.',
      },
      {
        type: 'p',
        text: '`toStubs` replays only successful exchanges by default. A recording made while the target was briefly broken would otherwise bake that breakage into every future offline run.',
      },
    ],
    changeWhen: ['Recordings should capture more.', 'Replay should include error responses.'],
    changeHow: [
      {
        text: 'Include errors deliberately, when the point of the replay is the error path.',
        code: `ExchangeRecorder.toStubs(recording, { includeErrors: true });`,
      },
      {
        text: 'To capture more, extend `RecordedExchange` — and check the redaction still covers everything added.',
      },
    ],
    why: 'A recorded exchange is the artefact that ends a "works for me" conversation. It shows exactly what was sent and exactly what came back, at the moment it failed.',
    gotchas: [
      'Response bodies are only recorded when `LOG_BODIES` is on, because a full body on every request is a lot of memory in a large suite.',
      'Check a recording before committing it. Redaction covers the known credential headers; a token in a *body* is on you.',
      "The fixture saves only on failure — a passing test's recording is noise.",
    ],
    related: [
      'src/mocks/mock.server.ts',
      'src/utils/header.utils.ts',
      'src/fixtures/api.fixture.ts',
    ],
  },

  'src/mocks/index.ts': {
    group: 'mocks',
    purpose: 'Barrel for the stubbing and recording layer.',
    changeWhen: ['You add a stubbing capability.'],
    changeHow: [{ text: 'Re-export it.' }],
    why: 'Keeps the stub server and the recorder discoverable together — they are designed to be used as a pair.',
    related: ['src/mocks/mock.server.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* src/reporters                                                     */
  /* ---------------------------------------------------------------- */

  'src/reporters/summary.reporter.ts': {
    group: 'reporters',
    purpose:
      'Writes `reports/summary.json`: one machine-readable file saying whether the run passed, which tests failed and why, which were slowest, and how long it all took.',
    blocks: [
      {
        type: 'p',
        text: "Playwright's HTML report is excellent for a person with a browser. What a pipeline needs is different: one file small enough to post into a chat message or gate a deployment on. Every field is chosen to be diffable between two runs of the same suite.",
      },
      {
        type: 'code',
        lang: 'json',
        caption: 'What it produces',
        text: `{
  "status": "failed",
  "environment": "staging",
  "durationMs": 184320,
  "totals": { "total": 412, "passed": 405, "failed": 2, "flaky": 3, "skipped": 2, "timedOut": 0 },
  "passRate": 98,
  "slowestTests": [{ "title": "orders › bulk import", "durationMs": 24118 }],
  "failures": [{ "title": "…", "file": "tests/api/orders.spec.ts", "project": "api", "tags": ["@smoke"], "error": "…" }]
}`,
      },
      { type: 'h3', text: 'The counting decision that matters' },
      {
        type: 'code',
        caption: 'A test that passed on retry is flaky, not passed',
        text: `case 'passed':
  if (result.retry > 0) this.counts.flaky += 1;
  else this.counts.passed += 1;
  break;`,
      },
      {
        type: 'p',
        text: 'Playwright reports a test that passed on retry as `passed`. Counting those separately is what keeps a suite from quietly rotting behind a green tick — the flaky count is the number that tells you whether the suite is getting worse.',
      },
      {
        type: 'p',
        text: 'Failures carry their tags, so a `@smoke` failure can be spotted immediately, and their error is truncated to twelve lines — enough to triage, short enough to read.',
      },
    ],
    changeWhen: [
      'A pipeline needs a field that is not here.',
      'The console summary should say something else.',
    ],
    changeHow: [
      {
        text: 'Add the field to the `Summary` interface and populate it in `onEnd`. Keep it diffable — a value that changes on every run is noise.',
      },
      {
        text: 'Add a per-test field by capturing it in `onTestEnd`, where the `TestCase` and `TestResult` are both available.',
      },
    ],
    why: 'A pipeline should not have to parse an HTML report or a JUnit XML to answer "did it pass, and what broke". One small JSON file answers it, and can gate a deploy.',
    gotchas: [
      '**A reporter must never crash the run.** `onError` is deliberately empty — Playwright already reports the error itself.',
      "The output path is derived from `configFile`, not `config.rootDir`: `rootDir` resolves to the common ancestor of the projects' test directories, which is `tests/`, and would put the summary somewhere nobody looks.",
      '`--reporter=` on the command line replaces the whole config list, so a run with it produces no summary.',
    ],
    related: ['playwright.config.ts', '.github/workflows/api-tests.yml'],
  },

  'src/reporters/index.ts': {
    group: 'reporters',
    purpose: 'Barrel for custom reporters.',
    blocks: [
      {
        type: 'note',
        text: 'Playwright loads a custom reporter by **path**, not through this barrel — `playwright.config.ts` references `./src/reporters/summary.reporter.ts` directly. The barrel exists so other code can import the class, for example to test it.',
      },
    ],
    changeWhen: ['You add a reporter.'],
    changeHow: [{ text: 'Export it here, and register it by path in `playwright.config.ts`.' }],
    why: 'The path reference is a Playwright requirement, not a style choice; the barrel keeps the module importable like anything else.',
    related: ['playwright.config.ts', 'src/reporters/summary.reporter.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* src/data                                                          */
  /* ---------------------------------------------------------------- */

  'src/data/README.md': {
    group: 'data',
    purpose:
      'Documents what lives in `src/data/`, what belongs there and what does not. Everything in the folder is committed, so everything in it must be safe to make public.',
    blocks: [
      {
        type: 'table',
        head: ['Belongs here', 'Does not'],
        rows: [
          ['Static reference tables', 'Anything generated per run — use `data.utils.ts`'],
          [
            'A small real file for upload tests',
            'Anything large — generate it with `tempFileOfSize`',
          ],
          [
            'The expected shape of an error',
            'Anything secret — credentials come from the environment',
          ],
          ['An OpenAPI document, as `openapi.json`', ''],
        ],
      },
    ],
    changeWhen: ['You add a data file.'],
    changeHow: [
      {
        text: 'Add the file, in the smallest format that works — CSV beats JSON for a table a non-engineer will edit.',
      },
      { text: 'Add a row to the table in the README.' },
      { text: "Read it through `dataFile('name.csv')` rather than a relative path." },
    ],
    why: 'A folder of unexplained data files becomes a folder nobody dares delete from. One table saying what each file is for keeps it maintainable.',
    related: ['src/utils/file.utils.ts', 'src/contracts/openapi.ts'],
  },

  'src/data/users.json': {
    group: 'data',
    purpose:
      'Role names and the seed accounts an environment is expected to contain. Reference data, not credentials — there are no passwords here.',
    changeWhen: ['The role list changes.', 'The seeded accounts an environment provides change.'],
    changeHow: [
      {
        text: 'Edit the file, and keep it in step with `UserRole` in `env.config.ts`. The two describe the same set from different angles.',
      },
    ],
    why: 'Tests that need "an account that already exists" should read it from one place rather than each hard-coding an address.',
    gotchas: [
      'This file is committed. Never add a password to it — credentials come from the environment through `getUser(role)`.',
    ],
    related: ['src/config/env.config.ts', 'src/utils/file.utils.ts'],
  },

  'src/data/status-codes.csv': {
    group: 'data',
    purpose:
      'A table-driven matrix of malformed requests and the status each must produce — the negative-path suite as data rather than as code.',
    blocks: [
      {
        type: 'code',
        caption: 'One test, every row',
        text: `for (const testCase of readCsv<Case>(dataFile('status-codes.csv'))) {
  test(\`\${testCase.scenario} @regression\`, async ({ http }) => {
    const response = await http
      .request(testCase.method, testCase.path)
      .json(testCase.payload ? JSON.parse(testCase.payload) : undefined)
      .send();
    expect(response).toHaveStatus(Number(testCase.expectedStatus));
  });
}`,
      },
      {
        type: 'p',
        text: 'The `note` column exists so a row explains itself. A case table whose rows have no rationale is a table nobody can safely change.',
      },
    ],
    changeWhen: [
      'A new malformed-input case is worth covering.',
      "The API's error semantics change.",
    ],
    changeHow: [
      { text: 'Add a row. No code change — that is the point of driving the suite from data.' },
      { text: 'Keep the `note` column filled in.' },
    ],
    why: 'CSV means somebody who is not an engineer can add a case. The error-handling matrix is exactly the sort of thing a product owner or a support engineer knows more about than the test author.',
    gotchas: [
      'Every value is read as a string; convert explicitly.',
      'A payload containing a comma needs quoting, as CSV requires.',
    ],
    related: ['src/utils/file.utils.ts', 'src/contracts/schemas.ts'],
  },

  'src/data/files/upload-sample.txt': {
    group: 'data',
    purpose:
      'A small real file for multipart upload tests, so they exercise a real file handle rather than a synthetic buffer.',
    changeWhen: [
      'A test needs a file of a specific type — add another file rather than changing this one.',
    ],
    changeHow: [
      { text: 'Add the file here for a small fixed sample.' },
      {
        text: 'For anything large, generate it instead — a multi-megabyte fixture slows every clone forever.',
        code: `const big = tempFileOfSize('large.bin', 50 * 1024 * 1024);`,
      },
    ],
    why: 'Reading a real file catches a class of problem a buffer does not: path handling, MIME-type guessing from the extension, and the file name the server actually receives.',
    related: ['src/utils/file.utils.ts', 'src/core/request.builder.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* tests                                                             */
  /* ---------------------------------------------------------------- */

  'tests/README.md': {
    group: 'tests',
    purpose:
      'Where each kind of test belongs, and the conventions the tooling already enforces. The folder ships without specs: the framework was delivered as architecture, and the tests belong to the team that owns the API.',
    blocks: [
      {
        type: 'table',
        head: ['Folder', 'Project', 'Contains'],
        rows: [
          [
            '`tests/api/`',
            '`api`',
            'Functional REST, GraphQL, streaming and file transfer. The bulk of the suite.',
          ],
          [
            '`tests/contract/`',
            '`contract`',
            'Schema and OpenAPI conformance. Runs offline against the stub server.',
          ],
          [
            '`tests/performance/`',
            '`performance`',
            'Latency budgets. One worker, so measurements are not self-inflicted.',
          ],
          [
            '`tests/security/`',
            '`security`',
            'Authorisation matrices, input handling, response hygiene. **Never point this at production.**',
          ],
        ],
      },
      {
        type: 'p',
        text: 'File naming is `<resource>.<behaviour>.spec.ts` — `users.create.spec.ts`, `orders.pagination.spec.ts`, `auth.token-refresh.spec.ts` — so the name makes obvious which service object the test exercises.',
      },
      {
        type: 'rule',
        text: 'Import `test` and `expect` from `../../src/fixtures`, never from `@playwright/test`. The Playwright ones have no cleanup registry, no contract guard and none of the custom matchers, and nothing will tell you.',
      },
    ],
    changeWhen: ['A new category of test needs a home.', 'A convention changes.'],
    changeHow: [
      {
        text: 'Add the folder, add a project in `playwright.config.ts`, add a script in `package.json`, and add a row to the table here.',
      },
    ],
    why: 'A tests folder with no stated conventions grows four different styles within a month. Writing them down where somebody will look — beside the tests — is what keeps the suite reviewable.',
    gotchas: [
      '`playwright test` reports that it found no tests until you write one. That is expected.',
      'A test in the wrong folder gets the wrong project settings — a performance test under `tests/api/` runs under eight parallel workers and measures the load, not the endpoint.',
    ],
    related: ['src/fixtures/index.ts', 'playwright.config.ts'],
  },
};
