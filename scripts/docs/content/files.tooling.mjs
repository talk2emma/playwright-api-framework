/** CI, containers, editor settings, and the documentation generator itself. */
export default {
  Dockerfile: {
    group: 'tooling',
    purpose:
      'Builds the image the suite runs in, so a local run and a CI run execute against the same runtime rather than two similar ones.',
    blocks: [
      {
        type: 'code',
        lang: 'docker',
        caption: 'The shape',
        text: `FROM mcr.microsoft.com/playwright:v1.62.1-jammy
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .`,
      },
      {
        type: 'p',
        text: 'Two details do the work. The tag is **pinned to an exact Playwright version** — an unpinned tag means the image changes silently, and the first symptom is a failure nobody can reproduce. And dependencies are installed before the source is copied, so editing a test does not invalidate the slow install layer.',
      },
      {
        type: 'note',
        text: 'API tests need no browser, but the image ships one and `build-pdf.mjs` uses it to render the documentation — so the docs build needs nothing extra installed.',
      },
    ],
    changeWhen: [
      'The Playwright version changes — the tag must move with it.',
      'The suite needs a system package.',
    ],
    changeHow: [
      {
        text: 'Bump the tag to match `@playwright/test` in `package.json`.',
        code: `FROM mcr.microsoft.com/playwright:v1.63.0-jammy`,
      },
      { text: 'Add system packages in one `RUN` layer, before the `COPY` of the source.' },
      { text: 'Verify.', code: `docker compose run --rm api-tests --project=contract` },
    ],
    why: 'The image is where "works on my machine" is settled. Pinning it is what makes a CI failure reproducible locally.',
    gotchas: [
      'A version mismatch between the image tag and the npm package produces confusing errors — Playwright checks that the driver and the library agree.',
      'Copying source before installing dependencies rebuilds the install layer on every edit and makes local iteration painfully slow.',
    ],
    related: ['docker-compose.yml', 'package.json', '.github/workflows/api-tests.yml'],
  },

  'docker-compose.yml': {
    group: 'tooling',
    purpose:
      'Two ready-made containerised runs: the full suite against a real environment, and the contract suite against the built-in stub server with no network at all.',
    blocks: [
      {
        type: 'table',
        head: ['Service', 'Runs', 'Needs'],
        rows: [
          ['`api-tests`', 'Everything', 'Credentials passed through from the host or the runner'],
          [
            '`contract-tests`',
            '`--project=contract` with `TEST_ENV=mock`',
            'Nothing — no environment, no secrets',
          ],
        ],
      },
      {
        type: 'p',
        text: 'Secrets are passed through with `${VAR:-}` rather than written into the image, so nothing credential-shaped is ever baked into a layer. Reports are mounted back to the host, so a failed containerised run leaves the same evidence a local run would.',
      },
    ],
    changeWhen: [
      'The suite needs a companion service — a database, a WireMock instance.',
      'A new secret must reach the container.',
    ],
    changeHow: [
      {
        text: 'Add the variable to the `environment` block using the pass-through form, so an unset value is empty rather than a startup error.',
        code: `TENANT_ID: \${TENANT_ID:-}`,
      },
      {
        text: 'Add a companion service and let the tests reach it by service name.',
        code: `services:\n  wiremock:\n    image: wiremock/wiremock:3.9.1\n    ports: ['8080:8080']`,
      },
    ],
    why: "The `contract-tests` service is the one that matters most: it proves the suite can run somewhere with no access to any real environment, which is what makes it usable on a fork's pull request.",
    gotchas: [
      'Never write a literal secret here. The file is committed.',
      "`network_mode: host` is what lets the container reach a service on the developer's own machine; on macOS it behaves differently from Linux.",
    ],
    related: ['Dockerfile', '.env.example', 'src/mocks/mock.server.ts'],
  },

  Makefile: {
    group: 'tooling',
    purpose:
      'Discoverable shortcuts. `make` on its own prints every target with its description, which is the point: a task nobody can find is a task nobody runs.',
    blocks: [
      {
        type: 'code',
        lang: 'shell',
        caption: 'The self-documenting trick',
        text: `help:
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-16s %s\\n", $$1, $$2}'`,
      },
      {
        type: 'p',
        text: 'Every target carries a `## description` comment, and `help` reads them out of this file. Adding a target with a comment adds it to the help automatically.',
      },
    ],
    changeWhen: ['You add a script to `package.json` that somebody would look for by name.'],
    changeHow: [
      {
        text: 'Add the target, its `.PHONY` entry, and a `##` description.',
        code: `orders: ## Run the orders suite\n\tnpm run test:orders`,
      },
      { text: 'Check it appears.', code: `make` },
    ],
    why: 'The Makefile and `package.json` scripts serve different habits — some people type `make`, some type `npm run`. Keeping them aligned costs one line and removes a whole category of "how do I run…" questions.',
    gotchas: [
      'Recipes must be indented with a real tab. A space-indented recipe fails with `missing separator`, which is not a helpful message.',
    ],
    related: ['package.json'],
  },

  '.github/actions/setup/action.yml': {
    group: 'tooling',
    purpose:
      'Node, dependencies and browsers, in the one place every job shares. A composite action so the setup block is written once rather than copied into all five jobs.',
    blocks: [
      {
        type: 'p',
        text: 'This exists because installing dominated the pipeline. On one measured run `npm ci` took 421 seconds per job while the tests took 8 — installation was 97% of the wall time, and the suite it was there to run was a rounding error.',
      },
      {
        type: 'p',
        text: 'The npm cache was already hitting, so the cost was not fetching tarballs. It was npm rebuilding `node_modules` from them, plus an audit round-trip that every parallel job made at once. The contention shows in the spread: one shard installed in 23 seconds and the others took seven minutes for identical work.',
      },
      { type: 'h3', text: 'What it does' },
      {
        type: 'table',
        head: ['Step', 'Why'],
        rows: [
          [
            'Restore `node_modules`',
            'Keyed on `.nvmrc` + `package-lock.json`. A hit skips installation entirely and costs about as long as untarring the directory.',
          ],
          [
            'Install on a miss only',
            '`--prefer-offline --no-audit --fund=false` removes two registry round-trips; `timeout 300` bounds it so a stall fails loudly rather than silently.',
          ],
          [
            'Restore browsers',
            'Only when the `browsers` input is set. Keyed on the lockfile, because that is what pins the Playwright version the binaries belong to.',
          ],
          [
            '`install-deps` always',
            'The apt packages are not cached — every job starts on a clean runner — so the system libraries are installed even on a cache hit.',
          ],
        ],
      },
      {
        type: 'note',
        text: 'The job graph is what makes the cache pay: the first job has no dependencies and every other job declares `needs` on it, so the cache is populated before anything else starts. Removing that ordering would put every job back to a cold install.',
      },
    ],
    changeWhen: ['A job needs a browser it currently does not.', 'Installation gets slow again.'],
    changeHow: [
      {
        text: 'Pass the browser through the `browsers` input rather than adding a `playwright install` step to the job. A step outside this action gets no caching.',
        code: `- uses: ./.github/actions/setup
  with:
    browsers: chromium`,
      },
      {
        text: 'If a cache key ever needs to change, change it here once. The key deliberately hashes the lockfile and nothing else about the source, so editing a test never invalidates the dependency cache.',
      },
    ],
    why: 'Five copies of a setup block drift apart. One that every job calls means a caching change is made once and is either right everywhere or wrong everywhere — which is the easier of the two to notice.',
    related: ['.github/workflows/api-tests.yml', 'package.json'],
  },

  '.github/workflows/api-tests.yml': {
    group: 'tooling',
    purpose:
      'The pipeline: cheap checks first, then the suite split across four shards, then a job that merges the shard reports into one readable result — plus an offline contract job and a documentation build.',
    blocks: [
      { type: 'h3', text: 'Jobs' },
      {
        type: 'table',
        head: ['Job', 'Depends on', 'Purpose'],
        rows: [
          [
            '`quality`',
            '—',
            '`npm run validate`. Fails in under a minute, before anything touches a network.',
          ],
          [
            '`test`',
            '`quality`',
            'The suite in a 4-way shard matrix, each shard emitting a blob report.',
          ],
          [
            '`merge-reports`',
            '`test` (`if: always()`)',
            'One HTML report from four shards. Runs even when a shard failed — especially then.',
          ],
          [
            '`contract`',
            '`quality`',
            'Contract tests against the stub server. No secrets, so it runs on forks too.',
          ],
          [
            '`docs`',
            '`quality`',
            'Rebuilds this documentation. Fails when a source file has no entry.',
          ],
        ],
      },
      { type: 'h3', text: 'Triggers' },
      {
        type: 'ul',
        items: [
          'Push to `main` and every pull request.',
          'Nightly at 03:00 — catches drift in the target that no branch touched.',
          'Manual, with an environment picker.',
        ],
      },
      { type: 'h3', text: 'Secrets' },
      {
        type: 'code',
        lang: 'yaml',
        caption: 'Injected per step, never written to a file',
        text: `env:
  API_BASE_URL: \${{ secrets.API_BASE_URL }}
  OAUTH_CLIENT_SECRET: \${{ secrets.OAUTH_CLIENT_SECRET }}
  STRICT_CONTRACTS: 'true'`,
      },
      {
        type: 'p',
        text: '`STRICT_CONTRACTS` is forced on here and left off locally: a work-in-progress schema should not block a developer, but contract drift must not reach `main`.',
      },
    ],
    changeWhen: [
      'The suite outgrows four shards.',
      'A new project should run on a different trigger.',
      'A new secret is needed.',
    ],
    changeHow: [
      {
        text: 'Change the shard count in **both** places — the matrix and the `--shard` argument. They are separate values and a mismatch silently skips tests.',
        code: `matrix:\n  shard: [1, 2, 3, 4, 5, 6]\n# …\nrun: npx playwright test --shard=\${{ matrix.shard }}/6`,
      },
      { text: 'Add the secret in the repository settings, then reference it in the `env:` block.' },
      {
        text: 'Keep `if: always()` on artefact uploads. The report of a failed run is the one worth having.',
      },
    ],
    why: "Sharding is what keeps a large suite inside a reviewer's attention span; merging is what keeps the result readable. Doing one without the other gives you either a slow pipeline or four partial reports.",
    gotchas: [
      'A shard-count mismatch between the matrix and the `--shard` flag means some tests never run, and nothing reports it.',
      "`concurrency` cancels superseded runs on the same ref — intended, but it means a re-push loses the in-flight run's report.",
      'Secrets are unavailable to workflows triggered from a fork. That is why the `contract` job needs none.',
    ],
    related: ['package.json', '.nvmrc', 'src/reporters/summary.reporter.ts'],
  },

  '.vscode/settings.json': {
    group: 'tooling',
    purpose:
      'Shared editor behaviour: format on save, ESLint autofix, the workspace TypeScript version, and hiding generated folders from search.',
    changeWhen: [
      'A generated folder starts polluting search results.',
      'A new file type needs a formatter mapping.',
    ],
    changeHow: [
      {
        text: 'Add the path to `files.exclude` and `search.exclude`, and keep it aligned with `.gitignore`.',
      },
    ],
    why: '`typescript.tsdk` matters more than it looks: without it, the editor uses its bundled TypeScript, which can be a different version from the one the build uses — so the editor and CI disagree about whether the code compiles.',
    gotchas: [
      'These settings only apply to people who accept the workspace TypeScript version; the editor prompts once and remembers.',
    ],
    related: ['.vscode/extensions.json', '.editorconfig', 'tsconfig.json'],
  },

  '.vscode/extensions.json': {
    group: 'tooling',
    purpose:
      'Recommended extensions, offered to anybody who opens the repository. Playwright, ESLint, Prettier, EditorConfig and an HTTP client for exploring an endpoint by hand.',
    changeWhen: ['The team adopts a tool with useful editor integration.'],
    changeHow: [
      {
        text: 'Add its marketplace identifier. Keep the list short — a long list of recommendations is ignored wholesale.',
      },
    ],
    why: 'The Playwright extension runs a single test from the gutter and opens traces inline, which is the fastest debugging loop available. It is worth recommending explicitly.',
    related: ['.vscode/settings.json'],
  },

  '.vscode/launch.json': {
    group: 'tooling',
    purpose:
      'Two debug configurations: the current spec with breakpoints, and the whole suite serially. Both set `LOG_LEVEL=debug`, and the single-spec one also sets `LOG_BODIES=true` and disables the timeout.',
    changeWhen: ['A new debugging scenario comes up repeatedly.'],
    changeHow: [
      {
        text: "Add a configuration. Point `program` at Playwright's CLI rather than at `npx`, so breakpoints bind.",
        code: `"program": "\${workspaceFolder}/node_modules/@playwright/test/cli.js",\n"args": ["test", "\${relativeFile}", "--workers=1", "--timeout=0"]`,
      },
    ],
    why: '`--timeout=0` is the important part: without it, a test times out while you are sitting on a breakpoint, and the debugging session ends underneath you.',
    gotchas: [
      '`--workers=1` is required. Multiple workers means multiple processes, and the debugger attaches to one of them.',
    ],
    related: ['.vscode/settings.json', 'src/utils/logger.ts'],
  },

  /* ---------------------------------------------------------------- */
  /* Documentation generator                                           */
  /* ---------------------------------------------------------------- */

  'scripts/docs/extract-api.mjs': {
    group: 'docs-tooling',
    purpose:
      'Reads the TypeScript source with the compiler API and writes `docs/generated/api.json`: every exported class, function, interface, type and constant, with its signature and its JSDoc summary.',
    blocks: [
      {
        type: 'p',
        text: 'The reason it uses the compiler rather than a regular expression is that the extracted surface is then *the code itself*. A signature in this documentation cannot be out of date, because nobody typed it.',
      },
      {
        type: 'code',
        caption: 'What it produces per file',
        text: `{
  "path": "src/core/api.response.ts",
  "bytes": 18422,
  "lines": 512,
  "exports": [
    {
      "kind": "class",
      "name": "ApiResponse",
      "doc": "A completed HTTP exchange…",
      "members": [{ "kind": "method", "name": "expectStatus", "signature": "expectStatus(...codes: number[]): this", "doc": "…" }],
      "privateCount": 4
    }
  ]
}`,
      },
      {
        type: 'p',
        text: 'Private and protected members are counted but not listed: they are not part of the contract, and listing them would suggest they are.',
      },
    ],
    changeWhen: [
      'A TypeScript construct is being missed — an enum, a namespace, a re-export form.',
      'You want more detail per member, such as parameter documentation.',
    ],
    changeHow: [
      {
        text: 'Add a branch in the statement walk, matching the AST node kind.',
        code: `else if (ts.isEnumDeclaration(node) && isExported(node)) {\n  entry.exports.push({ kind: 'enum', name: node.name.getText(source), doc: jsdoc(node, source) });\n}`,
      },
      {
        text: 'Add the rendering for the new kind in `render.mjs` and a badge style in both stylesheets.',
      },
      { text: 'Regenerate and check the count moved.', code: `npm run docs:api` },
    ],
    why: 'Hand-written API documentation is wrong within a month. Extracted documentation is wrong only if the extractor is wrong, and the extractor is one file.',
    gotchas: [
      'It reads the AST, not the type checker, so an inferred return type appears as absent. That is why exported functions are required to annotate theirs.',
      'The walker skips `node_modules`, `.git`, `dist`, `reports`, `test-results` and `.husky`. A new generated directory needs adding, or it will be treated as undocumented source.',
    ],
    related: ['scripts/docs/build-docs.mjs', 'scripts/docs/render.mjs'],
  },

  'scripts/docs/render.mjs': {
    group: 'docs-tooling',
    purpose:
      'Turns content blocks and extracted API entries into HTML. Shared by the multi-page site, the print sheet and the hosted manual, so all three are generated from one source and cannot disagree.',
    blocks: [
      { type: 'h3', text: 'Block types' },
      {
        type: 'table',
        head: ['Type', 'Renders'],
        rows: [
          ['`h2`, `h3`, `p`', 'Headings with slugged ids, and paragraphs with inline markup'],
          ['`ul`, `ol`', 'Lists'],
          ['`code`', 'A syntax-highlighted figure with a caption and a language chip'],
          ['`note`, `warn`, `rule`', 'Callouts, each with its own colour band'],
          ['`table`', 'A table inside its own horizontally scrolling container'],
          ['`steps`', 'A numbered procedure, each step optionally carrying code'],
          ['`tree`', 'Pre-formatted, deliberately unhighlighted — for directory diagrams'],
        ],
      },
      {
        type: 'p',
        text: 'Inline markup supports `` `code` ``, `**bold**` and `[text](href)`. Everything is escaped first, so content can contain angle brackets safely.',
      },
      { type: 'h3', text: 'Where highlighting is applied' },
      {
        type: 'p',
        text: 'Not only in code blocks: step snippets, API member signatures, interface shapes and type definitions all go through the highlighter, so a signature in a reference table reads with its parameters and return type distinguished.',
      },
    ],
    changeWhen: [
      'You need a block type that does not exist.',
      'The rendering of a file entry or an API item should change.',
    ],
    changeHow: [
      {
        text: 'Add a case to `renderBlock`. The `default` branch throws, so a typo in a block type fails the build rather than silently rendering nothing.',
        code: `case 'diagram':\n  return \`<figure class="diagram">\${esc(block.text)}</figure>\`;`,
      },
      {
        text: 'Add the styles to **both** `docs.css` and `artifact.css`. They are separate files on purpose — the two outputs have different layouts.',
      },
    ],
    why: 'One renderer for three outputs is what guarantees the PDF, the site and the hosted manual say the same thing. Three renderers would drift within a release.',
    gotchas: [
      '`inline()` escapes before applying markup, so raw HTML in content is shown rather than rendered. That is intentional.',
      'A new block type needs styles in both stylesheets, or it will look correct in one output and unstyled in the other.',
    ],
    related: ['scripts/docs/highlight.mjs', 'scripts/docs/build-docs.mjs', 'scripts/docs/docs.css'],
  },

  'scripts/docs/highlight.mjs': {
    group: 'docs-tooling',
    purpose:
      'Build-time syntax highlighting for eight languages. It emits `<span class="tok-*">` markup; the colours live in the stylesheets, which is what lets each output theme the same tokens differently.',
    blocks: [
      {
        type: 'p',
        text: 'Highlighting happens during the build rather than in the browser. That is the only approach that works here: a browser-side highlighter cannot colour the PDF at all, and would add a CDN dependency to pages meant to open offline.',
      },
      {
        type: 'table',
        head: ['Language', 'Detected by'],
        rows: [
          ['TypeScript', 'The fallback — anything not matched by another rule'],
          ['HTTP', 'A request line or a status line'],
          ['GraphQL', 'An operation or fragment keyword followed by a selection set'],
          ['Dockerfile', 'An instruction keyword at the start of a line'],
          ['JSON', 'Quoted keys with no JavaScript syntax'],
          ['Env', '`KEY=value` lines with no shell command'],
          ['Shell', 'A known command at the start of a line'],
          ['YAML', '`key:` lines with no statement punctuation'],
        ],
      },
      { type: 'h3', text: 'The subtle case' },
      {
        type: 'code',
        caption: 'Why LOOKS_LIKE_CODE exists',
        text: `const LOOKS_LIKE_CODE =
  /=>|\\b(?:const|let|var|function|await|async|import|export|class|interface|extends|return|new|this)\\b|[;,]\\s*$/m;`,
      },
      {
        type: 'p',
        text: 'A TypeScript object property such as `maxUploadMb: raw.MAX_UPLOAD_MB,` is indistinguishable from a YAML key by shape alone. Statement punctuation and JavaScript keywords separate them. The YAML detector also has to *allow* braces, because GitHub Actions files are full of `${{ }}`.',
      },
      { type: 'h3', text: 'Token classes' },
      {
        type: 'table',
        head: ['Class', 'Token'],
        rows: [
          ['`tok-c`', 'comment'],
          ['`tok-k`', 'keyword'],
          ['`tok-s`', 'string'],
          ['`tok-n`', 'number'],
          ['`tok-f`', 'function or field'],
          ['`tok-t`', 'type'],
          ['`tok-p`', 'property or header name'],
          ['`tok-o`', 'operator or punctuation'],
          ['`tok-v`', 'variable'],
          ['`tok-r`', 'regular expression'],
          ['`tok-a`', 'flag or directive'],
        ],
      },
      {
        type: 'p',
        text: 'Each lexer is a single master pattern with named groups, scanned once. One pass avoids the double-escaping bugs that come from highlighting already-escaped HTML.',
      },
    ],
    changeWhen: [
      'A snippet is detected as the wrong language.',
      'A language needs adding.',
      'A token is not coloured.',
    ],
    changeHow: [
      {
        text: 'Confirm what is actually being detected before changing anything.',
        code: `node -e "import('./scripts/docs/highlight.mjs').then(m => console.log(m.detectLanguage('…')))"`,
      },
      {
        text: 'To add a language: write the master pattern, write the lexer, register it in `LEXERS`, add a label to `LANGUAGE_LABEL`, and add a detection rule ordered before the fallbacks.',
      },
      {
        text: 'Override detection per block when a snippet is genuinely ambiguous.',
        code: `{ type: 'code', lang: 'graphql', text: '…' }`,
      },
      {
        text: 'Add token colours to **all** palettes: `:root`, the dark media query and `body.print` in `docs.css`; `:root`, the media query and `[data-theme="dark"]` in `artifact.css`.',
      },
    ],
    why: 'Colour is not decoration in a document that is mostly code. It is what lets a reader find the string, the type and the comment without reading every character — and it has to work in print, which rules out doing it in the browser.',
    gotchas: [
      'Detection order matters. HTTP and GraphQL are checked before the `key:` heuristics, or a header line would be read as YAML.',
      'A colour defined only inside a media query never applies in the un-stamped default state. Every token needs a value on bare `:root`.',
      'The print palette is separate and deliberately darker; a colour that reads well on screen can be invisible on paper.',
    ],
    related: ['scripts/docs/render.mjs', 'scripts/docs/docs.css', 'scripts/docs/artifact.css'],
  },

  'scripts/docs/build-docs.mjs': {
    group: 'docs-tooling',
    purpose:
      'Assembles the site. It merges the authored content with the extracted API surface, **fails the build when a repository file has no documentation entry**, and emits fourteen pages plus a single-page print sheet and the hosted manual.',
    blocks: [
      { type: 'h3', text: 'The completeness gate' },
      {
        type: 'code',
        caption: 'Why this documentation cannot drift',
        text: `const collective = Object.keys(FILE_DOCS).filter((f) => f.endsWith('/'));
const coveredCollectively = (file) => collective.some((dir) => file.startsWith(dir));

const undocumented = repoFiles.filter((f) => !FILE_DOCS[f] && !coveredCollectively(f));
if (undocumented.length) process.exit(1);`,
      },
      {
        type: 'p',
        text: 'It also fails in the other direction: an entry for a file that no longer exists is an error too, so deleting a file forces its documentation to be deleted with it. A key ending in `/` covers everything beneath it, for directories documented as a group.',
      },
      { type: 'h3', text: 'Outputs' },
      {
        type: 'table',
        head: ['File', 'What it is'],
        rows: [
          [
            '`docs/site/<page>.html`',
            'Fourteen standalone pages with a sidebar, an on-this-page index and a pager',
          ],
          [
            '`docs/site/print.html`',
            "Everything in one document, with a cover and a contents page — the PDF's source",
          ],
          [
            '`docs/site/artifact.html`',
            'The hosted manual: numbered rail, cross-document search, theme toggle, chapter switching',
          ],
        ],
      },
      { type: 'h3', text: 'Generated pages' },
      {
        type: 'p',
        text: 'Two pages have no authored prose. **Project structure** is built from the group of every documented file, and **API index** is built from every extracted export, filterable, each linked to its definition.',
      },
    ],
    changeWhen: [
      'You add a source file — the build will tell you.',
      'You want a new page, or a different grouping of the reference pages.',
      'The hosted manual needs different behaviour.',
    ],
    changeHow: [
      {
        text: 'Add the entry in the right `scripts/docs/content/files.*.mjs`, keyed by the repository-relative path, with a `group`.',
      },
      {
        text: 'Add a page by adding prose to `guides.mjs` and an entry to `PAGES`.',
        code: `{ id: 'migration', title: 'Migration', subtitle: 'Moving an existing suite onto this framework', blocks: guides.migration },`,
      },
      {
        text: "Add a group by adding it to `GROUP_TITLES` and to a page's `groups` array. A group in neither is silently invisible.",
      },
      { text: 'Rebuild.', code: `npm run docs` },
    ],
    why: 'The gate is what makes this document trustworthy. Documentation that *may* be complete is documentation nobody relies on; documentation that cannot build unless it is complete is documentation people use.',
    gotchas: [
      'Keys are repository-relative paths and must match exactly — `src/core/http.client.ts`, not `./src/core/http.client.ts`.',
      "A group present in `GROUP_TITLES` but absent from every page's `groups` renders nowhere, with no warning.",
      '`.husky/` is excluded from extraction, so the hooks are documented in the `package.json` entry rather than as files of their own.',
    ],
    related: ['scripts/docs/content/', 'scripts/docs/render.mjs', 'scripts/docs/build-pdf.mjs'],
  },

  'scripts/docs/build-pdf.mjs': {
    group: 'docs-tooling',
    purpose:
      'Renders `print.html` to PDF using the Chromium that ships with Playwright, so the PDF and the HTML cannot diverge — they are the same document, printed.',
    blocks: [
      {
        type: 'code',
        caption: 'The step that is easy to forget',
        text: `// Expand every collapsed API section so nothing is missing from the printed copy.
await page.evaluate(() => {
  document.querySelectorAll('details').forEach((element) => element.setAttribute('open', ''));
});
await page.emulateMedia({ media: 'print' });`,
      },
      {
        type: 'p',
        text: 'A `<details>` element that is closed when the page is printed simply is not in the PDF. Opening them all first is what makes the printed API reference complete.',
      },
      {
        type: 'p',
        text: 'The output is A4 with running headers and footers, `printBackground: true` so the callout and code backgrounds survive, and a copy placed in `docs/site/` so the download link works from the local site.',
      },
    ],
    changeWhen: [
      'The page size, margins or running heads should change.',
      'The PDF is missing content that is on the site.',
    ],
    changeHow: [
      {
        text: 'Change the format or margins in the `page.pdf()` call.',
        code: `format: 'Letter', margin: { top: '18mm', bottom: '18mm', left: '16mm', right: '16mm' }`,
      },
      {
        text: 'If content is missing, look for something collapsed or hidden by CSS — the `@media print` and `body.print` rules in `docs.css` are the usual cause.',
      },
    ],
    why: 'Using the browser that already ships with the framework means no second rendering engine to install, and a PDF that matches what the site shows, character for character.',
    gotchas: [
      'It needs Chromium: `npx playwright install chromium`. The CI docs job does that explicitly.',
      'Page breaks are controlled from `docs.css`. `page-break-inside: avoid` on a large block leaves big blank gaps and inflates the page count — which is why `.file` deliberately does not use it.',
    ],
    related: ['scripts/docs/build-docs.mjs', 'scripts/docs/docs.css'],
  },

  'scripts/docs/docs.css': {
    group: 'docs-tooling',
    purpose:
      'The stylesheet for the local site and the print sheet. Inlined into every page, so the documentation opens from a `file://` URL with no network — a reference nobody can read offline is a reference nobody reads.',
    blocks: [
      {
        type: 'p',
        text: 'The identity is an instrument panel: the subject is wire protocols, so the page is organised like a trace — monospace structural labels, one teal signal colour, and semantic bands reserved for things that actually have a status. System font stacks throughout, because a web font would be the one thing on the page that needs a network.',
      },
      { type: 'h3', text: 'Three palettes' },
      {
        type: 'table',
        head: ['Selector', 'Applies to'],
        rows: [
          ['`:root`', 'The complete light palette. Every token has a value here.'],
          [
            "`@media (prefers-color-scheme: dark)` under `:root:not([data-theme='light'])`",
            'Dark mode, tokens only',
          ],
          [
            '`body.print`',
            'The print sheet: ink-safe colours pinned so the dark media query cannot reach a printer',
          ],
        ],
      },
      {
        type: 'warn',
        text: "Never give a colour its only definition inside a media query. The un-stamped default state would then have no value for it, and the page renders one theme's text on the other theme's ground.",
      },
    ],
    changeWhen: [
      'A new block type needs styling.',
      'The palette or type scale should change.',
      'The PDF has layout problems.',
    ],
    changeHow: [
      {
        text: 'Change a token rather than a rule wherever possible — the token is defined in three places and the rule in one.',
      },
      {
        text: 'For a PDF problem, work in `body.print` and the `@media print` block. Reproduce it with `npm run docs:pdf` rather than by guessing.',
      },
      { text: 'Mirror any structural addition into `artifact.css`.' },
    ],
    why: 'Inlining the CSS is what makes a page a genuinely self-contained artefact: one file that can be emailed, archived or opened on a machine with no network and still look right.',
    gotchas: [
      '`body.print` re-declares the palette rather than inheriting it. A new token added to `:root` needs a print value too, or it falls back to the dark palette on paper.',
      'Page-break rules interact badly with large blocks; see the comment on `.file`.',
    ],
    related: [
      'scripts/docs/artifact.css',
      'scripts/docs/build-docs.mjs',
      'scripts/docs/highlight.mjs',
    ],
  },

  'scripts/docs/artifact.css': {
    group: 'docs-tooling',
    purpose:
      'The stylesheet for the hosted single-page manual. Same identity as the offline site, executed for a screen: a permanent dark rail that reads as an instrument panel, a paper reading column beside it, and real typefaces instead of the system stack the offline copy has to settle for.',
    blocks: [
      { type: 'h3', text: 'Type' },
      {
        type: 'table',
        head: ['Role', 'Face', 'Why'],
        rows: [
          [
            'Display',
            'Chivo',
            'A sturdy grotesque that holds up at large sizes without the geometric sameness of the usual choices',
          ],
          ['Body', 'Source Sans 3', 'Humanist, highly legible at length, and not Inter'],
          [
            'Mono',
            'JetBrains Mono',
            'Designed for code, with a large x-height that survives being set small in a table',
          ],
        ],
      },
      { type: 'h3', text: 'Three theme states, not two' },
      {
        type: 'p',
        text: "An explicit choice stamps `data-theme` on the root; the default \"system\" setting stamps nothing. So the palette is defined three times: on bare `:root`, inside the media query guarded as `:root:not([data-theme='light'])`, and again on `:root[data-theme='dark']` so the toggle wins in both directions.",
      },
      {
        type: 'p',
        text: 'The rail keeps its own dark palette in both themes. That is a deliberate commitment: chrome that flips with the content makes the page feel unanchored, and the rail is chrome.',
      },
    ],
    changeWhen: ['The hosted manual gains a component.', 'The palette or typefaces should change.'],
    changeHow: [
      { text: "Add the component's styles here and mirror the structure in `docs.css`." },
      {
        text: 'When adding a colour, add it to all three theme blocks. Then check both themes before publishing.',
      },
    ],
    why: 'The hosted manual is read on a screen, often on a phone, often by somebody who was sent a link. It can afford web fonts and interaction that the offline copy cannot, and it should use them.',
    gotchas: [
      "`body` must set an explicit background from a token. A transparent body borrows the host page's ground and one theme becomes unreadable.",
      'Only the CDN allowlist is reachable. Google Fonts works; other font hosts fail silently and fall back.',
    ],
    related: ['scripts/docs/docs.css', 'scripts/docs/build-docs.mjs'],
  },

  'scripts/docs/content/': {
    group: 'docs-tooling',
    purpose:
      'The authored prose, split across one guides module and six file modules. This is the half of the documentation that no extractor could produce: the reasoning, the trade-offs, and the "why here rather than there".',
    blocks: [
      {
        type: 'table',
        head: ['Module', 'Covers'],
        rows: [
          [
            '`guides.mjs`',
            'Overview, architecture, playbooks, conventions, troubleshooting, glossary',
          ],
          ['`files.root.mjs`', 'Root configuration and the README'],
          ['`files.tooling.mjs`', 'CI, containers, editor settings, and this generator'],
          ['`files.foundation.mjs`', '`src/config`, `src/core`, `src/types`'],
          ['`files.auth.mjs`', '`src/auth`, `src/contracts`'],
          ['`files.protocols.mjs`', '`src/protocols`, `src/services`, `src/fixtures`, `src/hooks`'],
          ['`files.utils.mjs`', '`src/utils`'],
          ['`files.support.mjs`', '`src/mocks`, `src/reporters`, `src/data`, the tests folder'],
        ],
      },
      { type: 'h3', text: 'The shape of a file entry' },
      {
        type: 'code',
        caption: 'Every field earns its place',
        text: `'src/core/http.client.ts': {
  group: 'core',
  purpose: 'One sentence: what it is for and why it exists.',
  blocks: [ /* optional: tables, code, callouts */ ],
  changeWhen: ['The situations that bring somebody to this file'],
  changeHow: [{ text: 'A step', code: 'the code for it' }],
  why: 'Why this change belongs in this file rather than somewhere else.',
  gotchas: ['What bites people'],
  related: ['neighbouring files'],
}`,
      },
      {
        type: 'p',
        text: '`purpose`, `changeWhen`, `changeHow` and `why` together answer the question the reader actually has: *I need to change something — where do I go, what do I do, and why there?*',
      },
    ],
    changeWhen: [
      'You add or change a source file.',
      'A gotcha bites somebody twice — write it down the second time.',
    ],
    changeHow: [
      {
        text: "Add the entry to the module matching the file's area, keyed by its repository-relative path.",
      },
      {
        text: 'Rebuild. The gate will tell you if anything is still missing.',
        code: `npm run docs`,
      },
    ],
    why: 'Keeping the prose beside the generator rather than in the source files means a documentation edit never touches code, so it never needs a code review — and the reasoning has room to be a paragraph rather than a comment.',
    gotchas: [
      'A key must match the path exactly, or the gate reports the file as undocumented and the entry as orphaned — two errors for one typo.',
      'Content is escaped before markup is applied. Use the inline forms — backticks, `**`, `[text](href)` — rather than raw HTML.',
    ],
    related: ['scripts/docs/build-docs.mjs', 'scripts/docs/render.mjs'],
  },
};
