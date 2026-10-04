import { api } from "@/lib/api";
import type { WrappedHistory } from "./database.types";

export async function listWrapped(): Promise<WrappedHistory[]> {
  const { wrapped } = await api.get<{ wrapped: WrappedHistory[] }>("/wrapped");
  return wrapped;
}

export async function getWrapped(id: string): Promise<WrappedHistory> {
  const { wrapped } = await api.get<{ wrapped: WrappedHistory }>(`/wrapped/${id}`);
  return wrapped;
}

/** Generate (or re-use, for a double tap) a Wrapped card. Throws ApiError `not_enough_saves` / `wrapped_limit`. */
export async function generateWrapped(periodStart?: string): Promise<WrappedHistory> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await api.post<{ wrapped: WrappedHistory }>(
    "/wrapped",
    { tz, ...(periodStart ? { period_start: periodStart } : {}) },
    { timeoutMs: 60_000 },
  );
  return r.wrapped;
}
