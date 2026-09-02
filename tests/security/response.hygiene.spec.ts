/**
 * ===========================================================================
 * Response hygiene and authorisation, against real APIs
 * ===========================================================================
 *
 * Targets: https://httpbin.org and https://jsonplaceholder.typicode.com.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 * ---------------------------------------------------------------------------
 * Not a penetration test — that is a different activity, with different
 * authorisation, run by different people. These are the checks that catch the
 * mistakes teams actually ship, and that cost almost nothing because the
 * requests are being made anyway:
 *
 *   · an error message that returns a stack trace or a connection string
 *   · a header that leaks the framework and its version
 *   · CORS opened to `*` while credentials are allowed
 *   · an endpoint that forgot its authorisation check
 *
 * ---------------------------------------------------------------------------
 * WHY THIS RUNS IN ITS OWN PROJECT
 * ---------------------------------------------------------------------------
 * The payloads here are deliberately hostile, so the project is kept separable
 * and a pipeline can point it at a dedicated environment. **Never point it at
 * production.**
 *
 * ---------------------------------------------------------------------------
 * A NOTE ON THE ASSERTIONS BELOW
 * ---------------------------------------------------------------------------
 * The public services used here are demonstration APIs and do not meet a
 * production security baseline. httpbin, for instance, reflects any `Origin`
 * it is sent and allows credentials alongside it — on a real API that is a
 * serious finding; for an echo service it is the entire point.
 *
 * So the tests do three different things, and which one applies is stated at
 * each test:
 *
 *   · ASSERT what must be true of any correct API (no leaked credentials, no
 *     interpreted injection payloads, redaction before logging).
 *   · REPORT baseline findings that these demonstration services legitimately
 *     do not meet, rather than failing on them — a suite that fails on a
 *     known, accepted property teaches people to ignore it.
 *   · ASSERT THE DETECTOR FIRES where a real service genuinely exhibits the
 *     problem, which proves the auditor works against reality rather than
 *     against a fixture.
 */
import { test, expect } from '../../src/fixtures';
import { PUBLIC_APIS } from '../../src/config/environments';
import {
  auditDisclosure,
  auditSecurityHeaders,
  auditCors,
  buildAccessMatrix,
  judgeAccess,
  formatFindings,
} from '../../src/utils/security.utils';
import { INJECTION_PAYLOADS } from '../../src/utils/data.utils';

test.describe('response hygiene @security', () => {
  test('an error response leaks no stack trace, path or credential @smoke', async ({ http }) => {
    /* A deliberately bad request, to get a real error body to inspect. */
    const response = await http
      .withBaseUrl(PUBLIC_APIS.httpBin)
      .get('/status/500')
      .expectStatus(500)
      .retries(0)
      .as('server error')
      .send();

    const findings = auditDisclosure(response);

    /* The high-severity rules are the ones that must never fire: a private
     * key, an AWS key or a bearer token in a response body is a real incident.
     * Version disclosure is a finding but not a failure. */
    const serious = findings.filter((finding) => finding.severity === 'high');
    expect(serious, formatFindings(findings)).toEqual([]);
  });

  test('an injection payload is echoed as data, never interpreted', async ({ http }) => {
    /*
     * The point is not that httpbin is vulnerable — it is an echo service. It
     * is that the *framework* transports hostile input unchanged, so when this
     * pattern is pointed at a real API the payload that arrives is the payload
     * that was written. A framework that escaped or mangled these would make
     * every injection test meaningless.
     */
    const payloads = {
      sql: INJECTION_PAYLOADS.sqlOr,
      xss: INJECTION_PAYLOADS.xssScript,
      traversal: INJECTION_PAYLOADS.pathTraversal,
      template: INJECTION_PAYLOADS.templateInjection,
      crlf: INJECTION_PAYLOADS.crlf,
    };

    const response = await http
      .withBaseUrl(PUBLIC_APIS.httpBin)
      .post('/post')
      .json(payloads)
      .as('injection payloads')
      .send();

    response.expectOk();
    expect(response.path('json')).toEqual(payloads);

    /*
     * And each payload came back byte-for-byte, which is the actual claim.
     *
     * An earlier version of this test searched the whole response body for
     * "49" — the result of `{{7*7}}` had the template been evaluated. That was
     * a bad assertion: httpbin echoes numeric headers such as Content-Length,
     * so the substring appears for reasons that have nothing to do with
     * template evaluation, and the test failed intermittently depending on
     * payload size. Asserting on the specific field instead is both stricter
     * and stable.
     */
    expect(response.path('json.template')).toBe(INJECTION_PAYLOADS.templateInjection);
    expect(response.path('json.sql')).toBe(INJECTION_PAYLOADS.sqlOr);

    /* The CRLF payload is the one that would show up as a header rather than
     * as data, if anything in the stack were splitting on newlines. */
    expect(response.path('json.crlf')).toBe(INJECTION_PAYLOADS.crlf);
    expect(response.header('x-injected'), 'CRLF must not become a header').toBeUndefined();
  });

  test('security headers are reported for review', async ({ http }) => {
    const response = await http
      .withBaseUrl(PUBLIC_APIS.jsonPlaceholder)
      .get('/posts/1')
      .as('hygiene check')
      .send();

    const findings = auditSecurityHeaders(response.headers);

    /* Reported, not failed. Against your own API this assertion should be
     * inverted — `expect(findings).toEqual([])` — because there the baseline
     * is something you control and can hold yourself to. */
    console.warn(`security headers on jsonplaceholder:\n${formatFindings(findings)}`);

    /* What *is* asserted: the response declares a content type, so a browser
     * cannot be tricked into sniffing it as something else. */
    expect(response.contentType()).toBe('application/json');
  });

  test('the CORS auditor detects origin reflection on a real server', async ({ http }) => {
    const response = await http
      .withBaseUrl(PUBLIC_APIS.httpBin)
      .request('OPTIONS', '/get')
      .headers({
        origin: 'https://evil.example.com',
        'access-control-request-method': 'GET',
      })
      .as('cors preflight')
      .send();

    const findings = auditCors(response.headers, 'https://evil.example.com');

    /*
     * This assertion is inverted compared with the others, and deliberately so.
     *
     * httpbin genuinely reflects whatever `Origin` it is sent AND sets
     * `Access-Control-Allow-Credentials: true` — verified against the live
     * service, not assumed. On a production API that combination is a serious
     * finding: any site a victim visits could read authenticated responses.
     * httpbin does it on purpose, because being callable from anywhere is the
     * whole point of an echo service.
     *
     * So rather than pretending the finding is not there, this test asserts
     * that the auditor **correctly detects it against a real server**. That is
     * a true positive, and proving the detector fires is worth more than
     * asserting a demonstration service is well configured.
     *
     * Against your own API, invert it:
     *
     *     expect(findings, formatFindings(findings)).toEqual([]);
     */
    expect(response.header('access-control-allow-origin')).toBe('https://evil.example.com');
    expect(response.header('access-control-allow-credentials')).toBe('true');

    const rules = findings.map((finding) => finding.rule);
    expect(rules, formatFindings(findings)).toContain('cors-origin-reflection');
    expect(findings.every((finding) => finding.severity === 'high')).toBe(true);
  });

  test('an authorisation matrix is generated rather than hand-written', async ({ http }) => {
    /*
     * Authorisation defects are defects of *omission* — the endpoint nobody
     * remembered to protect. Writing the cases somebody thought of catches
     * exactly the cases somebody thought of; generating the whole grid is the
     * only way to catch the class.
     *
     * httpbin's `/basic-auth/{user}/{pass}` gives a real endpoint that refuses
     * the wrong credentials, so the mechanism can be demonstrated end to end
     * against a live server.
     */
    const matrix = buildAccessMatrix(
      ['valid', 'invalid'],
      [{ method: 'GET', path: '/basic-auth/framework/secret', allowed: ['valid'] }],
      { deniedStatus: 401 },
    );

    expect(matrix).toHaveLength(2);

    /* The credential each role presents. Kept as data beside the matrix rather
     * than as a branch inside the loop, so the test body stays a straight line
     * through every cell — which is what makes a generated matrix readable. */
    const passwordFor: Record<string, string> = { valid: 'secret', invalid: 'wrong-password' };

    for (const cell of matrix) {
      const response = await http
        .withBaseUrl(PUBLIC_APIS.httpBin)
        .get('/basic-auth/framework/secret')
        .basic('framework', passwordFor[cell.role] ?? '')
        .expectStatus(200, 401)
        .as(`${cell.role} access`)
        .send();

      /*
       * `judgeAccess` returns a finding, or `undefined` when the outcome was
       * correct. It treats 401, 403 and 404 as refusal — returning 404 to hide
       * a resource's existence is a legitimate design — but a 200 for a role
       * that should be refused is always a finding.
       */
      const finding = judgeAccess(cell, response.status);
      expect(
        finding,
        finding ? formatFindings([finding]) : 'access control behaved correctly',
      ).toBeUndefined();
    }
  });

  test('credentials are redacted before they reach a log or a report', async ({ http }) => {
    const response = await http
      .withBaseUrl(PUBLIC_APIS.httpBin)
      .get('/bearer')
      .bearer('super-secret-token-value-that-must-not-be-logged')
      .as('redaction check')
      .send();

    /* `toRecord` is what the logger, the reporters and the exchange recorder
     * all consume. If a credential survived into it, every recording committed
     * to a repository would contain a live token. */
    const record = response.toRecord();
    const serialised = JSON.stringify(record);

    expect(serialised).not.toContain('super-secret-token-value-that-must-not-be-logged');
    expect(record.requestHeaders.authorization).toContain('redacted');
  });
});
