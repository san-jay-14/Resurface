import { nextDueAt } from "../db/repos/pipelineJobs.ts";
import { drainOnce } from "../pipeline/drain.ts";
import type { PipelineContext } from "../pipeline/context.ts";
import { errMessage } from "../pipeline/trace.ts";

/**
 * In-process drain trigger. A save is processed immediately when it is enqueued (instead of waiting
 * for the next external tick), and a timer is armed for the next backoff/retry so a live instance
 * does not wait for the pinger either. If the process is asleep, the external tick covers it.
 * Re-entrancy safe: kicks while a drain is running collapse into one follow-up run.
 */
export interface DrainKicker {
  kick(): void;
  stop(): void;
}

const MAX_TIMER_MS = 30 * 60_000;

export function createDrainKicker(ctx: PipelineContext): DrainKicker {
  let running = false;
  let again = false;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const arm = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    const due = await nextDueAt(ctx.db);
    if (!due || stopped) return;
    const delay = Math.min(Math.max(due.getTime() - ctx.now().getTime(), 1000), MAX_TIMER_MS);
    timer = setTimeout(() => kick(), delay);
    timer.unref();
  };

  const loop = async (): Promise<void> => {
    running = true;
    try {
      do {
        again = false;
        await drainOnce(ctx);
      } while (again && !stopped);
      await arm();
    } catch (err) {
      ctx.log.error({ err: errMessage(err) }, "drain kick failed");
    } finally {
      running = false;
    }
  };

  function kick(): void {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    void loop();
  }

  return {
    kick,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
