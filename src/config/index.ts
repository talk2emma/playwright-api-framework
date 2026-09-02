/** Barrel for the configuration layer — import from `@config` everywhere else. */
export { config, getUser, hasUser, apiUrl } from './env.config';
export type { ResolvedConfig, UserCredentials, UserRole } from './env.config';
export { ENVIRONMENTS, ENVIRONMENT_NAMES, isEnvironmentName, PUBLIC_APIS } from './environments';
export type { EnvironmentDefinition, EnvironmentName, PublicApiName } from './environments';
export { TIMEOUTS } from './timeouts';
export type { TimeoutName } from './timeouts';
