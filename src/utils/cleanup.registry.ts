/**
 * Tracks resources a test created so they can be removed afterwards.
 *
 * API suites leak. A test creates an order, asserts something, and the order
 * stays forever; a thousand runs later the list endpoint is slow and somebody
 * spends a day cleaning a database by hand. The fix has to be cheap enough
 * that nobody skips it: register a deletion at the moment of creation, and let
 * a fixture drain the registry when the test ends.
 *
 * Deletions run in reverse order of registration, because a child resource
 * usually has to go before its parent, and creation order already encodes that
 * relationship. A failing deletion is reported but never fails the test — a
 * cleanup problem must not disguise itself as a product problem.
 */
import { logger } from './logger';
import type { Logger } from './logger';

/** One registered undo action. */
interface CleanupEntry {
  /** Human-readable name used in logs, e.g. `order 4821`. */
  readonly description: string;
  /** Runs the deletion. Errors are caught and logged. */
  readonly run: () => Promise<void>;
  /** Lower numbers are deleted last. Use for cross-cutting ordering. */
  readonly priority: number;
}

export class CleanupRegistry {
  private readonly entries: CleanupEntry[] = [];
  private readonly log: Logger;
  private drained = false;

  constructor(log: Logger = logger.child('cleanup')) {
    this.log = log;
  }

  /** Registers an undo action. Returns the value so it can wrap a creation. */
  register(description: string, run: () => Promise<void>, priority = 0): void {
    if (this.drained) {
      this.log.warn('registered after teardown; running immediately', { description });
      void run().catch((error: unknown) => {
        this.log.error('late cleanup failed', { description, error: String(error) });
      });
      return;
    }
    this.entries.push({ description, run, priority });
  }

  /**
   * Registers a deletion for a created resource and passes the resource
   * through, so a service method reads as one expression:
   * `return this.cleanup.track(created, \`user \${created.id}\`, () => …)`.
   */
  track<T>(value: T, description: string, remove: () => Promise<void>, priority = 0): T {
    this.register(description, remove, priority);
    return value;
  }

  /** How many undo actions are pending. */
  get size(): number {
    return this.entries.length;
  }

  /** Everything still registered, for assertions and diagnostics. */
  list(): readonly CleanupEntry[] {
    return [...this.entries];
  }

  /** Forgets an entry — use when the test itself already deleted the resource. */
  forget(description: string): void {
    const index = this.entries.findIndex((entry) => entry.description === description);
    if (index >= 0) this.entries.splice(index, 1);
  }

  /** Abandons everything without running it. For debugging a failing teardown. */
  discard(): void {
    this.entries.length = 0;
  }

  /**
   * Runs every registered deletion, highest priority first and newest first
   * within a priority. Never throws.
   */
  async drain(): Promise<{ removed: number; failed: number }> {
    this.drained = true;
    const ordered = [...this.entries].sort((a, b) => b.priority - a.priority).reverse();
    this.entries.length = 0;

    let removed = 0;
    let failed = 0;
    for (const entry of ordered) {
      try {
        await entry.run();
        removed += 1;
        this.log.debug('removed', { resource: entry.description });
      } catch (error) {
        failed += 1;
        this.log.warn('cleanup failed — resource may be left behind', {
          resource: entry.description,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (removed || failed) this.log.info('cleanup complete', { removed, failed });
    return { removed, failed };
  }
}
