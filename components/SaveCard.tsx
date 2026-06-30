import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// PinCard — Pinterest-style card used in the home masonry grid
// ---------------------------------------------------------------------------

function pinAspectRatio(id: string): number {
  // Deterministic variation: 3 heights based on last hex char of UUID
  const mod = parseInt(id.slice(-1), 16) % 3;
  return [0.70, 0.83, 1.00][mod];
}

interface PinCardProps {
  save: Save;
  onPress?: () => void;
}

// ---------------------------------------------------------------------------
// BoardDetailCard — overlay style used inside board detail screens
// ---------------------------------------------------------------------------
export function BoardDetailCard({ save, onPress, onFavorite }: SaveCardProps) {
  const colors  = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji   = CATEGORY_EMOJI[save.category]  ?? CATEGORY_EMOJI.unsorted;
  const title   = getSaveTitle(save);
  const ar      = [0.70, 0.83, 1.00][parseInt(save.id.slice(-1), 16) % 3];

  return (
    <Pressable
      onPress={onPress}
      style={{ borderRadius: 14, overflow: "hidden", backgroundColor: "#F5F5F5" }}
    >
      {save.thumbnail_url ? (
        <>
          <Image
            source={{ uri: save.thumbnail_url }}
            style={{ width: "100%", aspectRatio: ar }}
            resizeMode="cover"
          />
          {/* Overlay + title */}
          <View
            style={{
              position: "absolute", bottom: 0, left: 0, right: 0,
              backgroundColor: "rgba(0,0,0,0.55)",
              paddingHorizontal: 7, paddingTop: 18, paddingBottom: 7,
            }}
          >
            <Text
              style={{ color: "#fff", fontSize: 11, fontWeight: "600", lineHeight: 14 }}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
        </>
      ) : (
        <View
          style={{
            aspectRatio: ar, backgroundColor: colors.bg,
            alignItems: "center", justifyContent: "center",
          }}
        >
          <CategoryIcon category={save.category} size={32} />
        </View>
      )}
      {/* Star / favourite */}
      <Pressable
        onPress={(e) => { e.stopPropagation?.(); onFavorite?.(); }}
        hitSlop={8}
        style={{ position: "absolute", top: 7, right: 8 }}
      >
        <Text
          style={{
            fontSize: 18,
            color: save.is_favorite ? "#FFD700" : "rgba(26,26,26,0.45)",
          }}
        >
          {save.is_favorite ? "★" : "☆"}
        </Text>
      </Pressable>
    </Pressable>
  );
}

export function PinCard({ save, onPress }: PinCardProps) {
  const colors = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji  = CATEGORY_EMOJI[save.category]  ?? CATEGORY_EMOJI.unsorted;
  const label  = CATEGORY_LABEL[save.category]  ?? "Unsorted";
  const title  = getSaveTitle(save);
  const isPending = save.status === "pending";
  const ar = pinAspectRatio(save.id);

  return (
    <Pressable
      onPress={onPress}
      style={{ borderRadius: 14, overflow: "hidden", backgroundColor: "#F5F5F5" }}
    >
      {save.thumbnail_url ? (
        <View>
          <Image
            source={{ uri: save.thumbnail_url }}
            style={{ width: "100%", aspectRatio: ar }}
            resizeMode="cover"
          />
          {isPending && (
            <View
              style={{
                position: "absolute", top: 0, bottom: 0, left: 0, right: 0,
                backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center",
              }}
            >
              <ActivityIndicator color="#fff" size="small" />
            </View>
          )}
        </View>
      ) : (
        <View
          style={{
            aspectRatio: ar,
            backgroundColor: colors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <CategoryIcon category={save.category} size={34} />
          {isPending && (
            <ActivityIndicator color={colors.text} size="small" style={{ marginTop: 6 }} />
          )}
        </View>
      )}

      <View style={{ paddingHorizontal: 8, paddingTop: 7, paddingBottom: 9 }}>
        <Text
          style={{ color: "#1A1A1A", fontSize: 11.5, fontWeight: "500", lineHeight: 15 }}
          numberOfLines={2}
        >
          {title}
        </Text>
        {save.acted_on ? (
          <Text style={{ color: "#4CAF50", fontSize: 10, marginTop: 3 }}>✓ {ACTED_ON_VERB[save.category] ?? "Done"}</Text>
        ) : (
          <Text style={{ color: "#666", fontSize: 10, marginTop: 3 }}>{label}</Text>
        )}
      </View>
    </Pressable>
  );
}

import type { Save, SaveCategory } from "@/lib/database.types";

// Category visual palette — light tint bg + darker text from same family
export const CATEGORY_COLORS: Record<SaveCategory, { bg: string; text: string }> = {
  places:     { bg: "#E1F5EE", text: "#0F6E56" },
  recipes:    { bg: "#FAEEDA", text: "#854F0B" },
  fashion:    { bg: "#FBEAF0", text: "#993556" },
  shopping:   { bg: "#E6F1FB", text: "#185FA5" },
  watch_learn:{ bg: "#EBF0FB", text: "#1A5DAB" },
  inspo:      { bg: "#EEEDFE", text: "#3C3489" },
  unsorted:   { bg: "#F2F2F0", text: "#666666" },
};

export const CATEGORY_EMOJI: Record<SaveCategory, string> = {
  places:     "📍",
  recipes:    "🍳",
  fashion:    "👗",
  shopping:   "🛍️",
  watch_learn:"▶️",
  inspo:      "✨",
  unsorted:   "🗂️",
};

export const CATEGORY_ICON: Partial<Record<SaveCategory, number>> = {
  places:     require("@/assets/icons/place.png"),
  fashion:    require("@/assets/icons/fashion.png"),
  recipes:    require("@/assets/icons/recipe.png"),
  shopping:   require("@/assets/icons/shopping.png"),
  watch_learn:require("@/assets/icons/watch.png"),
  inspo:      require("@/assets/icons/inspo.png"),
};

export function CategoryIcon({ category, size = 24 }: { category: SaveCategory; size?: number }) {
  const source = CATEGORY_ICON[category];
  if (!source) return <Text style={{ fontSize: size * 0.8 }}>{CATEGORY_EMOJI[category] ?? "🗂️"}</Text>;
  return <Image source={source} style={{ width: size, height: size }} resizeMode="contain" />;
}

export const CATEGORY_LABEL: Record<SaveCategory, string> = {
  places:     "Places",
  recipes:    "Recipes",
  fashion:    "Fashion",
  shopping:   "Shopping",
  watch_learn:"Watch",
  inspo:      "Inspo",
  unsorted:   "Unsorted",
};

// Category-aware "acted on" verb
export const ACTED_ON_VERB: Record<SaveCategory, string> = {
  places:     "Visited",
  recipes:    "Cooked",
  fashion:    "Tried",
  shopping:   "Bought",
  watch_learn:"Watched",
  inspo:      "Done",
  unsorted:   "Done",
};

export function getSaveTitle(save: Save): string {
  if (save.title) return save.title;
  if (save.ai_description) return save.ai_description;
  if (save.source_url) {
    try { return new URL(save.source_url).hostname.replace(/^www\./, ""); }
    catch { /* fall through */ }
  }
  return "Saved item";
}

// ---------------------------------------------------------------------------
// SaveListRow — single full-width row, used by the simplified single-column
// category screens (recipes/inspo/watch/shopping) and custom boards.
// ---------------------------------------------------------------------------
export function SaveListRow({
  save, onPress, rightSlot,
}: { save: Save; onPress: () => void; rightSlot?: ReactNode }) {
  const title = getSaveTitle(save);
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row", alignItems: "center", gap: 12,
        paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#F5F5F5",
      }}
    >
      <View style={{ width: 56, height: 56, borderRadius: 12, overflow: "hidden", backgroundColor: "#F5F5F5" }}>
        {save.thumbnail_url ? (
          <Image source={{ uri: save.thumbnail_url }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
        ) : (
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <CategoryIcon category={save.category} size={24} />
          </View>
        )}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 14, fontWeight: "500", color: "#1A1A1A" }} numberOfLines={2}>{title}</Text>
        <Text style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
          {save.acted_on ? `✓ ${ACTED_ON_VERB[save.category] ?? "Done"}` : CATEGORY_LABEL[save.category]}
          {save.is_favorite ? " · ★" : ""}
        </Text>
      </View>
      {rightSlot ?? <Ionicons name="chevron-forward" size={16} color="#C0C0C0" />}
    </Pressable>
  );
}

interface SaveCardProps {
  save: Save;
  onPress?: () => void;
  onFavorite?: () => void;
}

export function SaveCard({ save, onPress, onFavorite }: SaveCardProps) {
  const colors = CATEGORY_COLORS[save.category] ?? CATEGORY_COLORS.unsorted;
  const emoji  = CATEGORY_EMOJI[save.category]  ?? CATEGORY_EMOJI.unsorted;
  const label  = CATEGORY_LABEL[save.category]  ?? "Unsorted";
  const verb   = ACTED_ON_VERB[save.category]   ?? "Done";
  const isPending = save.status === "pending";
  const title  = getSaveTitle(save);

  return (
    <Pressable onPress={onPress} className="rounded-card overflow-hidden bg-white border border-line">
      {/* Thumbnail area */}
      <View className="relative" style={{ height: 96 }}>
        {save.thumbnail_url ? (
          <Image
            source={{ uri: save.thumbnail_url }}
            className="w-full h-full"
            resizeMode="cover"
          />
        ) : (
          <View
            className="w-full h-full items-center justify-center"
            style={{ backgroundColor: colors.bg }}
          >
            <Text style={{ fontSize: 28 }}>{emoji}</Text>
            {isPending && (
              <ActivityIndicator color={colors.text} size="small" className="mt-1" />
            )}
          </View>
        )}

        {/* Pending overlay on thumbnail */}
        {isPending && save.thumbnail_url ? (
          <View className="absolute inset-0 items-center justify-center bg-black/30">
            <ActivityIndicator color="#fff" size="small" />
          </View>
        ) : null}

        {/* Favorite heart — top right */}
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onFavorite?.(); }}
          hitSlop={8}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-white/90 items-center justify-center"
        >
          <Text style={{ fontSize: 13, color: save.is_favorite ? "#D4537E" : "#B0A49A" }}>
            {save.is_favorite ? "♥" : "♡"}
          </Text>
        </Pressable>

        {/* Acted-on badge — bottom left */}
        {save.acted_on ? (
          <View
            className="absolute bottom-1.5 left-1.5 flex-row items-center px-1.5 py-0.5 rounded-full"
            style={{ backgroundColor: "#EAF3DE" }}
          >
            <Text style={{ fontSize: 10, color: "#3B6D11" }}>✓ {verb}</Text>
          </View>
        ) : null}
      </View>

      {/* Card body */}
      <View className="px-2.5 pb-2.5 pt-2 gap-0.5">
        <Text className="text-xs font-medium text-ink leading-4" numberOfLines={2}>
          {title}
        </Text>
        <Text className="text-xs text-muted">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
