/**
 * ===========================================================================
 * CRUD lifecycle against a REAL, LIVE API
 * ===========================================================================
 *
 * Target: https://api.restful-api.dev/objects — a public REST API that
 * genuinely persists writes. Nothing here is stubbed and no credentials are
 * needed, so this runs on a fresh clone with no configuration at all.
 *
 * ---------------------------------------------------------------------------
 * READ THIS FIRST: THE QUOTA, AND WHY THIS FILE IS SMALL
 * ---------------------------------------------------------------------------
 * The API allows **50 anonymous requests per 24 hours**. Once that is spent it
 * answers `405` with an explanatory body until the window resets.
 *
 * That shapes the whole file. This suite is deliberately *small* — one full
 * lifecycle plus a handful of focused checks, around sixteen requests — and it
 * **skips rather than fails** when the quota is gone, because a red build
 * caused by somebody else's usage teaches nobody anything.
 *
 * The exhaustive coverage lives in `tests/contract/objects.stubbed.spec.ts`,
 * which runs the *same service object* against an executable model of this
 * same contract (`src/mocks/objects.stub.ts`). That suite is unlimited,
 * offline, and runs on every pull request.
 *
 * The division of labour is the point:
 *
 *   this file    proves the API really behaves as we believe — a few times a day
 *   the stub     proves our client handles that behaviour — every single run
 *
 * If the two ever disagree, either the API changed or we misread it, and
 * either way that is exactly what a test suite is for.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE TESTS ARE SAFE TO RUN IN PARALLEL AGAINST A SHARED API
 * ---------------------------------------------------------------------------
 *   · Every object is created by the test that uses it — nothing depends on
 *     data somebody else left behind.
 *   · Names are generated with `uniqueId`, so two workers cannot collide.
 *   · `api.objects.create` registers its own deletion, so the framework tidies
 *     up even when a test fails.
 *   · The API never returns created objects from its list endpoint, so a test
 *     cannot be disturbed by whatever the rest of the internet is creating.
 */
import { test, expect } from '../../src/fixtures';
import { uniqueId } from '../../src/utils/data.utils';
import {
  ApiObjectSchema,
  CreatedObjectSchema,
  DeleteAcknowledgementSchema,
} from '../../src/services/object.service';

/**
 * The quota probe, cached for the lifetime of the worker.
 *
 * `beforeEach` runs before every test, but the probe costs a request, so the
 * promise is memoised at module scope: one probe per worker process, not one
 * per test. Storing the *promise* rather than the result means concurrent
 * tests in the same worker share the single in-flight request.
 */
let quotaProbe: Promise<boolean> | undefined;

test.describe('objects — live CRUD lifecycle @regression @objects @live', () => {
  test.beforeEach(async ({ api }) => {
    quotaProbe ??= api.objects.quotaAvailable();

    test.skip(
      !(await quotaProbe),
      'The restful-api.dev anonymous quota (50 requests / 24h) is exhausted. ' +
        'The same lifecycle is covered offline by tests/contract/objects.stubbed.spec.ts.',
    );
  });

  /**
   * Builds a payload for a new object.
   *
   * The name is generated so parallel workers cannot collide, and `data` uses
   * the free-form keys this API really stores — including one containing a
   * space, which is a genuine shape it accepts and a useful check that nothing
   * in the framework mangles keys on the way out.
   */
  function deviceFor(label: string): { name: string; data: Record<string, unknown> } {
    return {
      name: `${label} ${uniqueId('pw')}`,
      data: {
        year: 2026,
        price: 1849.99,
        'CPU model': 'Apple M4 Pro',
        'Hard disk size': '1 TB',
      },
    };
  }

  /* ================================================================= *
   * THE END-TO-END LIFECYCLE
   *
   * The one test in this file whose steps depend on each other, and the
   * only one that proves the operations actually compose. Eight requests.
   * ================================================================= */

  test('an object can be created, read, replaced, patched and deleted @smoke', async ({ api }) => {
    /* ---- CREATE ---------------------------------------------------
     * `api.objects.create` sends the POST, enforces the status the API
     * really returns (200 — not the 201 a REST purist expects), validates
     * the body against `CreatedObjectSchema`, and registers the object's
     * deletion with the cleanup registry.
     *
     * What comes back is a *validated, fully typed* value — not a cast —
     * so everything after this line is checked by the compiler.
     */
    const device = deviceFor('MacBook Pro');

    const created = await test.step('create the object', async () => {
      const object = await api.objects.create(device);

      /* Asserting the echo matters: an API that silently drops a field on
       * write is a real defect, and a create test that only checked the
       * status would never see it. */
      expect(object.id, 'the API must assign an id').toBeTruthy();
      expect(object.name).toBe(device.name);
      expect(object.data).toMatchObject(device.data);

      /* `createdAt` is epoch milliseconds and appears only here. Checking
       * it is recent proves the server generated it now rather than
       * echoing something stale back at us. */
      expect(object.createdAt).toBeGreaterThan(Date.now() - 120_000);

      return object;
    });

    /* ---- READ -----------------------------------------------------
     * The read is what proves the write actually persisted. Without it, a
     * create test passes just as happily against an API that accepts the
     * request and throws it away.
     */
    await test.step('read it back', async () => {
      const fetched = await api.objects.require(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe(created.name);
      expect(fetched.data).toMatchObject(device.data);

      /* A real quirk, asserted rather than glossed over: the read carries
       * no timestamps at all, even though the create carried `createdAt`.
       * A single schema requiring it would fail on every read. */
      expect(fetched, 'reads carry no createdAt').not.toHaveProperty('createdAt');
    });

    /* ---- REPLACE (PUT) --------------------------------------------
     * A full replacement. Every field is sent, and the server must end up
     * holding exactly that — nothing merged in from the previous version.
     */
    await test.step('replace it wholesale with PUT', async () => {
      const replaced = await api.objects.replace(created.id, {
        name: `MacBook Pro M5 ${uniqueId('pw')}`,
        data: { year: 2027, price: 2199.99, 'CPU model': 'Apple M5 Max' },
      });

      expect(replaced.id).toBe(created.id);
      /* `updatedAt` appears on updates and not on creates — the mirror
       * image of the `createdAt` quirk above. */
      expect(replaced.updatedAt).toBeGreaterThan(0);

      /* The defining behaviour of PUT: a field present before, and absent
       * from the replacement, must be gone rather than merged. */
      const afterReplace = await api.objects.require(created.id);
      expect(afterReplace.data).not.toHaveProperty('Hard disk size');
      expect(afterReplace.data).toMatchObject({ 'CPU model': 'Apple M5 Max' });
    });

    /* ---- PATCH ----------------------------------------------------
     * A partial update. Only `name` is sent, so `data` must survive —
     * which is exactly what distinguishes PATCH from PUT, and exactly what
     * a test asserting only the status would fail to check.
     */
    const patchedName = `MacBook Pro Renamed ${uniqueId('pw')}`;

    await test.step('apply a partial update with PATCH', async () => {
      const patched = await api.objects.update(created.id, { name: patchedName });

      expect(patched.name).toBe(patchedName);
      expect(patched.updatedAt).toBeGreaterThan(0);
      expect(patched.data, 'PATCH must not clear untouched fields').toMatchObject({
        'CPU model': 'Apple M5 Max',
      });
    });

    /* ---- DELETE ---------------------------------------------------
     * And the delete, plus the read that proves it happened. A delete test
     * without the follow-up read proves only that the API accepted the
     * request, which is not the same thing.
     */
    await test.step('delete it and confirm it is gone', async () => {
      await api.objects.remove(created.id);

      const afterDelete = await api.objects.find(created.id);
      expect(afterDelete, 'the object must be gone after DELETE').toBeUndefined();
    });
  });

  /* ================================================================= *
   * FOCUSED CHECKS
   *
   * Each of these exercises one thing and asserts one behaviour, so a
   * failure names its own cause. Kept few, because of the quota.
   * ================================================================= */

  test('CREATE answers 200 — not 201 — with an id and a createdAt', async ({ api }) => {
    const device = deviceFor('Pixel');

    /* `rawCreate` returns the response itself rather than a domain object,
     * because this test is about the response — its status, its content type,
     * its body shape — not about the object that came back.
     *
     * Every service exposes a `raw*` method for exactly this reason. Without
     * one, a test like this would bypass the service and hard-code the path
     * the service exists to own. */
    const response = await api.objects.rawCreate({ name: device.name, data: device.data });

    /* Chained assertions on the response wrapper. Each failure message
     * carries the request, the status, the timing and a body excerpt, which
     * is what makes a CI failure diagnosable without re-running it. */
    response
      .expectStatus(200)
      .expectContentType('application/json')
      .expectPath('name', device.name)
      .expectPathExists('id')
      .expectPathExists('createdAt');

    /* The matcher form. Worth using where it reads better, and the only form
     * that can be negated or made soft. */
    expect(response).toMatchSchema(CreatedObjectSchema, 'object-created');

    /* Created outside the service, so nothing registered a deletion. Doing it
     * by hand here is exactly what `create` does for you — and is why service
     * methods, not tests, should normally do the creating.
     *
     * `parse` rather than `path` so `id` is a checked `string` and the cleanup
     * needs no conditional: a validated value cannot be undefined. */
    const created = response.parse(CreatedObjectSchema, 'object-created');
    expect(created.id).toBeTruthy();
    await api.objects.remove(created.id);
  });

  test('LIST filters by repeated id parameters', async ({ api }) => {
    /* Objects 1, 2 and 3 are seeded, stable and shared. Reading them is safe
     * because nothing in this suite writes to them. */
    const objects = await api.objects.list(['1', '2', '3']);

    expect(objects).toHaveLength(3);
    expect(objects.map((object) => object.id)).toEqual(['1', '2', '3']);

    /* This is the assertion that justifies `.arrays('repeat')` in the service.
     * Encoded as `?id=1,2,3` this API ignores the filter and returns
     * everything — a request that succeeds and filters nothing, which is the
     * worst kind of wrong. */
    expect(objects.length).toBeLessThan(13);
  });

  test('DELETE acknowledges with a message and is not repeatable', async ({ api, http }) => {
    const created = await api.objects.create(deviceFor('Nexus'));

    /* Going through the client rather than the service, because this test is
     * about the shape of the delete *response* — which the service discards. */
    const response = await http
      .delete('/objects/{id}')
      .param('id', created.id)
      .expectStatus(200)
      .as('delete object (raw)')
      .send();

    /* 200 with a body, not the 204-and-nothing a REST purist expects. The
     * suite asserts what the API does; the documentation records that it is
     * unusual. */
    expect(response).toMatchSchema(DeleteAcknowledgementSchema, 'object-deleted');
    expect(response.path<string>('message')).toContain(created.id);

    /* A second delete is a 404 — the resource is genuinely gone, not merely
     * marked. This is also why `ObjectService.remove` tolerates 404: cleanup
     * runs after tests that already deleted their own objects. */
    const second = await http
      .delete('/objects/{id}')
      .param('id', created.id)
      .expectStatus(404)
      .as('delete again')
      .send();

    expect(second).toHaveStatus(404);
  });

  test('a read validates against the registered schema @contract', async ({ api }) => {
    const response = await api.objects.rawFind('1');

    response.expectOk().expectPath('id', '1');
    expect(response).toMatchSchema(ApiObjectSchema, 'object');

    /* `fields()` lists every leaf path in the payload. Asserting on the *set*
     * of fields — rather than on one value — is how you notice a field the
     * API quietly stopped returning. */
    const fields = response.fields();
    expect(fields).toContain('id');
    expect(fields).toContain('name');
    expect(fields.some((field) => field.startsWith('createdAt'))).toBe(false);
  });
});
