/**
 * Reusable schema building blocks.
 *
 * Every API repeats the same handful of shapes — an identifier, a timestamp,
 * a paginated envelope, an error body. Defining them once means a change to
 * "what a valid timestamp looks like" is one edit, and it means the schemas in
 * a project's own `src/contracts` stay short enough to read.
 *
 * Zod is used rather than raw JSON Schema for anything hand-written because it
 * produces a TypeScript type as a by-product: `response.parse(User)` returns a
 * fully typed value, so the test body cannot drift from the contract.
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Primitives                                                          */
/* ------------------------------------------------------------------ */

/** RFC 4122 identifier. */
export const uuid = z.string().uuid();

/** An identifier that may be a UUID or a numeric string — very common. */
export const identifier = z.union([z.string().min(1), z.number().int().positive()]);

/** ISO 8601 instant, e.g. `2026-08-31T09:15:00Z`. */
export const isoDateTime = z.string().datetime({ offset: true });

/** Calendar date with no time component. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const email = z.string().email();
export const url = z.string().url();

/** A monetary amount in minor units — never a float. */
export const minorUnits = z.number().int();

/** ISO 4217 currency code. */
export const currency = z.string().regex(/^[A-Z]{3}$/, 'expected a three-letter currency code');

/** Anything the API is allowed to add later without breaking clients. */
export const unknownRecord = z.record(z.unknown());

/* ------------------------------------------------------------------ */
/* Envelopes                                                           */
/* ------------------------------------------------------------------ */

/**
 * The audit fields most resources carry.
 *
 * Spread into a resource schema rather than extending it, so a resource that
 * lacks one of these fields simply omits it.
 */
export const timestamps = {
  createdAt: isoDateTime,
  updatedAt: isoDateTime.optional(),
} as const;

/** Offset/limit pagination, the most common REST convention. */
export function offsetPage<T extends z.ZodTypeAny>(
  item: T,
): z.ZodObject<{
  items: z.ZodArray<T>;
  total: z.ZodNumber;
  offset: z.ZodNumber;
  limit: z.ZodNumber;
}> {
  return z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  });
}

/** Cursor pagination, used by APIs that cannot afford a stable offset. */
export function cursorPage<T extends z.ZodTypeAny>(
  item: T,
): z.ZodObject<{
  items: z.ZodArray<T>;
  nextCursor: z.ZodOptional<z.ZodNullable<z.ZodString>>;
  hasMore: z.ZodOptional<z.ZodBoolean>;
}> {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable().optional(),
    hasMore: z.boolean().optional(),
  });
}

/** A `{ data: … }` wrapper, as used by JSON:API-influenced designs. */
export function dataEnvelope<T extends z.ZodTypeAny>(
  item: T,
): z.ZodObject<{ data: T; meta: z.ZodOptional<typeof unknownRecord> }> {
  return z.object({ data: item, meta: unknownRecord.optional() });
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/**
 * RFC 9457 (formerly 7807) problem details — the standard error shape.
 *
 * Worth asserting even when a test is about the happy path: an API that
 * returns a bare string on error is one your consumers cannot handle, and this
 * is the cheapest place to catch that.
 */
export const problemDetails = z.object({
  type: z.string().optional(),
  title: z.string(),
  status: z.number().int().min(100).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
});

/** A looser error envelope, for APIs that predate the standard. */
export const errorEnvelope = z.object({
  error: z.union([
    z.string(),
    z.object({
      code: z.string(),
      message: z.string(),
      details: z.unknown().optional(),
    }),
  ]),
});

/** Field-level validation failures, as returned for a rejected 422. */
export const validationErrors = z.object({
  errors: z.array(
    z.object({
      field: z.string(),
      message: z.string(),
      code: z.string().optional(),
    }),
  ),
});

/* ------------------------------------------------------------------ */
/* Health                                                              */
/* ------------------------------------------------------------------ */

/** The shape a `/health` endpoint is expected to return. */
export const healthCheck = z.object({
  status: z.enum(['ok', 'degraded', 'down', 'pass', 'fail', 'warn']),
  version: z.string().optional(),
  uptime: z.number().optional(),
  checks: z.record(z.unknown()).optional(),
});

export type ProblemDetails = z.infer<typeof problemDetails>;
export type HealthCheck = z.infer<typeof healthCheck>;
