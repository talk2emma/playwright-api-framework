/** Root configuration files: the settings every other layer inherits. */
export default {
  'package.json': {
    group: 'root',
    purpose:
      "Declares every dependency and every command. In practice this is the framework's table of contents: if a task is worth doing twice, it has a script here.",
    blocks: [
      { type: 'h3', text: 'Script groups' },
      {
        type: 'table',
        head: ['Group', 'Scripts', 'For'],
        rows: [
          [
            'Run',
            '`test`, `test:api`, `test:contract`, `test:performance`, `test:security`',
            'One project at a time, matching the projects in `playwright.config.ts`',
          ],
          [
            'Select',
            '`test:smoke`, `test:regression`, `test:failed`, `test:serial`',
            'A subset by tag, by last result, or without parallelism',
          ],
          ['Debug', '`test:debug`, `test:ui`', 'The inspector and the interactive UI mode'],
          ['Report', '`report`, `report:allure`', 'Open what a run produced'],
          [
            'Quality',
            '`lint`, `lint:fix`, `format`, `format:check`, `typecheck`, `validate`',
            '`validate` is what CI runs first — the three checks in one',
          ],
          [
            'Docs',
            '`docs`, `docs:api`, `docs:html`, `docs:pdf`, `docs:open`',
            'Regenerate this documentation',
          ],
        ],
      },
      { type: 'h3', text: 'Notable dependency choices' },
      {
        type: 'table',
        head: ['Package', 'Why this one'],
        rows: [
          [
            '`zod@^3`',
            "**Pinned to v3 deliberately.** The v4 CommonJS build fails to initialise under Playwright's transform, and Playwright loads config through that transform. Upgrading requires verifying that first.",
          ],
          [
            '`ajv` + `ajv-formats`',
            'JSON Schema validation for specifications the team was *given* rather than wrote. `ajv-formats` supplies `date-time`, `email`, `uri` — without it those keywords are silently ignored.',
          ],
          [
            '`fast-xml-parser`',
            'XML and SOAP parsing with no native bindings. Only the parser is used; its builder is deprecated, so `xml.utils.ts` serialises by hand.',
          ],
          ['`@faker-js/faker`', 'Data generation, seeded per test so runs are reproducible.'],
          ['`csv-parse`', 'Reads the data-driven case tables in `src/data/`.'],
          [
            '`playwright-ctrf-json-reporter`',
            'A common test-result format, for aggregating across tools.',
          ],
          [
            '`allure-playwright`',
            'Optional and off by default — it is heavy, and `ALLURE=true` turns it on.',
          ],
        ],
      },
      { type: 'h3', text: 'Two things that are absent on purpose' },
      {
        type: 'ul',
        items: [
          '**No `"type": "module"`.** Playwright transforms TypeScript itself, and declaring the package ESM breaks interoperability with CommonJS dependencies loaded through that transform.',
          '**No WebSocket or HTTP client library.** Node has both built in — a global `WebSocket` since 22, and streaming `fetch`. A dependency here would be a second implementation to keep current.',
        ],
      },
      { type: 'h3', text: 'Git hooks' },
      {
        type: 'p',
        text: 'The `prepare` script installs Husky, and `lint-staged` (configured in this file) runs ESLint and Prettier on staged files. `.husky/pre-commit` runs `lint-staged`; `.husky/pre-push` runs `typecheck`, because a type error is cheap to catch locally and expensive to catch in CI.',
      },
    ],
    changeWhen: [
      'You add a dependency.',
      'A task is worth running twice — give it a script rather than a wiki page.',
      'You add a project to `playwright.config.ts` and want a shortcut for it.',
      'The Node floor moves (also update `.nvmrc` and the `Dockerfile` tag).',
    ],
    changeHow: [
      {
        text: 'Add a dependency. Everything here is a devDependency: nothing ships to production.',
        code: `npm install --save-dev <package>`,
      },
      {
        text: 'Add a script named for the outcome, not the mechanics.',
        code: `"test:orders": "playwright test --grep @orders"`,
      },
      { text: 'Mirror it in the `Makefile` if it is a task somebody would look for.' },
      {
        text: 'Re-run validation, then regenerate the docs so this page reflects it.',
        code: `npm run validate && npm run docs`,
      },
    ],
    why: "Scripts are the discoverable interface to the repository. A command that lives only in somebody's shell history is a command the next person re-invents, slightly differently.",
    gotchas: [
      "Do not upgrade zod to v4 without checking it loads under Playwright's transform; the failure is an obscure `core._string is not a function` at start-up.",
      'The `Dockerfile` pins the Playwright image to an exact version. Bumping `@playwright/test` without bumping that tag gives CI a different version from local.',
    ],
    related: ['playwright.config.ts', 'Makefile', 'Dockerfile', '.nvmrc'],
  },

  'playwright.config.ts': {
    group: 'root',
    purpose:
      'Decides how the suite runs: which groups of tests exist, what they share, how long they get, and what evidence a failure leaves. It does not decide what the suite talks to — that comes from `src/config`, which validates the environment before this file reads a value.',
    blocks: [
      { type: 'h3', text: 'Projects' },
      {
        type: 'p',
        text: 'A project is the unit of organisation: a group of tests with its own settings and its own place in the dependency order. That is what lets "log in once, then run everything else" be declarative rather than a global variable.',
      },
      {
        type: 'table',
        head: ['Project', 'Test directory', 'Settings that differ', 'Why'],
        rows: [
          [
            '`setup`',
            '`src/hooks/`',
            'Longer timeout',
            'Captures a session and writes it to `storage/`. Everything else depends on it.',
          ],
          ['`api`', '`tests/api/`', 'Defaults', 'The functional suite: REST, GraphQL, streaming.'],
          [
            '`contract`',
            '`tests/contract/`',
            'Shorter timeout',
            'A different question — conformance, not behaviour — usually on a different trigger. Runs offline against the stub server.',
          ],
          [
            '`performance`',
            '`tests/performance/`',
            '`workers: 1`, `retries: 0`, long timeout',
            'A percentile measured under eight parallel workers measures the load, not the endpoint.',
          ],
          [
            '`security`',
            '`tests/security/`',
            'Defaults',
            'Hostile payloads, kept separable so a pipeline can point them at a dedicated environment.',
          ],
        ],
      },
      { type: 'h3', text: 'Reporters' },
      {
        type: 'p',
        text: 'Six always, three conditionally. Each answers a different audience: `list` for the person watching, `html` for the person investigating, `junit`/`json`/`ctrf` for machines, and the custom summary for a pipeline gate.',
      },
      {
        type: 'code',
        caption: 'The conditional tail',
        text: `...(config.allure ? [['allure-playwright', { resultsDir: 'reports/allure-results' }]] : []),
...(process.env.GITHUB_ACTIONS ? [['github']] : []),
...(process.env.PW_BLOB_REPORT ? [['blob', { outputDir: 'blob-report' }]] : []),`,
      },
      {
        type: 'p',
        text: 'Allure is heavy, so it is opt-in. The GitHub reporter annotates a pull request and only makes sense inside Actions. Blob reports exist to be merged across shards and are noise otherwise.',
      },
      { type: 'h3', text: 'Execution settings worth understanding' },
      {
        type: 'table',
        head: ['Setting', 'Value', 'Reasoning'],
        rows: [
          [
            '`workers`',
            '8 in CI, 4 locally',
            "API tests are IO-bound, so more workers than cores is right. The ceiling exists because the target's rate limit — not this machine — is what a large suite saturates.",
          ],
          [
            '`retries`',
            '2 in CI, 0 locally',
            'Locally a flaky test should be visible immediately. In CI a retry separates a real failure from a blip — and the summary reporter counts anything that needed one as *flaky*, so retries cannot hide rot.',
          ],
          [
            '`forbidOnly`',
            'on in CI',
            'A `test.only` left in a branch would otherwise reduce CI to one test and still go green.',
          ],
          [
            '`fullyParallel`',
            'true',
            'Tests are independent by construction. If yours are not, fix the coupling rather than turning this off.',
          ],
          [
            '`trace`',
            'from `TRACE`, default `retain-on-failure`',
            'A trace records every request and response — usually enough to diagnose without re-running.',
          ],
          [
            '`maxFailures`',
            '50 in CI',
            'When fifty tests have failed, the environment is broken; the remaining thousand add nothing.',
          ],
        ],
      },
    ],
    changeWhen: [
      'You add a category of test that needs its own settings.',
      'You need a different reporter, or a different reporter configuration.',
      'The suite has grown enough that shard or worker counts need retuning.',
      'A whole-test or hook timeout is systematically wrong.',
    ],
    changeHow: [
      {
        text: 'Add a project, its test folder, and a script in `package.json`.',
        code: `{\n  name: 'smoke',\n  testDir: './tests/api',\n  grep: /@smoke/,\n  dependencies: ['setup'],\n  retries: 0,\n},`,
      },
      { text: 'Add a reporter to the array. Make anything heavy conditional.' },
      {
        text: 'Prefer changing a named budget in `src/config/timeouts.ts` over a literal here, so the reasoning stays in one place.',
      },
    ],
    why: 'This file is the run\'s contract with CI. Anything that changes how the suite executes — rather than what it talks to — belongs here, where a reviewer looking at "why did CI behave differently" will find it.',
    gotchas: [
      '`--reporter=` on the command line **replaces** this list. A run with `--reporter=list` produces no `summary.json`, no JUnit and no HTML report.',
      '`dependencies` makes a project wait for another. A cycle is a start-up error, not a hang.',
      'Per-project `workers` overrides the top-level value; that is how `performance` stays serial while everything else parallelises.',
    ],
    related: [
      'src/config/env.config.ts',
      'src/config/timeouts.ts',
      'src/reporters/summary.reporter.ts',
      'src/hooks/global.setup.ts',
    ],
  },

  'tsconfig.json': {
    group: 'root',
    purpose:
      "Compiler settings and path aliases. The strictness here is not decoration: several settings turn a class of run-time failure into a compile error, which in a test framework means a bug in the framework rather than a confusing failure in somebody's test.",
    blocks: [
      {
        type: 'table',
        head: ['Setting', 'Effect'],
        rows: [
          ['`strict`', 'The whole family — `strictNullChecks`, `noImplicitAny` and the rest.'],
          [
            '`noUncheckedIndexedAccess`',
            '`array[0]` is `T | undefined`. Verbose, and it prevents an entire class of "cannot read property of undefined" at run time.',
          ],
          [
            '`noImplicitOverride`',
            '`override` must be explicit, so a renamed base method cannot silently orphan a subclass.',
          ],
          [
            '`noUnusedLocals` / `noUnusedParameters`',
            'Dead code fails the build rather than accumulating.',
          ],
          [
            '`noFallthroughCasesInSwitch`',
            'The exhaustive switches over `BodyKind` stay exhaustive.',
          ],
          [
            '`isolatedModules`',
            'Every file must be transpilable alone — which is exactly how Playwright transpiles them.',
          ],
          [
            '`module: ESNext`, `moduleResolution: Bundler`',
            'Matches how Playwright resolves modules. Changing these breaks imports in ways the compiler will not warn about.',
          ],
        ],
      },
      { type: 'h3', text: 'Path aliases' },
      {
        type: 'code',
        caption: 'Available prefixes',
        text: `@config/*     @core/*      @auth/*
@contracts/*  @protocols/* @services/*
@fixtures/*   @utils/*     @mocks/*
@types/*      @data/*`,
      },
      {
        type: 'note',
        text: 'There is no `baseUrl`: TypeScript 6 deprecates it, and `paths` entries resolve relative to the config file without it.',
      },
    ],
    changeWhen: [
      'You add a top-level folder under `src/` and want an alias for it.',
      'The Node or TypeScript floor moves.',
    ],
    changeHow: [
      {
        text: 'Add the alias to `paths`, relative to this file.',
        code: `"@events/*": ["./src/events/*"]`,
      },
      { text: 'Confirm nothing regressed.', code: `npm run typecheck` },
    ],
    why: 'Aliases keep imports readable as the tree deepens; a file four levels down importing `../../../../core/http.client` is a file nobody wants to move.',
    gotchas: [
      'Loosening `strict` or `noUncheckedIndexedAccess` will make hundreds of latent problems compile. That is not the same as fixing them.',
      "Playwright does not read `paths` at run time from every context — the aliases work because Playwright's transform honours the config. Keep `module` and `moduleResolution` as they are.",
    ],
    related: ['eslint.config.mjs', 'package.json'],
  },

  'eslint.config.mjs': {
    group: 'root',
    purpose:
      'Type-aware linting. It uses the type checker rather than only the syntax tree, which is what allows rules like "this promise is never awaited" and "this template literal stringifies an object" to exist at all.',
    blocks: [
      { type: 'h3', text: 'Layers, in order' },
      {
        type: 'ol',
        items: [
          'Ignores — build output, reports, generated documentation.',
          '`js.configs.recommended`, then `strictTypeChecked` and `stylisticTypeChecked` from typescript-eslint.',
          'Project rules — explicit return types, `import type`, no `console` except `warn`/`error`, `eqeqeq`.',
          'A fixtures block that turns off `no-empty-pattern`.',
          'A tests block adding the Playwright plugin.',
          'A block disabling type-aware rules for `.mjs`, which has no `tsconfig` to check against.',
          '`eslint-config-prettier` **last**, so formatting rules never fight the formatter.',
        ],
      },
      { type: 'h3', text: 'Two documented exceptions' },
      {
        type: 'code',
        caption: 'Fixtures need an empty destructuring pattern',
        text: `// Playwright resolves a fixture's dependencies by reading its parameter
// destructuring, so a fixture with no dependencies must be \`async ({}, use)\`.
files: ['src/fixtures/**/*.ts'],
rules: { 'no-empty-pattern': 'off' },`,
      },
      {
        type: 'code',
        caption: 'Payload readers exist to be parameterised by the caller',
        text: `// The rule flags a type parameter used only in the return position — which
// is exactly the shape of \`response.json<User>()\`. Following it would replace
// the pattern with a cast at every call site.
'@typescript-eslint/no-unnecessary-type-parameters': 'off',`,
      },
      {
        type: 'p',
        text: 'Both are written this way on purpose: an exception with a reason beside it is an exception the next person can evaluate. An exception without one just gets copied.',
      },
    ],
    changeWhen: [
      'A rule is producing more noise than signal across the codebase.',
      'You add a folder that needs different rules — scripts, generated code.',
      'A new class of mistake is worth catching automatically.',
    ],
    changeHow: [
      {
        text: 'Add a scoped block rather than weakening the global config, so the exception stays visible.',
        code: `{\n  files: ['src/experimental/**/*.ts'],\n  rules: { '@typescript-eslint/no-unsafe-assignment': 'off' },\n},`,
      },
      { text: 'Always leave a comment saying why. Every existing exception has one.' },
      {
        text: 'Check the whole repository, not just the file you were looking at.',
        code: `npm run lint`,
      },
    ],
    why: 'Lint rules are the cheapest possible code review: they run before a human looks, they never get tired, and they are consistent. What they cost is judgement, which is why every exception carries its reasoning.',
    gotchas: [
      '`eslint-config-prettier` must stay last, or formatting rules will conflict with the formatter and produce an unfixable loop.',
      'Type-aware rules need `projectService: true`; without it they silently do nothing rather than erroring.',
      '`--max-warnings=0` means a warning fails CI. That is deliberate — warnings nobody must fix are warnings nobody reads.',
    ],
    related: ['tsconfig.json', '.prettierrc.json', 'package.json'],
  },

  '.env.example': {
    group: 'root',
    purpose:
      'The committed template for `.env`. In practice it is the primary documentation for configuring the suite, which is why every variable carries a comment rather than only a name.',
    blocks: [
      {
        type: 'table',
        head: ['Group', 'Variables', 'Notes'],
        rows: [
          [
            'Target',
            '`TEST_ENV`, `API_BASE_URL`, `GRAPHQL_URL`, `WS_URL`',
            '`TEST_ENV` selects an entry from `environments.ts`; the URLs override it',
          ],
          [
            'Credentials',
            '`API_KEY`, `*_USERNAME`, `*_PASSWORD`',
            'Reached only through `getUser(role)`',
          ],
          [
            'OAuth2',
            '`OAUTH_TOKEN_URL`, `OAUTH_CLIENT_ID`, `OAUTH_CLIENT_SECRET`, `OAUTH_SCOPE`',
            'Presence of a token URL is what selects OAuth as the default scheme',
          ],
          [
            'Signing',
            '`HMAC_KEY_ID`, `HMAC_SECRET`',
            'For APIs that require a per-request signature',
          ],
          [
            'Execution',
            '`API_TIMEOUT`, `RETRY_COUNT`, `WORKERS`, `TRACE`',
            'Tuning without editing code',
          ],
          [
            'Diagnostics',
            '`LOG_LEVEL`, `LOG_BODIES`',
            '`LOG_BODIES` is verbose and off by default',
          ],
          [
            'Policy',
            '`STRICT_CONTRACTS`, `STRICT_CONTENT_TYPE`, `LATENCY_BUDGET_MS`',
            '`STRICT_CONTRACTS` is on in CI, off locally',
          ],
          ['Tooling', '`MOCK_SERVER_PORT`, `ALLURE`', ''],
        ],
      },
      { type: 'h3', text: 'Layering' },
      {
        type: 'p',
        text: '`.env` is read first, then `.env.<TEST_ENV>` on top of it. Neither overrides a variable already exported in the shell, which is how CI injects secrets without touching a file.',
      },
      {
        type: 'code',
        caption: 'Precedence, weakest to strongest',
        text: `.env  →  .env.staging  →  shell environment  →  inline on the command line`,
      },
    ],
    changeWhen: [
      'You add a variable to the schema in `env.config.ts` — always add it here too.',
      'A default proves wrong for most people.',
      "A variable's purpose is not obvious from its name.",
    ],
    changeHow: [
      {
        text: 'Add the variable with a comment saying what it does and what values it accepts.',
        code: `# Reject responses whose Content-Type does not match what was requested.\nSTRICT_CONTENT_TYPE=true`,
      },
      { text: 'Add it to the Zod schema in `src/config/env.config.ts`, or it will be ignored.' },
      { text: 'Add it to the CI `env:` block if the pipeline needs it.' },
    ],
    why: 'This file is committed and `.env` is not, so it is the only place a new joiner can discover what is configurable. A variable that exists in the schema but not here is a variable nobody knows about.',
    gotchas: [
      'Never put a real value here. Placeholders and empty strings only — this file is in the repository.',
      'A variable added here but not to the schema is silently ignored, which looks exactly like a bug in the framework.',
    ],
    related: ['src/config/env.config.ts', '.gitignore', '.github/workflows/api-tests.yml'],
  },

  '.gitignore': {
    group: 'root',
    purpose:
      'Keeps generated output and — more importantly — live credentials out of the repository. Two entries here are security controls rather than housekeeping.',
    blocks: [
      {
        type: 'table',
        head: ['Pattern', 'Why'],
        rows: [
          [
            '`.env*` with `!.env.example`',
            '**Security.** Real configuration never enters the repository; the template does.',
          ],
          [
            '`storage/*.json`',
            '**Security.** Captured sessions and access tokens. Committing one is equivalent to committing a password.',
          ],
          [
            '`reports/`, `test-results/`, `blob-report/`',
            'Regenerated by every run; committing them creates conflicts on every branch.',
          ],
          [
            '`docs/generated/`, `docs/site/`',
            'Rebuilt by `npm run docs`. The PDF is committed; the site is not.',
          ],
          ['`node_modules/`', 'Reproduced from `package-lock.json`.'],
        ],
      },
    ],
    changeWhen: [
      'A tool starts writing output into the working tree.',
      'A new directory will hold credentials.',
    ],
    changeHow: [
      { text: 'Add the pattern with a comment explaining the category.' },
      {
        text: 'If the file was already tracked, ignoring it is not enough — untrack it, then rotate anything secret it contained.',
        code: `git rm --cached storage/session-staging.json`,
      },
    ],
    why: 'A `.gitignore` is the last line of defence against a credential leak, and it only works before the first commit of the file. Adding a directory here at the same time as the code that writes into it is the habit that keeps it working.',
    gotchas: [
      'Ignoring a file does not remove it from history. If a secret was committed, rotate it — deletion does not help.',
      'The `!.env.example` negation must come after the `.env*` pattern, or the template is ignored too.',
    ],
    related: ['.env.example', 'src/auth/token.store.ts'],
  },

  '.prettierrc.json': {
    group: 'root',
    purpose:
      'Formatting settings. Their value is not that they are the right settings — it is that nobody has to have an opinion about them again.',
    blocks: [
      {
        type: 'table',
        head: ['Setting', 'Value', 'Note'],
        rows: [
          [
            '`printWidth`',
            '100',
            'Wide enough for a fluent builder chain, narrow enough for a side-by-side diff',
          ],
          ['`singleQuote`', 'true', 'Matches the TypeScript ecosystem'],
          ['`trailingComma`', '`all`', 'A one-line diff when adding an argument, rather than two'],
          ['`endOfLine`', '`lf`', 'Stops Windows checkouts from reformatting every file'],
        ],
      },
    ],
    changeWhen: ['Essentially never, unless the team agrees to a different house style.'],
    changeHow: [
      {
        text: 'Change the setting, reformat everything in one commit, and keep that commit free of anything else.',
        code: `npm run format`,
      },
    ],
    why: 'A formatting change touches every file. Isolating it in its own commit is what keeps `git blame` useful afterwards.',
    gotchas: [
      'Reformatting mixed into a functional change makes the review impossible and the history worse.',
    ],
    related: ['.prettierignore', 'eslint.config.mjs'],
  },

  '.prettierignore': {
    group: 'root',
    purpose:
      'Files Prettier must not touch: generated output, and anything whose exact bytes matter.',
    changeWhen: ['A tool starts generating files that the formatter would rewrite.'],
    changeHow: [
      {
        text: 'Add the path. Keep it aligned with the ESLint ignore list, so the two tools agree on what is generated.',
      },
    ],
    why: 'Formatting generated output produces a diff on every build and tells you nothing.',
    gotchas: [
      "`docs/site/` and `docs/generated/` must be here as well as in ESLint's ignores; the two lists are maintained separately.",
    ],
    related: ['.prettierrc.json', 'eslint.config.mjs'],
  },

  '.editorconfig': {
    group: 'root',
    purpose:
      "Editor settings honoured by editors that never load the project's tooling — indentation, line endings, trailing whitespace, final newline.",
    changeWhen: [
      'A file type needs different handling. Markdown already does: trailing whitespace is significant there.',
    ],
    changeHow: [
      { text: 'Add a section for the glob.', code: `[*.md]\ntrim_trailing_whitespace = false` },
    ],
    why: 'It is the lowest common denominator: it works in an editor with no plugins, which is the situation somebody making a one-line fix on a strange machine is in.',
    related: ['.vscode/settings.json', '.prettierrc.json'],
  },

  '.nvmrc': {
    group: 'root',
    purpose:
      "Pins the Node version for `nvm` and for CI's `node-version-file`. Node 22 LTS — chosen because it is the first release with a stable global `WebSocket`, which is what lets the socket client have no dependency.",
    changeWhen: ['The team moves to a new LTS.'],
    changeHow: [
      {
        text: 'Update this file, the `engines` floor in `package.json`, and the `Dockerfile` base image together.',
      },
      {
        text: 'Verify on the new version before merging.',
        code: `nvm use && npm ci && npm run validate`,
      },
    ],
    why: 'One file that CI and every developer both read is what stops "works on my machine" from being about the runtime.',
    gotchas: [
      'Newer Node is usually fine, but two things here depend on version: global `WebSocket` (22+) and streaming `fetch`. Older Node will fail at run time, not at install.',
    ],
    related: ['package.json', 'Dockerfile', '.github/workflows/api-tests.yml'],
  },

  'docs/README.md': {
    group: 'docs-existing',
    purpose:
      'Explains what is in `docs/`: which files are generated, how to read them, how to rebuild them, and where to edit each part.',
    blocks: [
      {
        type: 'p',
        text: 'Only the PDF is committed. The HTML site and the extracted API surface are rebuilt on demand, because a generated site in version control produces a diff on every build that tells nobody anything.',
      },
    ],
    changeWhen: [
      'The generator gains an output.',
      'The editing table stops matching the content modules.',
    ],
    changeHow: [
      {
        text: 'Update the tables. Keep it short — it is a signpost, not documentation of the documentation.',
      },
    ],
    why: 'Somebody who opens `docs/` and sees generated HTML needs to be told, immediately, not to edit it. This is that notice.',
    related: ['scripts/docs/build-docs.mjs', 'scripts/docs/content/'],
  },

  'README.md': {
    group: 'docs-existing',
    purpose:
      "The repository's front door: what the framework is, how to start it, what is in it, and where the full documentation lives. Written for somebody who has just cloned it and has five minutes.",
    changeWhen: [
      'The quick-start steps change.',
      'A capability is added that belongs in the summary table.',
      'The security rules change.',
    ],
    changeHow: [
      {
        text: "Keep it short. Depth belongs in this generated documentation; the README's job is to get somebody running and then point them here.",
      },
      { text: 'Update the capability table if you added a layer.' },
    ],
    why: 'It is the only documentation some people will read, and the first documentation everybody reads. It should answer "what is this and how do I run it" before anything else.',
    related: ['docs/', 'tests/README.md'],
  },
};
