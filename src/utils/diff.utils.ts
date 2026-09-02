/**
 * Structural comparison of payloads.
 *
 * Two jobs. Comparing a response against a stored baseline, which catches the
 * field a service quietly stopped returning. And comparing two responses —
 * old version against new, or one region against another — which is how a
 * migration is verified without writing an assertion per field.
 *
 * Volatile fields (`id`, `createdAt`, anything the server generates) are
 * ignorable, because otherwise every diff is noise and nobody reads them.
 */
import type { UnknownRecord } from '../types';
import { readPath, leafPaths } from './jsonpath.utils';

/** One difference between two payloads. */
export interface Difference {
  /** Dotted path to the value that differs. */
  readonly path: string;
  readonly kind: 'added' | 'removed' | 'changed' | 'type-changed';
  readonly expected?: unknown;
  readonly actual?: unknown;
}

export interface DiffOptions {
  /** Paths to skip. Supports a trailing `*` for prefixes. */
  readonly ignore?: string[];
  /** Compare arrays element by element rather than as unordered sets. */
  readonly strictArrayOrder?: boolean;
  /** Treat a missing key and an explicit `null` as the same thing. */
  readonly nullIsAbsent?: boolean;
}

/** Fields that legitimately change on every request. */
export const VOLATILE_FIELDS = [
  'id',
  '*.id',
  'createdAt',
  'updatedAt',
  'timestamp',
  'requestId',
  'traceId',
  'etag',
  '*.createdAt',
  '*.updatedAt',
];

/** Every difference between two payloads. Empty means they match. */
export function diff(expected: unknown, actual: unknown, options: DiffOptions = {}): Difference[] {
  const differences: Difference[] = [];
  walk(expected, actual, '', differences, options);
  return differences.filter((entry) => !isIgnored(entry.path, options.ignore ?? []));
}

/** True when two payloads match, ignoring the paths given. */
export function matches(expected: unknown, actual: unknown, options: DiffOptions = {}): boolean {
  return diff(expected, actual, options).length === 0;
}

/** A readable multi-line rendering, for an assertion message. */
export function formatDiff(differences: readonly Difference[]): string {
  if (!differences.length) return 'no differences';
  return differences
    .map((entry) => {
      switch (entry.kind) {
        case 'added':
          return `+ ${entry.path} = ${render(entry.actual)}`;
        case 'removed':
          return `- ${entry.path} (was ${render(entry.expected)})`;
        case 'type-changed':
          return `~ ${entry.path}: type ${typeName(entry.expected)} → ${typeName(entry.actual)}`;
        case 'changed':
          return `~ ${entry.path}: ${render(entry.expected)} → ${render(entry.actual)}`;
      }
    })
    .join('\n');
}

/**
 * Compares shape rather than values: which paths exist, and of what type.
 *
 * This is the comparison worth running against a baseline in CI. Values change
 * legitimately all the time; a field disappearing, or turning from a number
 * into a string, is a breaking change for every consumer.
 */
export function shapeOf(payload: unknown): Record<string, string> {
  const shape: Record<string, string> = {};
  for (const path of leafPaths(payload)) {
    /* Array indices are collapsed so a two-item and a three-item response have
     * the same shape — otherwise every list endpoint diffs against itself. */
    const generalized = path.replace(/\[\d+\]/g, '[]');
    shape[generalized] = typeName(readPath(payload, path));
  }
  return shape;
}

/** Breaking shape changes: fields removed, or fields whose type changed. */
export function breakingChanges(
  baseline: Record<string, string>,
  current: Record<string, string>,
): Difference[] {
  const changes: Difference[] = [];
  for (const [path, type] of Object.entries(baseline)) {
    if (!(path in current)) {
      changes.push({ path, kind: 'removed', expected: type });
    } else if (current[path] !== type) {
      changes.push({ path, kind: 'type-changed', expected: type, actual: current[path] });
    }
  }
  return changes;
}

/* ------------------------------------------------------------------ */
/* Internals                                                           */
/* ------------------------------------------------------------------ */

function walk(
  expected: unknown,
  actual: unknown,
  path: string,
  into: Difference[],
  options: DiffOptions,
): void {
  const bothAbsent =
    options.nullIsAbsent &&
    (expected === undefined || expected === null) &&
    (actual === undefined || actual === null);
  if (bothAbsent) return;

  if (expected === undefined && actual !== undefined) {
    into.push({ path, kind: 'added', actual });
    return;
  }
  if (actual === undefined && expected !== undefined) {
    into.push({ path, kind: 'removed', expected });
    return;
  }
  if (typeName(expected) !== typeName(actual)) {
    into.push({ path, kind: 'type-changed', expected, actual });
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (!options.strictArrayOrder && expected.length === actual.length) {
      /* Unordered comparison: match each expected element to an equal actual
       * one. Lists whose order the API does not guarantee are the common case. */
      const unmatched: unknown[] = [...(actual as unknown[])];
      for (const item of expected) {
        const index = unmatched.findIndex((candidate) => matchesDeep(item, candidate));
        if (index === -1) into.push({ path, kind: 'changed', expected: item });
        else unmatched.splice(index, 1);
      }
      return;
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      walk(expected[index], actual[index], `${path}[${index}]`, into, options);
    }
    return;
  }

  if (isRecord(expected) && isRecord(actual)) {
    for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
      walk(expected[key], actual[key], path ? `${path}.${key}` : key, into, options);
    }
    return;
  }

  if (expected !== actual) into.push({ path, kind: 'changed', expected, actual });
}

function matchesDeep(a: unknown, b: unknown): boolean {
  const differences: Difference[] = [];
  walk(a, b, '', differences, {});
  return differences.length === 0;
}

function isIgnored(path: string, patterns: readonly string[]): boolean {
  const generalized = path.replace(/\[\d+\]/g, '');
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) return generalized.endsWith(pattern.slice(1));
    if (pattern.endsWith('*')) return generalized.startsWith(pattern.slice(0, -1));
    return generalized === pattern || generalized.endsWith(`.${pattern}`);
  });
}

function typeName(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function render(value: unknown): string {
  /* `JSON.stringify` returns undefined for these two, and a diff message still
   * has to be able to describe them. */
  if (value === undefined) return 'undefined';
  if (typeof value === 'function') return '[function]';
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
