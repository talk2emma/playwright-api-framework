/**
 * Runs once, before any test in the run.
 *
 * Its job is to fail fast and loudly when the run cannot possibly succeed.
 * A suite that starts against an unreachable environment produces hundreds of
 * confusing connection errors; this turns that into one sentence naming the
 * URL it could not reach. The rule of thumb: anything whose failure would make
 * every test fail belongs here, and nothing else does.
 */
import type { FullConfig } from '@playwright/test';
import { request } from '@playwright/test';
import fs from 'node:fs';
import { config } from '../config/env.config';
import { fromRoot } from '../utils/file.utils';
import { logger } from '../utils/logger';

const log = logger.child('setup');

export default async function globalSetup(_playwrightConfig: FullConfig): Promise<void> {
  const startedAt = Date.now();

  log.info('run starting', {
    environment: config.env,
    baseUrl: config.baseUrl,
    workers: config.workers ?? 'auto',
    strictContracts: config.strictContracts,
    readOnly: config.readOnly,
  });

  /* Directories are created up front so a reporter writing its first file
   * never races another worker doing the same. */
  for (const directory of ['reports', 'reports/recordings', 'reports/artifacts', 'storage']) {
    fs.mkdirSync(fromRoot(directory), { recursive: true });
  }

  await verifyReachable();

  fs.writeFileSync(
    fromRoot('reports', 'run-context.json'),
    JSON.stringify(
      {
        environment: config.env,
        baseUrl: config.baseUrl,
        startedAt: new Date(startedAt).toISOString(),
        ci: config.isCI,
        commit: process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA ?? null,
        branch: process.env.GITHUB_REF_NAME ?? process.env.CI_COMMIT_BRANCH ?? null,
      },
      null,
      2,
    ),
  );
}

/**
 * Confirms the target answers at all.
 *
 * Deliberately tolerant about *what* it answers: a 401 or a 404 still proves
 * the host is up and reachable, which is the only thing this check is for.
 * Only a transport failure stops the run.
 */
async function verifyReachable(): Promise<void> {
  /*
   * Some environments have no server to reach. The contract suite stubs every
   * response at the transport layer, so probing its nominal origin would fail
   * on a port nothing was ever meant to listen on — turning a deliberately
   * offline run into a hard startup error.
   */
  if (!config.requiresLiveTarget) {
    log.info('skipping the reachability probe', {
      environment: config.env,
      reason: 'this environment is served by stubs, not by a live target',
    });
    return;
  }

  const context = await request.newContext({
    ignoreHTTPSErrors: !config.verifyTls,
    timeout: 15_000,
  });
  try {
    const response = await context.get(config.baseUrl, { failOnStatusCode: false });
    log.info('target reachable', { url: config.baseUrl, status: response.status() });
  } catch (error) {
    throw new Error(
      `Cannot reach ${config.baseUrl}.\n\n` +
        `  TEST_ENV is "${config.env}".\n` +
        `  Check the URL in src/config/environments.ts, or set API_BASE_URL in .env.\n` +
        `  If the target needs a VPN or tunnel, start it before running the suite.\n\n` +
        `  Underlying error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  } finally {
    await context.dispose();
  }
}
