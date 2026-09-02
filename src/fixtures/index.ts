/**
 * The single import for every test.
 *
 *   import { test, expect } from '@fixtures';
 *
 * Tests import `test` and `expect` from here rather than from `@playwright/test`
 * so that the framework's fixtures and custom matchers are always in scope. An
 * ESLint rule enforces it: a test that imports Playwright directly silently
 * loses the cleanup registry, the contract guard and every custom matcher.
 */
export { test, defaultAuthProvider, BearerAuth } from './api.fixture';
export type { ApiFixtures, WorkerFixtures, ServiceRegistry } from './api.fixture';
export { expect } from './custom-matchers';
