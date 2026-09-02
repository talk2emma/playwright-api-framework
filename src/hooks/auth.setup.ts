/**
 * Captures a session once, before the suite runs.
 *
 * This is the only file in the framework that knows anything about a specific
 * API's login endpoint, and that is on purpose: when the login contract
 * changes, exactly one file changes.
 *
 * It runs as a Playwright *project* rather than in `globalSetup`, which buys
 * three things: it shows up in the report as a real step, it retries like any
 * other test, and every other project can declare `dependencies: ['setup']` so
 * nothing starts until credentials exist.
 *
 * Only useful for APIs that authenticate by session or long-lived token. When
 * the API uses OAuth client credentials, delete this file and the setup
 * project — the token fixture already handles it.
 */
import { test as setup, expect } from '@playwright/test';
import fs from 'node:fs';
import { config, getUser, hasUser } from '../config/env.config';
import { fromRoot } from '../utils/file.utils';
import { TokenStore } from '../auth/token.store';
import { logger } from '../utils/logger';

const log = logger.child('auth-setup');

/** Where the captured token is written. Git-ignored — it is a live credential. */
const TOKEN_FILE = fromRoot('storage', `tokens-${config.env}.json`);

setup('capture an authenticated session', async ({ request }) => {
  setup.skip(!hasUser('standard'), 'No STANDARD_USERNAME/STANDARD_PASSWORD configured.');

  const credentials = getUser('standard');

  /* ---- Adapt from here down to the API under test. ------------------ */
  const response = await request.post(`${config.baseUrl}${config.apiPrefix}/auth/login`, {
    data: { username: credentials.username, password: credentials.password },
    failOnStatusCode: false,
  });

  expect(
    response.status(),
    `Login failed. Check the credentials in .env and the path in src/hooks/auth.setup.ts.\n` +
      `Response: ${(await response.text()).slice(0, 400)}`,
  ).toBe(200);

  const payload = (await response.json()) as {
    accessToken?: string;
    token?: string;
    expiresIn?: number;
  };
  const token = payload.accessToken ?? payload.token;
  expect(token, 'The login response contained no token field.').toBeTruthy();
  /* ---- Adapt to here. ----------------------------------------------- */

  fs.mkdirSync(fromRoot('storage'), { recursive: true });
  fs.writeFileSync(
    TOKEN_FILE,
    JSON.stringify(
      {
        standard: {
          value: token,
          type: 'Bearer',
          expiresAt: TokenStore.expiryFromSeconds(payload.expiresIn),
        },
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  log.info('session captured', { file: TOKEN_FILE, role: 'standard' });
});
