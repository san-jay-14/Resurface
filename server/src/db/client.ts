import pg from "pg";
import type { Logger } from "../logger.ts";

/**
 * Minimal database abstraction. Production uses a `pg` pool against Neon; tests and
 * `npm run dev` use PGlite (real Postgres compiled to WASM) behind the same interface,
 * so repository code is exercised against real SQL everywhere.
 */
export type Row = Record<string, unknown>;

export interface QueryResult<T extends object = Row> {
  rows: T[];
  rowCount: number;
}

export interface Queryable {
  query<T extends object = Row>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Queryable {
  /** Run `fn` in a transaction; commits on resolve, rolls back on throw. */
  tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** First row or null. */
export async function one<T extends object>(
  q: Queryable,
  sql: string,
  params?: readonly unknown[],
): Promise<T | null> {
  const r = await q.query<T>(sql, params);
  return r.rows[0] ?? null;
}

/** Serialize a value for a `jsonb` parameter (the pg driver would turn JS arrays into PG arrays). */
export const json = (value: unknown): string => JSON.stringify(value);

/**
 * Driver-independent value types, applied to both `pg` and PGlite so repository code sees the
 * same shapes everywhere: int8 -> number (ids/counters are far below 2^53), date -> 'YYYY-MM-DD'
 * string (no timezone surprises), numeric stays a string (convert explicitly where needed).
 */
export const TYPE_OIDS = { INT8: 20, DATE: 1082 } as const;
export const PARSERS: Record<number, (v: string) => unknown> = {
  [TYPE_OIDS.INT8]: (v) => Number(v),
  [TYPE_OIDS.DATE]: (v) => v,
};

export interface PoolOptions {
  url: string;
  max: number;
  log: Logger;
}

// Errors where the statement was never sent, so a retry is always safe.
const CONNECT_ERRORS = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EAI_AGAIN"]);

function isConnectFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  return (
    (code !== undefined && CONNECT_ERRORS.has(code)) ||
    /timeout exceeded when trying to connect/i.test(err.message)
  );
}

/**
 * pg pool tuned for Neon: small, short idle timeout (compute scales to zero after 5 min of
 * inactivity, so idle sockets should not outlive it), generous connect timeout for cold starts.
 * Never uses session state (SET, LISTEN, session advisory locks): the pooler runs PgBouncer
 * in transaction mode.
 */
export function createPgPool({ url, max, log }: PoolOptions): pg.Pool {
  pg.types.setTypeParser(TYPE_OIDS.INT8, (v: string) => Number(v));
  pg.types.setTypeParser(TYPE_OIDS.DATE, (v: string) => v);
  const pool = new pg.Pool({
    connectionString: url,
    max,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 15_000,
    query_timeout: 30_000,
    keepAlive: true,
    application_name: "resurface-api",
  });
  pool.on("error", (err) => log.warn({ err }, "idle postgres client error"));
  return pool;
}

/** Wrap a pool in the Db interface (the same pool can also back Better Auth). */
export function dbFromPool(pool: pg.Pool, log: Logger): Db {
  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (err) {
        if (!isConnectFailure(err) || attempt >= 2) throw err;
        attempt += 1;
        log.warn({ attempt }, "database connect failed, retrying");
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  const run = async <T extends object>(
    q: Pick<pg.Pool, "query"> | pg.PoolClient,
    sql: string,
    params?: readonly unknown[],
  ): Promise<QueryResult<T>> => {
    const r = await q.query(sql, params as unknown[] | undefined);
    return { rows: r.rows as T[], rowCount: r.rowCount ?? 0 };
  };

  return {
    query: <T extends object = Row>(sql: string, params?: readonly unknown[]) =>
      withRetry(() => run<T>(pool, sql, params)),

    async tx<T>(fn: (q: Queryable) => Promise<T>): Promise<T> {
      const client = await withRetry(() => pool.connect());
      try {
        await client.query("BEGIN");
        const result = await fn({
          query: <R extends object = Row>(sql: string, params?: readonly unknown[]) =>
            run<R>(client, sql, params),
        });
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },

    close: () => pool.end(),
  };
}
