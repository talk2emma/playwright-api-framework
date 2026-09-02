# Tests

The suite runs against **four real, public APIs**. No credentials are required
and nothing is mocked by default, so a fresh clone can run `npm test` and get a
meaningful result immediately.

```bash
npm ci
npm test
```

## The APIs, and why each one is here

| API                                                                    | Used for                                                                                                    | Limits                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [`api.restful-api.dev`](https://api.restful-api.dev)                   | **The CRUD lifecycle.** The only one of the four that genuinely persists writes.                            | **50 anonymous requests / 24 h**, then `405`. The live suite skips rather than fails. |
| [`jsonplaceholder.typicode.com`](https://jsonplaceholder.typicode.com) | Reads and real RFC 8288 `Link` header pagination, over a stable 100-record dataset.                         | None. Writes are simulated and do not persist.                                        |
| [`httpbin.org`](https://httpbin.org)                                   | Proving the client puts on the wire what it claims to — headers, bodies, credentials, redirects, encodings. | None.                                                                                 |
| The built-in stub server                                               | The same CRUD lifecycle, exhaustively, offline, plus failure modes no real API will produce on demand.      | None.                                                                                 |

The CRUD target's quota is the constraint that shapes everything else. There is
no free, unauthenticated API that offers both genuine persistence and an
unlimited quota, so the suite splits the work:

- **`tests/api/objects.crud.spec.ts`** proves the API really behaves as we
  believe — a few times a day, within quota.
- **`tests/contract/objects.stubbed.spec.ts`** runs the _same service object_
  against [`src/mocks/objects.stub.ts`](../src/mocks/objects.stub.ts), an
  executable model of the same contract — every run, offline, unlimited.

If the two ever disagree, either the API changed or we misread it. Either way,
that is what a suite is for.

## Layout

| Folder               | Project       | Contains                                                                                                 |
| -------------------- | ------------- | -------------------------------------------------------------------------------------------------------- |
| `tests/api/`         | `api`         | Functional behaviour: the live CRUD lifecycle, pagination, and the client's real-wire behaviour.         |
| `tests/contract/`    | `contract`    | Conformance: the stubbed lifecycle and OpenAPI validation. Runs with no network.                         |
| `tests/performance/` | `performance` | Latency budgets and percentiles. One worker, so measurements are not self-inflicted.                     |
| `tests/security/`    | `security`    | Response hygiene, injection transport, CORS, authorisation matrices. **Never point this at production.** |

## Files

| Spec                                | Proves                                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `api/objects.crud.spec.ts`          | A real object can be created, read, replaced, patched and deleted, and the write actually persisted.                      |
| `api/posts.pagination.spec.ts`      | `Link` header pagination walks the whole dataset exactly once, with no duplicates and no gaps.                            |
| `api/client.behaviour.spec.ts`      | The framework sends the JSON, forms, multipart, raw text, query encodings, headers and credentials it claims to.          |
| `contract/objects.stubbed.spec.ts`  | The same lifecycle, plus retries, timeouts and malformed bodies — the failure modes a real API will not produce to order. |
| `contract/objects.openapi.spec.ts`  | Every response satisfies the OpenAPI document in `src/data/openapi.json`, and the coverage gap is reported.               |
| `performance/posts.latency.spec.ts` | An endpoint's p50/p90/p95/p99 stay inside their budget.                                                                   |
| `security/response.hygiene.spec.ts` | No credential leaks, injection payloads transported unchanged, CORS audited, redaction working.                           |

## Conventions

**Import from `../../src/fixtures`, never from `@playwright/test`.** The
Playwright `test` and `expect` have no cleanup registry, no contract guard and
none of the custom matchers, and nothing will tell you.

```ts
import { test, expect } from '../../src/fixtures';
```

**One behaviour per test.** A test asserting three unrelated things reports the
first failure and hides the other two. The one exception is the end-to-end
lifecycle, whose whole purpose is to prove the operations compose.

**Tag every test** with a suite tag and a domain tag. Tags are how a pipeline
selects a subset without anybody maintaining a list of paths.

| Tag                             | Means                                                                                          |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| `@smoke`                        | Must pass before a deploy. Keep it small.                                                      |
| `@regression`                   | The main body of the suite.                                                                    |
| `@contract`                     | Asserts conformance to a schema or document.                                                   |
| `@security`                     | Authorisation, input handling, response hygiene.                                               |
| `@performance`                  | Latency budgets.                                                                               |
| `@live`                         | **Spends real-API quota.** Exclude with `--grep-invert @live` to run everything else for free. |
| `@slow`                         | Legitimately slow; excluded from the fast loop.                                                |
| `@objects`, `@posts`, `@client` | The domain area.                                                                               |

```bash
npx playwright test --grep @smoke
npx playwright test --grep-invert @live      # everything that costs nothing
npx playwright test --project=contract       # offline, no network at all
```

**Create through a service object, assert in the test.** Service methods return
domain values and never assert, so a negative-path test can reuse them.

**Never sleep.** Use `waitFor` from `src/utils/retry.utils.ts`.

**Let the framework clean up.** `api.objects.create` registers its own deletion.
A test that creates a resource directly should call `cleanup.register(...)` in
the same statement.

## Naming

`<resource>.<behaviour>.spec.ts` — `objects.crud.spec.ts`,
`posts.pagination.spec.ts`, `response.hygiene.spec.ts`. The name should make
obvious which service object the test exercises.
