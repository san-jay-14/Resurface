# Dibs — Build Spec
## Milestone: Instagram Auto-Scrape + Places Map View

**Stack:** Expo (managed workflow) · React Native · Supabase (Postgres + Edge Functions) · Claude API  
**Platform:** Android-first  
**Last updated:** June 2026

---

## Overview

This milestone covers two tightly related features:

1. **Instagram Auto-Scrape** — when a user shares an Instagram reel to Dibs, automatically fetch its full metadata (caption, hashtags, location tag) from a third-party scraping API instead of relying on manual user input. This replaces the current manual two-step popup for Instagram saves.

2. **Places Map View** — a map screen inside the Places category that renders all saved places as pins using their stored coordinates. Accessible as a toggle from the Places list view.

These two features are dependent: the map only works well if coordinates are being stored, and coordinates are only reliably stored if the scrape returns location data. Build them together.

---

## Part 1 — Instagram Auto-Scrape

### 1.1 What Changes

Currently, when a user shares an Instagram URL via the share sheet, Dibs shows a manual popup asking the user to select a category and optionally enter a location (for Places saves). This was the V1 fallback due to Instagram not passing caption data through the share sheet.

After this milestone, the flow becomes:

1. User shares Instagram reel URL via share sheet
2. Dibs immediately calls a Supabase Edge Function with the URL
3. Edge Function calls the external scraping API and returns metadata
4. Claude API classifies the save using the full caption + hashtags
5. Save is created automatically — no popup for the user in the happy path
6. If scrape fails (private account, timeout, API error), fall back to the existing manual popup

The manual popup is NOT removed. It becomes the fallback only.

---

### 1.2 External Scraping API

Use a third-party REST API that accepts an Instagram URL and returns structured metadata. Do not build or self-host a scraper.

**Recommended provider:** RapidAPI Instagram scraper (search "Instagram Reel Data" on RapidAPI — multiple providers available, pick one with caption + location fields). Alternative: SociaVault (`api.sociavault.com`).

**Required response fields:**

```
caption         string    Full caption text of the reel
hashtags        string[]  Array of hashtags extracted from caption
location_name   string    Location tag name if set by creator (e.g. "Koramangala, Bangalore")
location_id     string    Instagram location ID if available
thumbnail_url   string    URL of the reel thumbnail image
owner_username  string    Creator's Instagram handle
shortcode       string    The reel shortcode extracted from URL
```

**Not required (ignore):** likes, views, comments, audio info, video URL.

**Error cases to handle:**

| Condition | What to do |
|---|---|
| Private account | Scrape returns 403 or empty — fall back to manual popup |
| API timeout (>5s) | Fall back to manual popup |
| API rate limit / 429 | Fall back to manual popup, log error to Supabase |
| Location field empty | Proceed with scrape data, skip location geocoding |
| Caption empty | Proceed, Claude classifies on hashtags + thumbnail only |

---

### 1.3 Supabase Edge Function — `scrape-instagram`

Create a new Edge Function at `supabase/functions/scrape-instagram/index.ts`.

This function is called from the app immediately after a share sheet capture.

**Input (POST body):**

```typescript
{
  url: string          // Full Instagram reel URL e.g. https://www.instagram.com/reel/ABC123xyz/
  user_id: string      // Supabase auth user ID
}
```

**Processing steps inside the function:**

1. Extract the shortcode from the URL using regex: `/instagram\.com\/reel\/([A-Za-z0-9_-]+)/`
2. Call the external scraping API with the shortcode or full URL
3. If scrape succeeds, call Google Places Autocomplete API with `location_name` to resolve `{lat, lng, city, place_id}` — only if `location_name` is non-empty
4. Call Claude API (`claude-haiku-4-5-20251001`) with the scraped caption + hashtags to classify into one of the six Dibs categories
5. Return the assembled payload to the app

**Output (success):**

```typescript
{
  success: true,
  data: {
    caption: string,
    hashtags: string[],
    thumbnail_url: string,
    owner_username: string,
    category: 'places' | 'recipes' | 'fashion' | 'shopping' | 'watch_learn' | 'inspo',
    category_confidence: number,       // 0–1, from Claude response
    location: {                        // null if no location data
      raw_name: string,                // as returned by scraper
      resolved_name: string,           // cleaned name from Google Places
      city: string,
      lat: number,
      lng: number,
      google_place_id: string
    } | null
  }
}
```

**Output (failure — triggers manual popup):**

```typescript
{
  success: false,
  reason: 'private_account' | 'timeout' | 'rate_limit' | 'api_error' | 'scrape_empty'
}
```

**Environment variables required in Supabase dashboard:**

```
SCRAPING_API_KEY          API key for the chosen scraping provider
SCRAPING_API_URL          Base URL of the scraping provider endpoint
GOOGLE_PLACES_API_KEY     For geocoding location_name to lat/lng
ANTHROPIC_API_KEY         For Claude classification call
```

---

### 1.4 Claude Classification Prompt

Inside the Edge Function, call Claude with this exact prompt structure. Use `claude-haiku-4-5-20251001` — this is a classification task, Haiku is fast and cheap enough.

**System prompt:**

```
You are a content classification engine for Dibs, an app that helps people act on saved social media content. Classify the given Instagram reel into exactly one of these six categories based on caption and hashtags:

- places: cafes, restaurants, travel destinations, hidden spots, things to do in a city
- recipes: food recipes, cooking tutorials, ingredient lists, kitchen tips
- fashion: outfits, clothing, styling, OOTD, accessories, beauty
- shopping: products to buy, gadgets, home items, pricing language, "link in bio"
- watch_learn: tutorials, educational content, career advice, skill building, documentaries
- inspo: mood boards, aesthetic content, motivational, quotes, vibes with no clear action

Respond ONLY with a JSON object. No preamble, no explanation.
Format: {"category": "<one of the six>", "confidence": <0.0 to 1.0>}
```

**User message:**

```
Caption: <caption text here, or "No caption available" if empty>
Hashtags: <comma-separated hashtags, or "None" if empty>
```

**Parse the JSON response. If parsing fails, default to `inspo` with `confidence: 0.5`.**

---

### 1.5 App-Side Changes

#### Share Sheet Handler (`src/share/handleIncomingShare.ts`)

This file already exists and handles the incoming URL from the Android share extension. Modify it as follows:

**Current flow:**
```
receive URL → detect platform → show manual popup
```

**New flow:**
```
receive URL
→ if platform === 'instagram'
    → show loading state ("Getting details...")
    → call scrape-instagram Edge Function
    → if success: auto-create save with returned data, show brief confirmation toast
    → if failure: show manual popup (existing component, unchanged)
→ else (non-Instagram URL)
    → existing flow unchanged
```

**Loading state UI:** A small bottom sheet with a spinner and the text "Getting details from Instagram..." — dismisses automatically on success or transitions to the manual popup on failure. Do not block the user from continuing to use the app while this runs. The share handler should be non-blocking — fire the Edge Function call, show the loading bottom sheet, and resolve asynchronously.

**Timeout handling:** If the Edge Function call does not respond within 5 seconds, dismiss the loading state and show the manual popup. Do not wait longer.

#### Save Creation

After a successful scrape, create the save record in Supabase directly from the app with the following fields:

```typescript
{
  user_id: string,
  url: string,                    // original Instagram URL
  platform: 'instagram',
  category: string,               // from Claude classification
  category_confidence: number,
  caption: string,
  hashtags: string[],
  thumbnail_url: string,
  source_username: string,        // owner_username from scrape
  location_id: string | null,     // google_place_id
  location_name: string | null,   // resolved_name
  location_city: string | null,
  lat: number | null,
  lng: number | null,
  acted_on: false,
  scrape_method: 'auto',          // for analytics — distinguish from manual saves
  created_at: timestamp
}
```

---

### 1.6 Database — Schema Additions

The `saves` table already exists. Add these columns if not already present:

```sql
ALTER TABLE saves ADD COLUMN IF NOT EXISTS lat NUMERIC(10, 7);
ALTER TABLE saves ADD COLUMN IF NOT EXISTS lng NUMERIC(10, 7);
ALTER TABLE saves ADD COLUMN IF NOT EXISTS location_city TEXT;
ALTER TABLE saves ADD COLUMN IF NOT EXISTS google_place_id TEXT;
ALTER TABLE saves ADD COLUMN IF NOT EXISTS scrape_method TEXT DEFAULT 'manual';
ALTER TABLE saves ADD COLUMN IF NOT EXISTS category_confidence NUMERIC(4, 3);
ALTER TABLE saves ADD COLUMN IF NOT EXISTS source_username TEXT;
```

Add an index on `(user_id, location_city)` — needed for the map filter and the location-based resurface engine:

```sql
CREATE INDEX IF NOT EXISTS idx_saves_user_city ON saves (user_id, location_city);
CREATE INDEX IF NOT EXISTS idx_saves_user_category ON saves (user_id, category);
```

---

### 1.7 DO NOT Build in This Milestone

- Do not build self-hosted scraping infrastructure
- Do not attempt to parse Instagram HTML directly in the app
- Do not change the manual popup component — it stays as-is for fallback
- Do not add transcript fetching in this milestone (separate milestone)
- Do not change the save flow for any platform other than Instagram

---

## Part 2 — Places Map View

### 2.1 What It Is

A map screen accessible from within the Places category. The user toggles between a grid/list view (existing) and a map view (new). All saved places with coordinates are shown as pins on the map. Tapping a pin opens a small card with save details.

This is a read-only view. No editing happens on the map screen.

---

### 2.2 Dependencies & Setup

**Do NOT use `react-native-maps`. Use Mapbox via `@rnmapbox/maps`.**

Mapbox is chosen over Google Maps because it has significantly better dark-mode tile styling out of the box, which matches Dibs' dark UI. Google Maps tiles are light-mode by default and require a custom JSON style to invert — Mapbox's `mapbox://styles/mapbox/dark-v11` is production-ready with no extra work.

#### Step 1 — Get Mapbox token

Go to `https://console.mapbox.com/account/access-tokens/` and copy the **Default Public Token** (starts with `pk.ey`). Store it as `EXPO_PUBLIC_MAPBOX_TOKEN` in your `.env` file.

#### Step 2 — Install the package

```bash
npm install @rnmapbox/maps
```

#### Step 3 — Configure `app.json`

Add the config plugin to the `plugins` array. This is required for the native build — without it, Mapbox will not work:

```json
{
  "expo": {
    "plugins": [
      [
        "@rnmapbox/maps",
        {
          "RNMapboxMapsVersion": "11.20.1"
        }
      ]
    ]
  }
}
```

#### Step 4 — Rebuild the native app

`@rnmapbox/maps` cannot run in Expo Go — it requires custom native code. After adding the plugin, run:

```bash
npx expo prebuild --clean
```

Then rebuild with EAS or locally:

```bash
# EAS Build (recommended)
eas build --profile development --platform android

# Or local build
npx expo run:android
```

**This prebuild step is mandatory. Skipping it means the map will not render — there will be no error, just a blank screen.**

#### Step 5 — Initialise Mapbox token in app entry point

In `App.tsx` (or wherever your app initialises), add:

```typescript
import Mapbox from '@rnmapbox/maps'

Mapbox.setAccessToken(process.env.EXPO_PUBLIC_MAPBOX_TOKEN!)
```

Call this once at app startup, before any map component renders.

Do not install `react-native-map-clustering` in this milestone. Handle clustering manually with a simple distance-based grouping function (see section 2.5) — keep dependencies minimal.

---

### 2.3 Screen Location & Navigation

The map view lives inside the existing Places screen. It is not a separate route.

**File:** `src/screens/PlacesScreen.tsx` (already exists)

Add a `viewMode` state: `'grid' | 'map'`. Default is `'grid'`. A toggle in the screen header switches between the two. The existing grid/list content renders when `viewMode === 'grid'`. The new map component renders when `viewMode === 'map'`.

Do not create a new navigation route for the map. It is a view mode, not a screen.

---

### 2.4 Data Query

When the user switches to map view, fetch all Places saves for the current user that have non-null `lat` and `lng`:

```typescript
const { data: placeSaves } = await supabase
  .from('saves')
  .select('id, location_name, location_city, lat, lng, thumbnail_url, caption, acted_on, created_at')
  .eq('user_id', userId)
  .eq('category', 'places')
  .not('lat', 'is', null)
  .not('lng', 'is', null)
  .order('created_at', { ascending: false })
```

Also fetch saves WITHOUT coordinates separately (places that were saved manually without location data):

```typescript
const { data: unmappedSaves } = await supabase
  .from('saves')
  .select('id, location_name, caption, acted_on, created_at')
  .eq('user_id', userId)
  .eq('category', 'places')
  .is('lat', null)
```

Show a count of unmapped saves at the bottom of the map screen: "X places couldn't be mapped — no location data." Do not hide them silently.

---

### 2.5 Map Component

**File:** `src/components/PlacesMap.tsx` (new file)

**Props:**

```typescript
type PlacesMapProps = {
  saves: PlaceSave[]          // saves with lat/lng
  unmappedCount: number       // count of saves without coordinates
  onPinPress: (save: PlaceSave) => void
  onAddLocationPress: (save: PlaceSave) => void   // for unmapped saves flow — future
}
```

**Map setup:**

```tsx
import Mapbox, { MapView, Camera, MarkerView } from '@rnmapbox/maps'

// Default camera: centred on India, zoomed out to show all cities
const DEFAULT_CAMERA = {
  centerCoordinate: [78.9629, 20.5937],  // [lng, lat] — Mapbox uses lng-first
  zoomLevel: 4.5,
}
```

Note: Mapbox coordinates are always `[longitude, latitude]` order — the reverse of Google Maps. Every coordinate pair in this component must follow that order.

**Map style:** Use `mapbox://styles/mapbox/dark-v11` as the `styleURL` prop on `<MapView>`. This is a Mapbox-hosted dark style that matches Dibs' UI with no additional configuration.

To calculate the initial camera bounds from the saves data:

```typescript
function getCameraBounds(saves: PlaceSave[]) {
  if (saves.length === 0) return DEFAULT_CAMERA

  const lats = saves.map(s => s.lat)
  const lngs = saves.map(s => s.lng)
  const minLat = Math.min(...lats)
  const maxLat = Math.max(...lats)
  const minLng = Math.min(...lngs)
  const maxLng = Math.max(...lngs)

  return {
    bounds: {
      ne: [maxLng, maxLat],   // north-east corner [lng, lat]
      sw: [minLng, minLat],   // south-west corner [lng, lat]
    },
    padding: { top: 60, bottom: 160, left: 40, right: 40 },  // clear the drawer and UI chrome
  }
}
```

---

### 2.6 Pin Design

Two pin states — unvisited and visited (acted_on = true).

Do not use any default map pin. Use fully custom markers via Mapbox's `MarkerView` component:

**Unvisited pin** (acted_on = false):
- Small pill shape with the place name truncated to 18 characters
- Background: `#FF6B35` (Dibs primary orange)
- Text: white, 11px
- Below the pill: a small triangle tail pointing down (the pin point)

**Visited pin** (acted_on = true):
- Same shape, but background `rgba(255,255,255,0.15)`, text `rgba(255,255,255,0.4)`
- Visually recedes — the user has been there

Implement pins using `MarkerView` from `@rnmapbox/maps`. This is the correct Mapbox component for custom React Native view markers:

```tsx
<MarkerView
  key={save.id}
  coordinate={[save.lng, save.lat]}   // [lng, lat] — Mapbox order
  anchor={{ x: 0.5, y: 1 }}          // anchor at bottom-centre of the pin tail
  onTouchEnd={() => onPinPress(save)}
>
  <PinBubble save={save} />
</MarkerView>
```

Do NOT use `PointAnnotation` for this — it only supports image-based markers, not arbitrary React Native views. `MarkerView` is the correct component for custom view pins.

**`PinBubble` component** (defined in the same file):

```tsx
function PinBubble({ save }: { save: PlaceSave }) {
  const isVisited = save.acted_on
  return (
    <View style={styles.pinWrapper}>
      <View style={[styles.pinBubble, isVisited && styles.pinBubbleVisited]}>
        <Text style={[styles.pinText, isVisited && styles.pinTextVisited]} numberOfLines={1}>
          {save.location_name?.length > 18
            ? save.location_name.slice(0, 17) + '…'
            : save.location_name ?? 'Unnamed place'}
        </Text>
      </View>
      <View style={[styles.pinTail, isVisited && styles.pinTailVisited]} />
    </View>
  )
}
```

Styles (all values in px, dark-mode compatible):

```typescript
const styles = StyleSheet.create({
  pinWrapper: { alignItems: 'center' },
  pinBubble: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.25)',
  },
  pinBubbleVisited: {
    backgroundColor: 'rgba(40,40,40,0.85)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  pinText: { color: '#fff', fontSize: 11, fontWeight: '500' },
  pinTextVisited: { color: 'rgba(255,255,255,0.35)' },
  pinTail: {
    width: 0, height: 0,
    borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 7,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
    borderTopColor: '#FF6B35',
    marginTop: -1,
  },
  pinTailVisited: { borderTopColor: 'rgba(40,40,40,0.85)' },
})
```

---

### 2.7 City Filter

Above the map (as an overlay, not outside the MapView), render a horizontally scrollable row of city pill buttons. Each pill is a unique city extracted from the saves data.

**"All cities" is always the first pill and is selected by default.**

When a city pill is selected, use a `Camera` ref to fly to the bounding box of all saves in that city. The pins for other cities do not disappear — they just zoom out of view. Do not filter the data; filter the viewport.

```tsx
const cameraRef = useRef<Mapbox.Camera>(null)

function flyToCity(city: string) {
  const citySaves = city === 'All' ? saves : saves.filter(s => s.location_city === city)
  if (citySaves.length === 0) return

  const bounds = getCameraBounds(citySaves)
  cameraRef.current?.fitBounds(
    bounds.bounds.ne,
    bounds.bounds.sw,
    [bounds.padding.top, bounds.padding.right, bounds.padding.bottom, bounds.padding.left],
    600   // animation duration in ms
  )
}
```

Pass `cameraRef` to the `<Camera>` component inside `<MapView>`:

```tsx
<MapView styleURL="mapbox://styles/mapbox/dark-v11" style={{ flex: 1 }}>
  <Camera ref={cameraRef} />
  {saves.map(save => (
    <MarkerView key={save.id} coordinate={[save.lng, save.lat]} anchor={{ x: 0.5, y: 1 }}>
      <PinBubble save={save} />
    </MarkerView>
  ))}
</MapView>
```

```typescript
function getCitiesFromSaves(saves: PlaceSave[]): string[] {
  const cities = saves
    .map(s => s.location_city)
    .filter(Boolean) as string[]
  return ['All', ...Array.from(new Set(cities)).sort()]
}
```

City pills are positioned as an absolute overlay at the top of the MapView with `pointerEvents="box-none"` on the container so map panning still works underneath.

---

### 2.8 Pin Tap — Detail Card

When a pin is tapped, show a bottom sheet card (not a full screen). This is a simple `Animated.View` that slides up from the bottom, not a modal.

**Card contents:**

```
[Thumbnail image, 80px tall, full width, rounded top corners]
[Location name — 15px, white, font-weight 500]
[City · Category type — 12px, muted]
[Saved X months ago — 10px, muted]
[Two buttons side by side:]
  [Mark as visited]   [Open original reel →]
```

"Mark as visited" calls `supabase.from('saves').update({ acted_on: true })` for this save and updates the pin colour in local state immediately (optimistic update — do not wait for server confirmation).

"Open original reel →" opens the saved Instagram URL via `Linking.openURL(save.url)`.

Tapping anywhere outside the card dismisses it.

**File:** `src/components/PlaceDetailCard.tsx` (new file)

---

### 2.9 Empty State

If the user has Places saves but none have coordinates (all were manually saved without location), show a full-screen empty state over the map:

```
[Map pin icon — large, muted]
"No spots mapped yet"
"Your next saves will appear here automatically when location data is available."
```

If the user has zero Places saves at all, show:

```
[Map pin icon — large, muted]
"No places saved yet"
"Share an Instagram reel of a café, restaurant, or destination to Dibs — it'll show up here."
```

---

### 2.10 Performance Notes

These are non-negotiable for the map to feel smooth on mid-range Android devices (the primary target):

- `MarkerView` in `@rnmapbox/maps` does not have a `tracksViewChanges` prop — this was a `react-native-maps` concern. Mapbox handles marker rendering natively and does not require this workaround. However, keep `PinBubble` as a `React.memo` component to prevent unnecessary re-renders of marker content.
- Limit the query to the most recent 200 Places saves. If the user has more, show a note: "Showing your 200 most recent saves." Do not paginate the map — it adds complexity with minimal benefit at this stage.
- Do not re-render the entire map on every save update. The map component should only re-render when `saves` prop reference changes. Use `React.memo` on `PlacesMap`.
- Do not fetch map data until the user actually switches to map view (`viewMode === 'map'`). Lazy load.

---

### 2.11 DO NOT Build in This Milestone

- Do not build pin clustering (defer to next milestone once usage data confirms it's needed)
- Do not build a "plan a trip" or routing feature
- Do not add map view to any category other than Places
- Do not allow editing saves from the map screen
- Do not show non-Places saves on the map (recipes, fashion, etc.)
- Do not build an "add location to existing save" flow in this milestone (the unmapped count note is a placeholder for this future flow)

---

## Part 3 — Connecting the Two Features

These two features share one critical dependency: **the `lat`, `lng`, `location_city` fields on the `saves` table**.

The scrape feature populates them at save time. The map feature reads them at display time. There is no other connection between the two — they do not need to be built in sequence, but the map will only show meaningful data once the scrape feature is shipping saves with coordinates.

**For testing the map before the scrape is live:** Seed 5–10 test saves directly into the `saves` table via Supabase Studio with hardcoded lat/lng values for real Indian cities (Bengaluru, Mumbai, Pondicherry, Goa, Delhi). This lets the map UI be tested independently.

**Seed data for testing (insert directly into Supabase):**

```sql
INSERT INTO saves (user_id, url, platform, category, location_name, location_city, lat, lng, acted_on, scrape_method, created_at)
VALUES
  ('<your_test_user_id>', 'https://instagram.com/reel/test1', 'instagram', 'places', 'Hole in the Wall Cafe', 'Bengaluru', 12.9352, 77.6245, false, 'manual', now() - interval '3 months'),
  ('<your_test_user_id>', 'https://instagram.com/reel/test2', 'instagram', 'places', 'Toit Brewpub', 'Bengaluru', 12.9719, 77.6412, false, 'manual', now() - interval '5 months'),
  ('<your_test_user_id>', 'https://instagram.com/reel/test3', 'instagram', 'places', 'Pali Village Cafe', 'Mumbai', 19.0556, 72.8297, true, 'manual', now() - interval '2 months'),
  ('<your_test_user_id>', 'https://instagram.com/reel/test4', 'instagram', 'places', 'Cafe Mosaic', 'Pondicherry', 11.9344, 79.8300, false, 'manual', now() - interval '1 month'),
  ('<your_test_user_id>', 'https://instagram.com/reel/test5', 'instagram', 'places', 'Infantaria Bakery', 'Goa', 15.5494, 73.7554, false, 'manual', now() - interval '6 months'),
  ('<your_test_user_id>', 'https://instagram.com/reel/test6', 'instagram', 'places', 'Matteo Coffee', 'Bengaluru', 12.9698, 77.5950, true, 'manual', now() - interval '4 months'),
  ('<your_test_user_id>', 'https://instagram.com/reel/test7', 'instagram', 'places', 'The Table', 'Mumbai', 18.9270, 72.8328, false, 'manual', now() - interval '7 months');
```

---

## Part 4 — File Structure Reference

Files to create (new):

```
supabase/functions/scrape-instagram/index.ts    Edge Function for scrape + classify
src/components/PlacesMap.tsx                    Map component with pins
src/components/PlaceDetailCard.tsx              Tap-on-pin detail bottom sheet
```

Files to modify (existing):

```
src/share/handleIncomingShare.ts                Add auto-scrape path for Instagram
src/screens/PlacesScreen.tsx                    Add map/grid toggle + render PlacesMap
```

No other files should need changes for this milestone.

---

## Part 5 — Acceptance Criteria

### Instagram Auto-Scrape

- [ ] Sharing an Instagram reel URL shows a loading state, not the manual popup immediately
- [ ] A successfully scraped save appears in the library with correct category, no user input required
- [ ] A save from a public reel with a location tag has non-null `lat`, `lng`, `location_city` in the database
- [ ] Sharing a private account's reel falls back to the manual popup without crashing
- [ ] If the Edge Function takes longer than 5 seconds, the app shows the manual popup
- [ ] `scrape_method` is `'auto'` for scraped saves and `'manual'` for popup saves
- [ ] Non-Instagram shares (YouTube, WhatsApp links) are unaffected

### Places Map View

- [ ] The Places screen has a grid/map toggle in the header
- [ ] Switching to map view shows all Places saves with coordinates as pins
- [ ] Unvisited pins are orange, visited/acted-on pins are muted grey
- [ ] Tapping a pin shows the detail card with correct save info
- [ ] "Mark as visited" on the card updates the pin colour immediately
- [ ] "Open original reel" opens the Instagram URL in browser
- [ ] City filter pills scroll horizontally and zoom the map to that city
- [ ] Saves without coordinates show a count note at the bottom, not an error
- [ ] Map does not load until the user switches to map view (lazy load confirmed via network tab / logs)
- [ ] Map renders smoothly on a mid-range Android device (no visible jank on pin render)

---

*Spec version 1.0 — written for direct Claude Code handoff.*
