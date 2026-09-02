/** Cross-cutting helpers: logging, polling, paging, diffing, security, data. */
export default {
  'src/utils/logger.ts': {
    group: 'utils',
    purpose:
      'A dependency-free structured logger. Readable lines locally, single-line JSON in CI for log aggregation.',
    blocks: [
      {
        type: 'p',
        text: 'Hand-written rather than pulled from npm, deliberately: the popular logging libraries bring transports, colour packages and native bindings the suite does not need, and at least one of them fails to load on current Node. This is eighty lines with no dependencies.',
      },
      {
        type: 'code',
        caption: 'Scoped loggers, so a line says where it came from',
        text: `const log = logger.child('auth:oauth2');
log.debug('requesting token', { grant: 'client_credentials', url });`,
      },
      {
        type: 'p',
        text: "Everything goes to **stderr**, so a test's stdout — used by reporters and by `--reporter=json` — is never polluted by log lines.",
      },
      {
        type: 'note',
        text: 'The ANSI escape character is built with `String.fromCharCode(27)` rather than written as a literal, so no control byte appears in the source. That keeps the file safe to open in any editor and to paste into a diff.',
      },
    ],
    changeWhen: ['Logs need a field on every line.', 'A destination other than stderr is needed.'],
    changeHow: [
      {
        text: 'Add the field in `write`, before the context spread, so a caller cannot accidentally shadow it.',
        code: `const line = JSON.stringify({ time, level, scope: this.scope, runId, message, ...context });`,
      },
      {
        text: 'For a new destination, change `emit`. Keep stderr as the default — stdout belongs to the reporters.',
      },
    ],
    why: 'Log output is the diagnostic of last resort, so it has to work everywhere and never be the thing that breaks. No dependencies is the strongest guarantee of that available.',
    gotchas: [
      '`enabled(level)` exists so an expensive context object can be skipped rather than built and discarded.',
      'JSON mode is on automatically in CI, off locally. Force it with the `json` option if you need it either way.',
    ],
    related: ['src/config/env.config.ts', 'src/core/http.client.ts'],
  },

  'src/utils/cleanup.registry.ts': {
    group: 'utils',
    purpose:
      'Tracks resources a test created so they can be removed afterwards. Deletions run in reverse order of registration, and a failing deletion is reported but never fails the test.',
    blocks: [
      {
        type: 'p',
        text: 'API suites leak. A test creates an order, asserts something, and the order stays forever; a thousand runs later the list endpoint is slow and somebody spends a day cleaning a database by hand. The fix has to be cheap enough that nobody skips it.',
      },
      {
        type: 'code',
        caption: 'Cheap enough — one expression',
        text: `return this.cleanup.track(created, \`order \${created.id}\`, () => this.remove(created.id));`,
      },
      { type: 'h3', text: 'Two decisions worth knowing' },
      {
        type: 'ul',
        items: [
          '**Reverse order.** A child resource usually has to go before its parent, and creation order already encodes that relationship. `priority` is there for the rare case where it does not.',
          '**A failing deletion never fails the test.** A cleanup problem must not disguise itself as a product problem. It is logged, counted, and the drain continues.',
        ],
      },
      {
        type: 'p',
        text: '`forget(description)` removes an entry — used when the test deleted the resource itself, so teardown does not try again.',
      },
    ],
    changeWhen: [
      'Cleanup ordering needs to be more explicit.',
      'A failed cleanup should be reported somewhere.',
    ],
    changeHow: [
      {
        text: 'Use `priority` when reverse-creation order is not the right order.',
        code: `this.cleanup.register('tenant 42', () => deleteTenant(42), -10); // last`,
      },
      {
        text: 'To surface leaks, attach the drain result to the test in the `cleanup` fixture.',
        code: `const { failed } = await registry.drain();\nif (failed) await testInfo.attach('cleanup-failures.txt', { body: String(failed) });`,
      },
    ],
    why: 'Cleanup registered at the point of creation is cleanup that happens. Cleanup that depends on somebody writing an `afterEach` is cleanup that happens for the first three tests.',
    gotchas: [
      'Registering after the drain has started runs the deletion immediately and logs a warning — the alternative is silently dropping it.',
      'The `cleanup` fixture drains after every test, including a failed one. A failed test is the most likely to have created something and not removed it.',
    ],
    related: ['src/core/base.service.ts', 'src/fixtures/api.fixture.ts'],
  },

  'src/utils/jsonpath.utils.ts': {
    group: 'utils',
    purpose:
      'A small, dependency-free JSON path reader supporting property access, array indices (including negative), wildcards and recursive descent.',
    blocks: [
      {
        type: 'p',
        text: 'Full JSONPath implementations bring a parser, a filter-expression evaluator and a large dependency tree. What API assertions actually need is the ability to name a nested value — so that is what this supports, with syntax any reviewer can read without consulting a specification.',
      },
      {
        type: 'table',
        head: ['Syntax', 'Matches'],
        rows: [
          ['`a.b.c`', 'Property access'],
          ['`a[0]`, `a[-1]`', 'Array index; negative counts from the end'],
          ['`a[*].b`', 'Every element of an array'],
          ['`a.*`', 'Every value of an object'],
          ['`..name`', 'Every `name` at any depth'],
        ],
      },
      {
        type: 'code',
        caption: 'The four entry points',
        text: `readPath(payload, 'data.items[0].id');   // one value, or undefined
readAll(payload, '..email');             // every match
hasPath(payload, 'meta.cursor');         // presence
leafPaths(payload);                      // every leaf path, for shape comparison`,
      },
      {
        type: 'p',
        text: '`leafPaths` is what `shapeOf` and `ApiResponse.fields()` are built on: it turns a payload into the set of paths it contains, which is the thing worth comparing against a baseline.',
      },
    ],
    changeWhen: ['A path expression the framework needs is not supported.'],
    changeHow: [
      {
        text: 'Add a token kind in `tokenize` and a case in `collect`. Both are short and the change is local.',
        code: `// e.g. a slice: a[0:3]\nif (/^\\[\\d+:\\d+\\]$/.test(raw)) tokens.push({ kind: 'slice', from, to });`,
      },
      {
        text: 'Resist adding filter expressions. At that point a real JSONPath library is the honest answer.',
      },
    ],
    why: "Paths make assertions readable. `response.path('data.items[0].id')` says what it is looking for; a chain of optional accesses says how it is looking for it.",
    gotchas: [
      'Wildcards and `..` return arrays. `readPath` takes the first match, which is rarely what you want with those — use `readAll`.',
      'A path that does not resolve returns `undefined` rather than throwing, so `expectPathExists` is the way to assert presence.',
    ],
    related: ['src/core/api.response.ts', 'src/utils/diff.utils.ts'],
  },

  'src/utils/header.utils.ts': {
    group: 'utils',
    purpose:
      'Header parsing: case-insensitive lookup, `Set-Cookie`, `Content-Type`, `Link`, `Retry-After`, rate-limit counters, and redaction.',
    blocks: [
      {
        type: 'p',
        text: 'HTTP headers are case-insensitive, may repeat, and several of the ones that matter carry structured values inside a single string. Parsing them in one place keeps that fiddly, easy-to-get-subtly-wrong logic out of the tests.',
      },
      {
        type: 'table',
        head: ['Helper', 'Handles'],
        rows: [
          [
            '`parseSetCookie`',
            'Name, value and every attribute. Splits on **newlines**, because Playwright joins repeated headers that way — a comma appears inside an `Expires` date.',
          ],
          [
            '`parseContentType`',
            'Media type plus parameters. `isJsonContentType` also accepts `+json` suffixes such as HAL.',
          ],
          ['`parseLinkHeader` / `nextLink`', 'RFC 8288 pagination — GitHub-style `rel="next"`.'],
          [
            '`parseRetryAfter`',
            'Either form — delta-seconds or an HTTP date — normalised to milliseconds.',
          ],
          [
            '`parseRateLimit`',
            '`X-RateLimit-*`, treating a small `reset` as a delta and a large one as an epoch timestamp.',
          ],
          ['`redactHeaders` / `redactValue`', 'Replaces a credential with a correlatable stub.'],
        ],
      },
      {
        type: 'code',
        caption: 'Redaction keeps enough to correlate, not enough to use',
        text: `redactValue('eyJhbGciOiJIUzI1NiIs…')
// → 'eyJh…Is (243 chars, redacted)'`,
      },
      {
        type: 'p',
        text: 'That form is deliberate: two log lines with the same stub are the same credential, which is often exactly what you need to know, without the value ever being usable.',
      },
    ],
    changeWhen: [
      'A header carries structure nothing parses.',
      'A credential-bearing header is not being redacted.',
    ],
    changeHow: [
      { text: 'Add the header name to `SENSITIVE_HEADERS` — that is all redaction needs.' },
      {
        text: 'Add a parser returning a typed shape rather than a string, so callers do not re-parse.',
      },
    ],
    why: 'These parsers are individually trivial and collectively the source of a lot of subtle bugs — the `Set-Cookie` comma being the classic. One implementation, tested once, used everywhere.',
    gotchas: [
      '`HeaderMap` keys are lower-cased by convention. `getHeader` compares case-insensitively anyway, for safety.',
      'Redaction happens on the way into logs, reports and recordings. Anything that writes headers elsewhere must call it too.',
    ],
    related: ['src/core/api.response.ts', 'src/mocks/recorder.ts', 'src/utils/pagination.utils.ts'],
  },

  'src/utils/xml.utils.ts': {
    group: 'utils',
    purpose:
      'XML and SOAP support: parsing, hand-rolled serialisation, path reading, envelope construction and fault extraction.',
    blocks: [
      {
        type: 'p',
        text: 'Plenty of production APIs still speak XML — SOAP services, RSS and Atom feeds, sitemaps, legacy partner integrations. The response wrapper delegates here, so a project that never touches XML never imports this module.',
      },
      { type: 'h3', text: 'Parser conventions' },
      {
        type: 'p',
        text: 'Attributes are prefixed `@` and text content is exposed as `#text`, so a parsed document can be walked with the **same dotted paths used for JSON**. Namespace prefixes are stripped, so `soap:Envelope` reads as `Envelope` — assertions should not have to know which prefix the server chose today.',
      },
      {
        type: 'code',
        caption: 'One path syntax for both formats',
        text: `xmlPath(body, 'Envelope.Body.GetPriceResponse.Price');
xmlPath(body, 'catalog.item[0].@id');`,
      },
      { type: 'h3', text: 'SOAP faults' },
      {
        type: 'p',
        text: "SOAP reports application errors with HTTP 500 and a fault in the body, so a status assertion alone will not tell you what went wrong. `soapFault` reads both conventions — 1.1's `faultcode`/`faultstring` and 1.2's `Code`/`Reason` — so one helper works against either version.",
      },
      {
        type: 'note',
        text: 'Serialisation is written by hand rather than taken from the parser package, whose builder is deprecated in favour of a separate dependency. It is thirty lines, it escapes all five reserved characters, and it removes a dependency.',
      },
    ],
    changeWhen: [
      'The service needs SOAP 1.2 envelope construction.',
      'Namespace prefixes must be preserved.',
    ],
    changeHow: [
      {
        text: 'For SOAP 1.2, add an envelope builder alongside `soapEnvelope` with the 1.2 namespace.',
        code: `buildXml({ 'soap:Envelope': { '@xmlns:soap': 'http://www.w3.org/2003/05/soap-envelope', 'soap:Body': body } });`,
      },
      {
        text: 'To keep prefixes, set `removeNSPrefix: false` — and expect every path in the suite to need updating.',
      },
    ],
    why: 'Making XML read through the same path syntax as JSON is what lets one set of assertion habits cover both. A test author should not need a different mental model because a service is older.',
    gotchas: [
      'Namespace stripping means two differently-namespaced elements with the same local name collide. That has not happened in practice, but it is the trade-off.',
      'The parser coerces attribute values, so `@id="1"` becomes the number `1`.',
    ],
    related: ['src/core/api.response.ts', 'src/utils/jsonpath.utils.ts'],
  },

  'src/utils/retry.utils.ts': {
    group: 'utils',
    purpose:
      'Polling and retrying: `waitFor`, `waitUntil`, `waitUntilGone`, `retry`, `withTimeout`, `sleep` and `mapWithConcurrency`.',
    blocks: [
      {
        type: 'rule',
        text: 'Never sleep for a fixed duration when you can poll for the thing you are actually waiting for. A sleep is too short on a slow day, too long on every other, and silent about what it is waiting for.',
      },
      {
        type: 'code',
        caption: 'waitFor returns the value, so the wait and the read are one step',
        text: `const order = await waitFor(() => api.orders.find(id), {
  description: \`order \${id} to appear in the index\`,
  timeout: TIMEOUTS.POLL_TIMEOUT,
  interval: 250,
});`,
      },
      {
        type: 'table',
        head: ['Helper', 'For'],
        rows: [
          ['`waitFor(probe)`', 'Poll until a probe returns something truthy; returns it'],
          ['`waitUntil(read, predicate)`', 'Poll a value until a predicate holds'],
          ['`waitUntilGone(exists)`', 'Poll until something stops existing'],
          [
            '`retry(operation, options)`',
            'Exponential backoff with jitter, for genuinely transient work',
          ],
          ['`withTimeout(operation, ms)`', 'A hard deadline on something that could hang'],
          ['`sleep(ms)`', 'A plain delay — see below'],
          ['`mapWithConcurrency(items, limit, worker)`', 'Fan out with a ceiling'],
        ],
      },
      { type: 'h3', text: 'Why sleep is exported at all' },
      {
        type: 'p',
        text: 'A few situations genuinely need one: respecting a documented rate-limit window, or letting a clock tick past a whole second before asserting on a timestamp. If you are reaching for it to make a test pass, reach for `waitFor` instead.',
      },
      { type: 'h3', text: 'mapWithConcurrency' },
      {
        type: 'p',
        text: "Seeding a hundred records with `Promise.all` will trip the API's rate limit and produce a wall of 429s that look like product failures. This keeps the fan-out deliberate.",
      },
      {
        type: 'code',
        text: `const users = await mapWithConcurrency(rows, 5, (row) => api.users.create(row));`,
      },
      {
        type: 'warn',
        text: '`retry` is for transient *work*, never for assertions. Retrying until a test passes is how a real defect gets shipped.',
      },
    ],
    changeWhen: [
      'A polling pattern repeats across tests.',
      'The default interval or timeout is systematically wrong.',
    ],
    changeHow: [
      { text: 'Change the named budget in `src/config/timeouts.ts` rather than the call sites.' },
      {
        text: 'Add a helper only when the pattern is genuinely common — three occurrences, not two.',
      },
    ],
    why: 'Eventual consistency is the main cause of flaky API suites, and polling is the only honest answer to it. Making the polling helper return the value it waited for is what stops tests polling and then re-reading.',
    gotchas: [
      '`ignoreErrors` is off by default, so a probe that throws fails immediately. Turn it on only when the error is genuinely expected while waiting.',
      '`withTimeout` stops the caller waiting; it cannot cancel the underlying work, because nothing in JavaScript can.',
      '`PollTimeoutError` includes the last value seen, which is usually the whole diagnosis.',
    ],
    related: ['src/config/timeouts.ts', 'src/core/errors.ts'],
  },

  'src/utils/pagination.utils.ts': {
    group: 'utils',
    purpose:
      'Walkers for the four pagination conventions — `Link` header, cursor, offset — plus a normaliser and a defect detector.',
    blocks: [
      {
        type: 'p',
        text: 'Every API paginates differently, and a test that only ever reads page one will pass while page two is broken. These turn any convention into one list, with a hard page ceiling so a server bug cannot become an infinite loop.',
      },
      {
        type: 'table',
        head: ['Walker', 'Convention'],
        rows: [
          [
            '`followLinkHeader`',
            'RFC 8288 `rel="next"` — the only style needing no knowledge of the API\'s parameters',
          ],
          ['`followCursor`', 'Opaque cursors, with repeat detection'],
          ['`followOffset`', 'Offset/limit, stopping when a short page comes back'],
          [
            '`readPageEnvelope`',
            'Reads `items`/`data`/`results`/`content` and the common cursor and total field names into one `Page<T>`',
          ],
        ],
      },
      { type: 'h3', text: 'The defect detector' },
      {
        type: 'code',
        caption: 'The two bugs pagination tests exist to catch',
        text: `const defects = findPaginationDefects(pages, (item) => item.id);
expect(defects.duplicates).toEqual([]);
expect(defects.uniqueItems).toBe(defects.totalItems);`,
      },
      {
        type: 'p',
        text: 'An item on two pages, and an item on none. Both happen when the underlying data changes mid-walk, which is exactly why cursor pagination exists — and exactly what makes it worth testing.',
      },
      {
        type: 'note',
        text: '`followCursor` stops if a cursor repeats. A server that loops would otherwise hang the test until the whole-test timeout; this turns it into a clear, reportable failure.',
      },
    ],
    changeWhen: [
      'The API uses a convention none of these cover.',
      'The page ceiling is too low for a legitimate dataset.',
    ],
    changeHow: [
      {
        text: 'Add a walker following the same shape: a reader callback, a ceiling, and an options object.',
        code: `export async function followKeyset<T>(\n  readPage: (after: string | undefined) => Promise<{ items: T[]; last?: string }>,\n  options: PaginationOptions = {},\n): Promise<T[]> { /* … */ }`,
      },
      {
        text: 'Raise `MAX_PAGES` only with a reason; the ceiling exists to turn a hang into a failure.',
      },
    ],
    why: 'Pagination is where the difference between "the endpoint works" and "the endpoint works at scale" shows up, and it is almost never covered because walking pages by hand in a test is tedious. Making it one line removes the excuse.',
    gotchas: [
      'The ceiling logs a warning when hit rather than throwing, so a legitimate large dataset produces partial results with a visible reason.',
      '`readPageEnvelope` guesses field names. A service with an unusual shape should pass `itemsPath` explicitly.',
    ],
    related: ['src/utils/header.utils.ts', 'src/services/template.service.ts'],
  },

  'src/utils/data.utils.ts': {
    group: 'utils',
    purpose:
      'Test data: seeded Faker, factories, unique identifiers, and curated collections of adversarial strings, numbers and dates.',
    blocks: [
      { type: 'h3', text: 'Two rules' },
      {
        type: 'p',
        text: '**Generate, do not hard-code.** A suite whose fixtures say `alice@example.com` fails the second time it runs against an environment with a uniqueness constraint, and passes forever against a database somebody seeded by hand.',
      },
      {
        type: 'p',
        text: "**Generate deterministically.** Faker is seeded per test from the test's own title, so a failing run can be reproduced exactly while two tests still get different data. Random-but-reproducible is the combination that makes generated data safe to rely on.",
      },
      {
        type: 'code',
        caption: 'Factories state only what the test cares about',
        text: `const admin = buildUser({ role: 'admin' });
const order = buildOrder({ currency: 'USD' });
const invalid = without(buildUser(), 'email');   // for a missing-field test`,
      },
      { type: 'h3', text: 'Adversarial input' },
      {
        type: 'p',
        text: 'Four curated collections. Every entry has caused a production incident somewhere.',
      },
      {
        type: 'table',
        head: ['Collection', 'Contains'],
        rows: [
          [
            '`EDGE_CASE_STRINGS`',
            'Quotes, backslashes, combining marks, RTL text, zero-width characters, emoji sequences, a 5000-character string, `${…}` template syntax',
          ],
          [
            '`EDGE_CASE_NUMBERS`',
            'Zero, negatives, `MAX_SAFE_INTEGER`, one past it (as a **string**, because JavaScript cannot represent it), float error, extremes',
          ],
          [
            '`EDGE_CASE_DATES`',
            'The epoch, a leap day, a leap second, the far future, before the epoch, both offset directions',
          ],
          [
            '`INJECTION_PAYLOADS`',
            'SQL, NoSQL, XSS, path traversal, command injection, template injection, LDAP, CRLF, XXE',
          ],
        ],
      },
      {
        type: 'note',
        text: '`beyondSafeInteger` is a string on purpose. `9007199254740993` cannot be written as a JavaScript literal without losing precision — which is the point of the test: send it as a string and check whether the API round-trips it or silently rewrites it to `…992`.',
      },
    ],
    changeWhen: [
      'A resource needs a factory.',
      'An edge case bit you in production — add it here.',
    ],
    changeHow: [
      {
        text: 'Add a factory with `defineFactory`, taking a Faker instance so it stays deterministic.',
        code: `export const buildInvoice = defineFactory((source) => ({\n  reference: \`INV-\${source.string.numeric(6)}\`,\n  dueDate: source.date.soon({ days: 30 }).toISOString(),\n  totalMinor: source.number.int({ min: 100, max: 500_000 }),\n}));`,
      },
      {
        text: 'Add edge cases to the existing collections rather than creating a new one, so a table-driven test picks them up automatically.',
      },
    ],
    why: 'Edge-case collections are institutional memory. Every entry is a bug somebody already found; keeping them in one place means the next service gets tested against all of them for free.',
    gotchas: [
      'The `data` fixture is seeded per test. Importing the global `faker` directly loses that determinism.',
      '`uniqueId` and `uniqueEmail` use the clock and randomness, so they are unique but **not** reproducible — which is right for a value that must not collide across runs.',
    ],
    related: ['src/fixtures/api.fixture.ts', 'src/utils/security.utils.ts'],
  },

  'src/utils/performance.utils.ts': {
    group: 'utils',
    purpose:
      'Latency measurement: percentiles, a collector that samples every request, and a sampler for repeated calls.',
    blocks: [
      {
        type: 'p',
        text: 'An API suite is the cheapest place a team ever gets performance signal — the requests are already being made, so the timings are already there. What is usually missing is the discipline to look at a *distribution* rather than a single number: a mean hides the tail, and the tail is what users feel.',
      },
      {
        type: 'code',
        caption: 'Attached automatically by the fixture',
        text: `// Every request in the test is sampled:
client.onExchange(latency.record);

// And the report is attached as latency.json when the test ends.
latency.report();   // [{ route: 'GET /users/{id}', summary: { p95: 412, … } }]`,
      },
      { type: 'h3', text: 'Nearest-rank percentiles' },
      {
        type: 'p',
        text: 'Rather than interpolation, because nearest-rank always returns a value that was **actually observed** — which is what makes a reported p95 defensible in a conversation with the team that owns the service.',
      },
      { type: 'h3', text: 'Route collapsing' },
      {
        type: 'code',
        caption: 'Otherwise every request is its own bucket',
        text: `routeOf('https://api/v1/users/42')                          // '/v1/users/{id}'
routeOf('https://api/v1/orders/3f2b…-a1c9/items')            // '/v1/orders/{uuid}/items'`,
      },
      {
        type: 'warn',
        text: 'Latency percentiles from a functional suite are useful signal. They are not a load test, and this module is not a load-testing tool — measuring under load needs a tool built for it.',
      },
    ],
    changeWhen: ['A route shape is not being collapsed.', 'Another statistic is needed.'],
    changeHow: [
      {
        text: 'Add a pattern to `routeOf` for your identifier shape.',
        code: `if (/^[A-Z]{3}-\\d{6}$/.test(segment)) return '{reference}';`,
      },
      { text: 'Add the statistic to `summarize` and to `LatencySummary` together.' },
    ],
    why: 'Free signal that nobody has to set up is signal that actually gets looked at. Attaching the report to every test means the data is there when somebody asks "was it always this slow?".',
    gotchas: [
      'Measure in the `performance` project, which runs one worker. A p95 measured under eight parallel workers describes the load the suite generates.',
      '`sample()` discards warm-up runs by default: the first call to a cold endpoint measures connection setup and JIT.',
      '`record` is a bound property, so it can be passed to `onExchange` directly.',
    ],
    related: ['src/fixtures/api.fixture.ts', 'src/core/http.client.ts', 'playwright.config.ts'],
  },

  'src/utils/diff.utils.ts': {
    group: 'utils',
    purpose:
      'Structural comparison: a value diff with ignorable fields, and a *shape* comparison for detecting breaking changes.',
    blocks: [
      { type: 'h3', text: 'Two jobs' },
      {
        type: 'ul',
        items: [
          '**Response against a baseline**, which catches the field a service quietly stopped returning.',
          '**Response against response** — old version against new, one region against another — which is how a migration is verified without writing an assertion per field.',
        ],
      },
      {
        type: 'code',
        caption: 'Ignoring what legitimately changes',
        text: `expect(current).toMatchPayload(baseline, { ignore: VOLATILE_FIELDS });`,
      },
      {
        type: 'p',
        text: '`VOLATILE_FIELDS` covers ids, timestamps, trace ids and etags. Without ignoring them every diff is noise, and a diff nobody reads is a check nobody has.',
      },
      { type: 'h3', text: 'Shape comparison — the one worth running in CI' },
      {
        type: 'code',
        caption: 'Values change legitimately; shapes should not',
        text: `const baseline = shapeOf(before);   // { 'items[].id': 'number', 'items[].name': 'string' }
const current = shapeOf(after);

expect(breakingChanges(baseline, current)).toEqual([]);`,
      },
      {
        type: 'p',
        text: '`breakingChanges` reports only the two things that break consumers: a field **removed**, and a field whose **type changed**. Adding a field is not a breaking change and is not reported.',
      },
      { type: 'h3', text: 'Array comparison' },
      {
        type: 'p',
        text: 'Unordered by default, because most list endpoints do not guarantee order. Pass `strictArrayOrder` when the order is part of the contract — a sorted result, a sequence of events.',
      },
    ],
    changeWhen: [
      'A field should be treated as volatile everywhere.',
      'A different comparison semantic is needed.',
    ],
    changeHow: [
      {
        text: 'Add to `VOLATILE_FIELDS`. `*.name` matches at any depth; `prefix*` matches a prefix.',
      },
      {
        text: 'Add a `DiffOptions` flag rather than a second function, so one walker keeps all the semantics.',
      },
    ],
    why: 'The failure message is the reason this exists. Finding one changed field inside a large response by eye is genuinely difficult; a diff makes it immediate.',
    gotchas: [
      'Unordered array matching is O(n²). For very large arrays, pass `strictArrayOrder` if order is in fact stable.',
      '`shapeOf` collapses array indices to `[]`, so a two-item and a three-item response have the same shape — otherwise every list endpoint diffs against itself.',
    ],
    related: ['src/fixtures/custom-matchers.ts', 'src/utils/jsonpath.utils.ts'],
  },

  'src/utils/security.utils.ts': {
    group: 'utils',
    purpose:
      'Security checks that belong in a functional API suite: information disclosure, security headers, CORS, and authorisation matrices.',
    blocks: [
      {
        type: 'p',
        text: 'Not a penetration test — that is a different activity with different authorisation. These are the checks that catch the mistakes teams actually ship: an endpoint that forgot its authorisation check, a header that leaks the framework version, CORS opened to `*` with credentials, an error message that returns a stack trace to the caller.',
      },
      {
        type: 'p',
        text: 'Each helper **reports findings rather than throwing**, so a test can assert on the whole set and the report shows every problem at once.',
      },
      { type: 'h3', text: 'Disclosure' },
      {
        type: 'table',
        head: ['Rule', 'Catches'],
        rows: [
          [
            '`version-disclosure`',
            'A `Server` or `X-Powered-By` header containing a version number',
          ],
          ['`stack-trace`', 'A stack frame in a response body'],
          ['`sql-fragment`', 'A SQL statement echoed back'],
          ['`file-path`', 'A server-side filesystem path'],
          ['`connection-string`', 'A database URL'],
          [
            '`private-key`, `aws-key`, `bearer-token`',
            'Credentials in a response — the high-severity findings',
          ],
        ],
      },
      {
        type: 'p',
        text: 'A bare product name in `Server` is acceptable; a version number is the disclosure. That distinction is in the rule, so it does not produce noise.',
      },
      { type: 'h3', text: 'CORS' },
      {
        type: 'p',
        text: 'The dangerous combination is `Access-Control-Allow-Origin: *` together with `Access-Control-Allow-Credentials: true`. Browsers reject it, so in practice it means the server is *reflecting* whatever origin it is sent — which is worse, and is checked separately.',
      },
      { type: 'h3', text: 'The authorisation matrix' },
      {
        type: 'code',
        caption: 'Generate the grid, do not write the cases you thought of',
        text: `const matrix = buildAccessMatrix(
  ['admin', 'standard', 'readonly'],
  [{ method: 'DELETE', path: '/users/{id}', allowed: ['admin'] }],
);
// → 3 expectations: admin permitted, the other two refused.`,
      },
      {
        type: 'p',
        text: "`judgeAccess` knows that 401, 403 **and 404** all count as refusal — returning 404 to hide a resource's existence is a legitimate design. Returning 200 to a role that should be refused is always a finding.",
      },
      {
        type: 'rule',
        text: 'Authorisation defects are defects of *omission* — the endpoint nobody remembered to protect. Generating the whole grid is the only way to catch that class reliably.',
      },
    ],
    changeWhen: [
      'A disclosure pattern is missing.',
      'The security-header baseline should change.',
      'Findings need different severities.',
    ],
    changeHow: [
      {
        text: 'Add a pattern to `LEAK_PATTERNS` with an appropriate severity.',
        code: `{ rule: 'internal-hostname', pattern: /\\b\\w+\\.internal\\.example\\.com\\b/ },`,
      },
      {
        text: "Adjust `auditSecurityHeaders` to match your organisation's baseline — the defaults are defensible, not universal.",
      },
    ],
    why: 'These checks cost almost nothing once the requests are already being made, and they catch a class of defect that functional tests never look at. Reporting rather than throwing is what lets one test cover a whole surface.',
    gotchas: [
      'Never point the `security` project at production. The payloads are deliberately hostile.',
      'The header baseline is opinionated. Loosen it deliberately rather than deleting the test.',
      '`buildAccessMatrix` assumes a permitted call returns 200. Pass `allowedStatus` for a resource that returns 201 or 204.',
    ],
    related: ['src/utils/data.utils.ts', 'src/core/api.response.ts', 'playwright.config.ts'],
  },

  'src/utils/file.utils.ts': {
    group: 'utils',
    purpose:
      'Reading test data from disk and writing artefacts: JSON, CSV, NDJSON, temporary files, checksums.',
    blocks: [
      {
        type: 'p',
        text: 'Files matter for two reasons: as *input*, when a suite is driven by a table of cases rather than by code, and as *evidence*, when a run should leave behind something a human can inspect.',
      },
      {
        type: 'table',
        head: ['Helper', 'For'],
        rows: [
          [
            '`fromRoot`, `dataFile`',
            'Resolving paths, so the suite works regardless of the working directory it was launched from',
          ],
          [
            '`readJson`, `readCsv`, `readNdjson`',
            'Loading data; a missing file names the path it looked in',
          ],
          ['`writeJson`', 'Writing, creating parent directories'],
          ['`tempFile`, `tempFileOfSize`', 'A real file on disk for upload tests, deleted on exit'],
          ['`checksum`, `fileSize`', 'Verifying a download round-tripped'],
          ['`saveArtifact`', 'Writing evidence under `reports/artifacts/`'],
        ],
      },
      {
        type: 'p',
        text: 'CSV is the right format for a data-driven suite because non-engineers can edit it: a product owner adding a tax-rate case should not have to open a TypeScript file.',
      },
      {
        type: 'code',
        caption: 'A table-driven test',
        text: `for (const testCase of readCsv<Case>(dataFile('status-codes.csv'))) {
  test(\`\${testCase.scenario} @regression\`, async ({ http }) => {
    const response = await http.request(testCase.method, testCase.path).send();
    expect(response).toHaveStatus(Number(testCase.expectedStatus));
  });
}`,
      },
      {
        type: 'note',
        text: '`tempFileOfSize` exists so an upload-limit test does not need a large binary in the repository. A multi-megabyte fixture slows every clone forever.',
      },
    ],
    changeWhen: ['A new data format is needed.', 'Artefacts should go somewhere else.'],
    changeHow: [
      {
        text: 'Add a reader following the same shape: resolve the path, check existence with a message naming it, parse, return typed.',
      },
      {
        text: 'Prefer adding a format to adding a dependency — CSV, JSON and NDJSON cover almost everything.',
      },
    ],
    why: 'Path resolution through `fromRoot` is what makes the suite indifferent to where it was launched from. Relative paths in tests break the moment somebody runs a single spec from a subdirectory.',
    gotchas: [
      'CSV values are all strings; `cast: false` is deliberate, so a case table can distinguish "no value" from "the empty string". Convert explicitly.',
      'Temporary files are removed on process exit — best effort. A killed process leaves them for the OS.',
    ],
    related: ['src/data/README.md', 'src/mocks/recorder.ts'],
  },

  'src/utils/index.ts': {
    group: 'utils',
    purpose: 'Barrel for the utility layer.',
    changeWhen: ['You add a utility module or an export.'],
    changeHow: [
      {
        text: "Re-export it explicitly rather than with `export *`, so the module's public surface stays visible in one place.",
      },
    ],
    why: 'Explicit re-exports make the barrel a readable index of what the layer offers, and stop an internal helper leaking into the public surface by accident.',
    related: ['src/utils/logger.ts'],
  },
};
