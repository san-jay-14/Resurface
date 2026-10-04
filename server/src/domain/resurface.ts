import type {
  CalendarEvent,
  CandidateSave,
  NotificationHistoryRow,
} from "../db/repos/resurface.ts";

/**
 * Pure rules of the resurface engine: time windows, gates, prompts. No IO and no clock reads (the
 * caller passes `now`), so every branch is unit-testable.
 *
 * Guard pipeline (spec §5.2, in order): 1 relevance, 2 throttle (<=2 per week AND >=3 days since
 * the last), 3 freshness (candidates not notified in the last 30 days), 4 timing (IST 9am-9pm).
 */
export type TriggerType = "long_weekend" | "birthday" | "new_city";

export interface TriggerContext {
  type: TriggerType;
  categories: string[];
  /** Human-readable, passed into the copy prompt. */
  label: string;
}

export const APP_NAME = "Dibs";

// ---- time (India Standard Time, UTC+5:30: the product's launch market) ------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** A Date whose UTC fields read as IST wall-clock fields. */
export const toIST = (now: Date): Date => new Date(now.getTime() + IST_OFFSET_MS);
export const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * DAY_MS);
export const dateStr = (d: Date): string => d.toISOString().slice(0, 10);

/** Quiet hours are 21:00-09:00 IST. */
export function isQuietHours(now: Date): boolean {
  const h = toIST(now).getUTCHours();
  return h < 9 || h >= 21;
}

const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** The month/day whose birthdays fire today: exactly 8 days ahead, observing 29 Feb on 28 Feb. */
export function birthdayTarget(now: Date): { month: number; day: number; includeFeb29: boolean } {
  const target = addDays(toIST(now), 8);
  const month = target.getUTCMonth() + 1;
  const day = target.getUTCDate();
  return {
    month,
    day,
    includeFeb29: month === 2 && day === 28 && !isLeapYear(target.getUTCFullYear()),
  };
}

/** Long-weekend window: events 2-4 days out (IST). */
export function longWeekendWindow(now: Date): { from: string; to: string } {
  const today = toIST(now);
  return { from: dateStr(addDays(today, 2)), to: dateStr(addDays(today, 4)) };
}

/**
 * Explicit long weekends always fire. A plain holiday/festival only creates a 3-day break when it
 * falls on a Monday or Friday.
 */
export function formsLongWeekend(event: CalendarEvent): boolean {
  if (event.type === "long_weekend") return true;
  const dow = new Date(`${event.date}T00:00:00Z`).getUTCDay(); // 0 = Sun, 1 = Mon, 5 = Fri
  return dow === 1 || dow === 5;
}

// ---- gates ----------------------------------------------------------------------------------

export type GateResult =
  | { pass: true; saves: CandidateSave[] }
  | {
      pass: false;
      reason:
        | "no_matching_saves"
        | "throttled_weekly_cap"
        | "throttled_3_day_interval"
        | "all_saves_recently_notified";
    };

export const WEEKLY_CAP = 2;
export const MIN_DAYS_BETWEEN = 3;
export const FRESHNESS_DAYS = 30;
export const SAVES_PER_NOTIFICATION = 2;

/** Gates 1-3 over already-fetched rows. `history` is the user's notification_log for the last 30 days. */
export function applyGates(
  candidates: CandidateSave[],
  history: NotificationHistoryRow[],
  now: Date,
): GateResult {
  // Gate 1 — relevance
  if (candidates.length === 0) return { pass: false, reason: "no_matching_saves" };

  // Gate 2 — throttle
  const weekAgo = now.getTime() - 7 * DAY_MS;
  const inLastWeek = history.filter((h) => h.sent_at.getTime() >= weekAgo).length;
  if (inLastWeek >= WEEKLY_CAP) return { pass: false, reason: "throttled_weekly_cap" };
  const last = history.reduce<number | null>(
    (max, h) => (max === null || h.sent_at.getTime() > max ? h.sent_at.getTime() : max),
    null,
  );
  if (last !== null && (now.getTime() - last) / DAY_MS < MIN_DAYS_BETWEEN) {
    return { pass: false, reason: "throttled_3_day_interval" };
  }

  // Gate 3 — freshness
  const cutoff = now.getTime() - FRESHNESS_DAYS * DAY_MS;
  const recentlySent = new Set(
    history.filter((h) => h.sent_at.getTime() >= cutoff).flatMap((h) => h.save_ids),
  );
  const fresh = candidates.filter((s) => !recentlySent.has(s.id));
  if (fresh.length === 0) return { pass: false, reason: "all_saves_recently_notified" };

  return { pass: true, saves: fresh.slice(0, SAVES_PER_NOTIFICATION) };
}

export function triggerEnabled(
  type: TriggerType,
  prefs: Partial<Record<TriggerType, boolean>> | null | undefined,
): boolean {
  return prefs?.[type] !== false; // only an explicit false disables
}

// ---- copy -----------------------------------------------------------------------------------

export function describeSave(s: CandidateSave): string {
  const label = s.title ?? s.ai_description ?? s.note ?? "a saved item";
  return `"${label.slice(0, 80)}" (${s.category})`;
}

export function buildCopyPrompt(
  trigger: TriggerContext,
  saves: CandidateSave[],
  firstName: string,
): string {
  const who = firstName || "the user";
  const list = saves.map(describeSave).join("\n");
  const head = `You're writing a push notification for ${APP_NAME}, a personal save organizer.`;
  const tail = `Return ONLY the notification body. Nothing else.`;

  switch (trigger.type) {
    case "long_weekend":
      return `${head}

Situation: ${who} has a long weekend coming up (${trigger.label}), 2–4 days from now.

They saved these places they wanted to visit:
${list}

Write exactly 1–2 sentences. Rules:
- Sound like a friend texting, NOT an algorithm or a brand
- Be specific — mention a real detail from what they saved
- Acknowledge the long weekend naturally (don't lead with "Long weekend alert!")
- Max 120 characters total
- No hashtags, no bullet points, no sign-offs

Example style: "You saved that café in Pondicherry 6 weeks ago. Long weekend's 3 days away — finally?"

${tail}`;
    case "birthday":
      return `${head}

Situation: ${who}'s birthday is 8 days away.

They saved these fashion/places items:
${list}

Write exactly 1–2 sentences. Rules:
- Sound like an excited friend who knows their birthday is coming
- Be specific — mention a real detail from what they saved
- Keep it light and fun, not pushy
- Max 120 characters total
- No hashtags, no bullet points

Example style: "Your birthday's in 8 days 🎂 You saved that silk co-ord 3 weeks ago — might be the moment."

${tail}`;
    case "new_city":
      return `${head}

Situation: ${who} has just arrived in ${trigger.label}.

They saved these places in ${trigger.label} that they haven't visited yet:
${list}

Write exactly 1–2 sentences. Rules:
- Sound like a friend who noticed they're finally in the city they've been planning to visit
- Be specific — mention a real detail from the saved place
- Keep it warm and casual, not corporate
- Max 120 characters total
- No hashtags, no bullet points

Example style: "You're in Pondicherry! You saved that rooftop café 3 weeks ago — still want to go?"

${tail}`;
  }
}

export function fallbackCopy(trigger: TriggerContext): string {
  switch (trigger.type) {
    case "birthday":
      return "Your birthday's coming up — you've got some great saves waiting 🎉";
    case "new_city":
      return `You're in ${trigger.label}. You've got places saved here that are waiting for you.`;
    case "long_weekend":
      return `${trigger.label} is coming up. You've got some great places saved.`;
  }
}

/** The model is asked for <=120 chars; enforce a hard ceiling so a runaway reply cannot reach a push. */
export function clipBody(text: string, max = 178): string {
  const t = text.trim().replace(/^["“]|["”]$/g, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 30))}…`;
}

export function reminderBody(s: {
  title: string | null;
  ai_description: string | null;
  note: string | null;
}): string {
  if (s.note) return `You asked to be reminded: "${s.note}"`;
  return `You asked to be reminded about "${s.title ?? s.ai_description ?? "your saved item"}".`;
}

export const firstNameOf = (name: string | null | undefined): string =>
  name?.trim().split(/\s+/)[0] ?? "";
