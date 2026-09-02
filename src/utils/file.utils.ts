/**
 * Reading test data from disk and writing artefacts.
 *
 * API tests need files for two reasons: as *input*, when a suite is driven by
 * a table of cases rather than by code, and as *evidence*, when a run should
 * leave behind something a human can inspect. Both go through here so paths
 * are resolved consistently and a missing file produces a message naming the
 * path it looked in.
 */
import path from 'node:path';

const ROOT = process.cwd();

/** Resolves a path relative to the repository root. */
export function fromRoot(...segments: string[]): string {
  return path.join(ROOT, ...segments);
}
