/** Barrel for the non-REST protocol clients. */
export { GraphQlClient, GraphQlResponse, operationNameOf } from './graphql.client';
export type { GraphQlError, GraphQlOptions } from './graphql.client';
export { SseClient, parseFrame, readNdjsonStream } from './sse.client';
export type { ServerSentEvent, SseOptions } from './sse.client';
export { WebSocketClient } from './websocket.client';
export type { SocketMessage, WebSocketOptions } from './websocket.client';
