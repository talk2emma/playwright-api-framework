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
import type { PartialBy, UnknownRecord } from '../types';

/** A Faker instance seeded from a string, so a title maps to stable data. */
export function seededFaker(seed: string): Faker {
  const instance = new Faker({ locale: en });
  instance.seed(hashToInt(seed));
  return instance;
}

/** Stable 32-bit hash — the same string always produces the same seed. */
export function hashToInt(value: string): number {
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

/** An email address that is unique per call and routes nowhere. */
export function uniqueEmail(prefix = 'test'): string {
  return `${prefix}+${uniqueId('')}@example.com`;
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
export function defineFactory<T extends UnknownRecord>(build: (faker: Faker) => T) {
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

/** A representative address payload. */
export const buildAddress = defineFactory((source) => ({
  line1: source.location.streetAddress(),
  line2: source.location.secondaryAddress(),
  city: source.location.city(),
  postalCode: source.location.zipCode(),
  country: source.location.countryCode(),
}));

/** A representative order payload with a nested line-item collection. */
export const buildOrder = defineFactory((source) => ({
  reference: `ORD-${source.string.numeric(8)}`,
  currency: 'GBP',
  items: Array.from({ length: source.number.int({ min: 1, max: 4 }) }, () => ({
    sku: source.string.alphanumeric(10).toUpperCase(),
    quantity: source.number.int({ min: 1, max: 5 }),
    unitPriceMinor: source.number.int({ min: 100, max: 50_000 }),
  })),
}));

/** Removes keys so a factory result can drive a "missing field" test. */
export function without<T extends UnknownRecord, K extends keyof T>(
  value: T,
  ...keys: K[]
): PartialBy<T, K> {
  /* Rebuilt rather than deleted from: `delete` on a computed key deoptimises
   * the object's shape, and the result here is thrown away immediately anyway. */
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.includes(key as K)),
  ) as PartialBy<T, K>;
}

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

/** Numbers that break naive numeric handling. */
export const EDGE_CASE_NUMBERS = {
  zero: 0,
  negative: -1,
  maxSafeInteger: Number.MAX_SAFE_INTEGER,
  /* One past the safe range. JavaScript cannot even represent this as a
   * literal, which is the point: send it as a string and check whether the API
   * round-trips it or silently rewrites it to 9007199254740992. */
  beyondSafeInteger: '9007199254740993',
  float: 0.1 + 0.2,
  verySmall: 1e-10,
  veryLarge: 1e308,
} as const;

/** Dates that break naive date handling. */
export const EDGE_CASE_DATES = {
  epoch: '1970-01-01T00:00:00Z',
  leapDay: '2024-02-29T12:00:00Z',
  endOfYear: '2025-12-31T23:59:59Z',
  /* A leap second: valid in ISO 8601, rejected by several date libraries. */
  leapSecond: '2016-12-31T23:59:60Z',
  farFuture: '9999-12-31T23:59:59Z',
  beforeEpoch: '1900-01-01T00:00:00Z',
  offsetPositive: '2026-06-01T12:00:00+05:30',
  offsetNegative: '2026-06-01T12:00:00-08:00',
} as const;

/** A deterministic buffer of a given size, for upload-limit tests. */
export function payloadOfSize(bytes: number, fill = 'a'): Buffer {
  return Buffer.alloc(bytes, fill);
}

/** Deeply nested JSON, for testing parser depth limits. */
export function deeplyNested(depth: number): UnknownRecord {
  let node: UnknownRecord = { value: 'leaf' };
  for (let level = 0; level < depth; level += 1) node = { child: node };
  return node;
}
