/**
 * A small, dependency-free JSON path reader.
 *
 * Full JSONPath implementations bring a parser, a filter-expression evaluator
 * and a large dependency tree. What API assertions actually need is the
 * ability to name a nested value — `data.items[0].id`, `errors[*].code`,
 * `..email` — so that is exactly what this supports, with syntax any reviewer
 * can read without consulting a specification.
 *
 * Supported syntax:
 *   `a.b.c`      property access
 *   `a[0]`       array index (negative counts from the end: `a[-1]`)
 *   `a[*].b`     every element of an array
 *   `a.*`        every value of an object
 *   `..name`     recursive descent to every `name` at any depth
 */

/** Reads a single value. Returns `undefined` when the path does not resolve. */
export function readPath(source: unknown, path: string): unknown {
  const results = readAll(source, path);
  return results.length ? results[0] : undefined;
}

/** Reads every value a path matches. Wildcards and `..` can match many. */
export function readAll(source: unknown, path: string): unknown[] {
  const tokens = tokenize(path);
  let current: unknown[] = [source];

  for (const token of tokens) {
    const next: unknown[] = [];
    for (const node of current) {
      collect(node, token, next);
    }
    current = next;
    if (!current.length) return [];
  }
  return current;
}

/** True when the path resolves to anything other than `undefined`. */
export function hasPath(source: unknown, path: string): boolean {
  return readAll(source, path).some((value) => value !== undefined);
}

/**
 * Every leaf path in a payload, as dotted strings. Useful for asserting that a
 * response gained or lost fields between versions, and for writing a first
 * draft of a schema from a real response.
 */
export function leafPaths(source: unknown, prefix = ''): string[] {
  if (Array.isArray(source)) {
    return source.flatMap((item, index) => leafPaths(item, `${prefix}[${index}]`));
  }
  if (isRecord(source)) {
    return Object.entries(source).flatMap(([key, value]) =>
      leafPaths(value, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [prefix];
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

type Token =
  | { kind: 'key'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'descend'; name: string };

function tokenize(path: string): Token[] {
  const tokens: Token[] = [];
  /* `..name` — recursive descent. Matched first so the empty segment that a
   * double dot would otherwise produce never reaches the key branch. */
  const normalized = path.replace(/\[(-?\d+)\]/g, '.[$1]').replace(/\[\*\]/g, '.*');

  let rest = normalized;
  while (rest.length) {
    const descend = /^\.\.([^.[]+)/.exec(rest);
    if (descend?.[1]) {
      tokens.push({ kind: 'descend', name: descend[1] });
      rest = rest.slice(descend[0].length);
      continue;
    }
    const segment = /^\.?([^.]+)/.exec(rest);
    if (!segment?.[1]) break;
    const raw = segment[1];
    if (raw === '*') tokens.push({ kind: 'wildcard' });
    else if (/^\[-?\d+\]$/.test(raw))
      tokens.push({ kind: 'index', index: Number(raw.slice(1, -1)) });
    else tokens.push({ kind: 'key', name: raw });
    rest = rest.slice(segment[0].length);
  }
  return tokens;
}

function collect(node: unknown, token: Token, into: unknown[]): void {
  switch (token.kind) {
    case 'key':
      if (isRecord(node) && token.name in node) into.push(node[token.name]);
      break;
    case 'index':
      if (Array.isArray(node)) {
        const index = token.index < 0 ? node.length + token.index : token.index;
        if (index >= 0 && index < node.length) into.push(node[index]);
      }
      break;
    case 'wildcard':
      if (Array.isArray(node)) into.push(...(node as unknown[]));
      else if (isRecord(node)) into.push(...Object.values(node));
      break;
    case 'descend':
      descend(node, token.name, into);
      break;
  }
}

function descend(node: unknown, name: string, into: unknown[]): void {
  if (Array.isArray(node)) {
    for (const item of node) descend(item, name, into);
    return;
  }
  if (!isRecord(node)) return;
  for (const [key, value] of Object.entries(node)) {
    if (key === name) into.push(value);
    descend(value, name, into);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
