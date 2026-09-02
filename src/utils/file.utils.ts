/**
 * Reading test data from disk and writing artefacts.
 *
 * API tests need files for two reasons: as *input*, when a suite is driven by
 * a table of cases rather than by code, and as *evidence*, when a run should
 * leave behind something a human can inspect. Both go through here so paths
 * are resolved consistently and a missing file produces a message naming the
 * path it looked in.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { parse as parseCsvSync } from 'csv-parse/sync';
import { ConfigurationError } from '../core/errors';
import type { UnknownRecord } from '../types';

const ROOT = process.cwd();

/** Resolves a path relative to the repository root. */
export function fromRoot(...segments: string[]): string {
  return path.join(ROOT, ...segments);
}

/** Resolves a path inside `src/data`, where fixture files live. */
export function dataFile(...segments: string[]): string {
  return fromRoot('src', 'data', ...segments);
}

/** Reads a JSON file, typed by the caller. */
export function readJson<T = UnknownRecord>(filePath: string): T {
  const absolute = path.isAbsolute(filePath) ? filePath : fromRoot(filePath);
  if (!fs.existsSync(absolute)) {
    throw new ConfigurationError(`No such data file: ${absolute}`);
  }
  try {
    return JSON.parse(fs.readFileSync(absolute, 'utf8')) as T;
  } catch (error) {
    throw new ConfigurationError(`${absolute} is not valid JSON.`, { cause: error });
  }
}

/**
 * Reads a CSV into objects keyed by the header row.
 *
 * CSV is the right format for a data-driven suite because non-engineers can
 * edit it: a product owner adding a tax-rate case should not have to open a
 * TypeScript file.
 */
export function readCsv<T extends UnknownRecord = UnknownRecord>(filePath: string): T[] {
  const absolute = path.isAbsolute(filePath) ? filePath : fromRoot(filePath);
  if (!fs.existsSync(absolute)) {
    throw new ConfigurationError(`No such data file: ${absolute}`);
  }
  return parseCsvSync(fs.readFileSync(absolute, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    /* Blank cells become empty strings rather than undefined, so a case table
     * distinguishes "no value" from "the value is the empty string". */
    cast: false,
  });
}

/** Reads newline-delimited JSON from disk. */
export function readNdjson<T = UnknownRecord>(filePath: string): T[] {
  const absolute = path.isAbsolute(filePath) ? filePath : fromRoot(filePath);
  return fs
    .readFileSync(absolute, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/** Writes JSON, creating parent directories as needed. */
export function writeJson(filePath: string, value: unknown): void {
  const absolute = path.isAbsolute(filePath) ? filePath : fromRoot(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(value, null, 2));
}

/**
 * Creates a temporary file that is deleted when the process exits.
 *
 * Upload tests need a real file on disk; leaving it in the repository is how a
 * `.gitignore` grows entries nobody can explain a year later.
 */
export function tempFile(name: string, content: string | Buffer): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-api-'));
  const filePath = path.join(directory, name);
  fs.writeFileSync(filePath, content);
  process.once('exit', () => {
    try {
      fs.rmSync(directory, { recursive: true, force: true });
    } catch {
      /* Best effort — the OS cleans its own temp directory eventually. */
    }
  });
  return filePath;
}

/** A file of an exact size, for upload-limit and streaming tests. */
export function tempFileOfSize(name: string, bytes: number): string {
  return tempFile(name, Buffer.alloc(bytes, 'a'));
}

/** Hex checksum of a buffer or file — verifies a download round-tripped. */
export function checksum(input: Buffer | string, algorithm = 'sha256'): string {
  const data = typeof input === 'string' ? fs.readFileSync(input) : input;
  return crypto.createHash(algorithm).update(data).digest('hex');
}

/** Size of a file in bytes, or 0 when it does not exist. */
export function fileSize(filePath: string): number {
  return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
}

/** Saves a response payload under `reports/artifacts/` for later inspection. */
export function saveArtifact(name: string, content: string | Buffer): string {
  const target = fromRoot('reports', 'artifacts', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}
