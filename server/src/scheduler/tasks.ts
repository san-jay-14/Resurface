import { enqueueYoutubeRefresh, reapStuckJobs } from "../db/repos/pipelineJobs.ts";
import { purgeCache, purgeExpiredArchives, purgeTelemetry } from "../db/repos/pipelineHealth.ts";
import { runReminders, runResurface } from "../domain/resurfaceEngine.ts";
import { runCanary } from "../pipeline/canary.ts";
import { drainOnce } from "../pipeline/drain.ts";
import { HOUR, MINUTE, dailyAt, every } from "./schedule.ts";
import type { TaskDef } from "./runner.ts";

/**
 * Every recurring job in the system. With an external pinger calling /internal/tick every ~15
 * minutes, interval tasks shorter than that simply run on each tick.
 */
export const baseTasks: TaskDef[] = [
  {
    name: "drain",
    schedule: every(MINUTE),
    async run(ctx) {
      const s = await drainOnce(ctx);
      return `claimed=${s.claimed} done=${s.done} queued=${s.queued} dead=${s.dead}`;
    },
  },
  {
    name: "reaper",
    schedule: every(5 * MINUTE),
    async run(ctx) {
      return `requeued=${await reapStuckJobs(ctx.db)}`;
    },
  },
  { name: "canary", schedule: every(15 * MINUTE), run: (ctx) => runCanary(ctx) },
  {
    name: "purge-cache",
    schedule: every(HOUR),
    async run(ctx) {
      return `deleted=${await purgeCache(ctx.db)}`;
    },
  },
  {
    name: "housekeeping",
    schedule: dailyAt("03:17"),
    async run(ctx) {
      await purgeTelemetry(ctx.db);
      return `archives_deleted=${await purgeExpiredArchives(ctx.db)}`;
    },
  },
  {
    // Daily at 10:00 IST: long weekend, birthday and new-city notifications. Runs once per day; if the
    // process was down until after quiet hours began, that day is skipped rather than sent at night.
    name: "resurface",
    schedule: dailyAt("04:30"),
    async run(ctx) {
      return JSON.stringify(await runResurface(ctx));
    },
  },
  {
    // User-set reminders are delivered within one tick of their time (not once a day), but never
    // inside quiet hours.
    name: "reminders",
    schedule: every(MINUTE),
    async run(ctx) {
      return JSON.stringify(await runReminders(ctx));
    },
  },
  {
    // YouTube data may be stored for at most 30 days: refresh posts that active saves still use.
    name: "refresh-youtube",
    schedule: dailyAt("02:23"),
    async run(ctx) {
      return `enqueued=${await enqueueYoutubeRefresh(ctx.db)}`;
    },
  },
];
