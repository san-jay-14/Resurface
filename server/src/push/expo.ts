import type { Queryable } from "../db/client.ts";
import type { Logger } from "../logger.ts";
import { errorMessage } from "../util.ts";

/**
 * Expo push delivery. Messages are sent in chunks of 100 (Expo's limit); per-token failures come
 * back as tickets inside an HTTP 200, and `DeviceNotRegistered` means the token is dead, so it is
 * pruned instead of being retried forever.
 */
export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  priority: "normal" | "high";
}

export interface PushResult {
  /** Tickets accepted by Expo. */
  ok: number;
  /** Tickets rejected (bad/dead token, etc.). */
  failed: number;
  /** Dead tokens removed from device_tokens. */
  pruned: number;
  /** True when a whole request failed (network/HTTP): nothing in that chunk reached Expo. */
  transportFailure: boolean;
}

export interface PushSender {
  send(messages: PushMessage[]): Promise<PushResult>;
}

interface Ticket {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
}

const CHUNK = 100;
const ENDPOINT = "https://exp.host/--/api/v2/push/send";

export function createPushSender(deps: {
  fetch: typeof fetch;
  db: Queryable;
  log: Logger;
  accessToken?: string | undefined;
}): PushSender {
  const { db, log } = deps;

  return {
    async send(messages) {
      const result: PushResult = { ok: 0, failed: 0, pruned: 0, transportFailure: false };
      for (let i = 0; i < messages.length; i += CHUNK) {
        const chunk = messages.slice(i, i + CHUNK);
        let tickets: Ticket[];
        try {
          const resp = await deps.fetch(ENDPOINT, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              accept: "application/json",
              ...(deps.accessToken ? { authorization: `Bearer ${deps.accessToken}` } : {}),
            },
            body: JSON.stringify(chunk.map((m) => ({ ...m, sound: "default" }))),
            signal: AbortSignal.timeout(15_000),
          });
          if (!resp.ok) {
            log.warn({ status: resp.status }, "expo push http error");
            result.transportFailure = true;
            continue;
          }
          tickets = ((await resp.json()) as { data?: Ticket[] }).data ?? [];
        } catch (err) {
          log.warn({ err: errorMessage(err) }, "expo push request failed");
          result.transportFailure = true;
          continue;
        }

        for (const [j, ticket] of tickets.entries()) {
          if (ticket.status === "ok") {
            result.ok++;
            continue;
          }
          result.failed++;
          const token = chunk[j]?.to;
          if (token && ticket.details?.error === "DeviceNotRegistered") {
            await db.query("delete from device_tokens where expo_push_token = $1", [token]);
            result.pruned++;
          } else {
            log.warn(
              { token: token?.slice(0, 24), message: ticket.message },
              "expo push ticket error",
            );
          }
        }
      }
      return result;
    },
  };
}
