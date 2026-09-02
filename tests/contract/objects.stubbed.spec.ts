/**
 * ===========================================================================
 * The same CRUD lifecycle, run against an executable model of the contract
 * ===========================================================================
 *
 * `tests/api/objects.crud.spec.ts` runs against the live API and proves it
 * behaves as we believe — but only about three times a day, because the API
 * allows 50 anonymous requests per 24 hours.
 *
 * This file runs the **same `ObjectService`** against `stubObjectsApi`, an
 * in-memory model of the same contract (`src/mocks/objects.stub.ts`). It is
 * unlimited, offline, deterministic, and runs on every pull request including
 * from forks, where no secret and no outbound network are available.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SUITE ACTUALLY PROVES
 * ---------------------------------------------------------------------------
 * It proves the *client half* of the contract: that the service builds the
 * right requests, sends the right bodies, and correctly interprets each
 * response — including all the quirks. It cannot prove the API still behaves
 * this way; only the live suite can do that.
 *
 * Together they cover both halves, which is the point of having both.
 *
 * It also does something the live suite cannot: exercise failure modes on
 * demand. A real API will not produce a 500 or a malformed body when you ask
 * it to, so those paths would otherwise never be tested at all.
 */
import { test, expect } from '../../src/fixtures';
import { ObjectService, ObjectErrorSchema } from '../../src/services/object.service';
import { stubObjectsApi, SEEDED_COUNT } from '../../src/mocks/objects.stub';
import type { HttpClient } from '../../src/core/http.client';
import type { CleanupRegistry } from '../../src/utils/cleanup.registry';

/**
 * Builds a service pointed at the stub server.
 *
 * `http.withBaseUrl` produces a *derived* client: it keeps the run's observers
 * attached — latency collection, exchange recording, the contract guard — so
 * requests to the stub are instrumented exactly like requests to the real API.
 * Constructing a fresh `HttpClient` here would silently lose all three.
 */
function serviceFor(http: HttpClient, baseUrl: string, cleanup: CleanupRegistry): ObjectService {
  return new ObjectService(http.withBaseUrl(baseUrl), { cleanup });
}

test.describe('objects — contract behaviour (stubbed) @contract @objects', () => {
  test.beforeEach(({ mockServer }) => {
    /* The stub server is worker-scoped, so it is shared by every test in this
     * worker. Resetting and re-registering per test is what keeps the tests
     * independent — without it, one test's writes would be visible to the
     * next and the suite would become order-dependent. */
    mockServer.reset();
    stubObjectsApi(mockServer);
  });

  /* ================================================================= *
   * THE FULL LIFECYCLE
   * ================================================================= */

  test('create → read → replace → patch → delete', async ({ http, mockServer, cleanup }) => {
    const objects = serviceFor(http, mockServer.url, cleanup);

    /* ---- CREATE --------------------------------------------------- */
    const created = await objects.create({
      name: 'Stubbed device',
      data: { year: 2026, 'CPU model': 'M4' },
    });

    expect(created.id).toBeTruthy();
    expect(created.name).toBe('Stubbed device');
    /* The 200-not-201 quirk is enforced by the service's `.expectStatus(200)`;
     * if the model answered 201 the create would already have thrown. */
    expect(created.createdAt).toBeGreaterThan(0);

    /* ---- READ ----------------------------------------------------- */
    const read = await objects.require(created.id);
    expect(read.name).toBe('Stubbed device');
    expect(read).not.toHaveProperty('createdAt');
    expect(read).not.toHaveProperty('updatedAt');

    /* ---- REPLACE -------------------------------------------------- */
    const replaced = await objects.replace(created.id, {
      name: 'Replaced device',
      data: { colour: 'graphite' },
    });
    expect(replaced.updatedAt).toBeGreaterThan(0);

    const afterReplace = await objects.require(created.id);
    expect(afterReplace.data).toEqual({ colour: 'graphite' });
    /* PUT discards what it was not sent. */
    expect(afterReplace.data).not.toHaveProperty('CPU model');

    /* ---- PATCH ---------------------------------------------------- */
    await objects.update(created.id, { name: 'Patched device' });

    const afterPatch = await objects.require(created.id);
    expect(afterPatch.name).toBe('Patched device');
    /* PATCH preserves what it was not sent — the behaviour that distinguishes
     * it from PUT, and the one most often left unasserted. */
    expect(afterPatch.data).toEqual({ colour: 'graphite' });

    /* ---- DELETE --------------------------------------------------- */
    await objects.remove(created.id);
    expect(await objects.find(created.id)).toBeUndefined();
  });

  /* ================================================================= *
   * REQUEST SHAPE — what the client actually put on the wire
   * ================================================================= */

  test('the client sends the request shape the API requires', async ({
    http,
    mockServer,
    cleanup,
  }) => {
    const objects = serviceFor(http, mockServer.url, cleanup);
    await objects.create({ name: 'Wire check', data: { a: 1 } });

    const [request] = mockServer.requestsFor('POST', '/objects');
    expect(request, 'the create must have reached the server').toBeDefined();

    /* The framework promises to send JSON with the right content type… */
    expect(request?.headers['content-type']).toContain('application/json');

    /* …an idempotency key, which is what makes the client willing to retry a
     * POST at all… */
    expect(
      request?.headers['idempotency-key'],
      'creates must carry an idempotency key',
    ).toBeTruthy();

    /* …and the body exactly as the service composed it, including the
     * explicit `data: null` default rather than an absent field. */
    expect(request?.json).toEqual({ name: 'Wire check', data: { a: 1 } });
  });

  test('LIST encodes repeated ids rather than a comma-separated list', async ({
    http,
    mockServer,
    cleanup,
  }) => {
    const objects = serviceFor(http, mockServer.url, cleanup);

    const listed = await objects.list(['1', '3']);
    expect(listed.map((object) => object.id)).toEqual(['1', '3']);

    /* The assertion that justifies `.arrays('repeat')`. The live API ignores
     * a comma-joined filter and returns everything; asserting the encoding
     * here catches a regression that the live API would answer 200 to. */
    const [request] = mockServer.requestsFor('GET', '/objects');
    expect(request?.url).toContain('id=1&id=3');
    expect(request?.url).not.toContain('id=1%2C3');
  });

  test('a created object is retrievable by id but never listed', async ({
    http,
    mockServer,
    cleanup,
  }) => {
    const objects = serviceFor(http, mockServer.url, cleanup);
    const created = await objects.create({ name: 'Hidden from the list' });

    await expect(objects.require(created.id)).resolves.toMatchObject({ id: created.id });

    const listed = await objects.list();
    expect(listed).toHaveLength(SEEDED_COUNT);
    expect(listed.map((object) => object.id)).not.toContain(created.id);
  });

  /* ================================================================= *
   * FAILURE MODES — the paths the live API will not produce on demand
   * ================================================================= */

  test('an unknown id answers 404 with the API error shape', async ({ http, mockServer }) => {
    const client = http.withBaseUrl(mockServer.url);

    const response = await client.get('/objects/does-not-exist').as('missing object').send();

    expect(response).toHaveStatus(404);
    /* The API's error shape is `{ error }`, **not** RFC 9457 problem details.
     * Asserting the standard shape here would fail, so the suite asserts what
     * is really returned and the documentation records that it is
     * non-standard. Pretending otherwise would hide a real interoperability
     * fact from anyone reading these tests. */
    expect(response).toMatchSchema(ObjectErrorSchema, 'object-error');
    expect(response.path<string>('error')).toContain('was not found');
  });

  test('deleting twice answers 404 the second time', async ({ http, mockServer, cleanup }) => {
    const objects = serviceFor(http, mockServer.url, cleanup);
    const created = await objects.create({ name: 'Delete me twice' });

    const first = await http
      .withBaseUrl(mockServer.url)
      .delete('/objects/{id}')
      .param('id', created.id)
      .expectStatus(200)
      .send();
    expect(first.path<string>('message')).toContain(created.id);

    const second = await http
      .withBaseUrl(mockServer.url)
      .delete('/objects/{id}')
      .param('id', created.id)
      .expectStatus(404)
      .send();
    expect(second).toHaveStatus(404);
  });

  test('the service tolerates deleting something already gone', async ({
    http,
    mockServer,
    cleanup,
  }) => {
    const objects = serviceFor(http, mockServer.url, cleanup);

    /* `remove` accepts 404 on purpose: cleanup runs after tests that already
     * deleted their own object, and a teardown that failed for that reason
     * would turn every such test red for no reason. */
    await expect(objects.remove('never-existed')).resolves.toBeUndefined();
  });

  test('a malformed body answers 400', async ({ http, mockServer }) => {
    /* `.text()` sends a raw string with a JSON content type — a body the
     * server cannot parse. This is a failure mode a real API will never
     * produce on request, which is precisely why the stub earns its keep. */
    const response = await http
      .withBaseUrl(mockServer.url)
      .post('/objects')
      .text('{ this is not json', 'application/json')
      .as('malformed create')
      .send();

    expect(response).toHaveStatus(400);
    expect(response.path<string>('error')).toBe('Invalid request body');
  });

  test('the API performs no validation: a nameless object is accepted', async ({
    http,
    mockServer,
  }) => {
    /* Recorded because it is surprising and worth knowing. An empty body is
     * accepted and stored with `name: null` — the API validates nothing. A
     * consumer that assumes `name` is always a string will break on data this
     * API is perfectly willing to create. */
    const response = await http
      .withBaseUrl(mockServer.url)
      .post('/objects')
      .json({})
      .expectStatus(200)
      .as('create with an empty body')
      .send();

    expect(response.path('name')).toBeNull();
    expect(response.path('id')).toBeTruthy();
  });

  /* ================================================================= *
   * CLIENT RESILIENCE — provable only against a controllable server
   * ================================================================= */

  test('the client retries a transient failure and then succeeds', async ({ http, mockServer }) => {
    mockServer.reset();
    /* Fails twice with 503, then succeeds. The endpoint really does recover,
     * so a client that gives up too early fails this test and one that retries
     * forever never finishes it. A mocked client that always succeeds would
     * prove neither. */
    mockServer.flaky('/objects/*', 2, { id: '1', name: 'recovered', data: null });

    const response = await http
      .withBaseUrl(mockServer.url)
      .get('/objects/1')
      .retries(3)
      .as('flaky read')
      .send();

    response.expectOk().expectPath('name', 'recovered');
    /* Three attempts: two failures and the success. */
    expect(response.timing.attempts).toBe(3);
    expect(mockServer.callCount('/objects/1')).toBe(3);
  });

  test('the client does not retry a verdict', async ({ http, mockServer }) => {
    mockServer.reset();
    mockServer.fail('/objects/*', 404, { error: 'Object with id=x was not found.' });

    const response = await http
      .withBaseUrl(mockServer.url)
      .get('/objects/x')
      .retries(3)
      .as('not-found read')
      .send();

    expect(response).toHaveStatus(404);
    /* A 404 is an answer, not a transport fault. Retrying it would be three
     * identical failures and a slower suite. */
    expect(response.timing.attempts).toBe(1);
    expect(mockServer.callCount('/objects/x')).toBe(1);
  });

  test('a slow response is bounded by the request timeout', async ({ http, mockServer }) => {
    mockServer.reset();
    mockServer.slow('/objects/*', 2_000, { id: '1' });

    /* A timeout a real API cannot be asked for on demand. The client must
     * raise rather than hang, and the error must name the budget it broke. */
    await expect(
      http
        .withBaseUrl(mockServer.url)
        .get('/objects/1')
        .timeout(300)
        .retries(0)
        .as('slow read')
        .send(),
    ).rejects.toThrow(/did not respond within 300ms/);
  });
});
