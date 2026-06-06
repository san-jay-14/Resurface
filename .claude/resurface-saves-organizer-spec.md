# Resurface — Saves Organizer Enhancement

**Implementation spec for Claude Code**
Version 1.0 · Phase 3 (between "Save & Categorize" and "Resurfacing Engine")

---

## 0. How to use this document

You are extending an existing, working React Native app called **Resurface**. This is an **enhancement layer on top of features that already exist** — not a rebuild.

Before writing any code:

1. **Read the existing codebase first.** Identify the navigation library, state management, API client, styling approach, and the existing `Save` data model. **Match existing conventions** — file structure, naming, component patterns, styling system. Do not introduce new libraries unless a feature genuinely requires one.
2. **A visual mockup is provided alongside this spec** (uploaded separately). Treat it as the source of truth for layout, spacing, and visual style. Section 6 below describes it in words so the spec stands on its own, but the mockup wins on any visual detail.
3. **Stay inside scope.** Section 2 lists what to build and — just as importantly — what *not* to build. If you find yourself adding nested folders, bulk-select modes, or anything resembling notifications/location/resurfacing, stop: that is out of scope for this phase.
4. **Build in the order given in Section 7.** Each step should leave the app runnable.

---

## 1. Context & current state

Resurface captures content the user saves from social platforms (Instagram, TikTok, etc.) via the native share sheet, extracts metadata, and auto-categorizes each save into an intent category.

**Already built (milestones 1–2):**
- Onboarding
- Share-sheet capture + metadata/data extraction
- Auto-categorization into intent categories with category filters

**What this phase adds:** an organizing layer that makes the existing library genuinely useful — search, a proper detail view, an "acted on" status, notes, favorites, and custom collections — plus the navigation shell (bottom tabs, screens, profile) that ties it together.

**The product thesis to keep in mind:** the value of Resurface is bridging *saving* and *doing*. The "acted on" status (Feature 4.3) is the single most important feature here because it is the data point that distinguishes a living library from a graveyard, and it feeds the future "Wrapped" feature.

---

## 2. Scope

### 2.1 In scope (build these)

| # | Feature | One-line summary |
|---|---------|------------------|
| 1 | Search + sort | Free-text search across saves; sort options |
| 2 | Save detail view | A dedicated screen per save — the hub for all actions |
| 3 | Status (Saved / Acted on) | A two-state toggle with category-aware labels |
| 4 | Notes | A short free-text note per save |
| 5 | Favorites | Star a save to mark it as a favorite |
| 6 | Collections (boards) | Flat, user-created groupings beyond auto-categories |

Plus the **navigation shell**: 4-tab bottom navigation, per-screen top bar, Library / Boards / Search / Profile screens, and the Save Detail screen.

### 2.2 Explicitly OUT of scope (do not build)

- The **resurfacing engine** — no calendar awareness, no location triggers, no push notifications. None of it.
- **Nested folders / sub-collections.** Collections are a flat list only.
- **Bulk multi-select mode** (selecting many saves to act on at once).
- **Wrapped / personality cards.** (The Profile stat row in 6.4 is a static teaser only — no card generation.)
- **AI rule system** (plain-English categorization rules).
- **Self-cleaning swipe mode.**
- **Social / shared boards.**
- Any new platform integrations.

If a requirement here seems to need one of the above, implement the minimal version that satisfies *this* spec and leave a `// TODO (future phase)` comment rather than expanding scope.

---

## 3. Data model changes

Adapt these to the existing schema and ORM/migration tooling. The spec assumes PostgreSQL (per the project's stack). Write a migration; do not edit the DB by hand.

### 3.1 Extend the `Save` entity

Add the following fields (keep existing fields untouched):

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `status` | enum (`saved`, `acted_on`) | `saved` | Drives Feature 3 |
| `acted_on_at` | timestamp (nullable) | `null` | Set when `status` → `acted_on`; cleared if reverted. Used later by Wrapped. |
| `note` | text (nullable) | `null` | Feature 4 |
| `is_favorite` | boolean | `false` | Feature 5 |
| `last_interacted_at` | timestamp | `created_at` | Updated on any user action (open, edit, favorite, status change). Not used in UI this phase but cheap to track now for future self-cleaning. |

### 3.2 New `Collection` entity (custom boards)

Auto-categories already exist as the `category` field on `Save` — **do not** model those as collections. This table is only for **user-created** boards.

```
collections
  id            uuid pk
  user_id       uuid fk -> users
  name          text          (unique per user, case-insensitive)
  created_at    timestamp
  updated_at    timestamp
```

A save can belong to **many** collections (many-to-many):

```
collection_saves
  collection_id uuid fk -> collections
  save_id       uuid fk -> saves
  added_at      timestamp
  primary key (collection_id, save_id)
```

### 3.3 Indexes

- Full-text or trigram index supporting search over `Save.title`/caption + `Save.note` (see 4.1).
- Index on `Save.user_id, status` (for the "Not done" filter).
- Index on `Save.user_id, is_favorite`.

---

## 4. Features in detail

Each feature lists **behavior**, **data**, **UI placement**, and **acceptance criteria**. Acceptance criteria are the definition of done — implement to pass them.

### 4.1 Search + sort

**Behavior**
- A search input filters the user's saves by free text.
- Search matches against: title/caption, `note`, category name, and collection names the save belongs to.
- Results respect the currently active sort.
- Empty query shows recent searches (store the last ~5 client-side) and nothing else.

**Sort options** (applies in Library and Search):
- `Recent` (default) — `created_at` desc
- `Oldest` — `created_at` asc
- `Not done first` — `status = saved` before `acted_on`, then recent
- `Favorites first` — `is_favorite` desc, then recent

**Data / API**
- Backend endpoint: `GET /saves?q=&sort=&category=&status=&favorite=&collection=` returning paginated results. Use Postgres `ILIKE`/`pg_trgm` or full-text search; exact ranking is not critical for this phase. Debounce queries client-side (~250ms).

**UI placement**
- Search is its own bottom-tab screen **and** a tappable search bar pinned at the top of the Library screen (tapping it routes to the Search screen). Sort is the top-bar action icon on Library and Search.

**Acceptance criteria**
- [ ] Typing in search returns matching saves within ~300ms of stopping typing.
- [ ] Searching a word that appears only in a note returns that save.
- [ ] Recent searches persist across app restarts (local storage) and are tappable.
- [ ] Changing sort reorders results without a full reload flicker.

### 4.2 Save detail view

**Behavior**
- Tapping any save card opens a dedicated detail screen. This screen is the hub for every per-save action.
- From here the user can: open the original link, see/change category, read/edit the note, toggle status, toggle favorite, and add/remove the save from collections.

**Data / API**
- `GET /saves/:id`, `PATCH /saves/:id` (category, note, status, is_favorite), `POST/DELETE /saves/:id/collections/:collectionId`.

**UI placement**
- Full screen (not a modal sheet), reached from any save card. Back arrow returns to the previous screen. See 6.5 for layout.

**Acceptance criteria**
- [ ] All edits (category, note, status, favorite, collection membership) persist and are reflected immediately on return to the Library.
- [ ] "Open original" launches the source URL in the platform app or browser.
- [ ] Editing is optimistic — UI updates instantly, reconciles with the server, and reverts on failure with a toast.

### 4.3 Status — Saved / Acted on

**Behavior**
- Every save has a binary status: `saved` or `acted_on`.
- The displayed verb is **category-aware** but the stored value is the same enum:

| Category | "Acted on" label |
|----------|------------------|
| Places | Visited |
| Recipes | Cooked |
| Products | Bought |
| Outfits | Tried |
| Inspiration / Professional / other | Done |

- Toggling to `acted_on` sets `acted_on_at = now()`. Reverting clears it.

**UI placement**
- On the detail screen: a two-segment toggle (`Saved` / `<category verb>`).
- On the Library card: when `acted_on`, show a small badge on the thumbnail with the category verb + a check icon. When `saved`, show nothing.
- In Library filters: a `Not done` filter chip (shows only `status = saved`).

**Acceptance criteria**
- [ ] Toggling status on the detail screen updates the card badge on return.
- [ ] The `Not done` filter excludes acted-on saves.
- [ ] The verb shown matches the save's category.

### 4.4 Notes

**Behavior**
- A single free-text note per save (the "why I saved this"). Plain text, no formatting. Reasonable length cap (e.g. 280 chars).

**UI placement**
- Editable on the detail screen, shown in a soft block. If a note exists, it is visible; if not, show a subtle "Add a note" affordance.

**Acceptance criteria**
- [ ] Note persists and is searchable (see 4.1).
- [ ] Empty note shows the add affordance, not an empty box.

### 4.5 Favorites

**Behavior**
- A boolean favorite flag, toggled by a heart control.

**UI placement**
- Heart on the Library card thumbnail (top-right) and in the detail screen header.
- A `Favorites first` sort option (4.1) and optionally a favorites filter chip.

**Acceptance criteria**
- [ ] Tapping the heart toggles state optimistically and persists.
- [ ] Favorited state is visually distinct (filled/colored heart) everywhere the save appears.

### 4.6 Collections (custom boards)

**Behavior**
- Users create named boards (e.g. "Goa trip", "Diwali shopping") and add saves to them.
- A save can be in multiple collections. Collections are **flat** — no nesting.
- Auto-categories and custom collections are shown together in one list on the Boards screen, visually distinguished (custom boards carry a small "custom" marker; see mockup), but they are different data: categories come from `Save.category`, custom boards from the `collections` table.

**Data / API**
- `GET /collections` (with save counts), `POST /collections`, `PATCH /collections/:id` (rename), `DELETE /collections/:id` (does not delete the saves), plus the add/remove endpoints from 4.2.

**UI placement**
- The **Boards** bottom tab. Tapping a board opens a filtered Library view of its saves. A "+ New" action creates a board. Add-to-board happens from the save detail screen.

**Acceptance criteria**
- [ ] Creating a board, adding saves, and opening the board shows exactly those saves.
- [ ] Deleting a board removes the board but leaves its saves intact.
- [ ] Board names are unique per user (case-insensitive); duplicate attempts show a clear error.

---

## 5. Navigation shell

Replace/establish the app's primary navigation as a **4-tab bottom navigation**. No drawer/sidebar, no separate top menu — keep it minimal.

**Bottom tabs (in order):**

| Tab | Icon (concept) | Screen |
|-----|----------------|--------|
| Library | grid | All saves (default landing) |
| Boards | folders | Collections + categories list |
| Search | magnifier | Search screen |
| Profile | user | Profile / settings |

**Top bar pattern:** each main screen has a simple top bar = screen title (left) + a single contextual action icon (right). On Library and Search that action is **Sort**. Detail screen replaces the top bar with a back arrow (left) and favorite + overflow icons (right).

---

## 6. Screen-by-screen layout

Match the uploaded mockup. Summary for reference:

### 6.1 Library (default)
- Top bar: title "Library" + sort icon.
- A tappable search bar (routes to Search).
- A horizontal row of filter chips: `All`, `Not done`, then category chips (`Places`, `Outfits`, `Recipes`, …). Active chip is filled.
- A 2-column grid of save cards. Each card = thumbnail (with a category-tinted fallback + category icon when no image), a favorite heart (top-right), an optional acted-on badge (bottom-left), then title and a small "Category · subtitle" line.

### 6.2 Boards
- A list of rows: each row = a tinted icon tile, the board/category name (custom boards add a small "· custom" marker), and the save count on the right.
- A "+ New" affordance to create a custom board.

### 6.3 Search
- A focused search input (with clear button).
- Result count + current sort line.
- Result rows (compact list form of saves).
- "Recent searches" as tappable chips when the query is empty.

### 6.4 Profile
- Avatar + name + handle.
- A 3-up stat row: total saves, acted-on count, boards count (all computed/read-only).
- A single static line teasing the act-on rate (e.g. "You act on 18% of your saves") — **static teaser only, not a Wrapped feature**.
- A settings list: Notifications, Categories & rules, Account (these can be stub rows routing to existing/placeholder screens — do not build the resurfacing settings behind them this phase).

### 6.5 Save detail
- Header: back arrow (left); favorite heart + overflow (right).
- Large thumbnail (category-tinted fallback).
- Title, then a category chip.
- Status segmented toggle (`Saved` / category verb).
- Note block (editable; "Add a note" when empty).
- "Open original" primary button.
- A subtle footer line: saved date + board membership.

### 6.6 Visual language (so output matches the mockup)
- **Minimal and flat.** No gradients, no heavy shadows. Generous whitespace.
- One neutral surface palette; **category color used only as a light accent** — tinted thumbnail fallback + small category chip, not full-bleed color.
- Category → color mapping (light tint background, darker text from same family): Places = teal, Outfits = pink, Recipes = amber, Products = blue, Inspiration = purple, Professional = gray.
- Rounded corners on cards/tiles, pill-shaped chips, sentence case everywhere (never Title Case or ALL CAPS).
- It should "feel like content to scroll, not a library to manage."

---

## 7. Implementation order

Each step should leave the app compiling and runnable.

1. **Data model + migrations** (Section 3). Add fields, `collections` + `collection_saves` tables, indexes. Update the `Save` model/types and API serializers.
2. **API endpoints** — extend `GET /saves` with query params; add `PATCH /saves/:id`; add collections CRUD + add/remove endpoints.
3. **Navigation shell** — establish the 4-tab bottom nav and the top-bar pattern. Wire up empty/placeholder screens.
4. **Library screen** — card grid, thumbnail fallbacks, filter chips, favorite heart, acted-on badge, sort.
5. **Save detail screen** — full detail hub with category edit, note, status toggle, favorite, open-original, collections add/remove.
6. **Search screen** — input, debounced query, results, recent searches.
7. **Boards screen** — categories + custom boards list, create board, board-filtered view.
8. **Profile screen** — avatar, computed stats, static act-on teaser, settings stub rows.
9. **Polish pass** — match mockup spacing/typography, optimistic updates + failure toasts, empty states for each screen.

---

## 8. Definition of done

- [ ] All per-feature acceptance criteria in Section 4 pass.
- [ ] The 4-tab navigation works; every screen in Section 6 exists and matches the mockup's layout and visual language.
- [ ] All edits are optimistic and persist across app restarts.
- [ ] Empty states exist for: no saves, no search results, no boards, board with no saves.
- [ ] No out-of-scope features (Section 2.2) were introduced.
- [ ] Existing onboarding, capture, extraction, and categorization flows are unchanged and still pass.
- [ ] New code follows the existing codebase's conventions and adds no unnecessary dependencies.

---

## 9. Guardrails & notes

- **Do not** touch the share-sheet capture, extraction, or categorization logic except to read from it.
- **Do not** build notifications, location, or calendar logic — the settings rows on Profile are stubs.
- Keep `last_interacted_at` updated even though no UI uses it yet — it is groundwork for a later phase and costs nothing now.
- Prefer optimistic UI for every toggle/edit; reconcile with the server and revert with a toast on failure.
- When in doubt about a visual detail, defer to the uploaded mockup; when in doubt about a behavioral detail, choose the simplest implementation that satisfies the acceptance criteria.
