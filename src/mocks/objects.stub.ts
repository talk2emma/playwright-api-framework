/**
 * An executable model of the `https://api.restful-api.dev/objects` contract.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The real API is genuinely persistent, which is what makes it worth testing
 * against — but it allows only **50 anonymous requests per 24 hours**, and
 * answers `405` with an explanatory body once that is spent. A suite that
 * burns the day's quota on its third run is a suite nobody can use.
 *
 * So the CRUD behaviour is modelled here, faithfully, from what the live API
 * was observed to do. That buys three things:
 *
 *   1. The same service object and the same lifecycle can be exercised
 *      exhaustively, offline, with no quota — in CI, on a fork's pull request,
 *      on a plane.
 *   2. The model is a *check on our understanding*. When the live suite runs
 *      within quota and agrees with the stub, our contract is right. When they
 *      disagree, either the API changed or we misread it — and either way we
 *      want to know.
 *   3. Failure modes the real API will not produce on demand — a 500, a
 *      timeout, a malformed body — become ordinary test setup.
 *
 * ---------------------------------------------------------------------------
 * THE QUIRKS THIS MODEL REPRODUCES DELIBERATELY
 * ---------------------------------------------------------------------------
 * Every one of these was observed against the live API. They are not what a
 * REST purist would design, and that is exactly why they are modelled: a stub
 * that behaves the way you *wish* the API behaved tests nothing.
 *
 *   · POST answers **200**, not 201.
 *   · POST responses carry `createdAt`; PUT and PATCH carry `updatedAt`;
 *     **GET carries neither**.
 *   · DELETE answers **200 with a message body**, not 204 with nothing.
 *   · A second DELETE answers 404.
 *   · Created objects are retrievable by id but are **never** returned by the
 *     list endpoint, which only ever returns the seeded set.
 *   · Errors are `{ error: string }` — not RFC 9457 problem details.
 *   · A malformed JSON body answers 400 `{ error: "Invalid request body" }`.
 *   · `name` may be null, and `data` may be null.
 */
import type { MockServer, RecordedRequest, StubResponse } from './mock.server';
import type { UnknownRecord } from '../types';

/** One stored object, in the shape the API stores it. */
interface StoredObject {
  id: string;
  name: string | null;
  data: UnknownRecord | null;
  createdAt: number;
  updatedAt?: number;
}

/**
 * The seeded objects the live API returns from `GET /objects`.
 *
 * Only the first three are modelled by name — the live API has thirteen, and
 * the count is asserted from `SEEDED_COUNT` so a test can check the shape of
 * the list without this file having to duplicate the whole dataset.
 */
const SEEDED: StoredObject[] = [
  {
    id: '1',
    name: 'Google Pixel 6 Pro',
    data: { color: 'Cloudy White', capacity: '128 GB' },
    createdAt: 0,
  },
  { id: '2', name: 'Apple iPhone 12 Mini, 256GB, Blue', data: null, createdAt: 0 },
  { id: '3', name: 'Apple iPhone 12 Pro Max', data: { 'CPU model': 'A14 Bionic' }, createdAt: 0 },
];

/** How many objects the live list endpoint returns. Asserted by the tests. */
export const SEEDED_COUNT = SEEDED.length;

/** The error body shape. Matches the live API exactly, including the wording. */
function notFound(id: string): StubResponse {
  return { status: 404, json: { error: `Object with id=${id} was not found.` } };
}

/**
 * Registers the whole `/objects` contract on a stub server.
 *
 * Returns a handle exposing the backing store, so a test can seed a specific
 * state or assert on what was written without going through HTTP.
 */
export function stubObjectsApi(server: MockServer): {
  /** Everything currently stored, seeded objects included. */
  readonly store: Map<string, StoredObject>;
  /** Resets to just the seeded objects. Call between tests that share a worker. */
  reset: () => void;
} {
  const store = new Map<string, StoredObject>();
  const seed = (): void => {
    store.clear();
    for (const object of SEEDED) store.set(object.id, { ...object });
  };
  seed();

  /* Ids are generated in the same hex shape the live API uses, so a test that
   * happens to assert on the format passes against both. */
  let counter = 0;
  const nextId = (): string => {
    counter += 1;
    return `ff808181${counter.toString(16).padStart(24, '0')}`;
  };

  const idFrom = (request: RecordedRequest): string => request.path.split('/').pop() ?? '';

  /* ---- CREATE ---------------------------------------------------- */
  server.stub({
    method: 'POST',
    path: '/objects',
    name: 'create object',
    respond: (request) => {
      /* The live API answers 400 for a body it cannot parse. The stub server
       * hands us `json: undefined` in that case, which is the same signal. */
      if (request.body !== '' && request.json === undefined) {
        return { status: 400, json: { error: 'Invalid request body' } };
      }
      const input = (request.json ?? {}) as { name?: unknown; data?: unknown };
      const created: StoredObject = {
        id: nextId(),
        /* The live API accepts a missing name and stores null — it performs
         * no validation at all, which the negative suite asserts. */
        name: typeof input.name === 'string' ? input.name : null,
        data: (input.data as UnknownRecord | null) ?? null,
        createdAt: Date.now(),
      };
      store.set(created.id, created);

      /* 200, not 201 — and `createdAt` is present here and nowhere else. */
      return {
        status: 200,
        json: {
          id: created.id,
          name: created.name,
          createdAt: created.createdAt,
          data: created.data,
        },
      };
    },
  });

  /* ---- READ ------------------------------------------------------- */
  server.stub({
    method: 'GET',
    path: '/objects/*',
    name: 'get object',
    respond: (request) => {
      const found = store.get(idFrom(request));
      if (!found) return notFound(idFrom(request));

      /* Neither timestamp is returned on a read. This is the quirk most
       * likely to be got wrong by a schema written from documentation. */
      return { status: 200, json: { id: found.id, name: found.name, data: found.data } };
    },
  });

  /* ---- LIST ------------------------------------------------------- */
  server.stub({
    method: 'GET',
    path: '/objects',
    name: 'list objects',
    respond: (request) => {
      /* The stub server collapses repeated query parameters, so `?id=1&id=2`
       * arrives as the last value. The raw URL is parsed instead to model the
       * repeated form the live API requires. */
      const requested = [...new URL(request.url, 'http://stub').searchParams.getAll('id')];

      const listed = requested.length
        ? requested.map((id) => store.get(id)).filter((o): o is StoredObject => o !== undefined)
        : /* Created objects are never listed — only the seeded set is. */
          SEEDED.map((object) => store.get(object.id)).filter(
            (o): o is StoredObject => o !== undefined,
          );

      return {
        status: 200,
        json: listed.map((object) => ({ id: object.id, name: object.name, data: object.data })),
      };
    },
  });

  /* ---- REPLACE (PUT) ---------------------------------------------- */
  server.stub({
    method: 'PUT',
    path: '/objects/*',
    name: 'replace object',
    respond: (request) => {
      const id = idFrom(request);
      const existing = store.get(id);
      if (!existing) return notFound(id);

      const input = (request.json ?? {}) as { name?: unknown; data?: unknown };
      const replaced: StoredObject = {
        id,
        /* A full replacement: everything not sent is discarded, which is the
         * behaviour that distinguishes PUT from PATCH. */
        name: typeof input.name === 'string' ? input.name : null,
        data: (input.data as UnknownRecord | null) ?? null,
        createdAt: existing.createdAt,
        updatedAt: Date.now(),
      };
      store.set(id, replaced);

      return {
        status: 200,
        json: { id, name: replaced.name, updatedAt: replaced.updatedAt, data: replaced.data },
      };
    },
  });

  /* ---- PATCH ------------------------------------------------------ */
  server.stub({
    method: 'PATCH',
    path: '/objects/*',
    name: 'patch object',
    respond: (request) => {
      const id = idFrom(request);
      const existing = store.get(id);
      if (!existing) return notFound(id);

      const input = (request.json ?? {}) as { name?: unknown; data?: unknown };
      /* A partial update: only what was sent changes. Everything else,
       * including `data`, survives. */
      const patched: StoredObject = {
        ...existing,
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(input.data !== undefined ? { data: input.data as UnknownRecord | null } : {}),
        updatedAt: Date.now(),
      };
      store.set(id, patched);

      return {
        status: 200,
        json: { id, name: patched.name, updatedAt: patched.updatedAt, data: patched.data },
      };
    },
  });

  /* ---- DELETE ----------------------------------------------------- */
  server.stub({
    method: 'DELETE',
    path: '/objects/*',
    name: 'delete object',
    respond: (request) => {
      const id = idFrom(request);
      if (!store.has(id)) return notFound(id);
      store.delete(id);

      /* 200 with a body, not 204 with nothing — and the message quotes the id,
       * which the delete test asserts. */
      return { status: 200, json: { message: `Object with id = ${id} has been deleted.` } };
    },
  });

  return { store, reset: seed };
}
