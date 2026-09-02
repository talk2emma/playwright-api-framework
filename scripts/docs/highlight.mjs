/**
 * Build-time syntax highlighting.
 *
 * Highlighting happens during the docs build rather than in the browser, so
 * the HTML site, the PDF and the hosted manual all receive identical coloured
 * markup — a runtime library could not colour the PDF, and would add a CDN
 * dependency to a page that otherwise works offline.
 *
 * Output is plain <span class="tok-*"> markup; the palettes live in the
 * stylesheets, which is what lets each output theme the same tokens.
 */

const CLASS = {
  comment: 'tok-c',
  string: 'tok-s',
  keyword: 'tok-k',
  number: 'tok-n',
  fn: 'tok-f',
  type: 'tok-t',
  prop: 'tok-p',
  operator: 'tok-o',
  variable: 'tok-v',
  regex: 'tok-r',
  flag: 'tok-a',
};

function esc(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrap(kind, text) {
  return `<span class="${CLASS[kind]}">${esc(text)}</span>`;
}

/* ------------------------------------------------------------------ */
/* Language detection                                                  */
/* ------------------------------------------------------------------ */

const SHELL_START =
  /^\s*(?:\$\s+)?(?:npm|npx|node|pnpm|yarn|docker|docker compose|make|git|cp|mv|rm|mkdir|open|cd|export|echo|curl|brew|nvm|TEST_ENV=|BASE_URL=|LOG_LEVEL=|WORKERS=|CI=)/m;
const DOCKER_START = /^\s*(?:FROM|RUN|COPY|ADD|ENV|WORKDIR|ENTRYPOINT|CMD|EXPOSE|ARG|LABEL)\s/m;

/**
 * A raw HTTP exchange: a request line, or a status line. An API framework's
 * documentation shows a lot of these, and reading one as TypeScript colours
 * the verb as an identifier and the path as division.
 */
const HTTP_START =
  /^\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\S+\s+HTTP\/[\d.]+|^\s*HTTP\/[\d.]+\s+\d{3}/m;

/** A GraphQL document: an operation or a fragment, followed by a selection set. */
const GRAPHQL_START = /^\s*(?:query|mutation|subscription|fragment)\s+[\w$]+[\s\S]*\{/;

/**
 * Statement punctuation and JavaScript keywords. A `key: value` line inside a
 * TypeScript object literal looks exactly like YAML, so this is what keeps a
 * fragment such as `maxUploadMb: raw.MAX_UPLOAD_MB,` from being read as YAML.
 */
const LOOKS_LIKE_CODE =
  /=>|\b(?:const|let|var|function|await|async|import|export|class|interface|extends|return|new|this)\b|[;,]\s*$/m;

export function detectLanguage(code) {
  const text = code.trim();
  if (!text) return 'text';

  if (DOCKER_START.test(text)) return 'docker';
  if (HTTP_START.test(text)) return 'http';
  if (GRAPHQL_START.test(text) && !/\b(?:const|await|function)\b|=>/.test(text)) return 'graphql';

  // JSON or a JSON fragment: quoted keys, no JavaScript syntax.
  if (
    /^["{[]/.test(text) &&
    /"[^"]*"\s*:/.test(text) &&
    !/=>|\bconst\b|\bfunction\b|\bawait\b/.test(text)
  ) {
    return 'json';
  }

  const codeLike = LOOKS_LIKE_CODE.test(text);

  // Environment file: KEY=value lines with no shell command in sight.
  if (
    /^[A-Z][A-Z0-9_]*=/m.test(text) &&
    !/\b(?:npm|npx|node|docker|make|git|cp|mv|rm)\b/.test(text)
  ) {
    return 'env';
  }

  if (SHELL_START.test(text) && !codeLike) return 'shell';

  // YAML, docker-compose and Makefile targets: `key:` lines, no statements.
  // Braces are allowed here because `\${{ }}` interpolation is pervasive in
  // GitHub Actions and Compose files.
  if (/^\s*[\w.\-/]+:(?:\s|$)/m.test(text) && !codeLike) return 'yaml';

  return 'ts';
}

export const LANGUAGE_LABEL = {
  ts: 'TypeScript',
  json: 'JSON',
  shell: 'Shell',
  yaml: 'YAML',
  env: 'Env',
  docker: 'Dockerfile',
  http: 'HTTP',
  graphql: 'GraphQL',
  text: 'Text',
};

/* ------------------------------------------------------------------ */
/* Lexers                                                              */
/* ------------------------------------------------------------------ */

const TS_KEYWORDS = new Set([
  'abstract',
  'as',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'declare',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'get',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'keyof',
  'let',
  'new',
  'null',
  'of',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'return',
  'satisfies',
  'set',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'type',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'yield',
]);

const TS_TYPES = new Set([
  'any',
  'boolean',
  'never',
  'number',
  'object',
  'string',
  'symbol',
  'unknown',
  'bigint',
]);

/**
 * One master pattern keeps the scan single-pass, which avoids the
 * double-escaping bugs that come from highlighting already-escaped HTML.
 */
const TS_PATTERN = new RegExp(
  [
    '(?<comment>\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/)',
    '(?<string>`(?:\\\\.|[^`\\\\])*`|\'(?:\\\\.|[^\'\\\\\\n])*\'|"(?:\\\\.|[^"\\\\\\n])*")',
    '(?<regex>(?<=[=(,:\\[!&|?+]\\s{0,4})\\/(?![*\\/])(?:\\\\.|\\[[^\\]\\n]*\\]|[^\\/\\\\\\n])+\\/[gimsuy]*)',
    '(?<number>\\b\\d[\\d_]*(?:\\.\\d+)?(?:e[+-]?\\d+)?\\b)',
    '(?<decorator>@[A-Za-z_$][\\w$]*)',
    '(?<word>[A-Za-z_$][\\w$]*)',
    '(?<operator>=>|\\.\\.\\.|[+\\-*/%<>=!&|^~?:]+)',
    '(?<punct>[{}()\\[\\];,.])',
  ].join('|'),
  'gu',
);

function highlightTs(code) {
  let out = '';
  let last = 0;

  for (const match of code.matchAll(TS_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.string) out += highlightTemplate(groups.string);
    else if (groups.regex) out += wrap('regex', groups.regex);
    else if (groups.number) out += wrap('number', groups.number);
    else if (groups.decorator) out += wrap('fn', groups.decorator);
    else if (groups.word) {
      const word = groups.word;
      const after = code.slice(last);
      if (TS_KEYWORDS.has(word)) out += wrap('keyword', word);
      else if (TS_TYPES.has(word)) out += wrap('type', word);
      else if (/^\s*\(/.test(after) || /^\s*</.test(after)) out += wrap('fn', word);
      else if (/^[A-Z]/.test(word)) out += wrap('type', word);
      else if (/^\s*:/.test(after) && !/^\s*::/.test(after)) out += wrap('prop', word);
      else out += esc(word);
    } else if (groups.operator) out += wrap('operator', groups.operator);
    else out += esc(match[0]);
  }

  return out + esc(code.slice(last));
}

/** Colours `${...}` interpolations inside a template literal as code, not string. */
function highlightTemplate(literal) {
  if (!literal.startsWith('`') || !literal.includes('${')) return wrap('string', literal);

  let out = '';
  let cursor = 0;
  const pattern = /\$\{([^{}]*)\}/g;
  for (const match of literal.matchAll(pattern)) {
    const index = match.index ?? 0;
    out += wrap('string', literal.slice(cursor, index));
    out += `<span class="${CLASS.operator}">\${</span>${highlightTs(match[1])}<span class="${CLASS.operator}">}</span>`;
    cursor = index + match[0].length;
  }
  return out + wrap('string', literal.slice(cursor));
}

const SHELL_PATTERN = new RegExp(
  [
    '(?<comment>#[^\\n]*)',
    '(?<string>\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")',
    '(?<variable>\\$\\{[^}]*\\}|\\$[A-Za-z_][\\w]*)',
    '(?<assign>\\b[A-Z][A-Z0-9_]*(?==))',
    '(?<flag>(?<=\\s)--?[A-Za-z][\\w-]*)',
    '(?<target>^[\\w.-]+(?=:(?:\\s|$)))',
    '(?<command>(?<=^|[|;&]\\s*)\\s*(?:npm|npx|node|pnpm|yarn|docker|make|git|cp|mv|rm|mkdir|open|cd|export|echo|curl|brew|nvm)\\b)',
    '(?<operator>[|&;>]+)',
  ].join('|'),
  'gmu',
);

function highlightShell(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(SHELL_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.string) out += wrap('string', groups.string);
    else if (groups.variable) out += wrap('variable', groups.variable);
    else if (groups.assign) out += wrap('prop', groups.assign);
    else if (groups.target) out += wrap('fn', groups.target);
    else if (groups.flag) out += wrap('flag', groups.flag);
    else if (groups.command) out += wrap('fn', groups.command);
    else if (groups.operator) out += wrap('operator', groups.operator);
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

const YAML_PATTERN = new RegExp(
  [
    '(?<comment>#[^\\n]*)',
    '(?<key>^\\s*-?\\s*[\\w.\\-/]+(?=:))',
    '(?<string>\'(?:[^\'\\\\]|\\\\.)*\'|"(?:[^"\\\\]|\\\\.)*")',
    '(?<variable>\\$\\{\\{[^}]*\\}\\}|\\$\\{[^}]*\\}|\\$[A-Za-z_][\\w]*)',
    '(?<constant>\\b(?:true|false|null|on|off)\\b)',
    '(?<number>\\b\\d+(?:\\.\\d+)?\\b)',
    '(?<dash>^\\s*-\\s)',
  ].join('|'),
  'gmu',
);

function highlightYaml(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(YAML_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.key) out += wrap('prop', groups.key);
    else if (groups.string) out += wrap('string', groups.string);
    else if (groups.variable) out += wrap('variable', groups.variable);
    else if (groups.constant) out += wrap('keyword', groups.constant);
    else if (groups.number) out += wrap('number', groups.number);
    else if (groups.dash) out += wrap('operator', groups.dash);
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

const JSON_PATTERN = new RegExp(
  [
    '(?<key>"(?:[^"\\\\]|\\\\.)*"(?=\\s*:))',
    '(?<string>"(?:[^"\\\\]|\\\\.)*")',
    '(?<constant>\\b(?:true|false|null)\\b)',
    '(?<number>-?\\b\\d+(?:\\.\\d+)?\\b)',
    '(?<punct>[{}\\[\\],:])',
  ].join('|'),
  'gu',
);

function highlightJson(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(JSON_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.key) out += wrap('prop', groups.key);
    else if (groups.string) out += wrap('string', groups.string);
    else if (groups.constant) out += wrap('keyword', groups.constant);
    else if (groups.number) out += wrap('number', groups.number);
    else if (groups.punct) out += wrap('operator', groups.punct);
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

const ENV_PATTERN = new RegExp(
  ['(?<comment>#[^\\n]*)', '(?<key>^[A-Z][A-Z0-9_]*(?==))', '(?<equals>=)'].join('|'),
  'gmu',
);

function highlightEnv(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(ENV_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.key) out += wrap('prop', groups.key);
    else if (groups.equals) out += wrap('operator', '=');
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

const DOCKER_PATTERN = new RegExp(
  [
    '(?<comment>#[^\\n]*)',
    '(?<instruction>^\\s*(?:FROM|RUN|COPY|ADD|ENV|WORKDIR|ENTRYPOINT|CMD|EXPOSE|ARG|LABEL|USER|VOLUME)\\b)',
    '(?<string>"(?:[^"\\\\]|\\\\.)*")',
    '(?<flag>(?<=\\s)--[A-Za-z][\\w-]*)',
  ].join('|'),
  'gmu',
);

function highlightDocker(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(DOCKER_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.instruction) out += wrap('keyword', groups.instruction);
    else if (groups.string) out += wrap('string', groups.string);
    else if (groups.flag) out += wrap('flag', groups.flag);
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

/* ------------------------------------------------------------------ */
/* HTTP exchanges                                                      */
/* ------------------------------------------------------------------ */

const HTTP_PATTERN = new RegExp(
  [
    '(?<comment>^\\s*#[^\\n]*)',
    '(?<method>^\\s*(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\\b)',
    '(?<version>\\bHTTP\\/[\\d.]+)',
    '(?<status>(?<=HTTP\\/[\\d.]{3}\\s)\\d{3})',
    '(?<header>^[A-Za-z][A-Za-z0-9-]*(?=:\\s))',
    '(?<body>^\\s*[{\\[].*$)',
    '(?<path>(?<=\\s)\\/[^\\s]*)',
  ].join('|'),
  'gmu',
);

/** Colours a raw request or response: verb, path, version, status, headers. */
function highlightHttp(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(HTTP_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.method) out += wrap('keyword', groups.method);
    else if (groups.version) out += wrap('type', groups.version);
    else if (groups.status) out += wrap('number', groups.status);
    else if (groups.header) out += wrap('prop', groups.header);
    // A JSON body inside an exchange is handed to the JSON lexer rather than
    // left plain, so a documented response reads the same as a JSON snippet.
    else if (groups.body) out += highlightJson(groups.body);
    else if (groups.path) out += wrap('string', groups.path);
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

/* ------------------------------------------------------------------ */
/* GraphQL                                                             */
/* ------------------------------------------------------------------ */

const GRAPHQL_KEYWORDS = new Set([
  'query',
  'mutation',
  'subscription',
  'fragment',
  'on',
  'true',
  'false',
  'null',
]);

const GRAPHQL_PATTERN = new RegExp(
  [
    '(?<comment>#[^\\n]*)',
    '(?<string>\\x22{3}[\\s\\S]*?\\x22{3}|\\x22(?:[^\\x22\\\\]|\\\\.)*\\x22)',
    '(?<variable>\\$[A-Za-z_][\\w]*)',
    '(?<directive>@[A-Za-z_][\\w]*)',
    '(?<spread>\\.\\.\\.)',
    '(?<number>\\b\\d+(?:\\.\\d+)?\\b)',
    '(?<word>[A-Za-z_][\\w]*)',
    '(?<punct>[{}()\\[\\]:,!=])',
  ].join('|'),
  'gu',
);

function highlightGraphql(code) {
  let out = '';
  let last = 0;
  for (const match of code.matchAll(GRAPHQL_PATTERN)) {
    const groups = match.groups ?? {};
    const index = match.index ?? 0;
    out += esc(code.slice(last, index));
    last = index + match[0].length;

    if (groups.comment) out += wrap('comment', groups.comment);
    else if (groups.string) out += wrap('string', groups.string);
    else if (groups.variable) out += wrap('variable', groups.variable);
    else if (groups.directive) out += wrap('flag', groups.directive);
    else if (groups.spread) out += wrap('operator', groups.spread);
    else if (groups.number) out += wrap('number', groups.number);
    else if (groups.word) {
      const word = groups.word;
      // A capitalised word in a GraphQL document is a type; a word followed by
      // a colon is an argument or an alias; anything else is a selected field.
      if (GRAPHQL_KEYWORDS.has(word)) out += wrap('keyword', word);
      else if (/^[A-Z]/.test(word)) out += wrap('type', word);
      else if (/^\s*:/.test(code.slice(last))) out += wrap('prop', word);
      else out += wrap('fn', word);
    } else if (groups.punct) out += wrap('operator', groups.punct);
    else out += esc(match[0]);
  }
  return out + esc(code.slice(last));
}

const LEXERS = {
  ts: highlightTs,
  http: highlightHttp,
  graphql: highlightGraphql,
  json: highlightJson,
  shell: highlightShell,
  yaml: highlightYaml,
  env: highlightEnv,
  docker: highlightDocker,
  text: esc,
};

/**
 * Highlights a snippet. Pass `lang` to override the detected language.
 * Returns HTML-escaped markup ready to place inside <pre><code>.
 */
export function highlight(code, lang) {
  const language = lang ?? detectLanguage(code);
  const lexer = LEXERS[language] ?? esc;
  return lexer(code);
}
