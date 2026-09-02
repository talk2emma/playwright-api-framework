/**
 * Service object for the `/posts` resource of https://jsonplaceholder.typicode.com.
 *
 * This service exists to exercise the two things the primary CRUD target
 * cannot demonstrate:
 *
 *   1. **Real RFC 8288 `Link` header pagination.** The API sends
 *      `Link: <…>; rel="first", <…>; rel="next", <…>; rel="last"` together with
 *      an `X-Total-Count` header, which is exactly the shape `followLinkHeader`
 *      and `parseLinkHeader` were written for.
 *   2. **A large, completely stable dataset** — 100 posts that never change —
 *      so a pagination test can assert exact counts without being flaky.
 *
 * Its writes are *simulated*: a POST answers 201 with a plausible body and
 * stores nothing. That is why the lifecycle suite runs against the `demo`
 * environment instead, and why this service exposes reads plus one honest
 * `simulateCreate` rather than pretending to be a CRUD service.
 *
 * The client this service is given is a derived one, pointed at a different
 * host by the fixture:
 *
 *   new PostService(http.withBaseUrl(PUBLIC_APIS.jsonPlaceholder), …)
 *
 * A derived client keeps the run's observers attached, so requests made here
 * still appear in the latency report and the recording.
 */
import { z } from 'zod';
import { BaseService } from '../core/base.service';
import type { ApiResponse } from '../core/api.response';
import { registerSchemas } from '../contracts/schema.registry';
import { followLinkHeader } from '../utils/pagination.utils';

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

export const PostSchema = z
  .object({
    id: z.number().int().positive(),
    userId: z.number().int().positive(),
    title: z.string().min(1),
    body: z.string(),
  })
  .passthrough();

export const PostListSchema = z.array(PostSchema);

export type Post = z.infer<typeof PostSchema>;

registerSchemas([
  { name: 'post', method: 'GET', pathPattern: '/posts/{id}', status: 200, schema: PostSchema },
  { name: 'post-list', method: 'GET', pathPattern: '/posts', status: 200, schema: PostListSchema },
]);

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class PostService extends BaseService {
  protected readonly basePath = '/posts';

  /** The total number of posts the dataset contains. Stable, and asserted on. */
  static readonly TOTAL_POSTS = 100;

  /** Reads one post, or `undefined` for 404. */
  async find(id: number): Promise<Post | undefined> {
    const response = await this.get('/{id}')
      .param('id', id)
      .expectStatus(200, 404)
      .as('get post')
      .send();

    if (response.status === 404) return undefined;
    return response.parse(PostSchema, 'post');
  }

  /** Every post, unpaginated — the dataset is small enough that this is fine. */
  async all(): Promise<Post[]> {
    const response = await this.get().expectStatus(200).as('list posts').send();
    return response.parse(PostListSchema, 'post-list');
  }

  /** One page, using the API's `_page`/`_limit` convention. */
  async page(pageNumber: number, limit: number): Promise<ApiResponse> {
    return this.get()
      .query({ _page: pageNumber, _limit: limit })
      .expectStatus(200)
      .as(`list posts page ${pageNumber}`)
      .send();
  }

  /**
   * Walks every page by following the `Link` header to the end.
   *
   * This is the pagination style that needs no knowledge of the API's own
   * parameter names: the server hands back the next page's full URL, and the
   * walker just follows it. `followLinkHeader` stops when no `rel="next"`
   * arrives, and has a hard page ceiling so a server bug cannot loop forever.
   */
  async walkAllPages(limit = 10): Promise<Post[]> {
    return this.step(`walk every page of ${limit}`, async () => {
      const first = await this.page(1, limit);

      return followLinkHeader<Post>(
        first,
        /* How to fetch the next page. The URL is absolute and comes from the
         * server, so it is passed straight through — `resolveUrl` leaves an
         * absolute URL untouched. */
        (url) => this.http.get(url).expectStatus(200).as('next page').send(),
        /* How to get the items out of each response. */
        (response) => response.parse(PostListSchema, 'post-list'),
      );
    });
  }

  /**
   * Posts a new record and returns the response.
   *
   * Named `simulateCreate` rather than `create` on purpose: this API answers
   * 201 with an echoed body but persists nothing, and a method called `create`
   * that does not create is a trap for the next person.
   */
  async simulateCreate(input: { title: string; body: string; userId: number }): Promise<Post> {
    const response = await this.post()
      .json(input)
      .expectStatus(201)
      .as('simulate create post')
      .send();

    return response.parse(PostSchema.omit({ id: true }).extend({ id: z.number() }), 'post');
  }

  /** The raw list response, for tests asserting on pagination headers. */
  async rawPage(pageNumber: number, limit: number): Promise<ApiResponse> {
    return this.page(pageNumber, limit);
  }
}
