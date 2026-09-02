/**
 * Header parsing.
 *
 * HTTP headers are case-insensitive, may repeat, and several of the ones that
 * matter for testing — `Set-Cookie`, `Link`, `Retry-After`, `Content-Type` —
 * carry structured values inside a single string. Parsing them in one place
 * keeps that fiddly, easy-to-get-subtly-wrong logic out of the tests.
 */
import type { HeaderMap } from '../types';

/** Case-insensitive single header lookup. */
export function getHeader(headers: HeaderMap, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/** One `Set-Cookie` entry, split into its name, value and attributes. */
export interface ParsedCookie {
  readonly name: string;
  readonly value: string;
  readonly domain?: string;
  readonly path?: string;
  readonly expires?: string;
  readonly maxAge?: number;
  readonly secure: boolean;
  readonly httpOnly: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Parses `Set-Cookie`. Playwright joins repeated headers with a newline, so
 * that is the separator honoured here — splitting on commas would break on the
 * comma inside an `Expires` date.
 */
export function parseSetCookie(raw: string | undefined): ParsedCookie[] {
  if (!raw) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseOneCookie);
}

function parseOneCookie(line: string): ParsedCookie {
  const [pair, ...attributes] = line.split(';');
  const separator = (pair ?? '').indexOf('=');
  const name = separator === -1 ? (pair ?? '').trim() : (pair ?? '').slice(0, separator).trim();
  const value = separator === -1 ? '' : (pair ?? '').slice(separator + 1).trim();

  const cookie: {
    name: string;
    value: string;
    secure: boolean;
    httpOnly: boolean;
    domain?: string;
    path?: string;
    expires?: string;
    maxAge?: number;
    sameSite?: 'Strict' | 'Lax' | 'None';
  } = { name, value, secure: false, httpOnly: false };

  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = (rawKey ?? '').trim().toLowerCase();
    const attributeValue = rest.join('=').trim();
    if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'domain') cookie.domain = attributeValue;
    else if (key === 'path') cookie.path = attributeValue;
    else if (key === 'expires') cookie.expires = attributeValue;
    else if (key === 'max-age') cookie.maxAge = Number(attributeValue);
    else if (key === 'samesite') cookie.sameSite = capitalizeSameSite(attributeValue);
  }
  return cookie;
}

function capitalizeSameSite(value: string): 'Strict' | 'Lax' | 'None' | undefined {
  const lower = value.toLowerCase();
  if (lower === 'strict') return 'Strict';
  if (lower === 'lax') return 'Lax';
  if (lower === 'none') return 'None';
  return undefined;
}

/** `application/json; charset=utf-8` split into its media type and parameters. */
interface ParsedContentType {
  readonly mediaType: string;
  readonly charset?: string;
  readonly boundary?: string;
  readonly parameters: Record<string, string>;
}

export function parseContentType(raw: string | undefined): ParsedContentType {
  if (!raw) return { mediaType: '', parameters: {} };
  const [type, ...rest] = raw.split(';');
  const parameters: Record<string, string> = {};
  for (const part of rest) {
    const [key, ...value] = part.split('=');
    if (!key) continue;
    parameters[key.trim().toLowerCase()] = value.join('=').trim().replace(/^"|"$/g, '');
  }
  const result: {
    mediaType: string;
    parameters: Record<string, string>;
    charset?: string;
    boundary?: string;
  } = { mediaType: (type ?? '').trim().toLowerCase(), parameters };
  if (parameters.charset) result.charset = parameters.charset;
  if (parameters.boundary) result.boundary = parameters.boundary;
  return result;
}

/** True when a content type is JSON, including `+json` suffixes like HAL. */
export function isJsonContentType(raw: string | undefined): boolean {
  const { mediaType } = parseContentType(raw);
  return mediaType === 'application/json' || mediaType.endsWith('+json');
}

/** One relation from an RFC 8288 `Link` header. */
interface LinkRelation {
  readonly url: string;
  readonly rel: string;
  readonly parameters: Record<string, string>;
}

/** Parses `Link: <…>; rel="next", <…>; rel="last"` — GitHub-style pagination. */
export function parseLinkHeader(raw: string | undefined): LinkRelation[] {
  if (!raw) return [];
  const links: LinkRelation[] = [];
  for (const entry of raw.split(/,\s*(?=<)/)) {
    const match = /^\s*<([^>]*)>\s*(.*)$/.exec(entry);
    if (!match?.[1]) continue;
    const parameters: Record<string, string> = {};
    for (const part of (match[2] ?? '').split(';')) {
      const [key, ...value] = part.split('=');
      if (!key?.trim()) continue;
      parameters[key.trim().toLowerCase()] = value.join('=').trim().replace(/^"|"$/g, '');
    }
    links.push({ url: match[1], rel: parameters.rel ?? '', parameters });
  }
  return links;
}

/** The `next` URL from a `Link` header, when the server sent one. */
export function nextLink(raw: string | undefined): string | undefined {
  return parseLinkHeader(raw).find((link) => link.rel === 'next')?.url;
}

/**
 * `Retry-After` in milliseconds. The header is either delta-seconds or an
 * HTTP date; both forms are normalised so backoff code has one thing to read.
 */
export function parseRetryAfter(raw: string | undefined, now = Date.now()): number | undefined {
  if (!raw) return undefined;
  const seconds = Number(raw.trim());
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** Rate-limit counters, using the widely adopted `X-RateLimit-*` convention. */
export interface RateLimitInfo {
  readonly limit?: number;
  readonly remaining?: number;
  /** Epoch milliseconds when the window resets. */
  readonly resetAt?: number;
  readonly retryAfterMs?: number;
}

export function parseRateLimit(headers: HeaderMap, now = Date.now()): RateLimitInfo {
  const number = (name: string): number | undefined => {
    const value = getHeader(headers, name);
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const reset = number('x-ratelimit-reset');
  const info: { limit?: number; remaining?: number; resetAt?: number; retryAfterMs?: number } = {};
  const limit = number('x-ratelimit-limit');
  const remaining = number('x-ratelimit-remaining');
  if (limit !== undefined) info.limit = limit;
  if (remaining !== undefined) info.remaining = remaining;
  /* Servers send either an epoch timestamp or a delta in seconds; anything
   * smaller than a year of seconds is treated as a delta. */
  if (reset !== undefined) info.resetAt = reset > 31_536_000 ? reset * 1000 : now + reset * 1000;
  const retryAfter = parseRetryAfter(getHeader(headers, 'retry-after'), now);
  if (retryAfter !== undefined) info.retryAfterMs = retryAfter;
  return info;
}

/** Redacts credentials before headers reach a log or a report attachment. */
const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'api-key',
  'x-auth-token',
  'x-amz-security-token',
  'x-signature',
];

export function redactHeaders(headers: HeaderMap): HeaderMap {
  const out: HeaderMap = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = SENSITIVE_HEADERS.includes(key.toLowerCase()) ? redactValue(value) : value;
  }
  return out;
}

/** Keeps enough of a value to correlate it in logs without exposing it. */
function redactValue(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars, redacted)`;
}
