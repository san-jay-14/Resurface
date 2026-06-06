import { ActivityIndicator, Image, Pressable, Text, View } from "react-native";

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
