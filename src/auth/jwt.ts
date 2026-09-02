/**
 * JWT inspection.
 *
 * Deliberately decode-only. Verifying a signature needs the issuer's key and
 * is the API's job, not the suite's; what a test legitimately needs is to read
 * the claims it was given — to assert that a token carries the right scopes,
 * expires when it should, and identifies the user the test logged in as.
 *
 * Never treat a decoded token as trusted. This parses, it does not verify.
 */
import { ConfigurationError } from '../core/errors';
import type { UnknownRecord } from '../types';

/** The registered claims most APIs use, plus room for custom ones. */
interface JwtClaims extends UnknownRecord {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  /** Expiry, in seconds since the epoch — note: seconds, not milliseconds. */
  exp?: number;
  iat?: number;
  nbf?: number;
  jti?: string;
  scope?: string;
  scp?: string[];
  roles?: string[];
}

interface DecodedJwt {
  readonly header: UnknownRecord;
  readonly claims: JwtClaims;
  /** The signature segment, unverified — present so a test can assert it exists. */
  readonly signature: string;
}

/** Splits and base64url-decodes a token. Throws when it is not a JWT. */
export function decodeJwt(token: string): DecodedJwt {
  const stripped = token.replace(/^Bearer\s+/i, '').trim();
  const parts = stripped.split('.');
  if (parts.length !== 3) {
    throw new ConfigurationError(
      `Not a JWT: expected three dot-separated segments, found ${parts.length}.`,
    );
  }
  return {
    header: decodeSegment(parts[0] ?? '', 'header'),
    claims: decodeSegment(parts[1] ?? '', 'payload'),
    signature: parts[2] ?? '',
  };
}

function decodeSegment(segment: string, which: string): UnknownRecord {
  try {
    /* base64url differs from base64 in two characters and drops padding. */
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as UnknownRecord;
  } catch (error) {
    throw new ConfigurationError(`JWT ${which} segment is not valid base64url JSON.`, {
      cause: error,
    });
  }
}
