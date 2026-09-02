/**
 * Playwright configuration.
 *
 * This file decides *how* the suite runs — which groups of tests exist, what
 * they share, how long they get, what evidence a failure leaves behind. It
 * does not decide *what* the suite talks to; that comes from `src/config`,
 * which validates the environment before this file reads a single value.
 *
 * Projects are the unit of organisation. Each one is a group of tests with its
 * own settings and its own place in the dependency order, which is what lets
 * "log in once, then run everything else" be expressed declaratively rather
 * than with a global variable.
 */
import { defineConfig } from '@playwright/test';
import { config } from './src/config/env.config';
import { TIMEOUTS } from './src/config/timeouts';

export default defineConfig({
  testDir: './tests',

  /* A whole-test budget. Individual requests have their own, much shorter,
   * timeouts; this one catches a test that is stuck rather than slow. */
  timeout: TIMEOUTS.TEST,
  globalTimeout: config.isCI ? 45 * 60 * 1000 : undefined,

  expect: {
    timeout: TIMEOUTS.EXPECT,
  },

  /* `forbidOnly` stops a `test.only` left in a branch from silently reducing
   * CI to one test — a green build that proved almost nothing. */
  forbidOnly: config.isCI,

  /* Retries in CI only. Locally a flaky test should be visible immediately;
   * in CI one retry distinguishes a genuine failure from a blip, and the
   * summary reporter counts anything that needed a retry as flaky rather than
   * passed, so retries cannot hide rot. */
  retries: config.isCI ? 2 : 0,

  /* API tests are IO-bound, so more workers than cores is usually right. The
   * ceiling exists because the target's rate limit, not this machine, is what
   * a large suite actually saturates. */
  workers: config.workers ?? (config.isCI ? 8 : 4),
  fullyParallel: true,

  maxFailures: config.isCI ? 50 : 0,

  globalSetup: './src/hooks/global.setup.ts',
  globalTeardown: './src/hooks/global.teardown.ts',

  outputDir: './test-results',

  reporter: [
    ['list', { printSteps: false }],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['junit', { outputFile: 'reports/junit/results.xml' }],
    ['json', { outputFile: 'reports/json/results.json' }],
    ['./src/reporters/summary.reporter.ts'],
    [
      'playwright-ctrf-json-reporter',
      { outputDir: 'reports/ctrf', outputFile: 'ctrf-report.json' },
    ],
    /* Optional reporters. Allure is heavy, so it is opt-in; the GitHub
     * reporter annotates a pull request and only makes sense inside Actions;
     * blob reports exist to be merged across shards. */
    ...(config.allure
      ? [['allure-playwright', { resultsDir: 'reports/allure-results' }] as const]
      : []),
    ...(process.env.GITHUB_ACTIONS ? [['github'] as const] : []),
    ...(process.env.PW_BLOB_REPORT ? [['blob', { outputDir: 'blob-report' }] as const] : []),
  ],

  use: {
    baseURL: config.baseUrl,

    /* Applied to every request the `request` fixture makes. Per-request
     * headers set through the framework's client always win. */
    extraHTTPHeaders: {
      accept: 'application/json',
      'x-test-run': 'playwright-api-framework',
    },

    ignoreHTTPSErrors: !config.verifyTls,

    /* A trace of an API test records every request and response, which is
     * usually enough to diagnose a failure without re-running anything. */
    trace: config.trace,

    actionTimeout: TIMEOUTS.MEDIUM,
    navigationTimeout: TIMEOUTS.MEDIUM,
  },

  projects: [
    /**
     * Authenticates once and writes the session to `storage/`. Every other
     * project depends on it, so nothing runs against an unauthenticated
     * target. Delete this project when the API uses OAuth client credentials —
     * the token fixture covers that case without a setup step.
     */
    {
      name: 'setup',
      testDir: './src/hooks',
      testMatch: /auth\.setup\.ts/,
      timeout: TIMEOUTS.HOOK,
    },

    /** The main suite: functional REST, GraphQL and streaming tests. */
    {
      name: 'api',
      testDir: './tests/api',
      dependencies: ['setup'],
    },

    /**
     * Contract tests. Separated because they answer a different question — not
     * "does this work" but "does this still match what we published" — and are
     * usually run on a different trigger, such as before a release.
     */
    {
      name: 'contract',
      testDir: './tests/contract',
      dependencies: ['setup'],
      timeout: TIMEOUTS.MEDIUM,
    },

    /**
     * Latency checks. Run serially: a percentile measured while eight workers
     * hammer the same endpoint measures the load, not the endpoint.
     */
    {
      name: 'performance',
      testDir: './tests/performance',
      dependencies: ['setup'],
      workers: 1,
      fullyParallel: false,
      retries: 0,
      timeout: TIMEOUTS.LONG,
    },

    /**
     * Authorisation, input handling and response hygiene. Kept separate so a
     * pipeline can run it against a dedicated environment, and so its
     * deliberately hostile payloads never run against production by accident.
     */
    {
      name: 'security',
      testDir: './tests/security',
      dependencies: ['setup'],
    },
  ],
});
