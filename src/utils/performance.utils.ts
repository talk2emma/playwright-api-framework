/**
 * Latency measurement.
 *
 * An API suite is the cheapest place a team ever gets performance signal: the
 * requests are already being made, so the timings are already there. What is
 * usually missing is the discipline to look at a *distribution* rather than a
 * single number — a mean hides the tail, and the tail is what users feel.
 *
 * These helpers are for correctness-adjacent performance checks: "this
 * endpoint's p95 is under 400ms". They are not a load-testing tool, and should
 * not be used to pretend one exists.
 */
import type { ExchangeRecord } from '../types';

/** A summary of many samples. */
export interface LatencySummary {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p90: number;
  readonly p95: number;
  readonly p99: number;
  /** Standard deviation — a large value means an unstable endpoint. */
  readonly stdDev: number;
}

/**
 * A percentile using nearest-rank on a sorted sample.
 *
 * Nearest-rank rather than interpolation because it always returns a value
 * that was actually observed, which is what makes a reported p95 defensible in
 * a conversation with the team that owns the service.
 */
export function percentile(samples: readonly number[], p: number): number {
  if (!samples.length) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index] ?? 0;
}

/** Summarises a set of durations in milliseconds. */
export function summarize(samples: readonly number[]): LatencySummary {
  if (!samples.length) {
    return { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, stdDev: 0 };
  }
  const mean = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / samples.length;
  return {
    count: samples.length,
    min: Math.min(...samples),
    max: Math.max(...samples),
    mean: Math.round(mean),
    p50: percentile(samples, 50),
    p90: percentile(samples, 90),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    stdDev: Math.round(Math.sqrt(variance)),
  };
}

/**
 * Collects timings across a test or a whole run.
 *
 * Attach it to a client with `client.onExchange(collector.record)` and every
 * request is sampled with no further ceremony.
 */
export class LatencyCollector {
  private readonly samples = new Map<string, number[]>();

  /** Records one exchange. Bind before passing to `onExchange`. */
  readonly record = (exchange: ExchangeRecord): void => {
    const key = `${exchange.method} ${routeOf(exchange.url)}`;
    const bucket = this.samples.get(key) ?? [];
    bucket.push(exchange.timing.durationMs);
    this.samples.set(key, bucket);
  };

  /** Adds a sample by hand — for work that is not a single HTTP request. */
  add(key: string, durationMs: number): void {
    const bucket = this.samples.get(key) ?? [];
    bucket.push(durationMs);
    this.samples.set(key, bucket);
  }

  /** The summary for one route. */
  summaryFor(key: string): LatencySummary {
    return summarize(this.samples.get(key) ?? []);
  }

  /** Every route sampled, slowest p95 first. */
  report(): { route: string; summary: LatencySummary }[] {
    return [...this.samples.entries()]
      .map(([route, values]) => ({ route, summary: summarize(values) }))
      .sort((a, b) => b.summary.p95 - a.summary.p95);
  }

  /** Routes whose p95 exceeds a budget — the list worth failing a build on. */
  breaches(budgetMs: number): { route: string; p95: number }[] {
    return this.report()
      .filter((entry) => entry.summary.p95 > budgetMs)
      .map((entry) => ({ route: entry.route, p95: entry.summary.p95 }));
  }

  clear(): void {
    this.samples.clear();
  }
}

/** Times one operation and returns the value alongside its duration. */
async function measure<T>(operation: () => Promise<T>): Promise<{ value: T; durationMs: number }> {
  const startedAt = performance.now();
  const value = await operation();
  return { value, durationMs: Math.round(performance.now() - startedAt) };
}

/**
 * Runs an operation repeatedly and summarises the result.
 *
 * `warmup` runs are discarded, because the first call to a cold endpoint
 * measures connection setup and JIT rather than the endpoint itself.
 */
export async function sample(
  operation: () => Promise<unknown>,
  options: { runs?: number; warmup?: number; concurrency?: number } = {},
): Promise<LatencySummary> {
  const runs = options.runs ?? 20;
  const warmup = options.warmup ?? 2;
  const concurrency = options.concurrency ?? 1;
  const durations: number[] = [];

  for (let index = 0; index < warmup; index += 1) await operation();

  let remaining = runs;
  while (remaining > 0) {
    const batch = Math.min(concurrency, remaining);
    const results = await Promise.all(
      Array.from({ length: batch }, async () => (await measure(operation)).durationMs),
    );
    durations.push(...results);
    remaining -= batch;
  }
  return summarize(durations);
}

/**
 * Collapses identifiers in a URL path so `/users/1` and `/users/2` are one
 * route. Without this every request would be its own bucket and no
 * distribution would ever have more than one sample in it.
 */
function routeOf(url: string): string {
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split('?')[0] ?? url;
  }
  return pathname
    .split('/')
    .map((segment) => {
      if (/^\d+$/.test(segment)) return '{id}';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment))
        return '{uuid}';
      if (/^[0-9a-f]{24,}$/i.test(segment)) return '{hash}';
      return segment;
    })
    .join('/');
}
