/** Barrel for the authentication layer. */
export { NoAuth, BasicAuth, BearerAuth, ApiKeyAuth } from './static.auth';
export type { ApiKeyOptions } from './static.auth';
export { OAuth2Auth } from './oauth2.auth';
export type { OAuth2Options } from './oauth2.auth';
export { HmacSigner } from './hmac.auth';
export type { HmacOptions } from './hmac.auth';
export { SessionAuth } from './session.auth';
export type { SessionAuthOptions } from './session.auth';
export { TokenStore, tokenStore } from './token.store';
export type { CachedToken } from './token.store';
export { decodeJwt, jwtClaims, jwtExpiry, isJwtExpired, jwtScopes } from './jwt';
export type { DecodedJwt, JwtClaims } from './jwt';
