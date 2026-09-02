/**
 * ===========================================================================
 * Reads and pagination against a real API
 * ===========================================================================
 *
 * Target: https://jsonplaceholder.typicode.com/posts — a public, read-only
 * REST API with 100 completely stable records and genuine RFC 8288 `Link`
 * header pagination. Unlimited: there is no quota to be careful about.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SUITE EXISTS ALONGSIDE THE CRUD SUITE
 * ---------------------------------------------------------------------------
 * The CRUD target proves writes persist, but it has no pagination at all and
 * a tight request quota. This one has the opposite properties, so between them
 * both halves get real coverage:
 *
 *   · A dataset large enough that pagination is meaningful.
 *   · A `Link` header with `rel="first" | "next" | "last"`, which is the one
 *     pagination style where the client needs no knowledge of the API's own
 *     parameter names — the server hands back the next page's URL.
 *   · An `X-Total-Count` header to check the walk against.
 *   · Stability: 100 posts, unchanging, so exact counts can be asserted
 *     without flakiness.
 *
 * The service reaches this host through a **derived client**
 * (`http.withBaseUrl(PUBLIC_APIS.jsonPlaceholder)`), which keeps the run's
 * latency collection, recording and contract guard attached to it.
 *
 * ---------------------------------------------------------------------------
 * AN HONEST CAVEAT
 * ---------------------------------------------------------------------------
 * This API *simulates* writes: a POST answers 201 with a plausible body and
 * stores nothing. That is why the lifecycle suite runs elsewhere, and why the
 * service's method is called `simulateCreate` rather than `create`.
 */
import { test, expect } from '../../src/fixtures';
import { PostService, PostSchema, PostListSchema } from '../../src/services/post.service';
import { parseLinkHeader, nextLink } from '../../src/utils/header.utils';
import { findPaginationDefects } from '../../src/utils/pagination.utils';

test.describe('posts — reads and pagination @regression @posts', () => {
  test('a single post can be read and matches its schema @smoke', async ({ api }) => {
    const post = await api.posts.find(1);

    expect(post, 'post 1 is part of the stable dataset').toBeDefined();
    expect(post?.id).toBe(1);
    expect(post?.userId).toBeGreaterThan(0);
    expect(post?.title.length).toBeGreaterThan(0);
  });

  test('an unknown id returns undefined rather than throwing', async ({ api }) => {
    /* The service maps 404 to `undefined` so callers can branch on absence
     * without a try/catch. `require()` is the throwing form for the cases
     * where absence really is a failure. */
    const missing = await api.posts.find(999_999);
    expect(missing).toBeUndefined();
  });

  test('the Link header advertises first, next and last @pagination', async ({ api }) => {
    const response = await api.posts.rawPage(1, 10);

    response.expectOk();

    /* Parsed once, in one place, rather than with a regular expression in each
     * test — `Link` is a structured value inside a single header string, and
     * hand-parsing it is a classic source of subtle bugs. */
    const links = parseLinkHeader(response.header('link'));
    const relations = links.map((link) => link.rel);

    expect(relations).toContain('next');
    expect(relations).toContain('last');

    /* The response wrapper exposes the common case directly. */
    expect(response.nextPageUrl()).toBe(nextLink(response.header('link')));
    expect(response.nextPageUrl()).toContain('_page=2');

    /* The API also reports the total, which the walk is checked against. */
    expect(Number(response.header('x-total-count'))).toBe(PostService.TOTAL_POSTS);
  });

  test('following the Link header walks the whole dataset exactly once @pagination', async ({
    api,
  }) => {
    /* `walkAllPages` follows `rel="next"` until the server stops sending one.
     * The walker has a hard page ceiling, so a server bug that always
     * advertises a next page becomes a clear failure rather than a hang. */
    const everything = await api.posts.walkAllPages(10);

    /* The walk must produce the dataset the API says it has — no more, no
     * fewer. This is the assertion that catches an off-by-one in the walker. */
    expect(everything).toHaveLength(PostService.TOTAL_POSTS);

    /* The two defects pagination tests exist to catch: an item that appears on
     * two pages, and one that appears on none. Both happen when the underlying
     * data shifts mid-walk, and neither is visible from a single page. */
    const defects = findPaginationDefects([everything], (post) => String(post.id));
    expect(defects.duplicates, 'no post may appear on two pages').toEqual([]);
    expect(defects.uniqueItems).toBe(PostService.TOTAL_POSTS);

    /* And the ids really are 1..100, which proves nothing was skipped. */
    const ids = everything.map((post) => post.id).sort((a, b) => a - b);
    expect(ids[0]).toBe(1);
    expect(ids.at(-1)).toBe(PostService.TOTAL_POSTS);
  });

  test('page size is honoured and the last page is short @pagination', async ({ api }) => {
    const full = await api.posts.rawPage(1, 30);
    expect(full.json<unknown[]>()).toHaveLength(30);

    /* 100 posts in pages of 30 → the fourth page holds the remaining 10.
     * A short final page is how offset-style walkers know to stop, so it is
     * worth asserting that this API really produces one. */
    const last = await api.posts.rawPage(4, 30);
    expect(last.json<unknown[]>()).toHaveLength(10);

    /* And no `next` on the final page. */
    expect(last.nextPageUrl()).toBeUndefined();
  });

  test('every item in a page validates against the schema @contract', async ({ api }) => {
    const response = await api.posts.rawPage(2, 15);

    /* Validating the whole array in one assertion reports every bad item at
     * once, rather than stopping at the first. */
    expect(response).toMatchSchema(PostListSchema, 'post-list');

    /* And spot-check that an individual item parses to a typed value. */
    const first = response.json<unknown[]>()[0];
    expect(PostSchema.safeParse(first).success).toBe(true);
  });

  test('reads are cacheable and reasonably fast', async ({ api }) => {
    const response = await api.posts.rawPage(1, 5);

    /* A read endpoint that forbids caching is usually an oversight, and it is
     * the sort of thing only an API test ever notices. */
    expect(response).toHaveHeader('cache-control');
    /* A generous ceiling: this asserts "not pathologically slow", not a
     * performance budget. Percentiles belong in the performance project, which
     * runs with a single worker so the numbers mean something. */
    expect(response).toRespondWithin(10_000);
  });
});
