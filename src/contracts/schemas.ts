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

/** An identifier that may be a UUID or a numeric string — very common. */
export const identifier = z.union([z.string().min(1), z.number().int().positive()]);

/** ISO 8601 instant, e.g. `2026-08-31T09:15:00Z`. */
export const isoDateTime = z.string().datetime({ offset: true });

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
