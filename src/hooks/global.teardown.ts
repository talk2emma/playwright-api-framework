/**
 * Runs once, after every test has finished.
 *
 * Kept deliberately small. Per-test cleanup belongs in the `cleanup` fixture,
 * which runs even when a test fails and knows what that test created; global
 * teardown runs once and knows nothing, so anything it deletes it deletes
 * blindly. What belongs here is closing shared resources and writing a summary
 * of the run as a whole.
 */
import fs from 'node:fs';
import { config } from '../config/env.config';
import { fromRoot } from '../utils/file.utils';
import { tokenStore } from '../auth/token.store';
import { logger } from '../utils/logger';

const log = logger.child('teardown');

export default function globalTeardown(): void {
  /* Tokens are credentials. Dropping them at the end of the run keeps a live
   * access token from lingering in a cache file on a shared build agent. */
  tokenStore.invalidate();

  const contextFile = fromRoot('reports', 'run-context.json');
  if (fs.existsSync(contextFile)) {
    const context = JSON.parse(fs.readFileSync(contextFile, 'utf8')) as { startedAt: string };
    const durationMs = Date.now() - Date.parse(context.startedAt);
    fs.writeFileSync(
      contextFile,
      JSON.stringify({ ...context, finishedAt: new Date().toISOString(), durationMs }, null, 2),
    );
    log.info('run finished', {
      environment: config.env,
      durationSeconds: Math.round(durationMs / 1000),
    });
  }
}
