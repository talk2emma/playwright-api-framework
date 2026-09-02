# Playwright API Framework

A production-grade API automation framework built on Playwright Test and
TypeScript. It covers REST, GraphQL, Server-Sent Events, NDJSON streaming,
WebSockets and SOAP/XML, with contract validation, authentication, latency
measurement, security auditing and a built-in stub server.

Full documentation — every file, when to change it, how, and why —
is in [`docs/`](docs/): open `docs/site/index.html`, or the PDF at
`docs/playwright-api-framework-documentation.pdf`. Regenerate both with
`npm run docs`.

## Quick start

```bash
npm ci
npm test
```

That is the whole setup. The suite ships pointed at **four real, public APIs**
and needs no credentials, so a fresh clone produces a meaningful result
immediately. Copy `.env.example` to `.env` when you point it at your own API.

`make` lists every other command.

## What it runs against

| API                                                                    | Used for                                                                      | Limits                                                               |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| [`api.restful-api.dev`](https://api.restful-api.dev)                   | The CRUD lifecycle — the only one that genuinely persists writes              | 50 anonymous requests / 24 h; the live suite skips rather than fails |
| [`jsonplaceholder.typicode.com`](https://jsonplaceholder.typicode.com) | Reads and real `Link` header pagination                                       | none                                                                 |
| [`httpbin.org`](https://httpbin.org)                                   | Proving the client sends what it claims                                       | none                                                                 |
| built-in stub server                                                   | The same lifecycle offline, plus failure modes no real API produces on demand | none                                                                 |

There is no free, unauthenticated API offering both real persistence and an
unlimited quota, so the CRUD suite is split: `tests/api/objects.crud.spec.ts`
proves the API behaves as we believe, and
`tests/contract/objects.stubbed.spec.ts` runs the _same service object_ against
an executable model of the same contract on every run. See
[`tests/README.md`](tests/README.md).

```bash
npx playwright test --grep-invert @live   # everything that spends no quota
npx playwright test --project=contract    # offline, no network at all
```

## What is in the box

| Capability                                                                                                                       | Where                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Fluent request building — path params, query, all six body encodings, retries, idempotency keys                                  | `src/core/request.builder.ts`               |
| One HTTP engine: auth injection, backoff, read-only guard, timing, report steps                                                  | `src/core/http.client.ts`                   |
| Response wrapper with JSON/NDJSON/XML/binary readers, JSON paths and 15 assertions                                               | `src/core/api.response.ts`                  |
| Service objects — the API equivalent of page objects                                                                             | `src/core/base.service.ts`, `src/services/` |
| Auth: none, basic, bearer, API key, OAuth2 (client-credentials, password, refresh), HMAC signing, cookie session, JWT inspection | `src/auth/`                                 |
| Contracts: Zod schemas, JSON Schema via Ajv, OpenAPI conformance, a schema registry with automatic enforcement                   | `src/contracts/`                            |
| GraphQL, SSE, NDJSON streaming, WebSocket                                                                                        | `src/protocols/`                            |
| A programmable stub server and an exchange recorder for offline runs                                                             | `src/mocks/`                                |
| Polling, retries, pagination walkers, latency percentiles, structural diffing, security audits, data factories                   | `src/utils/`                                |
| Nine custom `expect` matchers                                                                                                    | `src/fixtures/custom-matchers.ts`           |

## Layout

```
playwright-api-framework/
├── playwright.config.ts     Projects, reporters, timeouts
├── src/
│   ├── config/              Validated environment resolution
│   ├── core/                Client, builder, response, service base, errors
│   ├── auth/                Credential providers and the token cache
│   ├── contracts/           Schemas, JSON Schema, OpenAPI, the registry
│   ├── protocols/           GraphQL, SSE, NDJSON, WebSocket
│   ├── services/            Service objects
│   ├── fixtures/            The `test` and `expect` that specs import
│   ├── mocks/               Stub server and exchange recorder
│   ├── hooks/               Global setup/teardown, session capture
│   ├── utils/               Cross-cutting helpers
│   ├── reporters/           The run summary
│   ├── data/                Static test data
│   └── types/               Shared type vocabulary
├── tests/                   api/ · contract/ · performance/ · security/
│                            49 tests across 7 specs, all against real APIs
├── scripts/docs/            The documentation generator
└── docs/                    Generated HTML site and PDF
```

## Writing a test

```ts
import { test, expect } from '../../src/fixtures';

test('an object survives a full lifecycle @smoke @objects', async ({ api }) => {
  const created = await api.objects.create({ name: 'MacBook Pro', data: { year: 2026 } });

  // The read is what proves the write actually persisted.
  const stored = await api.objects.require(created.id);
  expect(stored.name).toBe(created.name);

  await api.objects.remove(created.id);
  expect(await api.objects.find(created.id)).toBeUndefined();
});
```

The object is deleted automatically even if the test fails:
`api.objects.create` registers its own cleanup at the moment of creation.

A full, line-by-line walkthrough of the real CRUD suite — what every call does
and why — is the **Worked example** section of the documentation.

## Configuration

Everything is read from the environment by `src/config/env.config.ts`, which
validates it before a single request is sent. `.env.example` documents every
variable. Named environments (URLs, prefixes, latency budgets, read-only flags)
live in `src/config/environments.ts` and contain no secrets.

## Security

- `.env.example` is a committed template. `.env*` is git-ignored.
- `storage/*.json` holds live sessions and tokens; it is git-ignored, and
  committing one is equivalent to committing a password.
- Credentials reach the code only through `getUser(role)`, which reads the
  process environment. CI supplies them as repository secrets.
- Headers and recordings are redacted before they are logged or attached.
- Environments can be marked `readOnly`, and the client then refuses to send
  any mutating verb against them.
