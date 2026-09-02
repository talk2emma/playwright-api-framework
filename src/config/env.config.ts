/**
 * The single place in the framework that reads `process.env`.
 *
 * Everything else imports the frozen `config` object below. That keeps
 * environment access auditable — one file to review for secret handling — and
 * means a missing or malformed variable fails once, loudly, at start-up rather
 * than as a confusing `undefined` deep inside a request.
 */
import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
/*
 * zod v3 is pinned deliberately. The v4 CommonJS build fails to initialise
 * under Playwright's transform (`core._string is not a function`), and
 * Playwright loads config files through that transform.
 */
import { z } from 'zod';
import { ENVIRONMENTS, ENVIRONMENT_NAMES } from './environments';
import type { EnvironmentDefinition, EnvironmentName } from './environments';

const ROOT = process.cwd();

/* Base file first, then the environment-specific overlay. `override: false`
 * means a variable already exported in the shell always wins, which is how CI
 * injects secrets without editing files. */
dotenv.config({ path: path.join(ROOT, '.env'), override: false, quiet: true });

const requestedEnv = (process.env.TEST_ENV ?? 'demo').trim();
const overlay = path.join(ROOT, `.env.${requestedEnv}`);
if (fs.existsSync(overlay)) {
  dotenv.config({ path: overlay, override: false, quiet: true });
}

/* ------------------------------------------------------------------ */
/* Coercion helpers                                                    */
/* ------------------------------------------------------------------ */

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Accepts `1/true/yes/on` in any casing; an empty value falls back. */
function booleanish(fallback: boolean): z.ZodType<boolean, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    const raw = asString(value);
    if (raw === '') return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }, z.boolean());
}

/** Parses an integer, falling back when the variable is unset or blank. */
function integerish(fallback: number): z.ZodType<number, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    const raw = asString(value);
    if (raw === '') return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }, z.number().int().positive());
}

/** A string that may legitimately be absent. */
function optionalString(): z.ZodType<string | undefined, z.ZodTypeDef, unknown> {
  return z.preprocess((value) => {
    const raw = asString(value);
    return raw === '' ? undefined : raw;
  }, z.string().optional());
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

const schema = z.object({
  TEST_ENV: z.preprocess(
    (value) => (asString(value) === '' ? 'demo' : asString(value)),
    z.enum(ENVIRONMENT_NAMES as [EnvironmentName, ...EnvironmentName[]]),
  ),
  API_BASE_URL: optionalString(),
  GRAPHQL_URL: optionalString(),
  WS_URL: optionalString(),

  API_KEY: optionalString(),
  ADMIN_USERNAME: optionalString(),
  ADMIN_PASSWORD: optionalString(),
  STANDARD_USERNAME: optionalString(),
  STANDARD_PASSWORD: optionalString(),
  READONLY_USERNAME: optionalString(),
  READONLY_PASSWORD: optionalString(),

  OAUTH_TOKEN_URL: optionalString(),
  OAUTH_CLIENT_ID: optionalString(),
  OAUTH_CLIENT_SECRET: optionalString(),
  OAUTH_SCOPE: optionalString(),

  HMAC_KEY_ID: optionalString(),
  HMAC_SECRET: optionalString(),

  API_TIMEOUT: integerish(30_000),
  RETRY_COUNT: z.preprocess((value) => {
    const raw = asString(value);
    return raw === '' ? 2 : Number(raw);
  }, z.number().int().min(0).max(10)),
  WORKERS: z.preprocess((value) => {
    const raw = asString(value);
    return raw === '' ? undefined : Number(raw);
  }, z.number().int().positive().optional()),
  TRACE: z.preprocess(
    (value) => (asString(value) === '' ? 'retain-on-failure' : asString(value)),
    z.enum(['on', 'off', 'retain-on-failure', 'on-first-retry']),
  ),
  LOG_LEVEL: z.preprocess(
    (value) => (asString(value) === '' ? 'info' : asString(value).toLowerCase()),
    z.enum(['error', 'warn', 'info', 'debug']),
  ),
  LOG_BODIES: booleanish(false),
  LATENCY_BUDGET_MS: integerish(2_000),
  STRICT_CONTRACTS: booleanish(false),
  STRICT_CONTENT_TYPE: booleanish(true),
  MOCK_SERVER_PORT: integerish(4010),
  ALLURE: booleanish(false),
  CI: booleanish(false),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const lines = parsed.error.issues.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`);
  throw new Error(
    `Invalid environment configuration.\n\n${lines.join('\n')}\n\n` +
      `Copy .env.example to .env and fill in the values above.\n` +
      `Known TEST_ENV values: ${ENVIRONMENT_NAMES.join(', ')}\n`,
  );
}

const raw = parsed.data;
const environment: EnvironmentDefinition = ENVIRONMENTS[raw.TEST_ENV];

/** A named credential set. Roles map onto the authorisation matrix under test. */
interface UserCredentials {
  readonly role: UserRole;
  readonly username: string;
  readonly password: string;
}

export type UserRole = 'admin' | 'standard' | 'readonly';

const users: Record<UserRole, { username?: string; password?: string }> = {
  admin: { username: raw.ADMIN_USERNAME, password: raw.ADMIN_PASSWORD },
  standard: { username: raw.STANDARD_USERNAME, password: raw.STANDARD_PASSWORD },
  readonly: { username: raw.READONLY_USERNAME, password: raw.READONLY_PASSWORD },
};

/**
 * Resolved, validated configuration. Frozen so a test cannot mutate the run's
 * settings and leave a later test running against a different target.
 */
export const config = Object.freeze({
  env: raw.TEST_ENV,
  environment,

  /** Base URL for REST calls: the explicit override, else the environment's. */
  baseUrl: (raw.API_BASE_URL ?? environment.apiBaseUrl).replace(/\/+$/, ''),
  apiPrefix: environment.apiPrefix,
  graphqlUrl: raw.GRAPHQL_URL ?? environment.graphqlUrl,
  wsUrl: raw.WS_URL ?? environment.wsUrl,

  apiKey: raw.API_KEY,
  oauth: Object.freeze({
    tokenUrl: raw.OAUTH_TOKEN_URL,
    clientId: raw.OAUTH_CLIENT_ID,
    clientSecret: raw.OAUTH_CLIENT_SECRET,
    scope: raw.OAUTH_SCOPE,
  }),
  hmac: Object.freeze({ keyId: raw.HMAC_KEY_ID, secret: raw.HMAC_SECRET }),

  timeout: raw.API_TIMEOUT,
  retryCount: raw.RETRY_COUNT,
  workers: raw.WORKERS,
  trace: raw.TRACE,
  logLevel: raw.LOG_LEVEL,
  logBodies: raw.LOG_BODIES,
  latencyBudgetMs: raw.LATENCY_BUDGET_MS || environment.latencyBudgetMs,
  strictContracts: raw.STRICT_CONTRACTS,
  strictContentType: raw.STRICT_CONTENT_TYPE,
  mockServerPort: raw.MOCK_SERVER_PORT,
  allure: raw.ALLURE,
  isCI: raw.CI,
  readOnly: environment.readOnly,
  verifyTls: environment.verifyTls,
});

/**
 * Credentials for a role, or a precise error naming the two variables to set.
 * Throwing here — rather than returning empty strings — turns a configuration
 * mistake into a readable message instead of a 401 nobody can explain.
 */
export function getUser(role: UserRole): UserCredentials {
  const entry = users[role];
  if (!entry.username || !entry.password) {
    throw new Error(
      `No credentials for role "${role}". Set ${role.toUpperCase()}_USERNAME and ` +
        `${role.toUpperCase()}_PASSWORD in .env (or as CI secrets).`,
    );
  }
  return { role, username: entry.username, password: entry.password };
}

/** True when a role has usable credentials — use to skip rather than fail. */
export function hasUser(role: UserRole): boolean {
  const entry = users[role];
  return Boolean(entry.username && entry.password);
}

/** Absolute URL for a path, applying the environment's version prefix. */
export function apiUrl(pathname: string): string {
  if (/^https?:\/\//i.test(pathname)) return pathname;
  const prefix = pathname.startsWith(config.apiPrefix) ? '' : config.apiPrefix;
  const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${config.baseUrl}${prefix}${suffix}`;
}
