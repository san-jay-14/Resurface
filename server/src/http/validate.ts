import type { Context } from "hono";
import type { z } from "zod";
import { AppError, badRequest } from "../errors.ts";

function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(
      400,
      "validation_failed",
      "The request was invalid",
      result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  return result.data;
}

/** Parse and validate a JSON request body. */
export async function jsonBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return parse(schema, raw);
}

export function queryParams<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.query());
}

export function pathParams<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  return parse(schema, c.req.param());
}
