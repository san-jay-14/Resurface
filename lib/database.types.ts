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
  | "tiktok"
  | "pinterest"
  | "twitter"
  | "linkedin"
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
  birthday: string | null;
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
  wrapped_theme: string | null;
  feature_flags: FeatureFlags;
  created_at: string;
}

export interface FeatureFlags {
  ai_rules_enabled: boolean;
  cleanup_mode_enabled: boolean;
  wrapped_enabled: boolean;
  shared_boards_enabled: boolean;
}

export interface Save {
  id: string;
  user_id: string;
  source_platform: SourcePlatform;
  source_url: string | null;
  category: SaveCategory;
  title: string | null;
  note: string | null;
  thumbnail_url: string | null;
  ai_description: string | null;
  keywords: string[] | null;
  status: SaveStatus;
  acted_on: boolean;
  acted_on_at: string | null;
  is_favorite: boolean;
  archived: boolean;
  archived_at: string | null;
  last_viewed_at: string | null;
  created_at: string;
  last_interacted_at: string | null;
}

export interface Collection {
  id: string;
  user_id: string;
  name: string;
  is_shared: boolean;
  invite_code: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  save_count?: number;
}

export interface CollectionSave {
  collection_id: string;
  save_id: string;
  added_at: string;
}

export interface CollectionMember {
  id: string;
  collection_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
}

export interface CollectionSaveReaction {
  id: string;
  collection_id: string;
  save_id: string;
  user_id: string;
  reaction: "in" | "pass";
  created_at: string;
}

export interface UserRule {
  id: string;
  user_id: string;
  raw_text: string;
  parsed_logic: ParsedRuleLogic;
  is_active: boolean;
  priority: number;
  hit_count: number;
  created_at: string;
  updated_at: string;
}

export interface ParsedRuleLogic {
  conditions: RuleCondition[];
  condition_logic: "AND" | "OR";
  action: {
    set_category: SaveCategory | null;
    set_tags?: string[];
    add_to_board?: string | null;
  };
}

export interface RuleCondition {
  field: "caption" | "username" | "url" | "platform" | "time_of_day" | "day_of_week";
  operator: "contains" | "equals" | "matches_regex" | "before" | "after" | "is";
  value: string | string[];
}

export interface ArchivedSave {
  id: string;
  user_id: string;
  original_save_id: string;
  original_data: Save;
  archived_at: string;
  expires_at: string;
}

export interface WrappedHistory {
  id: string;
  user_id: string;
  period_start: string;
  period_end: string;
  stats_snapshot: WrappedStats;
  copy: WrappedCopy;
  created_at: string;
}

export interface WrappedStats {
  total: number;
  acted_on: number;
  top_category: SaveCategory;
  top_category_count: number;
  oldest_dormant_caption: string | null;
  oldest_dormant_days: number;
  peak_hour: number;
  platforms: { platform: SourcePlatform; count: number }[];
}

export interface WrappedCopy {
  headline: string;
  label: string;
  roast: string;
  closing: string;
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
