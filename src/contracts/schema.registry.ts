/**
 * A name-to-schema registry.
 *
 * Two problems this solves. First, `STRICT_CONTRACTS=true` makes the framework
 * validate every response automatically, which it can only do if it can find
 * the right schema from the request itself. Second, it gives contract coverage
 * a denominator: how many of the operations the suite exercises actually have
 * a schema at all.
 *
 * Registration is by method plus a path *pattern*, so `/users/{id}` matches
 * `/users/42` — otherwise every identifier would need its own entry.
 */
import type { z } from 'zod';
import type { HttpMethod } from '../types';

export interface RegisteredSchema {
  readonly name: string;
  readonly method: HttpMethod;
  /** Path pattern with `{param}` placeholders, matched against the real path. */
  readonly pathPattern: string;
  /** Which status this schema describes. `'2xx'` matches any success. */
  readonly status: number | '2xx' | '4xx' | '5xx';
  readonly schema: z.ZodTypeAny;
}

const registry: RegisteredSchema[] = [];

/** Registers a response schema. Call at module scope in `src/contracts`. */
export function registerSchema(entry: RegisteredSchema): void {
  registry.push(entry);
}

/** Registers many at once — the usual form for a service's contract file. */
export function registerSchemas(entries: RegisteredSchema[]): void {
  for (const entry of entries) registerSchema(entry);
}

/** Everything registered, for coverage reporting. */
export function allSchemas(): readonly RegisteredSchema[] {
  return [...registry];
}

/** Removes every registration. Only for the framework's own tests. */
export function clearSchemas(): void {
  registry.length = 0;
}

/** The schema for a request/status pair, or `undefined` when none is registered. */
export function findSchema(
  method: HttpMethod,
  url: string,
  status: number,
): RegisteredSchema | undefined {
  const pathname = safePathname(url);
  return registry.find(
    (entry) =>
      entry.method === method &&
      matchesStatus(entry.status, status) &&
      matchesPath(entry.pathPattern, pathname),
  );
}

/** By name, for a test that wants to reuse a schema explicitly. */
export function schemaByName(name: string): z.ZodTypeAny | undefined {
  return registry.find((entry) => entry.name === name)?.schema;
}

/* ------------------------------------------------------------------ */
/* Matching                                                            */
/* ------------------------------------------------------------------ */

function matchesStatus(pattern: RegisteredSchema['status'], status: number): boolean {
  if (typeof pattern === 'number') return pattern === status;
  if (pattern === '2xx') return status >= 200 && status < 300;
  if (pattern === '4xx') return status >= 400 && status < 500;
  return status >= 500;
}

/**
 * Compares a `{param}` pattern with a concrete path, ignoring any version
 * prefix so one registration works across `/v1/users` and `/users`.
 */
export function matchesPath(pattern: string, pathname: string): boolean {
  const patternParts = trim(pattern).split('/');
  const pathParts = trim(pathname).split('/');

  /* Drop a leading version segment from the real path when the pattern has
   * none, so registrations do not have to repeat the environment's prefix. */
  if (pathParts.length === patternParts.length + 1 && /^v\d+$|^api$/i.test(pathParts[0] ?? '')) {
    pathParts.shift();
  }
  if (patternParts.length !== pathParts.length) return false;

  return patternParts.every((part, index) => {
    if (part.startsWith('{') && part.endsWith('}')) return true;
    if (part.startsWith(':')) return true;
    return part === pathParts[index];
  });
}

function trim(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

function safePathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}
