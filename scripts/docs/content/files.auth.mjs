/** Authentication providers and the contract-validation layer. */
export default {
  /* ---------------------------------------------------------------- */
  /* src/auth                                                          */
  /* ---------------------------------------------------------------- */

  'src/auth/static.auth.ts': {
    group: 'auth',
    purpose:
      'The three credential schemes that need no network call: `NoAuth`, `BasicAuth` and `ApiKeyAuth`. Grouped in one file because each is a handful of lines and splitting them would cost more in imports than it saves in navigation. Bearer tokens are applied through `.bearer(token)` on the request builder rather than through a strategy class.',
    blocks: [
      {
        type: 'table',
        head: ['Provider', 'Sends', 'Use for'],
        rows: [
          ['`NoAuth`', 'Nothing', 'Asserting the 401 path explicitly'],
          ['`BasicAuth`', '`Authorization: Basic …`', 'Simple username/password APIs'],
          [
            '`BearerAuth`',
            '`Authorization: Bearer …`',
            'A token captured elsewhere — including by the UI suite',
          ],
          ['`ApiKeyAuth`', 'A header, or a query parameter', 'Key-based APIs'],
        ],
      },
      {
        type: 'code',
        caption: 'BearerAuth accepts a function, which is what makes it useful',
        text: `// A fixed token:
new BearerAuth(token);

// Or a source read at request time, so a refresh is picked up automatically:
new BearerAuth(() => readCapturedToken());`,
      },
      {
        type: 'p',
        text: '`ApiKeyAuth` supports the query-string form because some APIs require it — but a key in a query string ends up in server access logs and browser history, so the header form is the default and the better choice wherever the API allows it.',
      },
    ],
    changeWhen: ['An API uses a header name or prefix these do not cover.'],
    changeHow: [
      {
        text: 'Most variation is already an option.',
        code: `new ApiKeyAuth(key, { in: 'header', name: 'x-tenant-key', prefix: 'ApiKey ' });`,
      },
      {
        text: 'For a genuinely different scheme, add a file implementing `AuthProvider` rather than adding a fifth mode here.',
      },
    ],
    why: 'These are the schemes with no state and no I/O. Keeping them together and keeping them tiny makes the point that a provider is a small thing — which is what encourages writing another one instead of special-casing a test.',
    gotchas: [
      '`ApiKeyAuth.queryParams()` exists for the query form, but the client only injects headers. A query key has to be merged by the caller — which is another reason to prefer the header.',
      'A header set explicitly on a request always beats the provider.',
    ],
    related: ['src/core/http.client.ts', 'src/fixtures/api.fixture.ts'],
  },

  'src/auth/oauth2.auth.ts': {
    group: 'auth',
    purpose:
      'OAuth 2.0 token acquisition: client credentials, resource-owner password, and refresh. Tokens are cached in the shared store, so a suite authenticates once per role rather than once per test.',
    blocks: [
      { type: 'h3', text: 'Why these three grants' },
      {
        type: 'ul',
        items: [
          '**Client credentials** — the suite acting as itself, for machine-to-machine APIs.',
          '**Password** — the suite acting as a named user, which is what an authorisation matrix needs.',
          '**Refresh** — extending a session without re-authenticating.',
        ],
      },
      {
        type: 'p',
        text: 'Authorisation-code flows need a browser and belong in the UI suite, which can perform the flow and hand the resulting token to `BearerAuth`.',
      },
      {
        type: 'code',
        caption: 'Both entry points are static, so the grant is visible at the call site',
        text: `OAuth2Auth.clientCredentials(request, { scope: 'orders:read' });
OAuth2Auth.password(request, username, password, { store: tokens });`,
      },
      { type: 'h3', text: 'The option that saves the most time' },
      {
        type: 'code',
        caption: 'clientAuth',
        text: `// Default: credentials in an Authorization: Basic header.
OAuth2Auth.clientCredentials(request);

// Some providers require them in the form body instead.
OAuth2Auth.clientCredentials(request, { clientAuth: 'body' });`,
      },
      {
        type: 'p',
        text: 'Providers differ, and sending the wrong one produces `invalid_client` — which reads exactly like a wrong secret. If credentials are definitely correct and the token endpoint still refuses them, try the other form before anything else.',
      },
      { type: 'h3', text: 'Caching' },
      {
        type: 'p',
        text: 'Keyed by token URL, grant, subject and scope, so two roles never share a token. Renewal happens 30 seconds before real expiry, because a token that expires mid-flight produces a 401 nobody can reproduce.',
      },
    ],
    changeWhen: [
      'The provider needs an extra parameter.',
      'A grant is needed that is not here.',
      'Errors need more context.',
    ],
    changeHow: [
      {
        text: 'Most providers only need an extra parameter, which needs no code change.',
        code: `OAuth2Auth.clientCredentials(request, {\n  extra: { audience: 'https://api.example.com', resource: 'orders' },\n});`,
      },
      {
        text: 'For a new grant, add a static factory and a branch in `fetchToken`. Keep the cache key discriminating enough that grants cannot collide.',
      },
    ],
    why: 'A token endpoint is usually rate-limited harder than the API itself, so a hundred parallel tests each fetching their own token start failing with 429s that look like product bugs. Caching is not an optimisation here; it is what makes a parallel suite viable.',
    gotchas: [
      'A non-JSON response from the token endpoint is reported with an excerpt — usually an HTML error page from a proxy, not a credential problem.',
      '`invalidate()` drops the cached token, which is how a token-expiry test forces a refresh.',
      'The store is per worker. Eight workers fetch eight tokens, not one — pass a persisting store if that matters.',
    ],
    related: ['src/auth/token.store.ts', 'src/fixtures/api.fixture.ts', 'src/config/env.config.ts'],
  },

  'src/auth/token.store.ts': {
    group: 'auth',
    purpose:
      'Caches access tokens, with an expiry skew, and optionally persists them to a file so separate worker processes can share one.',
    blocks: [
      {
        type: 'code',
        caption: 'The pattern every provider uses',
        text: `async token(): Promise<CachedToken> {
  return this.store.getOrCreate(this.cacheKey(), () => this.fetchToken());
}`,
      },
      {
        type: 'p',
        text: 'A token within 30 seconds of expiry is treated as already expired and discarded. That skew is the difference between a reliable suite and one that occasionally 401s for no discoverable reason.',
      },
      {
        type: 'warn',
        text: 'A persisted token file is a **live credential**. It is written with mode `0600`, lives under `storage/`, and that whole directory is git-ignored. Global teardown clears the in-memory store so a token does not linger on a shared build agent.',
      },
    ],
    changeWhen: [
      'The skew is wrong for a provider issuing very short tokens.',
      'Workers should share one token.',
    ],
    changeHow: [
      {
        text: 'Adjust `EXPIRY_SKEW_MS` — raise it for short-lived tokens, never lower it below a few seconds.',
      },
      {
        text: 'To share across workers, construct the store with a path. The file is git-ignored.',
        code: `new TokenStore(fromRoot('storage', \`tokens-\${config.env}.json\`));`,
      },
    ],
    why: "Two costs justify a cache: token endpoints are rate-limited, and a token round trip on every request roughly doubles a suite's runtime. The skew exists because the alternative failure is unreproducible.",
    gotchas: [
      'A corrupt cache file is ignored with a warning rather than failing the run. The worst case is one extra token request.',
      'The exported `tokenStore` is per process. Workers do not share memory.',
    ],
    related: ['src/auth/oauth2.auth.ts', 'src/hooks/global.teardown.ts', '.gitignore'],
  },
  'src/auth/jwt.ts': {
    group: 'auth',
    purpose:
      'JWT inspection — decoding only. Reads the header, claims and (unverified) signature so a test can assert on scopes, expiry and subject.',
    blocks: [
      {
        type: 'rule',
        text: "Decode-only, deliberately. Verifying a signature needs the issuer's key and is the API's job, not the suite's. What a test legitimately needs is to read the claims it was given. **Never treat a decoded token as trusted.**",
      },
      {
        type: 'table',
        head: ['Function', 'Returns'],
        rows: [['`decodeJwt(token)`', 'Header, claims and signature segment']],
      },
      {
        type: 'p',
        text: 'One function, because one is what the suite uses. Named accessors for claims, expiry and scopes existed here and were never called; they were removed rather than left as surface nobody exercises.',
      },
      {
        type: 'note',
        text: '`exp` is in **seconds** since the epoch, not milliseconds. That off-by-a-thousand is the classic JWT bug — convert at the point of use, and remember it when adding an expiry helper.',
      },
    ],
    changeWhen: ['A test needs a claim the helpers do not expose.'],
    changeHow: [
      {
        text: 'The decoded `claims` object is an open record, so custom claims are already reachable.',
        code: `const tenant = decodeJwt(token).claims['https://example.com/tenant'];`,
      },
      { text: 'Add a named helper only for a claim used repeatedly across the suite.' },
    ],
    why: 'Asserting that a token carries the right scopes and expires when it should is a real test, and it needs no cryptography. Keeping verification out keeps the boundary honest.',
    gotchas: [
      'A leading `Bearer ` is stripped, so a header value can be passed directly.',
      'base64url differs from base64 in two characters and drops padding; `decodeSegment` handles both.',
      'A malformed token throws `ConfigurationError` with a specific message rather than a generic parse error.',
    ],
    related: ['src/auth/oauth2.auth.ts', 'src/core/errors.ts'],
  },
  /* ---------------------------------------------------------------- */
  /* src/contracts                                                     */
  /* ---------------------------------------------------------------- */

  'src/contracts/schemas.ts': {
    group: 'contracts',
    purpose:
      'Reusable schema building blocks: identifiers, timestamps, money, pagination envelopes, and the standard error shapes.',
    blocks: [
      {
        type: 'p',
        text: 'Zod rather than raw JSON Schema for anything hand-written, because it produces a TypeScript type as a by-product: `response.parse(User)` returns a fully typed value, so the test body cannot drift from the contract.',
      },
      {
        type: 'table',
        head: ['Export', 'Describes'],
        rows: [
          [
            '`uuid`, `identifier`',
            'An RFC 4122 id, and the union of string-or-number ids most APIs actually use',
          ],
          ['`isoDateTime`, `isoDate`', 'An instant with an offset, and a bare calendar date'],
          ['`email`, `url`', 'Format-checked strings'],
          [
            '`minorUnits`, `currency`',
            'Money as an integer — never a float — and an ISO 4217 code',
          ],
          ['`timestamps`', 'The `createdAt`/`updatedAt` pair, spread into a resource schema'],
          [
            '`offsetPage`, `cursorPage`, `dataEnvelope`',
            'The three common wrapper shapes, as generic functions',
          ],
          ['`problemDetails`', 'RFC 9457 — the standard error body'],
          [
            '`errorEnvelope`, `validationErrors`',
            'Looser shapes for APIs that predate the standard',
          ],
          ['`healthCheck`', 'What a `/health` endpoint should return'],
        ],
      },
      {
        type: 'code',
        caption: 'Composing a resource schema',
        text: `export const OrderSchema = z.object({
  id: identifier,
  currency,
  totalMinor: minorUnits,
  ...timestamps,
});

export const OrderPageSchema = cursorPage(OrderSchema);`,
      },
      {
        type: 'note',
        text: '`problemDetails` is worth asserting even on a happy-path test. An API that returns a bare string on error is one your consumers cannot handle, and this is the cheapest place to catch that.',
      },
    ],
    changeWhen: [
      'A shape is being written out in more than one service.',
      'The API uses a convention not covered here.',
    ],
    changeHow: [
      {
        text: 'Add the primitive or the envelope factory. Annotate the return type of a generic factory explicitly — the inferred Zod type is unreadable and the lint rule requires it.',
        code: `export function keysetPage<T extends z.ZodTypeAny>(\n  item: T,\n): z.ZodObject<{ items: z.ZodArray<T>; after: z.ZodOptional<z.ZodString> }> {\n  return z.object({ items: z.array(item), after: z.string().optional() });\n}`,
      },
    ],
    why: 'Every API repeats the same handful of shapes. Defining them once means a change to "what a valid timestamp looks like" is one edit, and it keeps each service\'s own schema short enough to read.',
    gotchas: [
      'Zod objects are non-strict by default: an unexpected extra field passes. Use `.strict()` when the test is specifically about the API not returning more than it promised.',
      '`z.string().datetime({ offset: true })` accepts an offset; without the option only `Z` is allowed.',
    ],
    related: ['src/contracts/schema.registry.ts', 'src/services/template.service.ts'],
  },

  'src/contracts/schema.registry.ts': {
    group: 'contracts',
    purpose:
      'Maps method + path pattern + status to a schema. This is what lets the contract guard find the right schema from a real request, and what gives contract coverage a denominator.',
    blocks: [
      {
        type: 'code',
        caption: 'Registration, at module scope beside the service',
        text: `registerSchemas([
  { name: 'order', method: 'GET', pathPattern: '/orders/{id}', status: '2xx', schema: OrderSchema },
  { name: 'order-created', method: 'POST', pathPattern: '/orders', status: 201, schema: OrderSchema },
  { name: 'order-error', method: 'POST', pathPattern: '/orders', status: '4xx', schema: problemDetails },
]);`,
      },
      { type: 'h3', text: 'Path matching' },
      {
        type: 'p',
        text: "`/orders/{id}` matches `/orders/42` — otherwise every identifier would need its own registration. It also tolerates a leading version segment, so one registration works whether the environment's prefix is `/v1` or empty.",
      },
      {
        type: 'code',
        caption: 'What matches what',
        text: `matchesPath('/orders/{id}', '/orders/42')      // true
matchesPath('/orders/{id}', '/v1/orders/42')   // true — version prefix skipped
matchesPath('/orders/{id}', '/orders')         // false — different segment count`,
      },
      { type: 'h3', text: 'Status patterns' },
      {
        type: 'p',
        text: 'A status is an exact code or one of `2xx`, `4xx`, `5xx`. The band form is what makes a single error-shape registration cover every failure of an endpoint.',
      },
    ],
    changeWhen: ['You add an endpoint.', 'The path-matching rules need to change.'],
    changeHow: [
      { text: 'Register beside the schema, in the service file, so the two cannot drift apart.' },
      {
        text: 'Check registration took effect.',
        code: `node -e "import('./src/contracts/schema.registry.ts')" # or assert findSchema(...) in a test`,
      },
    ],
    why: 'Automatic validation needs a way to get from "a response arrived from `/v1/orders/42`" to "here is the schema that describes it". Without the registry, `STRICT_CONTRACTS` could not exist and every schema check would have to be written by hand in a test.',
    gotchas: [
      'Registration happens on import. A service nobody imports registers nothing — which is fine, since nothing is calling it either.',
      '`findSchema` returns the **first** match, so a specific pattern should be registered before a general one.',
      "`clearSchemas()` exists for the framework's own tests. Calling it in a suite silently disables the guard.",
    ],
    related: [
      'src/fixtures/api.fixture.ts',
      'src/contracts/schemas.ts',
      'src/services/template.service.ts',
    ],
  },

  'src/contracts/json-schema.ts': {
    group: 'contracts',
    purpose:
      "JSON Schema validation via Ajv, for schemas the team was *given* rather than wrote — an OpenAPI document, a partner's published contract, a schema from another repository.",
    blocks: [
      {
        type: 'p',
        text: 'Both validators report violations in the same `ValidationResult` shape, so an assertion does not care whether a Zod schema or a JSON Schema ran.',
      },
      {
        type: 'code',
        caption: 'Why Ajv is configured this way',
        text: `const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true, verbose: true });
addFormats(ajv);`,
      },
      {
        type: 'ul',
        items: [
          '**`strict: false`** — real-world OpenAPI documents carry vendor extensions and keywords Ajv does not know. Failing on those would reject valid specifications.',
          '**`allErrors: true`** — collecting every violation is the whole point of a contract check, rather than reading the first mismatch and re-running.',
          '**`addFormats`** — without it, `date-time`, `email` and `uri` are silently ignored, and a schema appears to pass when it never checked anything.',
        ],
      },
      { type: 'h3', text: 'Error formatting' },
      {
        type: 'p',
        text: "Ajv's raw output puts the path in `instancePath`, the reason in `message` and the useful specifics in `params`. `formatAjvErrors` joins them into a sentence.",
      },
      {
        type: 'code',
        caption: 'Before and after',
        text: `// Ajv: { instancePath: '/items/0/price', message: 'must be number', params: { type: 'number' } }
// Formatted:
items.0.price must be number (expected number)`,
      },
    ],
    changeWhen: ['A keyword needs custom handling.', 'An error message could be more specific.'],
    changeHow: [
      {
        text: 'Add a case to `describeParams` for a keyword whose `params` carry something useful.',
      },
      {
        text: 'Register shared schemas by `$id` so others can `$ref` them.',
        code: `addSchema(commonDefinitions, 'https://example.com/schemas/common.json');`,
      },
    ],
    why: 'Zod covers what the team writes; JSON Schema covers what the team is given. Both matter, and a suite that can only do one of them cannot check conformance against a published contract.',
    gotchas: [
      'Compiled validators are cached by object identity in a `WeakMap`. Building a fresh schema object on every call recompiles every time — hoist it.',
      '`strict: false` means a typo in a keyword name is ignored rather than reported. Validate the schema itself if it is hand-written.',
    ],
    related: ['src/contracts/openapi.ts', 'src/fixtures/custom-matchers.ts'],
  },

  'src/contracts/openapi.ts': {
    group: 'contracts',
    purpose:
      'Validates responses against an OpenAPI document: finds the operation for a method and path, resolves local `$ref`s, picks the schema for the status, and hands it to Ajv.',
    blocks: [
      {
        type: 'p',
        text: 'A hand-written schema records what the test author believed. The document records what the API *promised*. Only the second catches the case that hand-written schemas never do: the API and its published contract have drifted, and every consumer who trusted the document is broken.',
      },
      {
        type: 'table',
        head: ['Method', 'Does'],
        rows: [
          [
            '`fromFile` / `fromObject`',
            'Loads a document from disk, or one fetched from the API itself',
          ],
          ['`list()`', 'Every documented operation'],
          ['`find(method, url)`', 'The operation matching a real request'],
          ['`validate(method, url, status, payload)`', 'A `ValidationResult`'],
          ['`assert(...)`', 'The throwing form, raising `ContractViolationError`'],
          [
            '`uncovered(calls)`',
            'Documented operations the suite never exercised — the contract-coverage gap',
          ],
        ],
      },
      { type: 'h3', text: 'Status resolution' },
      {
        type: 'p',
        text: 'It looks for the exact code, then the `4XX` band, then `default` — which is how a document describes "every other status", usually the error shape.',
      },
      { type: 'h3', text: 'Deliberately small' },
      {
        type: 'p',
        text: "Only in-document `$ref`s are followed. A specification that references another file should be bundled first — resolving across files here would mean inventing a resolver whose behaviour differs subtly from the team's own tooling, which is worse than not having one.",
      },
      {
        type: 'code',
        lang: 'shell',
        caption: 'Bundle first',
        text: `npx @redocly/cli bundle openapi.yaml -o src/data/openapi.json`,
      },
    ],
    changeWhen: [
      'The document uses a construct that is not handled.',
      'You want request-side validation too.',
    ],
    changeHow: [
      {
        text: 'Extend `collectResponses` for a media type other than JSON, or `collectOperations` for a construct such as `webhooks`.',
      },
      {
        text: 'For request validation, the parameters are already collected — add a `validateRequest` that checks them against `RequestSpec`.',
      },
    ],
    why: 'Contract conformance is the one check that catches a breaking change *before* a consumer does. Making it cheap — drop the document in `src/data/` and it is picked up automatically — is what makes it get used.',
    gotchas: [
      'An external `$ref` throws with an explicit message telling you to bundle. That is intentional, not a limitation to work around.',
      'The `$ref` resolver has a depth limit of 50, so a circular reference terminates instead of hanging.',
      'An undocumented operation is reported as a validation failure. That is usually a real finding: the suite is calling something the document does not describe.',
    ],
    related: ['src/contracts/json-schema.ts', 'src/fixtures/api.fixture.ts', 'src/data/README.md'],
  },
};
