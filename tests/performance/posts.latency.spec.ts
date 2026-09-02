/**
 * ===========================================================================
 * Latency budgets against a real API
 * ===========================================================================
 *
 * Target: https://jsonplaceholder.typicode.com — chosen because it is
 * unlimited, stable and fast, so a percentile measured against it is a
 * property of the endpoint rather than of a quota or a queue.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS IN ITS OWN PROJECT
 * ---------------------------------------------------------------------------
 * `playwright.config.ts` gives the `performance` project `workers: 1` and
 * `retries: 0`. Both matter.
 *
 *   · One worker, because a p95 measured while eight workers hammer the same
 *     endpoint describes the load the suite is generating, not the endpoint.
 *   · No retries, because a retried timing measurement is not a measurement.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS AND IS NOT
 * ---------------------------------------------------------------------------
 * This is correctness-adjacent performance signal: "this endpoint's p95 is
 * under N milliseconds from this machine". It is free, because the requests
 * are being made anyway.
 *
 * It is **not** a load test. Nothing here generates concurrency, and the
 * numbers say nothing about behaviour under real traffic. Treating it as a
 * load test would be worse than having no load test at all, because it would
 * feel like coverage.
 */
import { test, expect } from '../../src/fixtures';
import { sample, summarize, percentile } from '../../src/utils/performance.utils';

test.describe('posts — latency @performance', () => {
  test('a single read stays within its budget @smoke', async ({ api }) => {
    const response = await api.posts.rawPage(1, 10);

    /* An explicit per-request bound. Generous, because this asserts "not
     * pathologically slow" from a machine whose network we do not control. */
    expect(response).toRespondWithin(5_000);

    /* And the environment-wide budget, which comes from `latencyBudgetMs` on
     * the environment or from `LATENCY_BUDGET_MS`. Using the named budget
     * rather than a literal means a slow environment is retuned in one place. */
    response.expectWithinLatencyBudget();
  });

  test('the p95 of a repeated read is stable @slow', async ({ api }) => {
    /*
     * `sample` runs the operation repeatedly and summarises the distribution.
     * `warmup` runs are discarded: the first call to a cold endpoint measures
     * TLS setup and JIT rather than the endpoint, and including it would drag
     * every percentile upward for no reason.
     */
    const summary = await sample(() => api.posts.find(1), { runs: 20, warmup: 3 });

    /* Reported so a failure shows the whole distribution, not just the number
     * that broke — a p95 with no p50 beside it is hard to act on. */
    console.warn(
      `posts read — p50 ${summary.p50}ms · p90 ${summary.p90}ms · ` +
        `p95 ${summary.p95}ms · p99 ${summary.p99}ms · max ${summary.max}ms`,
    );

    expect(summary.count).toBe(20);
    expect(summary.p95, 'p95 for a cached read').toBeLessThan(5_000);

    /*
     * The tail check. A p99 many times the p50 means an unstable endpoint even
     * when the average looks fine — and the tail is what users actually feel.
     * The multiple is loose because this is a shared public service.
     */
    expect(summary.p99).toBeLessThan(Math.max(summary.p50 * 20, 8_000));
  });

  test('the latency collector reports per-route percentiles', async ({ api, latency }) => {
    /* Every request a test makes is sampled automatically by the `latency`
     * fixture, which attaches the report to the test as `latency.json`. No
     * setup is needed — this test just checks the mechanism works. */
    for (const id of [1, 2, 3, 4, 5]) await api.posts.find(id);

    const report = latency.report();
    expect(report.length).toBeGreaterThan(0);

    /* Identifiers are collapsed, so `/posts/1` and `/posts/2` are one route.
     * Without that, every request would be its own bucket and no distribution
     * would ever have more than one sample in it. */
    const route = report.find((entry) => entry.route.includes('{id}'));
    expect(route, 'ids must be collapsed into {id}').toBeDefined();
    expect(route?.summary.count).toBe(5);
  });

  test('percentile maths is nearest-rank', () => {
    /* A pure unit check of the statistic itself, so a failing budget elsewhere
     * can never be blamed on the arithmetic.
     *
     * Nearest-rank rather than interpolation, because it always returns a
     * value that was actually observed — which is what makes a reported p95
     * defensible in a conversation with the team that owns the service. */
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

    expect(percentile(samples, 50)).toBe(50);
    expect(percentile(samples, 90)).toBe(90);
    expect(percentile(samples, 100)).toBe(100);
    expect(percentile([], 95)).toBe(0);

    const summary = summarize(samples);
    expect(summary.min).toBe(10);
    expect(summary.max).toBe(100);
    expect(summary.mean).toBe(55);
  });
});
