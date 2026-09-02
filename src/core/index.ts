/** Barrel for the core layer. */
export { HttpClient } from './http.client';
export type {
  AuthProvider,
  ExchangeListener,
  ResponseListener,
  HttpClientOptions,
} from './http.client';
export { RequestBuilder } from './request.builder';
export type { ArrayFormat, RequestSender } from './request.builder';
export { ApiResponse } from './api.response';
export type { ResponseSnapshot } from './api.response';
export { BaseService } from './base.service';
export type { ServiceOptions } from './base.service';
export {
  FrameworkError,
  ConfigurationError,
  HttpError,
  RequestTimeoutError,
  TransportError,
  SchemaValidationError,
  ContractViolationError,
  AuthenticationError,
  PollTimeoutError,
  ReadOnlyEnvironmentError,
  LatencyBudgetError,
  safeJson,
  truncate,
} from './errors';
