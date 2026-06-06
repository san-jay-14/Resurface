import { Pressable, Text, View } from "react-native";

import type { SaveCategory } from "@/lib/database.types";

const CATEGORIES: { value: SaveCategory; label: string; emoji: string }[] = [
  { value: "places", label: "Places", emoji: "📍" },
  { value: "recipes", label: "Recipes", emoji: "🍳" },
  { value: "fashion", label: "Fashion", emoji: "👗" },
  { value: "shopping", label: "Shopping", emoji: "🛍️" },
  { value: "watch_learn", label: "Watch / Learn", emoji: "▶️" },
  { value: "inspo", label: "Inspo", emoji: "✨" },
];

interface CategoryPickerProps {
  value: SaveCategory | null;
  onChange: (category: SaveCategory) => void;
}

export function CategoryPicker({ value, onChange }: CategoryPickerProps) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {CATEGORIES.map((cat) => {
        const active = value === cat.value;
        return (
          <Pressable
            key={cat.value}
            onPress={() => onChange(cat.value)}
            className={`flex-row items-center gap-1.5 rounded-full border px-4 py-2.5 ${
              active ? "border-coral bg-coral" : "border-line bg-white"
            }`}
          >
            <Text className="text-base leading-none">{cat.emoji}</Text>
            <Text
              className={`text-sm font-semibold ${active ? "text-white" : "text-ink"}`}
            >
              {cat.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
