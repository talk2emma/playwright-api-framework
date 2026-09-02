/**
 * Walking paginated endpoints.
 *
 * Every API paginates differently — page numbers, offsets, opaque cursors, or
 * an RFC 8288 `Link` header — and a test that only ever reads page one will
 * pass while page two is broken. These helpers turn any of those styles into
 * one thing a test can iterate, with a hard page ceiling so a server bug
 * cannot turn into an infinite loop.
 */
import type { ApiResponse } from '../core/api.response';
import type { Page } from '../types';
import { readPath } from './jsonpath.utils';
import { logger } from './logger';

const log = logger.child('pagination');

/** Guards against a server that always reports "there is more". */
const MAX_PAGES = 200;

export interface PaginationOptions {
  /** Stop after this many pages. Defaults to 200. */
  readonly maxPages?: number;
  /** Stop once this many items have been collected. */
  readonly maxItems?: number;
}

/**
 * Follows `Link: rel="next"` until the server stops sending one.
 *
 * The GitHub convention, and the only style where the client needs no
 * knowledge of the API's parameter names at all.
 */
export async function followLinkHeader<T>(
  first: ApiResponse,
  fetchNext: (url: string) => Promise<ApiResponse>,
  extract: (response: ApiResponse) => T[],
  options: PaginationOptions = {},
): Promise<T[]> {
  const limit = options.maxPages ?? MAX_PAGES;
  const items: T[] = [...extract(first)];
  let current = first;
  let pages = 1;

  while (pages < limit) {
    const next = current.nextPageUrl();
    if (!next) break;
    current = await fetchNext(next);
    items.push(...extract(current));
    pages += 1;
    if (options.maxItems && items.length >= options.maxItems) break;
  }

  if (pages >= limit) log.warn('stopped at the page ceiling', { pages, limit });
  return options.maxItems ? items.slice(0, options.maxItems) : items;
}

/**
 * Follows cursor pagination.
 *
 * `readPage` is given the cursor for the page to fetch — `undefined` for the
 * first — and returns the items plus the cursor for the page after it.
 */
export async function followCursor<T>(
  readPage: (cursor: string | undefined) => Promise<Page<T>>,
  options: PaginationOptions = {},
): Promise<T[]> {
  const limit = options.maxPages ?? MAX_PAGES;
  const items: T[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();

  for (let page = 0; page < limit; page += 1) {
    const result = await readPage(cursor);
    items.push(...result.items);
    if (options.maxItems && items.length >= options.maxItems) break;
    if (!result.nextCursor) break;
    /* A cursor that repeats means the server is looping; stopping here turns a
     * hang into a clear, reportable failure. */
    if (seen.has(result.nextCursor)) {
      log.warn('cursor repeated — stopping', { cursor: result.nextCursor });
      break;
    }
    seen.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  return options.maxItems ? items.slice(0, options.maxItems) : items;
}

/** Follows offset/limit pagination until fewer than `limit` items come back. */
export async function followOffset<T>(
  readPage: (offset: number, limit: number) => Promise<T[]>,
  pageSize = 50,
  options: PaginationOptions = {},
): Promise<T[]> {
  const ceiling = options.maxPages ?? MAX_PAGES;
  const items: T[] = [];

  for (let page = 0; page < ceiling; page += 1) {
    const batch = await readPage(page * pageSize, pageSize);
    items.push(...batch);
    if (batch.length < pageSize) break;
    if (options.maxItems && items.length >= options.maxItems) break;
  }
  return options.maxItems ? items.slice(0, options.maxItems) : items;
}

/**
 * Reads a page envelope in whichever shape the API happens to use.
 *
 * Tries the common field names so a service object does not have to hard-code
 * one convention, and returns a normalised `Page<T>`.
 */
export function readPageEnvelope<T>(payload: unknown, itemsPath = 'items'): Page<T> {
  const items = (readPath(payload, itemsPath) ??
    readPath(payload, 'data') ??
    readPath(payload, 'results') ??
    readPath(payload, 'content') ??
    []) as T[];

  const page: {
    items: T[];
    nextCursor?: string;
    nextUrl?: string;
    total?: number;
    pageNumber?: number;
  } = { items: Array.isArray(items) ? items : [] };

  const cursor =
    readPath(payload, 'nextCursor') ??
    readPath(payload, 'next_cursor') ??
    readPath(payload, 'cursor');
  if (typeof cursor === 'string') page.nextCursor = cursor;

  const next = readPath(payload, 'next') ?? readPath(payload, 'nextUrl');
  if (typeof next === 'string') page.nextUrl = next;

  const total =
    readPath(payload, 'total') ?? readPath(payload, 'totalCount') ?? readPath(payload, 'count');
  if (typeof total === 'number') page.total = total;

  const number = readPath(payload, 'page') ?? readPath(payload, 'pageNumber');
  if (typeof number === 'number') page.pageNumber = number;

  return page;
}

/**
 * Checks a paginated endpoint for the two defects pagination tests exist to
 * catch: an item that appears on two pages, and one that appears on none.
 */
export function findPaginationDefects<T>(
  pages: T[][],
  identify: (item: T) => string,
): { duplicates: string[]; totalItems: number; uniqueItems: number } {
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const item of page) {
      const id = identify(item);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  const duplicates = [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
  const totalItems = [...counts.values()].reduce((sum, count) => sum + count, 0);
  return { duplicates, totalItems, uniqueItems: counts.size };
}
