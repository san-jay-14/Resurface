import type { Queryable, Row } from "../client.ts";
import { one } from "../client.ts";
import type { NotificationPrefs } from "./users.ts";

/** Queries behind the daily resurface engine and the reminder sender. */

export interface CalendarEvent extends Row {
  name: string;
  type: "holiday" | "festival" | "long_weekend";
  date: string; // YYYY-MM-DD
}

/** The best calendar event inside [from, to]: explicit long weekends first, then earliest date. */
export async function calendarEventInWindow(
  q: Queryable,
  from: string,
  to: string,
  region = "IN",
): Promise<CalendarEvent | null> {
  return one<CalendarEvent>(
    q,
    `select name, type, date from calendar_events
      where region = $3 and date between $1 and $2
      order by (type = 'long_weekend') desc, date, name limit 1`,
    [from, to, region],
  );
}

export interface UserLite extends Row {
  id: string;
  name: string | null;
  notification_prefs: Partial<NotificationPrefs> | null;
}

export async function getUserLite(q: Queryable, userId: string): Promise<UserLite | null> {
  return one<UserLite>(q, "select id, name, notification_prefs from users where id = $1", [userId]);
}

/**
 * Users whose birthday is on the given month/day. In non-leap years a 29 Feb birthday is observed
 * on 28 Feb, so callers pass `includeFeb29` when the target date is 28 Feb of a non-leap year.
 */
export async function birthdayUserIds(
  q: Queryable,
  month: number,
  day: number,
  includeFeb29: boolean,
): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    `select id from users
      where birthday is not null
        and ((extract(month from birthday) = $1 and extract(day from birthday) = $2)
             or ($3 and extract(month from birthday) = 2 and extract(day from birthday) = 29))`,
    [month, day, includeFeb29],
  );
  return r.rows.map((x) => x.id);
}

/** Distinct users with at least one un-acted-on live save in the given categories. */
export async function usersWithOpenSaves(q: Queryable, categories: string[]): Promise<string[]> {
  const r = await q.query<{ user_id: string }>(
    `select distinct user_id from saves
      where category = any($1::text[]) and acted_on = false and archived = false`,
    [categories],
  );
  return r.rows.map((x) => x.user_id);
}

export interface AwayUser extends Row {
  id: string;
  current_city: string;
}

/** Users currently in a different city than home who have not disabled the new-city trigger. */
export async function awayUsers(q: Queryable): Promise<AwayUser[]> {
  const r = await q.query<AwayUser>(
    `select id, current_city from users
      where current_city is not null and home_city is not null
        and lower(current_city) <> lower(home_city)
        and coalesce((notification_prefs->>'new_city')::boolean, true)`,
  );
  return r.rows;
}

export interface CandidateSave extends Row {
  id: string;
  category: string;
  title: string | null;
  ai_description: string | null;
  note: string | null;
}

const CANDIDATE_COLS = "s.id, s.category, s.title, s.ai_description, s.note";

/** Un-acted-on live saves, favourites first then newest. */
export async function candidateSaves(
  q: Queryable,
  userId: string,
  categories: string[],
  limit = 10,
): Promise<CandidateSave[]> {
  const r = await q.query<CandidateSave>(
    `select ${CANDIDATE_COLS} from saves s
      where s.user_id = $1 and s.category = any($2::text[]) and s.acted_on = false and s.archived = false
      order by s.is_favorite desc, s.created_at desc limit $3`,
    [userId, categories, limit],
  );
  return r.rows;
}

/** The user's own un-acted-on Places saves located in a city (case-insensitive exact match). */
export async function citySaves(
  q: Queryable,
  userId: string,
  city: string,
  limit = 10,
): Promise<CandidateSave[]> {
  const r = await q.query<CandidateSave>(
    `select ${CANDIDATE_COLS} from saves s join save_locations l on l.save_id = s.id
      where s.user_id = $1 and s.category = 'places' and s.acted_on = false and s.archived = false
        and lower(l.city) = lower($2)
      order by s.is_favorite desc, s.created_at desc limit $3`,
    [userId, city, limit],
  );
  return r.rows;
}

export interface NotificationHistoryRow extends Row {
  sent_at: Date;
  save_ids: string[];
}

export async function notificationHistory(
  q: Queryable,
  userId: string,
  since: Date,
): Promise<NotificationHistoryRow[]> {
  const r = await q.query<NotificationHistoryRow>(
    "select sent_at, save_ids from notification_log where user_id = $1 and sent_at >= $2 order by sent_at desc",
    [userId, since],
  );
  return r.rows;
}

export async function insertNotificationLog(
  q: Queryable,
  n: { userId: string; saveIds: string[]; triggerType: string; copy: string; sentAt: Date },
): Promise<string> {
  const r = await one<{ id: string }>(
    q,
    `insert into notification_log (user_id, save_ids, trigger_type, copy, sent_at)
     values ($1, $2::uuid[], $3, $4, $5) returning id`,
    [n.userId, n.saveIds, n.triggerType, n.copy, n.sentAt],
  );
  if (!r) throw new Error("notification_log insert returned no row");
  return r.id;
}

export async function deleteNotificationLog(q: Queryable, id: string): Promise<void> {
  await q.query("delete from notification_log where id = $1", [id]);
}

export async function tokensForUsers(
  q: Queryable,
  userIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (userIds.length === 0) return out;
  const r = await q.query<{ user_id: string; expo_push_token: string }>(
    "select user_id, expo_push_token from device_tokens where user_id = any($1::uuid[])",
    [userIds],
  );
  for (const row of r.rows)
    out.set(row.user_id, [...(out.get(row.user_id) ?? []), row.expo_push_token]);
  return out;
}

export interface ReminderRow extends Row {
  id: string;
  user_id: string;
  title: string | null;
  ai_description: string | null;
  note: string | null;
}

/**
 * Atomically claim due reminders (stamps reminded_at) so overlapping ticks never send one twice.
 * Skip-locked: a concurrent claimer simply takes different rows. `now` is the engine's clock, not
 * the database's, so time-dependent behaviour is consistent and testable.
 */
export async function claimDueReminders(
  q: Queryable,
  now: Date,
  limit: number,
): Promise<ReminderRow[]> {
  const r = await q.query<ReminderRow>(
    `update saves set reminded_at = $1
      where id in (select id from saves
                    where remind_at is not null and remind_at <= $1 and reminded_at is null and archived = false
                    order by remind_at limit $2 for update skip locked)
      returning id, user_id, title, ai_description, note`,
    [now, limit],
  );
  return r.rows;
}

/** Hand reminders back when delivery failed at the transport level, so the next tick retries. */
export async function releaseReminders(q: Queryable, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await q.query("update saves set reminded_at = null where id = any($1::uuid[])", [ids]);
}
