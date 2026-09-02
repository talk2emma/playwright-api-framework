/**
 * Service object for the `/objects` resource of https://api.restful-api.dev.
 *
 * This is the framework's worked example against a **real, live API** — one
 * that genuinely persists writes, so a create-read-update-delete lifecycle
 * test proves something rather than exercising a stub.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE REAL API ACTUALLY DOES
 * ---------------------------------------------------------------------------
 * Everything below was established by calling the API, not by reading its
 * documentation, because the two disagree in several places. Each quirk is
 * encoded in the schemas and asserted by the tests, so if the API changes the
 * suite says so.
 *
 *   POST   /objects        → 200 (NOT 201) with { id, name, createdAt, data }
 *   GET    /objects/{id}   → 200 with { id, name, data } — no timestamps at all
 *   GET    /objects        → 200 with only the 13 seeded objects; objects you
 *                            create are retrievable by id but never listed
 *   GET    /objects?id=1&id=2  → 200 with just those objects
 *   PUT    /objects/{id}   → 200 with { id, name, updatedAt, data }
 *   PATCH  /objects/{id}   → 200 with { id, name, updatedAt, data }
 *   DELETE /objects/{id}   → 200 with { message }; a second DELETE → 404
 *   any unknown id         → 404 with { error: "Object with id=… was not found." }
 *   malformed JSON body    → 400 with { error: "Invalid request body" }
 *
 * Two of those are worth calling out because they are the kind of thing a
 * hand-written schema copied from documentation would get wrong:
 *
 *   1. `createdAt` appears ONLY on the create response and `updatedAt` ONLY on
 *      update responses. A single "Object" schema requiring either one would
 *      fail on every read.
 *   2. Errors are `{ error: string }`, not RFC 9457 problem details. Asserting
 *      the standard shape here would fail — so the suite asserts what the API
 *      really returns and the documentation records that it is non-standard.
 */
import { z } from 'zod';
import { BaseService } from '../core/base.service';
import type { ApiResponse } from '../core/api.response';
import { registerSchemas } from '../contracts/schema.registry';
import type { UnknownRecord } from '../types';

/* ------------------------------------------------------------------ */
/* Contract                                                            */
/* ------------------------------------------------------------------ */

/**
 * The free-form payload each object carries.
 *
 * Deliberately `z.record(z.unknown())` rather than a fixed shape: the API
 * accepts arbitrary keys (`"CPU model"`, `"Hard disk size"`, `"capacity"`),
 * and several of the seeded objects have `data: null`. Pinning it down would
 * be describing our fixtures rather than the API.
 */
export const ObjectDataSchema = z.record(z.unknown()).nullable();

/**
 * The shape common to every object response.
 *
 * `.passthrough()` is important: it allows fields the API adds that we have
 * not modelled. A strict schema would turn "the API added a field" — which
 * breaks nobody — into a suite-wide failure, and teams respond to that by
 * deleting the schema check entirely.
 */
const objectBase = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    data: ObjectDataSchema.optional(),
  })
  .passthrough();

/** A read: `GET /objects/{id}`. Carries no timestamps. */
export const ApiObjectSchema = objectBase;

/** A create response: the only one that carries `createdAt`. */
export const CreatedObjectSchema = objectBase.extend({
  /* Epoch milliseconds, as a number — not an ISO string. */
  createdAt: z.number().int().positive(),
});

/** An update response: `PUT` and `PATCH` both carry `updatedAt`. */
export const UpdatedObjectSchema = objectBase.extend({
  updatedAt: z.number().int().positive(),
});

/** A list: `GET /objects`, optionally filtered by repeated `id` parameters. */
export const ObjectListSchema = z.array(ApiObjectSchema);

/** The delete acknowledgement. Note it is a body, not a 204. */
export const DeleteAcknowledgementSchema = z.object({
  message: z.string().min(1),
});

/**
 * The API's error shape.
 *
 * Not RFC 9457. Recorded faithfully so tests assert what is really returned;
 * see `tests/api/objects.negative.spec.ts` for the assertion that this is the
 * shape, and the documentation for why we do not pretend otherwise.
 */
export const ObjectErrorSchema = z.object({
  error: z.string().min(1),
});

export type ApiObject = z.infer<typeof ApiObjectSchema>;
export type CreatedObject = z.infer<typeof CreatedObjectSchema>;
export type UpdatedObject = z.infer<typeof UpdatedObjectSchema>;

/**
 * Registered so `STRICT_CONTRACTS=true` validates these responses whether or
 * not a test asks, and so contract coverage can count them.
 *
 * The registration order matters: `findSchema` returns the first match, so
 * `POST /objects` (specific) is registered before nothing more general exists
 * for it, and the `4xx` band entry catches every failure of the resource.
 */
registerSchemas([
  {
    name: 'object-created',
    method: 'POST',
    pathPattern: '/objects',
    status: 200,
    schema: CreatedObjectSchema,
  },
  {
    name: 'object',
    method: 'GET',
    pathPattern: '/objects/{id}',
    status: '2xx',
    schema: ApiObjectSchema,
  },
  {
    name: 'object-list',
    method: 'GET',
    pathPattern: '/objects',
    status: '2xx',
    schema: ObjectListSchema,
  },
  {
    name: 'object-replaced',
    method: 'PUT',
    pathPattern: '/objects/{id}',
    status: '2xx',
    schema: UpdatedObjectSchema,
  },
  {
    name: 'object-patched',
    method: 'PATCH',
    pathPattern: '/objects/{id}',
    status: '2xx',
    schema: UpdatedObjectSchema,
  },
  {
    name: 'object-deleted',
    method: 'DELETE',
    pathPattern: '/objects/{id}',
    status: 200,
    schema: DeleteAcknowledgementSchema,
  },
  {
    name: 'object-error',
    method: 'GET',
    pathPattern: '/objects/{id}',
    status: '4xx',
    schema: ObjectErrorSchema,
  },
]);

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/** What `create` and `replace` accept. */
export interface NewObject {
  readonly name: string;
  readonly data?: UnknownRecord | null;
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export class ObjectService extends BaseService {
  protected readonly basePath = '/objects';

  /* ---------------------------------------------------------------- */
  /* Quota                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * The live API allows **50 anonymous requests per 24 hours**, then answers
   * `405` with an explanatory body until the window resets.
   *
   * That is not a failure of the API or of the suite, so it must not be
   * reported as one: a test that fails because somebody else already used the
   * day's quota tells nobody anything. Detecting it lets the live suite skip
   * with a clear reason and hand the coverage to the stubbed suite.
   */
  static isQuotaExhausted(response: ApiResponse): boolean {
    return response.status === 405 && /daily request limit/i.test(response.text());
  }

  /**
   * One cheap request that answers "is there quota left?".
   *
   * Costs a request itself, so callers should cache the answer for the whole
   * worker rather than asking per test.
   */
  async quotaAvailable(): Promise<boolean> {
    const response = await this.get('/{id}')
      .param('id', '1')
      /* Every outcome is acceptable here — this is a probe, not an assertion. */
      .expectStatus(200, 404, 405)
      .retries(0)
      .as('quota probe')
      .send();

    return !ObjectService.isQuotaExhausted(response);
  }

  /**
   * Creates an object and registers its deletion.
   *
   * Three things are happening in the chain below, and each is deliberate.
   *
   * `.expectStatus(200)` — the API answers 200, not the 201 a REST purist
   * would expect. Encoding the *real* status here means the client raises
   * immediately if the API ever starts answering something else, instead of
   * the failure surfacing as a confusing schema mismatch later.
   *
   * `.idempotencyKey()` — generates a key so this POST is safe to retry. The
   * HTTP client only retries a non-idempotent verb when it sees this header;
   * without it a retried create could produce two objects.
   *
   * `.as('create object')` — names the call in the HTML report, the log line
   * and the recording, so a failure is identifiable without reading the URL.
   */
  async create(input: NewObject): Promise<CreatedObject> {
    return this.step(`create object "${input.name}"`, async () => {
      const response = await this.post()
        .json({ name: input.name, data: input.data ?? null })
        .idempotencyKey()
        .expectStatus(200)
        .as('create object')
        .send();

      /* `parse` validates AND narrows: everything after this line is fully
       * typed, and `created.id` cannot be undefined. `json<T>()` would only
       * have asserted the type, not checked it. */
      const created = response.parse(CreatedObjectSchema, 'object-created');

      /* Cleanup is registered in the same statement that created the
       * resource. `track` returns the value through, so this reads as one
       * expression rather than three. */
      return this.track(created, `object ${created.id}`, () => this.remove(created.id));
    });
  }

  /** Reads one object, or `undefined` when the API answers 404. */
  async find(id: string): Promise<ApiObject | undefined> {
    const response = await this.get('/{id}')
      .param('id', id)
      /* Both outcomes are expected here, so neither is a client-level
       * failure. The caller decides what a 404 means. */
      .expectStatus(200, 404)
      .as('get object')
      .send();

    if (response.status === 404) return undefined;
    return response.parse(ApiObjectSchema, 'object');
  }

  /** Reads one object, failing with a clear message when it is absent. */
  async require(id: string): Promise<ApiObject> {
    const found = await this.find(id);
    if (!found) throw new Error(`Object ${id} does not exist.`);
    return found;
  }

  /**
   * Lists objects.
   *
   * `.arrays('repeat')` produces `?id=1&id=2` rather than `?id=1,2`. This API
   * requires the repeated form; the comma form silently returns everything,
   * which is the worst kind of wrong — a passing test that filtered nothing.
   */
  async list(ids: string[] = []): Promise<ApiObject[]> {
    const builder = this.get().as('list objects');
    if (ids.length) builder.query({ id: ids }).arrays('repeat');

    const response = await builder.expectStatus(200).send();
    return response.parse(ObjectListSchema, 'object-list');
  }

  /**
   * Replaces an object wholesale (`PUT`).
   *
   * The response carries `updatedAt` and not `createdAt`, which is why this
   * validates against a different schema from `create`.
   */
  async replace(id: string, input: NewObject): Promise<UpdatedObject> {
    return this.step(`replace object ${id}`, async () => {
      const response = await this.put('/{id}')
        .param('id', id)
        .json({ name: input.name, data: input.data ?? null })
        .expectStatus(200)
        .as('replace object')
        .send();

      return response.parse(UpdatedObjectSchema, 'object-replaced');
    });
  }

  /** Applies a partial update (`PATCH`). */
  async update(id: string, changes: Partial<NewObject>): Promise<UpdatedObject> {
    return this.step(`update object ${id}`, async () => {
      const response = await this.patch('/{id}')
        .param('id', id)
        .json(changes)
        .expectStatus(200)
        .as('update object')
        .send();

      return response.parse(UpdatedObjectSchema, 'object-patched');
    });
  }

  /**
   * Deletes an object, tolerating "already gone".
   *
   * 404 is accepted because this runs from the cleanup registry, after tests
   * that may have deleted the object themselves. If a second delete failed,
   * every such test would fail in teardown for no reason.
   *
   * `cleanup.forget` then removes the registration, so teardown does not try
   * again for a resource this call already dealt with.
   */
  async remove(id: string): Promise<void> {
    await this.del('/{id}').param('id', id).expectStatus(200, 404).as('delete object').send();

    this.cleanup.forget(`object ${id}`);
  }

  /**
   * The raw create response, for tests that assert on status, headers or
   * timing rather than on the resulting object.
   *
   * Every service should expose one of these. Without it, a test that needs
   * to check a header ends up bypassing the service and hard-coding the path
   * the service exists to own.
   *
   * Note it does **not** register cleanup: the caller may deliberately be
   * sending something that will not create anything.
   */
  async rawCreate(payload: unknown): Promise<ApiResponse> {
    return (
      this.post()
        .json(payload)
        /* No expectStatus: the caller is asserting the status itself. */
        .as('create object (raw)')
        .send()
    );
  }

  /** The raw read response — used by the negative and contract suites. */
  async rawFind(id: string): Promise<ApiResponse> {
    return this.get('/{id}').param('id', id).as('get object (raw)').send();
  }
}
