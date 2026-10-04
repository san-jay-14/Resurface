import type { Config } from "../config.ts";
import type { Db } from "../db/client.ts";
import {
  type CandidateSave,
  awayUsers,
  birthdayUserIds,
  calendarEventInWindow,
  candidateSaves,
  citySaves,
  claimDueReminders,
  deleteNotificationLog,
  getUserLite,
  insertNotificationLog,
  notificationHistory,
  releaseReminders,
  tokensForUsers,
  usersWithOpenSaves,
} from "../db/repos/resurface.ts";
import type { Logger } from "../logger.ts";
import { ProviderUnavailable } from "../pipeline/health.ts";
import { ProviderError } from "../adapters/types.ts";
import type { LlmClient } from "../providers/anthropic.ts";
import type { PushSender } from "../push/expo.ts";
import { errorMessage, pool } from "../util.ts";
import {
  APP_NAME,
  type TriggerContext,
  applyGates,
  birthdayTarget,
  buildCopyPrompt,
  clipBody,
  fallbackCopy,
  firstNameOf,
  formsLongWeekend,
  isQuietHours,
  longWeekendWindow,
  reminderBody,
  triggerEnabled,
  FRESHNESS_DAYS,
} from "./resurface.ts";

/**
 * The resurface engine: decides, per user, whether a notification is worth sending, writes
 * friend-tone copy, and delivers it. IO lives here; the rules live in ./resurface.ts.
 *
 * Triggers run SEQUENTIALLY so the throttle gates of a later trigger see the sends of an earlier
 * one (running them in parallel let one user get two notifications in the same run). Users within a
 * trigger are processed with bounded concurrency.
 */
export interface EngineDeps {
  db: Db;
  llm: LlmClient;
  push: PushSender;
  config: Config;
  log: Logger;
  now: () => Date;
}

const USER_CONCURRENCY = 5;
const DAY_MS = 86_400_000;

type SendResult = { sent: boolean; reason: string };

async function generateCopy(
  deps: EngineDeps,
  trigger: TriggerContext,
  saves: CandidateSave[],
  firstName: string,
): Promise<string> {
  try {
    const text = await deps.llm.complete({
      model: deps.config.pipeline.copyModel,
      messages: [{ role: "user", content: buildCopyPrompt(trigger, saves, firstName) }],
      maxTokens: 200,
    });
    const body = clipBody(text);
    if (body) return body;
  } catch (err) {
    // Budget/breaker/API trouble must not silence a notification the gates already approved.
    if (!(err instanceof ProviderError || err instanceof ProviderUnavailable)) throw err;
    deps.log.warn(
      { err: errorMessage(err), trigger: trigger.type },
      "copy generation failed, using fallback",
    );
  }
  return fallbackCopy(trigger);
}

async function processUser(
  deps: EngineDeps,
  userId: string,
  trigger: TriggerContext,
  candidates?: CandidateSave[],
): Promise<SendResult> {
  const { db } = deps;
  const now = deps.now();

  const user = await getUserLite(db, userId);
  if (!user) return { sent: false, reason: "no_user" };
  if (!triggerEnabled(trigger.type, user.notification_prefs)) {
    return { sent: false, reason: "trigger_disabled_by_user" };
  }

  const pool_ = candidates ?? (await candidateSaves(db, userId, trigger.categories));
  const history = await notificationHistory(
    db,
    userId,
    new Date(now.getTime() - FRESHNESS_DAYS * DAY_MS),
  );
  const gate = applyGates(pool_, history, now);
  if (!gate.pass) return { sent: false, reason: gate.reason };

  const tokens = (await tokensForUsers(db, [userId])).get(userId) ?? [];
  if (tokens.length === 0) return { sent: false, reason: "no_device_tokens" };

  // Gates passed: only now spend a model call.
  const copy = await generateCopy(deps, trigger, gate.saves, firstNameOf(user.name));

  // Log first so the push can carry the log id; compensate below if nothing was delivered.
  const logId = await insertNotificationLog(db, {
    userId,
    saveIds: gate.saves.map((s) => s.id),
    triggerType: trigger.type,
    copy,
    sentAt: now,
  });
  const result = await deps.push.send(
    tokens.map((to) => ({
      to,
      title: APP_NAME,
      body: copy,
      priority: "normal" as const,
      data: { save_id: gate.saves[0]?.id, log_id: logId, trigger_type: trigger.type },
    })),
  );

  if (result.ok === 0) {
    // Nothing reached a device: do not burn the user's weekly allowance or freshness window.
    await deleteNotificationLog(db, logId);
    return { sent: false, reason: "push_failed" };
  }
  deps.log.info(
    { userId, trigger: trigger.type, saves: gate.saves.length, logId },
    "notification sent",
  );
  return { sent: true, reason: "ok" };
}

async function processAll(
  deps: EngineDeps,
  userIds: string[],
  trigger: TriggerContext,
  candidatesFor?: (userId: string) => Promise<CandidateSave[]>,
): Promise<{ evaluated: number; sent: number }> {
  let sent = 0;
  await pool(userIds, USER_CONCURRENCY, async (userId) => {
    try {
      const candidates = candidatesFor ? await candidatesFor(userId) : undefined;
      if (candidates && candidates.length === 0) return;
      if ((await processUser(deps, userId, trigger, candidates)).sent) sent++;
    } catch (err) {
      deps.log.error(
        { userId, trigger: trigger.type, err: errorMessage(err) },
        "resurface user failed",
      );
    }
  });
  return { evaluated: userIds.length, sent };
}

export interface ResurfaceSummary {
  skipped?: string;
  long_weekend?: { skipped?: string; label?: string; evaluated?: number; sent?: number };
  birthday?: { skipped?: string; evaluated?: number; sent?: number };
  new_city?: { skipped?: string; evaluated?: number; sent?: number };
}

export async function runResurface(deps: EngineDeps): Promise<ResurfaceSummary> {
  const now = deps.now();
  if (isQuietHours(now)) return { skipped: "quiet_hours" };
  const summary: ResurfaceSummary = {};

  // 1. long weekend
  const win = longWeekendWindow(now);
  const event = await calendarEventInWindow(deps.db, win.from, win.to);
  if (!event || !formsLongWeekend(event)) {
    summary.long_weekend = { skipped: "no_long_weekend_detected" };
  } else {
    const users = await usersWithOpenSaves(deps.db, ["places"]);
    const r = await processAll(deps, users, {
      type: "long_weekend",
      categories: ["places"],
      label: event.name,
    });
    summary.long_weekend = { label: event.name, ...r };
  }

  // 2. birthday (8 days out)
  const b = birthdayTarget(now);
  const birthdays = await birthdayUserIds(deps.db, b.month, b.day, b.includeFeb29);
  summary.birthday = birthdays.length
    ? await processAll(deps, birthdays, {
        type: "birthday",
        categories: ["fashion", "places"],
        label: "Birthday in 8 days",
      })
    : { skipped: "no_birthdays_in_8_days" };

  // 3. new city: users away from home who have saved places where they are now
  const away = await awayUsers(deps.db);
  if (away.length === 0) {
    summary.new_city = { skipped: "no_users_away" };
  } else {
    const cityOf = new Map(away.map((u) => [u.id, u.current_city]));
    let sent = 0;
    for (const u of away) {
      // One trigger context per user (the label is their current city); gates apply to the
      // city-matched saves themselves, not to unrelated candidates.
      const r = await processAll(
        deps,
        [u.id],
        { type: "new_city", categories: ["places"], label: cityOf.get(u.id) ?? u.current_city },
        (id) => citySaves(deps.db, id, cityOf.get(id) ?? u.current_city),
      );
      sent += r.sent;
    }
    summary.new_city = { evaluated: away.length, sent };
  }

  deps.log.info({ summary }, "resurface run complete");
  return summary;
}

// ---------------------------------------------------------------------------
// Custom reminders: "remind me about this on X" (saves.remind_at). The user already asked for these,
// so they skip the relevance/throttle/freshness gates. Quiet hours still apply.
// ---------------------------------------------------------------------------
export interface ReminderSummary {
  skipped?: string;
  claimed?: number;
  delivered?: number;
  retried?: number;
}

export async function runReminders(deps: EngineDeps): Promise<ReminderSummary> {
  if (isQuietHours(deps.now())) return { skipped: "quiet_hours" };
  const due = await claimDueReminders(deps.db, deps.now(), 200);
  if (due.length === 0) return { skipped: "no_due_reminders" };

  const tokens = await tokensForUsers(deps.db, [...new Set(due.map((d) => d.user_id))]);
  let delivered = 0;
  const retry: string[] = [];

  for (const reminder of due) {
    const to = tokens.get(reminder.user_id) ?? [];
    // No device: the reminder is consumed anyway so it is not retried forever.
    if (to.length === 0) continue;
    const result = await deps.push.send(
      to.map((t) => ({
        to: t,
        title: `Reminder from ${APP_NAME}`,
        body: reminderBody(reminder),
        priority: "high" as const,
        data: { save_id: reminder.id, trigger_type: "custom_reminder" },
      })),
    );
    if (result.ok > 0) delivered++;
    else if (result.transportFailure) retry.push(reminder.id); // never reached Expo: try again next tick
  }
  await releaseReminders(deps.db, retry);
  return { claimed: due.length, delivered, retried: retry.length };
}
