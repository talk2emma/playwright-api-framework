/**
 * Security checks that belong in a functional API suite.
 *
 * Not a penetration test — that is a different activity with different
 * authorisation. These are the checks that catch the mistakes teams actually
 * ship: an endpoint that forgot its authorisation check, a header that leaks
 * the framework version, CORS opened to `*` with credentials, an error message
 * that returns a stack trace to the caller.
 *
 * Each helper reports findings rather than throwing, so a test can assert on
 * the whole set and the report shows every problem at once.
 */
import type { ApiResponse } from '../core/api.response';
import type { HeaderMap, HttpMethod } from '../types';
import { getHeader } from './header.utils';

/** One thing worth fixing, with enough context to act on it. */
export interface SecurityFinding {
  readonly severity: 'high' | 'medium' | 'low';
  readonly rule: string;
  readonly detail: string;
}

/* ------------------------------------------------------------------ */
/* Response hygiene                                                    */
/* ------------------------------------------------------------------ */

/** Headers that disclose the server's software and version. */
const DISCLOSING_HEADERS = ['server', 'x-powered-by', 'x-aspnet-version', 'x-generator'];

/** Patterns that should never reach a client in an error body. */
const LEAK_PATTERNS: { rule: string; pattern: RegExp }[] = [
  { rule: 'stack-trace', pattern: /\bat\s+[\w$.]+\s*\([^)]*:\d+:\d+\)/ },
  {
    rule: 'sql-fragment',
    pattern: /\b(?:SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|FROM\s+\w+\s+WHERE)\b/i,
  },
  {
    rule: 'file-path',
    pattern: /(?:\/(?:home|var|usr|opt|etc)\/[\w./-]+|[A-Z]:\\Users\\[\w\\.-]+)/,
  },
  { rule: 'connection-string', pattern: /(?:mongodb|postgres(?:ql)?|mysql|redis):\/\/[^\s"']+/i },
  { rule: 'private-key', pattern: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  { rule: 'aws-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { rule: 'bearer-token', pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./ },
];

/** Checks a response for information disclosure. */
export function auditDisclosure(response: ApiResponse): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  for (const name of DISCLOSING_HEADERS) {
    const value = response.header(name);
    /* A bare product name is acceptable; a version number is the disclosure. */
    if (value && /\d/.test(value)) {
      findings.push({
        severity: 'low',
        rule: 'version-disclosure',
        detail: `${name}: ${value} reveals the server's version.`,
      });
    }
  }

  const body = response.text();
  for (const { rule, pattern } of LEAK_PATTERNS) {
    const match = pattern.exec(body);
    if (match) {
      findings.push({
        severity: rule === 'private-key' || rule === 'aws-key' ? 'high' : 'medium',
        rule,
        detail: `Response body contains ${rule.replace('-', ' ')}: ${match[0].slice(0, 120)}`,
      });
    }
  }
  return findings;
}

/** Checks the baseline security headers a public API should send. */
export function auditSecurityHeaders(headers: HeaderMap): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const require = (
    name: string,
    expectation: RegExp,
    severity: SecurityFinding['severity'],
  ): void => {
    const value = getHeader(headers, name);
    if (value === undefined) {
      findings.push({ severity, rule: `missing-${name}`, detail: `No ${name} header.` });
    } else if (!expectation.test(value)) {
      findings.push({
        severity,
        rule: `weak-${name}`,
        detail: `${name}: ${value} does not satisfy ${String(expectation)}.`,
      });
    }
  };

  require('x-content-type-options', /^nosniff$/i, 'medium');
  require('strict-transport-security', /max-age=\d{5,}/i, 'high');
  require('cache-control', /no-store|private|max-age/i, 'low');
  return findings;
}

/**
 * Checks a CORS preflight.
 *
 * The dangerous combination is `Access-Control-Allow-Origin: *` together with
 * `Access-Control-Allow-Credentials: true` — browsers reject it, so it usually
 * means the server is reflecting whatever origin it is sent, which is worse.
 */
export function auditCors(headers: HeaderMap, requestOrigin: string): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const allowOrigin = getHeader(headers, 'access-control-allow-origin');
  const allowCredentials = getHeader(headers, 'access-control-allow-credentials');

  if (allowOrigin === '*' && allowCredentials === 'true') {
    findings.push({
      severity: 'high',
      rule: 'cors-wildcard-with-credentials',
      detail: 'Access-Control-Allow-Origin is * while credentials are allowed.',
    });
  }
  if (allowOrigin === requestOrigin && requestOrigin.includes('evil')) {
    findings.push({
      severity: 'high',
      rule: 'cors-origin-reflection',
      detail: `The server reflected an arbitrary origin (${requestOrigin}) rather than checking an allow-list.`,
    });
  }
  const allowMethods = getHeader(headers, 'access-control-allow-methods');
  if (allowMethods && /TRACE|CONNECT/i.test(allowMethods)) {
    findings.push({
      severity: 'medium',
      rule: 'cors-dangerous-method',
      detail: `Access-Control-Allow-Methods includes ${allowMethods}.`,
    });
  }
  return findings;
}

/* ------------------------------------------------------------------ */
/* Authorisation matrix                                                */
/* ------------------------------------------------------------------ */

/** One cell of an authorisation matrix: who, doing what, and what should happen. */
export interface AccessExpectation {
  readonly role: string;
  readonly method: HttpMethod;
  readonly path: string;
  /** The status the role is expected to receive. */
  readonly expected: number;
  readonly note?: string;
}

/**
 * Builds the full matrix from a list of roles and operations.
 *
 * Authorisation defects are defects of *omission* — the endpoint nobody
 * remembered to protect. Generating the whole grid, rather than writing the
 * cases somebody thought of, is the only way to catch that class reliably.
 */
export function buildAccessMatrix(
  roles: readonly string[],
  operations: readonly { method: HttpMethod; path: string; allowed: readonly string[] }[],
  options: { deniedStatus?: number; allowedStatus?: number } = {},
): AccessExpectation[] {
  const denied = options.deniedStatus ?? 403;
  const allowed = options.allowedStatus ?? 200;
  return operations.flatMap((operation) =>
    roles.map((role) => ({
      role,
      method: operation.method,
      path: operation.path,
      expected: operation.allowed.includes(role) ? allowed : denied,
      note: operation.allowed.includes(role) ? 'permitted' : 'must be refused',
    })),
  );
}

/**
 * Judges an authorisation response.
 *
 * The distinction that matters: 401 means "we do not know who you are", 403
 * means "we know, and no". Returning 404 to hide a resource's existence is a
 * legitimate design and is accepted here too, but returning 200 to a role that
 * should be refused is always a finding.
 */
export function judgeAccess(
  expectation: AccessExpectation,
  actualStatus: number,
): SecurityFinding | undefined {
  const shouldBeRefused = expectation.expected >= 400;
  const wasRefused = actualStatus === 401 || actualStatus === 403 || actualStatus === 404;

  if (shouldBeRefused && !wasRefused) {
    return {
      severity: 'high',
      rule: 'broken-access-control',
      detail:
        `${expectation.role} received ${actualStatus} for ${expectation.method} ${expectation.path}; ` +
        `expected the request to be refused.`,
    };
  }
  if (!shouldBeRefused && wasRefused) {
    return {
      severity: 'medium',
      rule: 'over-restrictive-access',
      detail: `${expectation.role} was refused (${actualStatus}) for ${expectation.method} ${expectation.path}, which should be permitted.`,
    };
  }
  return undefined;
}

/** Formats findings for an assertion message or a report attachment. */
export function formatFindings(findings: readonly SecurityFinding[]): string {
  if (!findings.length) return 'no findings';
  const order = { high: 0, medium: 1, low: 2 } as const;
  return [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((finding) => `[${finding.severity.toUpperCase()}] ${finding.rule}: ${finding.detail}`)
    .join('\n');
}
