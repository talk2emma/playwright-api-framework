/**
 * Test data generation.
 *
 * Two rules shape this module.
 *
 * Generate, do not hard-code. A suite whose fixtures say `alice@example.com`
 * fails the second time it runs against an environment with a uniqueness
 * constraint, and passes forever against a database somebody seeded by hand.
 *
 * Generate *deterministically*. Faker is seeded per test from the test's own
 * title, so a failing run can be reproduced exactly, while two different tests
 * still get different data. Random-but-reproducible is the combination that
 * makes generated data safe to rely on.
 */
import { faker, Faker, en } from '@faker-js/faker';
import crypto from 'node:crypto';
import type { UnknownRecord } from '../types';

/** A Faker instance seeded from a string, so a title maps to stable data. */
export function seededFaker(seed: string): Faker {
  const instance = new Faker({ locale: en });
  instance.seed(hashToInt(seed));
  return instance;
}

/** Stable 32-bit hash — the same string always produces the same seed. */
function hashToInt(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

/** A run-unique identifier, safe to embed in names that must not collide. */
export function uniqueId(prefix = 'pw'): string {
  return `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

/* ------------------------------------------------------------------ */
/* Factories                                                           */
/* ------------------------------------------------------------------ */

/**
 * Builds objects from a template, with per-call overrides.
 *
 * The point is that a test states only what it cares about — `userFactory({
 * role: 'admin' })` — and the factory supplies everything else. When the API
 * adds a required field, the factory changes and no test does.
 */
function defineFactory<T extends UnknownRecord>(build: (faker: Faker) => T) {
  return (overrides: Partial<T> = {}, source: Faker = faker): T => ({
    ...build(source),
    ...overrides,
  });
}

/** A representative user payload. Adapt the shape to the API under test. */
export const buildUser = defineFactory((source) => ({
  email: `qa+${source.string.alphanumeric(8).toLowerCase()}@example.com`,
  firstName: source.person.firstName(),
  lastName: source.person.lastName(),
  phone: source.phone.number({ style: 'international' }),
  role: 'standard',
  active: true,
}));

/* ------------------------------------------------------------------ */
/* Adversarial input                                                   */
/* ------------------------------------------------------------------ */

/**
 * Strings that break naive input handling.
 *
 * Every one of these has caused a production incident somewhere: encoding
 * bugs, truncation at a byte boundary rather than a character boundary,
 * unescaped template interpolation, SQL built by concatenation.
 */
export const EDGE_CASE_STRINGS = {
  empty: '',
  whitespace: '   ',
  singleQuote: "O'Brien",
  doubleQuote: 'She said "hello"',
  backslash: 'C:\\Users\\test',
  unicode: 'Ünïcödé — ñ, ß, ø, 日本語, العربية',
  emoji: '👨‍👩‍👧‍👦 family, 🇬🇧 flag, 🏳️‍🌈',
  /* A combining sequence: renders as one character, is several code points. */
  combining: 'e\u0301\u0327',
  rightToLeft: 'مرحبا بالعالم',
  zeroWidth: 'a\u200Bb\u200Cc',
  newlines: 'line one\nline two\r\nline three',
  tabs: 'a\tb\tc',
  long: 'x'.repeat(5_000),
  htmlTags: '<b>bold</b> & <script>alert(1)</script>',
  templateLiteral: '${process.env.SECRET}',
  nullString: 'null',
  numericString: '007',
  leadingZeroNumber: '0123',
  scientificNotation: '1e10',
  negativeZero: '-0',
} as const;

/** Payloads a security test sends where a normal value is expected. */
export const INJECTION_PAYLOADS = {
  sqlUnion: "' UNION SELECT NULL,NULL--",
  sqlOr: "' OR '1'='1",
  sqlComment: "admin'--",
  noSql: '{"$gt": ""}',
  xssScript: '<script>alert(document.domain)</script>',
  xssImage: '<img src=x onerror=alert(1)>',
  pathTraversal: '../../../../etc/passwd',
  pathTraversalEncoded: '..%2F..%2F..%2Fetc%2Fpasswd',
  commandChain: '; cat /etc/passwd',
  commandSubstitution: '$(whoami)',
  templateInjection: '{{7*7}}',
  ldap: '*)(uid=*))(|(uid=*',
  crlf: 'value\r\nX-Injected: true',
  xxe: '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY e SYSTEM "file:///etc/passwd">]><r>&e;</r>',
} as const;
