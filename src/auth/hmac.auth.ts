/**
 * HMAC request signing.
 *
 * Payment, banking and webhook APIs commonly require each request to carry a
 * signature over its own method, path, timestamp and body. Getting the
 * canonical string even slightly wrong — a trailing slash, the wrong case, the
 * body hashed before rather than after serialisation — produces a 401 with no
 * further explanation, so the canonical form is spelled out here in one place
 * and documented rather than reconstructed in each test.
 *
 * Adjust `canonicalString` to match the API under test; the rest stays.
 */
import crypto from 'node:crypto';
import type { HeaderMap, RequestSpec } from '../types';
import { config } from '../config/env.config';
import { ConfigurationError } from '../core/errors';

export interface HmacOptions {
  /** Key identifier sent alongside the signature. */
  readonly keyId?: string;
  /** Shared secret. Never hard-code — read it from the environment. */
  readonly secret?: string;
  /** Digest algorithm. `sha256` unless the API says otherwise. */
  readonly algorithm?: 'sha256' | 'sha512' | 'sha1';
  /** Header carrying the signature. */
  readonly signatureHeader?: string;
  /** Header carrying the timestamp used in the signature. */
  readonly timestampHeader?: string;
  /** Header carrying the key id. */
  readonly keyIdHeader?: string;
  /** `hex` or `base64`, whichever the API expects. */
  readonly encoding?: 'hex' | 'base64';
}

/**
 * Signs a request. Unlike the other providers this one needs the request
 * itself, so it is applied by `signRequest` rather than through the plain
 * `AuthProvider` interface.
 */
export class HmacSigner {
  readonly name = 'hmac';
  private readonly keyId: string;
  private readonly secret: string;
  private readonly algorithm: 'sha256' | 'sha512' | 'sha1';
  private readonly signatureHeader: string;
  private readonly timestampHeader: string;
  private readonly keyIdHeader: string;
  private readonly encoding: 'hex' | 'base64';

  constructor(options: HmacOptions = {}) {
    this.keyId = options.keyId ?? config.hmac.keyId ?? '';
    this.secret = options.secret ?? config.hmac.secret ?? '';
    if (!this.secret) {
      throw new ConfigurationError('HMAC signing needs a secret. Set HMAC_SECRET in .env.');
    }
    this.algorithm = options.algorithm ?? 'sha256';
    this.signatureHeader = (options.signatureHeader ?? 'x-signature').toLowerCase();
    this.timestampHeader = (options.timestampHeader ?? 'x-timestamp').toLowerCase();
    this.keyIdHeader = (options.keyIdHeader ?? 'x-key-id').toLowerCase();
    this.encoding = options.encoding ?? 'hex';
  }

  /** Headers to add to a request, including its signature. */
  sign(spec: Pick<RequestSpec, 'method' | 'url' | 'bodyKind' | 'json' | 'text'>): HeaderMap {
    const timestamp = String(Date.now());
    const signature = this.signature(this.canonicalString(spec, timestamp));
    const headers: HeaderMap = {
      [this.timestampHeader]: timestamp,
      [this.signatureHeader]: signature,
    };
    if (this.keyId) headers[this.keyIdHeader] = this.keyId;
    return headers;
  }

  /**
   * The exact bytes that get signed.
   *
   * The default is the most common convention: verb, path with query,
   * timestamp and a hash of the body, newline-separated. Change this method —
   * and only this method — when the API under test uses a different form.
   */
  canonicalString(
    spec: Pick<RequestSpec, 'method' | 'url' | 'bodyKind' | 'json' | 'text'>,
    timestamp: string,
  ): string {
    const url = new URL(spec.url);
    const body = this.bodyString(spec);
    const bodyHash = crypto.createHash(this.algorithm).update(body).digest('hex');
    return [spec.method.toUpperCase(), `${url.pathname}${url.search}`, timestamp, bodyHash].join(
      '\n',
    );
  }

  /** Verifies a signature — used when the suite acts as a webhook receiver. */
  verify(payload: string, signature: string): boolean {
    const expected = this.signature(payload);
    const a = Buffer.from(expected);
    const b = Buffer.from(signature);
    /* Constant-time comparison: a webhook verifier that leaks timing is a real
     * finding, and the suite should model correct behaviour. */
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** The raw digest of an arbitrary payload. */
  signature(payload: string): string {
    return crypto.createHmac(this.algorithm, this.secret).update(payload).digest(this.encoding);
  }

  private bodyString(spec: Pick<RequestSpec, 'bodyKind' | 'json' | 'text'>): string {
    if (spec.bodyKind === 'json') return JSON.stringify(spec.json ?? {});
    if (spec.bodyKind === 'text') return spec.text ?? '';
    return '';
  }
}
