# Documentation

Everything in this folder is **generated**. Edit the source, not the output.

| Path                                         | What it is                                      | Committed?            |
| -------------------------------------------- | ----------------------------------------------- | --------------------- |
| `playwright-api-framework-documentation.pdf` | The complete manual, ~200 A4 pages              | Yes                   |
| `site/`                                      | The HTML documentation — open `site/index.html` | No, rebuilt on demand |
| `generated/api.json`                         | The extracted API surface                       | No, rebuilt on demand |

## Reading it

```bash
npm run docs:open          # opens site/index.html
open docs/playwright-api-framework-documentation.pdf
```

The site is self-contained: CSS is inlined and there are no external requests,
so it works from a `file://` URL with no network.

## Rebuilding

```bash
npm run docs               # extract → HTML → PDF
```

The PDF step needs Chromium: `npx playwright install chromium`.

## Editing

| To change…          | Edit                                                                      |
| ------------------- | ------------------------------------------------------------------------- |
| A file's entry      | `scripts/docs/content/files.*.mjs`, keyed by the repository-relative path |
| A narrative page    | `scripts/docs/content/guides.mjs`                                         |
| Which pages exist   | `PAGES` in `scripts/docs/build-docs.mjs`                                  |
| How anything looks  | `scripts/docs/docs.css` (site + print) or `artifact.css` (hosted manual)  |
| Syntax highlighting | `scripts/docs/highlight.mjs`                                              |

**The build fails when a source file has no documentation entry**, naming the
file. That gate is why this documentation can be trusted not to drift behind
the code — and it is also why adding a source file means adding a paragraph.
