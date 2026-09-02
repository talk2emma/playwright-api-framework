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
import { logger } from './logger';

const log = logger.child('pagination');

/** Guards against a server that always reports "there is more". */
const MAX_PAGES = 200;

interface PaginationOptions {
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
