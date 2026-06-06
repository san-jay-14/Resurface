import { ActivityIndicator, Image, Text, View } from "react-native";

import type { Save } from "@/lib/database.types";

const CATEGORY_META: Record<string, { emoji: string; label: string }> = {
  places:     { emoji: "📍", label: "Places" },
  recipes:    { emoji: "🍳", label: "Recipes" },
  fashion:    { emoji: "👗", label: "Fashion" },
  shopping:   { emoji: "🛍️", label: "Shopping" },
  watch_learn:{ emoji: "▶️", label: "Watch / Learn" },
  inspo:      { emoji: "✨", label: "Inspo" },
  unsorted:   { emoji: "🗂️", label: "Unsorted" },
};

const PLATFORM_LABEL: Record<string, string> = {
  instagram: "Instagram",
  youtube:   "YouTube",
  web:       "Web",
  whatsapp:  "WhatsApp",
  unsorted:  "Unknown",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

interface SaveCardProps {
  save: Save;
}

export function SaveCard({ save }: SaveCardProps) {
  const meta = CATEGORY_META[save.category] ?? CATEGORY_META.unsorted;
  const isPending = save.status === "pending";
  const body = save.ai_description ?? save.note;

  return (
    <View className="rounded-card border border-line bg-white overflow-hidden">
      {/* Thumbnail or text-card header */}
      {save.thumbnail_url ? (
        <View className="h-36 w-full bg-sand">
          <Image
            source={{ uri: save.thumbnail_url }}
            className="h-full w-full"
            resizeMode="cover"
          />
          {isPending && (
            <View className="absolute inset-0 items-center justify-center bg-black/30">
              <ActivityIndicator color="#fff" size="small" />
            </View>
          )}
        </View>
      ) : (
        <View className="h-24 w-full items-center justify-center bg-coral-soft">
          <Text className="text-3xl">{meta.emoji}</Text>
          {isPending && (
            <ActivityIndicator
              color="#FF6B4A"
              size="small"
              className="mt-1"
            />
          )}
        </View>
      )}

      {/* Card body */}
      <View className="gap-1.5 p-3">
        {/* Category pill + time */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-1 rounded-full bg-sand px-2 py-0.5">
            <Text className="text-xs">{meta.emoji}</Text>
            <Text className="text-xs font-medium text-ink">{meta.label}</Text>
          </View>
          <Text className="text-xs text-muted">{timeAgo(save.created_at)}</Text>
        </View>

        {/* Description / note */}
        {isPending ? (
          <Text className="text-xs text-muted">Categorising…</Text>
        ) : body ? (
          <Text className="text-xs leading-4 text-ink" numberOfLines={2}>
            {body}
          </Text>
        ) : null}

        {/* Source badge */}
        <Text className="text-xs text-muted">
          {PLATFORM_LABEL[save.source_platform] ?? "Unknown"}
        </Text>
      </View>
    </View>
  );
}
