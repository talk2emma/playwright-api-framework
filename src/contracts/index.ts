/** Barrel for the contract layer. */
export * as schemas from './schemas';
export { problemDetails, healthCheck, offsetPage, cursorPage, dataEnvelope } from './schemas';
export type { ProblemDetails, HealthCheck } from './schemas';
export {
  registerSchema,
  registerSchemas,
  allSchemas,
  clearSchemas,
  findSchema,
  schemaByName,
  matchesPath,
} from './schema.registry';
export type { RegisteredSchema } from './schema.registry';
export {
  validateJsonSchema,
  validateAgainstFile,
  compile,
  addSchema,
  formatAjvErrors,
} from './json-schema';
export { OpenApiContract } from './openapi';
export type { OperationDescriptor } from './openapi';
