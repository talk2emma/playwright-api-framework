/**
 * Caches access tokens so a suite authenticates once, not once per request.
 *
 * Two costs make this worth having. A token endpoint is often rate-limited
 * harder than the API itself, so a hundred parallel tests each fetching their
 * own token will start failing with 429s that look like product bugs. And a
 * token round trip added to every request roughly doubles a suite's runtime.
 *
 * Tokens are treated as expired slightly before they actually are, because a
 * token that expires mid-flight produces a 401 that nobody can reproduce.
 */
import fs from 'node:fs';
import path from 'node:path';
import { logger } from '../utils/logger';

/** A token with the moment it stops being usable. */
export interface CachedToken {
  readonly value: string;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
  /** Refresh token, when the flow issued one. */
  readonly refreshToken?: string;
  /** Token type for the `Authorization` header. Almost always `Bearer`. */
  readonly type: string;
}

/** Renew this many milliseconds before real expiry. */
const EXPIRY_SKEW_MS = 30_000;

const log = logger.child('auth:tokens');

export class TokenStore {
  private readonly memory = new Map<string, CachedToken>();
  private readonly file: string | undefined;

  /**
   * @param persistTo Optional JSON file under `storage/`. Persisting lets
   * separate worker processes share one token; the file is git-ignored because
   * it contains live credentials.
   */
  constructor(persistTo?: string) {
    this.file = persistTo;
    if (persistTo && fs.existsSync(persistTo)) this.loadFromDisk(persistTo);
  }

  /** A cached token for a key, or `undefined` when absent or near expiry. */
  get(key: string): CachedToken | undefined {
    const entry = this.memory.get(key);
    if (!entry) return undefined;
    if (Date.now() + EXPIRY_SKEW_MS >= entry.expiresAt) {
      log.debug('cached token is within the expiry skew; discarding', { key });
      this.memory.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, token: CachedToken): void {
    this.memory.set(key, token);
    this.persist();
  }

  /** Returns the cached token, or produces and caches a new one. */
  async getOrCreate(key: string, produce: () => Promise<CachedToken>): Promise<CachedToken> {
    const cached = this.get(key);
    if (cached) return cached;
    const fresh = await produce();
    this.set(key, fresh);
    return fresh;
  }

  /** Drops one key, or everything when no key is given. */
  invalidate(key?: string): void {
    if (key) this.memory.delete(key);
    else this.memory.clear();
    this.persist();
  }

  /** Convenience for building `expiresAt` from an `expires_in` in seconds. */
  static expiryFromSeconds(seconds: number | undefined, fallbackSeconds = 3600): number {
    return Date.now() + (seconds ?? fallbackSeconds) * 1000;
  }

  private loadFromDisk(file: string): void {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, CachedToken>;
      for (const [key, token] of Object.entries(raw)) this.memory.set(key, token);
      log.debug('loaded tokens from disk', { file, count: this.memory.size });
    } catch (error) {
      /* A corrupt cache must never fail a run — the worst case is one extra
       * token request, which is exactly what happens when we ignore it. */
      log.warn('ignoring unreadable token cache', { file, error: String(error) });
    }
  }

  private persist(): void {
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.memory), null, 2), {
        mode: 0o600,
      });
    } catch (error) {
      log.warn('could not persist token cache', { file: this.file, error: String(error) });
    }
  }
}

/** Process-wide store. One per worker; workers do not share memory. */
export const tokenStore = new TokenStore();
