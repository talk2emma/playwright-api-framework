/**
 * JSON Schema validation.
 *
 * Zod covers schemas the team writes. JSON Schema covers the ones the team is
 * *given*: an OpenAPI document, a partner's published contract, a schema
 * checked into another repository. Both matter, so both are supported, and
 * they report violations in the same format so assertions do not care which
 * kind of schema they were handed.
 */
import Ajv from 'ajv';
import type { ErrorObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import type { ValidationResult } from '../types';

/**
 * `strict: false` because real-world OpenAPI documents carry vendor extensions
 * and keywords Ajv does not know; failing on those would reject valid specs.
 * `allErrors` collects every violation, which is the whole point of running a
 * contract check rather than reading the first mismatch.
 */
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true, verbose: true });
addFormats(ajv);

/* Compilation is the expensive part, and the same schema is validated against
 * many responses in a run, so compiled validators are cached by identity. */
const compiled = new WeakMap<object, ValidateFunction>();

/** Validates a value against a JSON Schema document. */
export function validateJsonSchema(schema: object, value: unknown): ValidationResult {
  const validate = compile(schema);
  const valid = validate(value);
  return {
    valid,
    errors: valid ? [] : formatAjvErrors(validate.errors ?? []),
    value,
  };
}

/** Compiles once and caches, so repeated validation is cheap. */
function compile(schema: object): ValidateFunction {
  const cached = compiled.get(schema);
  if (cached) return cached;
  const validate = ajv.compile(schema);
  compiled.set(schema, validate);
  return validate;
}

/**
 * Turns Ajv's error objects into lines a human can act on.
 *
 * Ajv's raw output puts the failing path in `instancePath` and the reason in
 * `message`, with the useful specifics in `params`; joined up, they read like
 * a sentence instead of a debug dump.
 */
function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map((error) => {
    const where =
      error.instancePath === ''
        ? '(root)'
        : error.instancePath.replace(/^\//, '').replace(/\//g, '.');
    const detail = describeParams(error);
    return `${where} ${error.message ?? 'is invalid'}${detail ? ` (${detail})` : ''}`;
  });
}

function describeParams(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if (typeof params.additionalProperty === 'string')
    return `unexpected property "${params.additionalProperty}"`;
  if (Array.isArray(params.allowedValues)) return `allowed: ${params.allowedValues.join(', ')}`;
  if (typeof params.missingProperty === 'string') return `missing "${params.missingProperty}"`;
  if (typeof params.type === 'string') return `expected ${params.type}`;
  if (typeof params.limit === 'number') return `limit ${params.limit}`;
  if (typeof params.format === 'string') return `format ${params.format}`;
  return '';
}
