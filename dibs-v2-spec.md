# Dibs — V2 Feature Spec
### Build-Ready Document for Claude Code

> **Context:** V1 shipped the core loop — share sheet capture, 6-category auto-sort, organizer layer (search/sort, detail view, acted-on toggle, notes, favorites, flat boards). V2 ships the intelligence and social layers that turn Dibs from a useful tool into an indispensable one.

---

## Table of Contents

1. [V2 Overview & Goals](#1-v2-overview--goals)
2. [Feature 1: AI Rule System](#2-feature-1-ai-rule-system)
3. [Feature 2: Self-Cleaning Swipe Mode](#3-feature-2-self-cleaning-swipe-mode)
4. [Feature 3: Wrapped Personality Cards](#4-feature-3-wrapped-personality-cards)
5. [Feature 4: Shared Boards & Social Saves](#5-feature-4-shared-boards--social-saves)
6. [Feature 5: Extended Platform Integrations](#6-feature-5-extended-platform-integrations)
7. [Database Schema Changes](#7-database-schema-changes)
8. [Edge Functions & Background Jobs](#8-edge-functions--background-jobs)
9. [Navigation & App Architecture Changes](#9-navigation--app-architecture-changes)
10. [Do NOT Build](#10-do-not-build)

---

## 1. V2 Overview & Goals

### What V2 Is

V2 deepens Dibs on three axes:

- **Intelligence** — AI rules that make categorization smarter over time, self-cleaning that prevents library rot
- **Delight** — Wrapped cards that make the app feel personal and give users something to share
- **Social** — Shared boards that unlock a new retention mechanic and expand the user base through invites

### Stack Continuity

V2 is built on the exact same stack as V1:
- **Framework:** Expo (managed workflow), React Native, Android-first
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron)
- **Notifications:** Expo Push
- **Location:** expo-location
- **New additions:** Claude API (for rule parsing + Wrapped generation), react-native-reanimated (for swipe cards)

### Feature Priority Order

Build in this sequence. Each feature is independently shippable.

```
1. AI Rule System            ← highest retention impact, no social risk
2. Self-Cleaning Swipe Mode  ← keeps library healthy, low complexity
3. Wrapped Personality Cards ← growth flywheel, time it with 60-day user milestone
4. Shared Boards             ← most complex, ship last
5. Platform Integrations     ← additive, parallelisable with #4
```

---

## 2. Feature 1: AI Rule System

### 2.1 What It Does

Users write plain-English rules. The AI parses them into structured logic that runs at save-time and retroactively on existing saves.

**Example rules users might write:**
- *"Anything with #mumbai goes into Places > Mumbai"*
- *"If it's from @cookingwithayesha, put it in Recipes"*
- *"Reels mentioning Zara or H&M are Shopping"*
- *"Anything I save on Friday nights is Inspo"*
- *"If the caption has 'recipe' or 'ingredients', always pick Recipes even if it looks like Inspo"*

### 2.2 Data Model

```sql
-- New table
create table public.user_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  raw_text     text not null,                    -- user's original plain-English input
  parsed_logic jsonb not null,                   -- structured rule, see schema below
  is_active    boolean not null default true,
  priority     int not null default 0,           -- lower = evaluated first
  hit_count    int not null default 0,           -- how many saves this rule has matched
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_user_rules_user_active on public.user_rules(user_id, is_active);
```

**`parsed_logic` JSONB schema:**

```json
{
  "conditions": [
    {
      "field": "caption | username | url | platform | time_of_day | day_of_week",
      "operator": "contains | equals | matches_regex | before | after | is",
      "value": "string or array of strings"
    }
  ],
  "condition_logic": "AND | OR",
  "action": {
    "set_category": "Places | Recipes | Fashion | Shopping | WatchLearn | Inspo",
    "set_tags": ["optional", "array"],
    "add_to_board": "optional board name"
  }
}
```

### 2.3 Rule Parsing — Claude API Call

**Trigger:** User submits a rule in the UI. Call happens on the Supabase Edge Function `parse-rule`.

**Edge Function: `parse-rule`**

```typescript
// supabase/functions/parse-rule/index.ts

import Anthropic from "npm:@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a rule parser for a content-saving app called Dibs.
The app has exactly six categories: Places, Recipes, Fashion, Shopping, WatchLearn, Inspo.

When a user writes a plain-English rule, convert it to structured JSON matching this schema exactly:
{
  "conditions": [
    {
      "field": "caption | username | url | platform | time_of_day | day_of_week",
      "operator": "contains | equals | matches_regex | before | after | is",
      "value": "<string or array of strings>"
    }
  ],
  "condition_logic": "AND | OR",
  "action": {
    "set_category": "<one of the six categories or null>",
    "set_tags": ["<optional array of strings>"],
    "add_to_board": "<optional board name or null>"
  }
}

Rules:
- condition_logic is AND if all conditions must match, OR if any condition matches
- set_category must be exactly one of: Places, Recipes, Fashion, Shopping, WatchLearn, Inspo, or null
- If you cannot parse the rule into a valid structure, return { "error": "reason" }
- Return ONLY valid JSON. No explanation, no markdown.`;

Deno.serve(async (req) => {
  const { rule_text, user_id } = await req.json();

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: rule_text }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "";

  try {
    const parsed = JSON.parse(raw);
    if (parsed.error) {
      return new Response(JSON.stringify({ ok: false, error: parsed.error }), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true, parsed_logic: parsed }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Parse failed" }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

### 2.4 Rule Evaluation

Rules are evaluated in two places:

**A. At save-time** — inside the existing `process-save` Edge Function, after basic category inference, before writing to DB:

```typescript
// Inside process-save, after initial category is determined

async function applyUserRules(save: PendingSave, userId: string, initialCategory: string): Promise<string> {
  const { data: rules } = await supabase
    .from("user_rules")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("priority", { ascending: true });

  if (!rules || rules.length === 0) return initialCategory;

  for (const rule of rules) {
    if (evaluateConditions(save, rule.parsed_logic)) {
      // Increment hit count
      await supabase
        .from("user_rules")
        .update({ hit_count: rule.hit_count + 1 })
        .eq("id", rule.id);

      return rule.parsed_logic.action.set_category ?? initialCategory;
    }
  }

  return initialCategory;
}

function evaluateConditions(save: PendingSave, logic: ParsedLogic): boolean {
  const results = logic.conditions.map((cond) => {
    const fieldValue = getFieldValue(save, cond.field);
    switch (cond.operator) {
      case "contains":
        return Array.isArray(cond.value)
          ? cond.value.some((v) => fieldValue.toLowerCase().includes(v.toLowerCase()))
          : fieldValue.toLowerCase().includes(cond.value.toLowerCase());
      case "equals":
        return fieldValue.toLowerCase() === cond.value.toLowerCase();
      case "is":
        return fieldValue === cond.value;
      default:
        return false;
    }
  });

  return logic.condition_logic === "AND" ? results.every(Boolean) : results.some(Boolean);
}
```

**B. Retroactive application** — a one-time scan when a new rule is created. Show user: *"Apply this rule to your existing 247 saves?"* If they confirm, trigger `apply-rule-retroactive` Edge Function.

```typescript
// supabase/functions/apply-rule-retroactive/index.ts
// Fetches all saves for user, evaluates rule against each, updates category in batch
// Runs as a background job — do not await in the UI
// Emit a realtime event when done so the UI can refresh
```

### 2.5 Rules UI

**Location:** Settings → "My Rules" tab (new tab in Settings screen)

**Layout:**

```
My Rules                         [+ Add Rule]

──────────────────────────────────────────
 ⬤  Anything with #mumbai → Places        [⋮]
    Matched 14 saves
──────────────────────────────────────────
 ⬤  From @cookingwithayesha → Recipes     [⋮]
    Matched 3 saves · Never triggered yet
──────────────────────────────────────────
 ○  Friday night saves → Inspo            [⋮]
    OFF
──────────────────────────────────────────
```

- Toggle icon: filled circle = ON, empty = OFF
- `[⋮]` menu: Edit, Delete, Apply to existing saves
- Hit count shown under each rule
- Tapping `[+ Add Rule]` opens a bottom sheet with a single text input and a submit button

**Add Rule bottom sheet:**

```
Tell Dibs how to sort your saves

[Type your rule in plain English...     ]

  e.g. "Put anything from @zara into Shopping"

                            [Add Rule →]
```

After submission:
1. Show loading state ("Dibs is reading your rule…")
2. On success, show parsed confirmation: *"Got it — anything from @zara with 'zara' in the username will be filed under Shopping."*
3. Ask: *"Apply this to your existing saves? (247 saves)"* → [Apply] [Skip]
4. On error, show the raw error and let them rephrase

---

## 3. Feature 2: Self-Cleaning Swipe Mode

### 3.1 What It Does

A swipeable card deck surfaces dormant saves (no interaction in 60+ days) for quick triage. Right = keep. Left = archive. Up = mark as acted on.

### 3.2 Trigger Logic

**Automatic triggers** (pg_cron job, runs weekly on Sunday 10am IST):
```sql
-- Find users who have 5+ saves older than 60 days with no acted_on, no notes, no board
-- Insert a row into notification_queue with type = 'cleanup'
```

**Manual trigger:** "Clean Up" button in the library header, visible when `dormant_save_count > 0`.

**Dormant save definition:**
```sql
select count(*) from saves
where user_id = $1
  and acted_on = false
  and notes is null
  and created_at < now() - interval '60 days'
  and last_viewed_at < now() - interval '30 days'
```

Add `last_viewed_at` column to `saves` table (updated when save detail screen is opened).

### 3.3 Card Deck UI

**Screen:** Full-screen modal, accessible from notification tap or library button.

**Card layout:**

```
┌─────────────────────────────────┐
│  🗓 Saved 4 months ago          │
│                                 │
│  [Thumbnail / Platform Icon]    │
│                                 │
│  Caption preview (2 lines max)  │
│  @username · Instagram          │
│                                 │
│  📍 Category chip               │
└─────────────────────────────────┘

   ← Archive    Keep →    ↑ Done it
```

**Swipe directions:**
- **Right (green) → Keep:** Reset the save's "dormancy clock." Resurface again in 30 days.
- **Left (red) → Archive:** Soft-delete. Recoverable from "Archived" in Settings for 30 days, then permanently deleted.
- **Up (purple) → Acted On:** Mark as acted_on = true. This save is now a win and feeds Wrapped data.

**Session structure:**
- Show max 10 cards per session
- After session: gamified summary screen

```
✨ Clean sweep!

You reviewed 10 saves.
  3 archived · 4 kept · 3 marked Done
  
Your library is 12% cleaner.

[See Archived]    [Back to Library]
```

**Undo:** After each swipe, show a 3-second undo snackbar. One level of undo only.

### 3.4 Implementation Notes

**Library:** `react-native-reanimated` + `react-native-gesture-handler` (already in Expo managed workflow).

**Component:** `CleanupDeckScreen.tsx`

**Card gestures:**

```tsx
// Use Reanimated 2 shared values for card transform
// translateX drives left/right color bleed on card border
// translateY drives up-direction opacity for "Done it" label
// Velocity threshold for swipe commit: 500 px/s or 120px displacement
```

**Data fetch:** Load 10 dormant saves on screen mount. Do NOT paginate during the session — fixed batch for simplicity.

### 3.5 Archive Table

```sql
create table public.archived_saves (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  original_save_id uuid not null,
  original_data   jsonb not null,  -- full snapshot of the save row at archive time
  archived_at     timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '30 days'
);

-- pg_cron: delete expired archives daily at 3am IST
select cron.schedule('delete-expired-archives', '30 21 * * *',
  $$delete from archived_saves where expires_at < now()$$
);
```

---

## 4. Feature 3: Wrapped Personality Cards

### 4.1 What It Does

A shareable personality card, generated using the user's save behavior. Rendered as a vertical card (9:16 aspect ratio). Downloadable. Shareable directly to Instagram Stories.

**Triggers:**
- **60-day milestone:** First Wrapped, triggered when user has been active 60+ days with 15+ saves
- **Monthly Wrapped:** Auto-generated on the 1st of each month for active users
- **On-demand:** User can regenerate from profile at any time (rate-limited: once per 7 days)

### 4.2 Data Inputs for Wrapped Generation

The Edge Function queries these aggregates before calling Claude:

```sql
-- Category distribution
select category, count(*) as count
from saves
where user_id = $1 and created_at > $2  -- $2 = period start
group by category order by count desc;

-- Acted-on rate
select
  count(*) filter (where acted_on = true) as done,
  count(*) as total
from saves where user_id = $1 and created_at > $2;

-- Most dormant save (saved longest ago, never acted on)
select url, caption_preview, category, created_at
from saves
where user_id = $1 and acted_on = false
order by created_at asc limit 1;

-- Peak save time (hour of day)
select extract(hour from created_at) as hour, count(*) as count
from saves where user_id = $1
group by hour order by count desc limit 1;

-- Platform breakdown
select platform, count(*) from saves
where user_id = $1 and created_at > $2
group by platform order by count desc;
```

### 4.3 Claude API Call for Wrapped Copy

**Edge Function: `generate-wrapped`**

```typescript
import Anthropic from "npm:@anthropic-ai/sdk";

const client = new Anthropic();

const WRAPPED_SYSTEM_PROMPT = `You are writing personality cards for a Gen Z content-saving app called Dibs.
The cards are funny, self-aware, slightly roasting, and deeply personal.
Think: Spotify Wrapped meets a friend who knows you too well.

You will receive stats about a user's saves. Write 4 lines of copy for their Wrapped card:
1. A headline stat (the most interesting/funny number)
2. A personality label (funny, specific, self-aware — e.g. "Certified Chronic Saver" or "Aspirational Homebody")
3. A roast line about their most saved category or most ignored save
4. A closing line that feels like a toast

Rules:
- Keep each line under 60 characters
- Use Gen Z tone: casual, dry, a bit absurd, never corporate
- Use emojis sparingly (max 2 total)
- The roast should be affectionate, not mean
- Return ONLY a JSON object with keys: headline, label, roast, closing
- No markdown, no explanation`;

Deno.serve(async (req) => {
  const { user_id, period_start, stats } = await req.json();

  const statsText = `
Total saves: ${stats.total}
Acted on: ${stats.acted_on} (${Math.round((stats.acted_on / stats.total) * 100)}%)
Top category: ${stats.top_category} (${stats.top_category_count} saves)
Most ignored save: "${stats.oldest_dormant_caption}" (saved ${stats.oldest_dormant_days} days ago)
Peak save hour: ${stats.peak_hour}:00
Platforms: ${stats.platforms.map((p) => `${p.platform} (${p.count})`).join(", ")}
  `.trim();

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 400,
    system: WRAPPED_SYSTEM_PROMPT,
    messages: [{ role: "user", content: statsText }],
  });

  const raw = message.content[0].type === "text" ? message.content[0].text : "{}";

  try {
    const copy = JSON.parse(raw);
    // Store in wrapped_history table
    await supabase.from("wrapped_history").insert({
      user_id,
      period_start,
      stats_snapshot: stats,
      copy,
    });
    return new Response(JSON.stringify({ ok: true, copy, stats }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch {
    return new Response(JSON.stringify({ ok: false }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});
```

### 4.4 Wrapped Card UI

**Component:** `WrappedCard.tsx` — renders in-app and as a capturable view for export.

**Card dimensions:** 390 × 693px (9:16 at base iPhone width). Use `react-native-view-shot` to capture as JPEG for sharing.

**Visual design:**

```
┌─────────────────────────────────┐  ← dark background, gradient mesh
│                                 │
│  dibs.                          │  ← small wordmark, top-left
│                                 │
│                                 │
│  You saved                      │
│  94 things.                     │  ← headline stat, large type
│  You did 7.                     │
│                                 │
│  ─────────────────────          │
│                                 │
│  Certified Dreamer 🌙           │  ← personality label
│                                 │
│  That rooftop place in Bandra   │  ← roast line
│  has been waiting 4 months.     │
│                                 │
│  ─────────────────────          │
│                                 │
│  Here's to someday.             │  ← closing line
│                                 │
│                          ░░░░░  │  ← subtle bar chart of categories
│  Places  Fashion  Recipes ...   │
│                                 │
└─────────────────────────────────┘

    [Download]   [Share to Stories]
```

**Color:** Use the user's selected app palette (store in `user_preferences.wrapped_theme`, default to app accent color). The card background is always dark.

**Bar chart at bottom:** Horizontal mini bars, one per category, sized by count. Labels below. No numbers — purely visual.

### 4.5 Wrapped History

```sql
create table public.wrapped_history (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  period_start   date not null,
  period_end     date not null default current_date,
  stats_snapshot jsonb not null,
  copy           jsonb not null,   -- { headline, label, roast, closing }
  created_at     timestamptz not null default now()
);
```

User can view past Wrappeds from Profile → "Your Wrappeds" (list of cards, scrollable).

### 4.6 Share Flow

1. Tap "Share to Stories"
2. `react-native-view-shot` captures card as base64 JPEG
3. On Android: Use `Sharing.shareAsync()` with `mimeType: 'image/jpeg'` — opens native share sheet
4. User picks Instagram Stories from share sheet
5. Card lands as Instagram Story sticker/background image (standard share behavior)

**Do NOT attempt deep linking into Instagram Stories.** The native share sheet is correct and sufficient.

---

## 5. Feature 4: Shared Boards & Social Saves

### 5.1 What It Does

Users can invite others to a shared board. Both parties can add saves to it. An "I'm in" reaction converts a save into a shared plan signal.

**Primary use cases:**
- *"Goa Trip Ideas"* — two friends planning a trip, both adding saves
- *"Birthday dinner options"* — one person curating, others voting
- *"Our watchlist"* — couple or friend group sharing Watch/Learn saves

### 5.2 Data Model

```sql
-- Boards table gets new columns
alter table public.boards add column is_shared boolean not null default false;
alter table public.boards add column invite_code text unique;   -- 8-char alphanumeric
alter table public.boards add column owner_id uuid references auth.users(id);

-- Board members
create table public.board_members (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null default 'member',  -- 'owner' | 'member'
  joined_at   timestamptz not null default now(),
  unique(board_id, user_id)
);

-- "I'm in" reactions on saves within a board
create table public.board_save_reactions (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  save_id     uuid not null references saves(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  reaction    text not null default 'in',   -- 'in' | 'pass'
  created_at  timestamptz not null default now(),
  unique(board_id, save_id, user_id)
);

create index idx_board_members_user on board_members(user_id);
create index idx_board_reactions_save on board_save_reactions(board_id, save_id);
```

**Invite code generation:**
```typescript
// 8-char alphanumeric, stored in boards.invite_code
// Collision-safe: check before insert
function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}
```

### 5.3 Creating a Shared Board

From the Boards screen, the "New Board" bottom sheet gets a toggle:

```
Board name
[Goa Trip Ideas            ]

  ○  Private (just me)
  ⬤  Shared (invite others)

                    [Create Board →]
```

After creating a shared board, show the invite sheet immediately:

```
Share this board

Your invite code:

     XKTZ8W4P

  [Copy Link]   [Share Code]

Anyone with this code can join your board.
```

**Deep link format:** `dibs://board/join?code=XKTZ8W4P`
Support universal links via `getdibs.app/join/XKTZ8W4P` for non-installed users (shows App Store link with context).

### 5.4 Joining a Board

**Entry points:**
1. Deep link tap (opens app directly to join confirmation)
2. Settings → "Join a Board" → manual code entry field
3. Future: share sheet in another user's app (V3)

**Join confirmation screen:**

```
You've been invited to

"Goa Trip Ideas"
by @priya

[3 saves so far]

[Join Board]    [Not now]
```

After joining: board appears in the user's Boards tab immediately.

### 5.5 Shared Board UI

Shared boards show member avatars in the board header:

```
Goa Trip Ideas          [+ Invite]
● Priya  ● You

─────────────────────────────────

[Save thumbnail]
Sunset Café, Panjim · Places
Added by Priya

  [👍 I'm in]   [Pass]

─────────────────────────────────
```

**"I'm in" mechanics:**
- `I'm in` → inserts a row in `board_save_reactions` with reaction = 'in'
- `Pass` → reaction = 'pass'
- When ALL members have reacted "I'm in" → save shows a ✅ "Everyone's in!" badge
- When all-in threshold is met → send a push notification to all members: *"Everyone's in on [save name]. Time to make it happen?"*

**Member counts shown on reactions:**
```
👍 I'm in (2/3)     Pass (1)
```

### 5.6 Adding a Save to a Shared Board

From save detail screen, "Add to Board" flow is unchanged. If the target board is shared, show a note: *"This will be visible to all 3 members."*

From the share extension (capture flow), after category is set, the "Add to board" optional step allows selecting a shared board.

### 5.7 Notifications for Shared Boards

```typescript
// Trigger: new save added to a shared board you're a member of
// Message: "Priya added a new place to 'Goa Trip Ideas'"

// Trigger: all-in threshold met
// Message: "Everyone's in on that rooftop restaurant. Make a plan? 🙌"

// Trigger: someone joins your board
// Message: "Rohan joined 'Goa Trip Ideas'"
```

All shared-board notifications are gated by the same 2/week + 3-day gap + quiet hours rules as resurfacing notifications. They share the weekly quota.

### 5.8 Permissions & Privacy

- Only the board owner can delete the board
- Any member can remove themselves from a board
- Owner can remove members (Settings → Board → Members)
- Saves added to a shared board remain in the adder's personal library too (shared boards reference saves, not copy them)
- If a member removes a save from their personal library, it is NOT removed from the shared board (detach on delete, not cascade)

---

## 6. Feature 5: Extended Platform Integrations

### 6.1 Pinterest

**Mechanism:** Pinterest URLs share via the native share sheet as `https://pin.it/xxxxxx` (short) or `https://www.pinterest.com/pin/xxxxxx/` (long).

**Metadata extraction:**
- Fetch the Pinterest URL in the `process-save` Edge Function
- Pinterest Open Graph tags reliably expose: `og:title`, `og:description`, `og:image`
- Use these for category inference; no API key required for OG scraping

**Category inference for Pinterest:**
Pinterest content skews Fashion, Inspo, and Recipes heavily. Add a platform-aware prior to the inference logic:

```typescript
if (platform === 'pinterest') {
  // Boost Fashion and Inspo priors before running standard inference
  categoryPriors['Fashion'] += 0.15;
  categoryPriors['Inspo'] += 0.10;
}
```

### 6.2 X / Twitter

**Mechanism:** Twitter/X shares as `https://x.com/user/status/xxxxxx` or `https://twitter.com/...`

**Metadata extraction:**
- X blocks most OG scrapers aggressively post-2023
- Fallback: use `api.fxtwitter.com/user/status/id` — an open community API that reliably returns tweet text and metadata without authentication
  - Example: `https://api.fxtwitter.com/elonmusk/status/1234567890`
  - Returns JSON with `tweet.text`, `tweet.author.name`, media info
- Use tweet text as the primary classification signal

**Category inference for X:**
X content skews WatchLearn and Inspo. Threads and long-form posts default to WatchLearn unless strong Food/Fashion signals exist.

### 6.3 LinkedIn

**Mechanism:** LinkedIn post URLs share as `https://www.linkedin.com/posts/...` or `https://linkedin.com/feed/update/...`

**Metadata extraction:**
- LinkedIn OG tags are inconsistently populated
- Fall back to URL pattern matching + title extraction
- LinkedIn saves default to **WatchLearn** unless override signals exist

**Note:** Do not attempt LinkedIn API integration. URL + pattern matching is sufficient for V2.

### 6.4 WhatsApp-Forwarded Links (Enhancement)

WhatsApp forwards arrive as bare URLs, often with `?utm_source=whatsapp` or similar parameters. The existing generic URL handler covers these. No changes needed — document this for support FAQ only.

### 6.5 Platform Detection Logic

```typescript
function detectPlatform(url: string): Platform {
  const patterns: Record<Platform, RegExp> = {
    instagram: /instagram\.com/,
    youtube: /youtube\.com|youtu\.be/,
    tiktok: /tiktok\.com/,
    pinterest: /pinterest\.com|pin\.it/,
    twitter: /twitter\.com|x\.com/,
    linkedin: /linkedin\.com/,
    web: /.*/,  // fallback
  };

  for (const [platform, pattern] of Object.entries(patterns)) {
    if (pattern.test(url)) return platform as Platform;
  }
  return 'web';
}
```

---

## 7. Database Schema Changes

### 7.1 Summary of All New Tables

| Table | Purpose |
|---|---|
| `user_rules` | AI categorization rules per user |
| `archived_saves` | Soft-deleted saves from Self-Cleaning |
| `wrapped_history` | Historical Wrapped cards |
| `board_members` | Membership for shared boards |
| `board_save_reactions` | "I'm in" / "Pass" reactions |

### 7.2 Summary of Altered Tables

| Table | Column | Change |
|---|---|---|
| `saves` | `last_viewed_at` | Add, `timestamptz`, nullable |
| `boards` | `is_shared` | Add, `boolean`, default false |
| `boards` | `invite_code` | Add, `text`, unique, nullable |
| `boards` | `owner_id` | Add, `uuid`, FK to auth.users |
| `user_preferences` | `wrapped_theme` | Add, `text`, nullable |

### 7.3 RLS Policies

All new tables require Row Level Security. Patterns:

```sql
-- user_rules: user sees only their own rules
alter table user_rules enable row level security;
create policy "user_rules_own" on user_rules
  using (user_id = auth.uid());

-- board_members: user sees boards they're a member of
alter table board_members enable row level security;
create policy "board_members_own" on board_members
  using (user_id = auth.uid());

-- board saves visible to all board members
-- (implement via security definer function for join)

-- archived_saves: user sees only their own
alter table archived_saves enable row level security;
create policy "archived_saves_own" on archived_saves
  using (user_id = auth.uid());

-- wrapped_history: user sees only their own
alter table wrapped_history enable row level security;
create policy "wrapped_history_own" on wrapped_history
  using (user_id = auth.uid());
```

### 7.4 Migrations Order

Run migrations in this order to avoid FK constraint failures:

```
001_add_last_viewed_at_to_saves.sql
002_add_shared_fields_to_boards.sql
003_create_board_members.sql
004_create_board_save_reactions.sql
005_create_user_rules.sql
006_create_archived_saves.sql
007_create_wrapped_history.sql
008_add_wrapped_theme_to_user_preferences.sql
009_rls_policies_v2.sql
010_cron_jobs_v2.sql
```

---

## 8. Edge Functions & Background Jobs

### 8.1 New Edge Functions

| Function | Trigger | Description |
|---|---|---|
| `parse-rule` | HTTP POST (client) | Calls Claude to parse plain-English rule to JSON |
| `apply-rule-retroactive` | HTTP POST (client, async) | Applies a rule to all existing user saves |
| `generate-wrapped` | HTTP POST (client) + cron | Generates Wrapped copy via Claude |
| `board-invite-join` | HTTP POST (client) | Validates invite code, adds user to board_members |

### 8.2 Updated Edge Functions

| Function | Change |
|---|---|
| `process-save` | Add rule evaluation step after category inference |
| `resurfacing-scheduler` | Add shared-board notification types to the queue |
| `send-notifications` | Handle new notification types: `wrapped_ready`, `board_invite`, `board_all_in`, `board_new_save` |

### 8.3 New pg_cron Jobs

```sql
-- Generate monthly Wrapped for active users (1st of month, 9am IST)
select cron.schedule('generate-monthly-wrapped', '30 3 1 * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/generate-wrapped-batch',
    headers := '{"Authorization": "Bearer <service-role-key>"}'::jsonb
  )
  $$
);

-- Delete expired archives (daily 3am IST)
select cron.schedule('delete-expired-archives', '30 21 * * *',
  $$delete from archived_saves where expires_at < now()$$
);

-- Queue cleanup notifications for dormant libraries (Sunday 10am IST)
select cron.schedule('queue-cleanup-notifications', '30 4 * * 0',
  $$
  insert into notification_queue (user_id, type, payload)
  select
    s.user_id,
    'cleanup_prompt',
    jsonb_build_object('dormant_count', count(*))
  from saves s
  where s.acted_on = false
    and s.notes is null
    and s.created_at < now() - interval '60 days'
    and s.last_viewed_at < now() - interval '30 days'
  group by s.user_id
  having count(*) >= 5
  on conflict do nothing
  $$
);
```

---

## 9. Navigation & App Architecture Changes

### 9.1 New Screens

| Screen | Route | Description |
|---|---|---|
| `CleanupDeckScreen` | `/cleanup` | Full-screen swipe deck modal |
| `CleanupSummaryScreen` | `/cleanup/summary` | Post-session results |
| `WrappedCardScreen` | `/wrapped/:id` | Full-screen card view + share |
| `WrappedHistoryScreen` | `/wrapped/history` | List of past Wrappeds |
| `RulesListScreen` | `/settings/rules` | Manage AI rules |
| `AddRuleSheet` | (bottom sheet) | Plain-English rule input |
| `SharedBoardDetailScreen` | `/boards/:id/shared` | Shared board with reactions |
| `BoardInviteScreen` | `/boards/invite` | Join via code entry |
| `BoardInviteConfirmScreen` | `/boards/invite/confirm` | Confirm joining a board |
| `BoardMembersScreen` | `/boards/:id/members` | Manage board members |

### 9.2 Navigation Changes

**Tab Bar:** No changes to the 3-tab structure (Home, Library, Profile).

**Profile tab additions:**
- "Your Wrappeds" row → `WrappedHistoryScreen`
- Wrapped card teaser on Profile screen when a new Wrapped is ready

**Settings additions:**
- "My Rules" row → `RulesListScreen`
- "Archived Saves" row → (new screen, simple list of archived saves with restore/delete actions)

**Library header (Boards view):**
- Add "Join a Board" button next to "New Board"
- Shared boards show member avatar stack in the board list row

### 9.3 Deep Link Handling

Add to `app.json` / Expo Router config:

```json
{
  "scheme": "dibs",
  "intentFilters": [
    {
      "action": "VIEW",
      "data": [{ "scheme": "https", "host": "getdibs.app", "pathPrefix": "/join" }],
      "category": ["BROWSABLE", "DEFAULT"]
    }
  ]
}
```

Handle in root layout:

```typescript
// app/_layout.tsx addition
import * as Linking from 'expo-linking';

const url = await Linking.getInitialURL();
if (url?.includes('/join/')) {
  const code = url.split('/join/')[1];
  router.push(`/boards/invite/confirm?code=${code}`);
}
```

---

## 10. Do NOT Build

The following are explicitly out of scope for V2. Do not implement, stub, or leave hooks for these:

- **Monetization / paywall UI** — no subscription prompts, no feature gating, no Stripe integration
- **Push notification frequency controls UI** — the 2/week + 3-day gap + 9am-9pm rules are hardcoded; no settings screen for this yet
- **AI-generated thumbnails or card art** — Wrapped cards use CSS/design-system visuals only, no image generation
- **Social feed / discovery** — no ability to browse other users' public saves or boards
- **In-app messaging** — no chat within shared boards; reactions ("I'm in") are the only social primitive
- **Follower/following graph** — no social graph at all in V2
- **Twitter/X API integration** — fxtwitter fallback only, no authenticated API calls
- **LinkedIn API integration** — OG + pattern matching only
- **Pinterest API integration** — OG scraping only
- **Web dashboard / browser version** — mobile-only
- **iPad layout** — Android phone is the target; iPad/tablet layouts are not in scope
- **Export / backup feature** — no CSV export, no data download
- **Wrapped A/B testing framework** — single generation path only

---

## Appendix A — V2 Feature Flags

All V2 features ship behind feature flags in `user_preferences.feature_flags jsonb`. Default all to `false` for existing users, `true` for new users created after V2 launch.

```json
{
  "ai_rules_enabled": true,
  "cleanup_mode_enabled": true,
  "wrapped_enabled": true,
  "shared_boards_enabled": true
}
```

This allows rollback per-feature without a release.

---

## Appendix B — Error States

Each new feature must implement these error states explicitly. Do not use generic error modals.

| Feature | Error | User-facing message |
|---|---|---|
| Rule parsing | Claude returns unparseable output | "Dibs couldn't understand that rule. Try rephrasing it — e.g. 'Put anything from @username into Fashion'" |
| Rule parsing | Network failure | "Couldn't connect. Your rule wasn't saved — try again?" |
| Wrapped generation | Insufficient data (<15 saves) | "You need a few more saves before your first Wrapped. Keep going 👀" |
| Wrapped generation | Claude API failure | "Couldn't generate your card right now. Try again later." |
| Board invite | Invalid code | "That code doesn't look right. Check with whoever sent it." |
| Board invite | Already a member | "You're already in this board." |
| Retroactive rule apply | >500 saves to process | Show progress indicator. Do NOT block UI. Emit realtime event on completion. |

---

*Spec version: 2.0 | Built for Claude Code handoff | Last updated: June 2026*
