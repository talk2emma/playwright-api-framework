/**
 * ===========================================================================
 * Conformance to the published OpenAPI document
 * ===========================================================================
 *
 * Document: `src/data/openapi.json`, loaded automatically by the `contract`
 * fixture. Nothing wires it up — dropping a specification at that path is all
 * that is required.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ADDS OVER THE ZOD SCHEMAS
 * ---------------------------------------------------------------------------
 * `objects.stubbed.spec.ts` validates against schemas the team wrote. Those say
 * what the test author *believed*. An OpenAPI document says what the API
 * *promises*, and checking against it catches the one thing hand-written
 * schemas never do: the API and its published contract have drifted apart, and
 * every consumer who trusted the document is now broken.
 *
 * ---------------------------------------------------------------------------
 * AN HONEST NOTE ABOUT THIS PARTICULAR DOCUMENT
 * ---------------------------------------------------------------------------
 * restful-api.dev publishes no OpenAPI document, so the one in `src/data/` was
 * written by hand from observed behaviour. That is a weaker guarantee than
 * validating against a specification the API's own team publishes, and it is
 * worth being clear about which situation you are in:
 *
 *   · Against a team's published document, this suite detects drift between
 *     the API and its contract — the highest-value contract test there is.
 *   · Against a document you wrote yourself, it detects drift between the API
 *     and *your understanding of it*, which is still worth having and is
 *     exactly what a consumer-driven contract test does.
 *
 * In a real project, replace `src/data/openapi.json` with the document your
 * API actually publishes, and delete this paragraph.
 *
 * Validation runs against stubbed responses so the suite stays offline and
 * unlimited. The live check at the end runs only when quota allows.
 */
import { test, expect } from '../../src/fixtures';
import { stubObjectsApi } from '../../src/mocks/objects.stub';
import { ObjectService } from '../../src/services/object.service';
import type { OpenApiContract } from '../../src/contracts/openapi';
import { config } from '../../src/config/env.config';

/**
 * Narrows the optional `contract` fixture.
 *
 * The fixture is `OpenApiContract | undefined` because a project may ship no
 * document, and `beforeEach` skips the suite when it is absent — but the
 * compiler cannot see that a skip happened. This makes the requirement
 * explicit rather than asserting it away with `!`, so a missing document fails
 * with a sentence instead of a null-property error.
 */
function documented(contract: OpenApiContract | undefined): OpenApiContract {
  if (!contract) throw new Error('No OpenAPI document loaded from src/data/openapi.json.');
  return contract;
}

test.describe('objects — OpenAPI conformance @contract @objects', () => {
  test.beforeEach(({ mockServer, contract }) => {
    /* Skip rather than fail when no document is present, so deleting
     * `src/data/openapi.json` disables this suite cleanly instead of breaking
     * the build for a project that does not use OpenAPI. */
    test.skip(!contract, 'No OpenAPI document at src/data/openapi.json.');

    mockServer.reset();
    stubObjectsApi(mockServer);
  });

  test('the document describes every operation the service uses @smoke', ({ contract }) => {
    const operations = documented(contract).list();

    /* Six operations across two paths. Asserting the count catches a document
     * that was truncated or a path that stopped parsing — both of which would
     * otherwise make the conformance checks below silently pass by matching
     * nothing at all. */
    expect(operations).toHaveLength(6);

    const identifiers = operations.map((operation) => operation.operationId);
    expect(identifiers).toEqual(
      expect.arrayContaining([
        'listObjects',
        'createObject',
        'getObject',
        'replaceObject',
        'updateObject',
        'deleteObject',
      ]),
    );

    /* The templated path in the document matches a concrete URL — which is
     * what makes automatic lookup from a real request possible. */
    expect(
      documented(contract).find('GET', 'https://api.restful-api.dev/objects/42')?.operationId,
    ).toBe('getObject');
  });

  test('every response in a lifecycle satisfies the document', async ({
    http,
    mockServer,
    contract,
    cleanup,
  }) => {
    const objects = new ObjectService(http.withBaseUrl(mockServer.url), { cleanup });
    const client = http.withBaseUrl(mockServer.url);

    /* CREATE — the `allOf` composition in the document means this response
     * must satisfy both the base Object schema and the createdAt extension. */
    const createResponse = await client
      .post('/objects')
      .json({ name: 'Conformance check', data: { year: 2026 } })
      .expectStatus(200)
      .as('create')
      .send();
    expect(createResponse).toSatisfyContract(documented(contract));

    const id = createResponse.path<string>('id') ?? '';

    /* READ — and note this must NOT be validated against CreatedObject, which
     * requires createdAt. The document models the two separately for exactly
     * that reason. */
    const readResponse = await client.get(`/objects/${id}`).expectStatus(200).as('read').send();
    expect(readResponse).toSatisfyContract(documented(contract));

    /* REPLACE and PATCH — both carry updatedAt. */
    const putResponse = await client
      .put(`/objects/${id}`)
      .json({ name: 'Replaced', data: null })
      .expectStatus(200)
      .as('replace')
      .send();
    expect(putResponse).toSatisfyContract(documented(contract));

    const patchResponse = await client
      .patch(`/objects/${id}`)
      .json({ name: 'Patched' })
      .expectStatus(200)
      .as('patch')
      .send();
    expect(patchResponse).toSatisfyContract(documented(contract));

    /* LIST */
    const listResponse = await client.get('/objects').expectStatus(200).as('list').send();
    expect(listResponse).toSatisfyContract(documented(contract));

    /* DELETE — 200 with a message body, which the document records faithfully
     * rather than describing the 204 a purist would expect. */
    const deleteResponse = await client
      .delete(`/objects/${id}`)
      .expectStatus(200)
      .as('delete')
      .send();
    expect(deleteResponse).toSatisfyContract(documented(contract));

    /* Registered above by the service; nothing left to remove. */
    void objects;
  });

  test('the documented 404 shape is enforced', async ({ http, mockServer, contract }) => {
    const response = await http
      .withBaseUrl(mockServer.url)
      .get('/objects/absent')
      .expectStatus(404)
      .as('missing')
      .send();

    /* The document declares a 404 for this operation, so validation picks the
     * error schema rather than the success one — which is how a single
     * assertion covers both the happy and the unhappy path. */
    expect(response).toSatisfyContract(documented(contract));
  });

  /*
   * The automatic contract guard is switched off for this one test.
   *
   * The guard throws on any response that fails its registered schema, which
   * is exactly what this test sets out to produce. Left on, it fires inside
   * `send()` and the test never reaches the assertion it exists to make — so
   * the check with the most to prove would be the only one CI could not run.
   */
  test.describe('with the automatic guard disabled', () => {
    test.use({ strictContracts: false });

    test('a response that violates the document is rejected', async ({
      http,
      mockServer,
      contract,
    }) => {
      /* A deliberately wrong response, to prove the check has teeth. A
       * conformance suite that has never failed is a conformance suite nobody
       * should trust. */
      mockServer.reset();
      mockServer.stub({
        method: 'GET',
        path: '/objects/*',
        /* `id` must be a string and is required; here it is a number. */
        respond: { status: 200, json: { id: 42, name: 'wrong types' } },
      });

      const response = await http
        .withBaseUrl(mockServer.url)
        .get('/objects/1')
        .expectStatus(200)
        .as('malformed read')
        .send();

      const result = documented(contract).validate(
        'GET',
        'https://api.restful-api.dev/objects/1',
        200,
        response.jsonOrNull(),
      );

      expect(result.valid).toBe(false);
      expect(result.errors.join(' '), 'the failure must name the offending field').toContain('id');
    });
  });

  test('contract coverage reports operations the suite never exercised', ({ contract }) => {
    /*
     * The gap analysis. Given the calls a run made, which documented
     * operations were never touched? That is the number worth tracking over
     * time — an endpoint nobody tests is an endpoint nobody notices breaking.
     */
    const exercised = [
      { method: 'GET' as const, url: 'https://api.restful-api.dev/objects' },
      { method: 'POST' as const, url: 'https://api.restful-api.dev/objects' },
      { method: 'GET' as const, url: 'https://api.restful-api.dev/objects/1' },
    ];

    const gaps = documented(contract).uncovered(exercised);
    const gapIds = gaps.map((operation) => operation.operationId);

    /* PUT, PATCH and DELETE were not in the list above, so they must show up
     * as gaps — which proves the coverage calculation is actually working. */
    expect(gapIds).toEqual(
      expect.arrayContaining(['replaceObject', 'updateObject', 'deleteObject']),
    );
    expect(gapIds).not.toContain('getObject');
  });

  test('the LIVE API still satisfies the document @live', async ({ api, contract }) => {
    /*
     * The one test here that touches the network. Everything above runs
     * against the stub, so this is the only place the quota is spent — one
     * request — and it skips cleanly when the quota is gone.
     *
     * This is the assertion that actually detects drift: the stub can only
     * ever agree with itself.
     */
    /*
     * There is nothing to detect drift against when the environment has no
     * live target. Under `TEST_ENV=mock` the request would not reach a quota
     * check at all — it would fail at the socket, on a port the offline suite
     * never intended to use.
     */
    test.skip(
      !config.requiresLiveTarget,
      `TEST_ENV is "${config.env}", which is served by stubs. Point the contract ` +
        'project at a live environment to check the document against the real API.',
    );

    const probe = await api.objects.rawFind('1');

    test.skip(
      ObjectService.isQuotaExhausted(probe),
      'The restful-api.dev anonymous quota is exhausted; the stubbed conformance checks above still ran.',
    );

    probe.expectOk();
    expect(probe).toSatisfyContract(documented(contract));
  });
});
