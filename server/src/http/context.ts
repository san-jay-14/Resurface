import type { AuthPort } from "../auth/port.ts";
import type { Logger } from "../logger.ts";
import type { PipelineContext } from "../pipeline/context.ts";
import type { TaskDef } from "../scheduler/runner.ts";
import type { DrainKicker } from "../scheduler/kicker.ts";

/**
 * Everything a route needs, injected once at the composition root (no module-level singletons).
 * The pipeline context already carries db, config, log, fetch, clock and storage.
 */
export interface Services extends PipelineContext {
  auth: AuthPort;
  /** Triggers an immediate, re-entrancy-safe drain of the enrichment queue. */
  kicker: DrainKicker;
  /** Recurring jobs run by POST /internal/tick. */
  tasks: readonly TaskDef[];
}

export interface AppVariables {
  requestId: string;
  log: Logger;
  /** Set by the authenticate middleware. */
  userId: string;
}

export type AppEnv = { Variables: AppVariables };
