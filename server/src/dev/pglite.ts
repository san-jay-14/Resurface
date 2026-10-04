import { PGlite, type Transaction } from "@electric-sql/pglite";
import { PARSERS, type Db, type Queryable, type QueryResult, type Row } from "../db/client.ts";

/**
 * PGlite-backed Db: real Postgres (WASM), in-memory by default. Used by the test suite and
 * `npm run dev`; never imported by production code (PGlite is a devDependency).
 */
type Runner = Pick<PGlite | Transaction, "query" | "exec">;

async function run<T extends object>(
  r: Runner,
  sql: string,
  params?: readonly unknown[],
): Promise<QueryResult<T>> {
  if (!params || params.length === 0) {
    // exec() accepts multi-statement scripts (migrations); results come back per statement.
    const results = await r.exec(sql);
    const last = results[results.length - 1];
    const rows = (last?.rows ?? []) as T[];
    return { rows, rowCount: Math.max(last?.affectedRows ?? 0, rows.length) };
  }
  const res = await r.query(sql, params as unknown[]);
  // pg semantics: SELECT reports rows returned, DML reports rows affected.
  return { rows: res.rows as T[], rowCount: Math.max(res.affectedRows ?? 0, res.rows.length) };
}

export interface PgliteDb extends Db {
  /** Snapshot of the whole database (used to clone a migrated template cheaply). */
  dump(): Promise<File | Blob>;
}

export async function createPgliteDb(
  opts: { dataDir?: string; loadDataDir?: File | Blob } = {},
): Promise<PgliteDb> {
  const lite = new PGlite({
    ...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
    ...(opts.loadDataDir ? { loadDataDir: opts.loadDataDir } : {}),
    parsers: PARSERS,
  });
  await lite.waitReady;
  const queryable = (r: Runner): Queryable => ({
    query: <T extends object = Row>(sql: string, params?: readonly unknown[]) =>
      run<T>(r, sql, params),
  });
  return {
    ...queryable(lite),
    tx: (fn) => lite.transaction((t) => fn(queryable(t))),
    close: () => lite.close(),
    dump: () => lite.dumpDataDir("none"),
  };
}
