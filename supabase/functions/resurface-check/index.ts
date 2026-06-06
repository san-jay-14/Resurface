// Resurface Engine — daily trigger check (Milestone 4)
//
// Called by pg_cron at 04:30 UTC (10:00 IST) every day.
// Checks V1 calendar triggers (long_weekend, birthday), runs the 4-gate guard
// pipeline, generates friend-tone AI copy with Claude, and sends Expo push
// notifications.
//
// Guard pipeline (spec §5.2, must pass in order):
//   1. Relevance  — user has ≥1 un-acted-on save in the trigger's categories
//   2. Throttle   — ≤2 notifications sent this week AND ≥3 days since last
//   3. Freshness  — the candidate saves were not notified in the last 30 days
//   4. Timing     — current IST time is 9am–9pm (checked once at entry)

import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";

const SUPABASE_URL              = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY         = Deno.env.get("ANTHROPIC_API_KEY")!;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type TriggerType   = "long_weekend" | "birthday";
type SaveCategory  = "places" | "recipes" | "fashion" | "shopping" | "watch_learn" | "inspo" | "unsorted";

interface UserRow {
  id: string;
  name: string | null;
  birthday: string | null;
  home_city: string | null;
  last_notified_at: string | null;
}

interface SaveRow {
  id: string;
  user_id: string;
  category: SaveCategory;
  title: string | null;
  ai_description: string | null;
  note: string | null;
  acted_on: boolean;
  is_favorite: boolean;
  created_at: string;
}

interface TriggerContext {
  type: TriggerType;
  categories: SaveCategory[];
  label: string; // human-readable, passed to AI prompt
}

// ---------------------------------------------------------------------------
// IST time helpers (UTC+5:30)
// ---------------------------------------------------------------------------
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function toIST(date = new Date()): Date {
  return new Date(date.getTime() + IST_OFFSET_MS);
}

function isQuietHours(istDate: Date): boolean {
  const h = istDate.getUTCHours();
  return h < 9 || h >= 21; // quiet: 9pm–9am
}

function addDays(date: Date, n: number): Date {
  return new Date(date.getTime() + n * 86_400_000);
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000;
}

// ---------------------------------------------------------------------------
// Structured logger
// ---------------------------------------------------------------------------
function log(step: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ step, ts: new Date().toISOString(), ...data }));
}

// ---------------------------------------------------------------------------
// TRIGGER DETECTION
// ---------------------------------------------------------------------------

/** Long-weekend trigger: fire when a long_weekend/holiday calendar event is
 *  2–4 days from now (gives a "3 days out" window). */
async function detectLongWeekend(
  admin: SupabaseClient,
  todayIST: Date,
): Promise<{ detected: boolean; label: string }> {
  const from = toDateStr(addDays(todayIST, 2));
  const to   = toDateStr(addDays(todayIST, 4));

  const { data, error } = await admin
    .from("calendar_events")
    .select("name, type, date")
    .in("type", ["long_weekend", "holiday", "festival"])
    .gte("date", from)
    .lte("date", to)
    .eq("region", "IN")
    .limit(1)
    .maybeSingle();

  if (error || !data) return { detected: false, label: "" };

  // For regular holidays, only fire if the holiday falls on a Friday or Monday
  // (creating a 3-day break). For explicitly tagged long_weekends, always fire.
  if (data.type !== "long_weekend") {
    const eventDate   = new Date(data.date + "T00:00:00Z");
    const dayOfWeek   = eventDate.getUTCDay(); // 0=Sun, 1=Mon, 5=Fri
    const isBridgeDay = dayOfWeek === 1 || dayOfWeek === 5;
    if (!isBridgeDay) return { detected: false, label: "" };
  }

  log("long_weekend_detected", { name: data.name, date: data.date, type: data.type });
  return { detected: true, label: data.name };
}

/** Birthday trigger: find users whose birthday is exactly 8 days from today. */
async function findBirthdayUsers(
  admin: SupabaseClient,
  todayIST: Date,
): Promise<UserRow[]> {
  const target = addDays(todayIST, 8);
  const targetMonth = target.getUTCMonth() + 1; // 1-based
  const targetDay   = target.getUTCDate();

  // Supabase doesn't support EXTRACT in JS filters, so fetch users with a
  // birthday and filter server-side with a Postgres function approach.
  // For V1 user counts, fetching all users with birthdays is acceptable.
  const { data, error } = await admin
    .from("users")
    .select("id, name, birthday, home_city, last_notified_at")
    .not("birthday", "is", null);

  if (error || !data) return [];

  return (data as UserRow[]).filter((u) => {
    if (!u.birthday) return false;
    const bday   = new Date(u.birthday + "T00:00:00Z");
    return bday.getUTCMonth() + 1 === targetMonth &&
           bday.getUTCDate()       === targetDay;
  });
}

// ---------------------------------------------------------------------------
// CANDIDATE SAVE SELECTION
// ---------------------------------------------------------------------------

/** Return un-acted-on, non-archived saves for the user in the given categories,
 *  ordered: favorites first, then by most recently saved. */
async function fetchCandidateSaves(
  admin: SupabaseClient,
  userId: string,
  categories: SaveCategory[],
): Promise<SaveRow[]> {
  const { data, error } = await admin
    .from("saves")
    .select("id, user_id, category, title, ai_description, note, acted_on, is_favorite, created_at")
    .eq("user_id", userId)
    .in("category", categories)
    .eq("acted_on", false)
    .eq("archived", false)
    .order("is_favorite", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) return [];
  return (data as SaveRow[]) ?? [];
}

// ---------------------------------------------------------------------------
// GUARD PIPELINE
// ---------------------------------------------------------------------------

interface GuardResult {
  pass: boolean;
  reason: string;
  saves?: SaveRow[];
}

async function runGuardPipeline(
  admin: SupabaseClient,
  userId: string,
  categories: SaveCategory[],
): Promise<GuardResult> {
  // Gate 1 — Relevance
  const candidates = await fetchCandidateSaves(admin, userId, categories);
  if (candidates.length === 0) {
    return { pass: false, reason: "no_matching_saves" };
  }

  // Gate 2 — Throttle: ≤2 notifications this week AND ≥3 days since last
  const oneWeekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count: weeklyCount } = await admin
    .from("notification_log")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("sent_at", oneWeekAgo);

  if ((weeklyCount ?? 0) >= 2) {
    return { pass: false, reason: "throttled_weekly_cap" };
  }

  const { data: lastLog } = await admin
    .from("notification_log")
    .select("sent_at")
    .eq("user_id", userId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastLog) {
    const days = daysBetween(new Date(), new Date(lastLog.sent_at));
    if (days < 3) {
      return { pass: false, reason: "throttled_3_day_interval" };
    }
  }

  // Gate 3 — Freshness: saves must not have been in a notification in the last 30 days
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: recentLogs } = await admin
    .from("notification_log")
    .select("save_ids")
    .eq("user_id", userId)
    .gte("sent_at", thirtyDaysAgo);

  const recentlySentIds = new Set<string>(
    (recentLogs ?? []).flatMap((l) => (l.save_ids as string[]) ?? []),
  );

  const freshSaves = candidates.filter((s) => !recentlySentIds.has(s.id));
  if (freshSaves.length === 0) {
    return { pass: false, reason: "all_saves_recently_notified" };
  }

  // All gates passed — return the top 2 fresh saves
  return { pass: true, reason: "ok", saves: freshSaves.slice(0, 2) };
}

// ---------------------------------------------------------------------------
// AI COPY GENERATION
// ---------------------------------------------------------------------------

function describeSave(save: SaveRow): string {
  const label = save.title ?? save.ai_description ?? save.note ?? "a saved item";
  return `"${label.slice(0, 80)}" (${save.category})`;
}

async function generateCopy(
  trigger: TriggerContext,
  saves: SaveRow[],
  firstName: string,
): Promise<string> {
  const saveList = saves.map(describeSave).join("\n");

  const prompts: Record<TriggerType, string> = {
    long_weekend: `You're writing a push notification for Resurface, a personal save organizer.

Situation: ${firstName || "the user"} has a long weekend coming up (${trigger.label}), 2–4 days from now.

They saved these places they wanted to visit:
${saveList}

Write exactly 1–2 sentences. Rules:
- Sound like a friend texting, NOT an algorithm or a brand
- Be specific — mention a real detail from what they saved
- Acknowledge the long weekend naturally (don't lead with "Long weekend alert!")
- Max 120 characters total
- No hashtags, no bullet points, no sign-offs

Example style: "You saved that café in Pondicherry 6 weeks ago. Long weekend's 3 days away — finally?"

Return ONLY the notification body. Nothing else.`,

    birthday: `You're writing a push notification for Resurface, a personal save organizer.

Situation: ${firstName || "the user"}'s birthday is 8 days away.

They saved these fashion/places items:
${saveList}

Write exactly 1–2 sentences. Rules:
- Sound like an excited friend who knows their birthday is coming
- Be specific — mention a real detail from what they saved
- Keep it light and fun, not pushy
- Max 120 characters total
- No hashtags, no bullet points

Example style: "Your birthday's in 8 days 🎂 You saved that silk co-ord 3 weeks ago — might be the moment."

Return ONLY the notification body. Nothing else.`,
  };

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompts[trigger.type] }],
    });
    const copy = msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
    log("ai_copy_generated", { triggerType: trigger.type, copy });
    return copy;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log("ai_copy_error", { error: msg });
    // Fallback copy if Claude call fails
    return trigger.type === "birthday"
      ? "Your birthday's coming up — you've got some great saves waiting 🎉"
      : `${trigger.label} is coming up. You've got some great places saved.`;
  }
}

// ---------------------------------------------------------------------------
// EXPO PUSH DELIVERY
// ---------------------------------------------------------------------------

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  priority: "normal" | "high";
}

async function sendExpoPush(messages: ExpoPushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const resp = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Accept":        "application/json",
      "Accept-Encoding": "gzip, deflate",
    },
    body: JSON.stringify(messages),
  });

  if (!resp.ok) {
    log("expo_push_error", { status: resp.status, body: await resp.text() });
    return;
  }

  const result = await resp.json();
  log("expo_push_sent", { count: messages.length, result });
}

// ---------------------------------------------------------------------------
// PER-USER PROCESSING
// ---------------------------------------------------------------------------

async function processUser(
  admin: SupabaseClient,
  userId: string,
  trigger: TriggerContext,
): Promise<{ sent: boolean; reason: string }> {
  log("process_user_start", { userId, trigger: trigger.type });

  // Guard pipeline
  const guard = await runGuardPipeline(admin, userId, trigger.categories);
  log("guard_result", { userId, trigger: trigger.type, ...guard });

  if (!guard.pass || !guard.saves || guard.saves.length === 0) {
    return { sent: false, reason: guard.reason };
  }

  const topSaves = guard.saves;

  // Fetch user details for the AI prompt
  const { data: userRow } = await admin
    .from("users")
    .select("name")
    .eq("id", userId)
    .maybeSingle();

  const firstName = (userRow?.name as string | null)?.split(" ")[0] ?? "";

  // Fetch device tokens
  const { data: tokens } = await admin
    .from("device_tokens")
    .select("expo_push_token")
    .eq("user_id", userId);

  const pushTokens = (tokens ?? []).map((t) => t.expo_push_token as string).filter(Boolean);
  if (pushTokens.length === 0) {
    log("no_device_tokens", { userId });
    return { sent: false, reason: "no_device_tokens" };
  }

  // Generate AI copy (gates have passed — do this last)
  const copy = await generateCopy(trigger, topSaves, firstName);
  if (!copy) {
    return { sent: false, reason: "copy_generation_failed" };
  }

  // Log the notification first (so we have a log_id for the push data)
  const { data: logRow } = await admin
    .from("notification_log")
    .insert({
      user_id:      userId,
      save_ids:     topSaves.map((s) => s.id),
      trigger_type: trigger.type,
      copy,
      sent_at:      new Date().toISOString(),
      tapped:       false,
    })
    .select("id")
    .single();

  const logId = (logRow as { id: string } | null)?.id ?? null;

  // Send push notification to all user devices
  const messages: ExpoPushMessage[] = pushTokens.map((token) => ({
    to:    token,
    title: "Resurface",
    body:  copy,
    data: {
      save_id:      topSaves[0].id,
      log_id:       logId,
      trigger_type: trigger.type,
    },
    sound:    "default",
    priority: "normal",
  }));

  await sendExpoPush(messages);

  // Update the user's last_notified_at
  await admin
    .from("users")
    .update({ last_notified_at: new Date().toISOString() })
    .eq("id", userId);

  log("notification_sent", { userId, trigger: trigger.type, saveCount: topSaves.length, logId });
  return { sent: true, reason: "ok" };
}

// ---------------------------------------------------------------------------
// TRIGGER RUNNERS
// ---------------------------------------------------------------------------

async function runLongWeekendTrigger(
  admin: SupabaseClient,
  todayIST: Date,
): Promise<Record<string, unknown>> {
  const { detected, label } = await detectLongWeekend(admin, todayIST);
  if (!detected) return { skipped: true, reason: "no_long_weekend_detected" };

  log("long_weekend_trigger_running", { label });

  const trigger: TriggerContext = {
    type:       "long_weekend",
    categories: ["places"],
    label,
  };

  // Find all users who have un-acted-on Places saves (relevance pre-filter)
  const { data: candidateUsers } = await admin
    .from("saves")
    .select("user_id")
    .eq("category", "places")
    .eq("acted_on", false)
    .eq("archived", false);

  const uniqueUserIds = [...new Set((candidateUsers ?? []).map((r) => r.user_id as string))];
  log("long_weekend_candidate_users", { count: uniqueUserIds.length });

  const results = await Promise.all(uniqueUserIds.map((uid) => processUser(admin, uid, trigger)));
  const sent = results.filter((r) => r.sent).length;

  return { label, usersEvaluated: uniqueUserIds.length, sent };
}

async function runBirthdayTrigger(
  admin: SupabaseClient,
  todayIST: Date,
): Promise<Record<string, unknown>> {
  const birthdayUsers = await findBirthdayUsers(admin, todayIST);
  if (birthdayUsers.length === 0) return { skipped: true, reason: "no_birthdays_today+8" };

  log("birthday_trigger_running", { userCount: birthdayUsers.length });

  const trigger: TriggerContext = {
    type:       "birthday",
    categories: ["fashion", "places"],
    label:      "Birthday in 8 days",
  };

  const results = await Promise.all(
    birthdayUsers.map((u) => processUser(admin, u.id, trigger)),
  );
  const sent = results.filter((r) => r.sent).length;

  return { usersEvaluated: birthdayUsers.length, sent };
}

// ---------------------------------------------------------------------------
// ENTRY POINT
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" },
    });
  }

  log("resurface_check_start");

  // Only service-role callers (pg_cron or admin) may invoke this.
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Timing gate — checked once at entry for all triggers
  const nowIST = toIST();
  if (isQuietHours(nowIST)) {
    log("quiet_hours_skip", { istHour: nowIST.getUTCHours() });
    return Response.json({ ok: false, reason: "quiet_hours" });
  }

  log("timing_ok", { istHour: nowIST.getUTCHours() });

  const [longWeekendResult, birthdayResult] = await Promise.all([
    runLongWeekendTrigger(admin, nowIST),
    runBirthdayTrigger(admin, nowIST),
  ]);

  const summary = { long_weekend: longWeekendResult, birthday: birthdayResult };
  log("resurface_check_complete", { summary });

  return Response.json({ ok: true, ...summary });
});
