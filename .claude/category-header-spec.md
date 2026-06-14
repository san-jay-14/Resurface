# Dibs — Category Screen Header Spec
## Recipes · Inspo · Watch/Learn · Shopping

> Places and Fashion headers are already built (map view).
> This spec covers the remaining four categories only.

---

## Context

Each category screen has a header zone above the search bar and filter chips — the same space that Places and Fashion use for their map. Rather than leaving it blank or using a generic pattern, each category gets a header that reflects its own nature.

**Locked layout pattern (all screens):**
```
┌─────────────────────────────────────┐
│  [HEADER ZONE — ~220px tall]        │  ← this spec
├─────────────────────────────────────┤
│  🔍 Search placeholder...           │
├─────────────────────────────────────┤
│  All   ★ Saved   ✓ Done   Pending  │
├─────────────────────────────────────┤
│  Sub-categories label    + New      │
│  [All]  [chip]  [chip]              │
├─────────────────────────────────────┤
│  [Save cards list]                  │
└─────────────────────────────────────┘
```

The header zone height should match Places/Fashion map height exactly for visual consistency.

---

## DO NOT BUILD

- No new navigation patterns
- No new bottom sheets or modals triggered from the header
- No data fetching beyond what's already in the saves table
- No real-time content APIs (recipe APIs, external feeds, etc.)
- No animations that require Reanimated 3 — keep to basic Animated API or static
- The prompt card for Recipes does NOT filter or navigate anywhere on tap — it is display only

---

## 1. Recipes Header — Contextual Meal Prompt

### What it does
Shows a single prompt card that changes based on the current time of day and day of week. Purely display — it does not filter the list below or navigate anywhere. It prompts the user to scroll and find something relevant.

### Logic table

| Time window | Day type | Prompt text |
|---|---|---|
| 5am – 10am | Any | "What's for breakfast today?" |
| 10am – 12pm | Weekday | "Quick lunch ideas for today?" |
| 10am – 12pm | Weekend | "Brunch ideas for this morning?" |
| 12pm – 3pm | Any | "What's for lunch?" |
| 3pm – 6pm | Any | "Evening snack ideas?" |
| 6pm – 10pm | Any | "What's for dinner tonight?" |
| 10pm – 5am | Any | "Late night craving?" |
| Any | Friday | Prefix with: "Weekend's here —" |
| Any | Saturday/Sunday | Prefix with: "It's the weekend —" |

**Weekend prefix takes priority.** Example: Saturday at 7pm → "It's the weekend — what's for dinner tonight?"

### UI spec

```
┌─────────────────────────────────────┐
│                                     │
│   🍳                                │
│   It's the weekend —                │
│   what's for dinner tonight?        │
│                                     │
│   You have 8 recipe saves           │  ← dynamic count from saves table
│                                     │
└─────────────────────────────────────┘
```

- Background: category accent color at 8% opacity (same purple `#7C3AED` used elsewhere, `rgba(124, 58, 237, 0.08)`)
- Card has `borderRadius: 16`, `marginHorizontal: 16`, `padding: 20`
- Emoji: 32px, above the prompt text
- Prompt text: 18px semibold, color `#1a1a1a` (light mode) / `#f5f5f5` (dark mode), max 2 lines
- Sub-text: "You have N recipe saves" — 13px regular, muted color `#888`, pulled from `saves.count` where `category = 'recipes'`
- If 0 saves: sub-text reads "Share your first recipe reel to get started"
- No tap interaction on this card

### Implementation notes

```typescript
// Time-based prompt logic
function getRecipePrompt(): { emoji: string; text: string } {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday
  
  const isWeekend = day === 0 || day === 6;
  const isFriday = day === 5;
  
  let base = '';
  if (hour >= 5 && hour < 10) base = "What's for breakfast today?";
  else if (hour >= 10 && hour < 12) base = isWeekend ? "Brunch ideas for this morning?" : "Quick lunch ideas for today?";
  else if (hour >= 12 && hour < 15) base = "What's for lunch?";
  else if (hour >= 15 && hour < 18) base = "Evening snack ideas?";
  else if (hour >= 18 && hour < 22) base = "What's for dinner tonight?";
  else base = "Late night craving?";
  
  const prefix = isWeekend ? "It's the weekend — " : isFriday ? "Weekend's here — " : '';
  
  return { emoji: '🍳', text: prefix + base };
}
```

Compute once on screen mount. No interval — user doesn't sit on this screen long enough for a refresh to matter.

---

## 2. Inspo Header — Recent Saves Slideshow

### What it does
Horizontal auto-scrolling strip of the user's most recently saved Inspo items — thumbnail cards. Tapping a card opens that save's detail view (same as tapping from the list below). It's a quick-access surface, not a separate feature.

### Data source
`saves` table, `category = 'inspo'`, ordered by `created_at DESC`, limit 10.

### UI spec

```
┌─────────────────────────────────────────────────────┐
│  Recent saves                                       │
│                                                     │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐ │
│  │      │  │      │  │      │  │      │  │      │ │
│  │  🖼  │  │  🖼  │  │  🖼  │  │  🖼  │  │  🖼  │ │
│  │      │  │      │  │      │  │      │  │      │ │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘ │
└─────────────────────────────────────────────────────┘
```

- Section label "Recent saves": 12px uppercase tracking, muted color, `paddingLeft: 16`, `paddingBottom: 8`
- Card size: 100×130px, `borderRadius: 12`
- Thumbnail fills the card (`resizeMode: 'cover'`)
- Cards have a subtle bottom gradient overlay (transparent → `rgba(0,0,0,0.3)`) for when thumbnails are very light
- Horizontal `ScrollView`, `showsHorizontalScrollIndicator: false`
- `paddingHorizontal: 16`, gap between cards: 10px
- No auto-scroll animation — user scrolls manually. "Auto-scrolling" was a misstatement in planning; keep it static horizontal scroll.
- Tap → navigate to save detail view (existing navigation)

### Empty state (0 saves)
Replace the slideshow with:
```
┌─────────────────────────────────────┐
│                                     │
│   💡                                │
│   Your inspo board is empty         │
│   Share a mood board or aesthetic   │
│   reel to start filling it up       │
│                                     │
└─────────────────────────────────────┘
```
Same card styling as Recipes empty state. No tap interaction.

### Implementation notes
- Use existing `thumbnail_url` field from saves table
- If `thumbnail_url` is null for a save, show a placeholder tile with the category emoji centered on `#f0f0f0` background
- Fetch happens on screen focus (same lifecycle as the list below — no separate fetch needed if saves are already in local state)

---

## 3. Watch/Learn Header — Recent Saves Slideshow

Identical pattern to Inspo. Same component, different category filter and empty state copy.

### Data source
`saves` table, `category = 'watch_learn'`, ordered by `created_at DESC`, limit 10.

### Differences from Inspo

| Property | Value |
|---|---|
| Section label | "Recently saved" |
| Empty state emoji | 🎬 |
| Empty state headline | "Nothing queued up yet" |
| Empty state sub-text | "Share a YouTube video, documentary, or tutorial to build your watchlist" |

Everything else — card size, scroll behaviour, tap handler, thumbnail treatment — is identical to Inspo.

### Implementation notes
Extract the slideshow into a shared `<RecentSavesSlideshow>` component that takes `category` and `emptyState` as props. Do not duplicate the component for each screen.

```typescript
// Shared component signature
interface RecentSavesSlideshowProps {
  category: 'inspo' | 'watch_learn';
  emptyState: {
    emoji: string;
    headline: string;
    subtext: string;
  };
}
```

---

## 4. Shopping Header — Wishlist Strip

### What it does
A horizontal strip of the user's most recently saved Shopping items, styled slightly differently from the Inspo/Watch slideshow — taller cards with a title label visible below the thumbnail, to reinforce the "wishlist" mental model (you want to see what the product is at a glance).

### Data source
`saves` table, `category = 'shopping'`, ordered by `created_at DESC`, limit 8.

### UI spec

```
┌──────────────────────────────────────────────────────┐
│  Your wishlist                                       │
│                                                     │
│  ┌────────┐   ┌────────┐   ┌────────┐   ┌────────┐ │
│  │        │   │        │   │        │   │        │ │
│  │   🖼   │   │   🖼   │   │   🖼   │   │   🖼   │ │
│  │        │   │        │   │        │   │        │ │
│  ├────────┤   ├────────┤   ├────────┤   ├────────┤ │
│  │ Title… │   │ Title… │   │ Title… │   │ Title… │ │
│  └────────┘   └────────┘   └────────┘   └────────┘ │
└──────────────────────────────────────────────────────┘
```

- Section label "Your wishlist": 12px uppercase tracking, muted, `paddingLeft: 16`
- Card size: 110×150px total. Thumbnail: 110×110px. Label area: 110×40px
- Card background: `#ffffff` (light) / `#1e1e1e` (dark), `borderRadius: 12`
- Card shadow: `elevation: 2` (Android), subtle `boxShadow` (iOS)
- Label text: save title truncated to 1 line, 11px regular, `paddingHorizontal: 8`, `paddingTop: 6`, color `#333` / `#ccc`
- Title source: use `title` field from saves table; if null, fall back to "Saved item"
- Tap → navigate to save detail view

### Empty state (0 saves)
```
┌─────────────────────────────────────┐
│                                     │
│   🛍️                               │
│   Your wishlist is empty            │
│   Save product reels and shopping   │
│   content to build it up            │
│                                     │
└─────────────────────────────────────┘
```

---

## Summary table

| Category | Header type | Data source | Tap behaviour |
|---|---|---|---|
| Recipes | Contextual prompt card | `new Date()` + saves count | None |
| Inspo | Recent saves slideshow | `saves` where `category='inspo'` last 10 | Open save detail |
| Watch/Learn | Recent saves slideshow | `saves` where `category='watch_learn'` last 10 | Open save detail |
| Shopping | Wishlist strip with title labels | `saves` where `category='shopping'` last 8 | Open save detail |

---

## Shared component structure

```
components/
  category/
    RecipePromptHeader.tsx       ← Recipes only
    RecentSavesSlideshow.tsx     ← shared by Inspo + Watch/Learn
    WishlistStrip.tsx            ← Shopping only
    CategoryEmptyHeader.tsx      ← shared empty state card used by all four
```

All four components receive the category's save count and saves array as props — data is fetched by the parent screen, not inside the header component. No independent data fetching inside header components.

---

## Feature flag

```typescript
FEATURE_FLAGS = {
  CATEGORY_HEADERS: true,  // set false to hide all four headers and revert to blank space
}
```

One flag covers all four. If disabled, the header zone renders `null` and the screen starts directly at the search bar.
