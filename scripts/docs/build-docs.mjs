/**
 * Builds the documentation site from the authored content plus the extracted
 * API surface. Fails the build when a repository file has no documentation
 * entry, which is what keeps this documentation from drifting behind the code.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { renderBlocks, renderFileEntry, esc, inline, slug, fileAnchor } from './render.mjs';
import * as guides from './content/guides.mjs';

import rootFiles from './content/files.root.mjs';
import toolingFiles from './content/files.tooling.mjs';
import foundationFiles from './content/files.foundation.mjs';
import authFiles from './content/files.auth.mjs';
import protocolFiles from './content/files.protocols.mjs';
import utilFiles from './content/files.utils.mjs';
import supportFiles from './content/files.support.mjs';
import testFiles from './content/files.tests.mjs';

const ROOT = path.resolve(url.fileURLToPath(new URL('../../', import.meta.url)));
const SITE = path.join(ROOT, 'docs/site');

const FILE_DOCS = {
  ...rootFiles,
  ...toolingFiles,
  ...foundationFiles,
  ...authFiles,
  ...protocolFiles,
  ...utilFiles,
  ...supportFiles,
  ...testFiles,
};

const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/generated/api.json'), 'utf8'));

/* Files that are documented collectively rather than individually. */
const IGNORED = [
  /^package-lock\.json$/,
  /^docs\/generated\//,
  /^docs\/site\//,
  /^docs\/.*\.pdf$/,
  /^storage\//,
];

/* ------------------------------------------------------------------ */
/* Completeness check                                                  */
/* ------------------------------------------------------------------ */

/* A documented path ending in "/" covers every file beneath it collectively. */
const collective = Object.keys(FILE_DOCS).filter((f) => f.endsWith('/'));
const coveredCollectively = (file) => collective.some((dir) => file.startsWith(dir));

const repoFiles = Object.keys(api.files).filter((f) => !IGNORED.some((p) => p.test(f)));
const undocumented = repoFiles.filter((f) => !FILE_DOCS[f] && !coveredCollectively(f));
const orphaned = Object.keys(FILE_DOCS).filter((f) => !repoFiles.includes(f) && !f.endsWith('/'));

if (undocumented.length) {
  console.error(
    '\nThese files have no documentation entry:\n' + undocumented.map((f) => `  - ${f}`).join('\n'),
  );
  console.error('\nAdd an entry in scripts/docs/content/ keyed by the path above, then re-run.\n');
  process.exit(1);
}
if (orphaned.length) {
  console.error(
    '\nDocumented files that no longer exist:\n' + orphaned.map((f) => `  - ${f}`).join('\n'),
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ */
/* Page definitions                                                    */
/* ------------------------------------------------------------------ */

const GROUP_TITLES = {
  root: 'Root configuration',
  tooling: 'CI, containers and editor tooling',
  'docs-tooling': 'Documentation tooling',
  config: 'Configuration (src/config)',
  core: 'Core (src/core)',
  types: 'Types (src/types)',
  auth: 'Authentication (src/auth)',
  contracts: 'Contracts (src/contracts)',
  protocols: 'Protocol clients (src/protocols)',
  services: 'Service objects (src/services)',
  fixtures: 'Fixtures (src/fixtures)',
  hooks: 'Hooks (src/hooks)',
  utils: 'Utilities (src/utils)',
  mocks: 'Stubbing and recording (src/mocks)',
  reporters: 'Reporters (src/reporters)',
  data: 'Test data (src/data)',
  tests: 'Tests folder',
  'docs-existing': 'Repository documentation',
};

const PAGES = [
  {
    id: 'index',
    title: 'Overview',
    subtitle: 'What this framework is, and how to read this document',
    blocks: guides.overview,
  },
  {
    id: 'architecture',
    title: 'Architecture',
    subtitle: 'Layers, the path of a request, and the reasoning behind each decision',
    blocks: guides.architecture,
  },
  {
    id: 'worked-example',
    title: 'Worked example',
    subtitle: 'The CRUD suite against a real API, explained line by line',
    blocks: guides.workedExample,
  },
  {
    id: 'structure',
    title: 'Project structure',
    subtitle: 'Every folder and file, with its purpose',
    generator: 'structure',
  },
  {
    id: 'reference-root',
    title: 'Reference: configuration & tooling',
    subtitle: 'Root config, CI, containers, editor and docs tooling',
    groups: ['root', 'tooling', 'docs-tooling'],
  },
  {
    id: 'reference-foundation',
    title: 'Reference: config, core & types',
    subtitle: 'The request engine and the foundation every other layer stands on',
    groups: ['config', 'core', 'types'],
  },
  {
    id: 'reference-auth',
    title: 'Reference: authentication & contracts',
    subtitle: 'Credentials, tokens, schemas and OpenAPI conformance',
    groups: ['auth', 'contracts'],
  },
  {
    id: 'reference-protocols',
    title: 'Reference: protocols, services & fixtures',
    subtitle:
      'GraphQL, streaming, sockets, service objects and how the framework reaches your tests',
    groups: ['protocols', 'services', 'fixtures', 'hooks'],
  },
  {
    id: 'reference-utils',
    title: 'Reference: utilities, stubbing & reporting',
    subtitle: 'Cross-cutting helpers, the stub server, and what a run leaves behind',
    groups: ['utils', 'mocks', 'reporters', 'data'],
  },
  {
    id: 'reference-tests',
    title: 'Reference: tests & repository docs',
    subtitle: 'Where specs live and the conventions they follow',
    groups: ['tests', 'docs-existing'],
  },
  {
    id: 'playbooks',
    title: 'Playbooks',
    subtitle: 'I need to change something — where do I go, what do I do, and why there?',
    blocks: guides.playbooks,
  },
  {
    id: 'conventions',
    title: 'Conventions',
    subtitle: 'Rules, naming, tags, anti-patterns and the review checklist',
    blocks: guides.conventions,
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    subtitle: 'Failure modes, flakiness and the tools for diagnosing them',
    blocks: guides.troubleshooting,
  },
  {
    id: 'api-index',
    title: 'API index',
    subtitle: 'Every exported symbol and where it lives',
    generator: 'apiIndex',
  },
  {
    id: 'glossary',
    title: 'Glossary',
    subtitle: 'Terms used in the code and in this document',
    blocks: guides.glossary,
  },
];

/* ------------------------------------------------------------------ */
/* Generated page bodies                                               */
/* ------------------------------------------------------------------ */

function buildStructure() {
  const tree = [];
  const byGroup = new Map();
  for (const [file, doc] of Object.entries(FILE_DOCS)) {
    if (!byGroup.has(doc.group)) byGroup.set(doc.group, []);
    byGroup.get(doc.group).push([file, doc]);
  }

  tree.push(
    `<p>${inline('Every file in the repository, grouped by role. Each entry links to its full reference — purpose, when and how to change it, and why the change belongs there.')}</p>`,
  );
  tree.push(
    `<pre class="tree"><code>${esc(`playwright-api-framework/
├── playwright.config.ts        Projects, reporters, timeouts, artefacts
├── tsconfig.json               Strict TypeScript + path aliases
├── eslint.config.mjs           Type-aware linting
├── package.json                Dependencies and every command
├── .env.example                Documented environment template
├── Dockerfile / docker-compose.yml   CI-identical local runs
├── Makefile                    Discoverable task shortcuts
├── .github/workflows/          Sharded CI with merged reports
├── .vscode/                    Shared editor behaviour
├── docs/                       This documentation (site + PDF)
├── scripts/docs/               The documentation generator
├── src/
│   ├── config/                 Validated environment resolution
│   ├── core/                   HTTP client, request builder, response, errors
│   ├── auth/                   Basic, bearer, API key, OAuth2, HMAC, session, JWT
│   ├── contracts/              Zod schemas, JSON Schema, OpenAPI, the registry
│   ├── protocols/              GraphQL, SSE, NDJSON, WebSocket
│   ├── services/               Service objects — the API's page objects
│   ├── fixtures/               The test and expect that specs import
│   ├── hooks/                  Global setup/teardown, session capture
│   ├── mocks/                  Stub server, exchange recorder, executable contract model
│   ├── utils/                  Logging, polling, paging, diffing, security, data
│   ├── reporters/              Custom run summary
│   ├── data/                   Static test data
│   └── types/                  Shared type vocabulary
└── tests/                      api/ · contract/ · performance/ · security/`)}</code></pre>`,
  );

  for (const [group, title] of Object.entries(GROUP_TITLES)) {
    const entries = byGroup.get(group);
    if (!entries) continue;
    tree.push(`<h2 id="${slug(title)}">${esc(title)}</h2>`);
    tree.push(
      `<div class="table-wrap"><table><thead><tr><th>File</th><th>Purpose</th></tr></thead><tbody>` +
        entries
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(
            ([file, doc]) =>
              `<tr><td><a href="${pageForGroup(group)}.html#${fileAnchor(file)}"><code>${esc(file)}</code></a></td><td>${inline(
                firstSentence(doc.purpose),
              )}</td></tr>`,
          )
          .join('') +
        `</tbody></table></div>`,
    );
  }
  return tree.join('\n');
}

function pageForGroup(group) {
  const page = PAGES.find((p) => p.groups?.includes(group));
  return page ? page.id : 'index';
}

function firstSentence(text = '') {
  const match = /^(.*?[.!?])(\s|$)/.exec(text.replace(/\*\*/g, ''));
  return match ? match[1] : text;
}

function buildApiIndex() {
  const rows = [];
  for (const [file, entry] of Object.entries(api.files)) {
    for (const item of entry.exports ?? []) {
      if (item.kind === 're-export') continue;
      const group = FILE_DOCS[file]?.group;
      const href = group ? `${pageForGroup(group)}.html#${fileAnchor(file)}` : '#';
      rows.push({ name: item.name, kind: item.kind, file, href, doc: item.doc ?? '' });
    }
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));

  return (
    `<p>${inline(
      `Every exported symbol in the framework — ${rows.length} in total — extracted from the source. Click a file to jump to its reference entry.`,
    )}</p>` +
    `<input class="filter" type="search" placeholder="Filter symbols…" data-filter-target="api-table" aria-label="Filter symbols">` +
    `<div class="table-wrap"><table id="api-table"><thead><tr><th>Symbol</th><th>Kind</th><th>Defined in</th><th>Summary</th></tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr><td><code>${esc(r.name)}</code></td><td><span class="badge badge-${r.kind}">${esc(
            r.kind,
          )}</span></td><td><a href="${r.href}"><code>${esc(r.file)}</code></a></td><td>${inline(
            firstSentence(r.doc),
          )}</td></tr>`,
      )
      .join('') +
    `</tbody></table></div>`
  );
}

function buildGroups(groups) {
  const parts = [];
  for (const group of groups) {
    const entries = Object.entries(FILE_DOCS)
      .filter(([, doc]) => doc.group === group)
      .sort((a, b) => a[0].localeCompare(b[0]));
    if (!entries.length) continue;
    parts.push(
      `<h2 id="${slug(GROUP_TITLES[group] ?? group)}">${esc(GROUP_TITLES[group] ?? group)}</h2>`,
    );
    for (const [file, doc] of entries) {
      parts.push(renderFileEntry(file, doc, api.files[file]));
    }
  }
  return parts.join('\n');
}

function bodyFor(page) {
  if (page.generator === 'structure') return buildStructure();
  if (page.generator === 'apiIndex') return buildApiIndex();
  if (page.groups) return buildGroups(page.groups);
  return renderBlocks(page.blocks);
}

/* ------------------------------------------------------------------ */
/* Page shell                                                          */
/* ------------------------------------------------------------------ */

const STYLE = fs.readFileSync(path.join(ROOT, 'scripts/docs/docs.css'), 'utf8');

const SCRIPT = `
document.querySelectorAll('.filter').forEach((input) => {
  input.addEventListener('input', () => {
    const term = input.value.toLowerCase();
    const table = document.getElementById(input.dataset.filterTarget);
    if (!table) return;
    for (const row of table.tBodies[0].rows) {
      row.hidden = term !== '' && !row.textContent.toLowerCase().includes(term);
    }
  });
});
const navFilter = document.getElementById('nav-filter');
if (navFilter) {
  navFilter.addEventListener('input', () => {
    const term = navFilter.value.toLowerCase();
    document.querySelectorAll('#toc li').forEach((li) => {
      li.hidden = term !== '' && !li.textContent.toLowerCase().includes(term);
    });
  });
}
`;

function navHtml(currentId) {
  return PAGES.map(
    (p) =>
      `<li><a href="${p.id}.html"${p.id === currentId ? ' aria-current="page"' : ''}>${esc(p.title)}</a></li>`,
  ).join('');
}

function tocHtml(body) {
  const headings = [...body.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
  if (headings.length < 2) return '';
  return `<nav class="toc" aria-label="On this page"><h2>On this page</h2><ul id="toc">${headings
    .map(([, id, text]) => `<li><a href="#${id}">${text.replace(/<[^>]+>/g, '')}</a></li>`)
    .join('')}</ul></nav>`;
}

function shell(page, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(page.title)} — Playwright API Framework</title>
<meta name="description" content="${esc(page.subtitle)}">
<style>${STYLE}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<div class="layout">
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark">API</span><div><strong>Playwright API Framework</strong><span>Documentation v1.0</span></div></div>
    <input id="nav-filter" class="filter" type="search" placeholder="Filter sections…" aria-label="Filter sections">
    <nav aria-label="Documentation"><ul class="nav">${navHtml(page.id)}</ul></nav>
    <div class="sidebar-foot">
      <a href="playwright-api-framework-documentation.pdf" download>Download PDF</a>
      <span>Generated ${new Date(api.generatedAt).toISOString().slice(0, 10)}</span>
    </div>
  </aside>
  <main id="main">
    <header class="page-head">
      <p class="eyebrow">Playwright API Framework</p>
      <h1>${esc(page.title)}</h1>
      <p class="subtitle">${esc(page.subtitle)}</p>
    </header>
    ${tocHtml(body)}
    <div class="content">${body}</div>
    <footer class="page-foot">
      <div class="pager">
        ${prevNext(page)}
      </div>
      <p>Generated from source by <code>npm run docs</code>. ${repoFiles.length} files documented, ${Object.values(
        api.files,
      ).reduce((n, f) => n + (f.exports?.length ?? 0), 0)} exports extracted.</p>
    </footer>
  </main>
</div>
<script>${SCRIPT}</script>
</body>
</html>`;
}

function prevNext(page) {
  const index = PAGES.findIndex((p) => p.id === page.id);
  const previous = PAGES[index - 1];
  const next = PAGES[index + 1];
  return (
    (previous
      ? `<a class="prev" href="${previous.id}.html">&larr; ${esc(previous.title)}</a>`
      : '<span></span>') +
    (next
      ? `<a class="next" href="${next.id}.html">${esc(next.title)} &rarr;</a>`
      : '<span></span>')
  );
}

/* ------------------------------------------------------------------ */
/* Write the site                                                      */
/* ------------------------------------------------------------------ */

fs.mkdirSync(SITE, { recursive: true });

const bodies = new Map();
for (const page of PAGES) {
  const body = bodyFor(page);
  bodies.set(page.id, body);
  fs.writeFileSync(path.join(SITE, `${page.id}.html`), shell(page, body));
}

/* Single-page version, used for the PDF and as the hosted artifact source. */
const printBody = PAGES.map(
  (page) => `
<section class="print-page" id="${page.id}">
  <h1 class="print-h1">${esc(page.title)}</h1>
  <p class="subtitle">${esc(page.subtitle)}</p>
  ${bodies.get(page.id)}
</section>`,
).join('\n');

const printToc = PAGES.map(
  (p, i) =>
    `<li><span class="num">${i + 1}</span><a href="#${p.id}">${esc(p.title)}</a><span class="dots"></span><span class="sub">${esc(p.subtitle)}</span></li>`,
).join('');

fs.writeFileSync(
  path.join(SITE, 'print.html'),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Playwright API Framework — Complete Documentation</title>
<style>${STYLE}</style>
</head>
<body class="print">
<section class="cover">
  <p class="eyebrow">Test automation framework</p>
  <h1>Playwright API Framework</h1>
  <p class="cover-sub">Complete design, file and change-management documentation</p>
  <dl class="cover-meta">
    <div><dt>Version</dt><dd>1.0</dd></div>
    <div><dt>Generated</dt><dd>${new Date(api.generatedAt).toISOString().slice(0, 10)}</dd></div>
    <div><dt>Files documented</dt><dd>${repoFiles.length}</dd></div>
    <div><dt>Exports extracted</dt><dd>${Object.values(api.files).reduce((n, f) => n + (f.exports?.length ?? 0), 0)}</dd></div>
  </dl>
</section>
<section class="contents">
  <h1 class="print-h1">Contents</h1>
  <ol class="print-toc">${printToc}</ol>
</section>
${printBody}
</body>
</html>`,
);

/* ------------------------------------------------------------------ */
/* Hosted single-page manual (published as an artifact)                */
/* ------------------------------------------------------------------ */

const ARTIFACT_CSS = fs.readFileSync(path.join(ROOT, 'scripts/docs/artifact.css'), 'utf8');

function subnavFor(body) {
  const headings = [...body.matchAll(/<h2 id="([^"]+)">(.*?)<\/h2>/g)];
  if (!headings.length) return '';
  return `<ul class="subnav">${headings
    .map(([, id, text]) => `<li><a href="#${id}">${text.replace(/<[^>]+>/g, '')}</a></li>`)
    .join('')}</ul>`;
}

const railItems = PAGES.map(
  (page, index) => `<li data-for="${page.id}"${index === 0 ? ' aria-current="true"' : ''}>
    <button class="section-link" type="button" data-goto="${page.id}">
      <span class="num">${String(index + 1).padStart(2, '0')}</span>
      <span>${esc(page.title)}</span>
    </button>
    ${subnavFor(bodies.get(page.id))}
  </li>`,
).join('');

const chapters = PAGES.map(
  (
    page,
    index,
  ) => `<section class="chapter" id="${page.id}" data-index="${index}"${index === 0 ? '' : ' hidden'}>
  <header class="chapter-head">
    <p class="chapter-index">Section ${String(index + 1).padStart(2, '0')} of ${PAGES.length}</p>
    <h1>${esc(page.title)}</h1>
    <p>${esc(page.subtitle)}</p>
  </header>
  ${bodies.get(page.id)}
  <nav class="chapter-foot">
    ${index > 0 ? `<button type="button" data-goto="${PAGES[index - 1].id}">&larr; ${esc(PAGES[index - 1].title)}</button>` : '<button type="button" disabled>&larr;</button>'}
    ${index < PAGES.length - 1 ? `<button type="button" class="next" data-goto="${PAGES[index + 1].id}">${esc(PAGES[index + 1].title)} &rarr;</button>` : '<button type="button" class="next" disabled>&rarr;</button>'}
  </nav>
</section>`,
).join('\n');

const totalExports = Object.values(api.files).reduce((n, f) => n + (f.exports?.length ?? 0), 0);

const ARTIFACT_JS = `
const chapters = [...document.querySelectorAll('.chapter')];
const railItems = [...document.querySelectorAll('.sections > li')];
const crumb = document.getElementById('crumb');

function show(id, hash) {
  const target = chapters.find((c) => c.id === id) || chapters[0];
  chapters.forEach((c) => { c.hidden = c !== target; });
  railItems.forEach((li) => li.setAttribute('aria-current', String(li.dataset.for === target.id)));
  crumb.innerHTML = 'Playwright API Framework / <b>' + target.querySelector('h1').textContent + '</b>';
  const anchor = hash ? target.querySelector(hash) : null;
  if (anchor) anchor.scrollIntoView({ block: 'start' });
  else window.scrollTo({ top: 0 });
  history.replaceState(null, '', '#' + target.id + (anchor ? hash : ''));
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-goto]');
  if (button) { show(button.dataset.goto); return; }
  const link = event.target.closest('.subnav a, .content a[href^="#"], a[href^="#"]');
  if (link && link.getAttribute('href').startsWith('#')) {
    const id = link.getAttribute('href').slice(1);
    const owner = chapters.find((c) => c.id === id || c.querySelector('#' + CSS.escape(id)));
    if (owner) { event.preventDefault(); show(owner.id, owner.id === id ? null : '#' + CSS.escape(id)); }
  }
});

/* Cross-document search over every heading and documented file. */
const index = [];
chapters.forEach((chapter) => {
  const title = chapter.querySelector('h1').textContent;
  index.push({ label: title, where: 'Section', id: chapter.id, anchor: null });
  chapter.querySelectorAll('h2, h3, .file-head code').forEach((node) => {
    index.push({
      label: node.textContent.trim(),
      where: title,
      id: chapter.id,
      anchor: node.id || node.closest('[id]')?.id || null,
    });
  });
});

const box = document.getElementById('search-input');
const results = document.getElementById('search-results');
box.addEventListener('input', () => {
  const term = box.value.trim().toLowerCase();
  results.innerHTML = '';
  if (term.length < 2) return;
  index
    .filter((entry) => entry.label.toLowerCase().includes(term))
    .slice(0, 24)
    .forEach((entry) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.innerHTML = entry.label.replace(/</g, '&lt;') + '<span class="where">' + entry.where + '</span>';
      button.addEventListener('click', () => {
        show(entry.id, entry.anchor ? '#' + CSS.escape(entry.anchor) : null);
        box.value = '';
        results.innerHTML = '';
      });
      li.appendChild(button);
      results.appendChild(li);
    });
});

document.querySelectorAll('.filter[data-filter-target]').forEach((input) => {
  input.addEventListener('input', () => {
    const term = input.value.toLowerCase();
    const table = document.getElementById(input.dataset.filterTarget);
    if (!table) return;
    for (const row of table.tBodies[0].rows) {
      row.hidden = term !== '' && !row.textContent.toLowerCase().includes(term);
    }
  });
});

document.getElementById('expand-all').addEventListener('click', () => {
  const open = [...document.querySelectorAll('.chapter:not([hidden]) details')];
  const shouldOpen = open.some((d) => !d.open);
  open.forEach((d) => { d.open = shouldOpen; });
});

const themeButton = document.getElementById('theme-toggle');
themeButton.addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.getAttribute('data-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const next = current ? (current === 'dark' ? 'light' : 'dark') : (prefersDark ? 'light' : 'dark');
  root.setAttribute('data-theme', next);
  try { localStorage.setItem('pw-api-docs-theme', next); } catch {}
});
try {
  const saved = localStorage.getItem('pw-api-docs-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
} catch {}

if (location.hash) {
  const id = location.hash.slice(1);
  const owner = chapters.find((c) => c.id === id || c.querySelector('#' + CSS.escape(id)));
  if (owner) show(owner.id, owner.id === id ? null : location.hash);
}
`;

fs.writeFileSync(
  path.join(SITE, 'artifact.html'),
  `<title>Playwright API Framework Manual</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chivo:wght@600;700&family=JetBrains+Mono:wght@400;500;600&family=Source+Sans+3:wght@400;600&display=swap">
<style>${ARTIFACT_CSS}</style>

<a class="skip" href="#main">Skip to content</a>
<div class="shell">
  <aside class="rail">
    <div class="mark">
      <span class="mark-glyph">API</span>
      <span class="mark-text"><strong>Playwright API Framework</strong><span>manual v1.0</span></span>
    </div>
    <div class="search">
      <input id="search-input" type="search" placeholder="Search sections and files" aria-label="Search the manual" autocomplete="off">
      <ul class="results" id="search-results"></ul>
    </div>
    <nav aria-label="Manual sections"><ul class="sections">${railItems}</ul></nav>
    <div class="rail-foot">
      <span class="stat">Files documented <b>${repoFiles.length}</b></span>
      <span class="stat">Exports extracted <b>${totalExports}</b></span>
      <span class="stat">Generated <b>${new Date(api.generatedAt).toISOString().slice(0, 10)}</b></span>
    </div>
  </aside>
  <div class="main">
    <div class="topbar">
      <span class="crumb" id="crumb">Playwright API Framework / <b>Overview</b></span>
      <span class="actions">
        <button type="button" id="expand-all">Toggle API detail</button>
        <button type="button" id="theme-toggle">Theme</button>
      </span>
    </div>
    <main class="doc" id="main">
${chapters}
    </main>
  </div>
</div>
<script>${ARTIFACT_JS}</script>
`,
);

console.log(`Wrote ${PAGES.length + 1} pages to docs/site`);
console.log(`Documented ${repoFiles.length} files`);
