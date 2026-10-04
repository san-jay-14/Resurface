import { createHash } from "node:crypto";

export const sha256Hex = (s: string): string => createHash("sha256").update(s).digest("hex");

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` over `items` with at most `limit` in flight. Resolves once all finish; callers are
 * responsible for catching errors inside `fn` (a rejection would abort the remaining workers).
 */
export async function pool<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
}

export const errorMessage = (e: unknown): string =>
  e instanceof Error ? (e.name === "Error" ? e.message : `${e.name}: ${e.message}`) : String(e);
