import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";

import type { Save } from "@/lib/database.types";
import { listSaves } from "@/lib/saves";

const POLL_FAST_MS = 4_000;
const POLL_SLOW_MS = 15_000;
/** After this long of polling without the pipeline finishing, back off (it is probably waiting on a retry). */
const FAST_WINDOW_MS = 60_000;

/** A save the pipeline is still working on: its result will arrive as a row update. */
export function isPending(s: Save): boolean {
  return (
    s.status === "pending" ||
    s.enrichment_status === "queued" ||
    s.enrichment_status === "processing"
  );
}

function newest(saves: Save[]): string | null {
  let max: string | null = null;
  for (const s of saves) if (!max || s.updated_at > max) max = s.updated_at;
  return max;
}

/** Merge changed rows into the list (newest first), replacing by id. */
function merge(current: Save[], changed: Save[]): Save[] {
  const byId = new Map(current.map((s) => [s.id, s]));
  for (const s of changed) {
    // Saves archived since were removed from the live list.
    if (s.archived) byId.delete(s.id);
    else byId.set(s.id, s);
  }
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * The library's live saves. Replaces the old realtime subscription: refetches on mount, on
 * pull-to-refresh and whenever the app returns to the foreground, and polls only for rows changed
 * since the last fetch WHILE some save is still being processed. When nothing is pending it makes
 * no requests at all (nothing keeps the free-tier database awake).
 */
export function useSavesFeed(enabled: boolean) {
  const [saves, setSaves] = useState<Save[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const cursor = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await listSaves({ archived: false, limit: 500 });
      cursor.current = newest(all);
      setSaves(all);
    } catch (err) {
      console.warn("Failed to fetch saves:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const refresh = useCallback(() => {
    setRefreshing(true);
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!enabled) return;
    setLoading(true);
    void reload();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") void reload();
    });
    return () => sub.remove();
  }, [enabled, reload]);

  const hasPending = saves.some(isPending);
  useEffect(() => {
    if (!enabled || !hasPending) return;
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let stopped = false;

    const tick = async () => {
      try {
        const changed = await listSaves({
          archived: "any",
          ...(cursor.current ? { updatedSince: cursor.current } : {}),
        });
        if (stopped) return;
        if (changed.length) {
          cursor.current = newest(changed) ?? cursor.current;
          setSaves((prev) => merge(prev, changed));
        }
      } catch {
        // Transient (offline, cold start): try again on the next tick.
      }
      if (stopped) return;
      const wait = Date.now() - startedAt < FAST_WINDOW_MS ? POLL_FAST_MS : POLL_SLOW_MS;
      timer = setTimeout(() => void tick(), wait);
    };
    timer = setTimeout(() => void tick(), POLL_FAST_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, hasPending]);

  return { saves, setSaves, loading, refreshing, refresh, reload };
}
