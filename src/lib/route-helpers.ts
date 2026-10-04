import { z } from "zod";
import { isIsoDay } from "./dates";
import { isJsonContentType } from "./same-origin";

export function fail(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

/** Parse and validate a JSON body. Returns the data, or a ready-to-send error response. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { error: Response }> {
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { error: fail("Content-Type must be application/json.", 415) };
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { error: fail("Request body must be valid JSON.", 400) };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      error: fail(parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "), 400),
    };
  }
  return { data: parsed.data };
}

/** Drop keys the caller didn't send, so `undefined` never reads as "clear this field". */
export function definedOnly<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export const isoDay = z.string().refine(isIsoDay, "must be a date as YYYY-MM-DD");
