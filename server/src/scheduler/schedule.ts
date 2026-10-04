/**
 * Schedule arithmetic, pure and clock-injected. Times are UTC. A schedule yields the next run
 * strictly after a reference instant.
 */
export type Schedule =
  | { kind: "every"; ms: number }
  | { kind: "daily"; at: string } // "HH:MM" UTC
  | { kind: "weekly"; day: number; at: string }; // day: 0 = Sunday

export const every = (ms: number): Schedule => ({ kind: "every", ms });
export const dailyAt = (at: string): Schedule => ({ kind: "daily", at });
export const weeklyAt = (day: number, at: string): Schedule => ({ kind: "weekly", day, at });

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

function parseAt(at: string): { h: number; m: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(at);
  if (!match) throw new Error(`invalid time "${at}", expected HH:MM`);
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) throw new Error(`invalid time "${at}"`);
  return { h, m };
}

/** The next occurrence strictly after `from`. */
export function nextRun(schedule: Schedule, from: Date): Date {
  if (schedule.kind === "every") return new Date(from.getTime() + schedule.ms);

  const { h, m } = parseAt(schedule.at);
  const candidate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), h, m, 0, 0),
  );
  if (schedule.kind === "daily") {
    if (candidate.getTime() <= from.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
    return candidate;
  }
  const ahead = (schedule.day - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + ahead);
  if (candidate.getTime() <= from.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate;
}

/** Where a brand-new task starts: interval tasks run on the first tick, calendar tasks wait for their slot. */
export function firstRun(schedule: Schedule, now: Date): Date {
  return schedule.kind === "every" ? now : nextRun(schedule, now);
}
