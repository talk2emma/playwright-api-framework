/**
 * Validating responses against an OpenAPI document.
 *
 * A schema written by hand says what the test author believed the API returns.
 * The OpenAPI document says what the API *promises* to return. Checking
 * against the document catches the case that hand-written schemas never do:
 * the API and its published contract have drifted apart, and consumers who
 * trusted the document are broken.
 *
 * The loader is deliberately small — it resolves local `$ref`s, finds the
 * operation for a method and path, and hands the response schema to Ajv. It
 * does not attempt to be a full OpenAPI toolchain.
 */
import fs from 'node:fs';
import type { UnknownRecord, HttpMethod, ValidationResult } from '../types';
import { ConfigurationError, ContractViolationError } from '../core/errors';
import { validateJsonSchema } from './json-schema';
import { matchesPath } from './schema.registry';

/** One operation from the document, flattened into what validation needs. */
interface OperationDescriptor {
  readonly method: HttpMethod;
  /** Templated path exactly as written in the document, e.g. `/users/{id}`. */
  readonly path: string;
  readonly operationId?: string;
  readonly summary?: string;
  /** Status code (or `default`) to response schema. */
  readonly responses: Record<string, object | undefined>;
  /** Declared parameters, used by the request-shape check. */
  readonly parameters: { name: string; in: string; required: boolean }[];
}

export class OpenApiContract {
  private readonly document: UnknownRecord;
  private readonly operations: OperationDescriptor[];

  private constructor(document: UnknownRecord) {
    this.document = document;
    this.operations = this.collectOperations();
  }

  /** Loads a document from a `.json` file. */
  static fromFile(specPath: string): OpenApiContract {
    if (!fs.existsSync(specPath)) {
      throw new ConfigurationError(
        `OpenAPI document not found at ${specPath}. Point the contract fixture at ` +
          `a real specification, or remove the contract project from playwright.config.ts.`,
      );
    }
    return new OpenApiContract(JSON.parse(fs.readFileSync(specPath, 'utf8')) as UnknownRecord);
  }

  /** Loads a document already parsed — for a spec fetched from the API itself. */
  static fromObject(document: UnknownRecord): OpenApiContract {
    return new OpenApiContract(document);
  }

  /** Every operation the document declares. */
  list(): readonly OperationDescriptor[] {
    return this.operations;
  }

  /** Finds the operation matching a real request. */
  find(method: HttpMethod, url: string): OperationDescriptor | undefined {
    const pathname = pathnameOf(url);
    return this.operations.find(
      (operation) => operation.method === method && matchesPath(operation.path, pathname),
    );
  }

  /**
   * Validates a payload against the documented schema for a status.
   *
   * Falls back to the `default` response, which is how a document describes
   * "every other status" — usually the error shape.
   */
  validate(method: HttpMethod, url: string, status: number, payload: unknown): ValidationResult {
    const operation = this.find(method, url);
    if (!operation) {
      return { valid: false, errors: [`No operation documented for ${method} ${pathnameOf(url)}`] };
    }
    const schema =
      operation.responses[String(status)] ??
      operation.responses[`${Math.floor(status / 100)}XX`] ??
      operation.responses.default;

    if (!schema) {
      return {
        valid: false,
        errors: [
          `${method} ${operation.path} documents no response for status ${status} ` +
            `(documented: ${Object.keys(operation.responses).join(', ') || 'none'})`,
        ],
      };
    }
    return validateJsonSchema(this.resolve(schema) as object, payload);
  }

  /** Validates, and throws a contract violation when the payload disagrees. */
  assert(method: HttpMethod, url: string, status: number, payload: unknown): void {
    const result = this.validate(method, url, status, payload);
    if (!result.valid) {
      throw new ContractViolationError(`${method} ${pathnameOf(url)} → ${status}`, result.errors);
    }
  }

  /** Operations the suite never touched — the contract-coverage gap. */
  uncovered(exercised: { method: HttpMethod; url: string }[]): OperationDescriptor[] {
    return this.operations.filter(
      (operation) =>
        !exercised.some(
          (call) =>
            call.method === operation.method && matchesPath(operation.path, pathnameOf(call.url)),
        ),
    );
  }

  /* ---------------------------------------------------------------- */
  /* Internals                                                         */
  /* ---------------------------------------------------------------- */

  private collectOperations(): OperationDescriptor[] {
    const paths = this.document.paths;
    if (!isRecord(paths)) return [];
    const result: OperationDescriptor[] = [];

    for (const [path, item] of Object.entries(paths)) {
      if (!isRecord(item)) continue;
      const shared = readParameters(item.parameters);

      for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const) {
        const operation = item[method];
        if (!isRecord(operation)) continue;
        result.push({
          method: method.toUpperCase() as HttpMethod,
          path,
          operationId:
            typeof operation.operationId === 'string' ? operation.operationId : undefined,
          summary: typeof operation.summary === 'string' ? operation.summary : undefined,
          responses: this.collectResponses(operation.responses),
          parameters: [...shared, ...readParameters(operation.parameters)],
        });
      }
    }
    return result;
  }

  private collectResponses(responses: unknown): Record<string, object | undefined> {
    if (!isRecord(responses)) return {};
    const out: Record<string, object | undefined> = {};
    for (const [status, response] of Object.entries(responses)) {
      const resolved = this.resolve(response);
      if (!isRecord(resolved)) continue;
      const content = resolved.content;
      if (!isRecord(content)) {
        /* A response with no content — 204, or a documented empty body. */
        out[status] = undefined;
        continue;
      }
      /* JSON first; fall back to whatever single media type is documented. */
      const media =
        content['application/json'] ??
        Object.values(content).find((value) => isRecord(value) && 'schema' in value);
      if (isRecord(media) && media.schema) out[status] = this.resolve(media.schema) as object;
    }
    return out;
  }

  /**
   * Resolves local `$ref` pointers.
   *
   * Only in-document references are followed. A spec that references another
   * file should be bundled first — resolving across files here would mean
   * inventing a resolver whose behaviour differs from the team's own tooling.
   */
  private resolve(node: unknown, depth = 0): unknown {
    if (depth > 50) return node;
    if (Array.isArray(node)) return node.map((item) => this.resolve(item, depth + 1));
    if (!isRecord(node)) return node;

    if (typeof node.$ref === 'string') {
      if (!node.$ref.startsWith('#/')) {
        throw new ConfigurationError(
          `External $ref "${node.$ref}" is not supported. Bundle the specification first ` +
            `(for example with \`redocly bundle\`) and point the loader at the result.`,
        );
      }
      const target = node.$ref
        .slice(2)
        .split('/')
        .reduce<unknown>((current, segment) => {
          const key = segment.replace(/~1/g, '/').replace(/~0/g, '~');
          return isRecord(current) ? current[key] : undefined;
        }, this.document);
      return this.resolve(target, depth + 1);
    }

    const out: UnknownRecord = {};
    for (const [key, value] of Object.entries(node)) out[key] = this.resolve(value, depth + 1);
    return out;
  }
}

function readParameters(value: unknown): { name: string; in: string; required: boolean }[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((parameter) => ({
    name: text(parameter.name),
    in: text(parameter.in),
    required: parameter.required === true,
  }));
}

/** Reads an unknown field as a string without stringifying an object into it. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}
