/**
 * Hand-maintained types mirroring supabase/migrations.
 *
 * Once the Supabase project exists you can replace this with generated types:
 *   npx supabase gen types typescript --project-id <ref> > lib/database.types.ts
 * Until then, keep this in sync with the SQL by hand.
 */

export type SourcePlatform =
  | "instagram"
  | "web"
  | "youtube"
  | "whatsapp"
  | "unsorted";

export type SaveCategory =
  | "places"
  | "recipes"
  | "fashion"
  | "shopping"
  | "watch_learn"
  | "inspo"
  | "unsorted";

export type SaveStatus = "pending" | "enriched" | "manual";
export type UserEventType = "birthday" | "anniversary" | "trip";
export type CalendarEventType = "holiday" | "festival" | "long_weekend";

export interface UserProfile {
  id: string;
  name: string | null;
  email: string | null;
  birthday: string | null; // ISO date (YYYY-MM-DD)
  home_city: string | null;
  home_city_lat: number | null;
  home_city_lng: number | null;
  current_city: string | null;
  current_city_lat: number | null;
  current_city_lng: number | null;
  current_city_updated_at: string | null;
  notif_frequency_pref: string;
  last_notified_at: string | null;
  is_guest: boolean;
  onboarding_completed: boolean;
  created_at: string;
}

export interface Save {
  id: string;
  user_id: string;
  source_platform: SourcePlatform;
  source_url: string | null;
  category: SaveCategory;
  title: string | null;          // phase 3: OG title from enrichment
  note: string | null;
  thumbnail_url: string | null;
  ai_description: string | null;
  keywords: string[] | null;
  status: SaveStatus;
  acted_on: boolean;
  acted_on_at: string | null;    // phase 3: timestamp when acted_on flipped to true
  is_favorite: boolean;          // phase 3: heart toggle
  archived: boolean;
  archived_at: string | null;
  created_at: string;
  last_interacted_at: string | null;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  save_count?: number; // joined/computed, not a real column
}

export interface CollectionSave {
  collection_id: string;
  save_id: string;
  added_at: string;
}

export interface SaveLocation {
  id: string;
  save_id: string;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
  city: string | null;
  country: string | null;
  google_place_id: string | null;
  created_at: string;
}

export interface UserEvent {
  id: string;
  user_id: string;
  type: UserEventType;
  date: string;
  created_at: string;
}

export interface CalendarEvent {
  id: string;
  name: string;
  type: CalendarEventType;
  date: string;
  region: string;
}

export interface DeviceToken {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: string | null;
  created_at: string;
  updated_at: string;
}

export interface NotificationLog {
  id: string;
  user_id: string;
  save_ids: string[];
  trigger_type: string;
  copy: string | null;
  sent_at: string;
  tapped: boolean;
}
