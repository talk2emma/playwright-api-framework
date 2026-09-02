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
        text: '`leafPaths` is what `ApiResponse.fields()` is built on: it turns a payload into the set of paths it contains, which is the thing worth comparing against a baseline.',
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
        text: `const body = parseXml(response.text());
readPath(body, 'Envelope.Body.GetPriceResponse.Price');
readPath(body, 'catalog.item[0].@id');`,
      },
      { type: 'h3', text: 'SOAP faults' },
      {
        type: 'p',
        text: "SOAP reports application errors with HTTP 500 and a fault in the body, so a status assertion alone will not tell you what went wrong. `soapFault` reads both conventions — 1.1's `faultcode`/`faultstring` and 1.2's `Code`/`Reason` — so one helper works against either version.",
      },
      {
        type: 'note',
        text: 'This module parses; it does not serialise. An envelope builder lived here and no test ever sent SOAP, so it was removed. Add one back alongside `parseXml` when a test needs to send a request rather than read a response.',
      },
    ],
    changeWhen: [
      'The service needs SOAP 1.2 envelope construction.',
      'Namespace prefixes must be preserved.',
    ],
    changeHow: [
      {
        text: "For SOAP 1.2, add an envelope builder beside `parseXml`, escaping all five reserved characters. Write it by hand rather than pulling in the parser package's builder, which is deprecated in favour of a separate dependency.",
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
          ['`followOffset`', 'Offset/limit, stopping when a short page comes back'],
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
            '`INJECTION_PAYLOADS`',
            'SQL, NoSQL, XSS, path traversal, command injection, template injection, LDAP, CRLF, XXE',
          ],
        ],
      },
      {
        type: 'note',
        text: 'Numeric and date edge-case collections lived here too and no test read them, so they were removed. If you add one back, remember that `9007199254740993` cannot be written as a JavaScript literal without losing precision — send it as a string and check whether the API round-trips it or silently rewrites it to `…992`.',
      },
    ],
    changeWhen: [
      'A resource needs a factory.',
      'An edge case bit you in production — add it here.',
    ],
    changeHow: [
      {
        text: 'Add a factory beside `buildUser`, taking a seeded Faker instance so it stays deterministic.',
        code: `export function buildInvoice(source: Faker) {\n  return {\n    reference: \`INV-\${source.string.numeric(6)}\`,\n    dueDate: source.date.soon({ days: 30 }).toISOString(),\n    totalMinor: source.number.int({ min: 100, max: 500_000 }),\n  };\n}`,
      },
      {
        text: 'Add edge cases to the existing collections rather than creating a new one, so a table-driven test picks them up automatically.',
      },
    ],
    why: 'Edge-case collections are institutional memory. Every entry is a bug somebody already found; keeping them in one place means the next service gets tested against all of them for free.',
    gotchas: [
      'The `data` fixture is seeded per test. Importing the global `faker` directly loses that determinism.',
      '`uniqueId` uses the clock and randomness, so it is unique but **not** reproducible — which is right for a value that must not collide across runs.',
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
        text: 'Pass `ignore` for the fields that change on every run — ids, timestamps, trace ids, etags. Without ignoring them every diff is noise, and a diff nobody reads is a check nobody has. `*.name` matches at any depth and `prefix*` matches a prefix.',
      },
      {
        type: 'code',
        caption: 'Ignore what churns, compare the rest',
        text: `expect(current).toMatchPayload(baseline, {
  ignore: ['id', '*.createdAt', 'meta.traceId'],
  nullIsAbsent: true,
});`,
      },
      {
        type: 'p',
        text: 'A shape-comparison pair — deriving a type map and reporting only removed or retyped fields — lived here and was never called from a test. It was removed; `src/utils/jsonpath.utils.ts` still provides `leafPaths`, which is the piece such a check would be built on.',
      },
      { type: 'h3', text: 'Array comparison' },
      {
        type: 'p',
        text: 'Unordered by default, because most list endpoints do not guarantee order. Pass `strictArrayOrder` when the order is part of the contract — a sorted result, a sequence of events.',
      },
    ],
    changeWhen: [
      'A field should be ignored everywhere.',
      'A different comparison semantic is needed.',
    ],
    changeHow: [
      {
        text: 'Pass it in `ignore` at the call site, or add a shared constant beside the matcher in `src/fixtures/custom-matchers.ts` if the whole suite should skip it.',
      },
      {
        text: 'Add a `DiffOptions` flag rather than a second function, so one walker keeps all the semantics.',
      },
    ],
    why: 'The failure message is the reason this exists. Finding one changed field inside a large response by eye is genuinely difficult; a diff makes it immediate.',
    gotchas: [
      'Unordered array matching is O(n²). For very large arrays, pass `strictArrayOrder` if order is in fact stable.',
      'Paths collapse array indices to `[]`, so a two-item and a three-item response compare at the same paths — otherwise every list endpoint diffs against itself.',
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
      'Resolving a path against the repository root, so the suite behaves the same regardless of the working directory it was launched from.',
    blocks: [
      {
        type: 'p',
        text: 'The whole module is `fromRoot`. It is used by `global.setup.ts` to create the report directories and by `api.fixture.ts` to find an optional OpenAPI specification — both of which run before anything has established a working directory.',
      },
      {
        type: 'code',
        caption: 'The whole module',
        text: `fs.mkdirSync(fromRoot('reports', 'artifacts'), { recursive: true });
const spec = fromRoot('src', 'data', 'openapi.json');`,
      },
      {
        type: 'p',
        text: 'This module used to carry readers for JSON, CSV and NDJSON, temporary-file builders, checksums and an artefact writer, alongside a `src/data/` folder of fixtures to feed them. No test read any of it, so the helpers, the fixtures and the `csv-parse` dependency were removed together.',
      },
      {
        type: 'note',
        text: 'If a data-driven suite is wanted later, add the reader in the same change as the first test that calls it. A reader with no caller is indistinguishable from a reader nobody needs — which is exactly how the previous set accumulated.',
      },
    ],
    changeWhen: ['A test needs to read a data file, or a run should leave an artefact behind.'],
    changeHow: [
      {
        text: 'Add the reader here: resolve the path through `fromRoot`, check existence with an error naming the path it looked in, parse, and return a typed value.',
      },
      {
        text: 'For an upload-limit test, generate the file at run time rather than committing a multi-megabyte fixture that slows every clone forever.',
      },
    ],
    why: 'Path resolution is the one file concern every entry point genuinely shares. Everything else was speculative.',
    related: ['src/hooks/global.setup.ts', 'src/fixtures/api.fixture.ts'],
  },
};
